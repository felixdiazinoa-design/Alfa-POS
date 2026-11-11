import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '../utils/db';
import { apiSyncAdapter } from '../services/sync/ApiSyncAdapter';
import { PurchaseOrder, StockTransfer } from '../types';
import {
  DuplicateReceptionError,
  RECEPTION_IDEMPOTENCY_COLLECTION,
  buildBlockedReceptionDocumentKeys,
  buildReceptionIdempotencyKey,
  findQueuedReceptionForDocument,
  isReceptionIdempotencyFresh,
  type ReceptionDocumentType,
  type ReceptionIdempotencyRecord,
} from '../utils/receptionIdempotency';

export type OfflineReceiptDocumentType = 'PURCHASE_ORDER' | 'TRANSFER_IN' | 'INVENTORY_COUNT';

type OfflineReceiptItem = {
  productId: string;
  productName: string;
  expectedQty: number;
  receivedQty: number;
  cost?: number;
  variantSku?: string;
  variantInfo?: string;
};

export interface OfflineReceiptPayload {
  documentType: OfflineReceiptDocumentType;
  documentId: string;
  warehouseId: string;
  receivedBy: string;
  receivedByUserName: string;
  terminalId?: string;
  discrepancyReason?: string;
  items: OfflineReceiptItem[];
  // For INVENTORY_COUNT
  sessionId?: string;
  status?: string;
  /** Clave de idempotencia del intento; se calcula una vez al finalizar. */
  idempotencyKey?: string;
}

export type OfflineCountItem = {
  productId: string;
  productName: string;
  expectedQty: number;
  countedQty: number;
  difference: number;
  warehouseId?: string;
};

export interface OfflineCountPayload {
  id: string; // Session ID
  warehouseId: string;
  warehouseName?: string;
  /** Zona/ubicación contada. Vacío = almacén completo. */
  locationLabel?: string | null;
  locationId?: string | null;
  items: OfflineCountItem[];
  startedAt: string;
  finishedAt: string;
  terminalId: string;
  userId: string;
  userName: string;
  /** Sesión de bloqueo del Master que respaldó este conteo (si existió). */
  claimSessionId?: string | null;
}

interface QueueMetadata {
  documentCode: string;
  originName: string;
}

export interface OfflineReceptionQueueItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: 'PENDING' | 'SYNCING' | 'ERROR';
  attempts: number;
  localApplied: boolean;
  forceOverwrite?: boolean;
  appliedReceptionId?: string;
  lastError?: string;
  documentType: OfflineReceiptDocumentType;
  documentId: string;
  documentCode: string;
  originName: string;
  payload: OfflineReceiptPayload;
}

export interface OfflineReceptionConflict {
  id: string;
  createdAt: string;
  reason: string;
  queueItem: OfflineReceptionQueueItem;
}

interface UseOfflineSyncOptions {
  onAfterLocalProcess?: () => Promise<void> | void;
}

const queueCollection = 'offline_reception_queue';
const conflictCollection = 'offline_reception_conflicts';
const scansCollection = 'offline_receptions';
const countQueueCollection = 'offline_count_queue';
const countConflictCollection = 'offline_count_conflicts';

const sortByCreatedAt = <T extends { createdAt?: string }>(items: T[]): T[] => (
  [...items].sort((a, b) => {
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return timeA - timeB;
  })
);

const isConflictError = (error: unknown): boolean => {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return (
    message.includes('conflict') ||
    message.includes('409') ||
    message.includes('already') ||
    message.includes('ya fue recibida') ||
    message.includes('orden de compra no encontrada') ||
    message.includes('traspaso de origen no encontrado')
  );
};

export const useOfflineSync = ({ onAfterLocalProcess }: UseOfflineSyncOptions = {}) => {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflicts, setConflicts] = useState<OfflineReceptionConflict[]>([]);
  const [blockedDocumentKeys, setBlockedDocumentKeys] = useState<string[]>([]);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const processingRef = useRef(false);

  const refreshState = useCallback(async () => {
    const queue = (await db.get(queueCollection as any)) as OfflineReceptionQueueItem[] || [];
    const conflictItems = (await db.get(conflictCollection as any)) as OfflineReceptionConflict[] || [];

    // Include counts in global pending count
    const countQueue = (await db.get(countQueueCollection as any)) as any[] || [];
    const countConflicts = (await db.get(countConflictCollection as any)) as any[] || [];

    const pending = queue.filter(item => item.status === 'PENDING' || item.status === 'ERROR' || item.status === 'SYNCING');
    const pendingCounts = countQueue.filter(item => item.status === 'PENDING' || item.status === 'ERROR' || item.status === 'SYNCING');

    setPendingCount(pending.length + pendingCounts.length);
    setBlockedDocumentKeys(buildBlockedReceptionDocumentKeys(queue));

    const allConflicts = [...conflictItems, ...countConflicts].sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });
    setConflicts(allConflicts as any);
  }, []);

  const clearScanLogsForDocument = useCallback(async (documentId: string) => {
    const allScanLogs = (await db.get(scansCollection as any)) as Array<{ id: string; documentId?: string }> || [];
    const remaining = allScanLogs.filter(log => log.documentId !== documentId);
    await db.save(scansCollection as any, remaining as any);
  }, []);

  const detectDocumentConflict = useCallback(async (item: OfflineReceptionQueueItem): Promise<string | null> => {
    if (item.documentType === 'INVENTORY_COUNT') {
      // For counts, we check if an audit/closure was already performed for this warehouse after our count started
      // This is a soft check, Master usually handles final logic.
      return null;
    }

    if (item.documentType === 'PURCHASE_ORDER') {
      const order = await db.getDocument('purchaseOrders', item.documentId) as PurchaseOrder | null;
      if (!order) return 'La Orden de Compra ya no existe en el servidor/local.';

      const hasPending = (order.items || []).some(line => {
        const ordered = Math.max(0, Number(line.quantityOrdered || 0));
        const received = Math.max(0, Number(line.quantityReceived || 0));
        return ordered - received > 0;
      });

      if (order.status === 'COMPLETED' || !hasPending) {
        return 'La Orden de Compra ya fue recibida por otra persona.';
      }

      return null;
    }

    const transfer = await db.getDocument('transfers', item.documentId) as StockTransfer | null;
    if (!transfer) return 'El traspaso ya no existe en el servidor/local.';

    if (transfer.status === 'COMPLETED') {
      return 'El traspaso entrante ya fue recibido por otra persona.';
    }

    return null;
  }, []);

  const moveToConflict = useCallback(async (item: OfflineReceptionQueueItem, reason: string) => {
    const conflict: OfflineReceptionConflict = {
      id: `CONFLICT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      reason,
      queueItem: {
        ...item,
        status: 'ERROR',
        lastError: reason,
        updatedAt: new Date().toISOString()
      }
    };

    await db.saveDocument(conflictCollection as any, conflict as any);
    await db.deleteDocument(queueCollection as any, item.id);
  }, []);

  const pushAppliedPackage = useCallback(async (item: OfflineReceptionQueueItem) => {
    if (!navigator.onLine) {
      throw new Error('Cannot push while offline');
    }

    if (item.documentType === 'INVENTORY_COUNT') {
      await apiSyncAdapter.pushInventoryCount(item.payload as any);
      return;
    }

    if (item.documentType === 'PURCHASE_ORDER') {
      const order = await db.getDocument('purchaseOrders', item.documentId);
      if (order) {
        await apiSyncAdapter.push('purchaseOrders', [order], 'UPDATE', 'UPSERT');
      }
    } else {
      const transfer = await db.getDocument('transfers', item.documentId);
      if (transfer) {
        await apiSyncAdapter.push('transfers', [transfer], 'UPDATE', 'UPSERT');
      }
    }

    if (item.appliedReceptionId) {
      const reception = await db.getDocument('receptions', item.appliedReceptionId);
      if (reception) {
        await apiSyncAdapter.push('receptions', [reception], 'CREATE', 'UPSERT');
      }
    }
  }, []);

  const processPendingQueue = useCallback(async () => {
    if (processingRef.current || !navigator.onLine) return;

    processingRef.current = true;
    setIsSyncing(true);

    try {
      const queue = sortByCreatedAt((await db.get(queueCollection as any)) as OfflineReceptionQueueItem[] || []);

      for (const item of queue) {
        if (!navigator.onLine) break;
        if (!(item.status === 'PENDING' || item.status === 'ERROR' || item.status === 'SYNCING')) continue;

        const workingItem: OfflineReceptionQueueItem = {
          ...item,
          status: 'SYNCING',
          attempts: Math.max(0, Number(item.attempts || 0)) + 1,
          updatedAt: new Date().toISOString(),
          lastError: undefined
        };
        await db.saveDocument(queueCollection as any, workingItem as any);

        try {
          if (!workingItem.localApplied) {
            if (!workingItem.forceOverwrite) {
              const conflictReason = await detectDocumentConflict(workingItem);
              if (conflictReason) {
                await moveToConflict(workingItem, conflictReason);
                continue;
              }
            }

            const result = await db.processReceipt(workingItem.payload as any);

            if (Array.isArray(result.autoPrintItems) && result.autoPrintItems.length > 0) {
              window.dispatchEvent(new CustomEvent('autoPrintLabelRequested', {
                detail: {
                  source: 'OFFLINE_QUEUE_SYNC',
                  terminalId: workingItem.payload.terminalId,
                  items: result.autoPrintItems
                }
              }));
            }

            workingItem.localApplied = true;
            workingItem.appliedReceptionId = result.reception.id;
            workingItem.status = 'PENDING';
            workingItem.updatedAt = new Date().toISOString();
            await db.saveDocument(queueCollection as any, workingItem as any);

            await onAfterLocalProcess?.();
          }

          await pushAppliedPackage(workingItem);

          await db.deleteDocument(queueCollection as any, workingItem.id);
          await clearScanLogsForDocument(workingItem.documentId);
          setSyncToast(`Sincronización completa: Recepción #${workingItem.documentCode} procesada`);
        } catch (error: any) {
          if (!workingItem.forceOverwrite && isConflictError(error)) {
            await moveToConflict(workingItem, error?.message || 'Conflicto detectado al sincronizar.');
            continue;
          }

          const failedItem: OfflineReceptionQueueItem = {
            ...workingItem,
            status: 'ERROR',
            updatedAt: new Date().toISOString(),
            lastError: error?.message || 'Error de sincronización'
          };
          await db.saveDocument(queueCollection as any, failedItem as any);
        }
      }
    } finally {
      processingRef.current = false;
      setIsSyncing(false);
      await refreshState();
    }
  }, [clearScanLogsForDocument, detectDocumentConflict, moveToConflict, onAfterLocalProcess, pushAppliedPackage, refreshState]);

  const enqueueOfflineReceipt = useCallback(async (
    payload: OfflineReceiptPayload,
    metadata: QueueMetadata
  ): Promise<{ queued: boolean; alreadyApplied: boolean; receptionId?: string }> => {
    const documentType = payload.documentType as ReceptionDocumentType;
    const queue = (await db.get(queueCollection as any)) as OfflineReceptionQueueItem[] || [];

    // 1. Un documento solo puede tener una recepción esperando sincronizar.
    if (findQueuedReceptionForDocument(queue, documentType, payload.documentId)) {
      throw new DuplicateReceptionError(
        `Ya hay una recepción de #${metadata.documentCode} esperando sincronizar. No se puede recibir dos veces el mismo documento.`
      );
    }

    const idempotencyKey = payload.idempotencyKey?.trim() || buildReceptionIdempotencyKey({
      documentType,
      documentId: payload.documentId,
      receivedBy: payload.receivedBy,
      items: payload.items.map(item => ({
        productId: item.productId,
        variantSku: item.variantSku,
        expectedQty: item.expectedQty,
        receivedQty: item.receivedQty,
      })),
    });

    // 2. Si este mismo intento ya se aplicó (replay tras caída), no encolar de nuevo.
    const previousAttempt = (await db
      .getDocument(RECEPTION_IDEMPOTENCY_COLLECTION, idempotencyKey)
      .catch(() => null)) as ReceptionIdempotencyRecord | null;

    if (previousAttempt && isReceptionIdempotencyFresh(previousAttempt.createdAt)) {
      const previousReception = await db
        .getDocument('receptions', previousAttempt.receptionId)
        .catch(() => null);

      if (previousReception) {
        await refreshState();
        return { queued: false, alreadyApplied: true, receptionId: previousAttempt.receptionId };
      }
    }

    const queueItem: OfflineReceptionQueueItem = {
      id: `OFFQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'PENDING',
      attempts: 0,
      localApplied: false,
      documentType: payload.documentType,
      documentId: payload.documentId,
      documentCode: metadata.documentCode,
      originName: metadata.originName,
      payload: { ...payload, idempotencyKey }
    };

    await db.saveDocument(queueCollection as any, queueItem as any);
    await refreshState();
    return { queued: true, alreadyApplied: false };
  }, [refreshState]);

  const enqueueOfflineCount = useCallback(async (
    payload: OfflineCountPayload
  ) => {
    const queueItem: OfflineReceptionQueueItem = {
      id: `OFFC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'PENDING',
      attempts: 0,
      localApplied: false,
      documentType: 'INVENTORY_COUNT',
      documentId: payload.id,
      documentCode: payload.id,
      originName: payload.warehouseName || 'Almacén',
      payload: payload as any
    };

    // We store counts in the same collection for unified processing if possible, 
    // or separate if distinct logic is needed. Let's stick to same logic for simplicity.
    await db.saveDocument(queueCollection as any, queueItem as any);
    await refreshState();
  }, [refreshState]);

  const recordOfflineScan = useCallback(async (params: {
    documentId: string;
    documentCode: string;
    productId?: string;
    code: string;
  }) => {
    if (navigator.onLine) return;

    const scanLog = {
      id: `OFFSCAN-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date().toISOString(),
      documentId: params.documentId,
      documentCode: params.documentCode,
      productId: params.productId,
      scannedCode: params.code
    };

    await db.saveDocument(scansCollection as any, scanLog as any);
  }, []);

  const resolveConflict = useCallback(async (conflictId: string, action: 'OVERWRITE' | 'CANCEL') => {
    const conflict = await db.getDocument(conflictCollection as any, conflictId) as OfflineReceptionConflict | null;
    if (!conflict) return;

    if (action === 'CANCEL') {
      await db.deleteDocument(conflictCollection as any, conflictId);
      await refreshState();
      return;
    }

    const base = conflict.queueItem;
    const queueItem: OfflineReceptionQueueItem = {
      ...base,
      id: `OFFQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'PENDING',
      forceOverwrite: true,
      localApplied: false,
      appliedReceptionId: undefined,
      attempts: 0,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      lastError: undefined
    };

    await db.saveDocument(queueCollection as any, queueItem as any);
    await db.deleteDocument(conflictCollection as any, conflictId);
    await refreshState();

    if (navigator.onLine) {
      await processPendingQueue();
    }
  }, [processPendingQueue, refreshState]);

  const clearSyncToast = useCallback(() => setSyncToast(null), []);

  useEffect(() => {
    refreshState().catch(console.error);

    const handleOnline = () => {
      setIsOnline(true);
      processPendingQueue().catch(console.error);
    };

    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [processPendingQueue, refreshState]);

  return {
    isOnline,
    isSyncing,
    pendingCount,
    conflicts,
    blockedDocumentKeys,
    syncToast,
    enqueueOfflineReceipt,
    enqueueOfflineCount,
    recordOfflineScan,
    processPendingQueue,
    resolveConflict,
    clearSyncToast,
    refreshState
  };
};
