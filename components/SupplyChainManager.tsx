
import React, { useState, useMemo, useEffect } from 'react';
import {
   ArrowLeft, Truck, Package, AlertTriangle, Search, Plus,
   ShoppingCart, Check, X, FileText, Calendar, Archive,
   ClipboardList, ArrowRight, Save, User, Minus, Box,
   ScanBarcode, LayoutList, Mail, Landmark, Phone,
   CreditCard, DollarSign, Clock, Info, ShieldAlert, History, Trash2
} from 'lucide-react';
import { BusinessConfig, Product, Supplier, PurchaseOrder, PurchaseOrderItem, Reception, ProductVariant } from '../types';
import { validateWarehouseAccess } from '../utils/validation';

import InventoryAudit from './InventoryAudit';
import SupplierSelector from './SupplierSelector';
import PurchaseOrderList from './PurchaseOrderList';
import ReceptionHistory from './ReceptionHistory';
import ErrorBoundary from './ErrorBoundary';
import OrderMatrixModal from './OrderMatrixModal';
import { formatSafeDate } from '../utils/dateUtils';
import { db } from '../utils/db';
import { syncManager } from '../services/sync/SyncManager';
import { resolveSupplierImageSrc } from '../utils/entityImage';
import { createUuid } from '../utils/uuid';

interface SupplyChainManagerProps {
   products: Product[];
   suppliers: Supplier[];
   purchaseOrders: PurchaseOrder[];
   receptions: Reception[];
   supplierProductPrices: any[];
   config: BusinessConfig;
   onClose: () => void;
   onCreateOrder: (order: PurchaseOrder) => void;
   onUpdateOrder: (order: PurchaseOrder) => void;
   onReceiveStock: (items: PurchaseOrderItem[], orderId?: string) => void;
   onAdjustStock: (adjustments: { productId: string; quantity: number }[]) => void;
   onAddSupplier: (supplier: Supplier) => Promise<void> | void;
   onUpdateSupplier: (supplier: Supplier) => void;
   onDeleteSupplier: (id: string) => Promise<void>;
   onDeleteOrder: (id: string) => Promise<void>;
   onDeleteReception: (id: string) => Promise<void>;
}

type Tab = 'ALERTS' | 'CREATE' | 'RECEIVE' | 'SUPPLIERS';
type AuditMode = 'ADDITIVE' | 'ABSOLUTE';

const SupplyChainManager: React.FC<SupplyChainManagerProps> = ({
   products,
   suppliers,
   purchaseOrders,
   receptions,
   supplierProductPrices,
   config,
   onClose,
   onCreateOrder,
   onUpdateOrder,
   onReceiveStock,
   onAdjustStock,
   onAddSupplier,
   onUpdateSupplier,
   onDeleteSupplier,
   onDeleteOrder,
   onDeleteReception
}) => {
   // Defensive Checks
   const safeProducts = Array.isArray(products) ? products : [];
   const safeSuppliers = Array.isArray(suppliers) ? suppliers : [];
   const safeOrders = Array.isArray(purchaseOrders) ? purchaseOrders : [];
   const safeReceptions = Array.isArray(receptions) ? receptions : [];

   const [activeAuditId, setActiveAuditId] = useState<string | null>(null);
   const [pendingTracking, setPendingTracking] = useState<{
      itemId: string;
      productId: string;
      productName: string;
      quantity: number;
      type: 'LOTE' | 'SERIE';
      data: { trackingCode: string; expirationDate?: string; id?: string }[];
   } | null>(null);

   // Navigation State
   const [activeTab, setActiveTab] = useState<Tab>('CREATE');
   const [isCreatingOrder, setIsCreatingOrder] = useState(false);
   const [isReceivingOrder, setIsReceivingOrder] = useState(false);
   const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
   const [supplierModalTab, setSupplierModalTab] = useState<'GENERAL' | 'FINANCIAL' | 'HISTORY'>('GENERAL');

   // Create Order State
   const [selectedSupplier, setSelectedSupplier] = useState<string>(safeSuppliers[0]?.id || '');
   const [orderCart, setOrderCart] = useState<PurchaseOrderItem[]>([]);
   const [productSearch, setProductSearch] = useState('');
   const [isMatrixOpen, setIsMatrixOpen] = useState(false);
   const [selectedMatrixProduct, setSelectedMatrixProduct] = useState<Product | null>(null);
   const [expandedProductDetail, setExpandedProductDetail] = useState<string | null>(null);

   // Receive Order State
   const [receivingOrderId, setReceivingOrderId] = useState<string | null>(null);
   const [receptionSearch, setReceptionSearch] = useState('');
   const [receptionCategory, setReceptionCategory] = useState('Todas');
   const [requestError, setRequestError] = useState<string | null>(null);


   // Filter State
   const [selectedCategory, setSelectedCategory] = useState<string>('Todas');

   // Unique Categories Memo
   const categories = useMemo(() => {
      const cats = new Set(safeProducts.map(p => p.category).filter(Boolean));
      return ['Todas', ...Array.from(cats)].sort();
   }, [safeProducts]);

   // Active Reception Categories Memo
   const activeReceptionCategories = useMemo(() => {
      if (!receivingOrderId) return ['Todas'];
      const order = safeOrders.find(o => o.id === receivingOrderId);
      if (!order) return ['Todas'];
      const cats = new Set((order.items || []).map(item => {
         const p = safeProducts.find(prod => prod.id === item.productId);
         return p?.category;
      }).filter(Boolean));
      return ['Todas', ...Array.from(cats)].sort();
   }, [receivingOrderId, safeOrders, safeProducts]);

   // Reset filters when changing view or order
   useEffect(() => {
      setSelectedCategory('Todas');
      setProductSearch('');
   }, [activeTab, isCreatingOrder]);

   useEffect(() => {
      setReceptionSearch('');
      setReceptionCategory('Todas');
   }, [receivingOrderId, isReceivingOrder]);

   // Inventory Audit State
   const [isAuditMode, setIsAuditMode] = useState(false);
   const [auditMode, setAuditMode] = useState<AuditMode | null>(null);

   // Low Stock Alert Logic
   const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);

   useEffect(() => {
      const loadLowStock = async () => {
         // Defensive check for products
         if (!safeProducts) {
            setLowStockProducts([]);
            return;
         }

         const filtered = safeProducts.filter(p => {
            if (!p || !p.operationalFlags?.trackInventory) return false;
            const stock = p.stock || 0;
            const min = p.minStock || 5;
            return stock <= min;
         });
         setLowStockProducts(filtered);
      };
      loadLowStock();
   }, [safeProducts]); // Dependency on 'products' prop to re-evaluate when products change

   // --- DERIVED DATA ---
   const filteredProducts = useMemo(() => {
      return safeProducts.filter(p => {
         const matchesSearch = (p.name || '').toLowerCase().includes(productSearch.toLowerCase()) ||
            (p.barcode || '').includes(productSearch);
         const matchesCategory = selectedCategory === 'Todas' || p.category === selectedCategory;
         return matchesSearch && matchesCategory;
      });
   }, [safeProducts, productSearch, selectedCategory]);

   const activeOrders = useMemo(() => {
      return safeOrders.filter(po => po.status === 'ORDERED' || po.status === 'PARTIAL');
   }, [safeOrders]);

   // --- HANDLERS ---

   const addToOrderCart = (product: Product) => {
      if (product.attributes && product.attributes.length > 0) {
         setSelectedMatrixProduct(product);
         setIsMatrixOpen(true);
         return;
      }

      setOrderCart(prev => {
         const existing = (prev || []).find(i => i.productId === product.id && !i.variantSku);
         if (existing) {
            return prev.map(i => (i.productId === product.id && !i.variantSku) ? { ...i, quantityOrdered: i.quantityOrdered + 1 } : i);
         }
         return [...prev, {
            productId: product.id,
            productName: product.name,
            quantityOrdered: 1,
            quantityReceived: 0,
            cost: product.cost || 0
         }];
      });
   };

   const addMatrixToCart = (entries: { variant: ProductVariant, quantity: number }[]) => {
      if (!selectedMatrixProduct) return;

      setOrderCart(prev => {
         const newCart = [...prev];
         entries.forEach(entry => {
            const variantInfo = Object.entries(entry.variant.attributeValues)
               .map(([key, val]) => `${key}: ${val}`)
               .join(' / ');

            const existingIdx = newCart.findIndex(i => i.variantSku === entry.variant.sku);
            if (existingIdx >= 0) {
               newCart[existingIdx] = {
                  ...newCart[existingIdx],
                  quantityOrdered: newCart[existingIdx].quantityOrdered + entry.quantity
               };
            } else {
               newCart.push({
                  productId: selectedMatrixProduct.id,
                  productName: selectedMatrixProduct.name,
                  quantityOrdered: entry.quantity,
                  quantityReceived: 0,
                  cost: entry.variant.price || selectedMatrixProduct.cost || 0,
                  variantSku: entry.variant.sku,
                  variantInfo: variantInfo
               });
            }
         });
         return newCart;
      });
   };

   const updateCartQuantity = (productId: string, variantSku: string | undefined, delta: number) => {
      setOrderCart(prev => prev.map(i => {
         if (i.productId === productId && i.variantSku === variantSku) {
            return { ...i, quantityOrdered: Math.max(1, i.quantityOrdered + delta) };
         }
         return i;
      }));
   };

   const setCartQuantity = (productId: string, variantSku: string | undefined, newValue: number) => {
      setOrderCart(prev => prev.map(i => {
         if (i.productId === productId && i.variantSku === variantSku) {
            return { ...i, quantityOrdered: Math.max(0, isNaN(newValue) ? 0 : newValue) };
         }
         return i;
      }));
   };

   const updateCartCost = (productId: string, variantSku: string | undefined, newCost: number) => {
      setOrderCart(prev => prev.map(i => {
         if (i.productId === productId && i.variantSku === variantSku) {
            return { ...i, cost: isNaN(newCost) ? 0 : newCost };
         }
         return i;
      }));
   };

   const removeFromCart = (productId: string) => {
      setOrderCart(prev => prev.filter(i => i.productId !== productId));
   };

   const handleFinalizeOrder = () => {
      if (!selectedSupplier || orderCart.length === 0) return;

      const supplier = (safeSuppliers || []).find(s => s.id === selectedSupplier);
      const totalCost = orderCart.reduce((acc, item) => acc + (item.cost * item.quantityOrdered), 0);

      // Calculate Due Date
      const dueDate = new Date();
      if (supplier?.paymentTermDays) {
         dueDate.setDate(dueDate.getDate() + supplier.paymentTermDays);
      }

      const newOrder: PurchaseOrder = {
         id: `PO-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
         supplierId: selectedSupplier,
         date: new Date().toISOString(),
         expectedDate: dueDate.toISOString(),
         dueDate: dueDate.toISOString(),
         status: 'ORDERED',
         items: orderCart,
         totalCost
      };

      onUpdateOrder({ ...newOrder, status: 'ORDERED' }); // Ensure status is ORDERED
      onCreateOrder(newOrder);
      setOrderCart([]);
      setIsCreatingOrder(false);
      alert("Orden creada exitosamente.");
      setActiveTab('RECEIVE');
   };

   const handleSendEmail = async (order: PurchaseOrder) => {
      const supplier = (safeSuppliers || []).find(s => s.id === order.supplierId);
      if (!supplier?.email) {
         alert("El proveedor no tiene email registrado.");
         return;
      }

      try {
         // In a real app, we would generate a PDF here.
         // For now, we'll send a structured HTML email via our backend.
         const response = await fetch('/api/email/purchase-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
               orderId: order.id,
               supplierEmail: supplier.email,
               supplierName: supplier.name,
               items: order.items,
               total: order.totalCost,
               dueDate: order.dueDate
            })
         });

         const data = await response.json();
         if (data.success) {
            alert(`Orden enviada a ${supplier.email}`);
            onUpdateOrder({ ...order, sentAt: new Date().toISOString() });
         } else {
            alert("Error al enviar email: " + data.message);
         }
      } catch (error) {
         console.error("Error sending PO email:", error);
         alert("Error de conexión al enviar email.");
      }
   };



   // --- TOUCH FRIENDLY COMPONENTS ---

   const BigStepper = ({ value, onDecrease, onIncrease, onChange }: { value: number; onDecrease: () => void; onIncrease: () => void; onChange?: (val: number) => void }) => (
      <div className="flex items-center bg-gray-100 rounded-xl p-1">
         <button onClick={onDecrease} className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-white hover:text-indigo-600 rounded-lg transition-colors">
            <Minus size={16} />
         </button>
         <input
            type="number"
            value={value}
            onChange={(e) => onChange?.(parseInt(e.target.value) || 0)}
            className="w-12 bg-transparent text-center font-black text-indigo-600 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
         />
         <button onClick={onIncrease} className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-white hover:text-indigo-600 rounded-lg transition-colors">
            <Plus size={16} />
         </button>
      </div>
   );

   // --- RENDER SECTIONS ---

   const renderAlerts = () => (
      <div className="animate-in fade-in slide-in-from-right-4 pb-20">
         <div className="bg-red-50 border-l-4 border-red-500 rounded-r-xl p-6 mb-6">
            <h3 className="text-xl font-bold text-red-800 flex items-center gap-2">
               <AlertTriangle size={24} /> Alertas de Stock
            </h3>
            <p className="text-red-700 mt-1 text-sm">
               {lowStockProducts.length} productos requieren reabastecimiento urgente.
            </p>
         </div>

         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(lowStockProducts || []).map((product, idx) => {
               const isInCart = (orderCart || []).some(item => item.productId === product.id);
               return (
                  <div key={product.id || `low-${idx}`} className={`bg-white p-5 rounded-3xl shadow-sm border border-gray-200 flex flex-col justify-between transition-opacity ${isInCart ? 'opacity-50' : ''}`}>
                     <div>
                        <div className="flex justify-between items-start mb-2">
                           <span className="text-xs font-bold text-red-500 bg-red-50 px-3 py-1 rounded-full uppercase">Crítico</span>
                           <span className="text-xs text-gray-400 font-mono">{product.barcode}</span>
                        </div>
                        <h4 className="font-bold text-gray-800 text-lg leading-tight mb-1">{product.name}</h4>
                        <p className="text-sm text-gray-500">{product.category}</p>
                     </div>

                     <div className="flex items-center justify-between mt-6 bg-gray-50 p-3 rounded-2xl">
                        <div className="text-center px-2">
                           <p className="text-[10px] uppercase text-gray-400 font-bold">Actual</p>
                           <p className="text-xl font-black text-red-600">{product.stock}</p>
                        </div>
                        <div className="text-center px-2 border-l border-gray-200">
                           <p className="text-[10px] uppercase text-gray-400 font-bold">Mínimo</p>
                           <p className="text-xl font-black text-gray-700">{product.minStock}</p>
                        </div>
                        <button
                           disabled={isInCart}
                           onClick={() => { addToOrderCart(product); setActiveTab('CREATE'); }}
                           className={`p-3 rounded-xl transition-all shadow-lg flex items-center justify-center ${isInCart
                              ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
                              : 'bg-gray-900 text-white hover:scale-105 active:scale-95'}`}
                        >
                           {isInCart ? <Check size={24} /> : <Plus size={24} />}
                        </button>
                     </div>
                  </div>
               );
            })}
         </div>
      </div>
   );




   const renderCreateOrder = () => {
      if (!isCreatingOrder) {
         return (
            <PurchaseOrderList
               purchaseOrders={safeOrders}
               suppliers={safeSuppliers}
               config={config}
               onNewOrder={() => setIsCreatingOrder(true)}
               onViewDetail={(id) => {
                  setReceivingOrderId(id);
                  setActiveTab('RECEIVE');
               }}
               onSendEmail={handleSendEmail}
               onDeleteOrder={onDeleteOrder}
            />
         );
      }

      return (
         <div className="flex flex-col lg:flex-row gap-6 h-full overflow-hidden animate-in fade-in">
            {/* Header for Creation Mode */}
            <div className="lg:hidden flex items-center gap-4 mb-4">
               <button onClick={() => setIsCreatingOrder(false)} className="p-2 bg-white rounded-xl shadow-sm">
                  <ArrowLeft size={20} />
               </button>
               <h3 className="font-bold">Nuevo Pedido</h3>
            </div>

            {/* Catalog (Left) */}
            <div className="flex-1 flex flex-col bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
               <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                  <div className="relative">
                     <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={24} />
                     <input
                        type="text"
                        placeholder="Buscar productos..."
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        className="w-full pl-12 pr-4 py-4 bg-white border border-gray-200 rounded-2xl text-lg outline-none focus:ring-2 focus:ring-indigo-500/20"
                     />
                  </div>
               </div>

               {/* Category Chips for Pedido */}
               <div className="px-4 py-2 border-b border-gray-100 flex gap-2 overflow-x-auto no-scrollbar bg-gray-50/30">
                  {categories.map(cat => (
                     <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${selectedCategory === cat
                           ? 'bg-indigo-600 text-white shadow-sm'
                           : 'bg-white text-gray-500 border border-gray-200 hover:border-indigo-300 h-7 flex items-center'
                           }`}
                     >
                        {cat}
                     </button>
                  ))}
               </div>
               <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {(filteredProducts || []).map((p, idx) => (
                     <div key={p.id || `cat-p-${idx}`} onClick={() => addToOrderCart(p)} className="flex items-center gap-4 p-4 bg-white border border-gray-100 rounded-2xl shadow-sm active:scale-[0.98] transition-transform cursor-pointer">
                        <div className="w-16 h-16 bg-gray-100 rounded-xl flex items-center justify-center shrink-0">
                           <Package size={28} className="text-gray-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                           <h4 className="font-bold text-gray-800 text-lg truncate">{p.name}</h4>
                           <div className="flex gap-4 mt-1 text-sm text-gray-500">
                              <span>Stock: <strong className={p.stock! < p.minStock! ? 'text-red-500' : 'text-gray-700'}>{p.stock}</strong></span>
                              <span>Costo: <strong>{config.currencySymbol}{p.cost?.toFixed(2)}</strong></span>
                           </div>
                        </div>
                        <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center">
                           <Plus size={24} />
                        </div>
                     </div>
                  ))}
               </div>
            </div>

            {/* Cart (Right) */}
            <div className="w-full lg:w-[450px] flex flex-col bg-white rounded-3xl shadow-xl border border-gray-200 overflow-hidden z-20">
               <div className="p-6 bg-indigo-600 text-white">
                  <SupplierSelector
                     selectedSupplierId={selectedSupplier}
                     onSelect={(s) => setSelectedSupplier(s.id)}
                     onAddSupplier={onAddSupplier}
                  />
               </div>

               <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                  {orderCart.length === 0 ? (
                     <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60">
                        <ShoppingCart size={64} className="mb-4" />
                        <p className="text-lg font-medium">Carrito de compra vacío</p>
                     </div>
                  ) : (
                     Object.values(
                        (orderCart || []).reduce((acc, item) => {
                           const key = item.productId;
                           if (!acc[key]) {
                              acc[key] = {
                                 productId: item.productId,
                                 productName: item.productName,
                                 totalQty: 0,
                                 totalCost: 0,
                                 items: [] as PurchaseOrderItem[]
                              };
                           }
                           acc[key].totalQty += item.quantityOrdered;
                           acc[key].totalCost += (item.cost * item.quantityOrdered);
                           acc[key].items.push(item);
                           return acc;
                        }, {} as Record<string, { productId: string, productName: string, totalQty: number, totalCost: number, items: PurchaseOrderItem[] }>)
                     ).map((group) => {
                        const isExpanded = expandedProductDetail === group.productId;
                        const hasVariants = group.items.some(i => i.variantSku);

                        return (
                           <div key={group.productId} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-in slide-in-from-right-4">
                              <div className="p-4 flex flex-col gap-3">
                                 <div className="flex justify-between items-start">
                                    <div className="flex-1">
                                       <h4 className="font-bold text-gray-800 text-lg leading-tight">{group.productName}</h4>
                                       {hasVariants && (
                                          <button
                                             onClick={() => setExpandedProductDetail(isExpanded ? null : group.productId)}
                                             className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-black uppercase mt-1 flex items-center gap-1 hover:bg-indigo-100 transition-colors"
                                          >
                                             {isExpanded ? 'Ocultar Desglose' : `Ver Desglose (${group.items.length} variantes)`}
                                             <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                                                <ArrowLeft size={10} className="-rotate-90" />
                                             </div>
                                          </button>
                                       )}
                                    </div>
                                    <button onClick={() => removeFromCart(group.productId)} className="p-2 text-gray-300 hover:text-red-500 -mt-2 -mr-2">
                                       <X size={24} />
                                    </button>
                                 </div>

                                 {!isExpanded ? (
                                    <div className="flex items-center justify-between">
                                       <div className="flex flex-col">
                                          <label className="text-[10px] text-gray-400 font-bold uppercase mb-1">{hasVariants ? 'Costo Promedio / Unid.' : 'Precio Compra'}</label>
                                          {!hasVariants ? (
                                             <div className="flex items-center gap-1 group/input">
                                                <span className="text-[10px] text-gray-400 font-bold">{config.currencySymbol}</span>
                                                <input
                                                   type="number"
                                                   value={group.items[0].cost ?? ''}
                                                   onChange={(e) => updateCartCost(group.productId, undefined, parseFloat(e.target.value))}
                                                   className="w-24 bg-gray-50 border border-transparent group-hover/input:border-gray-200 rounded-lg px-2 py-0.5 text-sm font-bold text-gray-800 outline-none focus:bg-white focus:border-indigo-500 transition-all"
                                                />
                                             </div>
                                          ) : (
                                             <span className="font-bold text-gray-800">{config.currencySymbol}{(group.totalCost / (group.totalQty || 1)).toFixed(2)}</span>
                                          )}
                                       </div>
                                       <div className="flex flex-col items-end">
                                          <label className="text-[10px] text-gray-400 font-bold uppercase mb-1">Total Unidades</label>
                                          {!hasVariants ? (
                                             <BigStepper
                                                value={group.totalQty}
                                                onDecrease={() => updateCartQuantity(group.productId, undefined, -1)}
                                                onIncrease={() => updateCartQuantity(group.productId, undefined, 1)}
                                                onChange={(val) => setCartQuantity(group.productId, undefined, val)}
                                             />
                                          ) : (
                                             <span className="text-xl font-black text-indigo-600">{group.totalQty}</span>
                                          )}
                                       </div>
                                    </div>
                                 ) : (
                                    <div className="space-y-3 pt-2 border-t border-gray-50">
                                       {group.items.map((vItem, vIdx) => (
                                          <div key={vItem.variantSku || vIdx} className="bg-gray-50/50 p-3 rounded-xl border border-gray-100">
                                             <div className="flex justify-between items-center mb-2">
                                                <span className="text-[11px] font-black text-gray-500 uppercase">{vItem.variantInfo || 'Sin variantes'}</span>
                                                <span className="text-xs font-bold text-gray-400">SKU: {vItem.variantSku}</span>
                                             </div>
                                             <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                   <span className="text-xs text-gray-500 font-bold">{config.currencySymbol}</span>
                                                   <input
                                                      type="number"
                                                      value={vItem.cost ?? ''}
                                                      onChange={(e) => updateCartCost(group.productId, vItem.variantSku, parseFloat(e.target.value))}
                                                      className="w-20 bg-white border border-gray-200 rounded-lg px-2 py-1 text-sm font-bold text-gray-800 outline-none"
                                                   />
                                                </div>
                                                <BigStepper
                                                   value={vItem.quantityOrdered}
                                                   onDecrease={() => updateCartQuantity(group.productId, vItem.variantSku, -1)}
                                                   onIncrease={() => updateCartQuantity(group.productId, vItem.variantSku, 1)}
                                                   onChange={(val) => setCartQuantity(group.productId, vItem.variantSku, val)}
                                                />
                                             </div>
                                          </div>
                                       ))}
                                    </div>
                                 )}

                                 <div className="border-t border-gray-100 pt-2 text-right">
                                    <span className="text-xs font-bold text-gray-400 uppercase mr-2">Subtotal Línea</span>
                                    <span className="text-lg font-black text-gray-800">{config.currencySymbol}{group.totalCost.toFixed(2)}</span>
                                 </div>
                              </div>
                           </div>
                        );
                     })
                  )}
               </div>

               <div className="p-6 bg-white border-t border-gray-100 shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
                  <div className="flex justify-between items-center mb-6">
                     <span className="text-gray-500 font-bold uppercase text-sm">Total Estimado</span>
                     <span className="text-3xl font-black text-gray-900">
                        {config.currencySymbol}{(orderCart || []).reduce((acc, i) => acc + (i.cost * i.quantityOrdered), 0).toFixed(2)}
                     </span>
                  </div>
                  <button
                     onClick={handleFinalizeOrder}
                     disabled={orderCart.length === 0}
                     className="w-full py-5 bg-indigo-600 active:bg-indigo-700 text-white rounded-2xl font-bold text-xl shadow-lg flex items-center justify-center gap-3 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                     <FileText size={24} /> Generar Orden
                  </button>
               </div>
            </div>
         </div>
      );
   };

   const renderTrackingModal = (activeOrder: PurchaseOrder) => {
      if (!pendingTracking) return null;

      const saveTracking = () => {
         onUpdateOrder({
            ...activeOrder,
            items: (activeOrder.items || []).map(i => {
               if (i.variantSku === pendingTracking.itemId || (i.productId === pendingTracking.itemId && !i.variantSku)) {
                  return { ...i, quantityReceived: pendingTracking.quantity, trackingData: pendingTracking.data };
               }
               return i;
            })
         });
         setPendingTracking(null);
      };

      const updateTrack = (idx: number, field: string, value: string) => {
         const newData = [...pendingTracking.data];
         if (!newData[idx]) newData[idx] = { trackingCode: '' };
         newData[idx] = { ...newData[idx], [field]: value };
         setPendingTracking({ ...pendingTracking, data: newData });
      };

      return (
         <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
               <div className="p-8 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                     <div className="p-4 rounded-2xl bg-blue-100 text-blue-600">
                        {pendingTracking.type === 'LOTE' ? <Calendar size={32} /> : <ScanBarcode size={32} />}
                     </div>
                     <div>
                        <h2 className="text-xl font-black text-gray-800 tracking-tight">Trazabilidad: {pendingTracking.type}</h2>
                        <p className="text-sm font-bold text-gray-400 truncate max-w-[200px]">{pendingTracking.productName}</p>
                     </div>
                  </div>
                  <button onClick={() => setPendingTracking(null)} className="p-3 bg-white hover:bg-gray-100 rounded-2xl text-gray-400">
                     <X size={24} />
                  </button>
               </div>

               <div className="flex-1 overflow-y-auto p-8 space-y-6">
                  {pendingTracking.type === 'LOTE' ? (
                     <div className="space-y-4">
                        <div className="space-y-2">
                           <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Código de Lote</label>
                           <input
                              className="w-full bg-gray-50 rounded-2xl p-4 border border-gray-100 font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
                              placeholder="Ej: LOTE-2024-001"
                              value={pendingTracking.data[0]?.trackingCode || ''}
                              onChange={e => updateTrack(0, 'trackingCode', e.target.value)}
                           />
                        </div>
                        <div className="space-y-2">
                           <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Fecha de Vencimiento</label>
                           <input
                              type="date"
                              className="w-full bg-gray-50 rounded-2xl p-4 border border-gray-100 font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
                              value={pendingTracking.data[0]?.expirationDate || ''}
                              onChange={e => updateTrack(0, 'expirationDate', e.target.value)}
                           />
                        </div>
                     </div>
                  ) : (
                     <div className="space-y-4">
                        <p className="text-sm text-gray-500 mb-4">Ingrese {pendingTracking.quantity} números de serie únicos:</p>
                        {Array.from({ length: pendingTracking.quantity }).map((_, i) => (
                           <div key={i} className="flex items-center gap-3">
                              <span className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-full text-[10px] font-black text-gray-400 shrink-0">{i + 1}</span>
                              <input
                                 className="flex-1 bg-gray-50 rounded-xl p-3 border border-gray-100 font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
                                 placeholder="Escanee o digite serie..."
                                 value={pendingTracking.data[i]?.trackingCode || ''}
                                 onChange={e => updateTrack(i, 'trackingCode', e.target.value)}
                              />
                           </div>
                        ))}
                     </div>
                  )}
               </div>

               <div className="p-8 bg-gray-50 border-t border-gray-100">
                  <button
                     onClick={saveTracking}
                     disabled={pendingTracking.type === 'SERIE' && pendingTracking.data.filter(d => d.trackingCode).length < pendingTracking.quantity}
                     className="w-full py-4 bg-blue-600 active:bg-blue-700 text-white rounded-2xl font-bold text-lg shadow-lg disabled:opacity-50"
                  >
                     Confirmar Trazabilidad
                  </button>
               </div>
            </div>
         </div>
      );
   };

   const renderReception = () => {
      // 1. Specific Order Reception Form
      if (receivingOrderId) {
         const order = (safeOrders || []).find(o => o.id === receivingOrderId);
         if (!order) return <div>Error: Orden no encontrada</div>;

         if (order.status === 'COMPLETED') {
            return (
               <div className="h-full flex flex-col items-center justify-center bg-white rounded-[3rem] border border-gray-200 p-12 text-center animate-in zoom-in-95">
                  <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
                     <Check size={48} />
                  </div>
                  <h3 className="text-3xl font-black text-gray-800 mb-2">Orden Finalizada</h3>
                  <p className="text-gray-500 max-w-md mx-auto mb-8 font-medium">
                     Esta orden ya ha sido recibida completamente y no permite más modificaciones.
                  </p>
                  <button
                     onClick={() => setReceivingOrderId(null)}
                     className="px-8 py-4 bg-gray-900 text-white rounded-2xl font-bold flex items-center gap-2 hover:scale-105 transition-all"
                  >
                     <ArrowLeft size={20} /> Volver al Historial
                  </button>
               </div>
            );
         }

         const updateItemReceived = (itemIdOrSku: string, newVal: number) => {
            const product = safeProducts.find(p => p.id === itemIdOrSku || p.variants?.some(v => v.sku === itemIdOrSku));
            const usesLots = product?.operationalFlags?.usesLots;
            const usesSerial = product?.operationalFlags?.usesSerial;

            const currentItem = (order.items || []).find(i => i.variantSku === itemIdOrSku || (i.productId === itemIdOrSku && !i.variantSku));
            const currentQty = currentItem?.quantityReceived || 0;

            if (newVal > currentQty) {
               const targetWarehouseId = order.warehouseId || config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';
               const validation = validateWarehouseAccess(product!, targetWarehouseId);
               if (!validation.isValid) {
                  const whName = (config.terminals || [])
                     .find(t => t.config.inventoryScope?.defaultSalesWarehouseId === targetWarehouseId || t.config.inventoryScope?.visibleWarehouseIds?.includes(targetWarehouseId))
                     ?.config.inventoryScope?.defaultSalesWarehouseId === targetWarehouseId ? 'Almacén Principal' : 'Almacén Destino';
                  alert(`🚫 Recepción Bloqueada:\n\nEl artículo "${product!.name}" no está habilitado en el almacén de entrada.\n\nPor favor, active el almacén en la ficha del producto antes de proceder.`);
                  return;
               }
            }

            if (newVal > currentQty && (usesLots || usesSerial)) {
               setPendingTracking({
                  itemId: itemIdOrSku,
                  productId: product!.id,
                  productName: product!.name,
                  quantity: newVal,
                  type: usesLots ? 'LOTE' : 'SERIE',
                  data: currentItem?.trackingData || []
               });
               return;
            }

            onUpdateOrder({
               ...order,
               items: (order.items || []).map(i => {
                  const matches = i.variantSku === itemIdOrSku || (i.productId === itemIdOrSku && !i.variantSku);
                  return matches ? { ...i, quantityReceived: Math.max(0, newVal) } : i;
               })
            });
         };



         const confirmReception = async () => {
            try {
               const hasAnyReceived = (order.items || []).some(i => i.quantityReceived > 0);
               if (!hasAnyReceived) {
                  alert("No ha indicado ninguna cantidad recibida.");
                  return;
               }

               const targetWarehouseId = order.warehouseId || config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';

               const saveTrackingRecords = async (items: PurchaseOrderItem[]) => {
                  for (const item of items) {
                     if (item.trackingData && item.trackingData.length > 0) {
                        const itemProduct = safeProducts.find(p => p.id === item.productId);
                        for (const track of item.trackingData) {
                           await db.saveDocument('inventoryTracking', {
                              id: track.id || Math.random().toString(36).substr(2, 9),
                              productId: item.productId,
                              warehouseId: targetWarehouseId,
                              type: itemProduct?.operationalFlags?.usesLots ? 'LOTE' : 'SERIE',
                              trackingCode: track.trackingCode,
                              expirationDate: track.expirationDate,
                              status: 'AVAILABLE',
                              receivedAt: new Date().toISOString(),
                              receptionId: order.id
                           });
                        }
                     }
                  }
               };

               const isPartial = (order.items || []).some(i => i.quantityReceived < i.quantityOrdered);

               if (isPartial) {
                  const keepPending = true;
                  await onReceiveStock(order.items, order.id);
                  await saveTrackingRecords(order.items);

                  if (keepPending) {
                     const updatedItems = (order.items || []).map(i => {
                        const remaining = Math.max(0, i.quantityOrdered - i.quantityReceived);
                        return {
                           ...i,
                           quantityOrdered: remaining,
                           quantityReceived: 0,
                           trackingData: []
                        };
                     }).filter(i => i.quantityOrdered > 0);

                     if (updatedItems.length === 0) {
                        await onUpdateOrder({ ...order, items: updatedItems, status: 'COMPLETED' });
                     } else {
                        await onUpdateOrder({ ...order, items: updatedItems, status: 'PARTIAL' });
                     }
                  } else {
                     await onUpdateOrder({ ...order, status: 'COMPLETED' });
                  }
               } else {
                  await onReceiveStock(order.items, order.id);
                  await saveTrackingRecords(order.items);
                  await onUpdateOrder({ ...order, status: 'COMPLETED' });
               }

               setReceivingOrderId(null);
               setIsReceivingOrder(false);
            } catch (error: any) {
               console.error("❌ SCM: Error in confirmReception:", error);
               alert("Error al confirmar la recepción. Ver consola.");
            }
         };

         return (
            <div className="h-full flex flex-col animate-in slide-in-from-right-4">
               <div className="flex items-center gap-4 mb-6 bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                  <button onClick={() => setReceivingOrderId(null)} className="p-3 bg-gray-100 rounded-xl hover:bg-gray-200">
                     <ArrowLeft size={24} />
                  </button>
                  <div>
                     <h3 className="text-xl font-bold text-gray-800">Recibiendo Orden #{order.id}</h3>
                     <p className="text-sm text-gray-500">{formatSafeDate(order.date)}</p>
                  </div>
               </div>

               <div className="flex flex-col md:flex-row gap-3 p-4 bg-white rounded-2xl border border-gray-200 shadow-sm mb-4">
                  <div className="relative flex-1">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                     <input
                        type="text"
                        placeholder="Buscar en esta orden..."
                        value={receptionSearch}
                        onChange={(e) => setReceptionSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-green-500/20"
                     />
                  </div>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar">
                     {activeReceptionCategories.map(cat => (
                        <button
                           key={cat}
                           onClick={() => setReceptionCategory(cat)}
                           className={`px-4 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${receptionCategory === cat
                              ? 'bg-green-600 text-white shadow-sm'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200 h-8 flex items-center'
                              }`}
                        >
                           {cat}
                        </button>
                     ))}
                  </div>
               </div>

               <div className="flex-1 overflow-y-auto space-y-3 pb-20">
                  {((order.items || []).filter(item => {
                     const p = safeProducts.find(prod => prod.id === item.productId);
                     const matchesSearch = item.productName.toLowerCase().includes(receptionSearch.toLowerCase());
                     const matchesCategory = receptionCategory === 'Todas' || p?.category === receptionCategory;
                     return matchesSearch && matchesCategory;
                  })).map((item, idx) => {
                     const isComplete = item.quantityReceived >= item.quantityOrdered;

                     return (
                        <div
                           key={item.variantSku ? `${item.productId}_${item.variantSku}` : item.productId || `rec-${idx}`}
                           className={`p-4 rounded-2xl border-2 transition-all flex flex-col gap-3 ${isComplete
                              ? 'bg-green-50 border-green-500 shadow-sm'
                              : item.quantityReceived > 0 ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'
                              }`}
                        >
                           <div className="flex justify-between items-start">
                              <div>
                                 <h4 className="font-bold text-gray-800 text-lg">{item.productName}</h4>
                                 {item.variantInfo && <p className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-bold inline-block mb-1">{item.variantInfo}</p>}
                                 <p className="text-sm text-gray-500">Solicitado: <strong className="text-gray-900">{item.quantityOrdered}</strong></p>
                              </div>
                              {isComplete && <div className="bg-green-500 text-white p-1 rounded-full"><Check size={16} /></div>}
                           </div>

                           <div className="flex items-center gap-3">
                              <div className="flex items-center bg-white border border-gray-300 rounded-xl overflow-hidden shadow-sm flex-1 max-w-[200px]">
                                 <button
                                    onClick={() => updateItemReceived(item.variantSku || item.productId, item.quantityReceived - 1)}
                                    className="p-3 hover:bg-gray-100 text-gray-600 active:bg-gray-200 border-r border-gray-100"
                                 >
                                    <Minus size={20} />
                                 </button>
                                 <input
                                    type="number"
                                    value={item.quantityReceived}
                                    onChange={(e) => updateItemReceived(item.variantSku || item.productId, parseFloat(e.target.value) || 0)}
                                    className="flex-1 w-full text-center font-bold text-lg outline-none bg-transparent"
                                 />
                                 <button
                                    onClick={() => updateItemReceived(item.variantSku || item.productId, item.quantityReceived + 1)}
                                    className="p-3 hover:bg-gray-100 text-blue-600 active:bg-gray-200 border-l border-gray-100"
                                 >
                                    <Plus size={20} />
                                 </button>
                              </div>

                              <button
                                 onClick={() => updateItemReceived(item.variantSku || item.productId, item.quantityOrdered)}
                                 className="text-xs font-bold text-blue-600 underline hover:text-blue-800 px-2"
                              >
                                 Todo
                              </button>
                           </div>
                        </div>
                     );
                  })}
               </div>

               <div className="p-6 bg-white border-t border-gray-200 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] mt-auto">
                  <button
                     onClick={confirmReception}
                     className="w-full py-5 bg-green-600 active:bg-green-700 text-white rounded-2xl font-bold text-xl shadow-lg flex items-center justify-center gap-3 transition-transform active:scale-[0.98]"
                  >
                     <Package size={24} />
                     Confirmar Recepción
                  </button>
               </div>
               {renderTrackingModal(order)}
            </div>
         );
      }

      // 2. Pending Orders Selection List
      if (isReceivingOrder) {
         return (
            <div className="animate-in fade-in h-full overflow-y-auto pb-20">
               <div className="flex items-center gap-4 mb-6">
                  <button onClick={() => setIsReceivingOrder(false)} className="p-3 bg-white rounded-xl shadow-sm hover:bg-gray-50">
                     <ArrowLeft size={24} />
                  </button>
                  <h3 className="text-xl font-bold text-gray-800">Órdenes Pendientes</h3>
               </div>
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {activeOrders.length === 0 ? (
                     <div className="col-span-full py-32 text-center text-gray-400 bg-gray-50 rounded-[3rem] border-4 border-dashed border-gray-200">
                        <ClipboardList size={64} className="mx-auto mb-4 opacity-30" />
                        <p className="text-xl font-bold">No hay órdenes pendientes</p>
                        <button onClick={() => setActiveTab('CREATE')} className="mt-4 text-blue-600 font-bold">Crear nueva orden</button>
                     </div>
                  ) : (
                     (activeOrders || []).map((po, idx) => {
                        const supplier = (safeSuppliers || []).find(s => s.id === po.supplierId);
                        const items = po.items || [];
                        const progress = items.reduce((acc, i) => acc + i.quantityReceived, 0) / Math.max(1, items.reduce((acc, i) => acc + i.quantityOrdered, 0)) * 100;

                        return (
                           <div key={po.id || `po-${idx}`} onClick={() => setReceivingOrderId(po.id)} className="bg-white p-6 rounded-[2rem] border border-gray-200 shadow-sm active:scale-[0.98] transition-all cursor-pointer relative overflow-hidden group">
                              <div className="absolute top-0 left-0 w-2 h-full bg-blue-500"></div>

                              <div className="flex justify-between items-start mb-4 pl-4">
                                 <div>
                                    <h4 className="text-2xl font-bold text-gray-800">#{po.id}</h4>
                                    <p className="text-gray-500 font-medium">{supplier?.name}</p>
                                 </div>
                                 <div className="bg-blue-50 text-blue-700 px-3 py-1 rounded-lg font-bold text-sm">
                                    {formatSafeDate(po.date)}
                                 </div>
                              </div>

                              <div className="pl-4 mb-6">
                                 <div className="flex justify-between items-end">
                                    <div>
                                       <p className="text-xs text-gray-400 uppercase font-bold mb-1">Progreso</p>
                                       <div className="flex items-center gap-2">
                                          <span className="text-3xl font-black text-gray-800">{Math.round(progress)}%</span>
                                       </div>
                                    </div>
                                    <div className="text-right">
                                       <p className="text-xs text-gray-400 uppercase font-bold mb-1">Total</p>
                                       <p className="text-xl font-bold text-gray-600">{config.currencySymbol}{po.totalCost.toFixed(2)}</p>
                                    </div>
                                 </div>
                                 <div className="w-full bg-gray-100 h-3 rounded-full mt-3 overflow-hidden">
                                    <div className="bg-blue-500 h-full rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
                                 </div>
                              </div>

                              <div className="pl-4 pt-4 border-t border-gray-100 flex justify-end gap-3">
                                 <button
                                    onClick={(e) => { e.stopPropagation(); handleSendEmail(po); }}
                                    className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors flex items-center gap-2"
                                 >
                                    <Mail size={16} /> {po.sentAt ? 'Reenviar' : 'Enviar Email'}
                                 </button>
                                 <span className="text-blue-600 font-bold flex items-center gap-2 group-hover:gap-4 transition-all">
                                    Recibir Mercancía <ArrowRight size={20} />
                                 </span>
                              </div>
                           </div>
                        );
                     })
                  )}
               </div>
            </div>
         );
      }

      // 3. Default: Reception History List
      return (
         <div className="flex flex-col h-full">
            <div className="flex justify-between items-center mb-6">
               <h2 className="text-xl font-bold text-gray-800">Historial de Recepciones</h2>
               <button
                  onClick={() => setIsReceivingOrder(true)}
                  className="px-6 py-3 bg-green-600 text-white rounded-xl font-bold shadow-lg hover:bg-green-700 transition-all flex items-center gap-2"
               >
                  <Plus size={20} /> Nueva Recepción
               </button>
            </div>
            <ReceptionHistory
               receptions={safeReceptions}
               config={config}
               suppliers={safeSuppliers}
               purchaseOrders={safeOrders}
               products={safeProducts}
               onDeleteReception={onDeleteReception}
               onDeleteOrder={onDeleteOrder}
            />
         </div>
      );
   };

   const renderSupplierModal = () => {
      if (!editingSupplier) return null;

      const isOverLimit = editingSupplier.balance > editingSupplier.creditLimit && editingSupplier.creditLimit > 0;
      const nearLimit = editingSupplier.balance > (editingSupplier.creditLimit * 0.9) && editingSupplier.creditLimit > 0;
      const editingSupplierImage = resolveSupplierImageSrc(editingSupplier);

      return (
         <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
               {/* Modal Header */}
               <div className="p-8 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                     {editingSupplierImage ? (
                        <img
                           src={editingSupplierImage}
                           alt={editingSupplier.name}
                           className="w-16 h-16 rounded-2xl object-cover border border-indigo-100 bg-white shadow-sm"
                        />
                     ) : (
                        <div className={`p-4 rounded-2xl ${isOverLimit ? 'bg-red-100 text-red-600' : 'bg-indigo-100 text-indigo-600'}`}>
                           <Truck size={32} />
                        </div>
                     )}
                     <div>
                        <h2 className="text-2xl font-black text-gray-800 tracking-tight">Gestión de Proveedor</h2>
                        <div className="flex items-center gap-2 mt-1">
                           <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{editingSupplier.id}</span>
                           {isOverLimit && (
                              <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full font-black animate-pulse flex items-center gap-1">
                                 <ShieldAlert size={10} /> LÍMITE EXCEDIDO
                              </span>
                           )}
                        </div>
                     </div>
                  </div>
                  <button onClick={() => setEditingSupplier(null)} className="p-3 bg-white hover:bg-gray-100 rounded-2xl text-gray-400 transition-all shadow-sm">
                     <X size={24} />
                  </button>
               </div>

               {/* Modal Tabs */}
               <div className="flex px-8 bg-gray-50/50 border-b border-gray-100">
                  {(['GENERAL', 'FINANCIAL', 'HISTORY'] as const).map(tab => (
                     <button
                        key={tab}
                        onClick={() => setSupplierModalTab(tab)}
                        className={`py-4 px-6 text-xs font-black uppercase tracking-widest border-b-4 transition-all ${supplierModalTab === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-600'
                           }`}
                     >
                        {tab === 'GENERAL' ? 'Información General' : tab === 'FINANCIAL' ? 'Gestión Financiera' : 'Catálogo de Precios'}
                     </button>
                  ))}
               </div>

               {/* Modal Content */}
               <div className="flex-1 overflow-y-auto p-8">
                  {supplierModalTab === 'GENERAL' && (
                     <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
                        <div className="grid grid-cols-2 gap-6">
                           <div className="space-y-2">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nombre Comercial</label>
                              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 focus-within:border-indigo-500 transition-all">
                                 <input
                                    className="w-full bg-transparent font-bold text-gray-800 placeholder:text-gray-300 outline-none"
                                    value={editingSupplier.name}
                                    onChange={e => setEditingSupplier({ ...editingSupplier, name: e.target.value })}
                                 />
                              </div>
                           </div>
                           <div className="space-y-2">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">RNC / Cédula</label>
                              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 focus-within:border-indigo-500 transition-all flex items-center gap-3">
                                 <Landmark size={18} className="text-gray-300" />
                                 <input
                                    className="w-full bg-transparent font-bold text-gray-800 placeholder:text-gray-300 outline-none"
                                    value={editingSupplier.taxId}
                                    onChange={e => setEditingSupplier({ ...editingSupplier, taxId: e.target.value })}
                                 />
                              </div>
                           </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                           <div className="space-y-2">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Correo Electrónico</label>
                              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 focus-within:border-indigo-500 transition-all flex items-center gap-3">
                                 <Mail size={18} className="text-gray-300" />
                                 <input
                                    className="w-full bg-transparent font-bold text-gray-800 placeholder:text-gray-300 outline-none"
                                    value={editingSupplier.email}
                                    onChange={e => setEditingSupplier({ ...editingSupplier, email: e.target.value })}
                                 />
                              </div>
                           </div>
                           <div className="space-y-2">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Teléfono</label>
                              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 focus-within:border-indigo-500 transition-all flex items-center gap-3">
                                 <Phone size={18} className="text-gray-300" />
                                 <input
                                    className="w-full bg-transparent font-bold text-gray-800 placeholder:text-gray-300 outline-none"
                                    value={editingSupplier.phone}
                                    onChange={e => setEditingSupplier({ ...editingSupplier, phone: e.target.value })}
                                 />
                              </div>
                           </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                           <div className="space-y-2">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Persona de Contacto</label>
                              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 focus-within:border-indigo-500 transition-all flex items-center gap-3">
                                 <User size={18} className="text-gray-300" />
                                 <input
                                    className="w-full bg-transparent font-bold text-gray-800 placeholder:text-gray-300 outline-none"
                                    value={editingSupplier.contactPerson}
                                    onChange={e => setEditingSupplier({ ...editingSupplier, contactPerson: e.target.value })}
                                 />
                              </div>
                           </div>
                           <div className="space-y-2">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Lead Time (Días)</label>
                              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 focus-within:border-indigo-500 transition-all flex items-center gap-3">
                                 <Clock size={18} className="text-gray-300" />
                                 <input
                                    type="number"
                                    className="w-full bg-transparent font-bold text-gray-800 placeholder:text-gray-300 outline-none"
                                    value={editingSupplier.leadTimeDays}
                                    onChange={e => setEditingSupplier({ ...editingSupplier, leadTimeDays: parseInt(e.target.value) || 0 })}
                                 />
                              </div>
                           </div>
                        </div>
                     </div>
                  )}

                  {supplierModalTab === 'FINANCIAL' && (
                     <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
                        <div className="bg-amber-50 rounded-3xl p-6 border border-amber-100 flex items-start gap-4">
                           <div className="p-3 bg-amber-100 text-amber-600 rounded-2xl">
                              <Info size={24} />
                           </div>
                           <div>
                              <p className="text-sm font-bold text-amber-800">Condiciones de Crédito</p>
                              <p className="text-xs text-amber-600 mt-1">Defina los límites y plazos acordados con este proveedor para el control automático de cuentas por pagar.</p>
                           </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                           <div className="space-y-2">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Forma de Pago Habitual</label>
                              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 focus-within:border-indigo-500 transition-all flex items-center gap-3">
                                 <CreditCard size={18} className="text-gray-300" />
                                 <select
                                    className="w-full bg-transparent font-bold text-gray-800 outline-none"
                                    value={editingSupplier.paymentMethod}
                                    onChange={e => setEditingSupplier({ ...editingSupplier, paymentMethod: e.target.value as any })}
                                 >
                                    <option value="CASH">Efectivo</option>
                                    <option value="TRANSFER">Transferencia</option>
                                    <option value="CARD">Tarjeta</option>
                                    <option value="CREDIT">Crédito</option>
                                 </select>
                              </div>
                           </div>
                           <div className="space-y-2">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Días de Crédito</label>
                              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 focus-within:border-indigo-500 transition-all flex items-center gap-3">
                                 <Calendar size={18} className="text-gray-300" />
                                 <input
                                    type="number"
                                    className="w-full bg-transparent font-bold text-gray-800 outline-none"
                                    value={editingSupplier.paymentTermDays}
                                    onChange={e => setEditingSupplier({ ...editingSupplier, paymentTermDays: parseInt(e.target.value) || 0 })}
                                 />
                              </div>
                           </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                           <div className="space-y-2">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Límite de Crédito</label>
                              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 focus-within:border-indigo-500 transition-all flex items-center gap-3">
                                 <DollarSign size={18} className="text-gray-300" />
                                 <input
                                    type="number"
                                    className="w-full bg-transparent font-bold text-gray-800 outline-none"
                                    value={editingSupplier.creditLimit}
                                    onChange={e => setEditingSupplier({ ...editingSupplier, creditLimit: parseFloat(e.target.value) || 0 })}
                                 />
                              </div>
                           </div>
                           <div className="space-y-2">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Deuda Actual</label>
                              <div className={`rounded-2xl p-4 border transition-all flex items-center gap-3 ${nearLimit ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100'}`}>
                                 <History size={18} className={nearLimit ? 'text-red-400' : 'text-gray-300'} />
                                 <input
                                    type="number"
                                    className={`w-full bg-transparent font-black outline-none ${nearLimit ? 'text-red-600' : 'text-gray-800'}`}
                                    value={editingSupplier.balance}
                                    readOnly
                                 />
                              </div>
                           </div>
                        </div>
                     </div>
                  )}

                  {supplierModalTab === 'HISTORY' && (
                     <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-4">
                        <div className="flex items-center justify-between mb-4">
                           <div className="flex items-center gap-2">
                              <Archive size={20} className="text-gray-400" />
                              <h3 className="text-sm font-bold text-gray-700">Catálogo de Precios del Proveedor</h3>
                           </div>
                           <span className="text-[10px] font-black text-gray-400 uppercase bg-gray-100 px-2 py-1 rounded">Últimos Costos</span>
                        </div>

                        {(!supplierProductPrices || supplierProductPrices.filter(p => p.supplierId === editingSupplier.id).length === 0) ? (
                           <div className="text-center py-12 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-100">
                              <Archive size={48} className="mx-auto text-gray-200 mb-4" />
                              <p className="text-sm font-bold text-gray-400 px-8">El catálogo de precios se alimenta automáticamente al recibir mercancía.</p>
                           </div>
                        ) : (
                           <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
                              <table className="w-full text-left border-collapse">
                                 <thead className="bg-gray-50 border-b border-gray-100">
                                    <tr>
                                       <th className="px-4 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Producto</th>
                                       <th className="px-4 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Costo Unit.</th>
                                       <th className="px-4 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Actualizado</th>
                                    </tr>
                                 </thead>
                                 <tbody className="divide-y divide-gray-50">
                                    {supplierProductPrices
                                       .filter(p => p.supplierId === editingSupplier.id)
                                       .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                                       .map((price, idx) => {
                                          const product = safeProducts.find(p => p.id === price.productId);
                                          return (
                                             <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                                                <td className="px-4 py-4">
                                                   <p className="font-bold text-gray-800 text-sm">{product?.name || 'Producto Desconocido'}</p>
                                                   <p className="text-[10px] text-gray-400 font-mono">{price.productId}</p>
                                                </td>
                                                <td className="px-4 py-4 text-right">
                                                   <span className="font-mono font-black text-gray-900">{config.currencySymbol}{price.lastCost.toFixed(2)}</span>
                                                </td>
                                                <td className="px-4 py-4 text-right">
                                                   <p className="text-xs text-gray-500 font-medium">{formatSafeDate(price.updatedAt)}</p>
                                                </td>
                                             </tr>
                                          );
                                       })}
                                 </tbody>
                              </table>
                           </div>
                        )}
                     </div>
                  )}
               </div>

               {/* Modal Footer */}
               <div className="p-8 bg-gray-50 border-t border-gray-100 flex justify-between gap-4">
                  <button
                     onClick={async () => {
                        if (await clicConfirm(`¿Está seguro que desea eliminar al proveedor "${editingSupplier.name}"?\n\nEsta acción no se puede deshacer.`)) {
                           // Set loading or similar? No simple state for it.
                           await onDeleteSupplier(editingSupplier.id);
                           setEditingSupplier(null);
                        }
                     }}
                     className="px-6 py-4 bg-red-100 text-red-600 font-bold rounded-2xl hover:bg-red-200 transition-all flex items-center gap-2"
                  >
                     <Trash2 size={18} /> Eliminar Proveedor
                  </button>
                  <div className="flex gap-4">
                     <button onClick={() => setEditingSupplier(null)} className="px-8 py-4 bg-white text-gray-400 font-bold rounded-2xl hover:bg-gray-100 transition-all">
                        Cancelar
                     </button>
                     <button
                        onClick={async () => {
                           const isNew = !safeSuppliers.find(s => s.id === editingSupplier.id);
                           try {
                              if (isNew) {
                                 await onAddSupplier(editingSupplier);
                              } else {
                                 onUpdateSupplier(editingSupplier);
                              }
                              setEditingSupplier(null);
                           } catch (error) {
                              alert(error instanceof Error ? error.message : 'No se pudo crear el proveedor.');
                           }
                        }}
                        className="px-10 py-4 bg-indigo-600 text-white font-black uppercase tracking-widest text-xs rounded-2xl shadow-xl shadow-indigo-100 hover:bg-indigo-500 transition-all flex items-center gap-2"
                     >
                        <Save size={18} /> Guardar Cambios
                     </button>
                  </div>
               </div>
            </div>
         </div>
      );
   };

   const renderSuppliers = () => (
      <div className="animate-in fade-in slide-in-from-right-4 pb-20">
         <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-800">Catálogo de Proveedores</h2>
            <button
               onClick={() => {
                  const newSup: Supplier = {
                     id: createUuid(),
                     name: '',
                     taxId: '',
                     email: '',
                     phone: '',
                     contactPerson: '',
                     paymentMethod: 'CASH',
                     paymentTermDays: 0,
                     creditLimit: 0,
                     balance: 0,
                     leadTimeDays: 7,
                     isActive: true
                  };
                  setEditingSupplier(newSup);
                  setSupplierModalTab('GENERAL');
               }}
               className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-500 transition-all flex items-center gap-2"
            >
               <Plus size={20} /> Nuevo Proveedor
            </button>
         </div>

         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {safeSuppliers.map(supplier => {
               const isOverLimit = (supplier.balance || 0) > (supplier.creditLimit || 0) && (supplier.creditLimit || 0) > 0;
               const supplierImage = resolveSupplierImageSrc(supplier);

               return (
                  <div key={supplier.id} onClick={() => { setEditingSupplier(supplier); setSupplierModalTab('GENERAL'); }} className={`group relative bg-white p-6 rounded-[2rem] shadow-sm border transition-all cursor-pointer hover:shadow-xl hover:-translate-y-1 ${isOverLimit ? 'border-red-100 bg-red-50/10' : 'border-gray-100 hover:border-indigo-100'}`}>
                     <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                           {supplierImage ? (
                              <img
                                 src={supplierImage}
                                 alt={supplier.name}
                                 className="w-12 h-12 rounded-2xl object-cover border border-indigo-100 bg-white"
                              />
                           ) : (
                              <div className={`p-3 rounded-2xl transition-colors ${isOverLimit ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400 group-hover:bg-indigo-100 group-hover:text-indigo-600'}`}>
                                 <Truck size={24} />
                              </div>
                           )}
                           <div>
                              <p className="font-black text-gray-800 tracking-tight leading-none mb-1">{supplier.name}</p>
                              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{supplier.id}</p>
                           </div>
                        </div>
                        <div className={`px-2 py-0.5 rounded-full text-[9px] font-black tracking-widest border ${supplier.isActive ? 'bg-green-50 text-green-600 border-green-100' : 'bg-gray-50 text-gray-400 border-gray-100'}`}>
                           {supplier.isActive ? 'ACTIVO' : 'OFFLINE'}
                        </div>
                     </div>

                     <div className="space-y-3">
                        <div className="flex justify-between items-center text-[10px] font-bold">
                           <span className="text-gray-400 uppercase tracking-widest">Balance Pendiente</span>
                           <span className={`font-mono ${isOverLimit ? 'text-red-600' : (supplier.balance || 0) > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                              ${(supplier.balance || 0).toLocaleString()}
                           </span>
                        </div>

                        {(supplier.creditLimit || 0) > 0 && (
                           <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                 className={`h-full rounded-full transition-all ${isOverLimit ? 'bg-red-500' : 'bg-indigo-500'}`}
                                 style={{ width: `${Math.min(100, ((supplier.balance || 0) / (supplier.creditLimit || 1)) * 100)}%` }}
                              />
                           </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-gray-50">
                           <div className="text-[9px]">
                              <p className="text-gray-400 uppercase font-black tracking-widest mb-1">Días Crédito</p>
                              <p className="text-gray-700 font-bold">{supplier.paymentTermDays || 0} Días</p>
                           </div>
                           <div className="text-[9px]">
                              <p className="text-gray-400 uppercase font-black tracking-widest mb-1">Lead Time</p>
                              <p className="text-gray-700 font-bold">{supplier.leadTimeDays || 0} Días</p>
                           </div>
                        </div>
                     </div>

                     <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                           onClick={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (await clicConfirm(`¿Eliminar proveedor "${supplier.name}"?`)) {
                                 await onDeleteSupplier(supplier.id);
                              }
                           }}
                           className="bg-red-500 text-white p-2 rounded-xl shadow-lg hover:bg-red-600 transition-colors"
                           title="Eliminar Proveedor"
                        >
                           <Trash2 size={16} />
                        </button>
                        <div className="bg-indigo-600 text-white p-2 rounded-xl shadow-lg">
                           <Save size={16} />
                        </div>
                     </div>
                  </div>
               );
            })}
         </div>
         {safeSuppliers.length === 0 && (
            <div className="py-20 text-center opacity-30">
               <Truck size={64} className="mx-auto mb-4" />
               <p className="font-bold">No hay proveedores registrados.</p>
            </div>
         )}
      </div>
   );

   return (
      <ErrorBoundary componentName="SupplyChainManager">
         <div className="h-screen w-full bg-gray-50 flex flex-col overflow-hidden">

            {/* Header */}
            <header className="bg-white border-b border-gray-200 p-4 shadow-sm z-30 flex justify-between items-center shrink-0">
               <div className="flex items-center gap-4">
                  <button onClick={onClose} className="p-3 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-600 transition-colors">
                     <ArrowLeft size={24} />
                  </button>
                  <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                     <Truck size={24} className="text-blue-600" />
                     <span className="hidden md:inline">Abastecimiento</span>
                  </h1>
               </div>

               {/* Navigation Tabs (Big Touch Targets) */}
               <div className="flex gap-2 overflow-x-auto no-scrollbar max-w-[70vw]">
                  <button
                     onClick={() => setActiveTab('CREATE')}
                     className={`px-5 py-2.5 rounded-xl border text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap ${activeTab === 'CREATE' ? 'border-[#00A7A0] bg-white text-indigo-600 shadow-md' : 'text-gray-500'}`}
                  >
                     <ShoppingCart size={20} /> Pedido
                  </button>
                  <button
                     onClick={() => setActiveTab('RECEIVE')}
                     className={`px-5 py-2.5 rounded-xl border text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap ${activeTab === 'RECEIVE' ? 'border-[#00A7A0] bg-white text-green-600 shadow-md' : 'text-gray-500'}`}
                  >
                     <Archive size={20} /> Recepción
                     {activeOrders.length > 0 && <span className="bg-green-500 text-white text-[10px] px-1.5 rounded-full">{activeOrders.length}</span>}
                  </button>

                  <button
                     onClick={() => setActiveTab('ALERTS')}
                     className={`px-5 py-2.5 rounded-xl border text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap ${activeTab === 'ALERTS' ? 'border-[#00A7A0] bg-white text-red-600 shadow-md' : 'text-gray-500'}`}
                  >
                     <AlertTriangle size={20} /> Alertas
                     {lowStockProducts.length > 0 && <span className="bg-red-500 text-white text-[10px] px-1.5 rounded-full">{lowStockProducts.length}</span>}
                  </button>
                  <button
                     onClick={() => setActiveTab('SUPPLIERS')}
                     className={`px-5 py-2.5 rounded-xl border text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap ${activeTab === 'SUPPLIERS' ? 'border-[#00A7A0] bg-white text-orange-600 shadow-md' : 'text-gray-500'}`}
                  >
                     <Truck size={20} /> Proveedores
                  </button>
               </div>
            </header>

            {/* Main Content */}
            <div className="flex-1 overflow-hidden p-4 lg:p-6 w-full max-w-[1600px] mx-auto">
               <ErrorBoundary componentName={`Tab: ${activeTab}`}>
                  {activeTab === 'ALERTS' && renderAlerts()}
                  {activeTab === 'CREATE' && renderCreateOrder()}
                  {activeTab === 'RECEIVE' && renderReception()}

                  {activeTab === 'SUPPLIERS' && renderSuppliers()}
               </ErrorBoundary>
            </div>
         </div>
         {renderSupplierModal()}
         {selectedMatrixProduct && (
            <OrderMatrixModal
               isOpen={isMatrixOpen}
               onClose={() => {
                  setIsMatrixOpen(false);
                  setSelectedMatrixProduct(null);
               }}
               product={selectedMatrixProduct}
               config={config}
               onConfirm={addMatrixToCart}
            />
         )}
      </ErrorBoundary>
   );
};

export default SupplyChainManager;
