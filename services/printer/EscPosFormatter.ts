import { BusinessConfig, CartItem, CashMovement, Reservation, Table, Transaction, ZReport } from '../../types';
import { findTaxByIdentifier } from '../../utils/taxIdentity';
import { buildPaymentReceiptPresentation, buildPaymentSettlementSummary } from '../../utils/paymentSettlement';
import { resolveTerminalSellerName } from '../../utils/terminalSnapshotSellers';
import { calculateTransactionFiscalSummary, consolidateTaxBreakdownForDisplay, formatTaxLineLabel } from '../../utils/fiscalBreakdown';
import { resolveLineDiscountPresentation } from '../../utils/lineDiscountPresentation';
import { resolveTerminalDisplayName } from '../../utils/transactionHistoryPresentation';
import { resolveGlobalDiscountLabel } from '../../utils/globalDiscountPresentation';
import { resolveReceiptCouponCodes } from '../../utils/receiptCouponPresentation';
import { formatReceiptVariant } from '../../utils/receiptVariant';
import { getCloseReceiptSummary, closeTaxLabel } from '../../utils/closeReceiptSummary';
import { getZReportPaymentMethodSummary, paymentMethodSummaryTotal } from '../../utils/zReportPaymentSummary';

export interface EscPosLabelRecord {
  productId: string;
  productName: string;
  sku?: string;
  price?: number;
  copies: number;
}

export interface EscPosKitchenOrderData {
  items: CartItem[];
  table?: Table;
  orderNumber?: string;
  customerName?: string;
  areaTitle?: string;
}

export interface EscPosHardwareTestData {
  printerName?: string;
  connection?: string;
  address?: string;
  printedAt?: string;
}

const ESC = 0x1b;
const GS = 0x1d;
const RECEIPT_LINE_WIDTH = 42;
const LABEL_LINE_WIDTH = 32;

const toAscii = (value: string): string => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
};

const text = (value = ''): Uint8Array => new TextEncoder().encode(`${value}\n`);
const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

const concat = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  chunks.forEach(chunk => {
    out.set(chunk, offset);
    offset += chunk.length;
  });

  return out;
};

const toBase64 = (input: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < input.length; i += chunkSize) {
    const chunk = input.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const splitLines = (textValue: string, width: number): string[] => {
  const clean = toAscii(textValue);
  if (!clean) return [''];

  const words = clean.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  words.forEach(word => {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= width) {
      line = next;
      return;
    }

    if (line) {
      lines.push(line);
      line = '';
    }

    if (word.length > width) {
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      return;
    }

    line = word;
  });

  if (line) lines.push(line);
  return lines;
};

const sanitizeRawText = (value = ''): string => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\n]/g, '');
};

const splitRawLines = (textValue: string, width: number): string[] => {
  const normalized = sanitizeRawText(textValue).replace(/\r/g, '');
  const sourceLines = normalized.split('\n');
  const wrappedLines: string[] = [];

  sourceLines.forEach((line) => {
    if (line.length === 0) {
      wrappedLines.push('');
      return;
    }

    for (let index = 0; index < line.length; index += width) {
      wrappedLines.push(line.slice(index, index + width));
    }
  });

  return wrappedLines;
};

const padRight = (value: string, length: number): string => {
  if (value.length >= length) return value.slice(0, length);
  return `${value}${' '.repeat(length - value.length)}`;
};

const linePair = (left: string, right: string, width: number): string[] => {
  const cleanLeft = toAscii(left);
  const cleanRight = toAscii(right);
  if (!cleanRight) {
    return splitLines(cleanLeft, width);
  }

  if (cleanLeft.length + cleanRight.length + 1 <= width) {
    return [`${cleanLeft}${' '.repeat(width - cleanLeft.length - cleanRight.length)}${cleanRight}`];
  }

  const availableLeft = Math.max(8, width - cleanRight.length - 1);
  const leftLines = splitLines(cleanLeft, availableLeft);
  const lines = leftLines.slice(0, -1);
  const lastLeft = leftLines[leftLines.length - 1] || '';

  if (lastLeft.length + cleanRight.length + 1 <= width) {
    lines.push(`${lastLeft}${' '.repeat(width - lastLeft.length - cleanRight.length)}${cleanRight}`);
    return lines;
  }

  lines.push(lastLeft);
  lines.push(`${' '.repeat(Math.max(0, width - cleanRight.length))}${cleanRight}`);
  return lines;
};

const divider = (width: number): Uint8Array => text('-'.repeat(width));
const align = (mode: 0 | 1 | 2): Uint8Array => bytes(ESC, 0x61, mode);
const bold = (enabled: boolean): Uint8Array => bytes(ESC, 0x45, enabled ? 0x01 : 0x00);
const size = (value: number): Uint8Array => bytes(GS, 0x21, value);
const initPrinter = (): Uint8Array => bytes(ESC, 0x40);
const openDrawer = (): Uint8Array => bytes(ESC, 0x70, 0x00, 25, 250);
const fullCut = (): Uint8Array => bytes(GS, 0x56, 66, 0);
const encodeQrModel = (): Uint8Array => bytes(GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
const encodeQrSize = (sizeValue = 6): Uint8Array => bytes(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, Math.max(3, Math.min(8, sizeValue)));
const encodeQrErrorCorrection = (): Uint8Array => bytes(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31);

const pushTextLines = (chunks: Uint8Array[], lines: string[]) => {
  lines.forEach(line => chunks.push(text(line)));
};

const pushPair = (chunks: Uint8Array[], left: string, right: string, width: number) => {
  pushTextLines(chunks, linePair(left, right, width));
};

const pushBlank = (chunks: Uint8Array[], count = 1) => {
  for (let index = 0; index < count; index += 1) {
    chunks.push(text(''));
  }
};

const resolveItemCreatedAt = (item: Partial<CartItem>): Date => {
  const raw = String(
    item.createdAt
    || (item as any).created_at
    || (item as any).addedAt
    || (item as any).added_at
    || (item as any).timestamp
    || ''
  ).trim();
  const parsed = raw ? new Date(raw) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const sortCartItemsByEntryTime = (items: CartItem[]): CartItem[] => (
  [...items].sort((left, right) => resolveItemCreatedAt(left).getTime() - resolveItemCreatedAt(right).getTime())
);

const padClock = (value: number): string => String(value).padStart(2, '0');

const formatClock = (date: Date): string => `${padClock(date.getHours())}:${padClock(date.getMinutes())}`;

const formatDate = (date: Date): string => (
  `${padClock(date.getDate())}/${padClock(date.getMonth() + 1)}/${date.getFullYear()}`
);

const formatKitchenEntryTime = (item: CartItem): string => (
  formatClock(resolveItemCreatedAt(item))
);

const pushQrCode = (chunks: Uint8Array[], payload: string) => {
  const normalizedPayload = toAscii(payload);
  if (!normalizedPayload) return;

  const encodedPayload = new TextEncoder().encode(normalizedPayload);
  const storeLength = encodedPayload.length + 3;
  const pL = storeLength % 256;
  const pH = Math.floor(storeLength / 256);

  chunks.push(align(1));
  chunks.push(encodeQrModel());
  chunks.push(encodeQrSize());
  chunks.push(encodeQrErrorCorrection());
  chunks.push(bytes(GS, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30));
  chunks.push(encodedPayload);
  chunks.push(bytes(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30));
  chunks.push(align(0));
};

const formatMoney = (currencySymbol: string, value: number): string => {
  return `${toAscii(currencySymbol || '$')}${Number(value || 0).toFixed(2)}`;
};

const resolveCurrencySymbol = (config: BusinessConfig | undefined, currencyCode: string | undefined): string => {
  if (!currencyCode) return config?.currencySymbol || '$';
  return config?.currencies?.find(currency => currency.code === currencyCode)?.symbol || currencyCode;
};

export const shouldOpenDrawerForTransaction = (transaction: Transaction, config: BusinessConfig): boolean => {
  const transactionTerminalId = String(transaction.terminalId || '').trim();
  const terminal = (config.terminals || []).find(candidate => {
    const terminalConfig = candidate.config as Record<string, any>;
    return [
      candidate.id,
      terminalConfig?.erpTerminalId,
      terminalConfig?.terminalId,
      terminalConfig?.localTerminalId,
    ].some(candidateId => String(candidateId || '').trim() === transactionTerminalId);
  }) || (config.terminals || []).find(candidate => candidate.config?.currentDeviceId);
  if (terminal?.config?.hardware?.cashDrawerTrigger !== 'PRINTER') {
    return false;
  }

  const paymentMethods = config.paymentMethods || [];
  return (transaction.payments || []).some((payment: any) => {
    const method = paymentMethods.find(methodDef =>
      (payment?.methodId && methodDef.id === payment.methodId) ||
      (payment?.method && methodDef.type === payment.method)
    );
    return method?.opensDrawer === true;
  });
};

const getItemTaxRate = (item: Transaction['items'][number], config: BusinessConfig): number => {
  if (item.appliedTaxIds && item.appliedTaxIds.length > 0) {
    return item.appliedTaxIds.reduce((sum, id) => {
      const tax = findTaxByIdentifier(config.taxes || [], id);
      return sum + (tax?.rate || 0);
    }, 0);
  }

  return config.taxRate || 0;
};

const calculateTransactionTotals = (transaction: Transaction, config: BusinessConfig) => {
  let subtotal = 0;
  let lineDiscountTotal = 0;
  let taxTotal = 0;
  const isTaxIncluded = transaction.isTaxIncluded || false;

  let rawNetTotal = 0;
  let rawTaxTotal = 0;
  let rawGrossTotal = 0;

  transaction.items.forEach(item => {
    const originalPrice = item.originalPrice || item.price;
    const lineVal = item.price * item.quantity;
    const lineDiscount = (originalPrice - item.price) * item.quantity;

    lineDiscountTotal += Math.max(0, lineDiscount);
    rawGrossTotal += lineVal;

    const itemTaxRate = getItemTaxRate(item, config);

    let lineNet = 0;
    let lineTax = 0;

    if (isTaxIncluded) {
      lineNet = lineVal / (1 + itemTaxRate);
      lineTax = lineVal - lineNet;
    } else {
      lineNet = lineVal;
      lineTax = lineNet * itemTaxRate;
    }

    rawNetTotal += lineNet;
    rawTaxTotal += lineTax;
  });

  if (transaction.discountAmount && transaction.discountAmount > 0) {
    if (isTaxIncluded) {
      const ratio = (rawGrossTotal - transaction.discountAmount) / (rawGrossTotal || 1);
      subtotal = rawNetTotal * ratio;
      taxTotal = rawTaxTotal * ratio;
    } else {
      subtotal = rawNetTotal - transaction.discountAmount;
      const ratio = subtotal / (rawNetTotal || 1);
      taxTotal = rawTaxTotal * ratio;
    }
  } else {
    subtotal = rawNetTotal;
    taxTotal = rawTaxTotal;
  }

  return {
    subtotal,
    lineDiscountTotal,
    globalDiscountTotal: Math.max(0, Number(transaction.discountAmount || 0)),
    discountTotal: lineDiscountTotal + Math.max(0, Number(transaction.discountAmount || 0)),
    taxTotal,
    total: transaction.total || (subtotal + taxTotal)
  };
};

const finalizeReceipt = (chunks: Uint8Array[]) => {
  chunks.push(text(''));
  chunks.push(text(''));
  chunks.push(fullCut());
};

export const buildEscPosCashDrawerPayload = (): string => toBase64(concat([
  initPrinter(),
  openDrawer(),
]));

export const buildEscPosHardwareTestPayload = (data: EscPosHardwareTestData): string => {
  const width = RECEIPT_LINE_WIDTH;
  const chunks: Uint8Array[] = [];

  chunks.push(initPrinter());
  chunks.push(align(1));
  chunks.push(bold(true));
  chunks.push(size(0x11));
  pushTextLines(chunks, splitLines('ALFA POS', width));
  chunks.push(size(0x00));
  pushTextLines(chunks, splitLines('PRUEBA DE IMPRESORA', width));
  chunks.push(bold(false));
  chunks.push(divider(width));
  chunks.push(align(0));
  pushPair(chunks, 'Impresora', data.printerName || 'Sin nombre', width);
  pushPair(chunks, 'Conexion', data.connection || 'N/D', width);
  pushPair(chunks, 'Direccion', data.address || 'N/D', width);
  pushPair(chunks, 'Fecha', data.printedAt || new Date().toLocaleString(), width);
  chunks.push(divider(width));
  chunks.push(align(1));
  pushTextLines(chunks, splitLines('CONEXION OPERATIVA', width));
  chunks.push(align(0));
  finalizeReceipt(chunks);

  return toBase64(concat(chunks));
};

export const buildEscPosCashMovementReceiptPayload = (
  movement: CashMovement,
  config: BusinessConfig,
): string | null => {
  if (!movement || !Number.isFinite(Number(movement.amount)) || Number(movement.amount) <= 0) return null;

  const width = RECEIPT_LINE_WIDTH;
  const chunks: Uint8Array[] = [];
  const title = movement.type === 'IN' ? 'COMPROBANTE DE ENTRADA' : 'COMPROBANTE DE SALIDA';
  const currencySymbol = resolveCurrencySymbol(config, movement.currencyCode);

  buildReceiptHeader(chunks, config, title, width);
  pushPair(chunks, 'Referencia', movement.id, width);
  pushPair(chunks, 'Fecha', new Date(movement.timestamp).toLocaleString(), width);
  pushPair(chunks, 'Terminal', resolveTerminalDisplayName(movement.terminalId, config.terminals || []), width);
  pushPair(chunks, 'Cajero', movement.userName || movement.userId || 'N/D', width);
  chunks.push(divider(width));
  pushTextLines(chunks, splitLines(`Concepto: ${movement.reason || 'Movimiento General'}`, width));
  chunks.push(divider(width));
  chunks.push(bold(true));
  chunks.push(size(0x11));
  pushPair(chunks, 'TOTAL', formatMoney(currencySymbol, Number(movement.amount)), width);
  chunks.push(size(0x00));
  chunks.push(bold(false));
  chunks.push(divider(width));
  chunks.push(align(1));
  pushTextLines(chunks, splitLines('Movimiento registrado', width));
  chunks.push(align(0));
  finalizeReceipt(chunks);

  return toBase64(concat(chunks));
};

const buildReceiptHeader = (chunks: Uint8Array[], config: BusinessConfig, title: string, width: number) => {
  const companyInfo = config.companyInfo;

  chunks.push(initPrinter());
  chunks.push(align(1));
  chunks.push(bold(true));
  chunks.push(size(0x11));
  chunks.push(text(companyInfo.name || 'ALFA POS'));
  chunks.push(size(0x00));
  chunks.push(bold(false));

  [companyInfo.rnc && `RNC: ${companyInfo.rnc}`, companyInfo.address, companyInfo.phone && `TEL: ${companyInfo.phone}`]
    .filter(Boolean)
    .forEach(line => pushTextLines(chunks, splitLines(String(line), width)));

  chunks.push(bold(true));
  pushTextLines(chunks, splitLines(title, width));
  chunks.push(bold(false));
  chunks.push(divider(width));
  chunks.push(align(0));
};

export const buildEscPosTicketPayload = (
  transaction: Transaction,
  config: BusinessConfig,
  users: Array<{ id: string; name: string }> = []
): string | null => {
  if (!transaction?.items?.length) return null;

  const width = RECEIPT_LINE_WIDTH;
  const chunks: Uint8Array[] = [];
  const totals = calculateTransactionTotals(transaction, config);
  const terminalConfig = (config.terminals || []).find(candidate => candidate.id === transaction.terminalId)?.config;
  const fiscalSummary = calculateTransactionFiscalSummary(transaction, config, { terminalConfig });
  const receiptSubtotal = fiscalSummary.subtotal;
  const receiptTaxTotal = fiscalSummary.taxTotal;
  const receiptTotal = fiscalSummary.total;
  const receiptTaxBreakdown = consolidateTaxBreakdownForDisplay(fiscalSummary.taxBreakdown, config.taxes);
  const redeemedCouponCodes = resolveReceiptCouponCodes(transaction);
  const ncfTypeLabels: Record<string, string> = {
    B01: 'FACTURA DE CREDITO FISCAL',
    B02: 'FACTURA DE CONSUMO',
    B04: 'NOTA DE CREDITO',
    B14: 'REGIMENES ESPECIALES',
    B15: 'GUBERNAMENTAL'
  };
  const comprobanteTypeLabels: Record<string, string> = {
    B01: 'CREDITO FISCAL',
    B02: 'CONSUMIDOR FINAL',
    B04: 'NOTA DE CREDITO',
    B14: 'REGIMENES ESPECIALES',
    B15: 'GUBERNAMENTAL'
  };

  const isCreditNote = transaction.ncfType === 'B04' || transaction.documentType === 'REFUND';
  const documentTitle = isCreditNote
    ? 'NOTA DE CREDITO'
    : transaction.ncfType
      ? (ncfTypeLabels[transaction.ncfType] || 'FACTURA DE VENTA')
      : 'TICKET DE VENTA';
  const qrPayload = String(transaction.displayId || transaction.id || '').trim();
  const foreignCurrencyLines = config.receiptConfig?.showForeignCurrencyTotals && config.currencies
    ? config.currencies
      .filter(currency => !currency.isBase && currency.isEnabled && Number(currency.rate || 0) > 0)
      .map(currency => ({
        code: currency.code,
        symbol: currency.symbol,
        amount: receiptTotal / Number(currency.rate || 1)
      }))
    : [];

  buildReceiptHeader(chunks, config, documentTitle, width);

  pushPair(chunks, `Ticket: ${transaction.displayId || transaction.id}`, new Date(transaction.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), width);
  pushTextLines(chunks, splitLines(new Date(transaction.date).toLocaleDateString(), width));
  const shouldPrintOrderNumber = Boolean(config.receiptConfig?.showOrderNumber && transaction.orderNumber);
  const shouldPrintQr = Boolean(config.receiptConfig?.showQr && qrPayload);

  if (shouldPrintOrderNumber && !shouldPrintQr) {
    pushTextLines(chunks, splitLines(`No. Orden: ${transaction.orderNumber}`, width));
  }
  if (transaction.tableDisplayLabel) {
    pushTextLines(chunks, splitLines(`Mesa/Sala: ${transaction.tableDisplayLabel}`, width));
  }
  if (transaction.serviceType) {
    const serviceLabel = transaction.serviceType === 'TAKEOUT'
      ? 'Para llevar'
      : transaction.serviceType === 'DELIVERY'
        ? 'Delivery'
        : 'Consumo en mesa';
    pushTextLines(chunks, splitLines(`Tipo servicio: ${serviceLabel}`, width));
  }

  const snapshot = transaction.customerSnapshot;
  const customerName = (snapshot?.name || transaction.customerName || 'Cliente Mostrador').trim() || 'Cliente Mostrador';
  chunks.push(divider(width));
  pushTextLines(chunks, splitLines(`Cliente: ${customerName}`, width));
  if (snapshot?.taxId) pushTextLines(chunks, splitLines(`RNC/Ced: ${snapshot.taxId}`, width));
  if (snapshot?.phone) pushTextLines(chunks, splitLines(`Tel: ${snapshot.phone}`, width));

  chunks.push(divider(width));
  transaction.items.forEach(item => {
    pushTextLines(chunks, splitLines(item.name || 'Articulo', width));
    const discount = resolveLineDiscountPresentation(item);
    const displayedUnitPrice = discount.hasDiscount ? discount.originalUnitPrice : discount.finalUnitPrice;
    const displayedLineTotal = discount.hasDiscount ? discount.originalLineTotal : discount.finalLineTotal;
    const qtyText = `${Number(item.quantity || 0).toFixed(item.quantity % 1 === 0 ? 0 : 3)} x ${formatMoney(config.currencySymbol || '$', displayedUnitPrice)}`;
    const lineTotal = formatMoney(config.currencySymbol || '$', displayedLineTotal);
    pushPair(chunks, qtyText, lineTotal, width);
    if (discount.hasDiscount) {
      pushPair(
        chunks,
        `  Descuento articulo (${discount.discountPercentageLabel})`,
        `-${formatMoney(config.currencySymbol || '$', discount.discountAmount)}`,
        width
      );
      pushPair(
        chunks,
        '  Precio final',
        formatMoney(config.currencySymbol || '$', discount.finalLineTotal),
        width
      );
    }

    const variantText = formatReceiptVariant(item.variantInfo, config.receiptConfig?.showVariantLabels);
    if (variantText) {
      pushTextLines(chunks, splitLines(variantText, width));
    }
    if (item.note) {
      pushTextLines(chunks, splitLines(`Nota: ${item.note}`, width));
    }
    if (item.salespersonId) {
      const sellerName = resolveTerminalSellerName(item.salespersonId, config, transaction.terminalId, users);
      if (sellerName) {
        pushTextLines(chunks, splitLines(`Vendedor: ${sellerName}`, width));
      }
    }
  });

  chunks.push(divider(width));
  pushPair(chunks, 'SUBTOTAL', formatMoney(config.currencySymbol || '$', receiptSubtotal), width);
  if (totals.globalDiscountTotal > 0) {
    pushPair(chunks, resolveGlobalDiscountLabel({
      discountAmount: totals.globalDiscountTotal,
      subtotalBeforeDiscount: receiptSubtotal,
      discountType: transaction.discountType,
      discountValue: transaction.discountValue,
      baseLabel: 'DESCUENTO TOTAL',
    }), formatMoney(config.currencySymbol || '$', totals.globalDiscountTotal), width);
  }
  if (receiptTaxBreakdown.length > 0) {
    receiptTaxBreakdown.forEach(tax => {
      pushPair(chunks, formatTaxLineLabel(tax), formatMoney(config.currencySymbol || '$', tax.amount), width);
    });
  } else if (receiptTaxTotal > 0) {
    pushPair(chunks, 'IMPUESTOS', formatMoney(config.currencySymbol || '$', receiptTaxTotal), width);
  }
  chunks.push(bold(true));
  pushPair(chunks, 'TOTAL', formatMoney(config.currencySymbol || '$', receiptTotal), width);
  chunks.push(bold(false));

  if (foreignCurrencyLines.length > 0) {
    chunks.push(divider(width));
    foreignCurrencyLines.forEach(currency => {
      pushPair(
        chunks,
        currency.code,
        formatMoney(currency.symbol || currency.code, currency.amount),
        width
      );
    });
  }

  if (config.receiptConfig?.showSavings && totals.discountTotal > 0) {
    chunks.push(divider(width));
    chunks.push(align(1));
    chunks.push(bold(true));
    pushTextLines(chunks, splitLines('USTED AHORRO', width));
    pushTextLines(chunks, splitLines(formatMoney(config.currencySymbol || '$', totals.discountTotal), width));
    chunks.push(bold(false));
    chunks.push(align(0));
  }

  if ((transaction.payments || []).length > 0) {
    chunks.push(divider(width));
    const baseCurrencyCode = config.currencies?.find(currency => currency.isBase)?.code || 'DOP';
    const settlementSummary = buildPaymentSettlementSummary(
      Array.isArray(transaction.payments) ? transaction.payments as any : [],
      Number(receiptTotal || transaction.total || 0),
      baseCurrencyCode
    );
    const paymentPresentation = buildPaymentReceiptPresentation(
      settlementSummary,
      config,
      baseCurrencyCode,
      config.currencySymbol || '$'
    );
    const paymentById = new Map((settlementSummary.payments || []).map(payment => [payment.id, payment]));
    pushTextLines(chunks, splitLines(paymentPresentation.heading, width));

    paymentPresentation.groups.forEach(group => {
      const payment: any = paymentById.get(group.paymentId) || {};
      group.rows.forEach(row => pushPair(chunks, row.label, row.value, width));
      const showAzulRefs =
        payment?.gatewayProvider === 'AZUL' || payment?.gatewayAuthorizationCode || payment?.gatewayReference;
      if (showAzulRefs) {
        if (payment?.gatewayAuthorizationCode) {
          pushTextLines(chunks, splitLines(`AUT No.: ${payment.gatewayAuthorizationCode}`, width));
        }
        if (payment?.gatewayReference) {
          pushTextLines(chunks, splitLines(`Ref No.: ${payment.gatewayReference}`, width));
        }
      }
    });

    if (paymentPresentation.change) {
      chunks.push(bold(true));
      pushPair(chunks, paymentPresentation.change.label, paymentPresentation.change.value, width);
      chunks.push(bold(false));
    }
  }

  if (redeemedCouponCodes.length > 0) {
    chunks.push(divider(width));
    redeemedCouponCodes.forEach(code => {
      pushTextLines(chunks, splitLines(`DESCUENTO POR CUPON: ${code}`, width));
    });
  }

  if (transaction.affectedInvoiceNumber || transaction.affectedNCF) {
    chunks.push(divider(width));
    if (transaction.affectedInvoiceNumber) {
      pushTextLines(chunks, splitLines(`Factura Afectada: ${transaction.affectedInvoiceNumber}`, width));
    }
    if (transaction.affectedNCF) {
      pushTextLines(chunks, splitLines(`NCF Afectado: ${transaction.affectedNCF}`, width));
    }
  }

  chunks.push(divider(width));
  const footerLines = (config.receiptConfig?.footerMessage || 'Gracias por su compra.\nVuelva pronto.')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  if (shouldPrintQr) {
    chunks.push(align(0));
    if (transaction.ncfType) {
      pushTextLines(chunks, splitLines(comprobanteTypeLabels[transaction.ncfType] || transaction.ncfType, width));
    }
    if (transaction.ncf) {
      pushTextLines(chunks, splitLines(transaction.ncf, width));
    }
    chunks.push(divider(width));
    chunks.push(align(1));
    pushQrCode(chunks, qrPayload);
    chunks.push(align(1));
    if (shouldPrintOrderNumber) {
      pushBlank(chunks);
      chunks.push(bold(true));
      chunks.push(size(0x11));
      pushTextLines(chunks, splitLines(`NO. ORDEN ${transaction.orderNumber}`, width));
      chunks.push(size(0x00));
      chunks.push(bold(false));
    }
    pushBlank(chunks);
    pushTextLines(chunks, splitLines('ESCANEA ESTE TICKET PARA DEVOLUCIONES Y CUPONES', width));
    chunks.push(align(0));
  }

  chunks.push(align(1));
  footerLines.forEach(line => pushTextLines(chunks, splitLines(line, width)));
  chunks.push(align(0));
  finalizeReceipt(chunks);

  return toBase64(concat(chunks));
};

export const buildEscPosComandaPayload = (data: EscPosKitchenOrderData): string | null => {
  const kitchenItems = sortCartItemsByEntryTime((data.items || []).filter(item => Number(item.quantity || 0) > 0));
  if (kitchenItems.length === 0) return null;

  const width = RECEIPT_LINE_WIDTH;
  const chunks: Uint8Array[] = [];
  const now = new Date();
  const tableLabel = (data.table as any)?.tableDisplayLabel || (data.table as any)?.displayLabel || data.table?.name || data.table?.nombre;

  chunks.push(initPrinter());
  chunks.push(align(1));
  chunks.push(bold(true));
  chunks.push(size(0x11));
  pushTextLines(chunks, splitLines('COMANDA - COCINA', width));
  chunks.push(size(0x00));
  if (data.areaTitle) {
    pushTextLines(chunks, splitLines(String(data.areaTitle).toUpperCase(), width));
  }
  chunks.push(bold(false));
  chunks.push(divider(width));

  if (data.orderNumber) {
    chunks.push(bold(true));
    chunks.push(size(0x10));
    pushTextLines(chunks, splitLines(`ORDEN: #${data.orderNumber}`, width));
    chunks.push(size(0x00));
    chunks.push(bold(false));
  }
  if (tableLabel) {
    chunks.push(bold(true));
    pushTextLines(chunks, splitLines(`MESA: ${tableLabel}`, width));
    chunks.push(bold(false));
  }
  pushTextLines(chunks, splitLines(`Impreso: ${formatDate(now)} ${formatClock(now)}`, width));
  if (data.customerName) {
    pushTextLines(chunks, splitLines(`Cliente: ${data.customerName}`, width));
  }

  chunks.push(divider(width));
  chunks.push(align(0));

  kitchenItems.forEach((item, index) => {
    if (index > 0) chunks.push(divider(width));
    chunks.push(bold(true));
    chunks.push(size(0x10));
    pushTextLines(chunks, splitLines(`${Number(item.quantity || 0).toFixed(item.quantity % 1 === 0 ? 0 : 3)} x ${item.name || 'Articulo'}`, width));
    chunks.push(size(0x00));
    chunks.push(bold(false));
    pushTextLines(chunks, splitLines(`Digitado: ${formatKitchenEntryTime(item)}`, width));

    if (item.modifiers && item.modifiers.length > 0) {
      item.modifiers.forEach(modifier => {
        pushTextLines(chunks, splitLines(`  * ${modifier}`, width));
      });
    }
    if (item.note) {
      chunks.push(bold(true));
      pushTextLines(chunks, splitLines(`NOTA: ${item.note}`, width));
      chunks.push(bold(false));
    }
  });

  chunks.push(divider(width));
  chunks.push(align(1));
  pushTextLines(chunks, splitLines('Impreso en POS', width));
  chunks.push(align(0));
  finalizeReceipt(chunks);

  return toBase64(concat(chunks));
};

export const buildEscPosVoucherPayload = (
  providerLabel: string,
  copyLabel: string,
  receiptText: string
): string | null => {
  const normalizedText = String(receiptText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
  if (!normalizedText.trim()) return null;

  const width = RECEIPT_LINE_WIDTH;
  const chunks: Uint8Array[] = [];

  chunks.push(initPrinter());
  chunks.push(align(1));
  chunks.push(bold(true));
  pushTextLines(chunks, splitLines(providerLabel || 'VOUCHER', width));
  pushTextLines(chunks, splitLines(copyLabel, width));
  chunks.push(bold(false));
  chunks.push(divider(width));
  chunks.push(align(0));

  splitRawLines(normalizedText, width).forEach((line) => {
    chunks.push(text(line));
  });

  finalizeReceipt(chunks);
  return toBase64(concat(chunks));
};

export const buildEscPosReservationPayload = (reservation: Reservation, config: BusinessConfig): string | null => {
  if (!reservation?.items?.length) return null;

  const width = RECEIPT_LINE_WIDTH;
  const chunks: Uint8Array[] = [];

  buildReceiptHeader(chunks, config, 'NOTA DE RESERVA', width);

  pushTextLines(chunks, splitLines(`Codigo: ${reservation.code}`, width));
  pushPair(chunks, 'Fecha Doc', new Date(reservation.createdAt).toLocaleDateString(), width);
  if (reservation.deliveryDate) {
    pushPair(chunks, 'Entrega', new Date(reservation.deliveryDate).toLocaleDateString(), width);
  }
  pushPair(chunks, 'Vence', new Date(reservation.expiryDate).toLocaleDateString(), width);

  chunks.push(divider(width));
  pushTextLines(chunks, splitLines(`Cliente: ${reservation.customerName}`, width));

  chunks.push(divider(width));
  reservation.items.forEach(item => {
    pushTextLines(chunks, splitLines(item.name || 'Articulo', width));
    pushPair(
      chunks,
      `${Number(item.quantity || 0).toFixed(item.quantity % 1 === 0 ? 0 : 3)} x ${formatMoney(config.currencySymbol || '$', item.price)}`,
      formatMoney(config.currencySymbol || '$', item.price * item.quantity),
      width
    );
  });

  chunks.push(divider(width));
  pushPair(chunks, 'TOTAL RESERVA', formatMoney(config.currencySymbol || '$', reservation.total), width);
  pushPair(chunks, 'ABONO', formatMoney(config.currencySymbol || '$', reservation.balancePaid), width);
  pushPair(chunks, 'SALDO', formatMoney(config.currencySymbol || '$', reservation.total - reservation.balancePaid), width);

  if (reservation.notes) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines(`Nota: ${reservation.notes}`, width));
  }

  if (reservation.qrPayload) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('ESCANEA PARA RECUPERAR ESTA RESERVA', width));
    pushQrCode(chunks, reservation.qrPayload);
    chunks.push(align(1));
    pushTextLines(chunks, splitLines(reservation.code || reservation.qrPayload, width));
    chunks.push(align(0));
  }

  chunks.push(divider(width));
  chunks.push(align(1));
  pushTextLines(chunks, splitLines(config.receiptConfig?.footerMessage || 'Gracias por su preferencia.', width));
  chunks.push(align(0));
  finalizeReceipt(chunks);

  return toBase64(concat(chunks));
};

export const buildEscPosSubtotalPayload = (
  config: BusinessConfig,
  params: {
    items: CartItem[];
    subtotal: number;
    discountTotal: number;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue?: number;
    taxTotal: number;
    finalTotal: number;
    table?: Table | null;
    customerName?: string;
    terminalId?: string;
    orderNumber?: string;
    tableDisplayLabel?: string;
  }
): string | null => {
  if (!params.items?.length) return null;

  const width = RECEIPT_LINE_WIDTH;
  const chunks: Uint8Array[] = [];
  const now = new Date();

  buildReceiptHeader(chunks, config, 'SUBTOTAL', width);
  chunks.push(align(1));
  chunks.push(bold(true));
  pushTextLines(chunks, splitLines('NO VALIDO COMO FACTURA FISCAL', width));
  chunks.push(bold(false));
  chunks.push(align(0));
  chunks.push(divider(width));

  pushPair(chunks, 'Fecha', `${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, width);
  if (params.table || params.tableDisplayLabel) {
    const tableLabel = params.tableDisplayLabel || params.table?.name || params.table?.nombre || '';
    pushPair(chunks, 'Mesa', tableLabel, width);
  }
  if (params.orderNumber) pushPair(chunks, 'Orden', params.orderNumber, width);
  if (params.customerName) pushTextLines(chunks, splitLines(`Cliente: ${params.customerName}`, width));

  chunks.push(divider(width));
  params.items.forEach(item => {
    pushTextLines(chunks, splitLines(item.name || 'Articulo', width));
    pushPair(
      chunks,
      `${Number(item.quantity || 0).toFixed(item.quantity % 1 === 0 ? 0 : 3)} x ${formatMoney(config.currencySymbol || '$', Number(item.price || 0))}`,
      formatMoney(config.currencySymbol || '$', Number(item.price || 0) * Number(item.quantity || 0)),
      width
    );
    if (item.modifiers?.length) pushTextLines(chunks, splitLines(`Op: ${item.modifiers.join(', ')}`, width));
    if (item.note) pushTextLines(chunks, splitLines(`Nota: ${item.note}`, width));
  });

  chunks.push(divider(width));
  pushPair(chunks, 'SUBTOTAL', formatMoney(config.currencySymbol || '$', params.subtotal), width);
  if (params.discountTotal > 0) {
    pushPair(chunks, resolveGlobalDiscountLabel({
      discountAmount: params.discountTotal,
      subtotalBeforeDiscount: params.subtotal,
      discountType: params.discountType,
      discountValue: params.discountValue,
    }), `-${formatMoney(config.currencySymbol || '$', params.discountTotal)}`, width);
  }
  pushPair(chunks, 'IMPUESTOS', formatMoney(config.currencySymbol || '$', params.taxTotal), width);
  chunks.push(bold(true));
  chunks.push(size(0x11));
  pushPair(chunks, 'TOTAL', formatMoney(config.currencySymbol || '$', params.finalTotal), width);
  chunks.push(size(0x00));
  chunks.push(bold(false));

  chunks.push(divider(width));
  chunks.push(align(1));
  pushTextLines(chunks, splitLines('Verifique su consumo antes de facturar.', width));
  pushTextLines(chunks, splitLines('Propina legal no incluida.', width));
  chunks.push(align(0));
  finalizeReceipt(chunks);

  return toBase64(concat(chunks));
};

export const buildEscPosZReportPayload = (
  report: ZReport,
  hiddenModules: string[] = [],
  config?: BusinessConfig
): string | null => {
  if (!report) return null;

  const width = RECEIPT_LINE_WIDTH;
  const chunks: Uint8Array[] = [];
  const isXReport = (report as any).reportType === 'X';
  const reportTitle = isXReport ? 'CIERRE X (ARQUEO)' : 'REPORTE DE CIERRE (Z)';
  const currencySymbol = resolveCurrencySymbol(config, report.baseCurrency);
  const paymentMethodSummary = getZReportPaymentMethodSummary(report, config);
  const paymentMethodsTotal = paymentMethodSummaryTotal(paymentMethodSummary);
  const enabledSections = new Set(report.enabledSections || []);
  const reportDetails = report.reportDetails || {};
  const denominationBreakdown = report.denominationBreakdown || report.denomination_breakdown || {};
  const hasDenominationBreakdown = Object.values(denominationBreakdown)
    .some(lines => Array.isArray(lines) && lines.length > 0);

  chunks.push(initPrinter());
  chunks.push(align(1));
  chunks.push(bold(true));
  pushTextLines(chunks, splitLines(config?.companyInfo?.name || 'ALFA POS', width));
  chunks.push(size(0x11));
  pushTextLines(chunks, splitLines(reportTitle, width));
  chunks.push(size(0x00));
  pushTextLines(chunks, splitLines(report.sequenceNumber || report.id, width));
  chunks.push(bold(false));
  chunks.push(align(0));
  chunks.push(divider(width));

  pushPair(chunks, 'Fecha', new Date(report.closedAt).toLocaleString(), width);
  pushPair(chunks, 'Cajero', report.closedByUserName || 'N/D', width);
  pushPair(
    chunks,
    'Terminal',
    resolveTerminalDisplayName(report.terminalId, config?.terminals || []),
    width,
  );

  if (!hiddenModules.includes('FINANCIAL')) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('RESUMEN FINANCIERO', width));
    pushPair(chunks, 'Ventas Brutas', formatMoney(currencySymbol, report.stats?.grossSales || 0), width);
    pushPair(chunks, 'Devoluciones', formatMoney(currencySymbol, report.stats?.returnsTotal || 0), width);
    pushPair(chunks, 'Ventas Netas', formatMoney(currencySymbol, report.stats?.netSales || 0), width);
    pushPair(chunks, 'Transacciones', String(report.transactionCount || 0), width);
  }

  if (!hiddenModules.includes('PAYMENTS') && paymentMethodSummary.length > 0) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('FORMAS DE PAGO', width));
    paymentMethodSummary.forEach(line => {
      pushPair(chunks, line.name, formatMoney(currencySymbol, line.amount), width);
    });
    pushPair(chunks, 'Total formas de pago', formatMoney(currencySymbol, paymentMethodsTotal), width);
  }

  const serviceTypeSummary = report.serviceTypeSummary || [];
  const closeSummary = getCloseReceiptSummary(report);
  if (serviceTypeSummary.length > 0) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('VENTAS POR TIPO DE SERVICIO', width));
    closeSummary.services.forEach(line => pushPair(chunks, line.label, formatMoney(currencySymbol, line.amount), width));
    pushPair(chunks, 'Total por servicio', formatMoney(currencySymbol, closeSummary.total), width);
  }
  if (closeSummary.taxes.length > 0) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('IMPUESTOS Y PROPINA', width));
    closeSummary.taxes.forEach(line => pushPair(chunks, closeTaxLabel(line), formatMoney(currencySymbol, line.amount), width));
    pushTextLines(chunks, splitLines('Desglose informativo: no sumar al total.', width));
  }

  if (!hiddenModules.includes('CASH_DETAILS') && Object.keys(report.cashExpected || {}).length > 0) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('ARQUEO DE CAJA', width));
    Object.keys(report.cashExpected).forEach(currency => {
      pushTextLines(chunks, splitLines(currency, width));
      if (currency === report.baseCurrency) {
        pushPair(chunks, 'Efectivo en ventas', formatMoney(currencySymbol, report.cashSales || 0), width);
        pushPair(chunks, '(+) Entradas', formatMoney(currencySymbol, report.cashIn || 0), width);
        pushPair(chunks, '(-) Salidas', formatMoney(currencySymbol, report.cashOut || 0), width);
      }
      pushPair(chunks, 'Efectivo esperado', formatMoney(currencySymbol, report.cashExpected[currency] || 0), width);
      pushPair(chunks, 'Efectivo contado', formatMoney(currencySymbol, report.cashCounted[currency] || 0), width);
      pushPair(chunks, 'Diferencia', formatMoney(currencySymbol, report.cashDiscrepancy[currency] || 0), width);
    });
  }

  if (!hiddenModules.includes('CASH_DETAILS') && (report.paymentMethodDeclarations || []).length > 0) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('DECLARACION FORMAS DE PAGO', width));
    report.paymentMethodDeclarations!.forEach(line => {
      pushTextLines(chunks, splitLines(line.name, width));
      pushPair(chunks, 'Esperado', formatMoney(currencySymbol, line.expected), width);
      pushPair(chunks, 'Declarado', formatMoney(currencySymbol, line.declared), width);
      pushPair(chunks, 'Diferencia', formatMoney(currencySymbol, line.difference), width);
    });
  }

  const cashMovementDetails = Array.isArray((report as any).cashMovementDetails)
    ? (report as any).cashMovementDetails
    : [];
  if (!hiddenModules.includes('CASH_DETAILS') && cashMovementDetails.length > 0) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('ENTRADAS / SALIDAS', width));
    cashMovementDetails.forEach((movement: any) => {
      const label = movement.type === 'IN' ? 'Entrada' : 'Salida';
      const reason = movement.reason || 'Movimiento General';
      const time = movement.timestamp
        ? new Date(movement.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
      pushTextLines(chunks, splitLines(`${label} ${time} - ${reason}`, width));
      pushPair(chunks, movement.type === 'IN' ? '(+)' : '(-)', formatMoney(currencySymbol, Number(movement.amount || 0)), width);
    });
  }

  if (!hiddenModules.includes('AUDIT') && report.stats) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('AUDITORIA', width));
    pushPair(chunks, 'Devoluciones', `${report.stats.returnsCount || 0}`, width);
    pushPair(chunks, 'Monto Dev.', formatMoney(currencySymbol, report.stats.returnsTotal || 0), width);
    pushPair(chunks, 'Descuentos', formatMoney(currencySymbol, report.stats.discountsTotal || 0), width);
  }

  if (enabledSections.has('SELLER_SUMMARY')) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('RESUMEN X VENDEDOR', width));
    (reportDetails.sellerSummary || []).forEach(seller => {
      pushTextLines(chunks, splitLines(`${seller.userName} (${seller.transactionCount})`, width));
      pushPair(chunks, 'Venta neta', formatMoney(currencySymbol, seller.netSales), width);
    });
    if (!reportDetails.sellerSummary?.length) pushTextLines(chunks, splitLines('Sin ventas registradas.', width));
  }

  if (enabledSections.has('ITEM_SUMMARY')) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('RESUMEN X ARTICULO', width));
    (reportDetails.itemSummary || []).forEach(item => {
      pushTextLines(chunks, splitLines(`${item.productName} x ${item.quantity}`, width));
      pushPair(chunks, 'Venta neta', formatMoney(currencySymbol, item.netSales), width);
    });
    if (!reportDetails.itemSummary?.length) pushTextLines(chunks, splitLines('Sin articulos registrados.', width));
  }

  if (enabledSections.has('TAX_SUMMARY') && closeSummary.taxes.length === 0 && !Array.isArray(report.closeTaxSummary)) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('IMPUESTOS', width));
    (reportDetails.taxSummary || []).forEach(tax => {
      const rate = Number(tax.rate || 0) <= 1 ? Number(tax.rate || 0) * 100 : Number(tax.rate || 0);
      pushTextLines(chunks, splitLines(`${tax.taxName} (${rate.toFixed(2)}%)`, width));
      pushPair(chunks, 'Base', formatMoney(currencySymbol, tax.taxableBase), width);
      pushPair(chunks, 'Impuesto', formatMoney(currencySymbol, tax.taxAmount), width);
    });
    if (!reportDetails.taxSummary?.length) pushTextLines(chunks, splitLines('Sin impuestos registrados.', width));
  }

  if (enabledSections.has('CURRENCY_BREAKDOWN') || hasDenominationBreakdown) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('DESGLOSE DE MONEDA', width));
    Object.entries(denominationBreakdown).forEach(([currency, lines]) => {
      pushTextLines(chunks, splitLines(currency, width));
      (lines || []).forEach(line => pushPair(
        chunks,
        `${line.denomination} x ${line.quantity}`,
        Number(line.total || 0).toFixed(2),
        width,
      ));
    });
    if (Object.keys(denominationBreakdown).length === 0) pushTextLines(chunks, splitLines('Sin denominaciones registradas.', width));
  }

  if (enabledSections.has('HOURLY_SALES')) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('VENTAS X HORA', width));
    (reportDetails.hourlySales || []).forEach(hour => {
      pushTextLines(chunks, splitLines(`${hour.label} (${hour.transactionCount})`, width));
      pushPair(chunks, 'Venta neta', formatMoney(currencySymbol, hour.netSales), width);
    });
    if (!reportDetails.hourlySales?.length) pushTextLines(chunks, splitLines('Sin ventas registradas.', width));
  }

  if (report.notes) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines(`Notas: ${report.notes}`, width));
  }

  chunks.push(divider(width));
  chunks.push(align(1));
  pushTextLines(chunks, splitLines('Firma del Cajero', width));
  chunks.push(align(0));
  finalizeReceipt(chunks);

  return toBase64(concat(chunks));
};

export const buildEscPosLabelPayload = (
  records: EscPosLabelRecord[],
  currencySymbol: string,
  header = 'IMPRESION DE ETIQUETAS'
): string | null => {
  const prepared = records
    .filter(record => Number.isFinite(record.copies) && record.copies > 0)
    .flatMap(record => Array.from({ length: Math.floor(record.copies) }, () => ({ ...record, copies: 1 })));

  if (!prepared.length) return null;

  const chunks: Uint8Array[] = [];

  chunks.push(initPrinter());
  chunks.push(align(1));
  chunks.push(bold(true));
  chunks.push(text(toAscii(header)));
  chunks.push(bold(false));
  chunks.push(divider(LABEL_LINE_WIDTH));

  prepared.forEach(record => {
    chunks.push(align(1));
    splitLines(record.productName || record.productId, LABEL_LINE_WIDTH).forEach(line => {
      chunks.push(text(line));
    });

    chunks.push(align(0));
    const sku = toAscii(record.sku || record.productId || 'SIN-SKU');
    chunks.push(text(padRight(`SKU: ${sku}`, LABEL_LINE_WIDTH)));

    if (typeof record.price === 'number') {
      const amount = `${currencySymbol}${record.price.toFixed(2)}`;
      chunks.push(text(padRight(`PRECIO: ${toAscii(amount)}`, LABEL_LINE_WIDTH)));
    }

    chunks.push(align(1));
    chunks.push(text(`*${sku}*`));
    chunks.push(align(0));
    chunks.push(divider(LABEL_LINE_WIDTH));
  });

  finalizeReceipt(chunks);
  return toBase64(concat(chunks));
};
