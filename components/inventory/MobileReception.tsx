import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Box,
  Camera,
  CheckCircle2,
  Cloud,
  ClipboardList,
  Package,
  Search,
  Truck,
  Wifi,
  WifiOff,
  XCircle
} from 'lucide-react';
import {
  BusinessConfig,
  Product,
  PurchaseOrder,
  StockTransfer,
  Supplier,
  User,
  Warehouse
} from '../../types';
import { db } from '../../utils/db';
import BarcodeScannerModal from '../BarcodeScannerModal';
import { OfflineReceiptPayload, useOfflineSync } from '../../hooks/useOfflineSync';
import { buildReceptionIdempotencyKey, receptionDocumentKey } from '../../utils/receptionIdempotency';

type DocumentFilter = 'PURCHASE_ORDER' | 'TRANSFER_IN';

type ReceiptDocument = {
  id: string;
  type: DocumentFilter;
  code: string;
  originName: string;
  warehouseId: string;
  progressPct: number;
  lines: ReceiptLine[];
};

type ReceiptLine = {
  key: string;
  productId: string;
  productName: string;
  expectedQty: number;
  receivedQty: number;
  cost: number;
  image?: string;
  sku: string;
  variantSku?: string;
  variantInfo?: string;
  barcodes: string[];
};

type AutoLabelCandidate = {
  productId: string;
  productName: string;
  sku?: string;
  price?: number;
  quantityReceived: number;
};

interface MobileReceptionProps {
  products: Product[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  transfers: StockTransfer[];
  warehouses: Warehouse[];
  config: BusinessConfig;
  currentUser?: User | null;
  terminalId?: string;
  onProcessed?: () => Promise<void> | void;
  onCancel: () => void;
}

const toLineKey = (productId: string, variantSku?: string) => `${productId}::${variantSku || 'base'}`;

const toSafeNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const MobileReception: React.FC<MobileReceptionProps> = ({
  products,
  suppliers,
  purchaseOrders,
  transfers,
  warehouses,
  config,
  currentUser,
  terminalId,
  onProcessed,
  onCancel
}) => {
  const [filter, setFilter] = useState<DocumentFilter>('PURCHASE_ORDER');
  const [search, setSearch] = useState('');
  const [selectedDocument, setSelectedDocument] = useState<ReceiptDocument | null>(null);
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [inboxTab, setInboxTab] = useState<'PENDING' | 'CONFLICTS'>('PENDING');
  const [variantSheet, setVariantSheet] = useState<{
    code: string;
    options: ReceiptLine[];
  } | null>(null);

  const {
    isOnline,
    isSyncing,
    pendingCount,
    conflicts,
    blockedDocumentKeys,
    syncToast,
    enqueueOfflineReceipt,
    recordOfflineScan,
    processPendingQueue,
    resolveConflict,
    clearSyncToast
  } = useOfflineSync({
    onAfterLocalProcess: async () => {
      await onProcessed?.();
    }
  });

  const quickActionPrimary = 'min-h-[54px] rounded-2xl bg-blue-600 px-5 text-white font-black text-sm active:scale-[0.98] shadow-md';
  const quickActionSecondary = 'min-h-[54px] rounded-2xl bg-white border-2 border-gray-200 px-5 text-gray-700 font-black text-sm active:scale-[0.98]';

  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((product) => map.set(product.id, product));
    return map;
  }, [products]);

  useEffect(() => {
    if (!syncToast) return;
    const timer = window.setTimeout(() => clearSyncToast(), 4500);
    return () => window.clearTimeout(timer);
  }, [clearSyncToast, syncToast]);

  const buildPurchaseOrderDocument = useCallback((order: PurchaseOrder): ReceiptDocument | null => {
    const supplierName = suppliers.find((supplier) => supplier.id === order.supplierId)?.name
      || order.supplierName?.trim()
      || 'Proveedor no asignado';
    const warehouseId = order.warehouseId || config.inventoryScope?.defaultSalesWarehouseId || warehouses[0]?.id || 'wh_central';

    const computedLines = (order.items || []).map((item) => {
      const product = productMap.get(item.productId);
      const currentReceived = Math.max(0, toSafeNumber(item.quantityReceived));
      const expectedRemaining = Math.max(0, toSafeNumber(item.quantityOrdered) - currentReceived);
      const variant = item.variantSku ? product?.variants?.find(v => v.sku === item.variantSku) : undefined;

      return {
        key: toLineKey(item.productId, item.variantSku),
        productId: item.productId,
        productName: item.productName || product?.name || item.productId,
        expectedQty: expectedRemaining,
        receivedQty: 0,
        cost: toSafeNumber(item.cost),
        image: product?.image,
        sku: item.variantSku || variant?.sku || product?.barcode || item.productId,
        variantSku: item.variantSku,
        variantInfo: item.variantInfo,
        barcodes: [
          item.variantSku,
          ...(variant?.barcode || []),
          product?.barcode,
          item.productId
        ].filter(Boolean) as string[]
      } as ReceiptLine;
    }).filter((line) => line.expectedQty > 0);

    if (computedLines.length === 0) return null;

    const orderedTotal = (order.items || []).reduce((sum, item) => sum + Math.max(0, toSafeNumber(item.quantityOrdered)), 0);
    const historicalReceived = (order.items || []).reduce((sum, item) => sum + Math.max(0, toSafeNumber(item.quantityReceived)), 0);
    const progressPct = orderedTotal > 0 ? Math.min(100, Math.round((historicalReceived / orderedTotal) * 100)) : 0;

    return {
      id: order.id,
      type: 'PURCHASE_ORDER',
      code: order.code || order.id,
      originName: supplierName,
      warehouseId,
      progressPct,
      lines: computedLines
    };
  }, [config.inventoryScope?.defaultSalesWarehouseId, productMap, suppliers, warehouses]);

  const buildTransferDocument = useCallback((transfer: StockTransfer): ReceiptDocument | null => {
    if (transfer.status !== 'IN_TRANSIT' && transfer.status !== 'PARTIALLY_RECEIVED') return null;

    const originName = warehouses.find((warehouse) => warehouse.id === transfer.sourceWarehouseId)?.name || 'Origen desconocido';

    const computedLines = (transfer.items || []).map((item) => {
      const product = productMap.get(item.productId);
      const variantSku = (item as { variantSku?: string }).variantSku;
      const variant = variantSku ? product?.variants?.find(v => v.sku === variantSku) : undefined;
      const sentQty = Math.max(0, toSafeNumber(item.quantity));
      const alreadyReceivedQty = Math.max(0, toSafeNumber(item.receivedQuantity));
      const expectedQty = Math.max(0, sentQty - alreadyReceivedQty);

      return {
        key: toLineKey(item.productId, variantSku),
        productId: item.productId,
        productName: item.productName || product?.name || item.productId,
        expectedQty,
        receivedQty: 0,
        cost: toSafeNumber(product?.cost),
        image: product?.image,
        sku: variantSku || variant?.sku || product?.barcode || item.productId,
        variantSku,
        variantInfo: variantSku,
        barcodes: [variantSku, ...(variant?.barcode || []), product?.barcode, item.productId].filter(Boolean) as string[]
      } as ReceiptLine;
    }).filter((line) => line.expectedQty > 0);

    if (computedLines.length === 0) return null;

    const totalSent = (transfer.items || []).reduce((sum, item) => sum + Math.max(0, toSafeNumber(item.quantity)), 0);
    const totalReceived = (transfer.items || []).reduce((sum, item) => sum + Math.max(0, toSafeNumber(item.receivedQuantity)), 0);
    const progressPct = totalSent > 0 ? Math.min(100, Math.round((totalReceived / totalSent) * 100)) : 0;

    return {
      id: transfer.id,
      type: 'TRANSFER_IN',
      code: transfer.displayId || transfer.id,
      originName,
      warehouseId: transfer.destinationWarehouseId,
      progressPct,
      lines: computedLines
    };
  }, [productMap, warehouses]);

  const pendingDocuments = useMemo(() => {
    // Un documento con recepción en cola no se puede volver a recibir: al
    // encolar offline el documento local sigue abierto, así que se oculta.
    const blockedKeys = new Set(blockedDocumentKeys);
    const isBlocked = (doc: ReceiptDocument) => blockedKeys.has(receptionDocumentKey(doc.type, doc.id));

    const orderDocs = (purchaseOrders || [])
      .filter((order) => order.status === 'ORDERED' || order.status === 'PARTIAL')
      .map(buildPurchaseOrderDocument)
      .filter(Boolean)
      .filter((doc) => !isBlocked(doc as ReceiptDocument)) as ReceiptDocument[];

    const transferDocs = (transfers || [])
      .filter((transfer) => transfer.status === 'IN_TRANSIT' || transfer.status === 'PARTIALLY_RECEIVED')
      .map(buildTransferDocument)
      .filter(Boolean)
      .filter((doc) => !isBlocked(doc as ReceiptDocument)) as ReceiptDocument[];

    return {
      PURCHASE_ORDER: orderDocs,
      TRANSFER_IN: transferDocs
    };
  }, [blockedDocumentKeys, buildPurchaseOrderDocument, buildTransferDocument, purchaseOrders, transfers]);

  const filteredDocuments = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const docs = pendingDocuments[filter];

    if (!needle) return docs;

    return docs.filter((doc) => {
      return (
        doc.code.toLowerCase().includes(needle) ||
        doc.originName.toLowerCase().includes(needle)
      );
    });
  }, [filter, pendingDocuments, search]);

  const selectDocument = (doc: ReceiptDocument) => {
    setSelectedDocument(doc);
    setLines(doc.lines.map((line) => ({ ...line, receivedQty: 0 })));
  };

  const upsertLineQuantity = useCallback((lineKey: string, delta: number) => {
    setLines((prev) => prev.map((line) => {
      if (line.key !== lineKey) return line;
      return {
        ...line,
        receivedQty: Math.max(0, line.receivedQty + delta)
      };
    }));
  }, []);

  const openVariantSelector = useCallback((code: string, candidates: ReceiptLine[]) => {
    setVariantSheet({ code, options: candidates });
  }, []);

  const processScanCode = useCallback(async (rawCode: string): Promise<{ success: boolean; message?: string }> => {
    const code = rawCode.trim();
    if (!selectedDocument || !code) {
      return { success: false, message: 'No hay documento seleccionado' };
    }

    const exactMatches = lines.filter((line) => (
      line.sku === code ||
      line.variantSku === code ||
      line.productId === code ||
      line.barcodes.includes(code)
    ));

    if (exactMatches.length === 1) {
      upsertLineQuantity(exactMatches[0].key, 1);
      await recordOfflineScan({
        documentId: selectedDocument.id,
        documentCode: selectedDocument.code,
        productId: exactMatches[0].productId,
        code
      });
      return { success: true, message: `${exactMatches[0].productName} +1` };
    }

    if (exactMatches.length > 1) {
      await recordOfflineScan({
        documentId: selectedDocument.id,
        documentCode: selectedDocument.code,
        code
      });
      openVariantSelector(code, exactMatches);
      return { success: true, message: 'Selecciona variante' };
    }

    const productByVariantBarcode = products.find((product) =>
      (product.variants || []).some((variant) => (variant.barcode || []).includes(code))
    );

    if (productByVariantBarcode) {
      const candidates = lines.filter((line) => line.productId === productByVariantBarcode.id);
      if (candidates.length === 1) {
        upsertLineQuantity(candidates[0].key, 1);
        await recordOfflineScan({
          documentId: selectedDocument.id,
          documentCode: selectedDocument.code,
          productId: candidates[0].productId,
          code
        });
        return { success: true, message: `${candidates[0].productName} +1` };
      }
      if (candidates.length > 1) {
        await recordOfflineScan({
          documentId: selectedDocument.id,
          documentCode: selectedDocument.code,
          code
        });
        openVariantSelector(code, candidates);
        return { success: true, message: 'Selecciona variante' };
      }
    }

    return { success: false, message: 'SKU no pertenece al documento' };
  }, [lines, openVariantSelector, products, selectedDocument, upsertLineQuantity]);

  useEffect(() => {
    const onHardwareScan = (event: Event) => {
      const barcode = (event as CustomEvent<{ barcode: string }>).detail?.barcode;
      if (!barcode || !selectedDocument) return;
      processScanCode(barcode).catch(console.error);
    };

    window.addEventListener('barcodeScanned', onHardwareScan as EventListener);
    return () => window.removeEventListener('barcodeScanned', onHardwareScan as EventListener);
  }, [processScanCode, selectedDocument]);

  const triggerAutoPrint = useCallback(async (items: AutoLabelCandidate[]) => {
    if (!items.length) return;

    window.dispatchEvent(new CustomEvent('autoPrintLabelRequested', {
      detail: {
        terminalId,
        source: 'MOBILE_RECEPTION',
        items
      }
    }));
  }, [terminalId]);

  const finalizeReceipt = async () => {
    if (!selectedDocument || isSaving) return;

    const hasAnyReceived = lines.some((line) => line.receivedQty > 0);
    if (!hasAnyReceived) {
      alert('Escanea al menos un artículo antes de finalizar.');
      return;
    }

    // Bloquea la doble pulsación también en la rama offline.
    setIsSaving(true);

    try {
      const missingItems = lines.filter((line) => line.expectedQty > line.receivedQty);
      const overageItems = lines.filter((line) => line.receivedQty > line.expectedQty);
      let discrepancyReason = '';

      if (missingItems.length > 0 || overageItems.length > 0) {
        const detail = [
          missingItems.length > 0 ? `faltantes en ${missingItems.length} línea(s)` : '',
          overageItems.length > 0 ? `exceso en ${overageItems.length} línea(s)` : ''
        ].filter(Boolean).join(' y ');
        const defaultReason = missingItems.length > 0 ? 'Diferencia de despacho' : 'Exceso de despacho';

        discrepancyReason = (await clicPrompt(`Se detectó ${detail}. Indica motivo de ajuste (ej: ${defaultReason}):`, defaultReason))?.trim() || '';
        if (!discrepancyReason) {
          alert('Debes indicar un motivo para registrar diferencias.');
          return;
        }
      }

      const payload: OfflineReceiptPayload = {
        documentType: selectedDocument.type,
        documentId: selectedDocument.id,
        warehouseId: selectedDocument.warehouseId,
        receivedBy: currentUser?.id || 'system',
        receivedByUserName: currentUser?.name || 'Sistema',
        terminalId: terminalId || 'LOCAL',
        discrepancyReason,
        idempotencyKey: buildReceptionIdempotencyKey({
          documentType: selectedDocument.type,
          documentId: selectedDocument.id,
          receivedBy: currentUser?.id || 'system',
          items: lines.map((line) => ({
            productId: line.productId,
            variantSku: line.variantSku,
            expectedQty: line.expectedQty,
            receivedQty: line.receivedQty
          }))
        }),
        items: lines.map((line) => ({
          productId: line.productId,
          productName: line.productName,
          expectedQty: line.expectedQty,
          receivedQty: line.receivedQty,
          cost: line.cost,
          variantSku: line.variantSku,
          variantInfo: line.variantInfo
        }))
      };

      if (!isOnline) {
        try {
          const queued = await enqueueOfflineReceipt(payload, {
            documentCode: selectedDocument.code,
            originName: selectedDocument.originName
          });

          setSelectedDocument(null);
          setLines([]);
          setVariantSheet(null);
          alert(queued.alreadyApplied
            ? 'Esta recepción ya estaba registrada. No se duplicó el inventario.'
            : 'Recepción guardada. Se enviará automáticamente cuando recuperes conexión');
        } catch (error: any) {
          console.error('Error guardando recepción offline:', error);
          alert(error?.message || 'No fue posible guardar la recepción en modo offline.');
        }
        return;
      }

      const onlinePayload = {
        ...payload,
        documentType: selectedDocument.type as 'PURCHASE_ORDER' | 'TRANSFER_IN'
      };
      const result = await db.processReceipt({
        ...onlinePayload
      });

      await triggerAutoPrint(result.autoPrintItems || []);

      await onProcessed?.();
      setSelectedDocument(null);
      setLines([]);
      setVariantSheet(null);

      const discrepancyMessage = result.missingItems?.length
        ? `\nFaltantes: ${result.missingItems.length}`
        : '';

      alert(`Recepción finalizada (${result.receivedItemsCount} SKU recibidos).${discrepancyMessage}`);
    } catch (error: any) {
      console.error('Error finalizando recepción:', error);
      alert(error?.message || 'No fue posible finalizar la recepción.');
    } finally {
      setIsSaving(false);
    }
  };

  const totalExpected = lines.reduce((sum, line) => sum + line.expectedQty, 0);
  const totalReceived = lines.reduce((sum, line) => sum + line.receivedQty, 0);
  const handleScan = () => setShowCameraScanner(true);

  const lineColor = (line: ReceiptLine): string => {
    if (line.receivedQty === 0) return 'border-gray-200 bg-white';
    if (line.receivedQty === line.expectedQty) return 'border-green-300 bg-green-50';
    if (line.receivedQty > line.expectedQty) return 'border-red-300 bg-red-50';
    return 'border-orange-300 bg-orange-50';
  };

  if (!selectedDocument) {
    return (
      <div className="min-h-full space-y-4">
        {!isOnline && (
          <div className="sticky top-0 z-30 h-7 rounded-lg bg-amber-100 border border-amber-200 text-amber-800 text-[11px] font-bold flex items-center justify-center">
            Modo Offline: Los datos se guardarán localmente
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center justify-between gap-3">
            <button onClick={onCancel} className={quickActionSecondary}>
              <span className="inline-flex items-center gap-2">
                <ArrowLeft size={18} /> Volver
              </span>
            </button>

            <div className="flex items-center gap-2">
              {isSyncing && (
                <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-50 text-sky-700 text-[11px] font-black">
                  <Cloud size={14} className="animate-pulse" />
                  Syncing...
                </div>
              )}
              <button
                onClick={() => processPendingQueue().catch(console.error)}
                disabled={!isOnline || pendingCount === 0 || isSyncing}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-100 text-gray-600 text-[11px] font-black disabled:opacity-40"
                title="Sincronizar cola pendiente"
              >
                <Cloud size={14} />
                Cola: {pendingCount}
              </button>
              <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black ${isOnline ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {isOnline ? <Wifi size={15} /> : <WifiOff size={15} />}
                {isOnline ? 'Online' : 'Offline'}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
          <h1 className="text-xl font-black text-gray-900">Recepción de Mercancía</h1>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setFilter('PURCHASE_ORDER')}
              className={`rounded-xl py-3 font-black text-sm ${filter === 'PURCHASE_ORDER' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              Órdenes de Compra
            </button>
            <button
              onClick={() => setFilter('TRANSFER_IN')}
              className={`rounded-xl py-3 font-black text-sm ${filter === 'TRANSFER_IN' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              Traspasos Entrantes
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar # documento o origen..."
              className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 bg-gray-50 outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setInboxTab('PENDING')}
              className={`rounded-xl py-2.5 text-xs font-black ${inboxTab === 'PENDING' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}
            >
              Pendientes
            </button>
            <button
              onClick={() => setInboxTab('CONFLICTS')}
              className={`rounded-xl py-2.5 text-xs font-black ${inboxTab === 'CONFLICTS' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-500'}`}
            >
              Conflictos ({conflicts.length})
            </button>
          </div>
        </div>

        <div className="space-y-3 pb-24">
          {inboxTab === 'PENDING' && filteredDocuments.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
              <ClipboardList className="mx-auto text-gray-300 mb-3" size={36} />
              <p className="font-black text-gray-500">No hay documentos pendientes</p>
              {blockedDocumentKeys.length > 0 && (
                <p className="mt-2 text-xs font-bold text-amber-700">
                  {blockedDocumentKeys.length} documento(s) con recepción esperando sincronizar.
                </p>
              )}
            </div>
          )}

          {inboxTab === 'PENDING' && filteredDocuments.map((doc) => (
            <button
              key={`${doc.type}-${doc.id}`}
              onClick={() => selectDocument(doc)}
              className="w-full bg-white rounded-2xl border border-gray-200 shadow-sm p-4 text-left active:scale-[0.99]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${doc.type === 'PURCHASE_ORDER' ? 'bg-blue-100' : 'bg-green-100'}`}>
                    {doc.type === 'PURCHASE_ORDER' ? (
                      <Box className="text-blue-600" size={20} />
                    ) : (
                      <Truck className="text-green-600" size={20} />
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-gray-400 font-black uppercase">#{doc.code}</p>
                    <h3 className="font-black text-gray-900 leading-tight">{doc.originName}</h3>
                  </div>
                </div>
                <span className="text-xs font-black px-2 py-1 rounded-lg bg-gray-100 text-gray-600">{doc.progressPct}%</span>
              </div>

              <div className="mt-4">
                <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className={`h-full ${doc.type === 'PURCHASE_ORDER' ? 'bg-blue-500' : 'bg-green-500'}`} style={{ width: `${doc.progressPct}%` }} />
                </div>
                <p className="mt-2 text-xs text-gray-500 font-bold">{doc.lines.length} SKU pendientes</p>
              </div>
            </button>
          ))}

          {inboxTab === 'CONFLICTS' && conflicts.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
              <ClipboardList className="mx-auto text-gray-300 mb-3" size={36} />
              <p className="font-black text-gray-500">No hay conflictos pendientes</p>
            </div>
          )}

          {inboxTab === 'CONFLICTS' && conflicts.map((conflict) => (
            <div key={conflict.id} className="bg-white rounded-2xl border-2 border-red-200 shadow-sm p-4">
              <p className="text-xs font-black text-red-500 uppercase">Conflicto</p>
              <h3 className="font-black text-gray-900 mt-1">#{conflict.queueItem.documentCode}</h3>
              <p className="text-sm font-bold text-gray-500">{conflict.queueItem.originName}</p>
              <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2 font-bold">
                {conflict.reason}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => resolveConflict(conflict.id, 'OVERWRITE').catch(console.error)}
                  className="rounded-xl py-2.5 bg-blue-600 text-white text-xs font-black"
                >
                  Sobrescribir
                </button>
                <button
                  onClick={() => resolveConflict(conflict.id, 'CANCEL').catch(console.error)}
                  className="rounded-xl py-2.5 bg-gray-100 text-gray-700 text-xs font-black"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full space-y-4 pb-28">
      {!isOnline && (
        <div className="sticky top-0 z-30 h-7 rounded-lg bg-amber-100 border border-amber-200 text-amber-800 text-[11px] font-bold flex items-center justify-center">
          Modo Offline: Los datos se guardarán localmente
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sticky top-0 z-20">
        <div className="flex items-start justify-between gap-3">
          <button onClick={() => setSelectedDocument(null)} className={quickActionSecondary}>
            <span className="inline-flex items-center gap-2 text-xs">
              <ArrowLeft size={16} /> Documentos
            </span>
          </button>

          <button onClick={finalizeReceipt} disabled={isSaving} className={`${quickActionPrimary} disabled:opacity-50 disabled:cursor-not-allowed`}>
            {isSaving ? 'Guardando...' : 'Finalizar'}
          </button>
        </div>

        <div className="mt-3">
          <p className="text-[11px] font-black uppercase text-gray-400">Documento Origen</p>
          <h2 className="text-lg font-black text-gray-900">#{selectedDocument.code}</h2>
          <p className="text-sm text-gray-500 font-bold">{selectedDocument.originName}</p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-2">
            <p className="text-[11px] font-black text-gray-400 uppercase">Esperado</p>
            <p className="text-xl font-black text-gray-800">{totalExpected}</p>
          </div>
          <div className="rounded-xl bg-blue-50 border border-blue-200 p-2">
            <p className="text-[11px] font-black text-blue-500 uppercase">Recibido</p>
            <p className="text-xl font-black text-blue-700">{totalReceived}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {lines.map((line) => (
          <div key={line.key} className={`rounded-2xl border-2 p-3 ${lineColor(line)}`}>
            <div className="flex items-center gap-3">
              <img
                src={line.image || 'https://placehold.co/80x80/e2e8f0/64748b?text=SKU'}
                alt={line.productName}
                className="w-12 h-12 rounded-xl object-cover border border-gray-200"
              />

              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-gray-900 truncate">{line.productName}</p>
                <p className="text-[11px] font-bold text-gray-500 truncate">{line.variantInfo || line.sku}</p>
                <p className="text-xs font-black text-gray-700 mt-1">
                  {line.receivedQty} / {line.expectedQty}
                </p>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => upsertLineQuantity(line.key, -1)}
                  className="w-9 h-9 rounded-lg bg-white border border-gray-300 text-gray-700 font-black"
                >
                  -
                </button>
                <button
                  onClick={() => upsertLineQuantity(line.key, 1)}
                  className="w-9 h-9 rounded-lg bg-blue-600 text-white font-black"
                >
                  +
                </button>
              </div>
            </div>

            {line.receivedQty > line.expectedQty && (
              <div className="mt-2 inline-flex items-center gap-1 rounded-lg bg-red-100 text-red-700 px-2 py-1 text-[11px] font-black">
                <XCircle size={13} /> Exceso: +{line.receivedQty - line.expectedQty}
              </div>
            )}
            {line.receivedQty > 0 && line.receivedQty < line.expectedQty && (
              <div className="mt-2 inline-flex items-center gap-1 rounded-lg bg-orange-100 text-orange-700 px-2 py-1 text-[11px] font-black">
                <Package size={13} /> Faltante: {line.expectedQty - line.receivedQty}
              </div>
            )}
            {line.receivedQty > 0 && line.receivedQty === line.expectedQty && (
              <div className="mt-2 inline-flex items-center gap-1 rounded-lg bg-green-100 text-green-700 px-2 py-1 text-[11px] font-black">
                <CheckCircle2 size={13} /> Conteo exacto
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={handleScan}
        className="fixed right-6 bottom-8 z-30 w-16 h-16 rounded-full bg-blue-600 text-white shadow-2xl flex items-center justify-center active:scale-95"
        aria-label="Escanear"
      >
        <Camera size={28} />
      </button>

      <BarcodeScannerModal
        isOpen={showCameraScanner}
        onClose={() => setShowCameraScanner(false)}
        onScan={processScanCode}
      />

      {variantSheet && (
        <div className="fixed inset-0 z-[120] bg-black/40 flex items-end">
          <div className="w-full bg-white rounded-t-3xl p-4 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-black text-gray-900">Selecciona variante ({variantSheet.code})</h3>
              <button
                onClick={() => setVariantSheet(null)}
                className="w-9 h-9 rounded-full bg-gray-100 text-gray-500"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 pb-6">
              {variantSheet.options.map((option) => (
                <button
                  key={option.key}
                  onClick={() => {
                    upsertLineQuantity(option.key, 1);
                    setVariantSheet(null);
                  }}
                  className="w-full rounded-2xl border-2 border-gray-200 bg-white p-4 text-left active:scale-[0.99]"
                >
                  <p className="font-black text-gray-900">{option.productName}</p>
                  <p className="text-xs font-bold text-gray-500 mt-1">{option.variantInfo || option.variantSku || option.sku}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {syncToast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[160] px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black shadow-xl">
          {syncToast}
        </div>
      )}
    </div>
  );
};

export default MobileReception;
