import {
  BusinessConfig, Product, User, Customer, Transaction,
  Warehouse, StockTransfer, CashMovement, InventoryLedgerEntry, LedgerConcept,
  RoleDefinition, ParkedTicket, PurchaseOrder, PurchaseOrderItem, Supplier, Watchlist,
  NCFType, FiscalDocumentCode, FiscalRangeDGII, FiscalAllocation, LocalFiscalBuffer, DocumentSeries,
  Campaign, Coupon, ZReport, XReport, Reception, ProductStock, InventoryTracking, Reservation, InventoryCommitment, PaymentMethodDefinition, CartItem,
  ProductPrice, InventoryLocation
} from '../types';
import {
  MOCK_USERS, RETAIL_PRODUCTS, FOOD_PRODUCTS,
  MOCK_CUSTOMERS, INITIAL_TARIFFS, getInitialConfig,
  DEFAULT_ROLES, DEFAULT_TERMINAL_CONFIG, DEFAULT_DOCUMENT_SERIES
} from '../constants';
import { dbAdapter } from '../services/db';
import { Capacitor } from '@capacitor/core';
import { permissionService } from '../services/sync/PermissionService';
import { mergeDocumentSeriesCollection, mergeIncomingDocumentSeriesWithoutRewind } from './documentSeriesIdentity';
import { reconcilePreparedFiscalCollections } from './fiscalPreparedAuthority';
import {
  RECEPTION_IDEMPOTENCY_COLLECTION,
  buildReceptionIdempotencyKey,
  isReceptionIdempotencyFresh,
  type ReceptionIdempotencyRecord,
} from './receptionIdempotency';
import { buildInventoryLineKey, computeInventoryBalances } from './inventoryBalance';
import type { DurableDocumentMutation } from '../services/db/DatabaseAdapter';

const DB_KEY = 'clic_pos_db_v1';
let initPromise: Promise<any> | null = null;
const INVENTORY_CLOSE_LOCK_MESSAGE = 'Acción denegada: El inventario a esta fecha ya ha sido cerrado y auditado.';
const getFiscalSequencePadding = (_type: FiscalDocumentCode): number => 8;
// Fiscal allocations already belong to one terminal; reserving local batches creates visible NCF gaps if buffers are reset by sync.
const FISCAL_ISSUE_BATCH_SIZE = 1;
const ALLOW_FULL_DEMO_SEED_STORAGE_KEY = 'clic_pos_allow_demo_seed';
const FIRST_RUN_BOOTSTRAP_COLLECTIONS = new Set(['config', 'users', 'roles']);

const getSnapshotLockDate = (snapshot: any): number => {
  const lockRef = snapshot?.lockDate || snapshot?.cutoffDate || snapshot?.closedAt || snapshot?.createdAt;
  return new Date(lockRef).getTime();
};

const assertInventoryMovementUnlocked = async (
  warehouseId: string,
  effectiveDate?: string
): Promise<void> => {
  const snapshots = await dbAdapter.getCollection<any>('inventorySnapshots') || [];
  const closedSnapshots = snapshots
    .filter((s: any) => s.status === 'CLOSED' && s.warehouseId === warehouseId)
    .sort((a: any, b: any) => getSnapshotLockDate(b) - getSnapshotLockDate(a));

  const activeLock = closedSnapshots[0];
  if (!activeLock) return;

  const lockDate = getSnapshotLockDate(activeLock);
  if (!Number.isFinite(lockDate)) return;

  const movementDate = effectiveDate ? new Date(effectiveDate).getTime() : Date.now();
  if (!Number.isFinite(movementDate)) {
    throw new Error('Fecha de movimiento inválida.');
  }

  if (movementDate <= lockDate) {
    throw new Error(INVENTORY_CLOSE_LOCK_MESSAGE);
  }
};

const toValidMovementIso = (effectiveDate?: string): string => {
  if (!effectiveDate) return new Date().toISOString();
  const parsed = new Date(effectiveDate);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Fecha de movimiento inválida.');
  }
  return parsed.toISOString();
};

/**
 * Publica un lote de documentos en una sola transacción cuando el adaptador la
 * soporta. Si no (o si falla), escribe en el mismo orden para no perder datos.
 */
const commitDocumentMutations = async (mutations: DurableDocumentMutation[]): Promise<void> => {
  if (!mutations.length) return;

  if (typeof dbAdapter.saveDocumentsAtomically === 'function') {
    try {
      await dbAdapter.saveDocumentsAtomically(mutations);
      return;
    } catch (error) {
      console.warn('[Recepción] Commit atómico no disponible; guardando secuencialmente.', error);
    }
  }

  for (const mutation of mutations) {
    await dbAdapter.saveDocument(mutation.collectionName, mutation.document);
  }
};

type ProcessReceiptDocumentType = 'PURCHASE_ORDER' | 'TRANSFER_IN';

interface ProcessReceiptItem {
  productId: string;
  productName: string;
  expectedQty: number;
  receivedQty: number;
  cost?: number;
  variantSku?: string;
  variantInfo?: string;
}

interface ProcessReceiptPayload {
  documentType: ProcessReceiptDocumentType;
  documentId: string;
  warehouseId: string;
  receivedBy: string;
  receivedByUserName: string;
  terminalId?: string;
  discrepancyReason?: string;
  items: ProcessReceiptItem[];
  effectiveDate?: string;
  /** Clave de idempotencia. Si falta se deriva del documento y sus líneas. */
  idempotencyKey?: string;
}

// --- SEED DATA ---
const DEFAULT_WAREHOUSES: Warehouse[] = [
  { id: "wh_central", code: "CEN", name: "Bodega Central", type: "PHYSICAL", address: "Calle Industria #45", allowPosSale: true, allowNegativeStock: false, isMain: true, storeId: "S1", erpWarehouseId: "wh_central" },
  { id: "wh_norte", code: "NTE", name: "Piso de Venta Norte", type: "PHYSICAL", address: "Plaza Norte, Local 10", allowPosSale: true, allowNegativeStock: false, isMain: false, storeId: "S2", erpWarehouseId: "wh_norte" },
];

const SEED_DATA = {
  config: (() => {
    const baseConfig = getInitialConfig('Supermercado' as any);
    if (baseConfig.terminals[0]) {
      baseConfig.terminals[0].config.inventoryScope = {
        defaultSalesWarehouseId: "wh_central",
        visibleWarehouseIds: DEFAULT_WAREHOUSES.map(w => w.id)
      };
    }
    return baseConfig;
  })(),
  users: MOCK_USERS,
  roles: DEFAULT_ROLES,
  customers: MOCK_CUSTOMERS,
  warehouses: DEFAULT_WAREHOUSES,
  products: RETAIL_PRODUCTS.map(p => ({
    ...p,
    createdAt: new Date().toISOString(),
    stockBalances: { "wh_central": 100, "wh_norte": 0 }
  })),
  transactions: [] as Transaction[],
  transactionHistory: [] as Transaction[],
  invoiceReviewFlags: [],
  invoiceAuditEvents: [],
  invoiceAdjustments: [],
  cashMovements: [] as CashMovement[],
  transfers: [] as StockTransfer[],
  parkedTickets: [] as ParkedTicket[],
  purchaseOrders: [] as PurchaseOrder[],
  suppliers: [] as Supplier[],
  inventoryLedger: RETAIL_PRODUCTS.map(p => ({
    id: `LEG-INIT-${p.id}-wh_central`,
    createdAt: new Date().toISOString(),
    date: new Date().toISOString(),
    warehouseId: 'wh_central',
    productId: p.id,
    concept: 'CARGA_INICIAL' as LedgerConcept,
    documentRef: 'SEED',
    qtyIn: 100,
    qtyOut: 0,
    price: p.price,
    cost: p.cost,
    unitCost: p.cost,
    balanceQty: 100,
    avgCost: p.cost,
    balanceAvgCost: p.cost,
    terminalId: 't1',
    status: 'COMPLETED'
  })) as InventoryLedgerEntry[],
  watchlists: [] as Watchlist[],
  internalSequences: DEFAULT_DOCUMENT_SERIES as DocumentSeries[],
  fiscalRanges: [
    { id: 'fr1', type: 'B01', prefix: 'B01', startNumber: 1, endNumber: 10000, currentGlobal: 0, expiryDate: '2026-12-31', isActive: true },
    { id: 'fr2', type: 'B02', prefix: 'B02', startNumber: 1, endNumber: 50000, currentGlobal: 0, expiryDate: '2026-12-31', isActive: true },
    { id: 'fr3', type: 'B04', prefix: 'B04', startNumber: 1, endNumber: 10000, currentGlobal: 0, expiryDate: '2026-12-31', isActive: true },
    { id: 'fr4', type: 'B14', prefix: 'B14', startNumber: 1, endNumber: 10000, currentGlobal: 0, expiryDate: '2026-12-31', isActive: true },
    { id: 'fr5', type: 'B15', prefix: 'B15', startNumber: 1, endNumber: 10000, currentGlobal: 0, expiryDate: '2026-12-31', isActive: true }
  ] as FiscalRangeDGII[],
  fiscalAllocations: [] as FiscalAllocation[],
  localFiscalBuffer: [] as LocalFiscalBuffer[],
  campaigns: [
    {
      id: 'camp_summer_2024',
      name: 'Verano 2024 Instagram',
      description: 'Campaña de redes sociales',
      benefitType: 'PERCENT',
      benefitValue: 20,
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2026-12-31T23:59:59Z',
      totalGenerated: 5,
      createdAt: new Date().toISOString()
    }
  ] as Campaign[],
  coupons: [
    { id: 'cpn_1', campaignId: 'camp_summer_2024', code: 'VERANO-2024', status: 'GENERATED', createdAt: new Date().toISOString() },
    { id: 'cpn_2', campaignId: 'camp_summer_2024', code: 'INSTA-PROMO', status: 'GENERATED', createdAt: new Date().toISOString() },
    { id: 'cpn_3', campaignId: 'camp_summer_2024', code: 'VIP-CLIENT', status: 'GENERATED', createdAt: new Date().toISOString() }
  ] as Coupon[],
  zReports: [] as ZReport[],
  xReports: [] as XReport[],
  receptions: [] as Reception[],
  productStocks: RETAIL_PRODUCTS.map(p => ({
    id: `${p.id}_wh_central`,
    productId: p.id,
    warehouseId: 'wh_central',
    quantity: 100,
    qtyPhysical: 100,
    qtyCommitted: 0,
    qtyAvailable: 100,
    updatedAt: new Date().toISOString()
  })) as ProductStock[],
  productPrices: [] as ProductPrice[],
  reservations: [] as Reservation[],
  inventoryCommitments: [] as InventoryCommitment[],
  supplierProductPrices: [] as any[],
  inventoryTracking: [] as InventoryTracking[],
  inventorySnapshots: [] as any[],
  inventoryAuditLogs: [] as any[],
  inventoryCounts: [] as any[],
  locations: [] as InventoryLocation[],
  offline_receptions: [] as any[],
  offline_reception_queue: [] as any[],
  offline_reception_conflicts: [] as any[],
  receptionIdempotency: [] as any[],
  offline_inventory_counts: [] as any[],
  offline_inventory_count_queue: [] as any[],
  offline_inventory_count_conflicts: [] as any[],
  offline_print_queue: [] as any[],
  rooms: [] as any[],
  tables: [] as any[],
  categories: [] as any[],
  productCategories: [] as any[],
  productGroups: [] as any[],
  collections: [] as any[],
  paymentMethods: [] as PaymentMethodDefinition[],
  serviceTypes: [] as any[],
  activities: [] as any[],
  crmOpportunities: [] as any[],
  erp_sales_documents: [] as any[],
  wallet_transactions: [] as any[],
  loyalty_events: [] as any[],
  posUserMutations: [] as any[],
  catalogEdits: [] as any[],
  productionAreas: [] as any[]
};

const normalizeSequenceKey = (value?: string | null): string =>
  typeof value === 'string' ? value.trim().toUpperCase() : '';

const matchesDocumentSeries = (left: DocumentSeries, right: DocumentSeries): boolean => {
  const leftId = normalizeSequenceKey(left.id);
  const rightId = normalizeSequenceKey(right.id);
  if (leftId && rightId && leftId === rightId) return true;

  const leftPrefix = normalizeSequenceKey(left.prefix);
  const rightPrefix = normalizeSequenceKey(right.prefix);
  const leftType = normalizeSequenceKey(left.documentType);
  const rightType = normalizeSequenceKey(right.documentType);

  return Boolean(leftPrefix && rightPrefix && leftPrefix === rightPrefix && leftType && rightType && leftType === rightType);
};

const isDemoOrDefaultDocumentSeries = (series: Partial<DocumentSeries> | null | undefined): boolean => {
  if (!series) return false;
  const id = normalizeSequenceKey(series.id);
  const name = normalizeSequenceKey(series.name);
  const prefix = normalizeSequenceKey(series.prefix);
  const documentType = normalizeSequenceKey(series.documentType as string);
  const source = normalizeSequenceKey((series as any).source);
  if (source === 'ERP_TERMINAL_CONFIG') return false;
  if (name.includes('DEMO')) return true;
  return DEFAULT_DOCUMENT_SERIES.some((defaultSeries) => {
    const defaultId = normalizeSequenceKey(defaultSeries.id);
    const defaultPrefix = normalizeSequenceKey(defaultSeries.prefix);
    const defaultType = normalizeSequenceKey(defaultSeries.documentType);
    return Boolean(
      (id && id === defaultId) ||
      (prefix && prefix === defaultPrefix && documentType && documentType === defaultType)
    );
  });
};

const matchesFiscalRange = (left: FiscalRangeDGII, right: FiscalRangeDGII): boolean => {
  const leftId = normalizeSequenceKey(left.id);
  const rightId = normalizeSequenceKey(right.id);
  if (leftId && rightId && leftId === rightId) return true;

  const leftType = normalizeSequenceKey(left.type);
  const rightType = normalizeSequenceKey(right.type);
  if (leftType && rightType && leftType === rightType) return true;

  const leftPrefix = normalizeSequenceKey(left.prefix);
  const rightPrefix = normalizeSequenceKey(right.prefix);
  return Boolean(leftPrefix && rightPrefix && leftPrefix === rightPrefix);
};

const mergeDocumentSeriesState = (
  existingSeries: DocumentSeries[],
  incomingSeries: DocumentSeries[]
): DocumentSeries[] => {
  const normalizeSeriesPadding = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 6;
  };
  const normalizedIncoming = (incomingSeries || []).map((incoming) => ({
    ...incoming,
    nextNumber: Math.max(1, Number(incoming?.nextNumber) || 1),
    padding: normalizeSeriesPadding(incoming?.padding),
  }));
  const hasAuthoritativeErpSeries = normalizedIncoming.some((incoming) =>
    String((incoming as any)?.source || '').toUpperCase() === 'ERP_TERMINAL_CONFIG'
  );

  if (hasAuthoritativeErpSeries) {
    const existing = existingSeries || [];
    const authoritativeSeries = normalizedIncoming.map((incoming) => {
      const incomingId = normalizeSequenceKey(incoming.id);
      const incomingCode = normalizeSequenceKey((incoming as any).code);
      const incomingType = normalizeSequenceKey((incoming as any).documentType);
      const incomingPrefix = normalizeSequenceKey(incoming.prefix);
      const localMatch = existing.find((candidate) => {
        const candidateId = normalizeSequenceKey(candidate.id);
        const candidateCode = normalizeSequenceKey((candidate as any).code);
        const candidateType = normalizeSequenceKey((candidate as any).documentType);
        const candidatePrefix = normalizeSequenceKey(candidate.prefix);
        if (incomingId && candidateId && incomingId === candidateId) return true;
        if (incomingCode && candidateCode && incomingCode === candidateCode) return true;
        return Boolean(
          incomingType &&
          candidateType &&
          incomingPrefix &&
          candidatePrefix &&
          incomingType === candidateType &&
          incomingPrefix === candidatePrefix
        );
      });
      return {
        ...incoming,
        nextNumber: Math.max(
          Math.max(1, Number(incoming.nextNumber) || 1),
          Math.max(1, Number(localMatch?.nextNumber) || 1)
        ),
      };
    });

    console.info('POS_DOCUMENT_SERIES_NORMALIZED', {
      count: authoritativeSeries.length,
      source: 'ERP_TERMINAL_CONFIG',
      mode: 'AUTHORITATIVE_REPLACE_DEFAULTS',
      codes: authoritativeSeries.map((series: any) => series.code || series.prefix || series.id),
      purgedDefaults: existing.filter(isDemoOrDefaultDocumentSeries).length,
    });

    return mergeIncomingDocumentSeriesWithoutRewind(existing, authoritativeSeries);
  }

  return mergeDocumentSeriesCollection([...(existingSeries || []), ...normalizedIncoming]);
};

const mergeFiscalRangesState = (
  existingRanges: FiscalRangeDGII[],
  incomingRanges: FiscalRangeDGII[]
): { mergedRanges: FiscalRangeDGII[]; bufferTypesToReset: Set<FiscalDocumentCode> } => {
  const merged = [...(existingRanges || [])];
  const bufferTypesToReset = new Set<FiscalDocumentCode>();

  incomingRanges.forEach((incoming) => {
    const matchIndex = merged.findIndex((candidate) => matchesFiscalRange(candidate, incoming));
    const normalizedIncoming: FiscalRangeDGII = {
      ...incoming,
      currentGlobal: Math.max(0, Number(incoming.currentGlobal) || 0),
      startNumber: Math.max(0, Number(incoming.startNumber) || 0),
      endNumber: Math.max(0, Number(incoming.endNumber) || 0),
      isActive: Boolean(incoming.isActive),
    };

    if (matchIndex === -1) {
      merged.push(normalizedIncoming);
      bufferTypesToReset.add(normalizedIncoming.type);
      return;
    }

    const current = merged[matchIndex];
    const authoritativeAdvance = normalizedIncoming.currentGlobal > (Number(current?.currentGlobal) || 0);
    const rangeShapeChanged =
      normalizeSequenceKey(current?.prefix) !== normalizeSequenceKey(normalizedIncoming.prefix) ||
      Number(current?.startNumber) !== normalizedIncoming.startNumber ||
      Number(current?.endNumber) !== normalizedIncoming.endNumber;

    if (authoritativeAdvance || rangeShapeChanged) {
      bufferTypesToReset.add(normalizedIncoming.type);
    }

    merged[matchIndex] = {
      ...current,
      ...normalizedIncoming,
      currentGlobal: Math.max(Number(current?.currentGlobal) || 0, normalizedIncoming.currentGlobal),
    };
  });

  return { mergedRanges: merged, bufferTypesToReset };
};

const normalizeFiscalAllocationStatus = (value: unknown): FiscalAllocation['status'] => {
  const normalized = normalizeSequenceKey(typeof value === 'string' ? value : '');
  const allowed: FiscalAllocation['status'][] = ['ACTIVE', 'PAUSED', 'EXHAUSTED', 'RELEASED', 'CONFLICTED', 'LEGACY'];
  return allowed.includes(normalized as FiscalAllocation['status'])
    ? (normalized as FiscalAllocation['status'])
    : 'ACTIVE';
};

const isOperationalFiscalAllocationStatus = (status: FiscalAllocation['status']): boolean =>
  ['ACTIVE', 'PAUSED', 'EXHAUSTED', 'LEGACY'].includes(status);

const normalizeFiscalAllocationRecord = (
  allocation: Partial<FiscalAllocation>,
  terminalIdFallback = ''
): FiscalAllocation => {
  const reservedStart = Math.max(1, Number(allocation.reservedStart) || 1);
  const reservedEnd = Math.max(reservedStart, Number(allocation.reservedEnd) || reservedStart);
  const nextNumber = Number(allocation.nextNumber);
  const boundedNextNumber = Number.isFinite(nextNumber)
    ? Math.max(reservedStart, Math.min(nextNumber, reservedEnd + 1))
    : reservedStart;
  const normalizedStatus = normalizeFiscalAllocationStatus(allocation.status);
  const effectiveStatus =
    normalizedStatus === 'EXHAUSTED' && boundedNextNumber <= reservedEnd
      ? 'ACTIVE'
      : normalizedStatus;

  return {
    id: String(allocation.id || `${terminalIdFallback || 'terminal'}-${allocation.ncfType || 'B02'}`),
    terminalId: String(allocation.terminalId || terminalIdFallback || ''),
    fiscalRangeId: String(allocation.fiscalRangeId || ''),
    ncfType: (normalizeSequenceKey(allocation.ncfType as string) || 'B02') as FiscalDocumentCode,
    prefix: typeof allocation.prefix === 'string' ? allocation.prefix : undefined,
    reservedStart,
    reservedEnd,
    nextNumber: boundedNextNumber,
    releasedAt: allocation.releasedAt ?? null,
    metadata: allocation.metadata || {},
    status: effectiveStatus,
  };
};

const serializeFiscalAllocation = (allocation: FiscalAllocation) => JSON.stringify({
  id: allocation.id,
  terminalId: allocation.terminalId,
  fiscalRangeId: allocation.fiscalRangeId || null,
  ncfType: allocation.ncfType,
  prefix: allocation.prefix || null,
  reservedStart: allocation.reservedStart,
  reservedEnd: allocation.reservedEnd,
  nextNumber: allocation.nextNumber,
  status: allocation.status,
  releasedAt: allocation.releasedAt || null,
});

const fiscalAllocationIdentityKey = (allocation: Partial<FiscalAllocation>) => {
  const normalized = normalizeFiscalAllocationRecord(allocation);
  return [
    normalizeSequenceKey(normalized.id),
    normalizeSequenceKey(normalized.terminalId),
    normalizeSequenceKey(normalized.fiscalRangeId),
    normalizeSequenceKey(normalized.ncfType),
    String(normalized.reservedStart),
    String(normalized.reservedEnd),
  ].join('::');
};

const resolveMergedFiscalAllocationNextNumber = (
  existing: FiscalAllocation,
  incoming: FiscalAllocation,
  sameOperationalState: boolean,
): number => {
  if (!sameOperationalState) {
    return incoming.nextNumber;
  }

  const existingNext = Number(existing.nextNumber) || incoming.reservedStart;
  const incomingNext = Number(incoming.nextNumber) || incoming.reservedStart;
  const reservedEnd = Number(incoming.reservedEnd) || 0;
  const existingExhausted = existingNext > reservedEnd || existing.status === 'EXHAUSTED';
  const incomingHasOpenCapacity = incomingNext <= reservedEnd && incoming.status !== 'EXHAUSTED';

  // A previous POS build could advance terminal fiscal allocations by a whole batch.
  // When ERP later sends the corrected pointer, accept it instead of keeping the stale local EXHAUSTED state.
  if (existingExhausted && incomingHasOpenCapacity) {
    return incomingNext;
  }

  return Math.max(existingNext, incomingNext);
};

const mergeFiscalAllocationsState = (
  existingAllocations: FiscalAllocation[],
  incomingAllocations: FiscalAllocation[],
  terminalId: string
): { mergedAllocations: FiscalAllocation[]; bufferTypesToReset: Set<FiscalDocumentCode> } => {
  const normalizedTerminalId = normalizeSequenceKey(terminalId);
  const normalizedIncomingRaw = (incomingAllocations || [])
    .map((allocation) => normalizeFiscalAllocationRecord(allocation, terminalId))
    .filter((allocation) => normalizeSequenceKey(allocation.terminalId) === normalizedTerminalId)
    .sort((left, right) => serializeFiscalAllocation(left).localeCompare(serializeFiscalAllocation(right)));

  const existingForTerminal = (existingAllocations || [])
    .map((allocation) => normalizeFiscalAllocationRecord(allocation))
    .filter((allocation) => normalizeSequenceKey(allocation.terminalId) === normalizedTerminalId)
    .sort((left, right) => serializeFiscalAllocation(left).localeCompare(serializeFiscalAllocation(right)));

  const existingByIdentity = new Map(
    existingForTerminal.map((allocation) => [fiscalAllocationIdentityKey(allocation), allocation])
  );

  const normalizedIncoming = normalizedIncomingRaw.map((incoming) => {
    const existing = existingByIdentity.get(fiscalAllocationIdentityKey(incoming));
    if (!existing) return incoming;

    const sameOperationalState =
      isOperationalFiscalAllocationStatus(existing.status) &&
      isOperationalFiscalAllocationStatus(incoming.status);
    const mergedNextNumber = resolveMergedFiscalAllocationNextNumber(existing, incoming, sameOperationalState);
    const mergedStatus =
      mergedNextNumber > incoming.reservedEnd
        ? 'EXHAUSTED'
        : (!sameOperationalState ? incoming.status : incoming.status);

    return normalizeFiscalAllocationRecord({
      ...incoming,
      nextNumber: mergedNextNumber,
      status: mergedStatus,
      prefix: existing.prefix || incoming.prefix,
      metadata: {
        ...(existing.metadata || {}),
        ...(incoming.metadata || {}),
      },
    }, terminalId);
  });

  const remainingAllocations = (existingAllocations || []).filter(
    (allocation) => normalizeSequenceKey(allocation.terminalId) !== normalizedTerminalId
  );

  const changed =
    JSON.stringify(existingForTerminal.map(serializeFiscalAllocation)) !==
    JSON.stringify(normalizedIncoming.map(serializeFiscalAllocation));

  const bufferTypesToReset = new Set<FiscalDocumentCode>();
  if (changed) {
    [...existingForTerminal, ...normalizedIncoming].forEach((allocation) => {
      if (allocation?.ncfType) {
        bufferTypesToReset.add(allocation.ncfType);
      }
    });
  }

  return {
    mergedAllocations: [...remainingAllocations, ...normalizedIncoming],
    bufferTypesToReset,
  };
};

const getTerminalFiscalAllocation = (
  allocations: FiscalAllocation[],
  terminalId: string | undefined,
  type: FiscalDocumentCode
): FiscalAllocation | null => {
  const normalizedTerminalId = normalizeSequenceKey(terminalId);
  const normalizedType = normalizeSequenceKey(type);
  const candidates = (allocations || [])
    .map((allocation) => normalizeFiscalAllocationRecord(allocation))
    .filter((allocation) =>
      normalizeSequenceKey(allocation.ncfType) === normalizedType &&
      isOperationalFiscalAllocationStatus(allocation.status) &&
      (!normalizedTerminalId || normalizeSequenceKey(allocation.terminalId) === normalizedTerminalId)
    )
    .sort((left, right) => {
      const priority = (status: FiscalAllocation['status']) => {
        switch (status) {
          case 'ACTIVE':
            return 0;
          case 'PAUSED':
            return 1;
          case 'EXHAUSTED':
            return 2;
          case 'LEGACY':
            return 3;
          default:
            return 4;
        }
      };
      return priority(left.status) - priority(right.status);
    });

  return candidates[0] || null;
};

const getFiscalRangeForEmission = (
  ranges: FiscalRangeDGII[],
  type: FiscalDocumentCode,
  allocation?: FiscalAllocation | null
): FiscalRangeDGII | null => {
  const normalizedType = normalizeSequenceKey(type);
  const normalizedRangeId = normalizeSequenceKey(allocation?.fiscalRangeId || '');
  const normalizedPrefix = normalizeSequenceKey(allocation?.prefix || '');

  if (normalizedRangeId) {
    const matchById = (ranges || []).find((range) => normalizeSequenceKey(range.id) === normalizedRangeId);
    if (matchById) return matchById;
  }

  if (normalizedPrefix) {
    const matchByPrefix = (ranges || []).find((range) =>
      normalizeSequenceKey(range.prefix) === normalizedPrefix &&
      normalizeSequenceKey(range.type) === normalizedType
    );
    if (matchByPrefix) return matchByPrefix;
  }

  return (ranges || []).find((range) =>
    normalizeSequenceKey(range.type) === normalizedType && Boolean(range.isActive)
  ) || null;
};

const parseFiscalSequenceNumber = (ncf: unknown, prefix: string): number | null => {
  const normalizedNcf = typeof ncf === 'string' ? ncf.trim().toUpperCase() : '';
  const normalizedPrefix = normalizeSequenceKey(prefix);
  if (!normalizedNcf || !normalizedPrefix || !normalizedNcf.startsWith(normalizedPrefix)) {
    return null;
  }

  const numericPart = normalizedNcf.slice(normalizedPrefix.length);
  if (!/^\d+$/.test(numericPart)) {
    return null;
  }

  const parsed = Number.parseInt(numericPart, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const getMaxIssuedFiscalNumber = async (type: FiscalDocumentCode, prefix: string): Promise<number> => {
  const normalizedType = normalizeSequenceKey(type);
  const [activeTransactions, archivedTransactions] = await Promise.all([
    dbAdapter.getCollection<Transaction>('transactions').catch(() => [] as Transaction[]),
    dbAdapter.getCollection<Transaction>('transactionHistory').catch(() => [] as Transaction[]),
  ]);
  const issuedNumbers = [...(activeTransactions || []), ...(archivedTransactions || [])]
    .filter((transaction) => normalizeSequenceKey(transaction?.ncfType) === normalizedType)
    .map((transaction) => parseFiscalSequenceNumber(transaction?.ncf || transaction?.electronicNcf, prefix))
    .filter((value): value is number => typeof value === 'number');

  return issuedNumbers.length > 0 ? Math.max(...issuedNumbers) : 0;
};

const getNextFiscalNumberFromHistory = async (
  type: FiscalDocumentCode,
  prefix: string,
  startNumber: number,
  endNumber: number,
): Promise<number | null> => {
  const maxIssued = await getMaxIssuedFiscalNumber(type, prefix);
  if (maxIssued <= 0) {
    return null;
  }

  const nextNumber = maxIssued + 1;
  if (nextNumber < startNumber || nextNumber > endNumber) {
    return null;
  }

  return nextNumber;
};

export const db = {
  init: async (terminalId?: string) => {
    if (initPromise) {
      console.log('♻️ Reusing existing DB Init');
      return initPromise;
    }

    const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
      let timeoutHandle: number | undefined;
      try {
        return await Promise.race([
          promise,
          new Promise<T>((_, reject) => {
            timeoutHandle = window.setTimeout(() => reject(new Error(`TIMEOUT:${label}`)), ms);
          })
        ]);
      } finally {
        if (timeoutHandle) window.clearTimeout(timeoutHandle);
      }
    };

    const getFallbackCollectionValue = (key: string) => {
      const seedValue = (SEED_DATA as any)[key];
      if (Array.isArray(seedValue)) return [];
      if (typeof seedValue === 'number') return 0;
      return {};
    };

    const isCriticalCollection = (key: string) =>
      [
        'config',
        'users',
        'roles',
        'customers',
        'warehouses',
        'products',
        'categories',
        'productCategories',
        'productGroups',
        'cashMovements',
        'internalSequences',
        'zReports',
        'productStocks',
        'productPrices',
        'reservations',
        'inventoryCommitments',
        'collections',
        'serviceTypes',
        'activities',
        'crmOpportunities',
        'erp_sales_documents'
      ].includes(key);

    const isNativeAndroidRuntime =
      Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

    const ANDROID_BOOTSTRAP_COLLECTIONS = new Set([
      'config',
      'users',
      'roles',
      'internalSequences',
      'paymentMethods',
    ]);

    const isDeferredHeavyCollection = (key: string) => {
      if (['transactions', 'transactionHistory'].includes(key)) return true;
      if (isNativeAndroidRuntime && !ANDROID_BOOTSTRAP_COLLECTIONS.has(key)) {
        return true;
      }
      return false;
    };

    const shouldCheckSeedForCollection = (key: string, value: any) => {
      if (key === 'config') return true;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'number') return value !== 0;
      if (value && typeof value === 'object') return Object.keys(value).length > 0;
      return !!value;
    };

    const shouldSeedFullDemoData = () => {
      try {
        return window.localStorage.getItem(ALLOW_FULL_DEMO_SEED_STORAGE_KEY) === '1';
      } catch (error) {
        return false;
      }
    };

    const _initRunner = async () => {
      console.log('🏁 _initRunner started');
      console.log('🔌 Connecting to DB Adapter...');
      await withTimeout(dbAdapter.connect(), 15000, 'DB_CONNECT');
      console.log('✅ DB Adapter connected');

      // Check if seeded
      console.log('🔍 Checking config collection...');
      const existingConfig = await withTimeout(
        dbAdapter.getCollection('config'),
        8000,
        'GET_CONFIG_COLLECTION'
      );
      console.log('✅ Config check complete, exists:', !!existingConfig);
      const isSlave = permissionService.isSlaveTerminal();
      console.log('🤖 isSlave:', isSlave);

      // Migration Logic: Ensure all collections exist even if config exists
      // SKIP SEEDING ON SLAVES: Slaves must wait for Master snapshot
      if (!isSlave) {
        // --- CHECK DATABASE INITIALIZATION FLAG ---
        // This prevents re-seeding of demo data on every reload
        let isFirstRun = false;
        try {
          const initFlag = await dbAdapter.getDocument('config', '_db_initialized');
          isFirstRun = !initFlag;
          console.log(`🏁 Database initialization status: ${isFirstRun ? 'FIRST RUN' : 'ALREADY INITIALIZED'}`);
        } catch (error) {
          console.log('🏁 No initialization flag found - treating as first run');
          isFirstRun = true;
        }

        // --- CONFIG PATCHING (Always run if config exists) ---
        if (existingConfig && (Array.isArray(existingConfig) ? existingConfig.length > 0 : Object.keys(existingConfig).length > 0)) {
          // Robustly identify the real configuration document
          let currentConfig: BusinessConfig;
          if (Array.isArray(existingConfig)) {
            currentConfig = (existingConfig.find((c: any) => c.id === 'current') ||
              existingConfig.find((c: any) => c.id !== '_db_initialized' && c.id !== 'config_metadata') ||
              existingConfig[0]) as any as BusinessConfig;
          } else {
            currentConfig = existingConfig as any as BusinessConfig;
          }

          let wasPatched = false;
          const seedConfig = SEED_DATA.config;

          if (currentConfig.terminals) {
            currentConfig.terminals.forEach(t => {
              // Patch 0: Special fix for t1 role (Price Checker -> STANDARD_POS)
              if (t.id === 't1' && (t.config.deviceRole?.role !== 'STANDARD_POS')) {
                console.warn('🩹 Patching terminal t1: Force role to STANDARD_POS');
                const seedVal = seedConfig.terminals.find(st => st.id === 't1');
                if (seedVal?.config.deviceRole) {
                  t.config.deviceRole = JSON.parse(JSON.stringify(seedVal.config.deviceRole));
                  wasPatched = true;
                }
              }

              // Patch 1: Missing Customer Display
              if (!t.config.hardware.customerDisplay) {
                const seedVal = seedConfig.terminals.find(st => st.id === t.id) || seedConfig.terminals[0];
                if (seedVal?.config.hardware.customerDisplay) {
                  t.config.hardware.customerDisplay = JSON.parse(JSON.stringify(seedVal.config.hardware.customerDisplay));
                  wasPatched = true;
                }
              }

              // Patch 2: Missing Reservation Policy
              if (!t.config.operational?.reservationPolicy) {
                const seedVal = seedConfig.terminals.find(st => st.id === t.id) || seedConfig.terminals[0];
                if (seedVal?.config.operational?.reservationPolicy) {
                  if (!t.config.operational) t.config.operational = {} as any;
                  t.config.operational.reservationPolicy = JSON.parse(JSON.stringify(seedVal.config.operational.reservationPolicy));
                  wasPatched = true;
                }
              }
            });
          }

          if (wasPatched) {
            console.log('🩹 Config patched with new defaults');
            await withTimeout(dbAdapter.saveCollection('config', currentConfig as any), 8000, 'SAVE_PATCHED_CONFIG');
          }
        }

        // --- SEEDING MISSING COLLECTIONS ---
        // CRITICAL FIX: Only seed collections on first run
        // This prevents re-seeding demo data and overwriting user data
        if (isFirstRun) {
          const allowFullDemoSeed = shouldSeedFullDemoData();
          console.log(`🌱 First run detected - seeding ${allowFullDemoSeed ? 'full demo' : 'core bootstrap'} data...`);
          for (const [key, value] of Object.entries(SEED_DATA)) {
            if (!allowFullDemoSeed && !FIRST_RUN_BOOTSTRAP_COLLECTIONS.has(key)) continue;
            if (!shouldCheckSeedForCollection(key, value)) continue;
            try {
              const existingCollection = await withTimeout(
                dbAdapter.getCollection(key),
                isCriticalCollection(key) ? 15000 : 8000,
                `SEED_CHECK_${key}`
              );

              // If collection is missing or empty (except config which we already handled), seed it
              if (!existingCollection || (Array.isArray(existingCollection) && existingCollection.length === 0 && key !== 'config')) {
                console.log(`🌱 Seeding missing collection: ${key}`);
                await withTimeout(dbAdapter.saveCollection(key, value as any), 8000, `SEED_SAVE_${key}`);
              }
            } catch (error) {
              console.warn(`⚠️ Failed to seed collection ${key}:`, error);
            }
          }

          // Save initialization flag to prevent future re-seeding
          try {
            await dbAdapter.saveDocument('config', {
              id: '_db_initialized',
              timestamp: new Date().toISOString(),
              version: 1
            });
            console.log('✅ Database initialization flag saved');
          } catch (error) {
            console.warn('⚠️ Failed to save initialization flag:', error);
          }
        } else {
          console.log('ℹ️ Skipping auto-seed - database already initialized');
          console.log('ℹ️ If collections are empty, they were intentionally cleared by the user');
        }
      } else {
        console.log('ℹ️ Slave terminal detected: Skipping auto-seeding. Waiting for Master sync.');
      }

      // Determine if we should return seed data (only for masters that are truly empty AND first run)
      const hasConfig = existingConfig && (Array.isArray(existingConfig) ? existingConfig.length > 0 : Object.keys(existingConfig).length > 0);

      // Check if database has been initialized before
      let isInitialized = false;
      try {
        const initFlag = await dbAdapter.getDocument('config', '_db_initialized');
        isInitialized = !!initFlag;
      } catch (error) {
        // Flag doesn't exist, database is not initialized
        isInitialized = false;
      }

      // Only return SEED_DATA on first run for master terminals without config
      if (!hasConfig && !isSlave && !isInitialized) {
        const allowFullDemoSeed = shouldSeedFullDemoData();
        console.log(`🌱 No config found on Master (First Run): Returning ${allowFullDemoSeed ? 'SEED_DATA' : 'bootstrap data'}`);
        if (allowFullDemoSeed) {
          return SEED_DATA;
        }

        return Object.keys(SEED_DATA).reduce((acc: any, key) => {
          acc[key] = FIRST_RUN_BOOTSTRAP_COLLECTIONS.has(key)
            ? (SEED_DATA as any)[key]
            : getFallbackCollectionValue(key);
          return acc;
        }, {});
      }

      // Load all data to return consistent structure (Legacy support)
      // Bounded waits prevent the whole init from hanging on one store.
      console.log('📦 Loading all collections...');
      const keys = Object.keys(SEED_DATA);

      const loadCollectionValue = async (key: string) => {
        if (isDeferredHeavyCollection(key)) {
          console.warn(`⏭️ Skipping heavy collection during init: ${key}`);
          return getFallbackCollectionValue(key);
        }
        try {
          return await withTimeout(
            dbAdapter.getCollection(key, (terminalId && key === 'rooms') ? { terminal_id: terminalId } : undefined),
            isCriticalCollection(key) ? 25000 : 10000,
            `LOAD_COLLECTION_${key}`
          );
        } catch (error) {
          if (isCriticalCollection(key)) {
            console.warn(`⚠️ Timeout/error loading critical collection ${key}. Retrying with extended timeout...`, error);
            return await withTimeout(
              dbAdapter.getCollection(key, (terminalId && key === 'rooms') ? { terminal_id: terminalId } : undefined),
              45000,
              `LOAD_COLLECTION_RETRY_${key}`
            );
          }
          console.warn(`⚠️ Timeout/error loading ${key}. Using fallback.`, error);
          return getFallbackCollectionValue(key);
        }
      };

      const results: Array<PromiseSettledResult<any>> = [];
      if (isNativeAndroidRuntime) {
        for (const key of keys) {
          try {
            const value = await loadCollectionValue(key);
            results.push({ status: 'fulfilled', value });
          } catch (reason) {
            results.push({ status: 'rejected', reason });
          }
        }
      } else {
        const settled = await Promise.allSettled(keys.map((key) => loadCollectionValue(key)));
        results.push(...settled);
      }
      console.log('✅ All collections loaded (settled)');

      const data: any = {};
      results.forEach((result, index) => {
        const key = keys[index];
        if (result.status === 'fulfilled') {
          data[key] = result.value;
        } else {
          console.error(`❌ Failed to load ${key}:`, result.reason);
          data[key] = getFallbackCollectionValue(key);
        }
      });

      console.log('📤 _initRunner returning data');
      return data;
    };

    const dedupedInit = (async () => {
      try {
        return await _initRunner();
      } finally {
        // Important: do not cache resolved/stuck init forever.
        // Keep only in-flight deduplication.
        initPromise = null;
      }
    })();

    initPromise = dedupedInit;
    return initPromise;
  },

  reset: async () => {
    localStorage.removeItem(DB_KEY);
    window.location.reload();
  },

  selectiveReset: async (categories: any[], terminalId?: string, isSlave?: boolean) => {
    console.log('🗑️ Selective Reset:', categories.map(c => c.name), { terminalId, isSlave });

    // Map category IDs to DB collections/operations
    for (const category of categories) {
      // If it's a slave, we only delete data specific to this terminal.
      // Global data like products, tariffs, suppliers, customers should NOT be deleted on a slave reset
      if (isSlave && ['products', 'tariffs', 'suppliers', 'customers'].includes(category.id)) {
        console.log(`ℹ️ Skipping global category ${category.id} on slave reset`);
        continue;
      }

      switch (category.id) {
        case 'products':
          await dbAdapter.saveCollection('products', []);
          console.log('✅ Products cleared');
          break;

        case 'tariffs':
          const config = await dbAdapter.getCollection('config') as any as BusinessConfig;
          if (config) {
            config.tariffs = [];
            await dbAdapter.saveCollection('config', config as any);
          }
          console.log('✅ Tariffs cleared');
          break;

        case 'suppliers':
          await dbAdapter.saveCollection('suppliers', []);
          console.log('✅ Suppliers cleared');
          break;

        case 'customers':
          await dbAdapter.saveCollection('customers', []);
          console.log('✅ Customers cleared');
          break;

        case 'stock':
          // Clear stock balances from all products
          const products = await dbAdapter.getCollection('products') || [];
          const updatedProducts = products.map((p: any) => ({
            ...p,
            stock: 0,
            stockBalances: {},
            updatedAt: new Date().toISOString()
          }));
          await dbAdapter.saveCollection('products', updatedProducts);
          console.log('✅ Stock cleared');
          break;

        case 'transactions':
          if (isSlave && terminalId) {
            const allTx = await dbAdapter.getCollection('transactions') || [];
            const remainingTx = allTx.filter((t: any) => t.terminalId !== terminalId);
            await dbAdapter.saveCollection('transactions', remainingTx);
            console.log(`✅ Transactions for terminal ${terminalId} cleared`);
          } else {
            await dbAdapter.saveCollection('transactions', []);
            console.log('✅ Transactions cleared');
          }
          break;

        case 'credit_notes':
          // Filter out refunded transactions
          const txns = await dbAdapter.getCollection('transactions') || [];
          const filtered = txns.filter((t: any) => !t.refunded);
          await dbAdapter.saveCollection('transactions', filtered);
          console.log('✅ Credit notes cleared');
          break;

        case 'purchase_orders':
          await dbAdapter.saveCollection('purchaseOrders', []);
          console.log('✅ Purchase orders cleared');
          break;

        case 'purchase_reception':
          // 1. Mark all POs as pending
          const pos = await dbAdapter.getCollection('purchaseOrders') || [];
          const resetPos = pos.map((o: any) => ({
            ...o,
            status: 'PENDING',
            items: o.items.map((i: any) => ({ ...i, quantityReceived: 0 }))
          }));
          await dbAdapter.saveCollection('purchaseOrders', resetPos);

          // 2. Clear Receptions history
          if (isSlave && terminalId) {
            const allRec = await dbAdapter.getCollection('receptions') || [];
            const remainingRec = allRec.filter((r: any) => r.terminalId !== terminalId);
            await dbAdapter.saveCollection('receptions', remainingRec);
            console.log(`✅ Receptions for terminal ${terminalId} cleared`);
          } else {
            await dbAdapter.saveCollection('receptions', []);
            console.log('✅ Receptions cleared');
          }
          console.log('✅ Purchase receptions and history cleared');
          break;

        case 'inventory_ledger':
          if (isSlave && terminalId) {
            const allLedger = await dbAdapter.getCollection('inventoryLedger') || [];
            const remainingLedger = allLedger.filter((l: any) => l.terminalId !== terminalId);
            await dbAdapter.saveCollection('inventoryLedger', remainingLedger);
            console.log(`✅ Inventory ledger for terminal ${terminalId} cleared`);
          } else {
            await dbAdapter.saveCollection('inventoryLedger', []);
            console.log('✅ Inventory ledger cleared');
          }
          break;

        case 'inventory_tracking':
          await dbAdapter.saveCollection('inventoryTracking', []);
          console.log('✅ Inventory tracking cleared');
          break;

        case 'accounts_receivable':
          await dbAdapter.saveCollection('accountsReceivable', []);
          console.log('✅ Accounts receivable cleared');
          break;

        case 'z_reports':
          if (isSlave && terminalId) {
            const allZ = await dbAdapter.getCollection('zReports') || [];
            const remainingZ = allZ.filter((z: any) => z.terminalId !== terminalId);
            await dbAdapter.saveCollection('zReports', remainingZ);
            console.log(`✅ Z Reports for terminal ${terminalId} cleared`);
          } else {
            await dbAdapter.saveCollection('zReports', []);
            console.log('✅ Z Reports cleared');
          }
          break;

        case 'cash_movements':
          if (isSlave && terminalId) {
            const allCash = await dbAdapter.getCollection('cashMovements') || [];
            const remainingCash = allCash.filter((c: any) => c.terminalId !== terminalId);
            await dbAdapter.saveCollection('cashMovements', remainingCash);
            console.log(`✅ Cash movements for terminal ${terminalId} cleared`);
          } else {
            await dbAdapter.saveCollection('cashMovements', []);
            console.log('✅ Cash movements cleared');
          }
          break;


        case 'supplier_product_prices':
          await dbAdapter.saveCollection('supplierProductPrices', []);
          console.log('✅ Supplier product prices cleared');
          break;

        case 'product_prices':
          await dbAdapter.saveCollection('productPrices', []);
          console.log('✅ Product prices cleared');
          break;

        default:
          console.warn(`⚠️ Unknown category: ${category.id}`);
      }
    }

    // After selective reset, if it's a slave, we also reset document sequences to maintain integrity
    if (isSlave && terminalId) {
      console.log('🔄 Resetting sequences and fiscal buffers for slave terminal');

      // 1. Reset Internal Sequences (Tickets, Refunds, Transfers)
      await dbAdapter.saveCollection('internalSequences', DEFAULT_DOCUMENT_SERIES);

      // 2. Clear Local Fiscal Buffer (NCFs)
      await dbAdapter.saveCollection('localFiscalBuffer', []);

      // 3. Clear Fiscal Allocations for this terminal
      const allocations = await dbAdapter.getCollection<FiscalAllocation>('fiscalAllocations') || [];
      const remainingAllocations = allocations.filter(a => a.terminalId !== terminalId);
      await dbAdapter.saveCollection('fiscalAllocations', remainingAllocations);

      // 4. Reset Sync Center Counters on Master Server
      try {
        const { apiSyncAdapter } = await import('../services/sync/ApiSyncAdapter');
        await apiSyncAdapter.resetTerminalData(terminalId);
        console.log('✅ Sync center counters reset on Master');
      } catch (error) {
        console.warn('⚠️ Could not reset sync center counters on Master (offline or server unreachable)', error);
      }

      console.log('✅ Sequences and fiscal buffers reset');
    } else if (!isSlave) {
      // If it's Master, we also want to clear all operational data on the server
      try {
        const { apiSyncAdapter } = await import('../services/sync/ApiSyncAdapter');
        await apiSyncAdapter.resetTerminalData('ALL');
        console.log('✅ Global sync center counters reset on Master server');
      } catch (error) {
        console.warn('⚠️ Could not reset global sync center counters on Master server', error);
      }
    }

    console.log('✅ Selective reset complete');
  },

  get: async (collection: keyof typeof SEED_DATA, queryParams?: Record<string, string>) => {
    return await dbAdapter.getCollection(collection as string, queryParams);
  },

  save: async (collection: keyof typeof SEED_DATA, payload: any) => {
    // This is tricky because legacy 'save' replaced the whole collection or object
    await dbAdapter.saveCollection(collection as string, payload);
  },

  bulkUpdateProducts: async (productIds: string[], updates: any, userId?: string, userName?: string) => {
    await dbAdapter.bulkUpdateProducts(productIds, updates, userId, userName);
  },

  saveDocument: async (collection: keyof typeof SEED_DATA, doc: any) => {
    await dbAdapter.saveDocument(collection as string, doc);
  },

  saveDocuments: async (collection: keyof typeof SEED_DATA, docs: any[]) => {
    for (const doc of docs) {
      await dbAdapter.saveDocument(collection as string, doc);
    }
  },

  deleteDocument: async (collection: keyof typeof SEED_DATA, id: string) => {
    await dbAdapter.deleteDocument(collection as string, id);
  },

  getDocument: async (collection: keyof typeof SEED_DATA, id: string) => {
    return await dbAdapter.getDocument(collection as string, id);
  },

  processReceipt: async (payload: ProcessReceiptPayload): Promise<{
    reception: Reception;
    autoPrintItems: Array<{ productId: string; productName: string; sku?: string; price?: number; quantityReceived: number }>;
    missingItems: ProcessReceiptItem[];
    overageItems: ProcessReceiptItem[];
    receivedItemsCount: number;
  }> => {
    if (!payload.documentId?.trim()) {
      throw new Error('Documento inválido para recepción.');
    }

    const receivedItems = (payload.items || [])
      .map(item => ({
        ...item,
        expectedQty: Math.max(0, Number(item.expectedQty || 0)),
        receivedQty: Math.max(0, Number(item.receivedQty || 0))
      }))
      .filter(item => item.expectedQty > 0 || item.receivedQty > 0);

    if (receivedItems.length === 0) {
      throw new Error('No hay artículos para procesar.');
    }

    const linesWithReception = receivedItems.filter(item => item.receivedQty > 0);
    if (linesWithReception.length === 0) {
      throw new Error('No hay cantidades recibidas para registrar.');
    }

    const missingItems = receivedItems.filter(item => item.receivedQty < item.expectedQty);
    const overageItems = receivedItems.filter(item => item.receivedQty > item.expectedQty);

    if (missingItems.length > 0 && !payload.discrepancyReason?.trim()) {
      throw new Error('Se requiere motivo de ajuste para registrar faltantes.');
    }

    const idempotencyKey = payload.idempotencyKey?.trim() || buildReceptionIdempotencyKey({
      documentType: payload.documentType,
      documentId: payload.documentId,
      receivedBy: payload.receivedBy,
      items: receivedItems.map(item => ({
        productId: item.productId,
        variantSku: item.variantSku,
        expectedQty: item.expectedQty,
        receivedQty: item.receivedQty,
      })),
    });

    const previousAttempt = await dbAdapter
      .getDocument<ReceptionIdempotencyRecord>(RECEPTION_IDEMPOTENCY_COLLECTION, idempotencyKey)
      .catch(() => null);

    if (previousAttempt && isReceptionIdempotencyFresh(previousAttempt.createdAt)) {
      const previousReception = await dbAdapter
        .getDocument<Reception>('receptions', previousAttempt.receptionId)
        .catch(() => null);

      if (previousReception) {
        // Reenvío del mismo intento (replay de cola o doble finalización):
        // devolver lo ya aplicado sin sumar stock ni reimprimir etiquetas.
        return {
          reception: previousReception,
          autoPrintItems: [],
          missingItems,
          overageItems,
          receivedItemsCount: linesWithReception.length,
        };
      }
    }

    const now = toValidMovementIso(payload.effectiveDate);
    const terminalId = payload.terminalId || 'LOCAL';
    const products = await dbAdapter.getCollection<Product>('products') || [];
    const productMap = new Map(products.map(product => [product.id, product]));
    const itemMap = new Map(receivedItems.map(item => [buildInventoryLineKey(item.productId, item.variantSku), item]));

    // El candado de inventario se valida ANTES de cualquier escritura: si el
    // almacén está cerrado, la recepción no puede consumir el documento.
    await assertInventoryMovementUnlocked(payload.warehouseId, now);

    if (overageItems.length > 0 && !payload.discrepancyReason?.trim()) {
      throw new Error('Se requiere motivo de ajuste para registrar exceso de mercancía.');
    }

    const mutations: DurableDocumentMutation[] = [];
    const orderedQtyByLine = new Map<string, number>();

    if (payload.documentType === 'PURCHASE_ORDER') {
      const orders = await dbAdapter.getCollection<PurchaseOrder>('purchaseOrders') || [];
      const order = (orders || []).find(o => o.id === payload.documentId);
      if (!order) throw new Error('Orden de compra no encontrada.');

      const updatedItems = (order.items || []).map(item => {
        const lineKey = buildInventoryLineKey(item.productId, item.variantSku);
        const ordered = Math.max(0, Number(item.quantityOrdered || 0));
        orderedQtyByLine.set(lineKey, ordered);

        const received = itemMap.get(lineKey)?.receivedQty || 0;
        if (received <= 0) return item;

        const currentReceived = Math.max(0, Number(item.quantityReceived || 0));
        // Se registra lo recibido real: el exceso ya exigió motivo arriba, así
        // que no se recorta en silencio contra lo ordenado.
        return {
          ...item,
          quantityReceived: currentReceived + received
        };
      });

      const totalOrdered = updatedItems.reduce((sum, item) => sum + Math.max(0, Number(item.quantityOrdered || 0)), 0);
      const totalReceived = updatedItems.reduce((sum, item) => sum + Math.max(0, Number(item.quantityReceived || 0)), 0);
      const status: PurchaseOrder['status'] =
        totalReceived <= 0 ? 'ORDERED' : totalReceived >= totalOrdered ? 'COMPLETED' : 'PARTIAL';

      mutations.push({
        collectionName: 'purchaseOrders',
        document: { ...order, items: updatedItems, status } as PurchaseOrder,
      });
    } else {
      const allTransfers = await dbAdapter.getCollection<StockTransfer>('transfers') || [];
      const transfer = (allTransfers || []).find(t => t.id === payload.documentId);
      if (!transfer) throw new Error('Traspaso de origen no encontrado.');

      const updatedTransferItems = (transfer.items || []).map(item => {
        const lineKey = buildInventoryLineKey(item.productId, (item as any).variantSku);
        orderedQtyByLine.set(lineKey, Math.max(0, Number(item.quantity || 0)));

        const line = itemMap.get(lineKey);
        if (!line || line.receivedQty <= 0) return item;

        const alreadyReceived = Math.max(0, Number(item.receivedQuantity || 0));
        return {
          ...item,
          receivedQuantity: alreadyReceived + line.receivedQty
        };
      });

      const fullyReceived = updatedTransferItems.every(item => (
        Number(item.receivedQuantity || 0) >= Math.max(0, Number(item.quantity || 0))
      ));
      const hasDiscrepancy = updatedTransferItems.some(item => (
        Number(item.receivedQuantity || 0) !== Number(item.quantity || 0)
      ));

      mutations.push({
        collectionName: 'transfers',
        document: {
          ...transfer,
          // Un traspaso parcial sigue abierto para la siguiente entrega.
          status: fullyReceived ? 'COMPLETED' : 'PARTIALLY_RECEIVED',
          items: updatedTransferItems,
          receivedAt: fullyReceived ? now : transfer.receivedAt,
          updatedAt: now,
          syncStatus: 'PENDING',
          discrepancyReason: hasDiscrepancy ? payload.discrepancyReason : undefined,
        } as StockTransfer,
      });
    }

    const movementConcept: LedgerConcept = payload.documentType === 'PURCHASE_ORDER' ? 'COMPRA' : 'TRASPASO_ENTRADA';

    const newEntries: InventoryLedgerEntry[] = linesWithReception.map(item => ({
      id: `LEG-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      productId: item.productId,
      warehouseId: payload.warehouseId,
      concept: movementConcept,
      documentRef: payload.documentId,
      createdAt: now,
      qtyIn: item.receivedQty,
      qtyOut: 0,
      unitCost: Number(item.cost || productMap.get(item.productId)?.cost || 0),
      balanceQty: 0,
      balanceAvgCost: 0,
      terminalId,
      variantId: item.variantSku,
      variantName: item.variantInfo,
      syncStatus: 'PENDING'
    }));

    if (permissionService.isSlaveTerminal()) {
      // En terminal esclava el saldo lo calcula el master: se conservan los
      // movimientos tal cual, igual que hace recordInventoryMovements.
      mutations.push(...newEntries.map(entry => ({ collectionName: 'inventoryLedger', document: entry })));
    } else {
      const ledger = await dbAdapter.getCollection<InventoryLedgerEntry>('inventoryLedger') || [];
      const commitments = await dbAdapter.getCollection<InventoryCommitment>('inventoryCommitments') || [];
      const storedById = new Map(ledger.map(entry => [entry.id, entry]));
      const pairs = new Map<string, { productId: string; warehouseId: string; entries: InventoryLedgerEntry[] }>();

      for (const entry of [...ledger, ...newEntries]) {
        const pairKey = `${entry.productId}|${entry.warehouseId}`;
        const pair = pairs.get(pairKey) || { productId: entry.productId, warehouseId: entry.warehouseId, entries: [] };
        pair.entries.push(entry);
        pairs.set(pairKey, pair);
      }

      const updatedProducts = new Map<string, Product>();

      for (const pair of pairs.values()) {
        const {
          entries: balancedEntries,
          balanceQty,
          balanceAvgCost,
        } = computeInventoryBalances(pair.entries);

        for (const entry of balancedEntries) {
          const stored = storedById.get(entry.id);
          if (stored && stored.balanceQty === entry.balanceQty && stored.balanceAvgCost === entry.balanceAvgCost) {
            continue;
          }
          mutations.push({ collectionName: 'inventoryLedger', document: entry });
        }

        const product = products.find(candidate => candidate.id === pair.productId);
        if (!product) {
          console.error(`❌ Product ${pair.productId} NOT FOUND!`);
          continue;
        }

        const updatedProduct = updatedProducts.get(product.id) || {
          ...product,
          stockBalances: { ...(product.stockBalances || {}) },
        } as Product;

        updatedProduct.stockBalances![pair.warehouseId] = balanceQty;
        updatedProduct.stock = Object.values(updatedProduct.stockBalances || {})
          .reduce((sum, value) => sum + Number(value || 0), 0);
        updatedProduct.cost = balanceAvgCost;
        updatedProduct.updatedAt = now;
        updatedProducts.set(product.id, updatedProduct);

        const commitment = commitments.find(candidate => (
          candidate.productId === pair.productId && candidate.warehouseId === pair.warehouseId
        ));
        const qtyCommitted = Math.max(0, Number(commitment?.qtyCommitted || 0));

        mutations.push({
          collectionName: 'productStocks',
          document: {
            id: `${pair.productId}_${pair.warehouseId}`,
            productId: pair.productId,
            warehouseId: pair.warehouseId,
            quantity: balanceQty,
            qtyPhysical: balanceQty,
            qtyCommitted,
            qtyAvailable: balanceQty - qtyCommitted,
            updatedAt: now
          } as ProductStock,
        });
      }

      for (const product of updatedProducts.values()) {
        mutations.push({ collectionName: 'products', document: product });
      }
    }

    const receptionItems: PurchaseOrderItem[] = linesWithReception.map(item => ({
      productId: item.productId,
      productName: item.productName || productMap.get(item.productId)?.name || item.productId,
      // Cantidad realmente pedida/enviada, no el remanente del momento.
      quantityOrdered: orderedQtyByLine.get(buildInventoryLineKey(item.productId, item.variantSku)) ?? item.expectedQty,
      quantityReceived: item.receivedQty,
      cost: Number(item.cost || productMap.get(item.productId)?.cost || 0),
      variantSku: item.variantSku,
      variantInfo: item.variantInfo
    }));

    const reception: Reception = {
      // Sufijo aleatorio: dos recepciones pueden caer en el mismo milisegundo
      // y, sin él, la segunda sobrescribía a la primera.
      id: `REC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      purchaseOrderId: payload.documentType === 'PURCHASE_ORDER'
        ? payload.documentId
        : `TRANSFER:${payload.documentId}`,
      date: now,
      receivedBy: payload.receivedBy,
      receivedByUserName: payload.receivedByUserName,
      items: receptionItems,
      terminalId,
      idempotencyKey,
      syncStatus: 'PENDING',
      updatedAt: now
    };

    const idempotencyRecord: ReceptionIdempotencyRecord = {
      id: idempotencyKey,
      receptionId: reception.id,
      documentType: payload.documentType,
      documentId: payload.documentId,
      receivedBy: payload.receivedBy,
      terminalId,
      createdAt: now,
    };

    mutations.push({ collectionName: 'receptions', document: reception });
    mutations.push({ collectionName: RECEPTION_IDEMPOTENCY_COLLECTION, document: idempotencyRecord });

    // Documento + movimientos + saldos + recepción + índice se publican en una
    // sola transacción cuando el adaptador la soporta; si no, en el mismo orden.
    await commitDocumentMutations(mutations);

    import('../services/sync/BackgroundSyncManager').then(m => {
      m.backgroundSyncManager.triggerSync().catch(console.error);
    }).catch(console.error);

    const autoPrintItems = linesWithReception
      .filter(item => productMap.get(item.productId)?.operationalFlags?.autoPrintLabel)
      .map(item => {
        const product = productMap.get(item.productId);
        return {
          productId: item.productId,
          productName: item.productName || product?.name || item.productId,
          sku: item.variantSku || product?.barcode || item.productId,
          price: product?.price,
          quantityReceived: item.receivedQty
        };
      });

    return {
      reception,
      autoPrintItems,
      missingItems,
      overageItems,
      receivedItemsCount: linesWithReception.length
    };
  },

  canRequestMoreNCF: async (type: FiscalDocumentCode, terminalId?: string): Promise<boolean> => {
    const [ranges, allocations] = await Promise.all([
      dbAdapter.getCollection<FiscalRangeDGII>('fiscalRanges'),
      dbAdapter.getCollection<FiscalAllocation>('fiscalAllocations'),
    ]);

    const allocation = getTerminalFiscalAllocation(allocations || [], terminalId, type as any);
    if (allocation) {
      return allocation.status === 'ACTIVE' && allocation.nextNumber <= allocation.reservedEnd;
    }

    const range = ranges?.find((r: FiscalRangeDGII) => r.type === type && r.isActive);
    if (!range) return false;
    return range.currentGlobal < range.endNumber;
  },

  requestFiscalBatch: async (terminalId: string, type: FiscalDocumentCode, _batchSize: number): Promise<LocalFiscalBuffer | null> => {
    const [ranges, rawAllocations] = await Promise.all([
      dbAdapter.getCollection<FiscalRangeDGII>('fiscalRanges'),
      dbAdapter.getCollection<FiscalAllocation>('fiscalAllocations'),
    ]);
    const allocations = rawAllocations || [];
    const allocation = getTerminalFiscalAllocation(allocations, terminalId, type as any);
    const range = getFiscalRangeForEmission(ranges || [], type as any, allocation);
    const effectiveBatchSize = FISCAL_ISSUE_BATCH_SIZE;

    if (allocation) {
      const allocationIndex = allocations.findIndex((candidate) => candidate.id === allocation.id);
      if (allocationIndex === -1) return null;
      if (allocation.status !== 'ACTIVE') return null;
      const prefix = range?.prefix || allocation.prefix || type;
      const historyNextNumber = await getNextFiscalNumberFromHistory(
        type,
        prefix,
        allocation.reservedStart,
        allocation.reservedEnd,
      );

      if (allocation.nextNumber > allocation.reservedEnd && historyNextNumber === null) {
        allocations[allocationIndex] = {
          ...normalizeFiscalAllocationRecord(allocation, terminalId),
          status: 'EXHAUSTED',
        };
        await dbAdapter.saveCollection('fiscalAllocations', allocations);
        return null;
      }

      const start = Math.max(
        allocation.reservedStart,
        allocation.nextNumber,
        historyNextNumber ?? 0,
      );
      const end = Math.min(allocation.reservedEnd, start + effectiveBatchSize - 1);
      const nextNumber = end + 1;

      allocations[allocationIndex] = {
        ...normalizeFiscalAllocationRecord(allocation, terminalId),
        prefix,
        nextNumber,
        status: nextNumber > allocation.reservedEnd ? 'EXHAUSTED' : allocation.status,
      };

      const localBuffer: LocalFiscalBuffer = {
        id: type,
        type,
        prefix,
        currentNumber: start,
        endNumber: end,
        expiryDate: range?.expiryDate || '',
        startNumber: start,
        terminalId,
        fiscalRangeId: allocation.fiscalRangeId,
        allocationId: allocation.id,
      };

      await dbAdapter.saveCollection('fiscalAllocations', allocations);
      const buffers = await dbAdapter.getCollection<LocalFiscalBuffer>('localFiscalBuffer') || [];
      const newBuffers = buffers
        .filter((buffer: LocalFiscalBuffer) =>
          !(buffer.type === type && (!buffer.terminalId || normalizeSequenceKey(buffer.terminalId) === normalizeSequenceKey(terminalId)))
        )
        .concat(localBuffer);
      await dbAdapter.saveCollection('localFiscalBuffer', newBuffers);
      return localBuffer;
    }

    const legacyRange = ranges?.find((r: FiscalRangeDGII) => r.type === type && r.isActive);
    if (!legacyRange) return null;

    const legacyHistoryNextNumber = await getNextFiscalNumberFromHistory(
      type,
      legacyRange.prefix,
      Math.max(1, legacyRange.startNumber || 1),
      legacyRange.endNumber,
    );
    if (legacyRange.currentGlobal >= legacyRange.endNumber && legacyHistoryNextNumber === null) return null;

    if (legacyHistoryNextNumber !== null) {
      legacyRange.currentGlobal = legacyHistoryNextNumber - 1;
    }

    const start = legacyRange.currentGlobal + 1;
    const end = Math.min(legacyRange.endNumber, start + effectiveBatchSize - 1);
    legacyRange.currentGlobal = end;

    const localBuffer: LocalFiscalBuffer = {
      id: type,
      type,
      prefix: legacyRange.prefix,
      currentNumber: start,
      endNumber: end,
      expiryDate: legacyRange.expiryDate,
      startNumber: start,
      terminalId,
      fiscalRangeId: legacyRange.id,
    };

    await dbAdapter.saveCollection('fiscalRanges', ranges);
    const buffers = await dbAdapter.getCollection<LocalFiscalBuffer>('localFiscalBuffer') || [];
    const newBuffers = buffers
      .filter((buffer: LocalFiscalBuffer) =>
        !(buffer.type === type && (!buffer.terminalId || normalizeSequenceKey(buffer.terminalId) === normalizeSequenceKey(terminalId)))
      )
      .concat(localBuffer);
    await dbAdapter.saveCollection('localFiscalBuffer', newBuffers);

    return localBuffer;
  },

  getNextNCF: async (type: FiscalDocumentCode, terminalId: string, _customBatchSize?: number): Promise<string | null> => {
    let buffers = await dbAdapter.getCollection<LocalFiscalBuffer>('localFiscalBuffer') || [];
    let buffer = (buffers || []).find((b: LocalFiscalBuffer) =>
      b.type === type && (!terminalId || !b.terminalId || normalizeSequenceKey(b.terminalId) === normalizeSequenceKey(terminalId))
    );

    const allocations = await dbAdapter.getCollection<FiscalAllocation>('fiscalAllocations') || [];
    const activeAllocation = getTerminalFiscalAllocation(allocations, terminalId, type as any);
    if (buffer && activeAllocation) {
      const allocationNextNumber = Math.max(
        activeAllocation.reservedStart,
        Number(activeAllocation.nextNumber || activeAllocation.reservedStart) || activeAllocation.reservedStart,
      );
      const bufferCurrentNumber = Number(buffer.currentNumber || 0);
      const bufferStartNumber = Number(buffer.startNumber || buffer.currentNumber || 0);
      const hasDifferentAllocation =
        Boolean(buffer.allocationId && buffer.allocationId !== activeAllocation.id) ||
        Boolean(buffer.fiscalRangeId && activeAllocation.fiscalRangeId && buffer.fiscalRangeId !== activeAllocation.fiscalRangeId);
      const isOutsideAllocation =
        bufferStartNumber < activeAllocation.reservedStart ||
        Number(buffer.endNumber || 0) > activeAllocation.reservedEnd;
      const isBehindErpPointer = bufferCurrentNumber < allocationNextNumber;

      if (hasDifferentAllocation || isOutsideAllocation || isBehindErpPointer) {
        buffers = buffers.filter((candidate) => candidate !== buffer);
        await dbAdapter.saveCollection('localFiscalBuffer', buffers);
        buffer = undefined;
      }
    }

    if (buffer) {
      const maxIssuedNumber = await getMaxIssuedFiscalNumber(type, buffer.prefix || type);
      const historyNextNumber = maxIssuedNumber > 0 ? maxIssuedNumber + 1 : null;

      if (historyNextNumber !== null) {
        const bufferStart = Math.max(1, Number(buffer.startNumber || buffer.currentNumber) || 1);
        if (historyNextNumber < buffer.currentNumber) {
          buffer.currentNumber = historyNextNumber >= bufferStart && historyNextNumber <= buffer.endNumber
            ? historyNextNumber
            : buffer.endNumber + 1;
          await dbAdapter.saveCollection('localFiscalBuffer', buffers);
        } else if (historyNextNumber > buffer.currentNumber && historyNextNumber <= buffer.endNumber) {
          buffer.currentNumber = historyNextNumber;
          await dbAdapter.saveCollection('localFiscalBuffer', buffers);
        } else if (historyNextNumber > buffer.endNumber && buffer.currentNumber <= maxIssuedNumber) {
          buffer.currentNumber = buffer.endNumber + 1;
          await dbAdapter.saveCollection('localFiscalBuffer', buffers);
        }
      }
    }

    if (!buffer || buffer.currentNumber > buffer.endNumber) {
      buffer = await db.requestFiscalBatch(terminalId, type, FISCAL_ISSUE_BATCH_SIZE) as LocalFiscalBuffer;
      if (!buffer) return null;
      // Refresh buffers after request
      buffers = await dbAdapter.getCollection<LocalFiscalBuffer>('localFiscalBuffer') || [];
      buffer = (buffers || []).find((b: LocalFiscalBuffer) =>
        b.type === type && (!terminalId || !b.terminalId || normalizeSequenceKey(b.terminalId) === normalizeSequenceKey(terminalId))
      ) as LocalFiscalBuffer;
    }

    if (!buffer) {
      console.error(`❌ getNextNCF: Buffer for type ${type} is still undefined after request!`);
      return null;
    }

    const ncf = `${buffer.prefix}${buffer.currentNumber.toString().padStart(getFiscalSequencePadding(type), '0')}`;

    if (buffer.currentNumber > buffer.endNumber) return null;

    buffer.currentNumber += 1;
    await dbAdapter.saveCollection('localFiscalBuffer', buffers);
    return ncf;
  },

  reconcilePreparedNCF: async (type: FiscalDocumentCode, terminalId: string, ncf: string): Promise<void> => {
    const allocations = await dbAdapter.getCollection<FiscalAllocation>('fiscalAllocations') || [];
    const buffers = await dbAdapter.getCollection<LocalFiscalBuffer>('localFiscalBuffer') || [];
    const reconciled = reconcilePreparedFiscalCollections(allocations, buffers, type, terminalId, ncf);
    if (reconciled.allocations !== allocations) await dbAdapter.saveCollection('fiscalAllocations', reconciled.allocations);
    await dbAdapter.saveCollection('localFiscalBuffer', reconciled.buffers);
  },

  rehydrateOperationalDocumentState: async (
    documentSeries: DocumentSeries[] = [],
    fiscalRanges: FiscalRangeDGII[] = [],
    fiscalAllocations: FiscalAllocation[] = [],
    terminalId?: string
  ): Promise<void> => {
    if (
      (!documentSeries || documentSeries.length === 0) &&
      (!fiscalRanges || fiscalRanges.length === 0) &&
      !terminalId
    ) {
      return;
    }

    const bufferTypesToReset = new Set<FiscalDocumentCode>();

    if (documentSeries && documentSeries.length > 0) {
      const existingSeries = await dbAdapter.getCollection<DocumentSeries>('internalSequences') || [];
      const mergedSeries = mergeDocumentSeriesState(existingSeries, documentSeries);
      await dbAdapter.saveCollection('internalSequences', mergedSeries);
      if (documentSeries.some((series: any) => String(series?.source || '').toUpperCase() === 'ERP_TERMINAL_CONFIG')) {
        await dbAdapter.saveCollection('documentSeries', mergedSeries);
      }
    }

    if (fiscalRanges && fiscalRanges.length > 0) {
      const existingRanges = await dbAdapter.getCollection<FiscalRangeDGII>('fiscalRanges') || [];
      const rangeMerge = mergeFiscalRangesState(existingRanges, fiscalRanges);
      const { mergedRanges } = rangeMerge;
      await dbAdapter.saveCollection('fiscalRanges', mergedRanges);
      rangeMerge.bufferTypesToReset.forEach((type) => bufferTypesToReset.add(type));
    }

    if (terminalId) {
      const existingAllocations = await dbAdapter.getCollection<FiscalAllocation>('fiscalAllocations') || [];
      const allocationMerge = mergeFiscalAllocationsState(existingAllocations, fiscalAllocations, terminalId);
      await dbAdapter.saveCollection('fiscalAllocations', allocationMerge.mergedAllocations);
      allocationMerge.bufferTypesToReset.forEach((type) => bufferTypesToReset.add(type));
    }

    if (bufferTypesToReset.size > 0) {
      const existingBuffers = await dbAdapter.getCollection<LocalFiscalBuffer>('localFiscalBuffer') || [];
      const filteredBuffers = existingBuffers.filter((buffer) => {
        if (!bufferTypesToReset.has(buffer.type)) return true;
        if (!terminalId) return false;
        return Boolean(buffer.terminalId && normalizeSequenceKey(buffer.terminalId) !== normalizeSequenceKey(terminalId));
      });
      if (filteredBuffers.length !== existingBuffers.length) {
        await dbAdapter.saveCollection('localFiscalBuffer', filteredBuffers);
      }
    }
  },

  getNextSequenceNumber: async (sequenceId: string): Promise<string | null> => {
    const sequences = await dbAdapter.getCollection<DocumentSeries>('internalSequences') || [];
    const seq = (sequences || []).find((s: DocumentSeries) => s.id === sequenceId);

    if (!seq) return null;

    const nextId = `${seq.prefix}${seq.nextNumber.toString().padStart(seq.padding, '0')}`;
    seq.nextNumber += 1;

    await dbAdapter.saveCollection('internalSequences', sequences);
    return nextId;
  },

  recordInventoryMovement: async (
    warehouseId: string,
    productId: string,
    concept: LedgerConcept,
    documentRef: string,
    qty: number,
    movementCost?: number,
    terminalId?: string,
    variantId?: string,
    variantName?: string,
    trackingId?: string,
    trackingCode?: string,
    effectiveDate?: string
  ): Promise<InventoryLedgerEntry | undefined> => {
    await assertInventoryMovementUnlocked(warehouseId, effectiveDate);

    const movementTimestamp = toValidMovementIso(effectiveDate);

    // 1. Create Ledger Entry (Temporary balance, will be recalculated)
    const qtyIn = qty > 0 ? qty : 0;
    const qtyOut = qty < 0 ? Math.abs(qty) : 0;

    // 0. Fallback cost for audit adjustments/discrepancies if none provided
    // This prevents audit adjustments from diluting inventory value with $0 cost.
    let finalMovementCost = movementCost;
    if ((concept === 'AJUSTE_ENTRADA' || concept === 'AJUSTE_SALIDA' || concept === 'TRASPASO_AJUSTE_DIFERENCIA') && !finalMovementCost) {
      const products = await dbAdapter.getCollection<Product>('products') || [];
      const product = products.find(p => p.id === productId);
      finalMovementCost = product?.cost || 0;
    }

    const newEntry: InventoryLedgerEntry = {
      id: `LEG-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      productId: productId,
      warehouseId: warehouseId,
      concept: concept,
      documentRef: documentRef,
      createdAt: movementTimestamp,
      qtyIn: qtyIn,
      qtyOut: qtyOut,
      unitCost: finalMovementCost || 0,
      balanceQty: 0, // Will be recalculated
      balanceAvgCost: 0, // Will be recalculated
      terminalId: terminalId || 'LOCAL',
      variantId,
      variantName,
      trackingId,
      trackingCode,
      syncStatus: 'PENDING'
    };

    await dbAdapter.saveDocument('inventoryLedger', newEntry);

    // 2. Recalculate everything for this product/warehouse
    await db.recalculateProductStock(productId, warehouseId);

    // 3. Trigger background sync (using dynamic import to avoid circular dependency)
    import('../services/sync/BackgroundSyncManager').then(m => {
      m.backgroundSyncManager.triggerSync().catch(console.error);
    });

    return newEntry;
  },

  recordInventoryMovements: async (movements: {
    warehouseId: string,
    productId: string,
    concept: LedgerConcept,
    documentRef: string,
    qty: number,
    movementCost?: number,
    terminalId?: string,
    variantId?: string,
    variantName?: string,
    trackingId?: string,
    trackingCode?: string,
    effectiveDate?: string
  }[]): Promise<InventoryLedgerEntry[]> => {
    const newEntries: InventoryLedgerEntry[] = [];
    const products = await dbAdapter.getCollection<Product>('products') || [];

    for (const move of movements) {
      await assertInventoryMovementUnlocked(move.warehouseId, move.effectiveDate);

      const movementTimestamp = toValidMovementIso(move.effectiveDate);
      const qtyIn = move.qty > 0 ? move.qty : 0;
      const qtyOut = move.qty < 0 ? Math.abs(move.qty) : 0;

      // Fallback for bulk audit movements
      let finalMovementCost = move.movementCost;
      if ((move.concept === 'AJUSTE_ENTRADA' || move.concept === 'AJUSTE_SALIDA' || move.concept === 'TRASPASO_AJUSTE_DIFERENCIA') && !finalMovementCost) {
        const prod = products.find(p => p.id === move.productId);
        finalMovementCost = prod?.cost || 0;
      }

      const newEntry: InventoryLedgerEntry = {
        id: `LEG-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        productId: move.productId,
        warehouseId: move.warehouseId,
        concept: move.concept,
        documentRef: move.documentRef,
        createdAt: movementTimestamp,
        qtyIn: qtyIn,
        qtyOut: qtyOut,
        unitCost: finalMovementCost || 0,
        balanceQty: 0,
        balanceAvgCost: 0,
        terminalId: move.terminalId || 'LOCAL',
        variantId: move.variantId,
        variantName: move.variantName,
        trackingId: move.trackingId,
        trackingCode: move.trackingCode,
        syncStatus: 'PENDING'
      };

      // OPTIMIZATION: Save each entry individually to avoid rewriting the whole ledger
      await dbAdapter.saveDocument('inventoryLedger', newEntry);
      newEntries.push(newEntry);
    }

    // Recalculate all affected products
    const uniqueProductWarehousePairs = Array.from(new Set(movements.map(m => `${m.productId}|${m.warehouseId}`)));
    for (const pair of uniqueProductWarehousePairs) {
      const [productId, warehouseId] = pair.split('|');
      await db.recalculateProductStock(productId, warehouseId);
    }

    // Trigger background sync
    import('../services/sync/BackgroundSyncManager').then(m => {
      m.backgroundSyncManager.triggerSync().catch(console.error);
    });

    return newEntries;
  },

  recalculateProductStock: async (productId: string, warehouseId: string) => {
    if (permissionService.isSlaveTerminal()) {
      console.log(`ℹ️ Skipping stock recalculation for Product: ${productId} on Slave terminal. Preserving synced value.`);
      return;
    }
    console.log(`🔄 Recalculating stock for Product: ${productId}, Warehouse: ${warehouseId}`);

    // 1. Get all ledger entries
    const ledger = await dbAdapter.getCollection<InventoryLedgerEntry>('inventoryLedger');

    if (!ledger || !Array.isArray(ledger)) {
      console.error(`❌ Recalculate Error: Could not fetch 'inventoryLedger' collection for product ${productId}. Aborting to prevent data wipe!`);
      return;
    }

    console.log(`📊 Recalculate: ${ledger.length} total entries loaded from DB`);

    // 2. Filter entries for this product/warehouse
    const productEntries = ledger.filter(e => e.productId === productId && e.warehouseId === warehouseId);
    console.log(`🔍 Recalculate: ${productEntries.length} entries match Product: ${productId}, Warehouse: ${warehouseId}`);

    // If no entries found AND the product currently has stock, this is highly suspicious
    if (productEntries.length === 0) {
      console.warn(`⚠️ Recalculate: No ledger entries found for ${productId} @ ${warehouseId}. Resulting stock will be 0.`);
    }

    // 3. Orden estable + saldos (cantidad y costo promedio ponderado)
    const {
      entries: balancedEntries,
      balanceQty: currentBalance,
      balanceAvgCost: currentAvgCost,
    } = computeInventoryBalances(productEntries);

    // PERSIST: cada entrada del par producto/almacén, con su saldo calculado.
    for (const entry of balancedEntries) {
      await dbAdapter.saveDocument('inventoryLedger', entry);
    }

    // 7. Update Product Master
    const products = await dbAdapter.getCollection<Product>('products') || [];
    const product = (products || []).find(p => p.id === productId);
    if (product) {
      if (!product.stockBalances) product.stockBalances = {};
      product.stockBalances[warehouseId] = currentBalance;
      product.stock = Object.values(product.stockBalances).reduce((a, b) => a + (b as number), 0);
      product.cost = currentAvgCost;
      product.updatedAt = new Date().toISOString();

      console.log(`📝 Updating product ${product.id} (${product.name}): Stock=${product.stock}, Cost=${product.cost}, updatedAt=${product.updatedAt}`);

      // SUCCESS: Update only the product document
      await dbAdapter.saveDocument('products', product);
      console.log(`✅ Product ${productId} updated in database.`);

      // 8. Update Detailed Stocks Collection (productStocks)
      const stockId = `${productId}_${warehouseId}`;
      const commitments = await dbAdapter.getCollection<InventoryCommitment>('inventoryCommitments') || [];
      const commitment = (commitments || []).find(c => c.productId === productId && c.warehouseId === warehouseId);
      const qtyCommitted = Math.max(0, Number(commitment?.qtyCommitted || 0));
      const productStock: ProductStock = {
        id: stockId,
        productId,
        warehouseId,
        quantity: currentBalance,
        qtyPhysical: currentBalance,
        qtyCommitted,
        qtyAvailable: currentBalance - qtyCommitted,
        updatedAt: new Date().toISOString()
      };
      await dbAdapter.saveDocument('productStocks', productStock);
      console.log(`✅ Detailed stock for ${productId} in ${warehouseId} updated: physical=${currentBalance}, committed=${qtyCommitted}`);
    } else {
      console.error(`❌ Product ${productId} NOT FOUND!`);
    }

    console.log(`✅ Recalculation complete. Final balance: ${currentBalance}`);
  },

  getCommittedStock: async (productId: string, warehouseId: string): Promise<number> => {
    const commitments = await dbAdapter.getCollection<InventoryCommitment>('inventoryCommitments') || [];
    const row = (commitments || []).find(c => c.productId === productId && c.warehouseId === warehouseId);
    return Math.max(0, Number(row?.qtyCommitted || 0));
  },

  adjustCommittedStock: async (productId: string, warehouseId: string, deltaQty: number): Promise<number> => {
    const commitments = await dbAdapter.getCollection<InventoryCommitment>('inventoryCommitments') || [];
    const idx = commitments.findIndex(c => c.productId === productId && c.warehouseId === warehouseId);
    const now = new Date().toISOString();

    let nextCommitted = 0;
    if (idx >= 0) {
      const current = Math.max(0, Number(commitments[idx].qtyCommitted || 0));
      nextCommitted = Math.max(0, current + deltaQty);
      commitments[idx] = {
        ...commitments[idx],
        qtyCommitted: nextCommitted,
        updatedAt: now
      };
    } else {
      nextCommitted = Math.max(0, deltaQty);
      commitments.push({
        id: `${productId}_${warehouseId}`,
        productId,
        warehouseId,
        qtyCommitted: nextCommitted,
        updatedAt: now
      });
    }

    await dbAdapter.saveCollection('inventoryCommitments', commitments);

    const stockId = `${productId}_${warehouseId}`;
    const productStock = await dbAdapter.getDocument<ProductStock>('productStocks', stockId);
    if (productStock) {
      const qtyPhysical = Number(productStock.qtyPhysical ?? productStock.quantity ?? 0);
      await dbAdapter.saveDocument('productStocks', {
        ...productStock,
        qtyPhysical,
        qtyCommitted: nextCommitted,
        qtyAvailable: qtyPhysical - nextCommitted,
        updatedAt: now
      });
    } else {
      const products = await dbAdapter.getCollection<Product>('products') || [];
      const product = (products || []).find(p => p.id === productId);
      const qtyPhysical = Number(product?.stockBalances?.[warehouseId] ?? product?.stock ?? 0);
      await dbAdapter.saveDocument('productStocks', {
        id: stockId,
        productId,
        warehouseId,
        quantity: qtyPhysical,
        qtyPhysical,
        qtyCommitted: nextCommitted,
        qtyAvailable: qtyPhysical - nextCommitted,
        updatedAt: now
      } as ProductStock);
    }

    return nextCommitted;
  },

  commitInventory: async (items: CartItem[], effectiveDate: string, warehouseId: string = 'wh_central'): Promise<void> => {
    console.log(`📦 Committing inventory for ${items.length} items on ${effectiveDate}`);
    for (const item of items) {
      await db.adjustCommittedStock(item.id, warehouseId, item.quantity);
    }
  },

  getNextGlobalSequence: async (): Promise<number> => {
    const counter = await dbAdapter.getCollection('globalSequenceCounter') || 0;
    const next = (typeof counter === 'number' ? counter : 0) + 1;
    await dbAdapter.saveCollection('globalSequenceCounter', next as any);
    return next;
  },

  getNextSeriesNumber: async (seriesId: string): Promise<number> => {
    const sequences = await dbAdapter.getCollection<DocumentSeries>('internalSequences') || [];
    const series = (sequences || []).find((s: DocumentSeries) => s.id === seriesId);
    if (!series) throw new Error(`Series ${seriesId} not found`);

    const nextNumber = series.nextNumber;
    series.nextNumber += 1;
    await dbAdapter.saveCollection('internalSequences', sequences);
    return nextNumber;
  }
};
