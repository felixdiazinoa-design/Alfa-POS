
import React, { useState, useMemo, useEffect } from 'react';
import {
   ArrowLeft, Search, Calendar, ChevronDown, ChevronUp,
   Printer, RotateCcw, AlertCircle, Check, X, FileText,
   User as UserIcon, DollarSign, Box, Filter, Gift, QrCode, StickyNote,
   MoreVertical, CreditCard, Banknote, Wallet, TrendingUp, Hash, Percent,
   Mail, Flag, Loader2
} from 'lucide-react';
import {
   Transaction,
   BusinessConfig,
   CartItem,
   RoleDefinition,
   ZReport,
   PaymentEntry,
   PaymentIntegrationDefinition,
   RefundProcessingOptions,
   Customer,
   FiscalDocumentCorrectionInput,
   InvoiceReviewFlag,
   InvoiceReviewPriority,
} from '../types';
import { validateTerminalDocument } from '../utils/validation';
import { printIntegratedPaymentArtifacts, printTicket } from '../utils/printer';
import { useSupervisorAuth } from '../hooks/useSupervisorAuth';
import SupervisorModal from './SupervisorModal';
import { User, DeviceRole } from '../types';
import { RefundModal } from './RefundModal';
import FiscalSyncBadge from './FiscalSyncBadge';
import { calculateTransactionFiscalSummary, consolidateTaxBreakdownForDisplay, formatTaxLineLabel } from '../utils/fiscalBreakdown';
import {
   canRetryFiscalTransaction,
   FISCAL_DOCUMENT_LABELS,
   getFiscalDisplayCode,
   getFiscalDisplayNcf,
   getFiscalRetryActionLabel,
   isElectronicFiscalTransaction,
   isRefundLikeTransaction
} from '../utils/fiscal/fiscalHelpers';
import { AzulGatewayError, azulMcmService } from '../services/payments/AzulMcmService';
import { CardNetEcrError, cardNetEcrService } from '../services/payments/CardNetEcrService';
import {
   createPaymentIntegrationAuditEvent,
   dispatchAuditEventConfigUpdate,
} from '../services/payments/paymentIntegrationAudit';
import {
   buildPaymentSettlementSummary,
   resolveCurrencySymbol,
} from '../utils/paymentSettlement';
import {
   getRemainingRefundQuantities,
   hasRefundableItems,
   validateRefundItems,
} from '../utils/refundAvailability';
import {
   resolveHistoryDiscountTotal,
   resolveHistoryTerminalName,
} from '../utils/transactionHistoryPresentation';
import { apiSyncAdapter } from '../services/sync/ApiSyncAdapter';
import {
   ErpRefundSourceMatch,
   getErpRemainingQuantities,
   normalizeErpRefundSearchResponse,
   normalizeErpRefundPreparation,
   normalizeErpRefundSourceTransaction,
   validateErpRefundItems,
} from '../services/refunds/erpRefundSource';
import { sendReceiptEmailViaErp, type ReceiptEmailResult } from '../services/email/receiptEmailService';
import { buildReceiptEmailPayload } from '../services/email/receiptEmailPayload';
import {
   createInvoiceReview,
   recordInvoiceAuditEvent,
} from '../services/invoices/InvoiceReviewService';

interface TicketHistoryProps {
   transactions: Transaction[];
   config: BusinessConfig;
   currentUser: User | null;
   onUpdateConfig: (newConfig: BusinessConfig) => void;
   users: User[];
   roles: RoleDefinition[];
   onClose: () => void;
   activeTerminalId: string;
   initialSelectedId?: string | null; // NEW: For Smart Scan
   onRetryFiscalDocument?: (transaction: Transaction) => Promise<string>;
   customers?: Customer[];
   onCorrectFiscalDocument?: (transaction: Transaction, correction: FiscalDocumentCorrectionInput) => Promise<Transaction>;
   onRefundTransaction: (
      originalTx: Transaction,
      refundedItems: CartItem[],
      conditions: Map<string, 'SELLABLE' | 'DAMAGED'>,
      reason: string,
      options?: RefundProcessingOptions
   ) => Promise<Transaction | null>;
}

type ReturnReason = 'DAMAGED' | 'DISLIKE' | 'ERROR' | 'EXPIRED';

const REASONS: { id: ReturnReason; label: string }[] = [
   { id: 'DAMAGED', label: 'Producto Dañado / Defectuoso' },
   { id: 'DISLIKE', label: 'No era lo que esperaba' },
   { id: 'ERROR', label: 'Error en Cobro / Digitacion' },
   { id: 'EXPIRED', label: 'Producto Vencido' },
];

const AZUL_VOID_WINDOW_MS = 20 * 60 * 1000;

type GatewayProgressOverlayState = {
   title: string;
   providerLabel: string;
   detail: string;
};

type RefundRequestMode = 'STANDARD' | 'AZUL_GATEWAY_REFUND' | 'CARDNET_GATEWAY_REFUND';

type AzulVoidResolution =
   | { mode: 'NOT_AZUL' }
   | { mode: 'BLOCK'; message: string }
   | {
      mode: 'VOID';
      integration: PaymentIntegrationDefinition;
      payment: PaymentEntry;
      amount: number;
      taxAmount: number;
      orderNumber: string;
      authorizationNumber: string;
   };

type AzulRefundResolution =
   | { mode: 'NOT_AZUL' }
   | { mode: 'BLOCK'; message: string }
   | {
      mode: 'REFUND';
      integration: PaymentIntegrationDefinition;
      payment: PaymentEntry;
      amount: number;
      taxAmount: number;
      orderNumber: string;
   };

const roundToTwo = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const amountsMatch = (left: number, right: number): boolean => Math.abs(left - right) <= 0.01;

const getPositivePayments = (transaction: Transaction): PaymentEntry[] => (
   (transaction.payments || [])
      .filter(payment => Number(payment?.amount || 0) > 0.009)
      .map(payment => payment as PaymentEntry)
);

const isFullRefundSelection = (transaction: Transaction, refundItems: CartItem[]): boolean => {
   const selectedQtyByCartId = new Map(refundItems.map(item => [item.cartId, Math.abs(Number(item.quantity || 0))]));
   return transaction.items.every(item => (
      Math.abs(Number(selectedQtyByCartId.get(item.cartId) || 0)) === Math.abs(Number(item.quantity || 0))
   ));
};

const extractGatewayOrderNumber = (payment: PaymentEntry): string => {
   const rawOrderNumber = (
      payment.gatewayOrderNumber ||
      String(payment.gatewayRawResponse?.OrderNumber || '').trim() ||
      payment.gatewayInvoiceNumber ||
      ''
   ).trim();

   return /^\d+$/.test(rawOrderNumber) ? rawOrderNumber : '';
};

const pickGatewayPaymentString = (payment: Partial<PaymentEntry> | Record<string, any>, keys: string[]): string => {
   for (const key of keys) {
      const value = (payment as Record<string, any>)?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
   }
   return '';
};

const resolveGatewayAuthorizationCode = (payment: Partial<PaymentEntry> | Record<string, any>): string => (
   pickGatewayPaymentString(payment, [
      'gatewayAuthorizationCode',
      'authorizationCode',
      'authCode',
      'authorizationNumber',
      'AuthorizationNumber',
      'authorization_number',
      'HostAuthorizationCode',
      'hostAuthorizationCode',
      'AUT',
   ])
);

const resolveGatewayReferenceNumber = (payment: Partial<PaymentEntry> | Record<string, any>): string => (
   pickGatewayPaymentString(payment, [
      'gatewayReference',
      'referenceNumber',
      'transactionReference',
      'gatewayTransactionReference',
      'reference',
      'reference_no',
      'referenceNo',
      'REF',
   ])
);

const resolveGatewayProviderLabel = (payment: Partial<PaymentEntry> | Record<string, any>): string => {
   const provider = pickGatewayPaymentString(payment, ['gatewayProvider', 'provider']).toUpperCase();
   if (provider === 'AZUL') return 'AZUL';
   if (provider === 'INGENICO_AZUL_WEBAPI') return 'Ingenico Azul';
   return provider || '';
};

const resolveAzulVoidResolution = (
   transaction: Transaction,
   refundItems: CartItem[],
   config: BusinessConfig
): AzulVoidResolution => {
   const positivePayments = getPositivePayments(transaction);
   const azulPayments = positivePayments.filter(payment => payment.gatewayProvider === 'AZUL');

   if (azulPayments.length === 0) {
      return { mode: 'NOT_AZUL' };
   }

   if (transaction.status === 'PARTIAL_REFUND' || transaction.status === 'REFUNDED') {
      return {
         mode: 'BLOCK',
         message: 'La venta ya tiene devoluciones registradas. La anulación AZUL automática solo se permite sobre tickets intactos.',
      };
   }

   if (positivePayments.length !== 1 || azulPayments.length !== 1) {
      return {
         mode: 'BLOCK',
         message: 'La anulación AZUL solo está disponible cuando la venta fue cobrada 100% con una única transacción integrada de tarjeta.',
      };
   }

   if (!isFullRefundSelection(transaction, refundItems)) {
      return {
         mode: 'BLOCK',
         message: 'La anulación AZUL solo aplica a la venta completa. Las devoluciones parciales con AZUL todavía no están soportadas en el POS.',
      };
   }

   const salePayment = azulPayments[0];
   const integration = (config.integrations || []).find(candidate =>
      candidate.id === salePayment.gatewayIntegrationId && candidate.provider === 'AZUL'
   );

   if (!integration || !integration.isEnabled) {
      return {
         mode: 'BLOCK',
         message: 'La integración AZUL original ya no está disponible o está inactiva en esta terminal.',
      };
   }

   if (integration.capabilities?.void === false) {
      return {
         mode: 'BLOCK',
         message: 'Esta integración AZUL no tiene habilitada la capacidad de anulación.',
      };
   }

   const elapsedMs = Date.now() - new Date(transaction.date).getTime();
   if (!Number.isFinite(elapsedMs) || elapsedMs > AZUL_VOID_WINDOW_MS) {
      return {
         mode: 'BLOCK',
         message: 'Pasaron más de 20 minutos desde la venta. La anulación automática de AZUL ya no aplica; use el botón Refund AZUL para continuar con el adquirente.',
      };
   }

   const gatewayAmount = roundToTwo(Number(salePayment.gatewayProcessedAmount ?? salePayment.amount ?? 0));
   if (!amountsMatch(gatewayAmount, roundToTwo(Number(transaction.total || 0)))) {
      return {
         mode: 'BLOCK',
         message: 'La venta AZUL no coincide 100% con el total del ticket. Por ahora el POS solo anula ventas totalmente cobradas por una sola transacción integrada.',
      };
   }

   const authorizationNumber = resolveGatewayAuthorizationCode(salePayment);
   if (!authorizationNumber) {
      return {
         mode: 'BLOCK',
         message: 'La venta no tiene AUT No. almacenado, por lo que no se puede enviar la anulación a AZUL.',
      };
   }

   const orderNumber = extractGatewayOrderNumber(salePayment);
   if (!orderNumber) {
      return {
         mode: 'BLOCK',
         message: 'La venta no tiene OrderNumber numérico guardado. No se puede enviar la anulación a AZUL con seguridad.',
      };
   }

   const terminalConfig = config.terminals?.find(t => t.id === transaction.terminalId)?.config;
   const fiscalSummary = calculateTransactionFiscalSummary(transaction, config, { terminalConfig });
   const taxAmount = roundToTwo(Number(salePayment.gatewayProcessedTaxAmount ?? fiscalSummary.taxTotal ?? transaction.taxAmount ?? 0));

   return {
      mode: 'VOID',
      integration,
      payment: salePayment,
      amount: gatewayAmount,
      taxAmount,
      orderNumber,
      authorizationNumber,
   };
};

const resolveAzulRefundResolution = (
   transaction: Transaction,
   refundItems: CartItem[],
   config: BusinessConfig
): AzulRefundResolution => {
   const positivePayments = getPositivePayments(transaction);
   const azulPayments = positivePayments.filter(payment => payment.gatewayProvider === 'AZUL');

   if (azulPayments.length === 0) {
      return { mode: 'NOT_AZUL' };
   }

   if (transaction.status === 'PARTIAL_REFUND' || transaction.status === 'REFUNDED') {
      return {
         mode: 'BLOCK',
         message: 'La venta ya tiene devoluciones registradas. El refund AZUL automático solo se permite sobre tickets intactos.',
      };
   }

   if (positivePayments.length !== 1 || azulPayments.length !== 1) {
      return {
         mode: 'BLOCK',
         message: 'El refund AZUL solo está disponible cuando la venta fue cobrada 100% con una única transacción integrada de tarjeta.',
      };
   }

   if (!isFullRefundSelection(transaction, refundItems)) {
      return {
         mode: 'BLOCK',
         message: 'El refund AZUL solo aplica a la venta completa. Las devoluciones parciales con AZUL todavía no están soportadas en el POS.',
      };
   }

   const salePayment = azulPayments[0];
   const integration = (config.integrations || []).find(candidate =>
      candidate.id === salePayment.gatewayIntegrationId && candidate.provider === 'AZUL'
   );

   if (!integration || !integration.isEnabled) {
      return {
         mode: 'BLOCK',
         message: 'La integración AZUL original ya no está disponible o está inactiva en esta terminal.',
      };
   }

   if (integration.capabilities?.refund === false) {
      return {
         mode: 'BLOCK',
         message: 'Esta integración AZUL no tiene habilitada la capacidad de refund.',
      };
   }

   const elapsedMs = Date.now() - new Date(transaction.date).getTime();
   if (Number.isFinite(elapsedMs) && elapsedMs <= AZUL_VOID_WINDOW_MS) {
      return {
         mode: 'BLOCK',
         message: 'Esta venta todavía está dentro de la ventana de 20 minutos. En este caso corresponde usar la anulación AZUL, no el refund.',
      };
   }

   const gatewayAmount = roundToTwo(Number(salePayment.gatewayProcessedAmount ?? salePayment.amount ?? 0));
   if (!amountsMatch(gatewayAmount, roundToTwo(Number(transaction.total || 0)))) {
      return {
         mode: 'BLOCK',
         message: 'La venta AZUL no coincide 100% con el total del ticket. Por ahora el POS solo hace refund sobre ventas totalmente cobradas por una sola transacción integrada.',
      };
   }

   const orderNumber = extractGatewayOrderNumber(salePayment);
   if (!orderNumber) {
      return {
         mode: 'BLOCK',
         message: 'La venta no tiene OrderNumber numérico guardado. No se puede enviar el refund a AZUL con seguridad.',
      };
   }

   const terminalConfig = config.terminals?.find(t => t.id === transaction.terminalId)?.config;
   const fiscalSummary = calculateTransactionFiscalSummary(transaction, config, { terminalConfig });
   const taxAmount = roundToTwo(Number(salePayment.gatewayProcessedTaxAmount ?? fiscalSummary.taxTotal ?? transaction.taxAmount ?? 0));

   return {
      mode: 'REFUND',
      integration,
      payment: salePayment,
      amount: gatewayAmount,
      taxAmount,
      orderNumber,
   };
};

const canOfferAzulRefundAction = (
   transaction: Transaction,
   config: BusinessConfig
): boolean => resolveAzulRefundResolution(transaction, transaction.items || [], config).mode === 'REFUND';

/** Ventana en la que el POS ofrece la anulación CardNET (CN02) en lugar de la devolución (CN03). */
const CARDNET_VOID_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Proveedor integrado con el que se cobró el ticket. */
const resolveIntegratedGatewayProvider = (transaction: Transaction): 'AZUL' | 'CARDNET' | null => {
   const positivePayments = getPositivePayments(transaction);
   if (positivePayments.some(payment => payment.gatewayProvider === 'CARDNET')) return 'CARDNET';
   if (positivePayments.some(payment => payment.gatewayProvider === 'AZUL')) return 'AZUL';
   return null;
};

type CardNetOperationPayload = {
   integration: PaymentIntegrationDefinition;
   payment: PaymentEntry;
   amount: number;
   taxAmount: number;
   invoiceTicket: string;
   host: string;
   referenceNumber: string;
   elapsedMs: number;
};

type CardNetOperationResolution =
   | { mode: 'NOT_CARDNET' }
   | { mode: 'BLOCK'; message: string }
   | ({ mode: 'VOID' } & CardNetOperationPayload)
   | ({ mode: 'REFUND' } & CardNetOperationPayload);

/** "Ticket de la Factura" (6 posiciones) que CardNET exige para ventas y devoluciones. */
const resolveCardNetInvoiceTicket = (payment: PaymentEntry, transaction: Transaction): string => {
   const candidates = [
      payment.gatewayInvoiceNumber,
      payment.gatewayOrderNumber,
      transaction.displayId,
      transaction.id,
   ];

   for (const candidate of candidates) {
      const digits = String(candidate || '').replace(/[^0-9]/g, '');
      if (digits.length >= 6) return digits.slice(-6);
   }

   return String(Math.abs(Math.trunc(Date.now())) % 1_000_000).padStart(6, '0');
};

/** HOST CardNET (06=Crédito, 07=Débito, 08=AMEX, 09=Privada, 10=Peaje, 12=Otro). */
const resolveCardNetHost = (payment: PaymentEntry): string => {
   const stored = pickGatewayPaymentString(payment, ['gatewayHost', 'host', 'HOST']);
   if (/^\d{2}$/.test(stored)) return stored;

   const product = pickGatewayPaymentString(payment, ['gatewayCardProduct', 'productType']).toUpperCase();
   if (product === 'AC' || product === 'AD') return '08';
   if (product === 'DC' || product === 'DS') return '09';
   if (product === 'OT') return '12';

   return '06';
};

/** "Num. De Ref." (3 posiciones) que identifica la transacción aprobada en el terminal. */
const resolveCardNetReferenceNumber = (payment: PaymentEntry): string => {
   const raw = pickGatewayPaymentString(payment, ['gatewaySequenceNumber', 'sequenceNumber']);
   return /^\d{1,3}$/.test(raw) ? raw : '';
};

/**
 * Decide qué operación corresponde con el terminal CardNET:
 * anulación (CN02) mientras la venta siga en el lote abierto y devolución (CN03)
 * después del cierre. Las reglas de integridad (ticket completo, una sola
 * transacción integrada, integración activa) son las mismas que ya usa AZUL.
 */
const resolveCardNetOperationResolution = (
   transaction: Transaction,
   refundItems: CartItem[],
   config: BusinessConfig
): CardNetOperationResolution => {
   const positivePayments = getPositivePayments(transaction);
   const cardNetPayments = positivePayments.filter(payment => payment.gatewayProvider === 'CARDNET');

   if (cardNetPayments.length === 0) return { mode: 'NOT_CARDNET' };

   if (transaction.status === 'PARTIAL_REFUND' || transaction.status === 'REFUNDED') {
      return {
         mode: 'BLOCK',
         message: 'La venta ya tiene devoluciones registradas. Las operaciones CardNET automáticas solo se permiten sobre tickets intactos.',
      };
   }

   if (positivePayments.length !== 1 || cardNetPayments.length !== 1) {
      return {
         mode: 'BLOCK',
         message: 'La operación CardNET solo está disponible cuando la venta fue cobrada 100% con una única transacción integrada de tarjeta.',
      };
   }

   if (!isFullRefundSelection(transaction, refundItems)) {
      return {
         mode: 'BLOCK',
         message: 'CardNET solo opera sobre la venta completa. Las devoluciones parciales todavía no están soportadas en el POS.',
      };
   }

   const salePayment = cardNetPayments[0];
   const integration = (config.integrations || []).find(candidate =>
      candidate.id === salePayment.gatewayIntegrationId && candidate.provider === 'CARDNET'
   );

   if (!integration || !integration.isEnabled) {
      return {
         mode: 'BLOCK',
         message: 'La integración CardNET original ya no está disponible o está inactiva en esta terminal.',
      };
   }

   const gatewayAmount = roundToTwo(Number(salePayment.gatewayProcessedAmount ?? salePayment.amount ?? 0));
   if (!amountsMatch(gatewayAmount, roundToTwo(Number(transaction.total || 0)))) {
      return {
         mode: 'BLOCK',
         message: 'La venta CardNET no coincide 100% con el total del ticket. Por ahora el POS solo opera ventas totalmente cobradas por una sola transacción integrada.',
      };
   }

   const terminalConfig = config.terminals?.find(t => t.id === transaction.terminalId)?.config;
   const fiscalSummary = calculateTransactionFiscalSummary(transaction, config, { terminalConfig });
   const taxAmount = roundToTwo(Number(
      salePayment.gatewayProcessedTaxAmount ?? fiscalSummary.taxTotal ?? transaction.taxAmount ?? 0
   ));
   const elapsedMs = Date.now() - new Date(transaction.date).getTime();
   const payload: CardNetOperationPayload = {
      integration,
      payment: salePayment,
      amount: gatewayAmount,
      taxAmount,
      invoiceTicket: resolveCardNetInvoiceTicket(salePayment, transaction),
      host: resolveCardNetHost(salePayment),
      referenceNumber: resolveCardNetReferenceNumber(salePayment),
      elapsedMs,
   };

   const withinVoidWindow = Number.isFinite(elapsedMs) && elapsedMs <= CARDNET_VOID_WINDOW_MS;

   if (withinVoidWindow) {
      if (integration.capabilities?.void === false) {
         return { mode: 'BLOCK', message: 'Esta integración CardNET no tiene habilitada la capacidad de anulación.' };
      }

      if (!payload.referenceNumber) {
         return {
            mode: 'BLOCK',
            message: 'La venta no tiene el Num. De Ref. que CardNET necesita para anular (CN02). Ejecute el cierre y use la devolución (CN03).',
         };
      }

      return { mode: 'VOID', ...payload };
   }

   if (integration.capabilities?.refund === false) {
      return { mode: 'BLOCK', message: 'Esta integración CardNET no tiene habilitada la capacidad de devolución.' };
   }

   return { mode: 'REFUND', ...payload };
};

/** Habilita el botón de operación con el adquirente cuando el ticket la soporta. */
const canOfferIntegratedGatewayAction = (
   transaction: Transaction,
   config: BusinessConfig
): boolean => {
   const provider = resolveIntegratedGatewayProvider(transaction);
   if (provider === 'CARDNET') {
      const resolution = resolveCardNetOperationResolution(transaction, transaction.items || [], config);
      return resolution.mode === 'VOID' || resolution.mode === 'REFUND';
   }

   return canOfferAzulRefundAction(transaction, config);
};

// --- SUB-COMPONENTS ---

const SalesSummaryBar: React.FC<{ kpis: any; config: BusinessConfig }> = ({ kpis, config }) => (
   <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {[
         { label: 'Ventas Totales', value: kpis.totalSales, icon: <TrendingUp className="text-green-500" />, isCurrency: true },
         { label: 'Cantidad Tickets', value: kpis.ticketCount, icon: <Hash className="text-blue-500" />, isCurrency: false },
         { label: 'Ticket Promedio', value: kpis.avgTicket, icon: <Percent className="text-purple-500" />, isCurrency: true },
         { label: 'Devoluciones', value: kpis.refunds, icon: <RotateCcw className="text-red-500" />, isCurrency: true, isRed: true },
      ].map((stat, i) => (
         <div key={i} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center">
               {stat.icon}
            </div>
            <div>
               <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">{stat.label}</p>
               <p className={`text-lg font-black ${stat.isRed ? 'text-red-600' : 'text-gray-900'}`}>
                  {stat.isCurrency ? `${config.currencySymbol}${stat.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : stat.value}
               </p>
            </div>
         </div>
      ))}
   </div>
);


const SalesHistoryTable: React.FC<{
   transactions: Transaction[];
   config: BusinessConfig;
   onRowClick: (id: string) => void;
   themeBg: string;
   themeText: string;
   zReportMap?: Map<string, string>;
   zReports?: ZReport[];
   reviewedTransactionIds?: Set<string>;
}> = ({ transactions, config, onRowClick, themeBg, themeText, zReportMap, zReports, reviewedTransactionIds = new Set() }) => {
   const normalizeTerminalId = (value?: string | null) => (value || '').trim().toLowerCase();
   const toTimestamp = (value?: string) => {
      const ts = value ? new Date(value).getTime() : NaN;
      return Number.isFinite(ts) ? ts : null;
   };

   // Fallback for legacy data: infer missing Z sequence using report windows + transactionCount.
   const inferredZByTxId = useMemo(() => {
      const inferred = new Map<string, string>();
      if (!zReports || zReports.length === 0 || transactions.length === 0) return inferred;

      const reportsByTerminal = new Map<string, ZReport[]>();
      zReports.forEach((report) => {
         const terminalKey = normalizeTerminalId(report.terminalId);
         if (!terminalKey) return;
         const existing = reportsByTerminal.get(terminalKey) || [];
         existing.push(report);
         reportsByTerminal.set(terminalKey, existing);
      });

      reportsByTerminal.forEach((reports) => {
         reports.sort((a, b) => (toTimestamp(a.closedAt) || 0) - (toTimestamp(b.closedAt) || 0));
      });

      const explicitCountByReportId = new Map<string, number>();
      transactions.forEach((tx) => {
         if (tx.zReportId) {
            explicitCountByReportId.set(tx.zReportId, (explicitCountByReportId.get(tx.zReportId) || 0) + 1);
            return;
         }
         if (tx.zReportSequence) {
            const matched = zReports.find(r => r.sequenceNumber === tx.zReportSequence);
            if (matched) explicitCountByReportId.set(matched.id, (explicitCountByReportId.get(matched.id) || 0) + 1);
         }
      });

      const unresolvedByTerminal = new Map<string, Transaction[]>();
      transactions.forEach((tx) => {
         if (tx.zReportId || tx.zReportSequence) return;
         const terminalKey = normalizeTerminalId(tx.terminalId);
         if (!terminalKey) return;
         const existing = unresolvedByTerminal.get(terminalKey) || [];
         existing.push(tx);
         unresolvedByTerminal.set(terminalKey, existing);
      });

      unresolvedByTerminal.forEach((terminalTxs, terminalKey) => {
         const reports = reportsByTerminal.get(terminalKey);
         if (!reports || reports.length === 0) return;

         terminalTxs.sort((a, b) => (toTimestamp(a.date) || 0) - (toTimestamp(b.date) || 0));
         const pendingTxIds = new Set(terminalTxs.map(tx => tx.id));
         let previousClosedAt: number | null = null;

         reports.forEach((report) => {
            const closedAt = toTimestamp(report.closedAt);
            if (!closedAt) return;

            const openedAt = toTimestamp(report.openedAt);
            const explicitCount = explicitCountByReportId.get(report.id) || 0;
            const expectedCount = typeof report.transactionCount === 'number' ? report.transactionCount : 0;
            const missingCount = Math.max(expectedCount - explicitCount, 0);
            if (missingCount === 0) {
               previousClosedAt = closedAt;
               return;
            }

            const getCandidates = (lowerBound: number | null) => terminalTxs.filter((tx) => {
               if (!pendingTxIds.has(tx.id)) return false;
               const txDate = toTimestamp(tx.date);
               if (!txDate || txDate > closedAt) return false;
               if (lowerBound && txDate < lowerBound) return false;
               return true;
            });

            let candidates = getCandidates(openedAt ?? previousClosedAt);

            // Legacy rescue: if openedAt was saved too late, fall back to previous close boundary.
            if (candidates.length < missingCount && openedAt) {
               candidates = getCandidates(previousClosedAt);
            }

            candidates
               .sort((a, b) => (toTimestamp(b.date) || 0) - (toTimestamp(a.date) || 0))
               .slice(0, missingCount)
               .forEach((tx) => {
                  inferred.set(tx.id, report.sequenceNumber);
                  pendingTxIds.delete(tx.id);
               });

            previousClosedAt = closedAt;
         });
      });

      return inferred;
   }, [transactions, zReports]);

   const getStatusBadge = (tx: Transaction) => {
      if (tx.documentType === 'REFUND' || tx.ncfType === 'B04') {
         return <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-[10px] font-bold">DEVOLUCIÓN</span>;
      }
      if (tx.status === 'REFUNDED') return <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-[10px] font-bold">ANULADO</span>;
      if (tx.status === 'PARTIAL_REFUND') return <span className="px-2 py-0.5 bg-orange-100 text-orange-600 rounded-full text-[10px] font-bold">DEVUELTO</span>;
      if ((tx.pendingBalance || 0) > 0) return <span className="px-2 py-0.5 bg-amber-100 text-amber-600 rounded-full text-[10px] font-bold">PENDIENTE</span>;
      return <span className="px-2 py-0.5 bg-green-100 text-green-600 rounded-full text-[10px] font-bold">COMPLETADO</span>;
   };

   const getPaymentIcon = (method: string) => {
      switch (method?.toUpperCase()) {
         case 'CASH':
         case 'EFECTIVO': return <Banknote size={14} className="text-green-600" />;
         case 'CARD':
         case 'TARJETA': return <CreditCard size={14} className="text-blue-600" />;
         case 'CREDIT':
         case 'CRÉDITO':
         case 'CREDITO':
         case 'PENDIENTE': return <CreditCard size={14} className="text-cyan-600" />;
         case 'TRANSFER':
         case 'TRANSFERENCIA': return <Wallet size={14} className="text-purple-600" />;
         default: return <DollarSign size={14} className="text-gray-400" />;
      }
   };

   return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
         <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
               <thead className="bg-gray-50 sticky top-0 z-10 border-b border-gray-100">
                  <tr>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest">Estado</th>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest">Folio</th>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest">Fecha / Hora</th>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest">Cliente</th>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest text-center">Pago</th>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest text-center">Cierre</th>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest text-right">Total</th>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest text-right"></th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-gray-50">
                  {transactions.map((tx) => {
                     const inferredZSeq = inferredZByTxId.get(tx.id);
                     const zSeq = tx.zReportSequence || (tx.zReportId ? zReportMap?.get(tx.zReportId) : null) || inferredZSeq;
                     const displayNcf = getFiscalDisplayNcf(tx);
                     const openDetail = () => onRowClick(tx.id);
                     return (
                        <tr
                           key={tx.id}
                           onClick={openDetail}
                           className={`transition-colors cursor-pointer group ${tx.documentType === 'REFUND' || tx.status === 'REFUNDED' || tx.status === 'PARTIAL_REFUND'
                              ? 'bg-red-50/50 hover:bg-red-100/50'
                              : 'hover:bg-gray-50'
                              }`}
                           style={{ touchAction: 'manipulation' }}
                        >
                           <td className="px-4 py-3" onClick={openDetail}>{getStatusBadge(tx)}</td>
                           <td className="px-4 py-3" onClick={openDetail}>
                              <p className="text-xs font-medium text-gray-500">{tx.displayId || tx.id.slice(-8).toUpperCase()}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                 <span className="text-[10px] font-bold text-gray-400">
                                    {displayNcf || 'Sin NCF'}
                                 </span>
                                 <FiscalSyncBadge transaction={tx} compact />
                                 {reviewedTransactionIds.has(tx.id) && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase text-amber-700">
                                       <Flag size={10} /> Revisión
                                    </span>
                                 )}
                              </div>
                           </td>
                           <td className="px-4 py-3" onClick={openDetail}>
                              <p className="font-bold text-gray-800">{new Date(tx.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                              <p className="text-[10px] text-gray-400 font-medium">{new Date(tx.date).toLocaleDateString()}</p>
                           </td>
                           <td className="px-4 py-3" onClick={openDetail}>
                              {tx.customerName && tx.customerName !== 'null' ? (
                                 <p className="font-bold text-gray-700">{tx.customerName}</p>
                              ) : (
                                 <p className="text-gray-400 italic">Cliente General</p>
                              )}
                           </td>
                           <td className="px-4 py-3 text-center" onClick={openDetail}>
                              <div className="flex justify-center">
                                 {getPaymentIcon(tx.payments?.[0]?.method || 'CASH')}
                              </div>
                           </td>
                           <td className="px-4 py-3 text-center" onClick={openDetail}>
                              {zSeq ? (
                                 <span
                                    title={!tx.zReportId && !tx.zReportSequence && inferredZSeq ? 'Cierre Z inferido por ventana horaria' : undefined}
                                    className="px-2 py-1 bg-purple-100 text-purple-700 rounded-lg text-[10px] font-bold border border-purple-200"
                                 >
                                    {zSeq}
                                 </span>
                              ) : tx.zReportId ? (
                                 <span
                                    title={`ID: ${tx.zReportId}`}
                                    className="px-2 py-1 bg-gray-100 text-gray-500 rounded-lg text-[10px] font-bold border border-gray-200 cursor-help"
                                 >
                                    {tx.zReportId.slice(0, 8)}...
                                 </span>
                              ) : (
                                 <span className="text-gray-300 text-[10px]">•</span>
                              )}
                           </td>
                           <td className="px-4 py-3 text-right font-mono font-bold text-gray-900" onClick={openDetail}>
                              {config.currencySymbol}{tx.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                           </td>
                           <td className="px-4 py-3 text-right">
                              <button
                                 onClick={(event) => {
                                    event.stopPropagation();
                                    openDetail();
                                 }}
                                 className="p-1 hover:bg-gray-200 rounded-md transition-colors text-gray-400"
                              >
                                 <MoreVertical size={16} />
                              </button>
                           </td>
                        </tr>
                     );
                  })}
               </tbody>
            </table>
         </div>
      </div>
   );
};

const TicketDetailDrawer: React.FC<{
   tx: Transaction | null;
   config: BusinessConfig;
   onClose: () => void;
   onPrint: (tx: Transaction) => void;
   onRequestRefund: (tx: Transaction) => void;
   onRequestGatewayRefund: (tx: Transaction) => void;
   onRetryFiscalDocument?: (tx: Transaction) => Promise<string>;
   customers?: Customer[];
   onCorrectFiscalDocument?: (tx: Transaction, correction: FiscalDocumentCorrectionInput) => Promise<Transaction>;
   reviewFlags: InvoiceReviewFlag[];
   onSendEmail: (tx: Transaction, email: string) => Promise<ReceiptEmailResult>;
   onFlagForReview: (tx: Transaction, input: {
      category: InvoiceReviewFlag['category'];
      priority: InvoiceReviewPriority;
      comment: string;
   }) => Promise<InvoiceReviewFlag>;
   themeText: string;
   themeBg: string;
   users: User[];
}> = ({ tx, config, onClose, onPrint, onRequestRefund, onRequestGatewayRefund, onRetryFiscalDocument, customers = [], onCorrectFiscalDocument, reviewFlags, onSendEmail, onFlagForReview, themeText, themeBg, users }) => {
   const [isRetryingFiscal, setIsRetryingFiscal] = useState(false);
   const [retryFeedback, setRetryFeedback] = useState<string | null>(null);
   const [isCorrectionOpen, setIsCorrectionOpen] = useState(false);
   const [correctionFiscalCode, setCorrectionFiscalCode] = useState<'E31' | 'E32'>('E32');
   const [correctionCustomerId, setCorrectionCustomerId] = useState('');
   const [correctionReason, setCorrectionReason] = useState('');
   const [shouldRecalculateTaxes, setShouldRecalculateTaxes] = useState(true);
   const [isCorrectingFiscal, setIsCorrectingFiscal] = useState(false);
   const [correctionFeedback, setCorrectionFeedback] = useState<string | null>(null);
   const [isEmailOpen, setIsEmailOpen] = useState(false);
   const [email, setEmail] = useState('');
   const [isSendingEmail, setIsSendingEmail] = useState(false);
   const [emailFeedback, setEmailFeedback] = useState<string | null>(null);
   const [isReviewOpen, setIsReviewOpen] = useState(false);
   const [reviewCategory, setReviewCategory] = useState<InvoiceReviewFlag['category']>('OTHER');
   const [reviewPriority, setReviewPriority] = useState<InvoiceReviewPriority>('NORMAL');
   const [reviewComment, setReviewComment] = useState('');
   const [isSavingReview, setIsSavingReview] = useState(false);
   const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);

   if (!tx) return null;
   const cashierName = tx.userName || users.find(u => u.id === tx.userId)?.name || 'Sistema';
   const supervisorName = tx.authorizedByName || users.find(u => u.id === tx.authorizedById)?.name || null;
   const payments = Array.isArray(tx.payments) ? tx.payments : [];
   const baseCurrency = config.currencies?.find(currency => currency.isBase) || config.currencies?.[0] || { code: 'DOP', symbol: config.currencySymbol || 'RD$' };
   const paymentSettlement = buildPaymentSettlementSummary(payments as PaymentEntry[], Math.abs(Number(tx.total || 0)), baseCurrency.code);
   const paymentLineById = new Map(paymentSettlement.lines.map(line => [line.paymentId, line]));
   const isRefundDoc = isRefundLikeTransaction(tx);
   const affectedInvoice = (tx.affectedInvoiceNumber || '').toString().trim();
   const affectedNCF = (tx.affectedNCF || '').toString().trim();
   const terminalConfig = config.terminals?.find(t => t.id === tx.terminalId)?.config;
   const fiscalSummary = calculateTransactionFiscalSummary(tx, config, { terminalConfig });
   const displayTaxBreakdown = consolidateTaxBreakdownForDisplay(fiscalSummary.taxBreakdown, config.taxes);
   const historyDiscountTotal = resolveHistoryDiscountTotal(tx);
   const historyTerminalName = resolveHistoryTerminalName(tx, config.terminals || []);
   const canRetryFiscal = canRetryFiscalTransaction(tx) && Boolean(onRetryFiscalDocument);
   const retryActionLabel = getFiscalRetryActionLabel(tx) || 'Reintentar envío';
   const canRequestGatewayRefund = !isRefundDoc && tx.status !== 'REFUNDED' && canOfferIntegratedGatewayAction(tx, config);
   const gatewayActionLabel = resolveIntegratedGatewayProvider(tx) === 'CARDNET' ? 'CardNET' : 'AZUL';
   const displayNcf = getFiscalDisplayNcf(tx);
   const displayFiscalCode = getFiscalDisplayCode(tx);
   const canCorrectFiscal = isElectronicFiscalTransaction(tx)
      && Boolean(onCorrectFiscalDocument)
      && (tx.fiscalSyncStatus === 'ERROR' || tx.fiscalSyncStatus === 'PENDING');
   const sortedCustomers = [...customers].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
   const selectedCorrectionCustomer = sortedCustomers.find(customer => customer.id === correctionCustomerId) || null;
   const selectedCustomerTaxDigits = (selectedCorrectionCustomer?.taxId || '').replace(/\D/g, '');
   const selectedCustomerHasValidTaxId = selectedCustomerTaxDigits.length === 9 || selectedCustomerTaxDigits.length === 11;
   const activeReviewFlags = reviewFlags.filter(flag => (
      flag.transactionId === tx.id && (flag.status === 'OPEN' || flag.status === 'IN_REVIEW')
   ));

   const openEmailDialog = () => {
      setEmail(tx.customerSnapshot?.email || '');
      setEmailFeedback(null);
      setIsEmailOpen(true);
   };

   const handleSendEmail = async () => {
      const normalizedEmail = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
         setEmailFeedback('Introduce un correo electrónico válido.');
         return;
      }
      setIsSendingEmail(true);
      setEmailFeedback(null);
      try {
         const result = await onSendEmail(tx, normalizedEmail);
         if (!result.success) {
            setEmailFeedback(result.message || 'No se pudo enviar la factura.');
            return;
         }
         setEmailFeedback(`Factura enviada a ${normalizedEmail}.`);
      } catch (error: any) {
         setEmailFeedback(error?.message || 'No se pudo enviar la factura.');
      } finally {
         setIsSendingEmail(false);
      }
   };

   const openReviewDialog = () => {
      setReviewCategory('OTHER');
      setReviewPriority('NORMAL');
      setReviewComment('');
      setReviewFeedback(null);
      setIsReviewOpen(true);
   };

   const handleFlagForReview = async () => {
      if (!reviewComment.trim()) {
         setReviewFeedback('Indica el motivo de la revisión.');
         return;
      }
      setIsSavingReview(true);
      setReviewFeedback(null);
      try {
         await onFlagForReview(tx, {
            category: reviewCategory,
            priority: reviewPriority,
            comment: reviewComment.trim(),
         });
         setIsReviewOpen(false);
      } catch (error: any) {
         setReviewFeedback(error?.message || 'No se pudo marcar la factura.');
      } finally {
         setIsSavingReview(false);
      }
   };

   const handleRetryFiscal = async () => {
      if (!tx || !onRetryFiscalDocument || !canRetryFiscal) return;

      setIsRetryingFiscal(true);
      setRetryFeedback(null);
      try {
         const message = await onRetryFiscalDocument(tx);
         setRetryFeedback(message);
      } catch (error: any) {
         console.error('❌ Error retrying fiscal document:', error);
         setRetryFeedback(error?.message || 'No se pudo iniciar el reintento fiscal.');
      } finally {
         setIsRetryingFiscal(false);
      }
   };

   const openFiscalCorrection = () => {
      const currentCode = displayFiscalCode === 'E31' || displayFiscalCode === 'E32' ? displayFiscalCode : 'E32';
      setCorrectionFiscalCode(currentCode);
      setCorrectionCustomerId(tx.customerId || '');
      setCorrectionReason('');
      setShouldRecalculateTaxes(true);
      setCorrectionFeedback(null);
      setIsCorrectionOpen(true);
   };

   const handleApplyFiscalCorrection = async () => {
      if (!tx || !onCorrectFiscalDocument || !canCorrectFiscal) return;
      const reason = correctionReason.trim();
      if (!reason) {
         setCorrectionFeedback('Indica el motivo de la corrección.');
         return;
      }
      if (correctionFiscalCode === 'E31' && (!selectedCorrectionCustomer || !selectedCustomerHasValidTaxId)) {
         setCorrectionFeedback('Para E31 selecciona un cliente con RNC/Cédula válido.');
         return;
      }

      setIsCorrectingFiscal(true);
      setCorrectionFeedback(null);
      try {
         await onCorrectFiscalDocument(tx, {
            fiscalCode: correctionFiscalCode,
            customerId: correctionCustomerId || undefined,
            reason,
            recalculateTaxes: shouldRecalculateTaxes
         });
         setIsCorrectionOpen(false);
         setRetryFeedback('Corrección aplicada. Reintenta el envío fiscal.');
      } catch (error: any) {
         console.error('❌ Error correcting fiscal document:', error);
         setCorrectionFeedback(error?.message || 'No se pudo corregir el e-CF.');
      } finally {
         setIsCorrectingFiscal(false);
      }
   };

   const getPaymentMethodLabel = (payment: any): string => {
      const method = (payment?.method || '').toString().toUpperCase();
      if (payment?.methodLabel) return payment.methodLabel;
      switch (method) {
         case 'CASH':
         case 'EFECTIVO': return 'Efectivo';
         case 'CARD':
         case 'TARJETA': return 'Tarjeta';
         case 'QR': return 'QR / Digital';
         case 'TRANSFER':
         case 'TRANSFERENCIA': return 'Transferencia';
         case 'WALLET': return 'Wallet';
         case 'CREDIT':
         case 'CREDITO':
         case 'CRÉDITO':
         case 'PENDIENTE': return 'Crédito';
         case 'ADVANCE':
         case 'ANTICIPO': return 'Anticipo';
         default: return payment?.method || 'Otro';
      }
   };

   const getPaymentMethodIcon = (method?: string) => {
      const normalized = (method || '').toUpperCase();
      switch (normalized) {
         case 'CASH':
         case 'EFECTIVO': return <Banknote size={14} className="text-green-600" />;
         case 'CARD':
         case 'TARJETA': return <CreditCard size={14} className="text-blue-600" />;
         case 'QR': return <QrCode size={14} className="text-indigo-600" />;
         case 'TRANSFER':
         case 'TRANSFERENCIA': return <Wallet size={14} className="text-purple-600" />;
         case 'CREDIT':
         case 'CREDITO':
         case 'CRÉDITO':
         case 'PENDIENTE': return <CreditCard size={14} className="text-cyan-600" />;
         default: return <DollarSign size={14} className="text-gray-400" />;
      }
   };

   return (
      <div className="fixed inset-0 z-[100] overflow-hidden">
         <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
         <div className="absolute inset-y-0 right-0 max-w-md w-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            <header className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50">
               <div>
                  <h3 className="text-lg font-black text-gray-900">Detalle de Ticket</h3>
                  <p className="text-xs text-gray-400 font-medium tracking-wider">#{tx.displayId || tx.id}</p>
               </div>
               <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-all">
                  <X size={20} className="text-gray-500" />
               </button>
            </header>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
               <section className="space-y-4">
                  <div className="flex justify-between items-start p-4 rounded-2xl bg-gray-50 border border-gray-100">
                     <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Total Venta</p>
                        <p className="text-3xl font-black text-gray-900">{config.currencySymbol}{tx.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                     </div>
                     <div className="text-right">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Estado</p>
                        <div className="mt-1 flex items-center gap-2">
                           {tx.status === 'REFUNDED' ? (
                              <span className="bg-red-100 text-red-600 px-3 py-1 rounded-full text-xs font-black italic">ANULADO</span>
                           ) : tx.status === 'PARTIAL_REFUND' ? (
                              <span className="bg-orange-100 text-orange-600 px-3 py-1 rounded-full text-xs font-black">DEVUELTO</span>
                           ) : (tx.pendingBalance || 0) > 0 ? (
                              <span className="bg-amber-100 text-amber-600 px-3 py-1 rounded-full text-xs font-black">PENDIENTE</span>
                           ) : (
                              <span className="bg-green-100 text-green-600 px-3 py-1 rounded-full text-xs font-black">PAGADO</span>
                           )}
                        </div>
                     </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                     <div className="p-3 bg-white border border-gray-100 rounded-xl">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Fecha / Hora</p>
                        <p className="text-xs font-bold text-gray-700">{new Date(tx.date).toLocaleString()}</p>
                     </div>
                     <div className="p-3 bg-white border border-gray-100 rounded-xl">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Cajero</p>
                        <p className="text-xs font-bold text-gray-700">{cashierName}</p>
                     </div>
                  </div>
               </section>

               <section>
                  <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-3">Artículos del Ticket</h4>
                  <div className="space-y-2">
                     {tx.items.map((item, i) => (
                        <div key={i} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                           <div className="flex-1">
                              <p className="text-sm font-bold text-gray-800">{item.name}</p>
                              <p className="text-xs text-gray-400 font-medium">{item.quantity} x {config.currencySymbol}{item.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                           </div>
                           <p className="text-sm font-black text-gray-900">{config.currencySymbol}{(item.price * item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                     ))}
                  </div>
               </section>

               <section className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 space-y-2">
                  <div className="flex justify-between text-xs font-medium text-blue-600/60 uppercase tracking-wider">
                     <span>Subtotal</span>
                     <span>{config.currencySymbol}{fiscalSummary.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  {historyDiscountTotal > 0 && (
                     <div className="flex justify-between text-xs font-bold text-rose-600 uppercase tracking-wider">
                        <span>Descuento</span>
                        <span>-{config.currencySymbol}{historyDiscountTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                     </div>
                  )}
                  {displayTaxBreakdown.length > 0 ? (
                     displayTaxBreakdown.map((tax) => (
                        <div key={`${tx.id}-${tax.id}`} className="flex justify-between text-xs font-medium text-blue-600/60 uppercase tracking-wider">
                           <span>{formatTaxLineLabel(tax)}</span>
                           <span>{config.currencySymbol}{Number(tax.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                     ))
                  ) : (
                     <div className="flex justify-between text-xs font-medium text-blue-600/60 uppercase tracking-wider">
                        <span>Impuestos</span>
                        <span>{config.currencySymbol}{fiscalSummary.taxTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                     </div>
                  )}
                  <div className="flex justify-between text-lg font-black text-blue-900 border-t border-blue-100 pt-2 mt-2">
                     <span>Total Final</span>
                     <span>{config.currencySymbol}{fiscalSummary.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
               </section>

               <section className="bg-white p-4 rounded-2xl border border-gray-100 space-y-4">
                  <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Auditoría de Cobro</h4>

                  <div className="grid grid-cols-2 gap-3">
                     <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Cobrado por</p>
                        <p className="text-xs font-bold text-gray-800 truncate">{cashierName}</p>
                     </div>
                     <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Hora Cobro</p>
                        <p className="text-xs font-bold text-gray-800">{new Date(tx.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
                     </div>
                     <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Terminal</p>
                        <p className="text-xs font-bold text-gray-800">{historyTerminalName}</p>
                     </div>
                     <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">NCF</p>
                        <p className="text-xs font-bold text-gray-800 truncate">{displayNcf || 'Sin NCF'}</p>
                     </div>
                     <div className="col-span-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                           <div>
                              <p className="text-[10px] font-bold text-slate-400 uppercase">Estado Fiscal</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                 <FiscalSyncBadge transaction={tx} />
                                 {displayFiscalCode && (
                                    <span className="px-2 py-1 rounded-full bg-white border border-slate-200 text-[10px] font-black text-slate-600">
                                       {displayFiscalCode}
                                    </span>
                                 )}
                                 {tx.fiscalProvider && tx.fiscalProvider !== 'NONE' && (
                                    <span className="px-2 py-1 rounded-full bg-white border border-slate-200 text-[10px] font-black text-slate-600">
                                       {tx.fiscalProvider}
                                    </span>
                                 )}
                              </div>
                           </div>
                           {tx.fiscalSyncedAt && (
                              <div className="text-right">
                                 <p className="text-[10px] font-bold text-slate-400 uppercase">Última actualización</p>
                                 <p className="text-xs font-bold text-slate-700">{new Date(tx.fiscalSyncedAt).toLocaleString()}</p>
                              </div>
                           )}
                        </div>
                        {tx.fiscalReferenceId && (
                           <p className="mt-3 text-[11px] font-bold text-slate-500">
                              Referencia proveedor: {tx.fiscalReferenceId}
                           </p>
                        )}
                        {tx.fiscalResponseMessage && (
                           <p className={`mt-2 text-[11px] ${tx.fiscalSyncStatus === 'ERROR' ? 'text-red-600' : 'text-slate-500'}`}>
                              {tx.fiscalResponseMessage}
                           </p>
                        )}
                        {(canRetryFiscal || canCorrectFiscal) && (
                           <div className="mt-3 flex flex-wrap items-center gap-3">
                              {canRetryFiscal && (
                                 <button
                                    onClick={handleRetryFiscal}
                                    disabled={isRetryingFiscal}
                                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                 >
                                    <RotateCcw size={12} />
                                    {isRetryingFiscal ? 'Procesando...' : retryActionLabel}
                                 </button>
                              )}
                              {canCorrectFiscal && (
                                 <button
                                    onClick={openFiscalCorrection}
                                    className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-black text-amber-700 hover:bg-amber-100"
                                 >
                                    <FileText size={12} />
                                    Corregir e-CF
                                 </button>
                              )}
                              {retryFeedback && (
                                 <p className="text-[11px] font-bold text-slate-500">{retryFeedback}</p>
                              )}
                           </div>
                        )}
                     </div>
                     {isRefundDoc && (
                        <div className="p-3 bg-red-50/60 rounded-xl border border-red-100">
                           <p className="text-[10px] font-bold text-red-400 uppercase">Factura afectada</p>
                           <p className="text-xs font-bold text-red-800 truncate">{affectedInvoice || 'No disponible'}</p>
                        </div>
                     )}
                     {isRefundDoc && (
                        <div className="p-3 bg-red-50/60 rounded-xl border border-red-100">
                           <p className="text-[10px] font-bold text-red-400 uppercase">NCF afectado</p>
                           <p className="text-xs font-bold text-red-800 truncate">{affectedNCF || 'No disponible'}</p>
                        </div>
                     )}
                  </div>

                  {supervisorName && (
                     <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Autorizado por</p>
                        <p className="text-xs font-bold text-gray-800 truncate">{supervisorName}</p>
                     </div>
                  )}

                           <div className="rounded-xl border border-gray-100 overflow-hidden">
                     <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Formas de Pago</p>
                     </div>
                     <div className="p-3 space-y-2">
                        {payments.length === 0 ? (
                           <p className="text-xs text-gray-400 italic">Sin información de pagos</p>
                        ) : (
                           payments.map((payment: any, index: number) => {
                              const settlementLine = paymentLineById.get(payment?.id);
                              const gatewayProviderLabel = resolveGatewayProviderLabel(payment);
                              const gatewayAuthorizationCode = resolveGatewayAuthorizationCode(payment);
                              const gatewayReference = resolveGatewayReferenceNumber(payment);
                              const showAzulRefs =
                                 Boolean(gatewayProviderLabel) ||
                                 Boolean(gatewayAuthorizationCode) ||
                                 Boolean(gatewayReference);
                              const paymentCurrencyCode = settlementLine?.currencyCode || payment?.currencyCode || baseCurrency.code;
                              const paymentCurrencySymbol = resolveCurrencySymbol(config, paymentCurrencyCode, config.currencySymbol);
                              const receivedOriginal = settlementLine?.receivedOriginal ?? Number(payment?.amountOriginal || payment?.amount || 0);
                              const receivedBase = settlementLine?.receivedBase ?? Number(payment?.amount || 0);
                              const appliedBase = settlementLine?.appliedBase ?? Number(payment?.appliedAmount || payment?.amount || 0);
                              const changeBase = settlementLine?.changeBase ?? Number(payment?.changeAmount || 0);
                              const exchangeRate = settlementLine?.exchangeRate ?? Number(payment?.exchangeRate || 1);
                              return (
                                 <div
                                    key={`${tx.id}-payment-${index}`}
                                    className="rounded-lg bg-white border border-gray-100 overflow-hidden"
                                 >
                                    <div className="flex items-center justify-between px-3 py-2">
                                       <div className="flex items-center gap-2">
                                          {getPaymentMethodIcon(payment?.method)}
                                          <span className="text-xs font-bold text-gray-700">{getPaymentMethodLabel(payment)}</span>
                                       </div>
                                       <span className="text-xs font-black text-gray-900">
                                          {config.currencySymbol}{appliedBase.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                       </span>
                                    </div>
                                    {(paymentCurrencyCode !== baseCurrency.code || changeBase > 0.009 || showAzulRefs) ? (
                                       <div className="px-3 pb-2 pt-2 space-y-1 border-t border-gray-50 bg-gray-50/50">
                                          {paymentCurrencyCode !== baseCurrency.code ? (
                                             <>
                                                <p className="text-[11px] text-gray-700">
                                                   <span className="font-semibold text-gray-500">Recibido:</span>{' '}
                                                   {paymentCurrencySymbol}{receivedOriginal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </p>
                                                <p className="text-[11px] text-gray-700">
                                                   <span className="font-semibold text-gray-500">Tasa:</span>{' '}
                                                   {config.currencySymbol}{exchangeRate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </p>
                                             </>
                                          ) : null}
                                          {(paymentCurrencyCode !== baseCurrency.code || Math.abs(receivedBase - appliedBase) > 0.009) ? (
                                             <p className="text-[11px] text-gray-700">
                                                <span className="font-semibold text-gray-500">Equivalente:</span>{' '}
                                                {config.currencySymbol}{receivedBase.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                             </p>
                                          ) : null}
                                          {changeBase > 0.009 ? (
                                             <p className="text-[11px] text-gray-700">
                                                <span className="font-semibold text-gray-500">Cambio:</span>{' '}
                                                {config.currencySymbol}{changeBase.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                             </p>
                                          ) : null}
                                          {gatewayProviderLabel ? (
                                             <p className="text-[11px] text-gray-700">
                                                <span className="font-semibold text-gray-500">Procesador:</span>{' '}
                                                <span className="font-mono">{gatewayProviderLabel}</span>
                                             </p>
                                          ) : null}
                                          {gatewayAuthorizationCode ? (
                                             <p className="text-[11px] text-gray-700">
                                                <span className="font-semibold text-gray-500">AUT No.:</span>{' '}
                                                <span className="font-mono">{gatewayAuthorizationCode}</span>
                                             </p>
                                          ) : null}
                                          {gatewayReference ? (
                                             <p className="text-[11px] text-gray-700">
                                                <span className="font-semibold text-gray-500">Ref No.:</span>{' '}
                                                <span className="font-mono">{gatewayReference}</span>
                                             </p>
                                          ) : null}
                                       </div>
                                    ) : null}
                                 </div>
                              );
                           })
                        )}
                        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                           <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Total Aplicado</span>
                           <span className="text-sm font-black text-gray-900">{config.currencySymbol}{paymentSettlement.totalAppliedBase.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        {(paymentSettlement.hasForeignCurrency || paymentSettlement.totalChangeBase > 0.009 || Math.abs(paymentSettlement.totalReceivedBase - paymentSettlement.totalAppliedBase) > 0.009) && (
                           <>
                              <div className="flex items-center justify-between">
                                 <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Total Recibido</span>
                                 <span className="text-sm font-black text-gray-900">{config.currencySymbol}{paymentSettlement.totalReceivedBase.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </div>
                              {paymentSettlement.totalChangeBase > 0.009 ? (
                                 <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Cambio</span>
                                    <span className="text-sm font-black text-emerald-600">{config.currencySymbol}{paymentSettlement.totalChangeBase.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                 </div>
                              ) : null}
                           </>
                        )}
                     </div>
                  </div>
               </section>
            </div>

            {/* Actions Footer */}
            <footer className="p-6 border-t border-gray-100 bg-gray-50">
               <>
                  <div className="flex flex-wrap gap-3">
                     <button
                        onClick={openEmailDialog}
                        className="inline-flex h-9 flex-none items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-black text-blue-700 transition-colors hover:bg-blue-100"
                     >
                        <Mail size={15} /> Reenviar email
                     </button>
                     <button
                        onClick={openReviewDialog}
                        className="relative inline-flex h-9 flex-none items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-black text-amber-700 transition-colors hover:bg-amber-100"
                     >
                        <Flag size={15} /> Marcar revisión
                        {activeReviewFlags.length > 0 && (
                           <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-red-600 px-1 py-0.5 text-[9px] font-black leading-none text-white shadow-sm">
                              {activeReviewFlags.length}
                           </span>
                        )}
                     </button>
                     <button
                        onClick={() => onPrint(tx)}
                        className="flex min-w-[140px] flex-1 items-center justify-center gap-2 py-3 bg-white border border-gray-200 text-gray-700 rounded-2xl font-bold hover:bg-gray-100 transition-all shadow-sm"
                     >
                        <Printer size={18} /> Reimprimir
                     </button>
                     {tx.status !== 'REFUNDED' && (
                        <button
                           onClick={() => onRequestRefund(tx)}
                           className="flex min-w-[180px] flex-1 items-center justify-center gap-2 py-3 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-lg"
                        >
                           <RotateCcw size={18} /> Devolución / Anular
                        </button>
                     )}
                     {canRequestGatewayRefund && (
                        <button
                           onClick={() => onRequestGatewayRefund(tx)}
                           className="flex min-w-[180px] flex-1 items-center justify-center gap-2 py-3 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-lg"
                        >
                           <CreditCard size={18} /> Refund {gatewayActionLabel}
                        </button>
                     )}
                  </div>
               </>
            </footer>

            {isEmailOpen && (
               <div className="absolute inset-0 z-[120] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-slate-100 overflow-hidden">
                     <div className="p-4 border-b border-slate-100 flex items-start justify-between gap-3">
                        <div>
                           <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">Copia de factura</p>
                           <h4 className="text-base font-black text-slate-900">Enviar por correo</h4>
                           <p className="text-[11px] font-bold text-slate-400 mt-1">{tx.displayId || tx.id}</p>
                        </div>
                        <button onClick={() => setIsEmailOpen(false)} disabled={isSendingEmail} className="p-2 rounded-full hover:bg-slate-100 text-slate-400">
                           <X size={18} />
                        </button>
                     </div>
                     <div className="p-4 space-y-3">
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">Correo electrónico</label>
                        <input
                           type="email"
                           value={email}
                           onChange={event => setEmail(event.target.value)}
                           disabled={isSendingEmail}
                           placeholder="cliente@correo.com"
                           className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200"
                        />
                        {emailFeedback && (
                           <p className={`rounded-xl p-3 text-xs font-bold ${emailFeedback.startsWith('Factura enviada') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                              {emailFeedback}
                           </p>
                        )}
                     </div>
                     <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
                        <button onClick={() => setIsEmailOpen(false)} disabled={isSendingEmail} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 disabled:opacity-60">
                           Cerrar
                        </button>
                        <button onClick={handleSendEmail} disabled={isSendingEmail} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white disabled:opacity-60">
                           {isSendingEmail ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                           {isSendingEmail ? 'Enviando...' : 'Enviar'}
                        </button>
                     </div>
                  </div>
               </div>
            )}

            {isReviewOpen && (
               <div className="absolute inset-0 z-[120] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-100 overflow-hidden">
                     <div className="p-4 border-b border-slate-100 flex items-start justify-between gap-3">
                        <div>
                           <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">Control interno</p>
                           <h4 className="text-base font-black text-slate-900">Marcar para revisión</h4>
                           <p className="text-[11px] font-bold text-slate-400 mt-1">{tx.displayId || tx.id}</p>
                        </div>
                        <button onClick={() => setIsReviewOpen(false)} disabled={isSavingReview} className="p-2 rounded-full hover:bg-slate-100 text-slate-400">
                           <X size={18} />
                        </button>
                     </div>
                     <div className="p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                           <div>
                              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Categoría</label>
                              <select value={reviewCategory} onChange={event => setReviewCategory(event.target.value as InvoiceReviewFlag['category'])} disabled={isSavingReview} className="w-full rounded-xl border border-slate-200 px-3 py-3 text-xs font-bold">
                                 <option value="PAYMENT_METHOD_ERROR">Medio de pago</option>
                                 <option value="CUSTOMER_DATA">Datos del cliente</option>
                                 <option value="TIP">Propina</option>
                                 <option value="FISCAL">Fiscal</option>
                                 <option value="OTHER">Otro</option>
                              </select>
                           </div>
                           <div>
                              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Prioridad</label>
                              <select value={reviewPriority} onChange={event => setReviewPriority(event.target.value as InvoiceReviewPriority)} disabled={isSavingReview} className="w-full rounded-xl border border-slate-200 px-3 py-3 text-xs font-bold">
                                 <option value="LOW">Baja</option>
                                 <option value="NORMAL">Normal</option>
                                 <option value="HIGH">Alta</option>
                              </select>
                           </div>
                        </div>
                        <div>
                           <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Motivo</label>
                           <textarea value={reviewComment} onChange={event => setReviewComment(event.target.value)} disabled={isSavingReview} rows={4} maxLength={500} className="w-full resize-none rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-amber-200" placeholder="Describe la situación que debe revisar contabilidad o supervisión." />
                        </div>
                        {reviewFeedback && <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{reviewFeedback}</p>}
                     </div>
                     <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
                        <button onClick={() => setIsReviewOpen(false)} disabled={isSavingReview} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 disabled:opacity-60">Cancelar</button>
                        <button onClick={handleFlagForReview} disabled={isSavingReview} className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-white disabled:opacity-60">
                           {isSavingReview ? <Loader2 size={14} className="animate-spin" /> : <Flag size={14} />}
                           {isSavingReview ? 'Guardando...' : 'Marcar'}
                        </button>
                     </div>
                  </div>
               </div>
            )}

            {isCorrectionOpen && (
               <div className="absolute inset-0 z-[120] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-slate-100 overflow-hidden">
                     <div className="p-4 border-b border-slate-100 flex items-start justify-between gap-3">
                        <div>
                           <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">Corrección fiscal</p>
                           <h4 className="text-base font-black text-slate-900">Corregir e-CF pendiente</h4>
                           <p className="text-[11px] font-bold text-slate-400 mt-1">{displayNcf || tx.displayId}</p>
                        </div>
                        <button
                           onClick={() => setIsCorrectionOpen(false)}
                           className="p-2 rounded-full hover:bg-slate-100 text-slate-400"
                           disabled={isCorrectingFiscal}
                        >
                           <X size={18} />
                        </button>
                     </div>

                     <div className="p-4 space-y-3">
                        <div>
                           <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Tipo e-CF</label>
                           <select
                              value={correctionFiscalCode}
                              onChange={(event) => setCorrectionFiscalCode(event.target.value as 'E31' | 'E32')}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                              disabled={isCorrectingFiscal}
                           >
                              <option value="E32">{FISCAL_DOCUMENT_LABELS.E32}</option>
                              <option value="E31">{FISCAL_DOCUMENT_LABELS.E31}</option>
                           </select>
                        </div>

                        <div>
                           <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                              Cliente {correctionFiscalCode === 'E31' ? '(requerido)' : '(opcional)'}
                           </label>
                           <select
                              value={correctionCustomerId}
                              onChange={(event) => setCorrectionCustomerId(event.target.value)}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                              disabled={isCorrectingFiscal}
                           >
                              <option value="">Consumidor final / sin cliente</option>
                              {sortedCustomers.map(customer => (
                                 <option key={customer.id} value={customer.id}>
                                    {customer.name}{customer.taxId ? ` - ${customer.taxId}` : ''}
                                 </option>
                              ))}
                           </select>
                           {correctionFiscalCode === 'E31' && correctionCustomerId && !selectedCustomerHasValidTaxId && (
                              <p className="mt-1 text-[11px] font-bold text-red-600">El cliente seleccionado no tiene RNC/Cédula válido.</p>
                           )}
                        </div>

                        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                           <input
                              type="checkbox"
                              checked={shouldRecalculateTaxes}
                              onChange={(event) => setShouldRecalculateTaxes(event.target.checked)}
                              disabled={isCorrectingFiscal}
                           />
                           Recalcular totales fiscales e impuestos
                        </label>

                        <div>
                           <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Motivo</label>
                           <textarea
                              value={correctionReason}
                              onChange={(event) => setCorrectionReason(event.target.value)}
                              className="w-full min-h-[84px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 resize-none"
                              placeholder="Ej: Cliente sin RNC válido, corrección de tipo fiscal..."
                              disabled={isCorrectingFiscal}
                           />
                        </div>

                        {correctionFeedback && (
                           <p className="rounded-xl bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700">
                              {correctionFeedback}
                           </p>
                        )}
                     </div>

                     <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
                        <button
                           onClick={() => setIsCorrectionOpen(false)}
                           disabled={isCorrectingFiscal}
                           className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 disabled:opacity-60"
                        >
                           Cancelar
                        </button>
                        <button
                           onClick={handleApplyFiscalCorrection}
                           disabled={isCorrectingFiscal}
                           className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-white shadow-lg shadow-amber-500/20 disabled:opacity-60"
                        >
                           {isCorrectingFiscal ? 'Guardando...' : 'Aplicar corrección'}
                        </button>
                     </div>
                  </div>
               </div>
            )}
         </div>
      </div>
   );
};

const TicketHistory: React.FC<TicketHistoryProps> = ({ transactions, config, currentUser, onUpdateConfig, users, roles, onClose, activeTerminalId, onRefundTransaction, initialSelectedId, onRetryFiscalDocument, customers = [], onCorrectFiscalDocument }) => {
   const [searchTerm, setSearchTerm] = useState('');
   const [expandedId, setExpandedId] = useState<string | null>(null);
   const [showFilters, setShowFilters] = useState(false);

   // Filters State
   const [filterDateStart, setFilterDateStart] = useState('');
   const [filterDateEnd, setFilterDateEnd] = useState('');
   // ... (other state)

   // ... (keep loadHistory useEffect)

   // Handle Initial Selection (Smart Scan)
   useEffect(() => {
      if (initialSelectedId) {
         setSearchTerm(initialSelectedId); // Filter by ID
         setExpandedId(initialSelectedId); // Auto-expand details
         setSelectedTxId(initialSelectedId);
      }
   }, [initialSelectedId]);
   const [filterTerminal, setFilterTerminal] = useState('');
   const [filterCashier, setFilterCashier] = useState('');
   const [filterCustomer, setFilterCustomer] = useState('');
   const [filterNcfType, setFilterNcfType] = useState('');
   const [filterPaymentMethod, setFilterPaymentMethod] = useState('');
   const [filterReviewOnly, setFilterReviewOnly] = useState(false);

   // Return Mode State
   const [returnModeId, setReturnModeId] = useState<string | null>(null);
   // Map of cartId -> quantity to return
   const [selectedItemsQty, setSelectedItemsQty] = useState<Map<string, number>>(new Map());
   const [returnReason, setReturnReason] = useState<ReturnReason>('ERROR');

   // Gift Receipt State
   const [giftReceiptTx, setGiftReceiptTx] = useState<Transaction | null>(null);

   const [historyTransactions, setHistoryTransactions] = useState<Transaction[]>([]);
   const [zReportMap, setZReportMap] = useState<Map<string, string>>(new Map()); // Map zReportId -> Sequence
   const [zReports, setZReports] = useState<ZReport[]>([]);
   const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
   const [reviewFlags, setReviewFlags] = useState<InvoiceReviewFlag[]>([]);

   // Refund Modal State
   const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
   const [refundTx, setRefundTx] = useState<Transaction | null>(null);
   const [refundRequestMode, setRefundRequestMode] = useState<RefundRequestMode>('STANDARD');
   const [gatewayProgress, setGatewayProgress] = useState<GatewayProgressOverlayState | null>(null);
   const [erpSearchLoading, setErpSearchLoading] = useState(false);
   const [erpSearchError, setErpSearchError] = useState<string | null>(null);
   const [erpMatches, setErpMatches] = useState<ErpRefundSourceMatch[]>([]);
   const allKnownTransactions = useMemo(
      () => Array.from(new Map([...historyTransactions, ...transactions].map(transaction => [transaction.id, transaction])).values()),
      [historyTransactions, transactions]
   );
   const refundRemainingQuantities = useMemo(
      () => refundTx
         ? (refundTx.erpRefundSource
            ? getErpRemainingQuantities(refundTx)
            : getRemainingRefundQuantities(refundTx, allKnownTransactions))
         : new Map<string, number>(),
      [allKnownTransactions, refundTx]
   );

   const normalizeTerminalKey = (value?: unknown) => String(value || '').trim().toLowerCase();

   const resolveTerminalLabel = (terminal: any, fallback?: string) => {
      const candidates = [
         terminal?.config?.terminalName,
         terminal?.config?.erpBinding?.terminalName,
         terminal?.name,
         terminal?.config?.stationNumber,
         fallback,
         terminal?.id,
      ].map(value => String(value || '').trim()).filter(Boolean);
      return candidates[0] || 'Terminal';
   };

   const resolveTerminalAliases = (terminal: any) => [
      terminal?.id,
      terminal?.name,
      terminal?.config?.terminalName,
      terminal?.config?.stationNumber,
      terminal?.config?.erpTerminalId,
      terminal?.config?.erpBinding?.terminalId,
      terminal?.config?.erpBinding?.terminalName,
      (terminal?.config as any)?.terminalId,
      (terminal?.config as any)?.localTerminalId,
   ].map(value => String(value || '').trim()).filter(Boolean);

   const terminalFilterOptions = useMemo(() => {
      const options = new Map<string, { value: string; label: string; aliases: string[] }>();

      (config.terminals || []).forEach((terminal: any) => {
         const aliases = resolveTerminalAliases(terminal);
         const value = String(terminal?.id || aliases[0] || '').trim();
         if (!value) return;
         options.set(value, {
            value,
            label: resolveTerminalLabel(terminal, value),
            aliases: Array.from(new Set([value, ...aliases])),
         });
      });

      [...transactions, ...historyTransactions].forEach((tx) => {
         const value = String(tx?.terminalId || '').trim();
         if (!value) return;
         const matching = Array.from(options.values()).find(option =>
            option.aliases.some(alias => normalizeTerminalKey(alias) === normalizeTerminalKey(value))
         );
         if (matching) {
            matching.aliases = Array.from(new Set([...matching.aliases, value]));
            return;
         }
         options.set(value, { value, label: value, aliases: [value] });
      });

      return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
   }, [config.terminals, transactions, historyTransactions]);

   const terminalAliasesByValue = useMemo(() => {
      const map = new Map<string, Set<string>>();
      terminalFilterOptions.forEach(option => {
         map.set(option.value, new Set(option.aliases.map(normalizeTerminalKey).filter(Boolean)));
      });
      return map;
   }, [terminalFilterOptions]);

   const paymentMethodOptions = useMemo(() => {
      const defaults = [
         { value: 'CASH', label: 'Efectivo' },
         { value: 'CARD', label: 'Tarjeta' },
         { value: 'TRANSFER', label: 'Transferencia' },
         { value: 'CREDIT', label: 'Crédito' },
         { value: 'STORE_CREDIT', label: 'Crédito a favor' },
      ];
      const byValue = new Map<string, { value: string; label: string }>();
      const aliases: Record<string, string> = {
         EFECTIVO: 'CASH',
         CASH: 'CASH',
         TARJETA: 'CARD',
         CARD: 'CARD',
         CREDIT_CARD: 'CARD',
         TRANSFERENCIA: 'TRANSFER',
         TRANSFER: 'TRANSFER',
         CREDITO: 'CREDIT',
         CRÉDITO: 'CREDIT',
         CREDIT: 'CREDIT',
      };
      const addOption = (rawValue: unknown, rawLabel?: unknown) => {
         const normalized = String(rawValue || '').trim().toUpperCase();
         if (!normalized) return;
         const value = aliases[normalized] || normalized;
         if (byValue.has(value)) return;
         byValue.set(value, { value, label: String(rawLabel || rawValue || value).trim() });
      };
      defaults.forEach(option => addOption(option.value, option.label));
      (config.paymentMethods || []).forEach((method: any) => {
         addOption(method.id || method.type || method.name || method.label, method.label || method.name || method.type || method.id);
      });
      return Array.from(byValue.values());
   }, [config.paymentMethods]);

   const persistIntegrationAuditEvent = async (
      integration: PaymentIntegrationDefinition,
      eventInput: Parameters<typeof createPaymentIntegrationAuditEvent>[1]
   ) => {
      const nextConfig = await dispatchAuditEventConfigUpdate(
         config,
         integration.id,
         createPaymentIntegrationAuditEvent(integration, eventInput)
      );

      if (nextConfig) {
         onUpdateConfig(nextConfig);
      }
   };

   const handlePrintTransaction = async (transaction: Transaction) => {
      const gatewayPayments = (transaction.payments || []).filter((payment: any) =>
         payment?.gatewayProvider && (payment?.gatewayReceiptMerchant || payment?.gatewayReceiptClient)
      );

      if (gatewayPayments.length === 0) {
         await printTicket(transaction, config);
         return;
      }

      const printResult = await printIntegratedPaymentArtifacts(transaction, config);
      if (printResult.voucherCopiesFailed.length > 0) {
         alert(`No se pudo imprimir automáticamente: ${printResult.voucherCopiesFailed.join(', ')}.`);
      }
   };

   // Load History on Mount
   useEffect(() => {
      const loadHistory = async () => {
         try {
            const { db } = await import('../utils/db');
            const [activeTransactions, archivedTransactions, wallets, walletTxns, customers, storedReviewFlags] = await Promise.all([
               db.get('transactions') as Promise<Transaction[]>,
               db.get('transactionHistory') as Promise<Transaction[]>,
               db.get('wallets' as any) as Promise<any[]>,
               db.get('wallet_transactions' as any) as Promise<any[]>,
               db.get('customers') as Promise<any[]>,
               db.get('invoiceReviewFlags') as Promise<InvoiceReviewFlag[]>
            ]);
            setReviewFlags(Array.isArray(storedReviewFlags) ? storedReviewFlags : []);

            const toTimestamp = (value?: string) => {
               const ts = value ? new Date(value).getTime() : NaN;
               return Number.isFinite(ts) ? ts : 0;
            };

            const mergedMap = new Map<string, Transaction>();
            const mergedRows = [
               ...(Array.isArray(archivedTransactions) ? archivedTransactions : []),
               ...(Array.isArray(activeTransactions) ? activeTransactions : [])
            ];

            for (const tx of mergedRows) {
               if (!tx?.id) continue;
               const existing = mergedMap.get(tx.id);
               if (!existing) {
                  mergedMap.set(tx.id, tx);
                  continue;
               }
               const existingTs = Math.max(toTimestamp((existing as any).updatedAt), toTimestamp(existing.date));
               const nextTs = Math.max(toTimestamp((tx as any).updatedAt), toTimestamp(tx.date));
               if (nextTs >= existingTs) mergedMap.set(tx.id, tx);
            }

            // Fallback bridge for legacy gaps: surface wallet NC refs as refund records
            // when the refund transaction row is missing.
            const displayIdSet = new Set<string>();
            for (const tx of mergedMap.values()) {
               const key = typeof tx.displayId === 'string' ? tx.displayId.trim().toUpperCase() : '';
               if (key) displayIdSet.add(key);
            }

            const walletById = new Map<string, any>();
            for (const wallet of (wallets || [])) {
               if (wallet?.id) walletById.set(wallet.id, wallet);
            }

            const customerById = new Map<string, any>();
            for (const customer of (customers || [])) {
               if (customer?.id) customerById.set(customer.id, customer);
            }

            const isRefundDocument = (tx: Transaction): boolean => {
               const docType = typeof tx.documentType === 'string' ? tx.documentType.trim().toUpperCase() : '';
               const ncfType = typeof tx.ncfType === 'string' ? tx.ncfType.trim().toUpperCase() : '';
               const displayId = typeof tx.displayId === 'string' ? tx.displayId.trim().toUpperCase() : '';
               return docType === 'REFUND' || ncfType === 'B04' || displayId.startsWith('NC');
            };

            const toMillis = (value?: string): number => {
               const ts = value ? new Date(value).getTime() : NaN;
               return Number.isFinite(ts) ? ts : 0;
            };

            const salesCandidatesByCustomer = new Map<string, Transaction[]>();
            for (const tx of mergedMap.values()) {
               const customerId = typeof tx.customerId === 'string' ? tx.customerId.trim() : '';
               if (!customerId) continue;
               if (isRefundDocument(tx)) continue;
               const list = salesCandidatesByCustomer.get(customerId) || [];
               list.push(tx);
               salesCandidatesByCustomer.set(customerId, list);
            }

            const pickAffectedInvoice = (customerId: string, amount: number, movementDate: string): Transaction | null => {
               const candidates = salesCandidatesByCustomer.get(customerId) || [];
               if (candidates.length === 0) return null;

               const movementMs = toMillis(movementDate);
               let best: Transaction | null = null;
               let bestScore = Number.NEGATIVE_INFINITY;
               for (const candidate of candidates) {
                  let score = 0;
                  if (candidate.status === 'PARTIAL_REFUND' || candidate.status === 'REFUNDED') score += 40;
                  if ((Number(candidate.total) || 0) + 0.01 >= amount) score += 12;

                  const candidateMs = toMillis(candidate.date);
                  const diffMs = movementMs > 0 && candidateMs > 0
                     ? Math.abs(candidateMs - movementMs)
                     : Number.POSITIVE_INFINITY;
                  if (diffMs <= 24 * 60 * 60 * 1000) score += 20;
                  else if (diffMs <= 7 * 24 * 60 * 60 * 1000) score += 10;
                  else if (diffMs <= 30 * 24 * 60 * 60 * 1000) score += 4;

                  if (typeof candidate.ncf === 'string' && candidate.ncf.trim()) score += 5;
                  if (typeof candidate.displayId === 'string' && candidate.displayId.trim()) score += 3;

                  if (score > bestScore) {
                     best = candidate;
                     bestScore = score;
                  }
               }
               return best;
            };

            const extractB04NcfFromMovement = (movement: any): string | undefined => {
               const rawCandidates = [
                  movement?.ncf,
                  movement?.ncfB04,
                  movement?.fiscalNcf,
                  movement?.b04,
                  movement?.metadata?.ncf,
                  movement?.meta?.ncf
               ];
               for (const raw of rawCandidates) {
                  if (typeof raw !== 'string') continue;
                  const candidate = raw.trim().toUpperCase();
                  if (candidate.startsWith('B04')) return candidate;
               }
               return undefined;
            };

            for (const movement of (walletTxns || [])) {
               const ref = typeof movement?.referenceId === 'string' ? movement.referenceId.trim() : '';
               const refUpper = ref.toUpperCase();
               if (!refUpper.startsWith('NC')) continue;

               const amountNum = Number(movement?.amount);
               const amount = Number.isFinite(amountNum) && amountNum > 0 ? amountNum : 0;
               if (amount <= 0) continue;

               const wallet = walletById.get(movement?.walletId);
               const walletCustomerId = wallet?.customerId;
               if (!walletCustomerId) continue;
               const parsedMovementDate = typeof movement?.createdAt === 'string' ? new Date(movement.createdAt).getTime() : NaN;
               const movementDate = Number.isFinite(parsedMovementDate) ? String(movement.createdAt) : new Date().toISOString();
               const affectedSale = pickAffectedInvoice(String(walletCustomerId), amount, movementDate);
               const inferredAffectedInvoice = (affectedSale?.displayId || affectedSale?.id || '').toString().trim();
               const inferredAffectedNCF = (affectedSale?.ncf || '').toString().trim();
               const inferredNcf = extractB04NcfFromMovement(movement);

               if (displayIdSet.has(refUpper)) {
                  for (const [txId, currentTx] of mergedMap.entries()) {
                     const currentDisplay = typeof currentTx.displayId === 'string' ? currentTx.displayId.trim().toUpperCase() : '';
                     if (currentDisplay !== refUpper) continue;
                     if (!isRefundDocument(currentTx)) continue;

                     const patch: Partial<Transaction> = {};
                     if ((!currentTx.ncf || !currentTx.ncf.trim()) && inferredNcf) patch.ncf = inferredNcf;
                     if ((!currentTx.affectedInvoiceNumber || !currentTx.affectedInvoiceNumber.trim()) && inferredAffectedInvoice) {
                        patch.affectedInvoiceNumber = inferredAffectedInvoice;
                     }
                     if ((!currentTx.affectedNCF || !currentTx.affectedNCF.trim()) && inferredAffectedNCF) {
                        patch.affectedNCF = inferredAffectedNCF;
                     }
                     if (!currentTx.originalTransactionId && affectedSale?.id) patch.originalTransactionId = affectedSale.id;
                     if (Object.keys(patch).length === 0) continue;

                     mergedMap.set(txId, {
                        ...currentTx,
                        ...patch
                     });
                  }
                  continue;
               }

               const owner = customerById.get(walletCustomerId);

               const syntheticId = `WLT-NC-${movement?.id || ref}-${walletCustomerId}`;
               mergedMap.set(syntheticId, {
                  id: syntheticId,
                  displayId: ref,
                  documentType: 'REFUND',
                  date: movementDate,
                  items: [],
                  total: amount,
                  payments: [{ method: 'STORE_CREDIT', amount }],
                  userId: 'SYSTEM',
                  userName: 'Sistema',
                  terminalId: 'N/A',
                  status: 'REFUNDED',
                  customerId: walletCustomerId,
                  customerName: owner?.name,
                  ncf: inferredNcf,
                  ncfType: 'B04',
                  affectedInvoiceNumber: inferredAffectedInvoice || undefined,
                  affectedNCF: inferredAffectedNCF || undefined,
                  originalTransactionId: affectedSale?.id,
                  refundReason: 'NC registrada vía wallet',
                  syncStatus: 'COMPLETED'
               } as Transaction);

               displayIdSet.add(refUpper);
            }

            const markedHistory = Array.from(mergedMap.values()).map(h => ({ ...h, _isArchived: true }));
            setHistoryTransactions(markedHistory);

            const zReports = await db.get('zReports') as any[];
            if (zReports) {
               const map = new Map<string, string>();
               zReports.forEach(r => map.set(r.id, r.sequenceNumber));
               setZReportMap(map);
               setZReports(zReports);
            }
         } catch (e) {
            console.error("Failed to load history:", e);
         }
      };
      loadHistory();
   }, []);

   // Handle Initial Selection (Smart Scan)
   useEffect(() => {
      if (initialSelectedId) {
         setSearchTerm(initialSelectedId); // Filter by ID
         // Attempt to find it immediately if loaded
         // Note: We might need to wait for history to load, but filtering by ID usually works 
         // as filteredTransactions recomputes.
         setExpandedId(initialSelectedId); // Auto-expand details if we had inline details
         // For Drawer:
         setSelectedTxId(initialSelectedId);
      }
   }, [initialSelectedId]);

   // --- SMART SEARCH LOGIC ---
   const filteredTransactions = useMemo(() => {
      // Merge current transactions (props) with history
      // Deduplicate by ID: Prioritize props (active state) over history cache
      const uniqueMap = new Map<string, Transaction>();
      const businessMap = new Map<string, Transaction>();

      const toTimestamp = (value?: string) => {
         const ts = value ? new Date(value).getTime() : NaN;
         return Number.isFinite(ts) ? ts : 0;
      };

      // Merge preferring newest row (updatedAt/date), so stale transactionHistory
      // never overwrites a recent PARTIAL_REFUND from active transactions.
      [...historyTransactions, ...transactions].forEach((tx) => {
         if (!tx?.id) return;
         const existing = uniqueMap.get(tx.id);
         if (!existing) {
            uniqueMap.set(tx.id, tx);
            return;
         }

         const existingTs = Math.max(
            toTimestamp((existing as any).updatedAt),
            toTimestamp(existing.date)
         );
         const candidateTs = Math.max(
            toTimestamp((tx as any).updatedAt),
            toTimestamp(tx.date)
         );

         if (candidateTs >= existingTs) {
            uniqueMap.set(tx.id, tx);
         }
      });

      for (const tx of uniqueMap.values()) {
         const businessKey = typeof tx.displayId === 'string' && tx.displayId.trim().length > 0
            ? `DISPLAY:${tx.displayId.trim().toUpperCase()}`
            : `ID:${tx.id}`;
         const existing = businessMap.get(businessKey);
         if (!existing) {
            businessMap.set(businessKey, tx);
            continue;
         }

         const existingTs = Math.max(
            toTimestamp((existing as any).updatedAt),
            toTimestamp(existing.date)
         );
         const candidateTs = Math.max(
            toTimestamp((tx as any).updatedAt),
            toTimestamp(tx.date)
         );

         if (candidateTs >= existingTs) {
            businessMap.set(businessKey, tx);
         }
      }

      const isValidTicketRecord = (tx: any): boolean => {
         const rawId = typeof tx?.id === 'string' ? tx.id.trim() : '';
         const displayId = typeof tx?.displayId === 'string' ? tx.displayId.trim() : '';
         const documentType = typeof tx?.documentType === 'string' ? tx.documentType.trim().toUpperCase() : '';

         const hasDisplayId = displayId.length > 0;
         const isSalesDocument = documentType === 'TICKET' || documentType === 'REFUND';
         const isOpenTableOrder = rawId.startsWith('ORD-') && !hasDisplayId && !documentType;

         if (isOpenTableOrder) return false;
         return isSalesDocument || hasDisplayId;
      };

      let data = Array.from(businessMap.values())
         .filter(isValidTicketRecord)
         .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Newest first

      // 1. Apply Search Term / Predictive Tag
      const lowerTerm = searchTerm.toLowerCase().trim();
      if (lowerTerm) {
         if (lowerTerm === 'ayer' || lowerTerm === 'yesterday') {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            data = data.filter(t => new Date(t.date).toDateString() === yesterday.toDateString());
         } else if (lowerTerm === 'hoy' || lowerTerm === 'today') {
            const today = new Date();
            data = data.filter(t => new Date(t.date).toDateString() === today.toDateString());
         } else if (lowerTerm.startsWith('#')) {
            data = data.filter(t => (t.id || '').toLowerCase().includes(lowerTerm.replace('#', '')));
         } else {
            data = data.filter(t =>
               t.customerName?.toLowerCase().includes(lowerTerm) ||
               (t.userName || '').toLowerCase().includes(lowerTerm) ||
               (t.id || '').toLowerCase().includes(lowerTerm) ||
               t.displayId?.toLowerCase().includes(lowerTerm) ||
               t.total.toString().includes(lowerTerm)
            );
         }
      }

      // 2. Apply Dimensional Filters (Cumulative)
      if (filterDateStart) {
         const start = new Date(filterDateStart + 'T00:00:00');
         data = data.filter(t => new Date(t.date) >= start);
      }

      if (filterDateEnd) {
         const end = new Date(filterDateEnd + 'T23:59:59.999');
         data = data.filter(t => new Date(t.date) <= end);
      }

      if (filterTerminal) {
         const aliases = terminalAliasesByValue.get(filterTerminal) || new Set([normalizeTerminalKey(filterTerminal)]);
         data = data.filter(t => aliases.has(normalizeTerminalKey(t.terminalId)));
      }

      if (filterCashier) {
         const term = filterCashier.toLowerCase();
         data = data.filter(t =>
            t.userId === filterCashier ||
            (t.userName || '').toLowerCase().includes(term)
         );
      }

      if (filterCustomer) {
         const term = filterCustomer.toLowerCase();
         data = data.filter(t =>
            (t.customerId || '').toLowerCase().includes(term) ||
            (t.customerName || '').toLowerCase().includes(term)
         );
      }

      if (filterNcfType && filterNcfType !== 'ALL') {
         data = data.filter(t => t.ncf?.startsWith(filterNcfType) || String(t.ncfType || '').toUpperCase() === filterNcfType);
      }

      if (filterPaymentMethod && filterPaymentMethod !== 'ALL') {
         const expectedMethod = filterPaymentMethod.toUpperCase();
         const paymentAliases: Record<string, string> = {
            EFECTIVO: 'CASH',
            TARJETA: 'CARD',
            CREDIT_CARD: 'CARD',
            TRANSFERENCIA: 'TRANSFER',
            CREDITO: 'CREDIT',
            CRÉDITO: 'CREDIT',
         };
         data = data.filter(t => (t.payments || []).some((payment: any) => {
            const candidates = [
               payment?.method,
               payment?.methodId,
               payment?.methodLabel,
               payment?.type,
               payment?.gatewayProvider
            ].map(value => {
               const normalized = String(value || '').trim().toUpperCase();
               return paymentAliases[normalized] || normalized;
            }).filter(Boolean);
            return candidates.includes(expectedMethod);
         }));
      }

      if (filterReviewOnly) {
         const activeReviewIds = new Set(reviewFlags
            .filter(flag => flag.status === 'OPEN' || flag.status === 'IN_REVIEW')
            .map(flag => flag.transactionId));
         data = data.filter(transaction => activeReviewIds.has(transaction.id));
      }

      return data;
   }, [transactions, historyTransactions, searchTerm, filterDateStart, filterDateEnd, filterTerminal, filterCashier, filterCustomer, filterNcfType, filterPaymentMethod, filterReviewOnly, reviewFlags, terminalAliasesByValue]);

   // --- KPI CALCULATIONS ---
   const kpis = useMemo(() => {
      const totalSales = filteredTransactions.reduce((acc, tx) => {
         const isRefundDoc = tx.documentType === 'REFUND' || tx.ncfType === 'B04';
         return acc + (!isRefundDoc && tx.status !== 'REFUNDED' ? tx.total : 0);
      }, 0);
      const ticketCount = filteredTransactions.length;
      const avgTicket = ticketCount > 0 ? totalSales / ticketCount : 0;
      const refunds = filteredTransactions.reduce((acc, tx) => {
         const isCreditNoteOrRefundDoc = tx.documentType === 'REFUND' || tx.ncfType === 'B04';
         const isRefundStatus = tx.status === 'PARTIAL_REFUND';
         if (isCreditNoteOrRefundDoc || isRefundStatus) {
            return acc + tx.total;
         }
         return acc;
      }, 0);

      return { totalSales, ticketCount, avgTicket, refunds };
   }, [filteredTransactions]);

   const selectedTx = useMemo(() =>
      filteredTransactions.find(t => t.id === selectedTxId) || null
      , [filteredTransactions, selectedTxId]);

   // --- SUPERVISOR AUTH ---
   const { requestApproval, supervisorModalProps } = useSupervisorAuth({ config, currentUser, roles, onUpdateConfig });

   const requireCurrentUser = (): User => {
      if (!currentUser) throw new Error('Debes iniciar sesión para realizar esta acción.');
      return currentUser;
   };

   const handleSendInvoiceEmail = async (transaction: Transaction, email: string): Promise<ReceiptEmailResult> => {
      const actor = requireCurrentUser();
      let authorizedBy: User | undefined;
      const approved = await requestApproval({
         permission: 'POS_RESEND_INVOICE_EMAIL',
         actionDescription: 'Reenviar factura por correo electrónico',
         context: { ticketId: transaction.displayId || transaction.id },
         onAuthorized: supervisor => { authorizedBy = supervisor; },
      });
      if (!approved) throw new Error('La acción no fue autorizada.');

      const result = await sendReceiptEmailViaErp(
         buildReceiptEmailPayload(transaction, email, config, config.currencySymbol || 'RD$', users),
      );
      try {
         await recordInvoiceAuditEvent({
            transaction,
            eventType: result.success ? 'EMAIL_RESENT' : 'EMAIL_RESEND_FAILED',
            actor,
            authorizedBy,
            reason: result.message,
            metadata: {
               recipient: email,
               deliveryId: result.id,
               deliveryStatus: result.status,
            },
         });
      } catch (auditError) {
         console.error('No se pudo registrar la auditoría del reenvío de factura:', auditError);
      }
      return result;
   };

   const handleFlagInvoiceForReview = async (
      transaction: Transaction,
      input: {
         category: InvoiceReviewFlag['category'];
         priority: InvoiceReviewPriority;
         comment: string;
      },
   ): Promise<InvoiceReviewFlag> => {
      const actor = requireCurrentUser();
      let authorizedBy: User | undefined;
      const approved = await requestApproval({
         permission: 'POS_FLAG_INVOICE_REVIEW',
         actionDescription: 'Marcar factura para revisión',
         context: { ticketId: transaction.displayId || transaction.id, reason: input.comment },
         onAuthorized: supervisor => { authorizedBy = supervisor; },
      });
      if (!approved) throw new Error('La acción no fue autorizada.');

      const { review } = await createInvoiceReview({
         transaction,
         actor,
         authorizedBy,
         category: input.category,
         priority: input.priority,
         comment: input.comment,
      });
      setReviewFlags(previous => [review, ...previous.filter(item => item.id !== review.id)]);
      return review;
   };

   // --- HANDLERS ---
   const toggleExpand = (id: string) => {
      if (returnModeId) return; // Disable expand toggle during return mode
      setExpandedId(prev => prev === id ? null : id);
   };

   const startReturnMode = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setReturnModeId(id);
      setExpandedId(id); // Ensure it's open
      setSelectedItemsQty(new Map());
      setReturnReason('ERROR');
   };

   const cancelReturnMode = () => {
      setReturnModeId(null);
      setSelectedItemsQty(new Map());
   };

   const incrementReturnQty = (cartId: string, maxQty: number) => {
      const newMap = new Map(selectedItemsQty);
      const current = newMap.get(cartId) || 0;
      if (current < maxQty) {
         newMap.set(cartId, current + 1);
         setSelectedItemsQty(newMap);
      }
   };

   const decrementReturnQty = (cartId: string) => {
      const newMap = new Map(selectedItemsQty);
      const current = newMap.get(cartId) || 0;
      if (current > 1) {
         newMap.set(cartId, current - 1);
      } else {
         newMap.delete(cartId);
      }
      setSelectedItemsQty(newMap);
   };

   const openErpRefundSource = async (match: ErpRefundSourceMatch) => {
      setErpSearchLoading(true);
      setErpSearchError(null);
      try {
         if (!match.sourceId) {
            setErpSearchError(match.eligibilityMessage || 'ERP encontró el documento comercial, pero no conserva el original POS necesario para devolverlo.');
            return;
         }
         const transaction = match.transaction || normalizeErpRefundSourceTransaction(
            await apiSyncAdapter.getRefundSource(match.sourceId)
         );
         if (!transaction.erpRefundSource?.refundable) {
            setErpSearchError(
               transaction.erpRefundSource?.eligibilityMessage
               || 'ERP indicó que esta factura no está disponible para devolución.'
            );
            return;
         }
         const remaining = getErpRemainingQuantities(transaction);
         if (!hasRefundableItems(remaining)) {
            setErpSearchError('Esta factura ya fue abonada completamente.');
            return;
         }
         setErpMatches([]);
         setRefundRequestMode('STANDARD');
         setRefundTx(transaction);
         setIsRefundModalOpen(true);
      } catch (error) {
         console.error('No se pudo cargar la factura desde ERP:', error);
         setErpSearchError('ERP no devolvió el original completo necesario para preparar la nota de crédito.');
      } finally {
         setErpSearchLoading(false);
      }
   };

   const searchInvoiceInErp = async () => {
      const reference = searchTerm.trim();
      if (reference.length < 3) {
         setErpSearchError('Escribe al menos 3 caracteres del número de factura, ticket o NCF.');
         return;
      }
      setErpSearchLoading(true);
      setErpSearchError(null);
      setErpMatches([]);
      try {
         const matches = normalizeErpRefundSearchResponse(await apiSyncAdapter.searchRefundSources(reference));
         if (matches.length === 0) {
            setErpSearchError('ERP no encontró una factura con esa referencia.');
            return;
         }
         if (matches.length === 1) {
            await openErpRefundSource(matches[0]);
            return;
         }
         setErpMatches(matches);
      } catch (error) {
         console.error('No se pudo buscar la factura en ERP:', error);
         setErpSearchError('No se pudo consultar ERP. Comprueba la conexión e inténtalo otra vez.');
      } finally {
         setErpSearchLoading(false);
      }
   };

   const executeRefundFlow = async (
      originalTx: Transaction,
      refundItems: CartItem[],
      conditions: Map<string, 'SELLABLE' | 'DAMAGED'>,
      reason: string,
      requestMode: RefundRequestMode = 'STANDARD'
   ) => {
      let refundOptions: RefundProcessingOptions | undefined;

      if (originalTx.erpRefundSource && requestMode !== 'STANDARD') {
         alert('Las devoluciones de tarjeta integradas todavía no están disponibles para facturas consultadas en ERP.');
         return;
      }

      if (!originalTx.erpRefundSource && requestMode === 'AZUL_GATEWAY_REFUND') {
         const azulRefundResolution = resolveAzulRefundResolution(originalTx, refundItems, config);

         if (azulRefundResolution.mode === 'BLOCK') {
            alert(azulRefundResolution.message);
            return;
         }

         if (azulRefundResolution.mode !== 'REFUND') {
            alert('Este ticket no califica para Refund AZUL.');
            return;
         }

         const { integration, amount, taxAmount, orderNumber, payment } = azulRefundResolution;
         setGatewayProgress({
            title: 'Procesando refund',
            providerLabel: integration.name || 'AZUL',
            detail: 'Enviando el refund al procesador.',
         });

         try {
            const azulResponse = await azulMcmService.refund(integration, {
               amount,
               itbis: taxAmount,
               orderNumber,
            });

            await persistIntegrationAuditEvent(integration, {
               action: 'REFUND',
               status: 'SUCCESS',
               message: azulResponse.responseMessage || 'Refund aprobado por AZUL.',
               requestDetails: {
                  Amount: amount.toFixed(2),
                  Itbis: taxAmount.toFixed(2),
                  OrderNumber: orderNumber,
               },
               responseDetails: {
                  MerchantId: azulResponse.merchantId || integration.merchantId || '',
                  TerminalId: azulResponse.terminalId || integration.terminalId || '',
                  EntryMode: azulResponse.entryMode || '',
                  CardBrand: azulResponse.cardBrand || '',
               },
               responseCode: azulResponse.responseCode,
               responseMessage: azulResponse.responseMessage,
               authorizationCode: azulResponse.authorizationCode,
               referenceNumber: azulResponse.referenceNumber,
               invoiceNumber: azulResponse.invoiceNumber,
               sequenceNumber: azulResponse.sequenceNumber,
               maskedPan: azulResponse.maskedPan,
               entryMode: azulResponse.entryMode,
               merchantId: azulResponse.merchantId,
               terminalId: azulResponse.terminalId,
            });

            refundOptions = {
               settlementMode: 'CARD_REFUND',
               skipWalletDeposit: true,
               autoPrintIntegratedArtifacts: true,
               refundPayments: [{
                  id: `refund-${Date.now()}`,
                  method: 'CARD',
                  methodLabel: `Refund ${integration.provider}`,
                  methodIcon: 'CreditCard',
                  amount,
                  timestamp: new Date(),
                  gatewayProvider: 'AZUL',
                  gatewayIntegrationId: integration.id,
                  gatewayTransactionType: 'REFUND',
                  gatewayStatus: azulResponse.approved ? 'APPROVED' : 'DECLINED',
                  gatewayResponseCode: azulResponse.responseCode,
                  gatewayResponseMessage: azulResponse.responseMessage,
                  gatewayOrderNumber: azulResponse.orderNumber || orderNumber,
                  gatewayProcessedAmount: amount,
                  gatewayProcessedTaxAmount: taxAmount,
                  gatewayAuthorizationCode: azulResponse.authorizationCode || payment.gatewayAuthorizationCode,
                  gatewayReference: azulResponse.referenceNumber,
                  gatewaySequenceNumber: azulResponse.sequenceNumber,
                  gatewayInvoiceNumber: azulResponse.invoiceNumber,
                  gatewayBatchNumber: azulResponse.batchNumber,
                  gatewayMerchantId: azulResponse.merchantId,
                  gatewayTerminalId: azulResponse.terminalId,
                  gatewayMaskedPan: azulResponse.maskedPan || payment.gatewayMaskedPan,
                  gatewayCardBrand: azulResponse.cardBrand || payment.gatewayCardBrand,
                  gatewayEntryMode: azulResponse.entryMode || payment.gatewayEntryMode,
                  gatewayReceiptMerchant: azulResponse.receiptMerchant,
                  gatewayReceiptClient: azulResponse.receiptClient,
                  gatewaySignatureData: azulResponse.signatureData,
                  gatewayRequireSignature: azulResponse.requireSignature,
                  gatewayRawResponse: azulResponse.rawResponse,
               }],
            };

            setGatewayProgress({
               title: 'Registrando devolución',
               providerLabel: integration.name || 'AZUL',
               detail: 'Generando la nota de crédito e imprimiendo comprobantes.',
            });
         } catch (error) {
            const gatewayError = error instanceof AzulGatewayError ? error : null;
            await persistIntegrationAuditEvent(integration, {
               action: 'REFUND',
               status: 'FAILED',
               message: error instanceof Error ? error.message : 'No se pudo completar el refund en AZUL.',
               requestDetails: {
                  Amount: amount.toFixed(2),
                  Itbis: taxAmount.toFixed(2),
                  OrderNumber: orderNumber,
               },
               responseDetails: {
                  MerchantId: gatewayError?.normalized?.merchantId || integration.merchantId || '',
                  TerminalId: gatewayError?.normalized?.terminalId || integration.terminalId || '',
                  EntryMode: gatewayError?.normalized?.entryMode || '',
                  CardBrand: gatewayError?.normalized?.cardBrand || '',
               },
               responseCode: gatewayError?.normalized?.responseCode || gatewayError?.response?.ResponseCode,
               responseMessage: gatewayError?.normalized?.responseMessage || gatewayError?.response?.ResponseMessage,
               authorizationCode: gatewayError?.normalized?.authorizationCode,
               referenceNumber: gatewayError?.normalized?.referenceNumber,
               invoiceNumber: gatewayError?.normalized?.invoiceNumber,
               sequenceNumber: gatewayError?.normalized?.sequenceNumber,
               maskedPan: gatewayError?.normalized?.maskedPan,
               entryMode: gatewayError?.normalized?.entryMode,
               merchantId: gatewayError?.normalized?.merchantId,
               terminalId: gatewayError?.normalized?.terminalId,
            });
            setGatewayProgress(null);
            alert(error instanceof Error ? error.message : 'No se pudo completar el refund AZUL.');
            return;
         }
      } else if (!originalTx.erpRefundSource) {
         const azulResolution = resolveAzulVoidResolution(originalTx, refundItems, config);

         if (azulResolution.mode === 'BLOCK') {
            alert(azulResolution.message);
            return;
         }

         if (azulResolution.mode === 'VOID') {
         const { integration, amount, taxAmount, orderNumber, authorizationNumber, payment } = azulResolution;
         setGatewayProgress({
            title: 'Procesando anulación',
            providerLabel: integration.name || 'AZUL',
            detail: 'Enviando la anulación al procesador.',
         });

         try {
            const azulResponse = await azulMcmService.saleCancellation(integration, {
               amount,
               itbis: taxAmount,
               orderNumber,
               authorizationNumber,
            });

            await persistIntegrationAuditEvent(integration, {
               action: 'SALE_CANCELLATION',
               status: 'SUCCESS',
               message: azulResponse.responseMessage || 'Anulación aprobada por AZUL.',
               requestDetails: {
                  Amount: amount.toFixed(2),
                  Itbis: taxAmount.toFixed(2),
                  OrderNumber: orderNumber,
                  AuthorizationNumber: authorizationNumber,
               },
               responseDetails: {
                  MerchantId: azulResponse.merchantId || integration.merchantId || '',
                  TerminalId: azulResponse.terminalId || integration.terminalId || '',
                  EntryMode: azulResponse.entryMode || '',
                  CardBrand: azulResponse.cardBrand || '',
               },
               responseCode: azulResponse.responseCode,
               responseMessage: azulResponse.responseMessage,
               authorizationCode: azulResponse.authorizationCode,
               referenceNumber: azulResponse.referenceNumber,
               invoiceNumber: azulResponse.invoiceNumber,
               sequenceNumber: azulResponse.sequenceNumber,
               maskedPan: azulResponse.maskedPan,
               entryMode: azulResponse.entryMode,
               merchantId: azulResponse.merchantId,
               terminalId: azulResponse.terminalId,
            });

            refundOptions = {
               settlementMode: 'CARD_VOID',
               skipWalletDeposit: true,
               autoPrintIntegratedArtifacts: true,
               refundPayments: [{
                  id: `void-${Date.now()}`,
                  method: 'CARD',
                  methodLabel: `Anulación ${integration.provider}`,
                  methodIcon: 'CreditCard',
                  amount,
                  timestamp: new Date(),
                  gatewayProvider: 'AZUL',
                  gatewayIntegrationId: integration.id,
                  gatewayTransactionType: 'VOID',
                  gatewayStatus: azulResponse.approved ? 'APPROVED' : 'DECLINED',
                  gatewayResponseCode: azulResponse.responseCode,
                  gatewayResponseMessage: azulResponse.responseMessage,
                  gatewayOrderNumber: azulResponse.orderNumber || orderNumber,
                  gatewayProcessedAmount: amount,
                  gatewayProcessedTaxAmount: taxAmount,
                  gatewayAuthorizationCode: azulResponse.authorizationCode || payment.gatewayAuthorizationCode,
                  gatewayReference: azulResponse.referenceNumber,
                  gatewaySequenceNumber: azulResponse.sequenceNumber,
                  gatewayInvoiceNumber: azulResponse.invoiceNumber,
                  gatewayBatchNumber: azulResponse.batchNumber,
                  gatewayMerchantId: azulResponse.merchantId,
                  gatewayTerminalId: azulResponse.terminalId,
                  gatewayMaskedPan: azulResponse.maskedPan || payment.gatewayMaskedPan,
                  gatewayCardBrand: azulResponse.cardBrand || payment.gatewayCardBrand,
                  gatewayEntryMode: azulResponse.entryMode || payment.gatewayEntryMode,
                  gatewayReceiptMerchant: azulResponse.receiptMerchant,
                  gatewayReceiptClient: azulResponse.receiptClient,
                  gatewaySignatureData: azulResponse.signatureData,
                  gatewayRequireSignature: azulResponse.requireSignature,
                  gatewayRawResponse: azulResponse.rawResponse,
               }],
            };

            setGatewayProgress({
               title: 'Registrando devolución',
               providerLabel: integration.name || 'AZUL',
               detail: 'Generando la nota de crédito e imprimiendo comprobantes.',
            });
         } catch (error) {
            const gatewayError = error instanceof AzulGatewayError ? error : null;
            await persistIntegrationAuditEvent(integration, {
               action: 'SALE_CANCELLATION',
               status: 'FAILED',
               message: error instanceof Error ? error.message : 'No se pudo anular la transacción en AZUL.',
               requestDetails: {
                  Amount: amount.toFixed(2),
                  Itbis: taxAmount.toFixed(2),
                  OrderNumber: orderNumber,
                  AuthorizationNumber: authorizationNumber,
               },
               responseDetails: {
                  MerchantId: gatewayError?.normalized?.merchantId || integration.merchantId || '',
                  TerminalId: gatewayError?.normalized?.terminalId || integration.terminalId || '',
                  EntryMode: gatewayError?.normalized?.entryMode || '',
                  CardBrand: gatewayError?.normalized?.cardBrand || '',
               },
               responseCode: gatewayError?.normalized?.responseCode || gatewayError?.response?.ResponseCode,
               responseMessage: gatewayError?.normalized?.responseMessage || gatewayError?.response?.ResponseMessage,
               authorizationCode: gatewayError?.normalized?.authorizationCode,
               referenceNumber: gatewayError?.normalized?.referenceNumber,
               invoiceNumber: gatewayError?.normalized?.invoiceNumber,
               sequenceNumber: gatewayError?.normalized?.sequenceNumber,
               maskedPan: gatewayError?.normalized?.maskedPan,
               entryMode: gatewayError?.normalized?.entryMode,
               merchantId: gatewayError?.normalized?.merchantId,
               terminalId: gatewayError?.normalized?.terminalId,
            });
            setGatewayProgress(null);
            alert(error instanceof Error ? error.message : 'No se pudo completar la anulación AZUL.');
            return;
         }
         }
      }

      if (!originalTx.erpRefundSource && requestMode === 'CARDNET_GATEWAY_REFUND') {
         const cardNetResolution = resolveCardNetOperationResolution(originalTx, refundItems, config);

         if (cardNetResolution.mode === 'BLOCK') {
            alert(cardNetResolution.message);
            return;
         }

         if (cardNetResolution.mode === 'NOT_CARDNET') {
            alert('Este ticket no fue cobrado con el terminal CardNET.');
            return;
         }

         const { integration, payment, amount, taxAmount, invoiceTicket, host, referenceNumber } = cardNetResolution;
         const isVoid = cardNetResolution.mode === 'VOID';
         const providerLabel = integration.name || 'CardNET';
         const auditAction = isVoid ? 'SALE_CANCELLATION' : 'REFUND';

         setGatewayProgress({
            title: isVoid ? 'Procesando anulación' : 'Procesando devolución',
            providerLabel,
            detail: isVoid
               ? 'Enviando la anulación (CN02) al terminal CardNET.'
               : 'Enviando la devolución (CN03) al terminal CardNET.',
         });

         try {
            const cardNetResponse = isVoid
               ? await cardNetEcrService.saleCancellation(integration, {
                  host,
                  referenceNumber,
               })
               : await cardNetEcrService.refund(integration, {
                  amount,
                  itbis: taxAmount,
                  invoiceTicket,
               });

            await persistIntegrationAuditEvent(integration, {
               action: auditAction,
               status: 'SUCCESS',
               message: cardNetResponse.responseMessage
                  || (isVoid ? 'Anulación aprobada por CardNET.' : 'Devolución aprobada por CardNET.'),
               requestDetails: {
                  Trama: isVoid ? 'CN02' : 'CN03',
                  Monto: amount.toFixed(2),
                  ...(isVoid
                     ? { Host: host, NumRef: referenceNumber }
                     : { Itbis: taxAmount.toFixed(2), Ticket: invoiceTicket }),
               },
               responseDetails: {
                  Lote: cardNetResponse.batchNumber,
                  Modo: cardNetResponse.entryMode,
                  Tarjeta: cardNetResponse.cardBrand,
                  Endpoint: integration.baseUrl,
               },
               responseCode: cardNetResponse.responseCode,
               responseMessage: cardNetResponse.responseMessage,
               authorizationCode: cardNetResponse.authorizationCode || payment.gatewayAuthorizationCode,
               referenceNumber: cardNetResponse.referenceNumber,
               invoiceNumber: cardNetResponse.invoiceNumber,
               sequenceNumber: cardNetResponse.sequenceNumber,
               maskedPan: cardNetResponse.maskedPan,
               entryMode: cardNetResponse.entryMode,
               merchantId: cardNetResponse.merchantId,
               terminalId: cardNetResponse.terminalId,
            });

            refundOptions = {
               settlementMode: isVoid ? 'CARD_VOID' : 'CARD_REFUND',
               skipWalletDeposit: true,
               autoPrintIntegratedArtifacts: true,
               refundPayments: [{
                  id: `${isVoid ? 'void' : 'refund'}-${Date.now()}`,
                  method: 'CARD',
                  methodLabel: `${isVoid ? 'Anulación' : 'Devolución'} CARDNET`,
                  methodIcon: 'CreditCard',
                  amount,
                  timestamp: new Date(),
                  gatewayProvider: 'CARDNET',
                  gatewayIntegrationId: integration.id,
                  gatewayTransactionType: isVoid ? 'VOID' : 'REFUND',
                  gatewayStatus: cardNetResponse.approved ? 'APPROVED' : 'DECLINED',
                  gatewayResponseCode: cardNetResponse.responseCode,
                  gatewayResponseMessage: cardNetResponse.responseMessage,
                  gatewayOrderNumber: invoiceTicket,
                  gatewayProcessedAmount: amount,
                  gatewayProcessedTaxAmount: isVoid ? 0 : taxAmount,
                  gatewayAuthorizationCode: cardNetResponse.authorizationCode || payment.gatewayAuthorizationCode,
                  gatewayReference: cardNetResponse.referenceNumber || payment.gatewayReference,
                  gatewaySequenceNumber: cardNetResponse.sequenceNumber,
                  gatewayInvoiceNumber: cardNetResponse.invoiceNumber || invoiceTicket,
                  gatewayBatchNumber: cardNetResponse.batchNumber,
                  gatewayMerchantId: cardNetResponse.merchantId,
                  gatewayTerminalId: cardNetResponse.terminalId,
                  gatewayMaskedPan: cardNetResponse.maskedPan || payment.gatewayMaskedPan,
                  gatewayCardBrand: cardNetResponse.cardBrand || payment.gatewayCardBrand,
                  gatewayEntryMode: cardNetResponse.entryMode || payment.gatewayEntryMode,
                  gatewayHost: cardNetResponse.host || payment.gatewayHost,
                  gatewayCardProduct: cardNetResponse.productType || payment.gatewayCardProduct,
                  gatewayReceiptMerchant: cardNetResponse.receiptMerchant,
                  gatewayReceiptClient: cardNetResponse.receiptClient,
                  gatewaySignatureData: cardNetResponse.signatureData,
                  gatewayRequireSignature: false,
                  gatewayRawResponse: cardNetResponse.rawResponse,
               }],
            };

            setGatewayProgress({
               title: 'Registrando devolución',
               providerLabel,
               detail: 'Generando la nota de crédito e imprimiendo comprobantes.',
            });
         } catch (error) {
            const cardNetError = error instanceof CardNetEcrError ? error : null;

            await persistIntegrationAuditEvent(integration, {
               action: auditAction,
               status: 'FAILED',
               message: error instanceof Error ? error.message : 'No se pudo completar la operación con CardNET.',
               requestDetails: {
                  Trama: isVoid ? 'CN02' : 'CN03',
                  Monto: amount.toFixed(2),
                  Endpoint: integration.baseUrl,
               },
               responseDetails: {
                  Estado: 'Error',
                  ...(cardNetError?.transcript ? { Traza: cardNetError.transcript.slice(0, 400) } : {}),
               },
               responseCode: cardNetError?.parsed?.responseCode,
               responseMessage: cardNetError?.parsed?.responseMessage,
               authorizationCode: cardNetError?.parsed?.sale?.authorizationCode,
               referenceNumber: cardNetError?.parsed?.sale?.referenceNumber,
               merchantId: integration.merchantId,
               terminalId: integration.terminalId,
            });

            setGatewayProgress(null);
            alert(error instanceof Error ? error.message : 'No se pudo completar la operación CardNET.');
            return;
         }
      }

      if (originalTx.erpRefundSource) {
         try {
            const commandId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
               ? crypto.randomUUID()
               : `refund-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const preparationPayload = await apiSyncAdapter.prepareRefundSource(
               originalTx.erpRefundSource.sourceId,
               {
                  commandId,
                  sourceRevision: originalTx.erpRefundSource.sourceRevision,
                  terminalId: activeTerminalId,
                  lines: refundItems.map(item => ({
                     cartId: item.cartId,
                     quantity: Math.abs(Number(item.quantity || 0)),
                  })),
               },
            );
            const prepared = normalizeErpRefundPreparation(preparationPayload, {
               commandId,
               sourceId: originalTx.erpRefundSource.sourceId,
               sourceRevision: originalTx.erpRefundSource.sourceRevision,
            });
            refundOptions = {
               ...refundOptions,
               erpRefundPreparation: prepared.preparation,
               erpRefundAuthority: prepared.authority,
            };
         } catch (error) {
            console.error('ERP rechazó la preparación de la devolución:', error);
            alert('ERP no pudo reservar esta devolución. Actualiza la factura y vuelve a intentarlo; no se creó ninguna nota de crédito.');
            return;
         }
      }

      try {
         await onRefundTransaction(originalTx, refundItems, conditions, reason || 'Devolución', refundOptions);
         setIsRefundModalOpen(false);
         setRefundTx(null);
         setRefundRequestMode('STANDARD');
         setSelectedTxId(null);
      } catch (error) {
         console.error('❌ TicketHistory refund orchestration failed:', error);
         if (refundOptions?.settlementMode === 'CARD_VOID' || refundOptions?.settlementMode === 'CARD_REFUND') {
            setIsRefundModalOpen(false);
            setRefundTx(null);
            setRefundRequestMode('STANDARD');
         }
      } finally {
         setGatewayProgress(null);
      }
   };

   const confirmRefund = async (transaction: Transaction) => {
      if (selectedItemsQty.size === 0) return;

      // Validation: Check if terminal has REFUND document series assigned
      const validation = validateTerminalDocument(config, activeTerminalId, 'REFUND');
      if (!validation.isValid) {
         alert(validation.error);
         return;
      }

      // Supervisor Check for Voiding Paid Ticket
      const authorized = await requestApproval({
         permission: 'POS_VOID_PAID_TICKET',
         actionDescription: 'Anular/Devolver Factura Pagada',
         context: {
            ticketId: transaction.id,
            originalValue: currentRefundTotal
         }
      });
      if (!authorized) return;

      if (await clicConfirm("¿Confirmar devolución de los artículos seleccionados?")) {
         // Build items with adjusted quantities
         const itemsToRefund = transaction.items
            .filter(item => selectedItemsQty.has(item.cartId))
            .map(item => ({
               ...item,
               quantity: selectedItemsQty.get(item.cartId) || item.quantity
            }));

         // Legacy/Manual refund flow support
         const conditions = new Map<string, 'SELLABLE' | 'DAMAGED'>();
         itemsToRefund.forEach(i => conditions.set(i.cartId, 'SELLABLE'));

         await executeRefundFlow(
            transaction,
            itemsToRefund,
            conditions,
            REASONS.find(r => r.id === returnReason)?.label || 'Devolución',
            refundRequestMode
         );
         setReturnModeId(null);
         setSelectedItemsQty(new Map());
      }
   };

   const handlePrintGiftReceipt = (e: React.MouseEvent, tx: Transaction) => {
      e.stopPropagation();
      setGiftReceiptTx(tx);
   };

   const handleConfirmRefundFromModal = async (
      originalTx: Transaction,
      refundItems: CartItem[],
      conditions: Map<string, 'SELLABLE' | 'DAMAGED'>,
      reason: string
   ) => {
      if (!originalTx || refundItems.length === 0) return;
      const availability = originalTx.erpRefundSource
         ? validateErpRefundItems(originalTx, refundItems)
         : validateRefundItems(originalTx, refundItems, allKnownTransactions);
      if ('message' in availability) {
         alert(availability.message);
         return;
      }

      const validation = validateTerminalDocument(config, activeTerminalId, 'REFUND');
      if (!validation.isValid) {
         alert(validation.error);
         return;
      }

      const refundSubtotal = refundItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
      const refundTerminalConfig = config.terminals?.find(t => t.id === activeTerminalId)?.config;
      const refundSummary = calculateTransactionFiscalSummary({
         items: refundItems,
         total: 0,
         discountAmount: 0,
         taxAmount: 0,
         isTaxIncluded: !!originalTx.isTaxIncluded,
      }, config, { terminalConfig: refundTerminalConfig });
      const refundTotal = originalTx.isTaxIncluded
         ? refundSubtotal
         : refundSummary.total;

      const authorized = await requestApproval({
         permission: 'POS_VOID_PAID_TICKET',
         actionDescription: 'Anular/Devolver Factura Pagada',
         context: {
            ticketId: originalTx.id,
            originalValue: refundTotal
         }
      });

      if (!authorized) return;

      await executeRefundFlow(originalTx, refundItems, conditions, reason || 'Devolución', refundRequestMode);
   };

   // Calculate Refund Total
   const currentRefundTotal = useMemo(() => {
      if (!returnModeId) return 0;
      const tx = transactions.find(t => t.id === returnModeId);
      if (!tx) return 0;

      const refundItems = tx.items
         .filter(item => selectedItemsQty.has(item.cartId))
         .map(item => ({
            ...item,
            quantity: selectedItemsQty.get(item.cartId) || 0,
         }))
         .filter(item => item.quantity > 0);
      if (refundItems.length === 0) return 0;
      const refundTerminalConfig = config.terminals?.find(t => t.id === tx.terminalId)?.config;
      const refundSummary = calculateTransactionFiscalSummary({
         items: refundItems,
         total: 0,
         discountAmount: 0,
         taxAmount: 0,
         isTaxIncluded: !!tx.isTaxIncluded,
      }, config, { terminalConfig: refundTerminalConfig });
      return tx.isTaxIncluded ? refundItems.reduce((acc, item) => acc + (item.price * item.quantity), 0) : refundSummary.total;
   }, [returnModeId, selectedItemsQty, transactions, config]);


   // --- RENDER HELPERS ---
   const themeText = config.themeColor === 'orange' ? 'text-orange-600' : 'text-blue-600';
   const themeBg = config.themeColor === 'orange' ? 'bg-orange-600' : 'bg-blue-600';
   const themeRing = config.themeColor === 'orange' ? 'focus:ring-orange-500' : 'focus:ring-blue-500';

   return (
      <div className="h-screen w-full bg-gray-100 flex flex-col overflow-hidden relative">
         {gatewayProgress && (
            <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
               <div className="w-full max-w-sm rounded-[2rem] bg-white px-8 py-10 text-center shadow-2xl border border-slate-100">
                  <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-indigo-50">
                     <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
                  </div>
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-indigo-500">{gatewayProgress.providerLabel}</p>
                  <h3 className="mt-3 text-2xl font-black text-slate-900">{gatewayProgress.title}</h3>
                  <p className="mt-3 text-sm font-semibold text-slate-500">{gatewayProgress.detail}</p>
               </div>
            </div>
         )}

         {/* Header & Compact Filters */}
         <header className="bg-white border-b border-gray-200 p-3 shadow-sm z-20">
            <div className="max-w-[1600px] mx-auto w-full flex flex-wrap items-center justify-between gap-3">
               <div className="flex items-center gap-3">
                  <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-all active:scale-95">
                     <ArrowLeft size={18} />
                  </button>
                  <h1 className="text-sm font-black text-gray-800 flex items-center gap-2 uppercase tracking-tighter">
                     <FileText size={16} className={themeText} />
                     Historial
                  </h1>
               </div>

               <div className="flex flex-1 items-center gap-2 min-w-[300px] max-w-4xl">
                  <div className="relative flex-1">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                     <input
                        type="text"
                        placeholder="Buscar ticket, cliente..."
                        className={`w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-100 rounded-lg focus:bg-white focus:ring-1 ${themeRing} outline-none transition-all text-sm text-gray-700 placeholder:text-gray-400`}
                        value={searchTerm}
                        onChange={(e) => {
                           setSearchTerm(e.target.value);
                           setErpSearchError(null);
                           setErpMatches([]);
                        }}
                     />
                  </div>

                  <div className="flex items-center gap-1.5">
                     <div className="flex items-center bg-gray-50 border border-gray-100 rounded-lg px-2 py-1.5">
                        <Calendar size={12} className="text-gray-400 mr-1.5" />
                        <input
                           type="date"
                           value={filterDateStart}
                           onChange={e => setFilterDateStart(e.target.value)}
                           className="bg-transparent border-none text-[11px] font-bold text-gray-600 outline-none w-28"
                        />
                     </div>
                     <select
                        value={filterTerminal}
                        onChange={e => setFilterTerminal(e.target.value)}
                        className="px-2 py-1.5 bg-gray-50 border border-gray-100 rounded-lg text-[11px] font-bold text-gray-600 outline-none hover:bg-white transition-colors"
                     >
                        <option value="">Terminal</option>
                        {terminalFilterOptions.map(option => (
                           <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                     </select>
                     <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`p-2 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors ${showFilters ? 'bg-blue-50 text-blue-600' : ''}`}
                     >
                        <Filter size={16} />
                     </button>
                  </div>
               </div>
            </div>

            {showFilters && (
               <div className="mt-2 p-3 bg-gray-50 rounded-xl border border-gray-100 flex flex-wrap gap-4 max-w-[1600px] mx-auto animate-in fade-in slide-in-from-top-1">
                  <div className="flex items-center gap-2">
                     <span className="text-[10px] font-bold text-gray-400 uppercase">Hasta:</span>
                     <input type="date" value={filterDateEnd} onChange={e => setFilterDateEnd(e.target.value)} className="px-2 py-1 bg-white border border-gray-200 rounded text-[11px] font-bold" />
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="text-[10px] font-bold text-gray-400 uppercase">Cajero:</span>
                     <select value={filterCashier} onChange={e => setFilterCashier(e.target.value)} className="px-2 py-1 bg-white border border-gray-200 rounded text-[11px] font-bold">
                        <option value="">Todos</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                     </select>
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="text-[10px] font-bold text-gray-400 uppercase">NCF:</span>
                     <select value={filterNcfType} onChange={e => setFilterNcfType(e.target.value)} className="px-2 py-1 bg-white border border-gray-200 rounded text-[11px] font-bold">
                        <option value="ALL">Cualquiera</option>
                        <option value="B01">Crédito Fiscal</option>
                        <option value="B02">Consumo Final</option>
                        <option value="B14">Regímenes Especiales</option>
                        <option value="B15">Gubernamental</option>
                     </select>
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="text-[10px] font-bold text-gray-400 uppercase">Pago:</span>
                     <select value={filterPaymentMethod} onChange={e => setFilterPaymentMethod(e.target.value)} className="px-2 py-1 bg-white border border-gray-200 rounded text-[11px] font-bold">
                        <option value="ALL">Todos</option>
                        {paymentMethodOptions.map((method) => (
                           <option key={method.value} value={method.value}>
                              {method.label}
                           </option>
                        ))}
                     </select>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-black uppercase text-amber-700">
                     <input type="checkbox" checked={filterReviewOnly} onChange={event => setFilterReviewOnly(event.target.checked)} />
                     <Flag size={12} /> Solo revisión
                  </label>
                  <button onClick={() => { setSearchTerm(''); setFilterDateStart(''); setFilterDateEnd(''); setFilterTerminal(''); setFilterCashier(''); setFilterNcfType(''); setFilterPaymentMethod(''); setFilterReviewOnly(false); }} className="text-[10px] font-bold text-red-500 ml-auto hover:underline uppercase">Reset</button>
               </div>
            )}
         </header>

         <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto w-full">
            <SalesSummaryBar kpis={kpis} config={config} />

            <SalesHistoryTable
               transactions={filteredTransactions}
               config={config}
               onRowClick={(id) => setSelectedTxId(id)}
               themeBg={themeBg}
               themeText={themeText}
               zReportMap={zReportMap}
               zReports={zReports}
               reviewedTransactionIds={new Set(reviewFlags.filter(flag => flag.status === 'OPEN' || flag.status === 'IN_REVIEW').map(flag => flag.transactionId))}
            />

            {filteredTransactions.length === 0 && (
               <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-200 mt-4">
                  <Box size={32} className="mx-auto mb-2 text-gray-300" />
                  <p className="text-gray-400 font-bold text-xs uppercase tracking-widest">Sin resultados</p>
                  {searchTerm.trim() && (
                     <div className="mx-auto mt-5 max-w-md px-5">
                        <p className="text-sm font-semibold text-slate-500">
                           Si la factura se emitió en otro POS o ya no está en este equipo, puedes consultarla en ERP.
                        </p>
                        <button
                           type="button"
                           onClick={() => void searchInvoiceInErp()}
                           disabled={erpSearchLoading || searchTerm.trim().length < 3}
                           className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                           {erpSearchLoading ? (
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                           ) : <Search size={16} />}
                           {erpSearchLoading ? 'Consultando ERP...' : 'Buscar factura en ERP'}
                        </button>
                        {erpSearchError && (
                           <p role="alert" className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                              {erpSearchError}
                           </p>
                        )}
                     </div>
                  )}
               </div>
            )}
         </main>

         {erpMatches.length > 1 && (
            <div className="fixed inset-0 z-[145] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
               <section className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="erp-invoice-results-title">
                  <header className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
                     <div>
                        <h2 id="erp-invoice-results-title" className="text-lg font-black text-slate-900">Selecciona la factura</h2>
                        <p className="mt-1 text-sm font-semibold text-slate-500">ERP encontró más de una coincidencia.</p>
                     </div>
                     <button type="button" onClick={() => setErpMatches([])} className="rounded-full p-2 text-slate-400 hover:bg-slate-100"><X size={20} /></button>
                  </header>
                  <div className="max-h-[60vh] space-y-3 overflow-y-auto p-5">
                     {erpMatches.map(match => (
                        <button
                           type="button"
                           key={`${match.sourceId}:${match.sourceRevision}`}
                           onClick={() => void openErpRefundSource(match)}
                           disabled={erpSearchLoading}
                           className="w-full rounded-xl border border-slate-200 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"
                        >
                           <div className="flex items-start justify-between gap-4">
                              <div>
                                 <p className="font-black text-slate-900">{match.displayId || match.reference}</p>
                                 <p className="mt-1 text-xs font-semibold text-slate-500">
                                    {[match.ncf, match.terminalName, match.date ? new Date(match.date).toLocaleString() : ''].filter(Boolean).join(' · ')}
                                 </p>
                                 {!match.refundable && (
                                    <p className="mt-2 text-xs font-bold text-amber-700">{match.eligibilityMessage || 'No disponible para devolución'}</p>
                                 )}
                              </div>
                              <span className="font-black text-slate-900">{config.currencySymbol}{match.total.toFixed(2)}</span>
                           </div>
                        </button>
                     ))}
                  </div>
               </section>
            </div>
         )}

         {/* Detail Drawer */}
         <TicketDetailDrawer
            tx={transactions.find(t => t.id === selectedTxId) || historyTransactions.find(t => t.id === selectedTxId) || null}
            config={config}
            onClose={() => setSelectedTxId(null)}
            onPrint={(tx) => { void handlePrintTransaction(tx); }}
            onRequestRefund={(tx) => {
               const remaining = getRemainingRefundQuantities(tx, allKnownTransactions);
               if (!hasRefundableItems(remaining)) {
                  alert('Esta factura ya fue abonada completamente y no tiene saldo pendiente de devolución.');
                  return;
               }
               setRefundRequestMode('STANDARD');
               setRefundTx(tx);
               setIsRefundModalOpen(true);
            }}
            onRequestGatewayRefund={(tx) => {
               setRefundRequestMode(
                  resolveIntegratedGatewayProvider(tx) === 'CARDNET'
                     ? 'CARDNET_GATEWAY_REFUND'
                     : 'AZUL_GATEWAY_REFUND'
               );
               setRefundTx(tx);
               setIsRefundModalOpen(true);
            }}
            onRetryFiscalDocument={onRetryFiscalDocument}
            customers={customers}
            reviewFlags={reviewFlags}
            onSendEmail={handleSendInvoiceEmail}
            onFlagForReview={handleFlagInvoiceForReview}
            onCorrectFiscalDocument={onCorrectFiscalDocument ? async (tx, correction) => {
               const corrected = await onCorrectFiscalDocument(tx, correction);
               setHistoryTransactions(prev => prev.map(item => item.id === corrected.id ? corrected : item));
               return corrected;
            } : undefined}
            themeText={themeText}
            themeBg={themeBg}
            users={users}
         />

         {/* Gift Modal (Keep same structure but adjusted style) */}
         {giftReceiptTx && (
            <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs flex flex-col overflow-hidden animate-in zoom-in-95">
                  <div className="p-3 bg-gray-50 border-b flex justify-between items-center text-sm font-bold">
                     <span className="flex items-center gap-2"><Gift size={16} className="text-purple-600" /> Ticket Regalo</span>
                     <button onClick={() => setGiftReceiptTx(null)}><X size={16} /></button>
                  </div>
                  <div className="p-4 overflow-y-auto max-h-[50vh] font-mono text-[11px] text-gray-700 leading-tight">
                     <div className="text-center mb-4 uppercase">
                        <p className="font-bold">{config.companyInfo.name}</p>
                        <p className="opacity-50 tracking-tighter">* REGALO *</p>
                     </div>
                     <div className="border-y border-dashed py-2 mb-2">
                        {giftReceiptTx.items.map((item, i) => (
                           <div key={i} className="flex justify-between">
                              <span>{item.name}</span>
                              <span className="font-bold">x{item.quantity}</span>
                           </div>
                        ))}
                     </div>
                     <div className="text-center opacity-30 mt-4">
                        <QrCode size={40} className="mx-auto" />
                     </div>
                  </div>
                  <div className="p-3 bg-gray-50 border-t">
                     <button onClick={() => { alert("Imprimiendo..."); setGiftReceiptTx(null); }} className="w-full py-2 bg-purple-600 text-white rounded-lg font-bold text-sm">Imprimir</button>
                  </div>
               </div>
            </div>
         )}

         <RefundModal
            isOpen={isRefundModalOpen}
            onClose={() => {
               setIsRefundModalOpen(false);
               setRefundTx(null);
               setRefundRequestMode('STANDARD');
            }}
            transaction={refundTx}
            onConfirm={handleConfirmRefundFromModal}
            currencySymbol={config.currencySymbol}
            mode={refundRequestMode}
            providerLabel={refundRequestMode === 'CARDNET_GATEWAY_REFUND' ? 'CardNET' : 'AZUL'}
            remainingQuantities={refundRemainingQuantities}
         />

         <SupervisorModal {...supervisorModalProps} users={users} />
      </div>
   );
};

export default TicketHistory;
