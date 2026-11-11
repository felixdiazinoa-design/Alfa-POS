import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X, ScanBarcode, Search, Check, AlertTriangle,
  Save, RefreshCw, Plus, Minus, Camera, Zap, Clock, FileText, Calculator
} from 'lucide-react';
import { Product } from '../types';

interface InventoryAuditProps {
  products: Product[];
  warehouseId: string; // [REQUIRED]
  mode: 'ADDITIVE' | 'ABSOLUTE';
  onClose: () => void;
  onCommit: (adjustments: { productId: string; newStock: number }[]) => void | Promise<void>;
}

interface AuditItem {
  id?: string; // Backend ID
  product: Product;
  systemStock: number;
  countedStock: number;
  lastScannedAt: number;
}

interface AuditSession {
  id: string;
  startedAt: string;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
}

const InventoryAudit: React.FC<InventoryAuditProps> = ({ products, warehouseId, mode, onClose, onCommit }) => {
  // --- STATE ---
  const [session, setSession] = useState<AuditSession | null>(null);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(true);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [elapsedTime, setElapsedTime] = useState<string>('00:00:00');

  // Reconciliation Modal
  const [showReconciliationModal, setShowReconciliationModal] = useState(false);
  const [reconciliationMethod, setReconciliationMethod] = useState<'ABSOLUTE' | 'RECONCILED'>('ABSOLUTE');

  // Focus ref
  const inputRef = useRef<HTMLInputElement>(null);

  // --- INITIALIZATION ---
  useEffect(() => {
    // 1. Check for Active Session
    fetch(`/api/audit/active/${warehouseId}`)
      .then(res => res.json())
      .then(data => {
        if (data.session) {
          setSession(data.session);
          // Load items
          const loadedItems = data.items.map((i: any) => {
            const prod = products.find(p => p.id === i.productId);
            if (!prod) return null;
            return {
              id: i.id,
              product: prod,
              systemStock: i.systemQtyAtStart,
              countedStock: i.countedQty,
              lastScannedAt: new Date(i.updatedAt).getTime()
            };
          }).filter(Boolean) as AuditItem[];
          setAuditItems(loadedItems);
        } else {
          // Prompt to start? Or auto-start? 
          // User req: "Al abrir el módulo... campo Fecha/Hora de Inicio"
          // We'll auto-start or show start button. Let's auto-start for smooth UX if empty.
          startSession();
        }
      });
  }, [warehouseId]);

  useEffect(() => {
    // Timer
    if (!session?.startedAt) return;
    const interval = setInterval(() => {
      const start = new Date(session.startedAt).getTime();
      const now = Date.now();
      const diff = Math.floor((now - start) / 1000);

      const h = Math.floor(diff / 3600).toString().padStart(2, '0');
      const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
      const s = (diff % 60).toString().padStart(2, '0');
      setElapsedTime(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [session]);

  const startSession = async () => {
    try {
      const res = await fetch('/api/audit/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId })
      });
      const data = await res.json();
      if (data.success) {
        setSession({ id: data.sessionId, startedAt: data.startedAt, status: 'OPEN' });
      } else if (data.holder) {
        const holderLabel = data.holder.userName || data.holder.terminalId || 'otro equipo';
        alert(`El almacén está en conteo por ${holderLabel}.`);
      } else {
        alert('Error iniciando sesión: ' + (data.message || data.error));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveDraft = async () => {
    if (!session) return;
    setIsSubmitting(true);
    try {
      const itemsPayload = auditItems.map(item => ({
        id: item.id, // Pass ID if exists to update
        productId: item.product.id,
        countedQty: item.countedStock,
        systemQtyAtStart: item.systemStock
      }));

      await fetch(`/api/audit/${session.id}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemsPayload })
      });

      // Show small toast?
      setLastScannedCode('Borrador Guardado');
    } catch (e) {
      alert('Error guardando borrador');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- HANDLERS ---
  const handleScan = (code: string) => {
    // 1. Find Product
    const product = products.find(p =>
      p.barcode === code ||
      p.id === code ||
      p.variants?.some(v => v.sku.toLowerCase() === code.toLowerCase())
    );

    if (!product) {
      setLastScannedCode(`Desconocido: ${code}`);
      return;
    }

    // 2. Update Audit List
    setAuditItems(prev => {
      const existingIdx = prev.findIndex(item => item.product.id === product.id);

      if (existingIdx >= 0) {
        const newItems = [...prev];
        newItems[existingIdx] = {
          ...newItems[existingIdx],
          countedStock: newItems[existingIdx].countedStock + 1,
          lastScannedAt: Date.now()
        };
        const item = newItems.splice(existingIdx, 1)[0];
        return [item, ...newItems];
      } else {
        return [{
          product,
          systemStock: product.stock || 0, // Should use warehouse specific stock logic if available in prop
          countedStock: 1,
          lastScannedAt: Date.now()
        }, ...prev];
      }
    });

    setLastScannedCode(product.name);
    setSearchQuery('');
  };

  const handleManualCountChange = (productId: string, delta: number) => {
    setAuditItems(prev => prev.map(item => {
      if (item.product.id === productId) {
        return { ...item, countedStock: Math.max(0, item.countedStock + delta) };
      }
      return item;
    }));
  };

  const handleQuantityUpdate = (productId: string, newValue: number) => {
    setAuditItems(prev => prev.map(item => {
      if (item.product.id === productId) {
        return { ...item, countedStock: Math.max(0, newValue) };
      }
      return item;
    }));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (searchQuery.trim()) handleScan(searchQuery.trim());
    }
  };

  const handleCommit = async () => {
    if (!session) return;
    setIsSubmitting(true);

    // Save draft first to ensure backend has latest
    await handleSaveDraft();

    try {
      const res = await fetch(`/api/audit/${session.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: reconciliationMethod, userId: 'CURRENT_USER' })
      });
      const data = await res.json();
      if (data.success) {
        alert('Auditoría finalizada correctamente.');
        onClose();
        window.location.reload(); // Force refresh to see stock updates
      } else {
        alert('Error al finalizar: ' + data.error);
      }
    } catch (e) {
      alert('Error de red al finalizar');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- RENDER ---
  return (
    <div className="fixed inset-0 z-[100] bg-slate-900 flex flex-col md:flex-row h-screen w-screen overflow-hidden animate-in fade-in duration-200">

      {/* RECONCILIATION MODAL */}
      {showReconciliationModal && (
        <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-gray-100 bg-gray-50">
              <h3 className="text-xl font-black text-gray-800">Ajuste de Realidad</h3>
              <p className="text-sm text-gray-500">Define cómo se aplicará este inventario al sistema.</p>
            </div>
            <div className="p-6 space-y-4">
              <label className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${reconciliationMethod === 'ABSOLUTE' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input type="radio" name="method" checked={reconciliationMethod === 'ABSOLUTE'} onChange={() => setReconciliationMethod('ABSOLUTE')} className="mt-1 w-5 h-5 text-blue-600" />
                <div>
                  <span className="font-bold text-gray-800 block">Opción 1: Reemplazo Absoluto</span>
                  <p className="text-sm text-gray-600 mt-1">El stock del sistema será IGNORADO y reemplazado por lo que contaste. <br /><span className="font-bold text-red-500">Úsalo si la tienda estuvo CERRADA durante el conteo.</span></p>
                </div>
              </label>

              <label className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${reconciliationMethod === 'RECONCILED' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input type="radio" name="method" checked={reconciliationMethod === 'RECONCILED'} onChange={() => setReconciliationMethod('RECONCILED')} className="mt-1 w-5 h-5 text-purple-600" />
                <div>
                  <span className="font-bold text-gray-800 block">Opción 2: Reconciliación Inteligente</span>
                  <p className="text-sm text-gray-600 mt-1">Calcula el stock final considerando ventas y compras ocurridas <strong>desde el inicio de la auditoría ({elapsedTime} hace).</strong></p>
                  <div className="mt-2 text-xs font-mono bg-white p-2 rounded border border-purple-200 text-purple-700">
                    Nuevo_Stock = Conteo + (Entradas - Salidas)
                  </div>
                </div>
              </label>
            </div>
            <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowReconciliationModal(false)} className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-200 rounded-xl">Cancelar</button>
              <button onClick={handleCommit} disabled={isSubmitting} className="px-8 py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-black shadow-lg">
                {isSubmitting ? 'Procesando...' : 'Confirmar Ajuste'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === LEFT: SCANNER VIEW (Active Area) === */}
      <div className="w-full md:w-1/3 bg-black relative flex flex-col border-r border-slate-700">
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 p-4 z-20 flex justify-between items-start bg-gradient-to-b from-black/80 to-transparent">
          <div>
            <h2 className="text-white font-bold text-lg flex items-center gap-2">
              <ScanBarcode className="text-blue-400" /> Auditoría
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${session ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {session ? 'SESIÓN ACTIVA' : 'OFFLINE'}
              </span>
              {session && (
                <span className="text-xs font-mono text-blue-300 flex items-center gap-1">
                  <Clock size={12} /> {elapsedTime}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 bg-white/10 rounded-full text-white hover:bg-white/20">
            <X size={20} />
          </button>
        </div>

        {/* Camera Simulation Area */}
        <div className="flex-1 relative flex items-center justify-center overflow-hidden">
          {isCameraActive ? (
            <>
              {/* Fake Camera Feed Background */}
              <div className="absolute inset-0 bg-slate-800 opacity-50 animate-pulse"></div>
              {/* Viewfinder */}
              <div className="relative z-10 w-64 h-64 border-2 border-blue-500/50 rounded-3xl flex flex-col items-center justify-center shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                <div className="w-full h-0.5 bg-red-500/80 absolute top-1/2 shadow-[0_0_10px_rgba(239,68,68,0.8)] animate-[scan_2s_ease-in-out_infinite]"></div>
                <p className="mt-32 text-blue-200 font-mono text-xs opacity-80">Apunta al código</p>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center text-slate-500">
              <Camera size={48} className="mb-2 opacity-50" />
              <p>Cámara Pausada</p>
            </div>
          )}
        </div>

        {/* Manual Input Area (Bottom) */}
        <div className="p-4 bg-slate-900 border-t border-slate-800 pb-8">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escanear o escribir código..."
              className="w-full pl-12 pr-4 py-4 bg-slate-800 text-white rounded-2xl border-2 border-slate-700 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 outline-none font-mono text-lg"
              autoFocus
            />
          </div>
        </div>
      </div>

      {/* === RIGHT: LIST VIEW (Results) === */}
      <div className="w-full md:w-2/3 bg-slate-100 flex flex-col h-full">

        {/* Stats Header */}
        <div className="bg-white p-4 shadow-sm border-b border-slate-200 flex items-center justify-between z-10">
          <div className="flex gap-6">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Items Contados</p>
              <p className="text-2xl font-black text-slate-800">{auditItems.length}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Unidades Totales</p>
              <p className="text-2xl font-black text-blue-600">{auditItems.reduce((acc, i) => acc + i.countedStock, 0)}</p>
            </div>
            {/* Added: Time Elapsed explicitly here as requested */}
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tiempo</p>
              <p className="text-2xl font-black text-slate-800 font-mono">{elapsedTime}</p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSaveDraft}
              disabled={isSubmitting}
              className="px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
            >
              <FileText size={20} />
              <span className="hidden sm:inline">Guardar Borrador</span>
            </button>

            <button
              onClick={() => setShowReconciliationModal(true)}
              disabled={isSubmitting || auditItems.length === 0}
              className="px-6 py-3 bg-gray-900 text-white rounded-xl font-bold shadow-lg hover:bg-gray-800 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? <RefreshCw size={20} className="animate-spin" /> : <Save size={20} />}
              <span className="hidden sm:inline">Ajustar Stock</span>
            </button>
          </div>
        </div>

        {/* Scrollable List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {auditItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60">
              <RefreshCw size={64} className="mb-4" />
              <p className="text-xl font-medium">Esperando escaneo...</p>
              <p className="text-sm">Escanea un producto para comenzar el recuento.</p>
            </div>
          ) : (
            auditItems.map((item) => {
              const diff = item.countedStock - item.systemStock;
              const isRecent = Date.now() - item.lastScannedAt < 2000;

              return (
                <div
                  key={item.product.id}
                  className={`relative bg-white rounded-2xl p-4 shadow-sm border-2 transition-all duration-300 flex flex-col sm:flex-row gap-4 items-center ${isRecent ? 'scale-[1.02] shadow-lg ring-2 ring-blue-400 border-blue-400' : 'border-transparent'}`}
                >
                  <div className="w-16 h-16 bg-white rounded-xl overflow-hidden shrink-0 border border-slate-100">
                    <img src={item.product.image} alt={item.product.name} className="w-full h-full object-cover" />
                  </div>

                  <div className="flex-1 min-w-0 text-center sm:text-left">
                    <h4 className="font-bold text-slate-800 text-lg leading-tight truncate">{item.product.name}</h4>
                    <div className="flex flex-col justify-center sm:justify-start mt-1 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 font-mono bg-white/50 px-1.5 rounded">{item.product.barcode || 'NO-CODE'}</span>
                        <span className="text-slate-400 flex items-center gap-1">
                          Teórico Inicial: <strong>{item.systemStock}</strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 bg-white rounded-xl p-1 shadow-sm border border-slate-100">
                    <button
                      onClick={() => handleManualCountChange(item.product.id, -1)}
                      className="w-10 h-10 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 flex items-center justify-center active:scale-90 transition-transform"
                    >
                      <Minus size={20} />
                    </button>
                    <div className="w-20 text-center">
                      <input
                        type="number"
                        min="0"
                        value={item.countedStock}
                        onChange={(e) => handleQuantityUpdate(item.product.id, parseFloat(e.target.value) || 0)}
                        onFocus={(e) => e.target.select()}
                        className="w-full text-center text-2xl font-black text-slate-800 bg-transparent outline-none border-b border-transparent focus:border-blue-500 transition-colors"
                      />
                    </div>
                    <button
                      onClick={() => handleManualCountChange(item.product.id, 1)}
                      className="w-10 h-10 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center active:scale-90 transition-transform"
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default InventoryAudit;
