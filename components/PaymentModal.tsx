import { recordCheckoutDiagnostic } from '../services/CheckoutDiagnostics';
import { allowsDefaultPaymentMethods } from '../utils/erpPaymentMethods';

import React, { useState, useEffect, useLayoutEffect, useMemo } from 'react';
import {
   X, CreditCard, Banknote, QrCode, CheckCircle2,
   Trash2, Plus, Wallet, Printer, Mail, ShieldAlert,
   Repeat, ArrowRightLeft, DollarSign, Zap, Smartphone, Percent
} from 'lucide-react';
import {
   PaymentEntry,
   PaymentMethod,
   BusinessConfig,
   CurrencyConfig,
   CartItem,
   Transaction,
   Customer,
   User,
   Permission,
   RoleDefinition,
   PaymentIntegrationDefinition,
   PaymentMethodDefinition,
   PaymentMethodRoundingRule
} from '../types';
import {
   evaluateCreditSupervisorGate,
   paymentEntryIsCxCCredit,
   resolvePaymentMethodTypeForRuntime,
   sumCreditPaymentsBase
} from '../utils/creditRules';
import { isLoyaltyRedeemMethod } from '../utils/loyaltyEngine';
import { openCashDrawerForTransaction, printIntegratedPaymentArtifacts, printTicket } from '../utils/printer';
import { networkSyncService } from '../services/sync/NetworkSyncService';
import { AzulGatewayError, azulMcmService } from '../services/payments/AzulMcmService';
import {
   IngenicoAzulWebApiError,
   ingenicoAzulWebApiService,
} from '../services/payments/IngenicoAzulWebApiService';
import {
   CardNetEcrError,
   cardNetEcrService,
   generateCardNetInvoiceTicket,
} from '../services/payments/CardNetEcrService';
import {
   createPaymentIntegrationAuditEvent,
   dispatchAuditEventConfigUpdate,
} from '../services/payments/paymentIntegrationAudit';
import { paymentIntentService } from '../services/payments/PaymentIntentService';
import {
   beginPosInteraction,
   expectInteractionRender,
   markInteractionStage,
   markInteractionStateUpdate,
   markRenderEnd,
   markRenderStart,
   measureInteractionStage,
} from '../utils/interactionPerformance';
import {
   buildPaymentSettlementSummary,
   resolveCurrencySymbol,
} from '../utils/paymentSettlement';
import { sendReceiptEmailViaErp } from '../services/email/receiptEmailService';
import { buildReceiptEmailPayload } from '../services/email/receiptEmailPayload';

interface PaymentModalProps {
   total: number;
   items: CartItem[]; // Added items prop
   taxAmount?: number;
   currencySymbol: string;
   config?: BusinessConfig;
   onClose: () => void;
   onConfirm: (payments: PaymentEntry[], voluntaryTip?: number) => Promise<Transaction | null>;
   themeColor: string;
   customer?: Customer | null;
   isDelinquent?: boolean;
   users: User[];
   isMaster?: boolean;
   currentUser?: User | null;
   roles?: RoleDefinition[];
   isRestaurantMode?: boolean;
   isInstallmentPayment?: boolean;
}

type ResolvedPaymentMethod = {
   key: string;
   id: string;
   type: PaymentMethod;
   label: string;
   iconName?: string;
   Icon: React.ElementType;
   definition?: PaymentMethodDefinition;
   integration?: PaymentIntegrationDefinition;
};

const normalizeRuntimePaymentMethodDefinition = (
   method: PaymentMethodDefinition,
   integrations: PaymentIntegrationDefinition[]
): { definition: PaymentMethodDefinition; integration?: PaymentIntegrationDefinition } => {
   const inferredIntegrationMode = method.type === 'CARD'
      ? (method.integrationMode || (method.integration && method.integration !== 'NONE' ? 'INTEGRATED' : 'MANUAL'))
      : 'MANUAL';

   let assignedIntegration = method.integrationId
      ? integrations.find((integration) => integration.id === method.integrationId)
      : undefined;

   if (!assignedIntegration && method.type === 'CARD' && inferredIntegrationMode === 'INTEGRATED' && method.integration && method.integration !== 'NONE') {
      const providerMatches = integrations.filter((integration) => integration.provider === method.integration);
      assignedIntegration = providerMatches[0];
   }

   return {
      definition: {
         ...method,
         integrationMode: inferredIntegrationMode,
         integrationId: assignedIntegration?.id || method.integrationId,
         integration: method.type === 'CARD' && inferredIntegrationMode === 'INTEGRATED'
            ? (assignedIntegration?.provider || method.integration)
            : 'NONE',
         foreignCurrencyRounding: method.foreignCurrencyRounding || 'NONE',
      },
      integration: assignedIntegration,
   };
};

const PAYMENT_ICON_BY_NAME: Record<string, React.ElementType> = {
   Banknote,
   CreditCard,
   QrCode,
   Wallet,
   DollarSign,
   Smartphone,
   Zap,
   CardIcon: CreditCard
};

const getDefaultIconByType = (type: PaymentMethod): React.ElementType => {
   switch (type) {
      case 'CASH':
         return Banknote;
      case 'CARD':
      case 'CREDIT':
         return CreditCard;
      case 'QR':
         return QrCode;
      case 'WALLET':
         return Wallet;
      case 'ADVANCE':
         return ArrowRightLeft;
      default:
         return Wallet;
   }
};

const getDefaultLabelByType = (type: PaymentMethod): string => {
   switch (type) {
      case 'CASH':
         return 'Efectivo';
      case 'CARD':
         return 'Tarjeta';
      case 'QR':
         return 'Digital';
      case 'WALLET':
         return 'Wallet';
      case 'CREDIT':
         return 'Crédito';
      case 'ADVANCE':
         return 'Anticipo';
      default:
         return 'Otro';
   }
};

const createPaymentId = (): string => {
   if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
   }
   return `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

const roundToTwo = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const resolveSuggestedTipAmount = (baseTotal: number, percentage: number): number => {
   if (!Number.isFinite(baseTotal) || !Number.isFinite(percentage) || baseTotal <= 0 || percentage <= 0) {
      return 0;
   }
   return roundToTwo(baseTotal * (percentage / 100));
};

const sendReceiptEmailRequest = async (
   transaction: Transaction,
   email: string,
   config: BusinessConfig | undefined,
   currencySymbol: string,
   users: User[],
): Promise<{ success: boolean; message?: string }> => {
   return sendReceiptEmailViaErp(buildReceiptEmailPayload(transaction, email, config, currencySymbol, users));
};

const roundPaymentAmountByMethod = (
   value: number,
   rule: PaymentMethodRoundingRule,
   selectedCurrencyCode: string,
   baseCurrencyCode: string
): number => {
   if (!Number.isFinite(value) || value <= 0) return 0;
   if (selectedCurrencyCode === baseCurrencyCode) return roundToTwo(value);

   switch (rule) {
      case 'UP':
         return Math.ceil(value);
      case 'DOWN':
         return Math.floor(value);
      case 'ZERO_DECIMALS':
         return Math.round(value);
      case 'NONE':
      default:
         return roundToTwo(value);
   }
};

const formatRoundedInput = (
   value: number,
   rule: PaymentMethodRoundingRule,
   selectedCurrencyCode: string,
   baseCurrencyCode: string
): string => {
   const rounded = roundPaymentAmountByMethod(value, rule, selectedCurrencyCode, baseCurrencyCode);
   if (rounded <= 0) return '';
   if (selectedCurrencyCode !== baseCurrencyCode && rule !== 'NONE') {
      return rounded.toFixed(0);
   }
   return rounded.toFixed(2);
};

const createAzulOrderNumber = (): string => {
   const base = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
   return base.slice(-8);
};

type GatewayProgressOverlayState = {
   title: string;
   providerLabel: string;
   detail: string;
};

import SupervisorAuthModal from './SupervisorAuthModal';

const UnifiedPaymentModal: React.FC<PaymentModalProps> = ({ total, items, taxAmount = 0, currencySymbol, config, onClose, onConfirm, themeColor, customer, isDelinquent, users, isMaster, currentUser, roles, isRestaurantMode, isInstallmentPayment = false }) => {
   markRenderStart('PAYMENT_MODAL');
   useLayoutEffect(() => markRenderEnd('PAYMENT_MODAL'));
   const [payments, setPayments] = useState<PaymentEntry[]>([]);
   const [activeMethodKey, setActiveMethodKey] = useState<string>('');
   const [inputAmount, setInputAmount] = useState<string>('');
   const [isSuccessScreen, setIsSuccessScreen] = useState(false);
   const [completedTransaction, setCompletedTransaction] = useState<Transaction | null>(null);
   const [shouldClearInput, setShouldClearInput] = useState(true);
   const [voluntaryTip, setVoluntaryTip] = useState(0);
   const [isFinalizing, setIsFinalizing] = useState(false);
   const [finalizeError, setFinalizeError] = useState<string | null>(null);
   const [isOnline, setIsOnline] = useState(networkSyncService.getStatus().isOnline);
   const [isVerifyingWallet, setIsVerifyingWallet] = useState(false);
   const [verifiedBalance, setVerifiedBalance] = useState<number | null>(null);
   const [showSupervisorModal, setShowSupervisorModal] = useState(false);
   const [isOverrideActive, setIsOverrideActive] = useState(false);
   const [isProcessingGateway, setIsProcessingGateway] = useState(false);
   const [gatewayProgress, setGatewayProgress] = useState<GatewayProgressOverlayState | null>(null);
   const printTicketPending = React.useRef(false);
   const [isPrintingTicket, setIsPrintingTicket] = useState(false);
   const [successNotice, setSuccessNotice] = useState<string | null>(null);

   const userPermissions = useMemo(() => {
      if (!currentUser) return [];
      const rolesSource = roles || config?.roles || [];
      const role = rolesSource.find(r => r.id === currentUser.roleId || r.id === currentUser.role);
      return role?.permissions || [];
   }, [currentUser, config?.roles, roles]);

   const hasPermission = (perm: Permission) => userPermissions.includes('ALL') || userPermissions.includes(perm);
   const canStartNewSale = hasPermission('POS_NEW_SALE');

   useEffect(() => {
      const unsubscribe = networkSyncService.subscribe(status => {
         setIsOnline(status.isOnline);
      });
      return unsubscribe;
   }, []);

   // Effect to reset verified balance when customer or method changes
   useEffect(() => {
      setVerifiedBalance(null);
   }, [customer?.id, activeMethodKey]);

   const currencies = config?.currencies || [];
   const baseCurrency = currencies.find(c => c.isBase) || { code: 'DOP', symbol: 'RD$', rate: 1 };
   const [selectedCurrency, setSelectedCurrency] = useState<CurrencyConfig>(baseCurrency as CurrencyConfig);

   // Lock total/refund mode at modal open to avoid recalculating to 0 when parent clears cart.
   const [isRefund] = useState(() => total < 0);
   const [absTotal] = useState(() => Math.abs(total));
   const tipsConfig = config?.tipsConfig;
   const suggestedTipOptions = useMemo(
      () => (tipsConfig?.defaultOptions || [])
         .map((option) => Number(option))
         .filter((option) => Number.isFinite(option) && option > 0),
      [tipsConfig?.defaultOptions]
   );
   const shouldShowTipSuggestions = Boolean(
      tipsConfig?.enabled && !isRefund && absTotal > 0 && suggestedTipOptions.length > 0
   );
   const allowCustomTip = tipsConfig?.allowCustomTip !== false;
   const fixedTipAmounts = useMemo(
      () => ((tipsConfig as any)?.fixedAmountOptions || [100, 200, 500, 1000])
         .map((amount: unknown) => Number(amount))
         .filter((amount: number) => Number.isFinite(amount) && amount > 0),
      [tipsConfig]
   );
   
   // El total a pagar ahora incluye la propina voluntaria
   const effectiveTotalToPay = useMemo(() => absTotal + voluntaryTip, [absTotal, voluntaryTip]);

   const paymentSettlementPreview = useMemo(
      () => buildPaymentSettlementSummary(payments, effectiveTotalToPay, baseCurrency.code),
      [payments, effectiveTotalToPay, baseCurrency.code]
   );
   const paymentPreviewById = useMemo(
      () => new Map(paymentSettlementPreview.lines.map(line => [line.paymentId, line])),
      [paymentSettlementPreview]
   );
   const totalPaid = paymentSettlementPreview.totalReceivedBase;
   const remaining = paymentSettlementPreview.remainingBase;
   const change = paymentSettlementPreview.totalChangeBase;
   const typedAmount = parseFloat(inputAmount || '0');

   const configuredMethods = useMemo<ResolvedPaymentMethod[]>(() => {
      const enabledConfigMethods = (config?.paymentMethods || []).filter(m => m.isEnabled);
      const integrations = config?.integrations || [];

      const fromConfig: ResolvedPaymentMethod[] = enabledConfigMethods.map((method, index) => {
         const IconFromName = method.icon ? PAYMENT_ICON_BY_NAME[method.icon] : undefined;
         const normalized = normalizeRuntimePaymentMethodDefinition(method, integrations);
         return {
            key: `${method.id}-${index}`,
            id: method.id,
            type: method.type,
            label: method.name || getDefaultLabelByType(method.type),
            iconName: method.icon,
            Icon: IconFromName || getDefaultIconByType(method.type),
            definition: normalized.definition,
            integration: normalized.integration,
         };
      });

      const methods: ResolvedPaymentMethod[] = fromConfig.length > 0 || !allowsDefaultPaymentMethods(config) ? fromConfig : [
         { key: 'CASH', id: 'CASH', type: 'CASH' as PaymentMethod, label: 'Efectivo', iconName: 'Banknote', Icon: Banknote },
         { key: 'CARD', id: 'CARD', type: 'CARD' as PaymentMethod, label: 'Tarjeta', iconName: 'CreditCard', Icon: CreditCard },
         { key: 'QR', id: 'QR', type: 'QR' as PaymentMethod, label: 'Digital', iconName: 'QrCode', Icon: QrCode }
      ];

      const hasWalletMethod = methods.some(m => m.type === 'WALLET');
      if (customer?.wallet && !hasWalletMethod && allowsDefaultPaymentMethods(config)) {
         methods.push({
            key: 'WALLET',
            id: 'WALLET',
            type: 'WALLET',
            label: 'Saldo a Favor',
            iconName: 'Wallet',
            Icon: Wallet,
         });
      }

      return methods;
   }, [config?.paymentMethods, config?.paymentMethodsSource, config?.integrations, customer?.wallet]);

   const selectPaymentMethod = (method: ResolvedPaymentMethod) => {
      setActiveMethodKey(method.key);
      if (remaining > 0) {
         setInputAmount(
            formatRoundedInput(
               remaining / selectedCurrency.rate,
               method.definition?.foreignCurrencyRounding || 'NONE',
               selectedCurrency.code,
               baseCurrency.code
            )
         );
         setShouldClearInput(true);
      }
   };

   const activePaymentMethod = useMemo(
      () => configuredMethods.find(method => method.key === activeMethodKey) || configuredMethods[0] || null,
      [configuredMethods, activeMethodKey]
   );

   const activeMethod = activePaymentMethod?.type || 'CASH';
   const activeRuntimeMethod = activePaymentMethod
      ? resolvePaymentMethodTypeForRuntime(activePaymentMethod.type, activePaymentMethod.label, activePaymentMethod.id)
      : 'CASH';
   const activeForeignCurrencyRounding = activePaymentMethod?.definition?.foreignCurrencyRounding || 'NONE';
   const typedAmountInSelectedCurrency = Number.isFinite(typedAmount) && typedAmount > 0
      ? roundPaymentAmountByMethod(typedAmount, activeForeignCurrencyRounding, selectedCurrency.code, baseCurrency.code)
      : 0;
   const typedAmountInBase = typedAmountInSelectedCurrency > 0
      ? parseFloat((typedAmountInSelectedCurrency * selectedCurrency.rate).toFixed(2))
      : 0;
   const canFinalizeWithTypedAmount = Boolean(activePaymentMethod) && remaining > 0.01 && typedAmountInBase >= (remaining - 0.01);
   const canFinalize = remaining <= 0.01 || canFinalizeWithTypedAmount;
   const activeIsCxCCredit = activeRuntimeMethod === 'CREDIT';
   const activeIsIntegratedCard = activePaymentMethod?.definition?.type === 'CARD'
      && activePaymentMethod.definition.integrationMode === 'INTEGRATED';
   const activeIsLoyaltyRedeem = activePaymentMethod
      ? isLoyaltyRedeemMethod(activePaymentMethod.type, activePaymentMethod.label, activePaymentMethod.id)
      : false;
   const activeRequiresOnline =
      activeIsCxCCredit ||
      activeIsIntegratedCard ||
      activePaymentMethod?.type === 'WALLET' ||
      activeIsLoyaltyRedeem;

   const denominations = selectedCurrency.code === 'USD' ? [1, 5, 10, 20, 50, 100] : [50, 100, 200, 500, 1000, 2000];

   useEffect(() => {
      if (configuredMethods.length === 0) return;
      if (!configuredMethods.some(method => method.key === activeMethodKey)) {
         setActiveMethodKey(configuredMethods[0].key);
      }
   }, [configuredMethods, activeMethodKey]);

   useEffect(() => {
      if (remaining > 0) {
         const suggestedAmount = formatRoundedInput(
            remaining / selectedCurrency.rate,
            activeForeignCurrencyRounding,
            selectedCurrency.code,
            baseCurrency.code
         );
         setInputAmount(suggestedAmount);
         setShouldClearInput(true);
      } else {
         setInputAmount('');
         setShouldClearInput(false);
      }
   }, [remaining, activeMethod, selectedCurrency, activeForeignCurrencyRounding, baseCurrency.code]);

   const handleNumPad = (key: string) => {
      if (key === 'C') { setInputAmount(''); setShouldClearInput(false); return; }
      if (key === 'BACK') { setInputAmount(prev => prev.slice(0, -1)); return; }
      if (shouldClearInput) {
         setShouldClearInput(false);
         setInputAmount(key === '.' ? '0.' : key);
      } else {
         if (key === '.' && inputAmount.includes('.')) return;
         if (inputAmount.includes('.') && inputAmount.split('.')[1].length >= 2) return;
         setInputAmount(prev => prev + key);
      }
   };

   const canBypassCreditLimit = isOverrideActive || hasPermission('POS_CREDIT_OVERRIDE');

   const isCreditActionBlocked = useMemo(() => {
      if (canBypassCreditLimit) return false;
      const creditInPayments = sumCreditPaymentsBase(payments);
      const activeProjected = canFinalizeWithTypedAmount && activeIsCxCCredit ? typedAmountInBase : 0;
      const projectedCreditTotal = creditInPayments + activeProjected;
      
      if (projectedCreditTotal > 0) {
         const gate = evaluateCreditSupervisorGate(customer, 0, projectedCreditTotal);
         if (gate) return true;
      }
      return false;
   }, [canBypassCreditLimit, payments, canFinalizeWithTypedAmount, activeIsCxCCredit, typedAmountInBase, customer]);

   const enforceCreditRules = (projectedCreditTotal: number): boolean => {
      const gate = evaluateCreditSupervisorGate(customer, 0, projectedCreditTotal);
      if (!gate) return true;

      if (gate.reason === 'NO_CUSTOMER') {
         setFinalizeError('Las ventas a crédito pendientes requieren un cliente asociado antes de guardar el ticket.');
         return false;
      }

      if (canBypassCreditLimit) {
         return true;
      }

      if (gate.reason === 'NO_LIMIT') {
         setFinalizeError('El cliente no tiene un límite de crédito configurado. Requiere autorización.');
      } else {
         setFinalizeError(`Límite de crédito excedido (${currencySymbol}${gate.limit.toFixed(2)}). Requiere autorización.`);
      }
      setShowSupervisorModal(true);
      return false;
   };

   const resolveGatewayDisplayName = (
      integration?: PaymentIntegrationDefinition,
      fallbackProvider?: string
   ): string => {
      return integration?.name?.trim() || integration?.provider || fallbackProvider || 'Procesador de pago';
   };

   const getMethodRuntimeType = (method: ResolvedPaymentMethod): PaymentMethod =>
      resolvePaymentMethodTypeForRuntime(method.type, method.label, method.id);

   const isIntegratedCardMethod = (method?: ResolvedPaymentMethod | null): boolean =>
      method?.definition?.type === 'CARD' && method.definition.integrationMode === 'INTEGRATED';

   const resolvePaymentMethodForEntry = (payment: PaymentEntry): ResolvedPaymentMethod | undefined => {
      if (payment.methodId) {
         const exactMethod = configuredMethods.find((method) => method.id === payment.methodId);
         if (exactMethod) return exactMethod;
      }

      return configuredMethods.find((method) => {
         const sameType = getMethodRuntimeType(method) === payment.method;
         const sameLabel = payment.methodLabel ? method.label === payment.methodLabel : true;
         return sameType && sameLabel;
      });
   };

   const resolveGatewayIntegrationForPayment = (
      payment: PaymentEntry,
      method?: ResolvedPaymentMethod
   ): PaymentIntegrationDefinition | undefined => {
      if (payment.gatewayIntegrationId) {
         const integrationById = config?.integrations?.find((integration) => integration.id === payment.gatewayIntegrationId);
         if (integrationById) return integrationById;
      }

      if (method?.integration) {
         return method.integration;
      }

      if (payment.gatewayProvider) {
         return config?.integrations?.find((integration) => integration.provider === payment.gatewayProvider);
      }

      return undefined;
   };

   const resolveGatewaySummaryLabel = (payment: PaymentEntry): string => {
      const integration = resolveGatewayIntegrationForPayment(payment, resolvePaymentMethodForEntry(payment));
      return resolveGatewayDisplayName(integration, payment.gatewayProvider || 'Procesador');
   };

   const calculateGatewayTaxAmount = (amountInBase: number): number =>
      absTotal > 0
         ? roundToTwo(Math.min(amountInBase, absTotal) / absTotal * Math.max(0, taxAmount))
         : 0;

   const buildLocalPaymentEntry = (
      method: ResolvedPaymentMethod,
      valInSelectedCurrency: number,
      amountInBase: number
   ): PaymentEntry => ({
      id: createPaymentId(),
      method: getMethodRuntimeType(method),
      methodId: method.id,
      methodLabel: method.label,
      methodIcon: method.iconName,
      creditOverrideApproved: getMethodRuntimeType(method) === 'CREDIT' && canBypassCreditLimit ? true : undefined,
      amount: roundToTwo(amountInBase),
      timestamp: new Date(),
      currencyCode: selectedCurrency.code,
      amountOriginal: roundToTwo(valInSelectedCurrency),
      exchangeRate: selectedCurrency.rate,
   });

   const buildPendingIntegratedCardPayment = (
      method: ResolvedPaymentMethod,
      valInSelectedCurrency: number,
      amountInBase: number
   ): PaymentEntry => {
      if (!isIntegratedCardMethod(method) || !method.integration) {
         throw new Error('La tarjeta integrada no tiene una integración asignada.');
      }

      if (amountInBase > remaining + 0.01) {
         throw new Error('La tarjeta integrada no puede cobrar más que el restante del ticket.');
      }

      return {
         ...buildLocalPaymentEntry(method, valInSelectedCurrency, amountInBase),
         gatewayProvider: method.integration.provider,
         gatewayIntegrationId: method.integration.id,
         gatewayTransactionType: 'SALE',
         gatewayStatus: 'PENDING',
         gatewayResponseMessage: 'Pendiente de autorización al finalizar.',
      };
   };

   const authorizeIntegratedCardPayment = async (payment: PaymentEntry): Promise<PaymentEntry> => {
      const method = resolvePaymentMethodForEntry(payment);
      const integration = resolveGatewayIntegrationForPayment(payment, method);

      if (!integration) {
         throw new Error('La tarjeta integrada no tiene una integración asignada.');
      }

      const amountInBase = roundToTwo(Number(payment.amount || 0));
      const valInSelectedCurrency = roundToTwo(
         Number(payment.amountOriginal || 0) > 0
            ? Number(payment.amountOriginal)
            : amountInBase / Number(payment.exchangeRate || selectedCurrency.rate || 1)
      );
      const proportionalTax = calculateGatewayTaxAmount(amountInBase);
      const orderNumber = createAzulOrderNumber();
      const intent = await paymentIntentService.create({
         paymentId: payment.id,
         provider: integration.provider,
         integrationId: integration.id,
         amount: amountInBase,
         currencyCode: payment.currencyCode || baseCurrency.code,
      });
      if (intent) await paymentIntentService.markAuthorizing(intent.intentId);

      setIsProcessingGateway(true);
      setFinalizeError(null);
      setGatewayProgress({
         title: 'Procesando pago',
         providerLabel: resolveGatewayDisplayName(integration, integration.provider),
         detail: 'Espere la confirmación del procesador.',
      });
      try {
         const requestDetails: Record<string, string> = {
            Amount: amountInBase.toFixed(2),
         };

         const gatewayResult = integration.provider === 'AZUL'
            ? await azulMcmService.sale(integration, {
               amount: amountInBase,
               itbis: proportionalTax,
               orderNumber,
               installment: '0',
            })
            : integration.provider === 'INGENICO_AZUL_WEBAPI'
               ? await ingenicoAzulWebApiService.sale(integration, {
                  amount: amountInBase,
               })
               : integration.provider === 'CARDNET'
                  ? await cardNetEcrService.sale(integration, {
                     amount: amountInBase,
                     itbis: proportionalTax,
                     invoiceTicket: generateCardNetInvoiceTicket(),
                  })
                  : (() => {
                     throw new Error(`La integración ${integration.provider} todavía no está soportada en caja.`);
                  })();

         if (integration.provider === 'AZUL') {
            requestDetails.Itbis = proportionalTax.toFixed(2);
            requestDetails.OrderNumber = orderNumber;
         }

         if (integration.provider === 'CARDNET') {
            requestDetails.Itbis = proportionalTax.toFixed(2);
            requestDetails.Ticket = 'invoiceNumber' in gatewayResult ? (gatewayResult.invoiceNumber || '') : '';
            requestDetails.Trama = 'CN00';
         }

         const gatewayReference = 'referenceNumber' in gatewayResult
            ? gatewayResult.referenceNumber
            : ('transactionReference' in gatewayResult ? gatewayResult.transactionReference : undefined);

         if (intent) {
            await paymentIntentService.markAuthorized(intent.intentId, {
               providerReference: gatewayReference,
               authorizationCode: gatewayResult.authorizationCode,
               responseCode: gatewayResult.responseCode,
            });
         }

         if (config) {
            await dispatchAuditEventConfigUpdate(
               config,
               integration.id,
               createPaymentIntegrationAuditEvent(integration, {
                  action: 'SALE',
                  status: gatewayResult.approved ? 'SUCCESS' : 'FAILED',
                  message: gatewayResult.responseMessage || 'Pago aprobado por el procesador.',
                  requestDetails,
                  responseDetails: {
                     MerchantId: gatewayResult.merchantId || integration.merchantId || '',
                     TerminalId: gatewayResult.terminalId || integration.terminalId || '',
                     EntryMode: gatewayResult.entryMode || '',
                     CardBrand: gatewayResult.cardBrand || '',
                  },
                  responseCode: gatewayResult.responseCode,
                  responseMessage: gatewayResult.responseMessage,
                  authorizationCode: gatewayResult.authorizationCode,
                  referenceNumber: gatewayReference,
                  invoiceNumber: gatewayResult.invoiceNumber,
                  sequenceNumber: 'sequenceNumber' in gatewayResult
                     ? gatewayResult.sequenceNumber
                     : undefined,
                  maskedPan: gatewayResult.maskedPan,
                  entryMode: gatewayResult.entryMode,
                  merchantId: gatewayResult.merchantId,
                  terminalId: gatewayResult.terminalId,
               })
            );
         }

         return {
            ...payment,
            gatewayProvider: integration.provider,
            gatewayIntegrationId: integration.id,
            paymentIntentId: intent?.intentId,
            gatewayIdempotencyKey: intent?.idempotencyKey,
            gatewayTransactionType: 'SALE',
            gatewayStatus: gatewayResult.approved ? 'APPROVED' : 'DECLINED',
            gatewayResponseCode: gatewayResult.responseCode,
            gatewayResponseMessage: gatewayResult.responseMessage,
            gatewayOrderNumber: 'orderNumber' in gatewayResult ? (gatewayResult.orderNumber || orderNumber) : orderNumber,
            gatewayProcessedAmount: roundToTwo(amountInBase),
            gatewayProcessedTaxAmount: integration.provider === 'AZUL' || integration.provider === 'CARDNET'
               ? roundToTwo(proportionalTax)
               : 0,
            gatewayAuthorizationCode: gatewayResult.authorizationCode,
            gatewayReference,
            gatewaySequenceNumber: 'sequenceNumber' in gatewayResult
               ? gatewayResult.sequenceNumber
               : undefined,
            gatewayInvoiceNumber: gatewayResult.invoiceNumber,
            gatewayBatchNumber: gatewayResult.batchNumber,
            gatewayMerchantId: gatewayResult.merchantId,
            gatewayTerminalId: gatewayResult.terminalId,
            gatewayMaskedPan: gatewayResult.maskedPan,
            gatewayCardBrand: gatewayResult.cardBrand,
            gatewayEntryMode: gatewayResult.entryMode,
            gatewayHost: integration.provider === 'CARDNET' && 'host' in gatewayResult
               ? gatewayResult.host
               : undefined,
            gatewayCardProduct: integration.provider === 'CARDNET' && 'productType' in gatewayResult
               ? String(gatewayResult.productType || '')
               : undefined,
            gatewayReceiptMerchant: gatewayResult.receiptMerchant,
            gatewayReceiptClient: gatewayResult.receiptClient,
            gatewaySignatureData: 'signatureData' in gatewayResult ? gatewayResult.signatureData : undefined,
            gatewayRequireSignature: ('requireSignature' in gatewayResult ? gatewayResult.requireSignature : false) || !!method?.definition?.requiresSignature,
            gatewayRawResponse: gatewayResult.rawResponse,
         };
      } catch (error) {
         const gatewayError = error instanceof AzulGatewayError ? error : null;
         const ingenicoError = error instanceof IngenicoAzulWebApiError ? error : null;
         const cardNetError = error instanceof CardNetEcrError ? error : null;
         if (intent) {
            const normalized = gatewayError?.normalized || ingenicoError?.normalized || cardNetError?.parsed;
            await paymentIntentService.markFailed(intent.intentId, {
               declined: Boolean(normalized && normalized.approved === false),
               error: error instanceof Error ? error.message : 'Resultado desconocido del procesador.',
               responseCode: normalized?.responseCode,
            });
         }
         if (config) {
            await dispatchAuditEventConfigUpdate(
               config,
               integration.id,
               createPaymentIntegrationAuditEvent(integration, {
                  action: 'SALE',
                  status: 'FAILED',
                  message: error instanceof Error ? error.message : 'No se pudo completar la venta integrada.',
                  requestDetails: integration.provider === 'AZUL'
                     ? {
                        Amount: amountInBase.toFixed(2),
                        Itbis: proportionalTax.toFixed(2),
                        OrderNumber: orderNumber,
                     }
                     : integration.provider === 'CARDNET'
                        ? {
                           Amount: amountInBase.toFixed(2),
                           Itbis: proportionalTax.toFixed(2),
                           Trama: 'CN00',
                           Endpoint: integration.baseUrl,
                        }
                        : {
                           Amount: amountInBase.toFixed(2),
                        },
                  responseDetails: {
                     MerchantId:
                        gatewayError?.normalized?.merchantId ||
                        ingenicoError?.normalized?.merchantId ||
                        integration.merchantId ||
                        '',
                     TerminalId:
                        gatewayError?.normalized?.terminalId ||
                        ingenicoError?.normalized?.terminalId ||
                        integration.terminalId ||
                        '',
                     EntryMode: gatewayError?.normalized?.entryMode || ingenicoError?.normalized?.entryMode || '',
                     CardBrand: gatewayError?.normalized?.cardBrand || ingenicoError?.normalized?.cardBrand || '',
                     ...(cardNetError?.transcript ? { Traza: cardNetError.transcript.slice(0, 400) } : {}),
                  },
                  responseCode:
                     gatewayError?.normalized?.responseCode ||
                     gatewayError?.response?.ResponseCode ||
                     ingenicoError?.normalized?.responseCode ||
                     cardNetError?.parsed?.responseCode,
                  responseMessage:
                     gatewayError?.normalized?.responseMessage ||
                     gatewayError?.response?.ResponseMessage ||
                     ingenicoError?.normalized?.responseMessage ||
                     cardNetError?.parsed?.responseMessage,
                  authorizationCode:
                     gatewayError?.normalized?.authorizationCode ||
                     ingenicoError?.normalized?.authorizationCode ||
                     cardNetError?.parsed?.sale?.authorizationCode,
                  referenceNumber:
                     gatewayError?.normalized?.referenceNumber ||
                     ingenicoError?.normalized?.transactionReference ||
                     cardNetError?.parsed?.sale?.referenceNumber,
                  invoiceNumber: gatewayError?.normalized?.invoiceNumber || ingenicoError?.normalized?.invoiceNumber,
                  sequenceNumber: gatewayError?.normalized?.sequenceNumber || cardNetError?.parsed?.sale?.sequenceNumber,
                  maskedPan:
                     gatewayError?.normalized?.maskedPan ||
                     ingenicoError?.normalized?.maskedPan ||
                     cardNetError?.parsed?.sale?.maskedPan,
                  entryMode:
                     gatewayError?.normalized?.entryMode ||
                     ingenicoError?.normalized?.entryMode ||
                     cardNetError?.parsed?.sale?.entryMode,
                  merchantId: gatewayError?.normalized?.merchantId || ingenicoError?.normalized?.merchantId,
                  terminalId:
                     gatewayError?.normalized?.terminalId ||
                     ingenicoError?.normalized?.terminalId ||
                     cardNetError?.parsed?.sale?.terminalId,
               })
            );
         }
         throw error;
      } finally {
         setIsProcessingGateway(false);
         setGatewayProgress(null);
      }
   };

   const buildPaymentEntry = (method: ResolvedPaymentMethod, valInSelectedCurrency: number): PaymentEntry => {
      const amountInBase = roundToTwo(valInSelectedCurrency * selectedCurrency.rate);
      if (isIntegratedCardMethod(method)) {
         return buildPendingIntegratedCardPayment(method, valInSelectedCurrency, amountInBase);
      }
      return buildLocalPaymentEntry(method, valInSelectedCurrency, amountInBase);
   };

   const paymentRequiresGatewayAuthorization = (payment: PaymentEntry): boolean =>
      payment.gatewayTransactionType === 'SALE' &&
      payment.gatewayStatus === 'PENDING' &&
      !!payment.gatewayProvider;

   const authorizePendingGatewayPayments = async (entries: PaymentEntry[]): Promise<PaymentEntry[]> => {
      const processedEntries: PaymentEntry[] = [];
      for (const entry of entries) {
         if (paymentRequiresGatewayAuthorization(entry)) {
            processedEntries.push(await authorizeIntegratedCardPayment(entry));
         } else {
            processedEntries.push(entry);
         }
      }
      return processedEntries;
   };

   const handleAddPayment = async (amountOverride?: number) => {
      const rawAmount = amountOverride !== undefined ? amountOverride : parseFloat(inputAmount);
      const valInSelectedCurrency = roundPaymentAmountByMethod(
         rawAmount,
         activeForeignCurrencyRounding,
         selectedCurrency.code,
         baseCurrency.code
      );
      if (!valInSelectedCurrency || valInSelectedCurrency <= 0) return;
      if (!activePaymentMethod) {
         setFinalizeError('Seleccione un método de pago.');
         return;
      }

      // Permission Check: Credit requires POS_PAY_CREDIT
      if (activeIsCxCCredit && !hasPermission('POS_PAY_CREDIT')) {
         setFinalizeError(`No tiene permisos para realizar ventas a crédito.`);
         return;
      }

      // Strict Online Check: Credit and Wallet require connection (unless Master)
      if (!isOnline && !isMaster && activeRequiresOnline) {
         setFinalizeError(`El pago con ${activePaymentMethod.label} requiere conexión con la Terminal Master.`);
         return;
      }

      const amountInBase = roundToTwo(valInSelectedCurrency * selectedCurrency.rate);

      if (activeIsCxCCredit) {
         const projectedCreditTotal = sumCreditPaymentsBase(payments) + amountInBase;
         if (!enforceCreditRules(projectedCreditTotal)) {
            return;
         }
      }

      try {
         setFinalizeError(null);
         const newPayment = buildPaymentEntry(activePaymentMethod, valInSelectedCurrency);
         setPayments((prev) => [...prev, newPayment]);
         setInputAmount(
            formatRoundedInput(valInSelectedCurrency, activeForeignCurrencyRounding, selectedCurrency.code, baseCurrency.code)
         );
         setShouldClearInput(true);
         setFinalizeError(null);
      } catch (error) {
         setFinalizeError(error instanceof Error ? error.message : 'No se pudo agregar el pago.');
      }
   };

   const handleRemovePayment = (id: string) => { setPayments(prev => prev.filter(p => p.id !== id)); };

   const handleFinalize = async () => {
      recordCheckoutDiagnostic('PAYMENT_MODAL_CONFIRM', { items, total, payments });
      if (isFinalizing || isProcessingGateway) return;
      if (!canFinalize) {
         alert("Monto insuficiente");
         return;
      }

      if (isCreditActionBlocked) {
         setFinalizeError('Límite de crédito excedido. Requiere autorización.');
         setShowSupervisorModal(true);
         return;
      }

      const trace = beginPosInteraction('PAYMENT_CONFIRM', { paymentCount: payments.length, itemCount: items.length });
      expectInteractionRender(trace, 'PAYMENT_MODAL');

      setFinalizeError(null);
      setSuccessNotice(null);
      setIsFinalizing(true);
      markInteractionStateUpdate(trace, 3);
      try {
         let paymentsToConfirm = payments;

         // UX: If cashier typed an amount but didn't press "Agregar",
         // auto-create the payment entry so "Finalizar Venta" still works.
         if (canFinalizeWithTypedAmount) {
            if (!activePaymentMethod) {
               setFinalizeError('Seleccione un método de pago.');
               return;
            }

            // Permission Check: Credit requires POS_PAY_CREDIT during auto-finalize too
            if (activeIsCxCCredit && !hasPermission('POS_PAY_CREDIT')) {
               setFinalizeError(`No tiene permisos para realizar ventas a crédito.`);
               setIsFinalizing(false);
               return;
            }

            // Strict Online Check: Credit and Wallet require connection during finalization too (unless Master)
            if (!isOnline && !isMaster && activeRequiresOnline) {
               setFinalizeError(`El pago con ${activePaymentMethod.label} requiere conexión con la Terminal Master.`);
               setIsFinalizing(false);
               return;
            }

            if (activeIsCxCCredit) {
               const projectedCreditTotal = sumCreditPaymentsBase(payments) + typedAmountInBase;
               if (!enforceCreditRules(projectedCreditTotal)) {
                  setIsFinalizing(false);
                  return;
               }
            }

            const autoPayment = buildPaymentEntry(activePaymentMethod, typedAmountInSelectedCurrency);
            paymentsToConfirm = [...payments, autoPayment];
            setPayments(paymentsToConfirm);
         }

         const totalCreditCommitted = sumCreditPaymentsBase(paymentsToConfirm);
         if (totalCreditCommitted > 0) {
            if (!enforceCreditRules(totalCreditCommitted)) {
               setIsFinalizing(false);
               return;
            }

            paymentsToConfirm = paymentsToConfirm.map((payment) =>
               paymentEntryIsCxCCredit(payment)
                  ? { ...payment, creditOverrideApproved: payment.creditOverrideApproved || canBypassCreditLimit }
                  : payment
            );
            setPayments(paymentsToConfirm);
         }

         // Zero Price Check
         const hasZeroPriceItem = items.some(item => item.price === 0);
         if (hasZeroPriceItem && !hasPermission('POS_ALLOW_ZERO_PRICE') && !isOverrideActive) {
            setFinalizeError(`Venta contiene artículos con precio en $0.00. Requiere autorización.`);
            setShowSupervisorModal(true);
            setIsFinalizing(false);
            return;
         }

         // Final safety check: ensure no CREDIT or WALLET payments are sent while offline (unless Master)
         if (!isOnline && !isMaster) {
            const blockedPayment = paymentsToConfirm.find(p =>
               p.method === 'CREDIT' ||
               p.method === 'WALLET' ||
               isLoyaltyRedeemMethod(p.method, p.methodLabel, p.methodId) ||
               paymentRequiresGatewayAuthorization(p)
            );
            if (blockedPayment) {
               setFinalizeError(`El pago con ${blockedPayment.methodLabel} requiere conexión con la Terminal Master.`);
               setIsFinalizing(false);
               return;
            }
         }

         paymentsToConfirm = await measureInteractionStage(
            trace,
            'SYNC_START',
            'SYNC_END',
            () => authorizePendingGatewayPayments(paymentsToConfirm),
         );
         setPayments(paymentsToConfirm);

         let slowProcessTimer: number | undefined;
         try {
            slowProcessTimer = window.setTimeout(() => {
               setFinalizeError('El cobro está tardando más de lo esperado, espere unos segundos...');
            }, 15000);
            const txn = await onConfirm(paymentsToConfirm, voluntaryTip);
            recordCheckoutDiagnostic('PAYMENT_RESULT', { items: txn?.items, total: txn?.total, transactionId: txn?.id, displayId: txn?.displayId, status: txn ? 'RETURNED' : 'NO_TRANSACTION' });

            if (txn) {
               if (slowProcessTimer) {
                  window.clearTimeout(slowProcessTimer);
                  slowProcessTimer = undefined;
               }
               const finalizedTransaction = txn.payments?.length
                  ? txn
                  : { ...txn, payments: paymentsToConfirm };
               const gatewayPayments = (finalizedTransaction.payments || []).filter((payment: any) => payment?.gatewayProvider);
               const preferredReceiptEmail = finalizedTransaction.customerSnapshot?.email || customer?.email;
               const shouldEmailReceiptOnly = Boolean(customer?.prefersEmail && preferredReceiptEmail);

               recordCheckoutDiagnostic('PRINT_DELIVERY_PLAN', {transactionId:txn.id,displayId:txn.displayId,
                  status:isInstallmentPayment ? 'INSTALLMENT_FLOW' : shouldEmailReceiptOnly ? 'EMAIL_ONLY' : gatewayPayments.length ? 'AUTO_GATEWAY_PRINT' : 'MANUAL_PRINT_BUTTON',
                  reason:'PLAN_ONLY_NOT_PRINT_CONFIRMATION'});

               // The sale is already durable. Render success before touching any
               // printer, cash drawer, email service or payment-gateway receipt.
               setSuccessNotice(null);
               setCompletedTransaction(finalizedTransaction);
               setIsSuccessScreen(true);

               window.setTimeout(() => {
                  void (async () => {
                     let deliveryNotice: string | null = null;

                     if (!isInstallmentPayment && config) {
                        try {
                           const drawerResult = await openCashDrawerForTransaction(finalizedTransaction, config);
                           if (drawerResult === 'FAILED') {
                              deliveryNotice = 'Venta aprobada, pero no se pudo abrir el cajón portamonedas.';
                           }
                        } catch (drawerError) {
                           console.error('❌ Cash drawer command failed:', drawerError);
                           deliveryNotice = 'Venta aprobada, pero ocurrió un problema al abrir el cajón portamonedas.';
                        }
                     }

                     if (!isInstallmentPayment && shouldEmailReceiptOnly && preferredReceiptEmail) {
                        try {
                           const emailResult = await sendReceiptEmailRequest(finalizedTransaction, preferredReceiptEmail, config, currencySymbol, users);
                           deliveryNotice = emailResult.success
                              ? `Ticket enviado automáticamente a ${preferredReceiptEmail}.`
                              : `Venta aprobada. No se pudo enviar automáticamente el ticket a ${preferredReceiptEmail}: ${emailResult.message || 'error desconocido'}.`;
                        } catch (emailError) {
                           console.error('❌ Auto receipt email failed:', emailError);
                           const reason = emailError instanceof Error ? emailError.message : 'error de conexión';
                           deliveryNotice = `Venta aprobada. No se pudo enviar automáticamente el ticket a ${preferredReceiptEmail}: ${reason}.`;
                        }
                     } else if (!isInstallmentPayment && config && gatewayPayments.length > 0) {
                        const matchedIntegration = config.integrations?.find(
                           (integration) => integration.id === gatewayPayments[0]?.gatewayIntegrationId
                        );
                        const providerLabel = resolveGatewayDisplayName(
                           matchedIntegration,
                           String(gatewayPayments[0]?.gatewayProvider || 'Procesador de pago')
                        );

                        setGatewayProgress({
                           title: 'Imprimiendo comprobantes',
                           providerLabel,
                           detail: 'Imprimiendo voucher y ticket automáticamente.',
                        });

                        try {
                           const printResult = await printIntegratedPaymentArtifacts(finalizedTransaction, config);
                           if (printResult.voucherCopiesFailed.length > 0) {
                              deliveryNotice = `Venta aprobada. No se pudo imprimir automáticamente: ${printResult.voucherCopiesFailed.join(', ')}.`;
                           }
                        } catch (printError) {
                           console.error('❌ Auto print after integrated approval failed:', printError);
                           deliveryNotice = 'Venta aprobada, pero ocurrió un problema al imprimir automáticamente.';
                        } finally {
                           setGatewayProgress(null);
                        }
                     }

                     setSuccessNotice(deliveryNotice);
                  })();
               }, 50);
            } else {
               setFinalizeError('No se pudo completar la venta. Verifique secuencia fiscal y configuración de terminal.');
            }
         } finally {
            if (slowProcessTimer) window.clearTimeout(slowProcessTimer);
         }
      } catch (error) {
         console.error('❌ Payment finalization failed:', error);
         const message = error instanceof Error ? error.message : '';
         setFinalizeError(message ? `Error al finalizar: ${message}` : 'Ocurrió un error al finalizar. Intente nuevamente.');
         setGatewayProgress(null);
      } finally {
         setIsFinalizing(false);
         if (trace.stages.HANDLER_END === undefined) markInteractionStage(trace, 'HANDLER_END');
      }
   };

   const themeBgClass = { blue: 'bg-blue-600', orange: 'bg-orange-600', gray: 'bg-gray-800' }[themeColor] || 'bg-indigo-600';
   const themeTextClass = { blue: 'text-blue-600', orange: 'text-orange-600', gray: 'text-gray-800' }[themeColor] || 'text-indigo-600';

   const getEntryIcon = (payment: PaymentEntry): React.ElementType => {
      if (payment.methodIcon && PAYMENT_ICON_BY_NAME[payment.methodIcon]) {
         return PAYMENT_ICON_BY_NAME[payment.methodIcon];
      }
      return getDefaultIconByType(payment.method);
   };

   const getEntryLabel = (payment: PaymentEntry): string => {
      return payment.methodLabel || getDefaultLabelByType(payment.method);
   };

   const [showEmailInput, setShowEmailInput] = useState(false);
   const [emailInput, setEmailInput] = useState('');
   const [isSendingEmail, setIsSendingEmail] = useState(false);
   const completedPaymentSettlement = useMemo(
      () => completedTransaction
         ? buildPaymentSettlementSummary(
            Array.isArray(completedTransaction.payments) ? completedTransaction.payments as PaymentEntry[] : [],
            Math.abs(Number(completedTransaction.total || 0)),
            baseCurrency.code
         )
         : null,
      [completedTransaction, baseCurrency.code]
   );

   const gatewayProgressOverlay = gatewayProgress ? (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
         <div className="w-full max-w-sm rounded-[2rem] bg-white px-8 py-10 text-center shadow-2xl border border-slate-100">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-indigo-50">
               <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
            </div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-indigo-500">{gatewayProgress.providerLabel}</p>
            <h3 className="mt-3 text-2xl font-black text-slate-900">{gatewayProgress.title}</h3>
            <p className="mt-3 text-sm font-semibold text-slate-500">{gatewayProgress.detail}</p>
         </div>
      </div>
   ) : null;

   const handleSendEmail = async () => {
      if (!completedTransaction) return;

      // 1. Check if customer has email
      const customerEmail = completedTransaction.customerSnapshot?.email || customer?.email;

      if (customerEmail) {
         await sendReceiptEmail(customerEmail);
      } else {
         // 2. Show input if no email
         setShowEmailInput(true);
      }
   };

   const sendReceiptEmail = async (email: string) => {
      if (!completedTransaction) return;
      setIsSendingEmail(true);
      console.log('Sending Receipt Email. Transaction:', completedTransaction);
      try {
         const data = await sendReceiptEmailRequest(completedTransaction, email, config, currencySymbol, users);
         if (data.success) {
            alert(`Ticket enviado a ${email}`);
            setShowEmailInput(false);
            if (!canStartNewSale) onClose();
         } else {
            alert('Error al enviar: ' + data.message);
         }
      } catch (error) {
         console.error('Error sending email:', error);
         alert(`Error al enviar: ${error instanceof Error ? error.message : 'error de conexión'}`);
      } finally {
         setIsSendingEmail(false);
      }
   };

   if (isSuccessScreen) {
      return (
         <>
            {gatewayProgressOverlay}
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/90 backdrop-blur-md p-4">
               <div className="bg-white rounded-[2.5rem] w-full max-w-lg p-8 shadow-2xl flex flex-col items-center text-center relative">

               {/* Email Input Modal Overlay */}
               {showEmailInput && (
                  <div className="absolute inset-0 z-10 bg-white/95 backdrop-blur-sm rounded-[2.5rem] flex flex-col items-center justify-center p-8 animate-in fade-in">
                     <h3 className="text-xl font-black text-gray-800 mb-4">Enviar Ticket por Correo</h3>
                     <input
                        autoFocus
                        type="email"
                        placeholder="cliente@ejemplo.com"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        className="w-full p-4 bg-gray-100 rounded-xl border-2 border-transparent focus:border-blue-500 focus:bg-white outline-none transition-all mb-4 text-center font-bold text-lg"
                        onKeyDown={(e) => e.key === 'Enter' && sendReceiptEmail(emailInput)}
                     />
                     <div className="flex gap-3 w-full">
                        <button
                           onClick={() => setShowEmailInput(false)}
                           className="flex-1 py-3 rounded-xl bg-gray-200 font-bold text-gray-600 hover:bg-gray-300"
                        >
                           Cancelar
                        </button>
                        <button
                           onClick={() => sendReceiptEmail(emailInput)}
                           disabled={!emailInput || isSendingEmail}
                           className="flex-1 py-3 rounded-xl bg-blue-600 font-bold text-white hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                           {isSendingEmail ? 'Enviando...' : 'Enviar'}
                           <Mail size={18} />
                        </button>
                     </div>
                  </div>
               )}

               <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
                  <CheckCircle2 size={40} className="text-green-600" />
               </div>
               <h2 className="text-3xl font-black text-gray-900 mb-2">{isInstallmentPayment ? 'Cuota registrada' : '¡Venta Exitosa!'}</h2>
               <div className="w-full bg-gray-50 rounded-2xl p-6 mb-8 border border-gray-100">
                  <div className="flex items-end justify-between gap-4 mb-2">
                     <span className="text-lg md:text-xl font-black text-gray-700">Recibido</span>
                     <span className="text-3xl md:text-4xl font-black text-gray-900">
                        {currencySymbol}{(completedPaymentSettlement?.totalReceivedBase ?? totalPaid).toFixed(2)}
                     </span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-gray-200 mt-2">
                     <span className="font-bold text-gray-600">Aplicado</span>
                     <span className="font-black text-gray-900 text-2xl">
                        {currencySymbol}{(completedPaymentSettlement?.totalAppliedBase ?? absTotal).toFixed(2)}
                     </span>
                  </div>
                  {(completedPaymentSettlement?.totalChangeBase ?? change) > 0 && (
                     <div className="flex justify-between items-center pt-2 border-t border-gray-200 mt-2">
                        <span className="text-green-600 font-bold">Cambio</span>
                        <span className="font-black text-green-600 text-2xl">
                           {currencySymbol}{(completedPaymentSettlement?.totalChangeBase ?? change).toFixed(2)}
                        </span>
                     </div>
                  )}
                  {completedPaymentSettlement?.settlementCurrencyCode && completedPaymentSettlement.settlementCurrencyCode !== baseCurrency.code && (
                     <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-left">
                        <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">
                           Cobro en {completedPaymentSettlement.settlementCurrencyCode}
                        </p>
                        <div className="mt-2 flex items-center justify-between text-sm">
                           <span className="font-semibold text-blue-800">Recibido</span>
                           <span className="font-black text-blue-900">
                              {resolveCurrencySymbol(config, completedPaymentSettlement.settlementCurrencyCode, completedPaymentSettlement.settlementCurrencyCode)}
                              {(completedPaymentSettlement.settlementReceivedOriginal || 0).toFixed(2)}
                           </span>
                        </div>
                        {completedPaymentSettlement.settlementExchangeRate ? (
                           <div className="mt-1 flex items-center justify-between text-sm">
                              <span className="font-semibold text-blue-800">Tasa</span>
                              <span className="font-black text-blue-900">
                                 {currencySymbol}{completedPaymentSettlement.settlementExchangeRate.toFixed(2)}
                              </span>
                           </div>
                        ) : null}
                     </div>
                  )}
               </div>
               <div className="w-full space-y-3">
                  {successNotice && (
                     <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-xs font-bold text-amber-700">
                        {successNotice}
                     </div>
                  )}
                  {!isInstallmentPayment && <div className="flex gap-3">
                     <button
                        onClick={async () => {
                           if (!config || !completedTransaction || printTicketPending.current) return;
                           printTicketPending.current = true;
                           setIsPrintingTicket(true);
                           try {
                              const accepted = await printTicket(completedTransaction, config);
                              setSuccessNotice(accepted
                                 ? 'Ticket enviado a impresión. Comprueba la salida antes de imprimir otra copia.'
                                 : 'La venta está registrada. Revisa la impresora y vuelve a pulsar Ticket para reintentar sin repetir el cobro.');
                              if (accepted && !canStartNewSale) onClose();
                           } finally {
                              printTicketPending.current = false;
                              setIsPrintingTicket(false);
                           }
                        }}
                        disabled={isPrintingTicket}
                        className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-700 flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors disabled:opacity-50"
                     >
                        <Printer size={18} /> {isPrintingTicket ? 'Enviando...' : 'Ticket'}
                     </button>

                     <button
                        onClick={handleSendEmail}
                        disabled={isSendingEmail}
                        className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-700 flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
                     >
                        {isSendingEmail ? 'Enviando...' : 'Email'}
                        <Mail size={18} />
                     </button>
                  </div>}
                  {canStartNewSale && (
                     <button onClick={onClose} className={`w-full py-4 rounded-xl font-bold text-white shadow-xl flex items-center justify-center gap-2 ${themeBgClass}`}><Repeat size={20} /> {isInstallmentPayment ? 'Continuar con la cuenta' : 'Nueva Venta'}</button>
                  )}
               </div>
            </div>
            </div>
         </>
      );
   }

   return (
      <>
         {gatewayProgressOverlay}
         <div className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center bg-black/60 backdrop-blur-sm lg:p-3">
            <div className="bg-white w-full max-w-6xl h-[100dvh] lg:h-[92dvh] lg:max-h-[760px] lg:rounded-[2.5rem] shadow-2xl flex flex-col lg:flex-row overflow-hidden">

            {/* SUMMARY SECTION (Collapsible/Header on mobile, Sidebar on desktop) */}
            <div className="flex lg:w-[34%] w-full bg-gray-50 border-b lg:border-b-0 lg:border-r border-gray-200 flex-col p-4 md:p-5 lg:p-6 shrink-0 min-h-0">
               <div className="flex justify-between items-center mb-3 lg:mb-4">
                  <button onClick={onClose} className="p-2 -ml-2 text-gray-400 hover:bg-gray-200 rounded-full transition-colors"><X size={24} /></button>
                  <div className="flex md:hidden gap-1">
                     {currencies.filter(c => c.isEnabled).map(c => (
                        <button
                           key={c.code}
                           onClick={() => setSelectedCurrency(c)}
                           className={`px-3 py-1 rounded-lg text-[10px] font-black transition-all border ${selectedCurrency.code === c.code ? `border-blue-600 text-blue-600 bg-white` : 'border-transparent text-gray-400 bg-gray-100'}`}
                        >
                           {c.code}
                        </button>
                     ))}
                  </div>
               </div>

               <div className="mb-3 md:mb-4 lg:mb-4 flex flex-col md:block items-center md:items-start text-center md:text-left">
                  <p className={`font-medium uppercase text-[10px] md:text-xs tracking-widest mb-1 ${isRefund ? 'text-rose-500' : 'text-gray-500'}`}>
                     {isRefund ? 'Monto a Devolver' : 'Total a Cobrar'}
                  </p>
                  <h1 className={`text-3xl md:text-4xl lg:text-[2.7rem] font-black leading-none ${isRefund ? 'text-rose-600' : 'text-gray-900'}`}>
                     {currencySymbol}{effectiveTotalToPay.toFixed(2)}
                  </h1>
                  {voluntaryTip > 0 && (
                     <p className="text-[10px] font-bold text-sky-600 mt-1 uppercase tracking-wider">
                        Incluye {currencySymbol}{voluntaryTip.toFixed(2)} de propina voluntaria
                     </p>
                  )}
               </div>

               {shouldShowTipSuggestions && (
                  <div className="mb-3 md:mb-4 lg:mb-4 p-3 rounded-2xl bg-sky-50 border border-sky-100">
                     <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] font-black uppercase text-sky-600 tracking-wider flex items-center gap-1.5">
                           <Percent size={13} /> Propina sugerida
                        </span>
                        {allowCustomTip && (
                           <div className="flex items-center gap-1">
                              <span className="text-xs font-bold text-sky-400">{currencySymbol}</span>
                              <input
                                 type="number"
                                 value={voluntaryTip || ''}
                                 onChange={(e) => setVoluntaryTip(Math.max(0, parseFloat(e.target.value) || 0))}
                                 className="w-20 bg-transparent border-b border-sky-200 focus:border-sky-500 outline-none text-right font-black text-sky-700"
                                 placeholder="0.00"
                              />
                           </div>
                        )}
                     </div>
                     <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                        {suggestedTipOptions.map((percentage) => {
                           const suggestedAmount = resolveSuggestedTipAmount(absTotal, percentage);
                           const isSelected = Math.abs(voluntaryTip - suggestedAmount) < 0.01;
                           return (
                              <button
                                 key={percentage}
                                 onClick={() => setVoluntaryTip(suggestedAmount)}
                                 className={`whitespace-nowrap px-3 py-1.5 rounded-xl border text-[10px] font-bold transition-all active:scale-95 shadow-sm ${
                                    isSelected
                                       ? 'bg-sky-600 border-sky-600 text-white'
                                       : 'bg-white border-sky-200 text-sky-700 hover:bg-sky-100'
                                 }`}
                                 title={`${percentage}% = ${currencySymbol}${suggestedAmount.toFixed(2)}`}
                              >
                                 {percentage}% · {currencySymbol}{suggestedAmount.toFixed(2)}
                              </button>
                           );
                        })}
                        {allowCustomTip && fixedTipAmounts.map(amt => (
                           <button
                              key={`add-${amt}`}
                              onClick={() => setVoluntaryTip(prev => roundToTwo(prev + amt))}
                              className="whitespace-nowrap px-3 py-1.5 rounded-xl bg-white border border-sky-200 text-[10px] font-bold text-sky-700 hover:bg-sky-100 transition-all active:scale-95 shadow-sm"
                           >
                              +{amt}
                           </button>
                        ))}
                        <button
                           onClick={() => setVoluntaryTip(0)}
                           className="px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-100 text-[10px] font-bold text-rose-600 hover:bg-rose-100 transition-all active:scale-95"
                        >
                           Sin propina
                        </button>
                     </div>
                  </div>
               )}

                  <div className="hidden lg:flex mt-1 lg:mt-2 gap-2">
                     {currencies.filter(c => c.isEnabled).map(c => (
                        <button
                           key={c.code}
                           onClick={() => setSelectedCurrency(c)}
                           className={`px-3 py-2 rounded-xl text-xs font-black transition-all border-2 ${selectedCurrency.code === c.code ? `border-current ${themeTextClass} bg-white shadow-sm` : 'border-transparent text-gray-400 bg-gray-100'}`}
                        >
                           {c.code}
                        </button>
                     ))}
                  </div>

               {/* Payments List (Compact on mobile) */}
               <div className="flex-1 min-h-[72px] overflow-y-auto space-y-2 no-scrollbar max-h-[30vh] lg:max-h-none">
                  {payments.map(p => {
                     const EntryIcon = getEntryIcon(p);
                     const previewLine = paymentPreviewById.get(p.id);
                     const displayCurrencyCode = previewLine?.currencyCode || p.currencyCode || baseCurrency.code;
                     const displayCurrencySymbol = resolveCurrencySymbol(config, displayCurrencyCode, currencySymbol);
                     const displayReceivedOriginal = previewLine?.receivedOriginal ?? Number(p.amountOriginal || p.amount || 0);
                     const displayReceivedBase = previewLine?.receivedBase ?? Number(p.amount || 0);
                     const displayChangeBase = previewLine?.changeBase ?? Number(p.changeAmount || 0);
                     const displayExchangeRate = previewLine?.exchangeRate ?? Number(p.exchangeRate || 1);
                     return (
                        <div key={p.id} className="flex justify-between items-center bg-white p-3 rounded-xl md:rounded-2xl shadow-sm border border-gray-100 animate-in slide-in-from-left-2">
                           <div className="flex items-center gap-2 md:gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-slate-700 border border-blue-100">
                                 <EntryIcon size={16} strokeWidth={2.2} />
                              </div>
                              <div>
                                 <span className="font-bold text-[10px] md:text-xs text-gray-800 block">{getEntryLabel(p)}</span>
                                 {displayCurrencyCode !== baseCurrency.code ? (
                                    <span className="text-[9px] md:text-[10px] text-gray-500 font-bold block">
                                       Recibido {displayCurrencySymbol}{displayReceivedOriginal.toFixed(2)} · Tasa {currencySymbol}{displayExchangeRate.toFixed(2)}
                                    </span>
                                 ) : null}
                                 {displayCurrencyCode !== baseCurrency.code ? (
                                    <span className="text-[9px] md:text-[10px] text-gray-400 font-bold block">
                                       Eq. {currencySymbol}{displayReceivedBase.toFixed(2)}
                                    </span>
                                 ) : null}
                                 {p.gatewayProvider && (
                                    <span className={`text-[9px] md:text-[10px] font-bold block ${p.gatewayStatus === 'PENDING' ? 'text-amber-600' : 'text-indigo-500'}`}>
                                       {p.gatewayStatus === 'PENDING'
                                          ? 'PENDIENTE DE COBRO AL FINALIZAR'
                                          : `${resolveGatewaySummaryLabel(p)} · AUT ${p.gatewayAuthorizationCode || '-'} · REF ${p.gatewayReference || '-'}`}
                                    </span>
                                 )}
                              </div>
                           </div>
                           <div className="flex items-center gap-2 md:gap-4">
                              <span className="font-bold text-sm md:text-gray-900">
                                 {displayCurrencyCode === baseCurrency.code
                                    ? `${currencySymbol}${displayReceivedBase.toFixed(2)}`
                                    : `${displayCurrencySymbol}${displayReceivedOriginal.toFixed(2)}`}
                              </span>
                              <button
                                 onClick={() => handleRemovePayment(p.id)}
                                 className="p-1.5 rounded-full bg-red-50 border border-red-100 text-red-500 hover:bg-red-100 transition-colors"
                                 aria-label="Eliminar forma de pago"
                              >
                                 <Trash2 size={14} strokeWidth={2.4} />
                              </button>
                           </div>
                        </div>
                     );
                  })}
               </div>

               <div className="sticky bottom-0 z-10 p-3 bg-white border-t border-gray-200 rounded-xl md:rounded-2xl mt-3 lg:mt-3 shadow-inner shrink-0">
                  {finalizeError && (
                     <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
                        {finalizeError}
                     </div>
                  )}
                  <div className="flex justify-between items-end mb-3 md:mb-4">
                     {change > 0 ? (
                        <div className="w-full text-right">
                           <p className="text-[9px] md:text-[10px] font-bold text-emerald-600 uppercase tracking-widest">{isRefund ? 'Diferencia a Favor' : 'Cambio'}</p>
                           <p className="text-xl md:text-2xl font-black text-emerald-600">{currencySymbol}{change.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                           <p className="mt-1 text-[10px] font-bold text-slate-500">
                              Aplicado {currencySymbol}{paymentSettlementPreview.totalAppliedBase.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                           </p>
                        </div>
                     ) : (
                        <div>
                           <p className="text-[9px] md:text-[10px] font-bold text-gray-400 uppercase tracking-widest">Restante</p>
                           <p className={`text-xl md:text-2xl font-black ${remaining > 0 ? (isRefund ? 'text-rose-500' : 'text-amber-500') : 'text-emerald-500'}`}>{currencySymbol}{remaining.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                           {paymentSettlementPreview.totalReceivedBase > 0.009 && (
                              <p className="mt-1 text-[10px] font-bold text-slate-500">
                                 Recibido {currencySymbol}{paymentSettlementPreview.totalReceivedBase.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </p>
                           )}
                        </div>
                     )}
                  </div>
                  <button
                     onClick={handleFinalize}
                     disabled={!canFinalize || isFinalizing || isProcessingGateway}
                     className={`w-full py-3 rounded-xl md:rounded-2xl font-black text-sm md:text-base text-white transition-all shadow-lg ${!canFinalize || isFinalizing || isProcessingGateway ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : `${isRefund ? 'bg-rose-600 hover:bg-rose-700' : `${themeBgClass} hover:brightness-110`}`}`}
                  >
                     {isProcessingGateway
                        ? 'PROCESANDO TARJETA...'
                        : isFinalizing
                        ? 'PROCESANDO...'
                        : !canFinalize
                           ? 'PAGO INCOMPLETO'
                           : isRefund
                              ? 'PROCESAR DEVOLUCIÓN'
                              : 'FINALIZAR VENTA'}
                  </button>
               </div>
            </div>

            {/* INPUT SECTION */}
            <div className="flex-1 flex flex-col bg-white overflow-hidden min-h-0">
               {/* Payment Methods */}
               <div className="flex flex-wrap p-3 md:p-4 gap-2 md:gap-3 shrink-0 max-h-[150px] overflow-y-auto no-scrollbar">
                  {configuredMethods.length === 0 && <p role="status" className="w-full p-3 text-sm text-gray-600">No hay formas de pago habilitadas.</p>}
                  {configuredMethods.map(method => {
                     const methodRuntimeType = resolvePaymentMethodTypeForRuntime(method.type, method.label, method.id);
                     const methodIsCredit = methodRuntimeType === 'CREDIT';
                     const methodIsLoyaltyRedeem = isLoyaltyRedeemMethod(method.type, method.label, method.id);
                     const methodIsIntegratedCard = method.definition?.type === 'CARD' && method.definition.integrationMode === 'INTEGRATED';
                     const methodRequiresOnline = method.type === 'WALLET' || methodIsCredit || methodIsLoyaltyRedeem || methodIsIntegratedCard;
                     const methodDisabledOffline = !isOnline && !isMaster && methodRequiresOnline;
                     const isExceeded = methodIsCredit && isDelinquent && !isOverrideActive;
                     return (
                        <button
                           key={method.key}
                           onClick={() => !methodDisabledOffline && selectPaymentMethod(method)}
                           disabled={methodDisabledOffline}
                           className={`min-w-[calc(50%-0.25rem)] lg:min-w-[calc(33.333%-0.5rem)] xl:min-w-[120px] flex-1 py-2.5 md:py-3 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-all bg-white ${activePaymentMethod?.key === method.key ? `border-current ${themeTextClass} shadow-sm` : 'border-gray-200 text-slate-500 hover:border-gray-300 hover:bg-white'} ${isExceeded ? 'bg-red-50/50 border-red-200' : ''} ${methodDisabledOffline ? 'opacity-50 cursor-not-allowed bg-gray-50 hover:border-gray-200 hover:bg-gray-50' : ''}`}
                        >
                           <method.Icon size={22} className="md:w-7 md:h-7" strokeWidth={2.4} />
                           <span className="font-black text-[9px] md:text-[10px] uppercase tracking-widest">{method.label}</span>
                           {methodIsIntegratedCard && method.integration && (
                              <span className="text-[7px] text-indigo-600 font-bold">{method.integration.provider}</span>
                           )}
                           {isExceeded && (
                              <span className="text-[7px] text-red-600 font-bold">LÍMITE EXCEDIDO</span>
                           )}
                           {methodDisabledOffline && (
                              <span className="text-[7px] text-amber-600 font-bold">REQUIERE CONEXIÓN</span>
                           )}
                        </button>
                     );
                  })}
               </div>

               {isDelinquent && !isOverrideActive && (
                  <div className="mx-4 mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between">
                     <div className="flex items-center gap-2 text-red-700 text-[10px] md:text-xs font-bold">
                        <ShieldAlert size={16} />
                        <span>CLIENTE EN MORA - CRÉDITO RESTRINGIDO</span>
                     </div>
                     <button
                        onClick={() => setShowSupervisorModal(true)}
                        className="px-3 py-1 bg-red-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-red-700 transition-colors"
                     >
                        Override
                     </button>
                  </div>
               )}

               {/* Amount Input */}
               <div className="px-4 md:px-6 mt-1 shrink-0">
                  <div className="bg-gray-100 rounded-2xl md:rounded-[1.5rem] p-3 md:p-4 flex justify-between items-center border border-gray-200 shadow-inner">
                     <span className="text-xl md:text-2xl text-gray-400 font-black">{selectedCurrency.symbol}</span>
                     <input
                        type="text"
                        readOnly
                        value={inputAmount}
                        className="bg-transparent text-right text-3xl md:text-4xl font-mono font-black text-gray-800 w-full outline-none"
                        placeholder="0.00"
                     />
                  </div>
                  {selectedCurrency.code !== baseCurrency.code && activeForeignCurrencyRounding !== 'NONE' && (
                     <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.18em] text-violet-600">
                        Redondeo {activeForeignCurrencyRounding === 'UP'
                           ? 'hacia arriba'
                           : activeForeignCurrencyRounding === 'DOWN'
                           ? 'hacia abajo'
                           : 'a 0 decimales'}
                     </p>
                  )}

                  {activeMethod === 'CASH' && (
                     <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-2 md:mt-3">
                        {denominations.map(d => (
                           <button
                              key={d}
                              onClick={() => handleAddPayment(d)}
                              disabled={isProcessingGateway || isFinalizing}
                              className="py-1.5 md:py-2 bg-white border border-gray-200 rounded-lg md:rounded-xl text-[10px] md:text-xs font-black text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-all shadow-sm"
                           >
                              {selectedCurrency.symbol}{d}
                           </button>
                        ))}
                     </div>
                  )}

                  {activeMethod === 'WALLET' && customer?.wallet && (
                     <div className="mt-4 p-4 bg-purple-50 rounded-2xl border border-purple-100">
                        <div className="flex justify-between items-center mb-2">
                           <span className="text-xs font-bold text-purple-600 uppercase tracking-wider">Saldo Disponible</span>
                           <span className="text-xl font-black text-purple-700">{currencySymbol}{customer.wallet.balance.toFixed(2)}</span>
                        </div>
                        {customer.wallet.balance < parseFloat(inputAmount || '0') && (
                           <div className="text-[10px] font-bold text-red-500 flex items-center gap-1">
                              <ShieldAlert size={12} /> Saldo insuficiente
                           </div>
                        )}
                     </div>
                  )}
               </div>

               {/* Numpad - Responsive grid */}
               <div className="flex-1 p-3 md:p-4 lg:p-5 grid grid-cols-4 gap-2 md:gap-3 content-stretch min-h-0">
                  {[1, 2, 3].map(n => <button key={n} onClick={() => handleNumPad(n.toString())} className="min-h-[50px] bg-white border border-gray-100 rounded-xl md:rounded-2xl text-2xl md:text-3xl font-black text-gray-700 active:bg-gray-50 active:scale-95 transition-all shadow-sm">{n}</button>)}

                  <button
                     onClick={() => handleAddPayment()}
                     disabled={!activePaymentMethod || (!isOnline && !isMaster && activeRequiresOnline) || isProcessingGateway || isFinalizing}
                     className={`row-span-2 min-h-[104px] rounded-2xl md:rounded-[2rem] font-black shadow-xl flex flex-col items-center justify-center gap-1 md:gap-2 ${!activePaymentMethod || (!isOnline && !isMaster && activeRequiresOnline) || isProcessingGateway || isFinalizing ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : `${themeBgClass} text-white active:scale-95 hover:brightness-110`}`}
                  >
                     <Plus size={28} className="md:w-8 md:h-8" />
                     <span className="text-[10px] tracking-widest uppercase">
                        {isProcessingGateway ? 'Procesando' : 'Agregar'}
                     </span>
                  </button>

                  {[4, 5, 6].map(n => <button key={n} onClick={() => handleNumPad(n.toString())} className="min-h-[50px] bg-white border border-gray-100 rounded-xl md:rounded-2xl text-2xl md:text-3xl font-black text-gray-700 active:bg-gray-50 active:scale-95 transition-all shadow-sm">{n}</button>)}
                  {[7, 8, 9].map(n => <button key={n} onClick={() => handleNumPad(n.toString())} className="min-h-[50px] bg-white border border-gray-100 rounded-xl md:rounded-2xl text-2xl md:text-3xl font-black text-gray-700 active:bg-gray-50 active:scale-95 transition-all shadow-sm">{n}</button>)}

                  <button onClick={() => handleNumPad('BACK')} className="min-h-[50px] rounded-xl md:rounded-2xl bg-red-50 text-red-500 flex items-center justify-center active:scale-95 border border-red-100"><Trash2 size={24} className="md:w-7 md:h-7" /></button>
                  <button onClick={() => handleNumPad('C')} className="min-h-[50px] rounded-xl md:rounded-2xl bg-gray-200 text-gray-600 font-black text-lg md:text-xl active:scale-95 transition-all shadow-inner">C</button>
                  <button onClick={() => handleNumPad('0')} className="min-h-[50px] rounded-xl md:rounded-2xl bg-white border border-gray-100 text-2xl md:text-3xl font-black text-gray-700 active:bg-gray-50 active:scale-95 transition-all shadow-sm">0</button>
                  <button onClick={() => handleNumPad('.')} className="min-h-[50px] rounded-xl md:rounded-2xl bg-white border border-gray-100 text-2xl md:text-3xl font-black text-gray-700 active:bg-gray-50 active:scale-95 transition-all shadow-sm">.</button>
            </div>
         </div>
      </div>
   </div>
      {showSupervisorModal && (
         <SupervisorAuthModal
            isOpen={showSupervisorModal}
            onClose={() => setShowSupervisorModal(false)}
            onSuccess={() => {
               setIsOverrideActive(true);
               setShowSupervisorModal(false);
            }}
            users={users}
            requiredPermission="POS_CREDIT_OVERRIDE"
         />
      )}
   </>
   );
};

export default UnifiedPaymentModal;
