/**
 * InventoryCount
 * 
 * Inventory counting interface for handheld devices.
 * Scan products and adjust quantities.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScanBarcode, Plus, Minus, Save, X, Camera, Cloud, Wifi, WifiOff, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Product } from '../../types';
import BarcodeScannerModal from '../BarcodeScannerModal';
import { useOfflineSync } from '../../hooks/useOfflineSync';
import { useInventoryCountClaim } from '../../hooks/useInventoryCountClaim';
import InventoryScopePicker from './InventoryScopePicker';
import { filterInventoryProducts, findExactInventoryProduct } from '../../utils/inventoryProductSearch';
import {
    inventoryScannerPreferenceKey,
    normalizeInventoryScannerQuantity,
    resolveInventoryScannerQuantityMode,
    type InventoryScannerQuantityMode,
} from '../../utils/inventoryScanner';

interface CountedItem {
    productId: string;
    productName: string;
    expectedQty: number;
    countedQty: number;
    difference: number;
}

interface InventoryCountProps {
    products: Product[];
    warehouseId?: string;
    warehouseName?: string;
    onSave?: (counts: CountedItem[]) => Promise<{ message?: string } | void>;
    onCancel: () => void;
    terminalId: string;
    userId: string;
    userName: string;
}

const InventoryCount: React.FC<InventoryCountProps> = ({
    products,
    warehouseId,
    warehouseName,
    onSave,
    onCancel,
    terminalId,
    userId,
    userName
}) => {
    const {
        isOnline,
        isSyncing,
        pendingCount,
        conflicts,
        syncToast,
        enqueueOfflineCount,
        recordOfflineScan,
        processPendingQueue,
        resolveConflict,
        clearSyncToast
    } = useOfflineSync();

    // Alcance del conteo: almacén completo o una ubicación concreta.
    const [scope, setScope] = useState<{ label: string | null; locationId: string | null } | null>(null);

    // Una sola PDA puede tener el alcance en conteo. El bloqueo vive en el
    // Master; si no existe o no responde, el conteo sigue siendo posible pero
    // sin exclusividad (se avisa en pantalla).
    const claim = useInventoryCountClaim({
        warehouseId,
        locationLabel: scope?.label ?? null,
        terminalId,
        userId,
        userName,
        enabled: Boolean(scope)
    });

    const [counts, setCounts] = useState<CountedItem[]>([]);
    const [scanInput, setScanInput] = useState('');
    const [selectedItem, setSelectedItem] = useState<string | null>(null);
    const [showCameraScanner, setShowCameraScanner] = useState(false);
    const [scannerQuantityMode, setScannerQuantityMode] = useState<InventoryScannerQuantityMode>('UNIT');
    const [pendingScannerProduct, setPendingScannerProduct] = useState<{ product: Product; code: string } | null>(null);
    const [scannerQuantityInput, setScannerQuantityInput] = useState('1');
    const [scanFeedback, setScanFeedback] = useState<string | null>(null);
    const [syncTab, setSyncTab] = useState<'PENDING' | 'CONFLICTS'>('PENDING');
    const [startedAt] = useState(() => new Date().toISOString());
    const [sessionId] = useState(() => `CNT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const scanInputRef = useRef<HTMLInputElement | null>(null);
    const filteredProducts = useMemo(
        () => filterInventoryProducts(products, scanInput, 12),
        [products, scanInput]
    );
    const scannerPreferenceKey = useMemo(
        () => inventoryScannerPreferenceKey(terminalId),
        [terminalId]
    );

    const focusScannerInput = useCallback(() => {
        window.requestAnimationFrame(() => scanInputRef.current?.focus());
    }, []);

    const selectScannerInput = useCallback(() => {
        window.requestAnimationFrame(() => {
            scanInputRef.current?.focus();
            scanInputRef.current?.select();
        });
    }, []);

    useEffect(() => {
        focusScannerInput();
        const restoreFocus = () => focusScannerInput();
        window.addEventListener('focus', restoreFocus);
        return () => window.removeEventListener('focus', restoreFocus);
    }, [focusScannerInput]);

    useEffect(() => {
        try {
            setScannerQuantityMode(resolveInventoryScannerQuantityMode(
                window.localStorage.getItem(scannerPreferenceKey)
            ));
        } catch (error) {
            console.warn('[InventoryScanner] No se pudo leer la preferencia local:', error);
        }
    }, [scannerPreferenceKey]);

    const toggleScannerQuantityMode = useCallback(() => {
        setScannerQuantityMode(currentMode => {
            const nextMode: InventoryScannerQuantityMode = currentMode === 'UNIT' ? 'PROMPT' : 'UNIT';
            try {
                window.localStorage.setItem(scannerPreferenceKey, nextMode);
            } catch (error) {
                console.warn('[InventoryScanner] No se pudo guardar la preferencia local:', error);
            }
            setScanFeedback(nextMode === 'UNIT'
                ? 'El lector agregará 1 unidad automáticamente.'
                : 'El lector solicitará la cantidad.');
            focusScannerInput();
            return nextMode;
        });
    }, [focusScannerInput, scannerPreferenceKey]);

    // Get expected qty for a product in the selected warehouse
    const getExpectedQty = useCallback((product: Product) => {
        if (!warehouseId) return product.stock || 0;
        return product.stockBalances?.[warehouseId] ?? 0;
    }, [warehouseId]);

    const addProductToCount = useCallback(async (product: Product, code: string, quantity = 1) => {
        const normalizedQuantity = normalizeInventoryScannerQuantity(quantity);
        const expected = getExpectedQty(product);
        setScanInput('');
        setScanFeedback(`${product.name}: +${normalizedQuantity}`);
        focusScannerInput();
        setCounts(currentCounts => {
            const existing = currentCounts.find(c => c.productId === product.id);
            if (existing) {
                return currentCounts.map(c =>
                    c.productId === product.id
                        ? {
                            ...c,
                            countedQty: c.countedQty + normalizedQuantity,
                            difference: c.countedQty + normalizedQuantity - c.expectedQty
                        }
                        : c
                );
            }
            return [...currentCounts, {
                productId: product.id,
                productName: product.name,
                expectedQty: expected,
                countedQty: normalizedQuantity,
                difference: normalizedQuantity - expected
            }];
        });

        await recordOfflineScan({
            documentId: sessionId,
            documentCode: sessionId,
            warehouseId,
            productId: product.id,
            code
        } as any);
    }, [focusScannerInput, getExpectedQty, recordOfflineScan, sessionId, warehouseId]);

    const handleResolvedProduct = useCallback(async (product: Product, code: string) => {
        if (scannerQuantityMode === 'PROMPT') {
            setPendingScannerProduct({ product, code });
            setScannerQuantityInput('1');
            setScanInput('');
            setScanFeedback(`${product.name}: indica la cantidad.`);
            return;
        }
        await addProductToCount(product, code, 1);
    }, [addProductToCount, scannerQuantityMode]);

    // Handle barcode, ID or an unambiguous keyboard search.
    const handleScan = async () => {
        const query = scanInput.trim();
        if (!query) return;

        const product = findExactInventoryProduct(products, query)
            || (filteredProducts.length === 1 ? filteredProducts[0] : undefined);

        if (!product) {
            setScanFeedback(filteredProducts.length > 1
                ? 'Selecciona un producto de los resultados.'
                : `Producto no encontrado: ${query}`);
            selectScannerInput();
            return;
        }

        await handleResolvedProduct(product, query);
    };

    // Integrated Android readers can write through the IME without emitting
    // Enter or keydown. An exact catalog match is therefore auto-submitted
    // after a short idle period; partial name searches remain interactive.
    useEffect(() => {
        const query = scanInput.trim();
        if (query.length < 3) return;

        const timer = window.setTimeout(() => {
            const exactProduct = findExactInventoryProduct(products, query);
            if (exactProduct) {
                void handleResolvedProduct(exactProduct, query);
                return;
            }
            if (filterInventoryProducts(products, query, 1).length === 0) {
                setScanFeedback(`Producto no encontrado: ${query}`);
                selectScannerInput();
            }
        }, 250);

        return () => window.clearTimeout(timer);
    }, [handleResolvedProduct, products, scanInput, selectScannerInput]);

    useEffect(() => {
        if (!syncToast || !clearSyncToast) return;
        const timer = window.setTimeout(() => clearSyncToast(), 4500);
        return () => window.clearTimeout(timer);
    }, [clearSyncToast, syncToast]);

    // Handle camera scan
    const handleCameraScan = async (code: string): Promise<{ success: boolean; message?: string }> => {
        const product = findExactInventoryProduct(products, code);

        if (product) {
            await handleResolvedProduct(product, code.trim());
            return {
                success: true,
                message: scannerQuantityMode === 'PROMPT'
                    ? `${product.name}: indica la cantidad`
                    : `${product.name} agregado`
            };
        } else {
            return { success: false, message: 'Producto no encontrado' };
        }
    };

    // Adjust quantity
    const adjustQty = (productId: string, delta: number) => {
        setCounts(counts.map(c =>
            c.productId === productId
                ? {
                    ...c,
                    countedQty: Math.max(0, c.countedQty + delta),
                    difference: Math.max(0, c.countedQty + delta) - c.expectedQty
                }
                : c
        ));
    };

    // Remove item
    const removeItem = (productId: string) => {
        setCounts(counts.filter(c => c.productId !== productId));
    };

    // Handle save
    const handleSave = async () => {
        if (counts.length === 0) {
            alert('No hay items contados');
            return;
        }

        if (await clicConfirm(`¿Guardar conteo de ${counts.length} productos para ${warehouseName || 'el almacén seleccionado'}?`)) {
            const payload = {
                id: sessionId,
                warehouseId: warehouseId || '',
                warehouseName: warehouseName || '',
                locationLabel: scope?.label ?? null,
                locationId: scope?.locationId ?? null,
                items: counts.map(c => ({ ...c, warehouseId })),
                startedAt,
                finishedAt: new Date().toISOString(),
                terminalId,
                userId,
                userName,
                claimSessionId: claim.session?.id || null
            };

            await enqueueOfflineCount(payload);
            setCounts([]); // Clear local session

            // Con red, se empuja al master de inmediato; si falla, queda en cola.
            if (navigator.onLine) {
                await processPendingQueue().catch(console.error);
            }

            await claim.release();

            alert(navigator.onLine
                ? 'Conteo guardado. Se está enviando al servidor; si falla, queda en la cola.'
                : 'Conteo guardado en cola de sincronización.');
            onCancel(); // Return to home
        }
    };

    const handleTakeOver = async () => {
        const reason = (await clicPrompt(
            'Otra PDA tiene este almacén en conteo. Indica el motivo para tomar el control:',
            'Cambio de turno'
        ))?.trim();

        if (!reason) return;
        await claim.takeOver(reason);
    };

    if (!scope) {
        return (
            <InventoryScopePicker
                warehouseId={warehouseId}
                warehouseName={warehouseName}
                onConfirm={setScope}
                onCancel={onCancel}
            />
        );
    }

    if (claim.state === 'CHECKING') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
                <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
                    <Cloud className="mx-auto mb-3 text-blue-600 animate-pulse" size={36} />
                    <p className="font-black text-gray-800">Reservando el almacén…</p>
                    <p className="mt-1 text-xs font-bold text-gray-500">{claim.scopeLabel}</p>
                </div>
            </div>
        );
    }

    if (claim.state === 'BLOCKED') {
        const holder = claim.holder;
        const holderLabel = holder?.userName || holder?.terminalId || 'otro equipo';
        const since = holder?.startedAt
            ? new Date(holder.startedAt).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
            : null;

        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
                <div className="w-full max-w-sm rounded-2xl border-2 border-amber-300 bg-white p-6 shadow-sm">
                    <div className="flex items-center gap-2 text-amber-600">
                        <AlertTriangle size={22} />
                        <h2 className="font-black text-gray-900">Almacén en conteo</h2>
                    </div>

                    <p className="mt-3 text-sm font-bold text-gray-600">
                        <span className="text-gray-900">{claim.scopeLabel}</span> de {warehouseName || 'este almacén'} lo está contando{' '}
                        <span className="text-gray-900">{holderLabel}</span>
                        {since ? ` desde las ${since}` : ''}.
                    </p>

                    <p className="mt-2 text-[11px] font-bold text-gray-400">
                        Solo un equipo puede contar la misma ubicación a la vez para evitar conteos duplicados.
                    </p>

                    <div className="mt-5 grid gap-2">
                        <button
                            onClick={handleTakeOver}
                            className="min-h-[52px] rounded-2xl bg-amber-500 px-4 text-sm font-black text-white active:scale-[0.98]"
                        >
                            Tomar el control
                        </button>
                        <button
                            onClick={onCancel}
                            className="min-h-[52px] rounded-2xl border-2 border-gray-200 bg-white px-4 text-sm font-black text-gray-700 active:scale-[0.98]"
                        >
                            Volver
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {!isOnline && (
                <div className="sticky top-0 z-30 h-7 bg-amber-100 border-b border-amber-200 text-amber-800 text-[11px] font-bold flex items-center justify-center">
                    Modo Offline: Los datos se guardarán localmente
                </div>
            )}
            {claim.state === 'CLAIMED' && (
                <div className="sticky top-0 z-30 h-7 bg-emerald-100 border-b border-emerald-200 text-emerald-800 text-[11px] font-bold flex items-center justify-center gap-1">
                    <ShieldCheck size={12} /> {claim.scopeLabel} reservado para esta PDA
                </div>
            )}
            {claim.state === 'UNSUPPORTED' && (
                <div className="sticky top-0 z-30 h-7 bg-gray-100 border-b border-gray-200 text-gray-600 text-[11px] font-bold flex items-center justify-center">
                    Este master no bloquea el almacén: otro equipo podría contar a la vez.
                </div>
            )}
            {claim.state === 'UNAVAILABLE' && (
                <div className="sticky top-0 z-30 h-7 bg-amber-100 border-b border-amber-200 text-amber-800 text-[11px] font-bold flex items-center justify-center">
                    Sin conexión con el master: el almacén no quedó reservado.
                </div>
            )}

            {/* Header */}
            <div className="bg-blue-600 text-white p-4 shadow-md">
                <div className="flex items-center justify-between mb-1">
                    <div>
                        <h1 className="text-xl font-black leading-tight">Conteo de Inventario</h1>
                        {warehouseName && (
                            <div className="flex items-center gap-1.5 text-blue-100 font-bold text-sm bg-black/10 px-2 py-0.5 rounded-lg w-fit">
                                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                                {warehouseName} · {claim.scopeLabel}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={onCancel}
                        className="p-2 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="flex items-center justify-between gap-2 mt-2">
                    <div className="flex items-center gap-2">
                        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-black ${isOnline ? 'bg-emerald-500/20 text-emerald-100' : 'bg-amber-500/25 text-amber-100'}`}>
                            {isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
                            {isOnline ? 'Online' : 'Offline'}
                        </div>
                        {isSyncing && (
                            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-500/25 text-sky-100 text-[11px] font-black">
                                <Cloud size={13} className="animate-pulse" />
                                Syncing...
                            </div>
                        )}
                    </div>
                    <button
                        onClick={processPendingQueue}
                        disabled={!isOnline || pendingCount === 0 || isSyncing}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/20 text-[11px] font-black disabled:opacity-40"
                    >
                        <Cloud size={13} />
                        Cola: {pendingCount}
                    </button>
                </div>

                {/* Scan Input */}
                <div className="flex gap-2 mt-4">
                    <div className="flex-1 relative">
                        <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-200" size={20} />
                        <input
                            ref={scanInputRef}
                            type="text"
                            value={scanInput}
                            onChange={(e) => {
                                setScanInput(e.target.value);
                                setScanFeedback(null);
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && void handleScan()}
                            placeholder="Buscar por nombre, SKU o código..."
                            className="w-full pl-10 pr-12 py-3 bg-white/10 border-2 border-white/20 rounded-xl text-white placeholder-blue-200 font-bold outline-none focus:bg-white/20"
                            autoFocus
                        />
                        {/* Camera Button */}
                        <button
                            onClick={() => setShowCameraScanner(true)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                            title="Abrir cámara"
                        >
                            <Camera size={20} className="text-white" />
                        </button>
                    </div>
                    <button
                        onClick={() => void handleScan()}
                        className="px-6 py-3 bg-white text-blue-600 rounded-xl font-bold hover:bg-blue-50"
                    >
                        Agregar
                    </button>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                    <button
                        type="button"
                        onClick={toggleScannerQuantityMode}
                        className={`rounded-lg border px-3 py-1.5 text-[11px] font-black shadow-sm ${scannerQuantityMode === 'UNIT'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-amber-200 bg-amber-50 text-amber-700'
                        }`}
                    >
                        {scannerQuantityMode === 'UNIT'
                            ? 'Lector: +1 automático'
                            : 'Lector: pedir cantidad'}
                    </button>
                    {scanFeedback && (
                        <span className="min-w-0 truncate text-right text-[11px] font-bold text-white">
                            {scanFeedback}
                        </span>
                    )}
                </div>
                {scanInput.trim() && filteredProducts.length > 0 && (
                    <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-white/20 bg-white text-gray-900 shadow-xl">
                        {filteredProducts.map(product => {
                            const productRecord = product as Product & Record<string, unknown>;
                            const reference = String(productRecord.sku || product.barcode || productRecord.code || '').trim();
                            return (
                                <button
                                    key={product.id}
                                    type="button"
                                    onClick={() => void handleResolvedProduct(product, scanInput.trim())}
                                    className="flex w-full items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 text-left last:border-b-0 hover:bg-blue-50"
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate font-black">{product.name}</span>
                                        <span className="block truncate text-xs font-bold text-gray-500">
                                            {product.category || 'Sin categoría'}{reference ? ` · ${reference}` : ''}
                                        </span>
                                    </span>
                                    <Plus size={20} className="shrink-0 text-blue-600" />
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Count Summary */}
            <div className="bg-white border-b border-gray-200 p-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                        <div className="text-sm font-bold text-gray-500">Productos</div>
                        <div className="text-2xl font-black text-gray-900">{counts.length}</div>
                    </div>
                    <div>
                        <div className="text-sm font-bold text-gray-500">Contados</div>
                        <div className="text-2xl font-black text-blue-600">
                            {counts.reduce((sum, c) => sum + c.countedQty, 0)}
                        </div>
                    </div>
                    <div>
                        <div className="text-sm font-bold text-gray-500">Diferencias</div>
                        <div className="text-2xl font-black text-orange-600">
                            {counts.filter(c => c.difference !== 0).length}
                        </div>
                    </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                        onClick={() => setSyncTab('PENDING')}
                        className={`rounded-lg py-1.5 text-[11px] font-black ${syncTab === 'PENDING' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}
                    >
                        Pendientes ({pendingCount})
                    </button>
                    <button
                        onClick={() => setSyncTab('CONFLICTS')}
                        className={`rounded-lg py-1.5 text-[11px] font-black ${syncTab === 'CONFLICTS' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-500'}`}
                    >
                        Conflictos ({conflicts.length})
                    </button>
                </div>
            </div>

            {/* Counted Items List */}
            <div className="flex-1 overflow-y-auto p-4">
                {counts.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="text-6xl mb-4">📦</div>
                        <p className="text-lg font-bold text-gray-400">No hay productos contados</p>
                        <p className="text-sm text-gray-400 mt-2">Escanea un código para comenzar</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {syncTab === 'CONFLICTS' && conflicts.length > 0 && (
                            <div className="space-y-2">
                                {conflicts.map((conflict) => (
                                    <div key={conflict.id} className="bg-white rounded-2xl border-2 border-red-200 p-3">
                                        <p className="text-[10px] font-black uppercase text-red-500">Conflicto de sincronización</p>
                                        <p className="text-xs font-bold text-gray-500 mt-1">
                                            Sesión: {conflict.queueItem?.payload?.sessionId || conflict.queueItem?.payload?.documentId || 'N/A'}
                                        </p>
                                        <p className="text-xs font-bold text-red-700 mt-2 bg-red-50 border border-red-200 rounded-lg p-2">
                                            {conflict.reason}
                                        </p>
                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => resolveConflict?.(conflict.id, 'OVERWRITE')}
                                                className="rounded-lg py-2 bg-blue-600 text-white text-xs font-black"
                                            >
                                                Sobrescribir
                                            </button>
                                            <button
                                                onClick={() => resolveConflict?.(conflict.id, 'CANCEL')}
                                                className="rounded-lg py-2 bg-gray-100 text-gray-700 text-xs font-black"
                                            >
                                                Cancelar
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {counts.map(item => (
                            <div
                                key={item.productId}
                                className={`bg-white rounded-2xl border-2 ${item.difference === 0
                                    ? 'border-gray-200'
                                    : 'border-orange-300 bg-orange-50'
                                    } p-4`}
                            >
                                {/* Product Name */}
                                <div className="font-bold text-gray-800 mb-3">{item.productName}</div>

                                {/* Quantity Controls */}
                                <div className="flex items-center gap-3 mb-3">
                                    <button
                                        onClick={() => adjustQty(item.productId, -1)}
                                        className="w-12 h-12 bg-gray-200 hover:bg-gray-300 rounded-xl flex items-center justify-center transition-colors"
                                    >
                                        <Minus size={20} strokeWidth={3} />
                                    </button>

                                    <div className="flex-1 text-center">
                                        <div className="text-4xl font-black text-gray-900 mb-1">
                                            {item.countedQty}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            Esperado: {item.expectedQty}
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => adjustQty(item.productId, 1)}
                                        className="w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center justify-center transition-colors"
                                    >
                                        <Plus size={20} strokeWidth={3} />
                                    </button>
                                </div>

                                {/* Difference Badge */}
                                {item.difference !== 0 && (
                                    <div className={`text-center py-2 px-4 rounded-xl font-bold text-sm ${item.difference > 0
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-red-100 text-red-700'
                                        }`}>
                                        {item.difference > 0 ? '+' : ''}{item.difference} unidades
                                    </div>
                                )}

                                {/* Remove Button */}
                                <button
                                    onClick={() => removeItem(item.productId)}
                                    className="w-full mt-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg font-bold text-sm transition-colors"
                                >
                                    Eliminar
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Save Button */}
            {counts.length > 0 && (
                <div className="p-4 bg-white border-t border-gray-200">
                    <button
                        onClick={handleSave}
                        className="w-full py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-black text-lg shadow-lg flex items-center justify-center gap-2"
                    >
                        <Save size={24} strokeWidth={2.5} />
                        Guardar Conteo ({counts.length} productos)
                    </button>
                </div>
            )}

            {/* Camera Scanner Modal */}
            <BarcodeScannerModal
                isOpen={showCameraScanner}
                onClose={() => {
                    setShowCameraScanner(false);
                    focusScannerInput();
                }}
                onScan={handleCameraScan}
            />

            {pendingScannerProduct && (
                <div className="fixed inset-0 z-[170] flex items-end justify-center bg-slate-950/55 p-4 sm:items-center">
                    <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-widest text-blue-600">Cantidad escaneada</p>
                                <h2 className="mt-1 text-lg font-black text-gray-900">{pendingScannerProduct.product.name}</h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setPendingScannerProduct(null);
                                    focusScannerInput();
                                }}
                                className="rounded-xl bg-gray-100 p-2 text-gray-500"
                                aria-label="Cerrar"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <input
                            type="number"
                            min="1"
                            max="9999"
                            step="1"
                            inputMode="numeric"
                            autoFocus
                            value={scannerQuantityInput}
                            onChange={(event) => setScannerQuantityInput(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    const pending = pendingScannerProduct;
                                    setPendingScannerProduct(null);
                                    void addProductToCount(
                                        pending.product,
                                        pending.code,
                                        normalizeInventoryScannerQuantity(scannerQuantityInput)
                                    );
                                }
                            }}
                            className="mt-5 w-full rounded-2xl border-2 border-blue-100 px-4 py-3 text-center text-3xl font-black outline-none focus:border-blue-500"
                        />
                        <button
                            type="button"
                            onClick={() => {
                                const pending = pendingScannerProduct;
                                setPendingScannerProduct(null);
                                void addProductToCount(
                                    pending.product,
                                    pending.code,
                                    normalizeInventoryScannerQuantity(scannerQuantityInput)
                                );
                            }}
                            className="mt-4 w-full rounded-2xl bg-blue-600 py-3.5 text-base font-black text-white"
                        >
                            Agregar cantidad
                        </button>
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

export default InventoryCount;
