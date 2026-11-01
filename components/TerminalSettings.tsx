
import React, { useState, useMemo, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import {
   Database, Clock, WifiOff, X, Save, Image as ImageIcon,
   Receipt, Monitor, Plus, Trash2, Smartphone, CheckCircle2,
   ChevronRight, ChevronLeft, Settings as SettingsIcon, AlertCircle,
   LayoutGrid, ShieldCheck, Zap, Lock, ShieldAlert,
   ArrowRight, Users, FileText, Hash, Type, RotateCcw, Tag,
   DollarSign, Check, Percent, Calculator, Coins, Box, ArrowRightLeft,
   Link2Off, MonitorOff, Cloud, RefreshCw, Activity, Wifi, Server, AlertTriangle,
   Circle, CheckCircle, ChevronDown, Landmark, Link, Shield, Globe, HardDrive,
   Building2, Printer, Settings2, Info, Unlink, BarChart3, ShieldQuestion,
   ToggleLeft, ToggleRight, Radio, Power, Scale, Tv, Mail, ShoppingBag, Truck,
   Package, Layers, Crown, ListOrdered, Link2, Sparkles, Palette, MousePointer2, Banknote, ListChecks,
   // Added Sun to fix "Cannot find name 'Sun'" error
   Sun, ScanBarcode, Layout, Minus, ArrowDownCircle, ArrowUpCircle, Wallet, UserCheck, User, CreditCard, Fingerprint
} from 'lucide-react';
import { BusinessConfig, TerminalConfig, DocumentSeries, Tariff, TaxDefinition, Warehouse, NCFType, NCFConfig, Transaction, ScaleDevice, Product, DeviceRole, AuthLevel, Room } from '../types';
import { DEFAULT_DOCUMENT_SERIES, DEFAULT_TERMINAL_CONFIG } from '../constants';
import { db } from '../utils/db';
import { syncManager } from '../services/sync/SyncManager';
import { getDefaultRoleConfig, getRoleDisplayInfo, getAllModules } from '../utils/deviceRoleHelpers';
import AccessibilityToggle from './AccessibilityToggle';
import SettingsOperational from './SettingsOperational';

interface TerminalSettingsProps {
   config: BusinessConfig;
   onUpdateConfig: (newConfig: BusinessConfig) => void;
   onClose: () => void;
   warehouses?: Warehouse[];
   products?: Product[];
   isAdminMode?: boolean;
   currentDeviceId?: string;
}

const PRINTER_ROLES = [
   { id: 'TICKET', label: 'Ticket de Venta', icon: Receipt },
   { id: 'LABEL', label: 'Etiquetas', icon: Tag },
   { id: 'KITCHEN', label: 'Cocina', icon: ShoppingBag },
   { id: 'LOGISTICS', label: 'Logística', icon: Truck },
];

const DOCUMENT_ROLES = [
   // Ventas
   { id: 'TICKET', label: 'Ticket de Venta (POS)', description: 'Secuencia principal para cobros estándar.', icon: Receipt, category: 'Ventas' },
   { id: 'REFUND', label: 'Notas de Crédito (Devoluciones)', description: 'Documento legal para abonos y retornos.', icon: RotateCcw, category: 'Ventas' },
   { id: 'VOID', label: 'Anulación', description: 'Anulación de transacciones', icon: X, category: 'Ventas' },

   // Inventario
   { id: 'TRANSFER', label: 'Notas de Traspaso', description: 'Comprobantes de movimiento entre almacenes.', icon: ArrowRightLeft, category: 'Inventario' },
   { id: 'ADJUSTMENT_IN', label: 'Ajuste Positivo', description: 'Incremento de inventario', icon: Plus, category: 'Inventario' },
   { id: 'ADJUSTMENT_OUT', label: 'Ajuste Negativo', description: 'Reducción de inventario', icon: Minus, category: 'Inventario' },
   { id: 'PURCHASE', label: 'Compra a Proveedor', description: 'Entrada de mercancía', icon: ShoppingBag, category: 'Inventario' },
   { id: 'PRODUCTION', label: 'Producción/Ensamblaje', description: 'Productos manufacturados', icon: Box, category: 'Inventario' },

   // Efectivo
   { id: 'CASH_IN', label: 'Entrada de Efectivo', description: 'Ingreso de dinero a caja', icon: ArrowDownCircle, category: 'Efectivo' },
   { id: 'CASH_OUT', label: 'Salida de Efectivo', description: 'Egreso de dinero de caja', icon: ArrowUpCircle, category: 'Efectivo' },
   { id: 'CASH_DEPOSIT', label: 'Depósito Bancario', description: 'Depósito en banco', icon: Landmark, category: 'Efectivo' },
   { id: 'CASH_WITHDRAWAL', label: 'Retiro de Caja', description: 'Retiro para gastos', icon: Wallet, category: 'Efectivo' },

   // Cierres
   { id: 'Z_REPORT', label: 'Cierre de Caja (Z)', description: 'Cierre fiscal diario', icon: Lock, category: 'Cierres' },
   { id: 'X_REPORT', label: 'Corte Parcial (X)', description: 'Reporte intermedio', icon: FileText, category: 'Cierres' },

   // Cuentas
   { id: 'RECEIVABLE', label: 'Cuenta por Cobrar', description: 'Venta a crédito', icon: UserCheck, category: 'Cuentas' },
   { id: 'PAYABLE', label: 'Cuenta por Pagar', description: 'Compra a crédito', icon: User, category: 'Cuentas' },
   { id: 'PAYMENT_IN', label: 'Cobro Recibido', description: 'Pago de cliente', icon: DollarSign, category: 'Cuentas' },
   { id: 'PAYMENT_OUT', label: 'Pago Realizado', description: 'Pago a proveedor', icon: CreditCard, category: 'Cuentas' }
];

type TerminalTab = 'OPERATIONAL' | 'FISCAL' | 'SECURITY' | 'SESSION' | 'DOCUMENTS' | 'OFFLINE' | 'INVENTORY' | 'LAN_BINDING' | 'CATALOG' | 'DEVICE_ROLE';

const NCF_LABELS: Record<NCFType, string> = {
   'B01': 'Crédito Fiscal',
   'B02': 'Consumo',
   'B04': 'Nota de Crédito',
   'B14': 'Reg. Especiales',
   'B15': 'Gubernamentales'
};

const TerminalSettings: React.FC<TerminalSettingsProps> = ({ config, onUpdateConfig, onClose, warehouses = [], products = [], isAdminMode = false, currentDeviceId }) => {
   const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
   // ... existing state ...
   const [terminals, setTerminals] = useState(config.terminals || []);

   // Auto-select current terminal if available
   const [selectedTerminalId, setSelectedTerminalId] = useState<string>(() => {
      if (currentDeviceId) {
         const current = terminals.find(t => t.config.currentDeviceId === currentDeviceId);
         if (current) return current.id;
      }
      return terminals[0]?.id || '';
   });

   const [activeTab, setActiveTab] = useState<TerminalTab>('OPERATIONAL');
   const [showConflictModal, setShowConflictModal] = useState<string | null>(null);
   const [editingSequence, setEditingSequence] = useState<any>(null);

   // Cargar secuencias maestras  // Master Sequences (from DB)
   const [masterSequences, setMasterSequences] = useState<DocumentSeries[]>([]);
   const [isSyncing, setIsSyncing] = useState(false);
   const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
   const [allRooms, setAllRooms] = useState<Room[]>([]);

   useEffect(() => {
      const loadSequences = async () => {
         const seqs = (await db.get('internalSequences') || []) as DocumentSeries[];
         const configSeries = (config.terminals || [])
            .flatMap(t => (Array.isArray(t.config?.documentSeries) ? t.config.documentSeries : []))
            .filter((s: any) => !!s?.id && !!s?.documentType) as DocumentSeries[];

         // Keep internalSequences as canonical source, but backfill missing IDs from terminal-level config.
         const mergedMap = new Map<string, DocumentSeries>();
         seqs.forEach(s => {
            if (!s?.id || !s?.documentType) return;
            mergedMap.set(s.id, s);
         });
         configSeries.forEach(s => {
            if (!mergedMap.has(s.id)) {
               mergedMap.set(s.id, s);
            }
         });

         const merged = Array.from(mergedMap.values());
         if (merged.length !== seqs.length) {
            await db.save('internalSequences', merged);
         }

         setMasterSequences(merged);

         const rooms = (await db.get('rooms') || []) as Room[];
         setAllRooms(rooms);
      };
      loadSequences();

      // Listen for series updates from other terminals
      const handleSeriesUpdate = () => {
         loadSequences();
         console.log('📥 Terminal settings - Series refreshed from sync');
      };

      window.addEventListener('seriesUpdated', handleSeriesUpdate);

      return () => {
         window.removeEventListener('seriesUpdated', handleSeriesUpdate);
      };
   }, [config.terminals]);

   const activeTerminal = useMemo(() =>
      terminals.find(t => t.id === selectedTerminalId),
      [terminals, selectedTerminalId]);

   const isReadOnly = useMemo(() => {
      if (!activeTerminal) return false;
      // Si la terminal está gobernada por la maestra Y estamos físicamente en esa terminal Y no es la maestra
      return activeTerminal.config.governedByMaster &&
         activeTerminal.config.currentDeviceId === currentDeviceId &&
         !activeTerminal.config.isPrimaryNode;
   }, [activeTerminal, currentDeviceId]);

   const allCategories = useMemo(() => {
      return Array.from(new Set(products.map(p => p.category))).sort();
   }, [products]);

   const handleSyncSeries = async () => {
      setIsSyncing(true);
      try {
         // Force a network pull from Master
         console.log('📡 TerminalSettings: Triggering network pull for internalSequences...');
         await syncManager.pullCatalog('internalSequences');

         // The event 'seriesUpdated' will be dispatched by pullCatalog, 
         // but we also reload locally just in case.
         const seqs = (await db.get('internalSequences') || []) as DocumentSeries[];
         setMasterSequences(seqs);
         setLastSyncTime(new Date());
         console.log(`✅ Sincronizadas ${seqs.length} series de documentos (Red + Local)`);
      } catch (error) {
         console.error('Error syncing series:', error);
      } finally {
         setIsSyncing(false);
      }
   };

   const handleUpdateActiveConfig = (sectionPath: string, key: string, value: any) => {
      if (!activeTerminal) return;

      setTerminals(prev => prev.map(t => {
         if (t.id === selectedTerminalId) {
            const newConfig = JSON.parse(JSON.stringify(t.config));

            if (!sectionPath) {
               newConfig[key] = value;
            } else {
               const parts = sectionPath.split('.');
               let current: any = newConfig;
               for (let i = 0; i < parts.length; i++) {
                  if (!current[parts[i]]) current[parts[i]] = {};
                  if (i === parts.length - 1) {
                     current[parts[i]][key] = value;
                  } else {
                     current = current[parts[i]];
                  }
               }
            }
            return { ...t, config: newConfig };
         }
         return t;
      }));
   };

   // ... existing handlers ...
   const handleAssignSequence = (roleId: string, sequenceId: string) => {
      if (!activeTerminal) return;

      const currentAssignments = activeTerminal.config.documentAssignments || {};
      const newAssignments = { ...currentAssignments, [roleId]: sequenceId };

      // 1. Find the master series object
      const startSeries = masterSequences.find(s => s.id === sequenceId);

      const newDocumentSeries = [...(activeTerminal.config.documentSeries || [])];

      if (sequenceId && startSeries) {
         // Check if this specific series is already in the terminal config
         const existingIndex = newDocumentSeries.findIndex(s => s.id === sequenceId);

         if (existingIndex >= 0) {
            // Update existing just in case master changed
            newDocumentSeries[existingIndex] = startSeries;
         } else {
            // Add new series definition
            newDocumentSeries.push(startSeries);
         }
      }

      // Update both the assignment map AND the local series definition array
      setTerminals(prev => prev.map(t => {
         if (t.id === selectedTerminalId) {
            return {
               ...t,
               config: {
                  ...t.config,
                  documentAssignments: newAssignments,
                  documentSeries: newDocumentSeries
               }
            };
         }
         return t;
      }));
   };

   const handleToggleMasterNode = (enabled: boolean) => {
      if (!activeTerminal) return;

      if (enabled) {
         const currentMaster = terminals.find(t => t.config.isPrimaryNode && t.id !== activeTerminal.id);
         if (currentMaster) {
            setShowConflictModal(currentMaster.id);
            return;
         }
      }

      setTerminals(prev => prev.map(t => ({
         ...t,
         config: {
            ...t.config,
            isPrimaryNode: t.id === activeTerminal.id ? enabled : (enabled ? false : t.config.isPrimaryNode)
         }
      })));
   };

   const confirmMasterTransfer = () => {
      if (!activeTerminal) return;
      setTerminals(prev => prev.map(t => ({
         ...t,
         config: {
            ...t.config,
            isPrimaryNode: t.id === activeTerminal.id
         }
      })));
      setShowConflictModal(null);
   };

   const handleSaveSequence = async () => {
      if (!editingSequence) return;

      const updated = { ...masterSequences, [editingSequence.key]: editingSequence.value };
      setMasterSequences(updated);
      await db.save('internalSequences', updated);
      setEditingSequence(null);
   };

   const handleAddTerminal = () => {
      const terminalNumber = terminals.length + 1;
      const nextId = `t${terminalNumber}`;

      const newConfig = JSON.parse(JSON.stringify(DEFAULT_TERMINAL_CONFIG));

      // Por defecto asignamos las secuencias básicas si existen
      newConfig.documentAssignments = {
         'TICKET': 'TICKET',
         'REFUND': 'REFUND',
         'TRANSFER': 'TRANSFER'
      };

      const newTerminal = {
         id: nextId,
         config: newConfig
      };

      setTerminals([...terminals, newTerminal]);
      setSelectedTerminalId(nextId);
   };

   const handleSave = () => {
      onUpdateConfig({ ...config, terminals: terminals });
      alert("Configuraciones de terminales guardadas correctamente.");
      onClose();
   };

   const Toggle = ({ label, description, checked, onChange, danger = false, icon: Icon, disabled = false }: any) => (
      <div
         onClick={() => !disabled && onChange(!checked)}
         className={`p-5 rounded-2xl border-2 flex justify-between items-center transition-all group ${disabled ? 'opacity-60 cursor-not-allowed bg-gray-50 border-gray-100' : 'cursor-pointer'} ${checked ? (danger ? 'bg-red-50 border-red-500 shadow-sm' : 'bg-blue-50 border-blue-500 shadow-sm') : 'bg-white border-gray-100 hover:border-gray-300'}`}
      >
         <div className="flex items-start gap-4 flex-1 pr-4">
            {Icon && <div className={`p-2 rounded-lg shrink-0 ${checked ? (danger ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600') : 'bg-gray-100 text-gray-400'}`}><Icon size={20} /></div>}
            <div>
               <h4 className={`font-bold text-sm ${checked ? (danger ? 'text-red-700' : 'text-blue-700') : 'text-gray-700 group-hover:text-gray-900'}`}>{label}</h4>
               <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{description}</p>
            </div>
         </div>
         <div className={`w-12 h-6 rounded-full relative transition-colors shrink-0 ${checked ? (danger ? 'bg-red-500' : 'bg-blue-600') : 'bg-gray-300'}`}>
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-300 ${checked ? 'left-7' : 'left-1'}`} />
         </div>
      </div>
   );

   return (
      <div
         className={`responsive-shell flex h-full bg-gray-50 animate-in fade-in overflow-hidden relative ${isNativeAndroid ? 'flex-col' : 'flex-col lg:flex-row'}`}
         style={isNativeAndroid ? { height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } : undefined}
      >
         {/* ADMIN MODE BANNER */}
         {isAdminMode && (
            <div className="absolute top-0 left-0 right-0 bg-red-600 text-white text-center py-2 text-sm font-bold z-50 shadow-md flex items-center justify-center gap-2 animate-pulse">
               <ShieldCheck size={16} />
               MODO ADMINISTRADOR ACTIVO - ACCESO TOTAL
            </div>
         )}

         {/* SIDEBAR */}
         <aside className={`bg-white border-gray-200 flex flex-col shrink-0 z-20 shadow-sm ${isNativeAndroid ? 'w-full border-b max-h-none' : 'w-full lg:w-80 lg:max-w-[320px] border-b lg:border-b-0 lg:border-r max-h-[42vh] lg:max-h-none'}`}>
            <div className="p-4 md:p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
               <div>
                  <h2 className="text-xl font-black text-slate-800">Terminales</h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Configuración técnica</p>
               </div>
               <button
                  onClick={handleAddTerminal}
                  className="p-2 bg-blue-600 text-white rounded-xl shadow-lg hover:bg-blue-700 active:scale-95 transition-all"
               >
                  <Plus size={20} />
               </button>
            </div>
            <div
               className={`flex-1 p-4 no-scrollbar ${isNativeAndroid ? 'overflow-x-auto overflow-y-hidden' : 'overflow-x-auto lg:overflow-y-auto'}`}
               style={isNativeAndroid ? { WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' } : undefined}
            >
               <div className={`flex gap-3 ${isNativeAndroid ? 'min-w-max flex-row' : 'lg:flex-col lg:gap-2 min-w-max lg:min-w-0'}`}>
               {terminals.map((t) => (
                  <div key={t.id} onClick={() => setSelectedTerminalId(t.id)} className={`group p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between ${isNativeAndroid ? 'min-w-[220px]' : 'min-w-[220px] lg:min-w-0 lg:w-full'} ${selectedTerminalId === t.id ? 'bg-blue-50 border-blue-500 shadow-md ring-4 ring-blue-50' : 'bg-white border-transparent hover:border-gray-200'}`}>
                     <div className="flex items-center gap-3 min-w-0">
                        <div className={`p-2.5 rounded-xl shrink-0 ${selectedTerminalId === t.id ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-100 text-gray-400'}`}><Monitor size={20} /></div>
                        <div className="min-w-0">
                           <h3 className={`font-bold text-sm truncate ${selectedTerminalId === t.id ? 'text-blue-900' : 'text-gray-700'}`}>{t.id}</h3>
                           {t.config.isPrimaryNode && (
                              <span className="flex items-center gap-1 text-[9px] font-black text-blue-600 uppercase tracking-widest mt-0.5">
                                 <Crown size={10} /> Master
                              </span>
                           )}
                        </div>
                     </div>
                     {selectedTerminalId === t.id && <ChevronRight size={16} className="text-blue-500" />}
                  </div>
               ))}
               </div>
            </div>
         </aside>

         {/* MAIN AREA */}
         <div className="responsive-content flex-1 flex flex-col min-w-0 h-full">
            <header className={`bg-white px-4 md:px-8 py-4 md:py-5 border-b border-gray-200 flex flex-col gap-4 shrink-0 z-10 ${isNativeAndroid ? '' : 'lg:flex-row lg:justify-between lg:items-center'}`}>
               <h2 className="text-xl md:text-2xl font-black text-gray-800 flex items-center gap-3 min-w-0"><SettingsIcon className="text-blue-600 shrink-0" /> <span className="truncate">Terminal: <span className="text-blue-600">{selectedTerminalId}</span></span></h2>
               <div className={`flex w-full gap-3 ${isNativeAndroid ? '' : 'lg:w-auto'}`}>
                  <button onClick={handleSave} className="flex-1 justify-center px-5 md:px-8 py-3 bg-blue-600 text-white rounded-xl font-bold flex items-center gap-2 shadow-xl hover:bg-blue-700 transition-all"><Save size={20} /> Guardar Cambios</button>
                  <button onClick={onClose} className="p-3 bg-gray-100 text-gray-500 hover:bg-gray-200 rounded-xl transition-colors shrink-0"><X size={20} /></button>
               </div>
            </header>

            {/* TABS NAVIGATION */}
            <div className="relative bg-white border-b border-gray-100 shrink-0 overflow-hidden px-4 md:px-6">
               <div className="mobile-tab-scroller no-scrollbar -mx-4 px-4 md:mx-0 md:px-0" style={{ overflowX: 'scroll', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }}>
               {[
                  { id: 'OPERATIONAL', label: 'Operativa', icon: Database },
                  { id: 'FISCAL', label: 'Lotes Fiscales', icon: Landmark },
                  { id: 'CATALOG', label: 'Catálogo', icon: ShoppingBag },
                  { id: 'DEVICE_ROLE', label: 'Tipo de Terminal', icon: Smartphone },
                  { id: 'DOCUMENTS', label: 'Series / Documentos', icon: Link2 },
                  { id: 'INVENTORY', label: 'Almacenes', icon: Box },
                  { id: 'SECURITY', label: 'Seguridad', icon: ShieldAlert },
                  { id: 'SESSION', label: 'Sesión y Z', icon: Clock },
                  { id: 'OFFLINE', label: 'Conexión', icon: Cloud },
                  { id: 'LAN_BINDING', label: 'Red Local', icon: Server },
               ].map(tab => (
                  <button
                     key={tab.id}
                     onClick={() => setActiveTab(tab.id as TerminalTab)}
                     className={`mobile-tab-item pb-4 pt-4 text-sm font-bold flex items-center gap-2 border-b-4 transition-all ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                  >
                     <tab.icon size={18} /> {tab.label}
                  </button>
               ))}
               </div>
            </div>

            {/* TAB CONTENT */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-50/50 custom-scrollbar" style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
               {activeTerminal ? (
                  <div className="w-full max-w-4xl mx-auto space-y-6 md:space-y-8 animate-in slide-in-from-right-4">

                     {/* CATALOG SECTION */}
                     {activeTab === 'CATALOG' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4">
                           <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm">
                              <h3 className="text-xl font-black text-gray-800 mb-6 flex items-center gap-2">
                                 <ShoppingBag size={24} className="text-blue-600" /> Visibilidad de Catálogo
                              </h3>
                              <p className="text-sm text-gray-500 mb-8">Selecciona qué categorías de productos estarán disponibles para la venta en esta terminal. Si no seleccionas ninguna, se mostrarán todas.</p>

                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                 {allCategories.map(cat => {
                                    const isSelected = activeTerminal.config.catalog?.allowedCategories?.includes(cat);
                                    return (
                                       <button
                                          key={cat}
                                          onClick={() => {
                                             const current = activeTerminal.config.catalog?.allowedCategories || [];
                                             const updated = isSelected
                                                ? current.filter(c => c !== cat)
                                                : [...current, cat];
                                             handleUpdateActiveConfig('catalog', 'allowedCategories', updated);
                                          }}
                                          className={`p-4 rounded-2xl border-2 text-left transition-all ${isSelected ? 'bg-blue-50 border-blue-500 shadow-sm' : 'bg-white border-gray-100 hover:border-gray-200'} ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                          disabled={isReadOnly}
                                       >
                                          <div className={`w-6 h-6 rounded-full flex items-center justify-center mb-3 ${isSelected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-300'}`}>
                                             {isSelected ? <Check size={14} strokeWidth={3} /> : <div className="w-2 h-2 bg-gray-300 rounded-full" />}
                                          </div>
                                          <span className={`font-bold text-sm block truncate ${isSelected ? 'text-blue-900' : 'text-gray-600'}`}>{cat}</span>
                                       </button>
                                    );
                                 })}
                              </div>

                              <div className="mt-8 p-4 bg-blue-50 rounded-xl border border-blue-100 flex items-start gap-3">
                                 <Info size={20} className="text-blue-600 shrink-0 mt-0.5" />
                                 <div>
                                    <h4 className="font-bold text-blue-900 text-sm">Nota sobre el alcance</h4>
                                    <p className="text-xs text-blue-700 mt-1">Esta configuración solo afecta la visibilidad en la pantalla de ventas (POS). No impide que un administrador vea estos productos en el inventario o reportes.</p>
                                 </div>
                              </div>
                           </div>
                        </div>
                     )}

                     {/* DEVICE_ROLE SECTION */}
                     {activeTab === 'DEVICE_ROLE' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4">
                           <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-8 rounded-3xl border-2 border-blue-200 shadow-sm">
                              <h3 className="text-2xl font-black text-gray-800 mb-2 flex items-center gap-2">
                                 <Smartphone size={28} className="text-blue-600" /> Tipo de Terminal
                              </h3>
                              <p className="text-sm text-gray-600 mb-8">Configura el rol de esta terminal para adaptar la interfaz y funcionalidades según su propósito.</p>

                              {/* Role Selector */}
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                                 {[DeviceRole.STANDARD_POS, DeviceRole.SELF_CHECKOUT, DeviceRole.PRICE_CHECKER, DeviceRole.HANDHELD_INVENTORY, DeviceRole.KITCHEN_DISPLAY].map(role => {
                                    const currentRole = activeTerminal.config.deviceRole?.role || DeviceRole.STANDARD_POS;
                                    const isSelected = currentRole === role;
                                    const info = getRoleDisplayInfo(role);

                                    return (
                                       <button
                                          key={role}
                                          onClick={() => {
                                             const defaultConfig = getDefaultRoleConfig(role);
                                             // Save the entire DeviceRoleConfig object to deviceRole key
                                             handleUpdateActiveConfig('', 'deviceRole', defaultConfig);
                                          }}
                                          className={`p-6 rounded-2xl border-2 text-left transition-all ${isSelected
                                             ? 'bg-blue-600 border-blue-600 shadow-lg scale-105'
                                             : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow-md'
                                             } ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                          disabled={isReadOnly}
                                       >
                                          <div className="flex items-start justify-between mb-3">
                                             <span className="text-4xl">{info.icon}</span>
                                             {isSelected && (
                                                <div className="bg-white/20 backdrop-blur-sm p-2 rounded-full">
                                                   <Check size={16} className="text-white" strokeWidth={3} />
                                                </div>
                                             )}
                                          </div>
                                          <h4 className={`font-black text-base mb-1 ${isSelected ? 'text-white' : 'text-gray-800'}`}>
                                             {info.label}
                                          </h4>
                                          <p className={`text-xs ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>
                                             {info.description}
                                          </p>
                                       </button>
                                    );
                                 })}
                              </div>

                              {/* Configuration Details */}
                              {activeTerminal.config.deviceRole && (
                                 <div className="space-y-6 bg-white p-6 rounded-2xl border border-gray-200">
                                    {/* Auth Level Display */}
                                    <div>
                                       <label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-3">
                                          Nivel de Autenticación
                                       </label>
                                       <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm ${activeTerminal.config.deviceRole.authLevel === AuthLevel.HEADLESS
                                          ? 'bg-green-100 text-green-700'
                                          : 'bg-orange-100 text-orange-700'
                                          }`}>
                                          {activeTerminal.config.deviceRole.authLevel === AuthLevel.HEADLESS ? '🤖 Automático (Sin Login)' : '👤 Requiere Usuario'}
                                       </div>
                                    </div>

                                    {/* Allowed Modules */}
                                    <div>
                                       <label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-3">
                                          Módulos Permitidos
                                       </label>
                                       <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                          {getAllModules().map(module => {
                                             const isAllowed = activeTerminal.config.deviceRole!.allowedModules.includes(module.value) ||
                                                activeTerminal.config.deviceRole!.allowedModules.includes('*');
                                             return (
                                                <div
                                                   key={module.value}
                                                   className={`p-3 rounded-xl border text-sm ${isAllowed
                                                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                                                      : 'bg-gray-50 border-gray-200 text-gray-400'
                                                      }`}
                                                >
                                                   <div className="flex items-center gap-2">
                                                      {isAllowed ? <Check size={14} strokeWidth={3} /> : <Minus size={14} />}
                                                      <span className="font-bold text-xs">{module.label}</span>
                                                   </div>
                                                </div>
                                             );
                                          })}
                                       </div>
                                    </div>

                                    {/* Escape Hatch Config (for kiosk modes) */}
                                    {activeTerminal.config.deviceRole.uiSettings.escapeHatch?.enabled && (
                                       <div className="bg-orange-50 p-6 rounded-2xl border border-orange-200">
                                          <h4 className="font-black text-gray-800 mb-4 flex items-center gap-2">
                                             <Lock size={20} className="text-orange-600" />
                                             Escape Hatch (Acceso Admin)
                                          </h4>
                                          <div className="space-y-4">
                                             <div>
                                                <label className="block text-xs font-bold text-gray-600 mb-2">
                                                   PIN de Administrador
                                                </label>
                                                <input
                                                   type="password"
                                                   maxLength={6}
                                                   value={activeTerminal.config.deviceRole.uiSettings.escapeHatch.adminPin || ''}
                                                   onChange={(e) => {
                                                      const currentEscape = activeTerminal.config.deviceRole!.uiSettings.escapeHatch!;
                                                      handleUpdateActiveConfig('deviceRole', 'uiSettings', {
                                                         ...activeTerminal.config.deviceRole!.uiSettings,
                                                         escapeHatch: {
                                                            ...currentEscape,
                                                            adminPin: e.target.value
                                                         }
                                                      });
                                                   }}
                                                   placeholder="Ej: 1234"
                                                   className={`w-full px-4 py-3 bg-white border border-gray-200 rounded-xl font-mono font-bold text-gray-700 outline-none focus:ring-2 focus:ring-orange-500 ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                                   disabled={isReadOnly}
                                                />
                                                <p className="text-xs text-gray-500 mt-2">
                                                   Para salir del modo kiosco, mantén presionado el logo por 5 segundos e ingresa este PIN
                                                </p>
                                             </div>
                                          </div>
                                       </div>
                                    )}

                                    {/* UI Settings Info */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                       <div className="p-4 bg-gray-50 rounded-xl">
                                          <div className="text-xs font-bold text-gray-500 mb-1">Pantalla Completa</div>
                                          <div className="text-lg font-black text-gray-800">
                                             {activeTerminal.config.deviceRole.uiSettings.fullscreenForced ? '✅ Sí' : '❌ No'}
                                          </div>
                                       </div>
                                       <div className="p-4 bg-gray-50 rounded-xl">
                                          <div className="text-xs font-bold text-gray-500 mb-1">Touch Target</div>
                                          <div className="text-lg font-black text-gray-800">
                                             {activeTerminal.config.deviceRole.uiSettings.touchTargetSize}px
                                          </div>
                                       </div>
                                       <div className="p-4 bg-gray-50 rounded-xl">
                                          <div className="text-xs font-bold text-gray-500 mb-1">Nav Bloqueada</div>
                                          <div className="text-lg font-black text-gray-800">
                                             {activeTerminal.config.deviceRole.uiSettings.navigationLocked ? '🔒 Sí' : '🔓 No'}
                                          </div>
                                       </div>
                                       <div className="p-4 bg-gray-50 rounded-xl">
                                          <div className="text-xs font-bold text-gray-500 mb-1">Impresora</div>
                                          <div className="text-lg font-black text-gray-800">
                                             {activeTerminal.config.deviceRole.hardwareConfig?.disablePrinter ? '❌ No' : '✅ Sí'}
                                          </div>
                                       </div>
                                    </div>
                                 </div>
                              )}

                              {/* Info Alert */}
                              <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-100 flex items-start gap-3">
                                 <Info size={20} className="text-blue-600 shrink-0 mt-0.5" />
                                 <div>
                                    <h4 className="font-bold text-blue-900 text-sm">Reinicio Requerido</h4>
                                    <p className="text-xs text-blue-700 mt-1">
                                       Los cambios en el tipo de terminal se aplicarán después de recargar la página. Las terminales headless (Auto-Pago, Verificador de Precios, Cocina) no requieren login de usuario.
                                    </p>
                                 </div>
                              </div>
                           </div>
                        </div>
                     )}

                     {/* LAN BINDING SECTION */}
                     {activeTab === 'LAN_BINDING' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4">
                           <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm">
                              <h3 className="text-xl font-black text-gray-800 mb-6 flex items-center gap-2">
                                 <Server size={24} className="text-blue-600" /> Vinculación de Red Local (LAN)
                              </h3>
                              <p className="text-sm text-gray-500 mb-8">Configura la topología de red para permitir comunicación directa entre terminales en la misma red Wi-Fi/Ethernet.</p>

                              {activeTerminal.config.isPrimaryNode ? (
                                 <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-6 flex flex-col items-center text-center">
                                    <div className="p-4 bg-white rounded-full shadow-sm mb-4">
                                       <Crown size={32} className="text-blue-600" />
                                    </div>
                                    <h4 className="text-lg font-black text-blue-900 mb-2">Nodo Maestro Local</h4>
                                    <p className="text-sm text-blue-700 max-w-md mx-auto mb-6">
                                       Esta terminal actúa como el servidor local para este entorno. Las demás terminales deben apuntar a la dirección IP de este dispositivo.
                                    </p>
                                    <div className="bg-white px-6 py-3 rounded-xl border border-blue-100 shadow-sm">
                                       <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">Store ID</span>
                                       <span className="font-mono font-black text-xl text-gray-800">STORE-{config.companyInfo?.rnc || '001'}</span>
                                    </div>
                                 </div>
                              ) : (
                                 <div className="space-y-6">
                                    <div className="bg-gray-50 p-6 rounded-2xl border border-gray-200">
                                       <label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-2">IP del Nodo Maestro (Local)</label>
                                       <div className="flex gap-3">
                                          <div className="relative flex-1">
                                             <input
                                                type="text"
                                                placeholder="Ej: 192.168.0.50"
                                                defaultValue={localStorage.getItem('pos_master_ip') || ''}
                                                id="master-ip-input"
                                                className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl font-mono font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                             />
                                             <Server className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                          </div>
                                          <button
                                             onClick={async () => {
                                                const ip = (document.getElementById('master-ip-input') as HTMLInputElement).value;
                                                if (!ip) return alert("Ingrese una IP válida");

                                                const btn = document.getElementById('test-conn-btn');
                                                if (btn) btn.innerText = 'Verificando...';

                                                // SIMULATED HANDSHAKE
                                                setTimeout(() => {
                                                   localStorage.setItem('pos_master_ip', ip);
                                                   if (btn) {
                                                      btn.innerText = 'Conexión Exitosa';
                                                      btn.className = "px-6 py-3 bg-emerald-500 text-white rounded-xl font-bold shadow-lg transition-all flex items-center gap-2";
                                                   }
                                                   alert(`✅ Conexión Establecida con ${ip}\nLatencia: 5ms\nStore ID: STORE-001 (Coincide)`);
                                                }, 1500);
                                             }}
                                             id="test-conn-btn"
                                             className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg transition-all flex items-center gap-2"
                                          >
                                             <Activity size={18} /> Probar Conexión LAN
                                          </button>
                                       </div>
                                       <p className="text-[11px] text-gray-400 mt-2 ml-1">
                                          Ingrese la dirección IP fija de la terminal principal en esta red.
                                       </p>
                                    </div>
                                 </div>
                              )}
                           </div>
                        </div>
                     )}

                     {/* 1. OPERATIONAL SECTION */}
                     {
                        activeTab === 'OPERATIONAL' && (
                           <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                              {/* Network Identity (Master/Slave) */}
                              <div className="bg-indigo-50/50 border-2 border-indigo-100 p-8 rounded-[2.5rem] shadow-sm space-y-4">
                                 <h3 className="text-lg font-black flex items-center gap-2 text-indigo-800"><Server size={24} /> Identidad de Red</h3>
                                 <Toggle
                                    label="Es Terminal Principal / Servidor Local"
                                    description="Esta terminal consolidará los cierres y transacciones de la tienda."
                                    checked={activeTerminal.config.isPrimaryNode}
                                    onChange={handleToggleMasterNode}
                                    icon={Crown}
                                    disabled={activeTerminal.config.governedByMaster || isReadOnly}
                                 />

                                 {!activeTerminal.config.isPrimaryNode && (
                                    <Toggle
                                       label="Gobernado por Maestra"
                                       description="Esta terminal seguirá estrictamente la configuración definida por la Maestra."
                                       checked={activeTerminal.config.governedByMaster}
                                       onChange={(v: boolean) => handleUpdateActiveConfig('', 'governedByMaster', v)}
                                       icon={ShieldCheck}
                                       disabled={isReadOnly}
                                    />
                                 )}

                                 <p className="text-[10px] font-bold text-indigo-410 uppercase tracking-widest ml-2">
                                    Nota: Solo puede haber una terminal principal por establecimiento.
                                 </p>
                              </div>

                              <SettingsOperational
                                 config={activeTerminal.config}
                                 onUpdate={handleUpdateActiveConfig}
                                 isReadOnly={isReadOnly}
                              />

                              {activeTerminal.config.operational?.usa_mesas && (
                                 <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-8 animate-in slide-in-from-top-4 duration-300">
                                    <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><Layout size={24} className="text-emerald-600" /> Salas Visibles</h3>
                                    <p className="text-sm text-gray-500 font-medium leading-relaxed">Configura qué áreas son accesibles desde esta terminal específica (ej: Barra, Terraza, VIP).</p>
                                    <div className="flex flex-wrap gap-2">
                                       {allRooms.map(room => {
                                          const visibility = (activeTerminal.config as any).tables?.visibility || [];
                                          const isVisible = visibility.includes(room.id);
                                          return (
                                             <button
                                                key={room.id}
                                                onClick={() => {
                                                   const currentVisibility = (activeTerminal.config as any).tables?.visibility || [];
                                                   const updated = isVisible
                                                      ? currentVisibility.filter((id: string) => id !== room.id)
                                                      : [...currentVisibility, room.id];

                                                   handleUpdateActiveConfig('tables', 'visibility', updated);
                                                }}
                                                className={`px-4 py-3 rounded-2xl text-sm font-bold border-2 transition-all flex items-center gap-3 ${isVisible ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm' : 'bg-white border-slate-100 text-slate-400'} ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                                disabled={isReadOnly}
                                             >
                                                <div className={`w-5 h-5 rounded-md flex items-center justify-center ${isVisible ? 'bg-emerald-500 text-white shadow-inner' : 'bg-gray-100'}`}>
                                                   {isVisible && <Check size={12} strokeWidth={4} />}
                                                </div>
                                                {room.name || room.nombre}
                                             </button>
                                          );
                                       })}
                                       {allRooms.length === 0 && (
                                          <div className="p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center w-full">
                                             <span className="text-xs text-slate-400 font-bold">No hay salas configuradas en el sistema</span>
                                          </div>
                                       )}
                                    </div>
                                 </div>
                              )}

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                 <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
                                    <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><Tag size={24} className="text-purple-600" /> Precios y Tarifas</h3>
                                    <div className="space-y-6">
                                       <div>
                                          <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Tarifa Predeterminada</label>
                                          <select
                                             value={activeTerminal.config.pricing.defaultTariffId}
                                             onChange={(e) => handleUpdateActiveConfig('pricing', 'defaultTariffId', e.target.value)}
                                             disabled={isReadOnly}
                                             className={`w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-purple-100 transition-all ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                          >
                                             {config.tariffs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                          </select>
                                       </div>
                                       <div>
                                          <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Tarifas Autorizadas</label>
                                          <div className="flex flex-wrap gap-2 mt-2">
                                             {config.tariffs.map(t => {
                                                const isAllowed = activeTerminal.config.pricing.allowedTariffIds.includes(t.id);
                                                return (
                                                   <button
                                                      key={t.id}
                                                      onClick={() => {
                                                         const current = activeTerminal.config.pricing.allowedTariffIds;
                                                         const updated = isAllowed ? current.filter(id => id !== t.id) : [...current, t.id];
                                                         handleUpdateActiveConfig('pricing', 'allowedTariffIds', updated);
                                                      }}
                                                      className={`px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${isAllowed ? 'bg-purple-600 border-purple-600 text-white shadow-md' : 'bg-white border-slate-100 text-slate-400'} ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                                      disabled={isReadOnly}
                                                   >
                                                      {t.name}
                                                   </button>
                                                )
                                             })}
                                          </div>
                                       </div>
                                    </div>
                                 </div>

                                 <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
                                    <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><MousePointer2 size={24} className="text-blue-600" /> UX</h3>
                                    <div className="space-y-4">
                                       <Toggle
                                          label="Imágenes de Productos"
                                          description="Visualiza miniaturas en el POS."
                                          checked={activeTerminal.config.ux.showProductImages}
                                          onChange={(v: boolean) => handleUpdateActiveConfig('ux', 'showProductImages', v)}
                                          icon={ImageIcon}
                                          disabled={isReadOnly}
                                       />
                                       <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 flex justify-between items-center h-[72px]">
                                          <div className="flex flex-col">
                                             <span className="font-bold text-gray-700 text-sm">Alto Contraste</span>
                                          </div>
                                          <AccessibilityToggle showLabel={false} />
                                       </div>
                                       <div>
                                          <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Densidad</label>
                                          <div className="flex bg-slate-100 p-1 rounded-2xl">
                                             <button
                                                onClick={() => handleUpdateActiveConfig('ux', 'gridDensity', 'COMFORTABLE')}
                                                disabled={isReadOnly}
                                                className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${activeTerminal.config.ux.gridDensity === 'COMFORTABLE' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'} ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                             >
                                                Cómoda
                                             </button>
                                             <button
                                                onClick={() => handleUpdateActiveConfig('ux', 'gridDensity', 'COMPACT')}
                                                disabled={isReadOnly}
                                                className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all ${activeTerminal.config.ux.gridDensity === 'COMPACT' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'} ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                             >
                                                Compacta
                                             </button>
                                          </div>
                                       </div>
                                    </div>
                                 </div>
                              </div>

                              <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-8">
                                 <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><HardDrive size={24} className="text-indigo-600" /> Hardware Asignado</h3>
                                 <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    {PRINTER_ROLES.map(role => (
                                       <div key={role.id} className="p-4 bg-slate-50 rounded-2xl border space-y-2 transition-all hover:bg-white hover:border-indigo-200">
                                          <div className="flex items-center gap-2 text-slate-600"><role.icon size={16} /><span className="text-xs font-bold uppercase">{role.label}</span></div>
                                          <select
                                             value={activeTerminal.config.hardware?.printerAssignments?.[role.id] || ''}
                                             onChange={(e) => {
                                                const current = activeTerminal.config.hardware?.printerAssignments || {};
                                                handleUpdateActiveConfig('hardware', 'printerAssignments', { ...current, [role.id]: e.target.value });
                                             }}
                                             className="w-full p-2 bg-white border rounded-lg font-bold text-[10px] outline-none"
                                          >
                                             <option value="">-- No asignada --</option>
                                             {(config.availablePrinters || []).map(p => <option key={p.id} value={p.id}>{p.name} ({p.connection})</option>)}
                                          </select>
                                       </div>
                                    ))}
                                 </div>
                              </div>

                              <div className="bg-white p-8 rounded-3xl border shadow-sm space-y-8">
                                 <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><Calculator size={24} className="text-emerald-600" /> Criterios Financieros</h3>
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-4">
                                       <Toggle
                                          label="Precios con ITBIS Incluido"
                                          description="Muestra el PVP final en las baldosas y búsqueda."
                                          checked={activeTerminal.config.financial.taxInclusivePrices}
                                          onChange={(v: boolean) => handleUpdateActiveConfig('financial', 'taxInclusivePrices', v)}
                                          icon={Percent}
                                          disabled={isReadOnly}
                                       />
                                       <Toggle
                                          label="Desglose de Impuestos en Ticket"
                                          description="Imprime ITBIS 18/16/0 detallado al final."
                                          checked={activeTerminal.config.financial.printTaxBreakdown}
                                          onChange={(v: boolean) => handleUpdateActiveConfig('financial', 'printTaxBreakdown', v)}
                                          icon={FileText}
                                          disabled={isReadOnly}
                                       />
                                    </div>
                                    <div>
                                       <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Método de Redondeo</label>
                                       <select
                                          value={activeTerminal.config.financial.roundingMethod}
                                          onChange={(e) => handleUpdateActiveConfig('financial', 'roundingMethod', e.target.value)}
                                          disabled={isReadOnly}
                                          className={`w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-100 transition-all ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                       >
                                          <option value="ROUND_HALF_UP">Matemático Estándar (0.5+)</option>
                                          <option value="ROUND_FLOOR">Truncar Centavos</option>
                                          <option value="NONE">Sin Redondeo</option>
                                       </select>
                                       <p className="text-[10px] text-gray-400 mt-2 ml-1">Afecta el cálculo del cambio y totales globales.</p>
                                    </div>
                                 </div>
                              </div>
                           </div>
                        )
                     }

                     {/* 2. DOCUMENTS / ASSIGNMENTS SECTION */}
                     {activeTab === 'DOCUMENTS' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4">
                           <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm">
                              <div className="flex items-center justify-between mb-6">
                                 <div>
                                    <h3 className="text-xl font-black text-gray-800 flex items-center gap-2">
                                       <Link2 size={24} className="text-blue-600" /> Vinculación de Secuencias Internas
                                    </h3>
                                 </div>
                                 <div className="flex items-center gap-3">
                                    {lastSyncTime && (
                                       <span className="text-xs text-gray-400 font-medium">
                                          Última sync: {lastSyncTime.toLocaleTimeString()}
                                       </span>
                                    )}
                                    <button
                                       onClick={handleSyncSeries}
                                       disabled={isSyncing || isReadOnly}
                                       className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md font-bold text-sm"
                                    >
                                       <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                                       {isSyncing ? 'Sincronizando...' : 'Sincronizar'}
                                    </button>
                                 </div>
                              </div>
                              <p className="text-sm text-gray-500 mb-8">Asigna qué secuencia del **Document Center** utilizará cada función operativa de esta caja.</p>

                              {activeTerminal.config.governedByMaster && (
                                 <div className="mb-8 p-4 bg-amber-50 rounded-2xl border border-amber-200 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                                    <ShieldCheck size={20} className="text-amber-600 shrink-0 mt-0.5" />
                                    <div>
                                       <h4 className="font-bold text-amber-900 text-sm">Configuración Gobernada por Maestra</h4>
                                       <p className="text-xs text-amber-700 mt-1">
                                          Esta terminal está bajo el mando de la Maestra. Las asignaciones de secuencias se sincronizan automáticamente y no pueden modificarse localmente.
                                       </p>
                                    </div>
                                 </div>
                              )}

                              <div className="space-y-4">
                                 {DOCUMENT_ROLES.map((role) => {
                                    const assignedId = activeTerminal.config.documentAssignments?.[role.id] || '';
                                    const assignedSeq = masterSequences.find(s => s.id === assignedId);

                                    return (
                                       <div key={role.id} className={`p-6 rounded-3xl border-2 transition-all flex flex-col gap-6 ${assignedId ? 'bg-white border-slate-100 shadow-sm' : 'bg-orange-50 border-orange-200 border-dashed'}`}>
                                          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                             <div className="flex items-center gap-4">
                                                <div className={`p-3 rounded-2xl ${assignedId ? 'bg-blue-600 text-white shadow-md' : 'bg-orange-200 text-orange-700'}`}>
                                                   <role.icon size={24} />
                                                </div>
                                                <div>
                                                   <h4 className="font-black text-slate-800">{role.label}</h4>
                                                   <p className="text-xs text-slate-400 font-medium">{role.description}</p>
                                                </div>
                                             </div>

                                             <div className="w-full md:w-64">
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Secuencia Vinculada</label>
                                                <select
                                                   value={assignedId}
                                                   onChange={(e) => handleAssignSequence(role.id, e.target.value)}
                                                   disabled={activeTerminal.config.governedByMaster}
                                                   className={`w-full p-3 bg-gray-50 border border-slate-200 rounded-xl font-bold text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-100 transition-all ${activeTerminal.config.governedByMaster ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                >
                                                   <option value="">-- Sin Vincular --</option>
                                                   {masterSequences
                                                      .filter(s => s.documentType === role.id)
                                                      .map(s => (
                                                         <option key={s.id} value={s.id}>{s.name} ({s.prefix})</option>
                                                      ))}
                                                </select>
                                             </div>
                                          </div>

                                          {assignedSeq && (
                                             <div className="pt-4 border-t border-slate-50 flex items-center justify-between">
                                                <div className="flex items-center gap-4">
                                                   <div className="flex flex-col">
                                                      <span className="text-[10px] font-black text-slate-400 uppercase">Prefijo Maestro</span>
                                                      <span className="font-mono font-bold text-blue-600">{assignedSeq.prefix}</span>
                                                   </div>
                                                   <div className="w-px h-6 bg-slate-100 mx-2"></div>
                                                   <div className="flex flex-col">
                                                      <span className="text-[10px] font-black text-slate-400 uppercase">Próximo correlativo</span>
                                                      <span className="font-mono font-bold text-slate-700">#{assignedSeq.nextNumber.toString().padStart(assignedSeq.padding, '0')}</span>
                                                   </div>
                                                </div>
                                                <div className="text-right">
                                                   <span className="text-[9px] font-black bg-blue-50 text-blue-600 px-2 py-1 rounded border border-blue-100 uppercase tracking-wider">
                                                      Vista Previa: {assignedSeq.prefix}{assignedSeq.nextNumber.toString().padStart(assignedSeq.padding, '0')}
                                                   </span>
                                                </div>
                                             </div>
                                          )}
                                       </div>
                                    )
                                 })}
                              </div>
                           </div>
                        </div>
                     )}

                     {/* 3. SECURITY SECTION */}
                     {activeTab === 'SECURITY' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4">
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                              <Toggle
                                 label="PIN para Anulaciones"
                                 description="Requerir autorización de administrador para borrar líneas o tickets."
                                 checked={activeTerminal.config.security.requirePinForVoid}
                                 onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requirePinForVoid', v)}
                                 icon={ShieldAlert}
                                 disabled={isReadOnly}
                              />
                              <Toggle
                                 label="PIN para Descuentos"
                                 description="Requerir PIN para aplicar rebajas manuales en el ticket."
                                 checked={activeTerminal.config.security.requirePinForDiscount}
                                 onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requirePinForDiscount', v)}
                                 icon={Percent}
                                 disabled={isReadOnly}
                              />
                              <Toggle
                                 label="Reembolsos Requieren Gerente"
                                 description="Bloquea la opción de devolución para cajeros estándar."
                                 checked={activeTerminal.config.security.requireManagerForRefunds}
                                 onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requireManagerForRefunds', v)}
                                 icon={RotateCcw}
                                 disabled={isReadOnly}
                              />

                              {/* NEW: Biometric Switch */}
                              <Toggle
                                 label="Habilitar inicio de sesión biométrico"
                                 description="Permite usar TouchID/FaceID para ingresar a la terminal."
                                 checked={activeTerminal.config.security.allowBiometrics || false}
                                 onChange={(v: boolean) => handleUpdateActiveConfig('security', 'allowBiometrics', v)}
                                 icon={Fingerprint}
                                 disabled={isReadOnly}
                              />
                           </div>

                           <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm">
                              <div className="flex items-center gap-4 mb-6">
                                 <div className="p-3 bg-orange-100 text-orange-600 rounded-xl">
                                    <Clock size={24} />
                                 </div>
                                 <div>
                                    <h3 className="font-bold text-lg text-gray-900">Auto-Logout por Inactividad</h3>
                                    <p className="text-sm text-gray-400">Cerrar sesión automáticamente tras un periodo sin uso.</p>
                                 </div>
                                 <div className="ml-auto text-2xl font-black text-orange-500">
                                    {activeTerminal.config.security.autoLogoutMinutes > 0 ? `${activeTerminal.config.security.autoLogoutMinutes} min` : 'OFF'}
                                 </div>
                              </div>
                              <input
                                 type="range"
                                 min="0" max="60" step="5"
                                 value={activeTerminal.config.security.autoLogoutMinutes}
                                 onChange={(e) => handleUpdateActiveConfig('security', 'autoLogoutMinutes', parseInt(e.target.value))}
                                 disabled={isReadOnly}
                                 className={`w-full h-3 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-orange-500 ${isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                              />
                           </div>
                        </div>
                     )}

                     {activeTab === 'SESSION' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4">
                           {/* 1. OPERATIONAL VALIDATIONS */}
                           <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
                              <h3 className="text-xl font-black text-gray-800 flex items-center gap-2">
                                 <ShieldCheck size={24} className="text-orange-600" /> Validaciones Operativas
                              </h3>
                              <Toggle
                                 label="Validar Mesas/Pedidos Abiertos"
                                 description="Impedir la generación del Cierre Z si existen mesas abiertas o pedidos sin cobrar."
                                 checked={activeTerminal.config.workflow.session.checkOpenOrders}
                                 onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'checkOpenOrders', v)}
                                 icon={ListChecks}
                                 disabled={isReadOnly}
                              />
                           </div>

                           {/* 2. CASH CONTROL */}
                           <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
                              <h3 className="text-xl font-black text-gray-800 flex items-center gap-2">
                                 <Coins size={24} className="text-emerald-600" /> Control de Efectivo
                              </h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                 <Toggle
                                    label="Cierre Ciego"
                                    description="El cajero no puede ver el total esperado del sistema antes de contar."
                                    checked={activeTerminal.config.workflow.session.blindClose}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'blindClose', v)}
                                    icon={ShieldQuestion}
                                    disabled={isReadOnly}
                                 />
                                 <Toggle
                                    label="Exigir Conteo por Denominación"
                                    description="Obliga a ingresar cantidad de billetes/monedas en lugar del monto total."
                                    checked={activeTerminal.config.workflow.session.forceDenominationCount}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'forceDenominationCount', v)}
                                    icon={Banknote}
                                    disabled={isReadOnly}
                                 />
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-100">
                                 <div>
                                    <div className="flex items-center gap-4 mb-4">
                                       <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
                                          <DollarSign size={24} />
                                       </div>
                                       <div>
                                          <h3 className="font-bold text-lg text-gray-900">Límite de Efectivo en Gaveta</h3>
                                          <p className="text-sm text-gray-400">Alerta de retiro (drop) al superar monto.</p>
                                       </div>
                                    </div>
                                    <div className="relative">
                                       <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-gray-400 text-lg">{config.currencySymbol}</span>
                                       <input
                                          type="number"
                                          value={activeTerminal.config.workflow.session.maxCashInDrawer}
                                          onChange={(e) => handleUpdateActiveConfig('workflow.session', 'maxCashInDrawer', parseFloat(e.target.value) || 0)}
                                          disabled={isReadOnly}
                                          className={`w-full pl-12 pr-4 py-4 bg-gray-50 border-2 border-transparent rounded-2xl text-2xl font-black text-gray-800 focus:bg-white focus:border-indigo-400 outline-none transition-all ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                       />
                                    </div>
                                 </div>

                                 <div>
                                    <div className="flex items-center gap-4 mb-4">
                                       <div className="p-3 bg-red-100 text-red-600 rounded-xl">
                                          <AlertTriangle size={24} />
                                       </div>
                                       <div>
                                          <h3 className="font-bold text-lg text-gray-900">Umbral Justificación</h3>
                                          <p className="text-sm text-gray-400">Exigir motivo si el descuadre supera:</p>
                                       </div>
                                    </div>
                                    <div className="relative">
                                       <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-gray-400 text-lg">{config.currencySymbol}</span>
                                       <input
                                          type="number"
                                          value={activeTerminal.config.workflow.session.cashVarianceThreshold || 0}
                                          onChange={(e) => handleUpdateActiveConfig('workflow.session', 'cashVarianceThreshold', parseFloat(e.target.value) || 0)}
                                          disabled={isReadOnly}
                                          className={`w-full pl-12 pr-4 py-4 bg-gray-50 border-2 border-transparent rounded-2xl text-2xl font-black text-gray-800 focus:bg-white focus:border-red-400 outline-none transition-all ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                       />
                                    </div>
                                 </div>
                              </div>
                           </div>

                           {/* 4. DAY CONTROL (NEW) */}
                           <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
                              <h3 className="text-xl font-black text-gray-800 flex items-center gap-2">
                                 <Clock size={24} className="text-purple-600" /> Control de Jornada
                              </h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                 <Toggle
                                    label="Forzar Cierre Z al cambiar de jornada"
                                    description="Bloquea la venta si se detecta un cambio de día operativo."
                                    checked={activeTerminal.config.workflow.session.forceZChange}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'forceZChange', v)}
                                    icon={Lock}
                                    danger
                                    disabled={isReadOnly}
                                 />

                                 {activeTerminal.config.workflow.session.forceZChange && (
                                    <div className="animate-in slide-in-from-left-2">
                                       <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Hora de Inicio de Jornada (0-23h)</label>
                                       <div className="relative">
                                          <input
                                             type="number"
                                             min="0" max="23"
                                             value={activeTerminal.config.workflow.session.businessStartHour}
                                             onChange={(e) => handleUpdateActiveConfig('workflow.session', 'businessStartHour', parseInt(e.target.value) || 0)}
                                             disabled={isReadOnly}
                                             className={`w-full pl-4 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-xl font-black text-slate-700 outline-none focus:ring-2 focus:ring-purple-100 transition-all ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                          />
                                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-400">HRS</span>
                                       </div>
                                       <p className="text-[10px] text-gray-400 mt-2 ml-1 leading-tight">
                                          Para Retail usar 0. Para Bares/Discotecas colocar la hora de cierre total (ej. 4 AM) para evitar bloqueos a medianoche.
                                       </p>
                                    </div>
                                 )}
                              </div>
                           </div>

                           {/* 3. REPORTS & DISTRIBUTION */}
                           <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
                              <h3 className="text-xl font-black text-gray-800 flex items-center gap-2">
                                 <Mail size={24} className="text-sky-600" /> Reportes y Distribución
                              </h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                 <Toggle
                                    label="Auto-Print Reporte Z"
                                    description="Imprimir copia física al finalizar."
                                    checked={activeTerminal.config.workflow.session.autoPrintZReport}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'autoPrintZReport', v)}
                                    icon={Printer}
                                    disabled={isReadOnly}
                                 />
                                 <Toggle
                                    label="Enviar Reporte Z por Email"
                                    description="Enviar PDF a correos designados (Background Job)."
                                    checked={activeTerminal.config.workflow.session.emailZReport}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'emailZReport', v)}
                                    icon={Mail}
                                    disabled={isReadOnly}
                                 />
                              </div>

                              {activeTerminal.config.workflow.session.emailZReport && (
                                 <div className="animate-in slide-in-from-top-2">
                                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Destinatarios (separados por coma)</label>
                                    <input
                                       type="text"
                                       placeholder="admin@empresa.com, gerente@empresa.com"
                                       value={activeTerminal.config.workflow.session.zReportEmails || ''}
                                       onChange={(e) => handleUpdateActiveConfig('workflow.session', 'zReportEmails', e.target.value)}
                                       disabled={isReadOnly}
                                       className={`w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-sky-100 transition-all ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                    />
                                    <p className="text-[10px] text-gray-400 mt-2 ml-1 flex items-center gap-1">
                                       <Cloud size={10} /> El envío se encolará si no hay conexión a internet.
                                    </p>
                                 </div>
                              )}
                           </div>

                           {/* LEGACY / OTHER */}
                           <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                              <Toggle
                                 label="Ventas sin Z Abierta"
                                 description="Permitir transacciones aunque no se haya registrado fondo inicial."
                                 checked={activeTerminal.config.workflow.session.allowSalesWithOpenZ}
                                 onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'allowSalesWithOpenZ', v)}
                                 icon={Zap}
                                 danger
                                 disabled={isReadOnly}
                              />
                           </div>
                        </div>
                     )}

                     {activeTab === 'INVENTORY' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4">
                           <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm">
                              <h3 className="text-xl font-black text-gray-800 mb-6 flex items-center gap-2">
                                 <Building2 size={24} className="text-blue-600" /> Alcance de Almacenes
                              </h3>
                              <div className="space-y-4">
                                 <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Almacenes Visibles en Terminal</label>
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {warehouses.map(wh => {
                                       const isVisible = activeTerminal.config.inventoryScope?.visibleWarehouseIds.includes(wh.id);
                                       const isDefault = activeTerminal.config.inventoryScope?.defaultSalesWarehouseId === wh.id;
                                       return (
                                          <div
                                             key={wh.id}
                                             onClick={() => {
                                                if (isReadOnly) return;
                                                const current = activeTerminal.config.inventoryScope?.visibleWarehouseIds || [];
                                                const updated = isVisible ? current.filter(id => id !== wh.id) : [...current, wh.id];
                                                handleUpdateActiveConfig('inventoryScope', 'visibleWarehouseIds', updated);
                                             }}
                                             className={`p-4 rounded-2xl border-2 flex items-center justify-between transition-all ${isVisible ? 'bg-blue-50 border-blue-500 shadow-sm' : 'bg-white border-gray-100 hover:border-gray-300'} ${isReadOnly ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                                          >
                                             <div className="flex items-center gap-3">
                                                <div className={`p-2 rounded-lg ${isVisible ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                                                   <Box size={18} />
                                                </div>
                                                <div>
                                                   <p className={`font-bold text-sm ${isVisible ? 'text-blue-900' : 'text-gray-700'}`}>{wh.name}</p>
                                                   <p className="text-[10px] text-gray-400 font-mono uppercase">{wh.code}</p>
                                                </div>
                                             </div>
                                             <div className="flex items-center gap-2">
                                                {isVisible && (
                                                   <button
                                                      onClick={(e) => {
                                                         e.stopPropagation();
                                                         if (isReadOnly) return;
                                                         handleUpdateActiveConfig('inventoryScope', 'defaultSalesWarehouseId', wh.id);
                                                      }}
                                                      disabled={isReadOnly}
                                                      className={`px-2 py-1 rounded-md text-[9px] font-black uppercase transition-all ${isDefault ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white text-gray-400 border border-gray-200 hover:text-emerald-600'} ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                                   >
                                                      {isDefault ? 'Despacho OK' : 'Fijar Defecto'}
                                                   </button>
                                                )}
                                             </div>
                                          </div>
                                       );
                                    })}
                                 </div>
                              </div>
                           </div>
                        </div>
                     )}

                     {activeTab === 'OFFLINE' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4">
                           <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-8">
                              <h3 className="text-xl font-black text-gray-800 mb-6 flex items-center gap-2">
                                 <Cloud size={24} className="text-blue-600" /> Comportamiento de Red
                              </h3>
                              <div className="space-y-4">
                                 <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Modo de Operación</label>
                                 <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    {[
                                       { id: 'OPTIMISTIC', label: 'Optimista', desc: 'Permite todo offline.', color: 'bg-emerald-500' },
                                       { id: 'STRICT', label: 'Estricto', desc: 'Bloquea si no hay red.', color: 'bg-red-500' },
                                       { id: 'READ_ONLY', label: 'Consulta', desc: 'Solo ver stock.', color: 'bg-blue-500' },
                                    ].map(mode => (
                                       <button
                                          key={mode.id}
                                          onClick={() => !isReadOnly && handleUpdateActiveConfig('workflow.offline', 'mode', mode.id)}
                                          className={`p-4 rounded-2xl border-2 text-left transition-all ${activeTerminal.config.workflow.offline.mode === mode.id ? 'border-blue-500 bg-blue-50 shadow-sm' : 'bg-white border-gray-100 hover:border-gray-300'} ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                          disabled={isReadOnly}
                                       >
                                          <div className="flex items-center gap-2 mb-2">
                                             <div className={`w-2 h-2 rounded-full ${mode.color}`} />
                                             <span className="font-bold text-sm">{mode.label}</span>
                                          </div>
                                          <p className="text-[10px] text-gray-400 font-medium uppercase">{mode.desc}</p>
                                       </button>
                                    ))}
                                 </div>
                              </div>
                              <div>
                                 <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Límite de Transacciones Offline</label>
                                 <div className="flex items-center gap-4">
                                    <div className="relative flex-1">
                                       <input
                                          type="number"
                                          value={activeTerminal.config.workflow.offline.maxOfflineTransactionLimit}
                                          onChange={(e) => handleUpdateActiveConfig('workflow.offline', 'maxOfflineTransactionLimit', parseInt(e.target.value) || 0)}
                                          className={`w-full p-4 bg-gray-50 border-2 border-transparent rounded-2xl text-2xl font-black text-gray-800 focus:bg-white focus:border-blue-400 outline-none transition-all ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                          disabled={isReadOnly}
                                       />
                                       <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 uppercase">Docs</span>
                                    </div>
                                    <div className="p-4 bg-slate-100 rounded-2xl text-slate-400"><Server size={32} /></div>
                                 </div>
                              </div>
                           </div>
                        </div>
                     )}

                     {activeTab === 'FISCAL' && (
                        <div className="animate-in slide-in-from-right-4 space-y-6">
                           <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm">
                              <h3 className="text-xl font-black text-gray-800 mb-6 flex items-center gap-2">
                                 <Landmark size={24} className="text-indigo-600" /> Gestión de Lotes DGII
                              </h3>
                              <p className="text-sm text-gray-500 mb-6">Configura el tamaño del lote de NCF que esta terminal descarga automáticamente del pool central.</p>

                              {activeTerminal.config.governedByMaster && (
                                 <div className="mb-8 p-4 bg-amber-50 rounded-2xl border border-amber-200 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                                    <ShieldCheck size={20} className="text-amber-600 shrink-0 mt-0.5" />
                                    <div>
                                       <h4 className="font-bold text-amber-900 text-sm">Configuración Gobernada por Maestra</h4>
                                       <p className="text-xs text-amber-700 mt-1">
                                          El tamaño de los lotes fiscales está controlado por la Maestra para esta terminal.
                                       </p>
                                    </div>
                                 </div>
                              )}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                 {(['B01', 'B02', 'B04', 'B14', 'B15'] as NCFType[]).map((type) => {
                                    const typeConfig = activeTerminal.config.fiscal?.typeConfigs?.[type] || { batchSize: 100, lowBatchThreshold: 20, lowBatchThresholdPct: 20 };
                                    return (
                                       <div key={type} className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-4">
                                          <div className="flex items-center gap-2">
                                             <span className="bg-indigo-600 text-white px-2.5 py-1 rounded-lg text-xs font-black tracking-widest">{type}</span>
                                             <h4 className="font-bold text-gray-800">{NCF_LABELS[type]}</h4>
                                          </div>

                                          <div className="space-y-4">
                                             <div>
                                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Docs por Lote</label>
                                                <input
                                                   type="number"
                                                   value={typeConfig.batchSize}
                                                   onChange={(e) => {
                                                      const current = activeTerminal.config.fiscal?.typeConfigs || {};
                                                      handleUpdateActiveConfig('fiscal.typeConfigs', type, { ...typeConfig, batchSize: parseInt(e.target.value) || 0 });
                                                   }}
                                                   disabled={isReadOnly}
                                                   className={`w-full p-3 bg-white border rounded-xl font-bold text-indigo-600 outline-none focus:ring-2 focus:ring-indigo-100 ${isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                />
                                             </div>

                                             <div>
                                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Alerta Agotamiento (%)</label>
                                                <div className="relative">
                                                   <input
                                                      type="number"
                                                      min="1" max="99"
                                                      value={typeConfig.lowBatchThresholdPct || 20}
                                                      onChange={(e) => {
                                                         const current = activeTerminal.config.fiscal?.typeConfigs || {};
                                                         handleUpdateActiveConfig('fiscal.typeConfigs', type, { ...typeConfig, lowBatchThresholdPct: parseInt(e.target.value) || 0 });
                                                      }}
                                                      disabled={isReadOnly}
                                                      className={`w-full p-3 pr-10 bg-white border rounded-xl font-bold text-orange-600 outline-none focus:ring-2 focus:ring-orange-100 ${isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                   />
                                                   <span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-orange-400 text-xs">%</span>
                                                </div>
                                             </div>
                                          </div>
                                       </div>
                                    );
                                 })}
                              </div>
                           </div>
                        </div>
                     )}
                  </div>
               ) : (
                  <div className="h-full flex items-center justify-center text-gray-400 italic">
                     <p>Selecciona una terminal del panel izquierdo para configurar.</p>
                  </div>
               )}
            </div>
         </div>

         {/* MODAL DE CONFLICTO DE JERARQUIA */}
         {
            showConflictModal && (
               <div className="fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
                  <div className="bg-white rounded-[2.5rem] w-full max-w-md shadow-2xl p-10 overflow-hidden text-center animate-in zoom-in-95">
                     <div className="w-20 h-20 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-6">
                        <ShieldAlert size={40} />
                     </div>
                     <h3 className="text-2xl font-black text-slate-800 mb-2">Conflicto de Jerarquía</h3>
                     <p className="text-slate-500 mb-8 leading-relaxed">
                        La terminal <span className="font-black text-blue-600">'{showConflictModal}'</span> ya está configurada como la Principal. ¿Desea transferir el rol de mando a esta terminal?
                     </p>
                     <div className="flex flex-col gap-3">
                        <button
                           onClick={confirmMasterTransfer}
                           className="w-full py-4 bg-orange-600 text-white rounded-2xl font-black shadow-lg shadow-orange-200 hover:bg-orange-700 active:scale-95 transition-all"
                        >
                           Transferir Rol Master
                        </button>
                        <button
                           onClick={() => setShowConflictModal(null)}
                           className="w-full py-4 bg-slate-100 text-slate-500 rounded-2xl font-bold hover:bg-slate-200 transition-all"
                        >
                           Cancelar
                        </button>
                     </div>
                  </div>
               </div>
            )
         }
      </div>
   );
};

export default TerminalSettings;
