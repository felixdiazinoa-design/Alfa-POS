
import React, { useState } from 'react';
import {
   Gift, Tag, Package, Clock, Check, X, Save,
   CalendarDays, ShoppingBag, ArrowRight, Plus, Trash2, Edit, Monitor,
   TrendingUp, Lightbulb, BarChart3
} from 'lucide-react';
import { Product, BusinessConfig, Promotion, PromotionType, PromotionRecommendation, Transaction } from '../types';
import { calculateEffectiveness, generateRecommendations } from '../utils/promotionAnalytics';
import CouponManager from './CouponManager';
import { isValidRemoteMediaUrl } from '../utils/media';

interface PromotionBuilderProps {
   products: Product[];
   config: BusinessConfig;
   transactions: Transaction[];
   onClose: () => void;
   onUpdateConfig?: (newConfig: BusinessConfig) => void;
}

const PROMO_TYPES: { id: PromotionType; label: string; icon: any; color: string; description: string }[] = [
   {
      id: 'DISCOUNT',
      label: 'Descuento %',
      icon: Tag,
      color: 'bg-blue-500',
      description: 'Reduce el precio por un porcentaje.'
   },
   {
      id: 'BOGO',
      label: '2x1 (BOGO)',
      icon: Gift,
      color: 'bg-purple-500',
      description: 'Compra X y llévate Y gratis.'
   },
   {
      id: 'BUNDLE',
      label: 'Pack Ahorro',
      icon: Package,
      color: 'bg-orange-500',
      description: 'Precio especial al comprar varios items.'
   },
   {
      id: 'HAPPY_HOUR',
      label: 'Hora Feliz',
      icon: Clock,
      color: 'bg-pink-500',
      description: 'Descuentos activos solo en cierto horario.'
   },
   {
      id: 'CONDITIONAL_TARGET',
      label: 'Gasta y Gana',
      icon: ShoppingBag,
      color: 'bg-emerald-500',
      description: 'Gasta $X y recibe descuento en un artículo.'
   }
];

const DAYS = [
   { key: 'L', label: 'Lunes' },
   { key: 'M', label: 'Martes' },
   { key: 'X', label: 'Miércoles' },
   { key: 'J', label: 'Jueves' },
   { key: 'V', label: 'Viernes' },
   { key: 'S', label: 'Sábado' },
   { key: 'D', label: 'Domingo' }
];

const appendSelectedOption = (
   options: Array<{ value: string; label: string }>,
   selectedValue?: string,
   selectedLabel?: string,
) => {
   const value = typeof selectedValue === 'string' ? selectedValue.trim() : '';
   if (!value) return options;
   if (options.some((option) => option.value === value)) return options;
   return [{ value, label: selectedLabel || value }, ...options];
};

const isPromotionActive = (promotion: Promotion) => promotion.schedule?.isActive !== false;

const describePromotionTarget = (promotion: Promotion) => {
   if (promotion.targetType === 'ALL') {
      return 'Todo el inventario';
   }

   const label = typeof promotion.targetLabel === 'string' && promotion.targetLabel.trim()
      ? promotion.targetLabel.trim()
      : typeof promotion.targetValue === 'string' && promotion.targetValue.trim()
         ? promotion.targetValue.trim()
         : promotion.targetType;

   const typeLabelMap: Record<Exclude<Promotion['targetType'], 'ALL'>, string> = {
      PRODUCT: 'Producto',
      VARIANT: 'Variante',
      CATEGORY: 'Categoría',
      GROUP: 'Grupo',
      SEASON: 'Temporada',
   };

   return `${typeLabelMap[promotion.targetType as Exclude<Promotion['targetType'], 'ALL'>]}: ${label}`;
};

const PromotionBuilder: React.FC<PromotionBuilderProps> = ({ products, config, transactions, onClose, onUpdateConfig }) => {
   const [activeTab, setActiveTab] = useState<'PROMOTIONS' | 'COUPONS'>('PROMOTIONS');
   const [viewMode, setViewMode] = useState<'LIST' | 'EDIT'>('LIST');
   const [editingId, setEditingId] = useState<string | null>(null);

   // Form State
   const [promoName, setPromoName] = useState('');
   const [selectedType, setSelectedType] = useState<PromotionType>('DISCOUNT');
   const [targetType, setTargetType] = useState<Promotion['targetType']>('PRODUCT');
   const [targetValue, setTargetValue] = useState('');
   const [benefitValue, setBenefitValue] = useState<number>(0);
   const [activeDays, setActiveDays] = useState<string[]>(['L', 'M', 'X', 'J', 'V', 'S', 'D']);
   const [timeStart, setTimeStart] = useState('00:00');
   const [timeEnd, setTimeEnd] = useState('23:59');
   const [startDate, setStartDate] = useState('');
   const [endDate, setEndDate] = useState('');

   // Conditional Promo State
   const [triggerAmount, setTriggerAmount] = useState<number>(0);
   const [targetStrategyMode, setTargetStrategyMode] = useState<'CHEAPEST_ITEM' | 'MOST_EXPENSIVE_ITEM' | 'SLOW_MOVER' | 'CATEGORY_CHEAPEST'>('CHEAPEST_ITEM');
   const [targetStrategyValue, setTargetStrategyValue] = useState<string>('');

   const [isActive, setIsActive] = useState(true);
   const [priority, setPriority] = useState<number>(1);
   const [selectedTerminals, setSelectedTerminals] = useState<string[]>([]); // Empty = All
   const [videoUrl, setVideoUrl] = useState('');
   const [videoPosterUrl, setVideoPosterUrl] = useState('');

   // Computed Lists
   const categories = Array.from(new Set(products.map(p => p.category)));
   const seasons = config.seasons || [];
   const groups = config.productGroups || [];
   const promotions = config.promotions || [];
   const editingPromotion = editingId ? promotions.find((promo) => promo.id === editingId) : undefined;
   const productOptions = appendSelectedOption(
      products.map((p) => ({ value: p.id, label: p.name })),
      targetValue,
      editingPromotion?.targetLabel,
   );
   const categoryOptions = appendSelectedOption(
      categories.map((c) => ({ value: c, label: c })),
      targetValue,
      editingPromotion?.targetLabel,
   );
   const seasonOptions = appendSelectedOption(
      seasons.map((s) => ({ value: s.id, label: s.name })),
      targetValue,
      editingPromotion?.targetLabel,
   );
   const groupOptions = appendSelectedOption(
      groups.map((g) => ({ value: g.id, label: g.name })),
      targetValue,
      editingPromotion?.targetLabel,
   );

   // Handlers
   const toggleDay = (day: string) => {
      setActiveDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
   };

   const handleCreateNew = () => {
      setEditingId(null);
      setPromoName('');
      setSelectedType('DISCOUNT');
      setTargetType('PRODUCT');
      setTargetValue('');
      setBenefitValue(0);
      setActiveDays(['L', 'M', 'X', 'J', 'V', 'S', 'D']);
      setTimeStart('00:00');
      setTimeEnd('23:59');
      setStartDate('');
      setEndDate('');
      setTriggerAmount(0);
      setTargetStrategyMode('CHEAPEST_ITEM');
      setTargetStrategyValue('');
      setIsActive(true);
      setPriority(1);
      setSelectedTerminals([]);
      setVideoUrl('');
      setVideoPosterUrl('');
      setViewMode('EDIT');
   };

   const handleEdit = (promo: Promotion) => {
      setEditingId(promo.id);
      setPromoName(promo.name);
      setSelectedType(promo.type);
      setTargetType(promo.targetType);
      setTargetValue(promo.targetValue);
      setBenefitValue(promo.benefitValue);
      setActiveDays(promo.schedule.days);
      setTimeStart(promo.schedule.startTime);
      setTimeEnd(promo.schedule.endTime);
      setStartDate(promo.schedule.startDate || '');
      setEndDate(promo.schedule.endDate || '');
      setTriggerAmount(promo.trigger?.value || 0);
      setTargetStrategyMode(promo.targetStrategy?.mode || 'CHEAPEST_ITEM');
      setTargetStrategyValue(promo.targetStrategy?.filterValue?.toString() || '');
      setIsActive(isPromotionActive(promo));
      setPriority(promo.priority || 1);
      setSelectedTerminals(promo.terminalIds || []);
      const promoVideo = promo.media?.find(media => media.type === 'VIDEO');
      setVideoUrl(promoVideo?.url || '');
      setVideoPosterUrl(promoVideo?.posterUrl || '');
      setViewMode('EDIT');
   };

   const handleDelete = async (id: string) => {
      if (await clicConfirm('¿Estás seguro de eliminar esta promoción?')) {
         const updatedPromotions = promotions.filter(p => p.id !== id);
         if (onUpdateConfig) {
            onUpdateConfig({ ...config, promotions: updatedPromotions });
         }
      }
   };

   const handleToggleActive = (promo: Promotion) => {
      const updatedPromotions = promotions.map(p =>
         p.id === promo.id
            ? { ...p, schedule: { ...p.schedule, isActive: !isPromotionActive(p) } }
            : p
      );
      if (onUpdateConfig) {
         onUpdateConfig({ ...config, promotions: updatedPromotions });
      }
   };

   const handleSave = () => {
      if (!promoName || (targetType !== 'ALL' && !targetValue)) {
         alert("Por favor completa los campos requeridos");
         return;
      }
      if (targetType === 'VARIANT' && (!editingPromotion?.targetRefs || editingPromotion.targetRefs.length === 0)) {
         alert('Las promociones por variante se administran desde ERP y requieren targetRefs.');
         return;
      }
      if (videoUrl && !isValidRemoteMediaUrl(videoUrl)) {
         alert('La URL del video debe comenzar con http:// o https://.');
         return;
      }

      const newPromo: Promotion = {
         id: editingId || Math.random().toString(36).substr(2, 9),
         name: promoName,
         type: selectedType,
         targetType,
         targetValue,
         benefitValue,

         trigger: selectedType === 'CONDITIONAL_TARGET' ? {
            type: 'MIN_TICKET_AMOUNT',
            value: triggerAmount,
            isRecursive: false
         } : undefined,

         targetStrategy: selectedType === 'CONDITIONAL_TARGET' ? {
            mode: targetStrategyMode,
            filterValue: targetStrategyValue,
            tieBreaker: 'LAST_ADDED'
         } : undefined,

         schedule: {
            days: activeDays,
            startTime: timeStart,
            endTime: timeEnd,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            isActive
         },
         terminalIds: selectedTerminals.length > 0 ? selectedTerminals : undefined,
         targetLabel: editingPromotion?.targetType === targetType && editingPromotion?.targetValue === targetValue
            ? editingPromotion.targetLabel
            : undefined,
         targetRefs: editingPromotion?.targetType === targetType && editingPromotion?.targetValue === targetValue
            ? editingPromotion.targetRefs
            : undefined,
         priority
         ,media: videoUrl ? [{
            id: 'promotion-primary-video',
            type: 'VIDEO',
            url: videoUrl.trim(),
            posterUrl: videoPosterUrl.trim() || undefined,
            active: true,
            sortOrder: 0,
         }] : undefined
      };

      let updatedPromotions;
      if (editingId) {
         updatedPromotions = promotions.map(p => p.id === editingId ? newPromo : p);
      } else {
         updatedPromotions = [...promotions, newPromo];
      }

      if (onUpdateConfig) {
         onUpdateConfig({ ...config, promotions: updatedPromotions });
      }

      setViewMode('LIST');
   };

   const currentTypeConfig = PROMO_TYPES.find(t => t.id === selectedType);

   if (viewMode === 'LIST') {
      return (
         <div className="h-full flex flex-col bg-gray-50 animate-in slide-in-from-right-10 duration-300">
            <div className="flex justify-between items-center p-6 bg-white border-b border-gray-200 shadow-sm shrink-0 z-10">
               <div>
                  <h2 className="text-2xl font-black text-gray-800">Promociones</h2>
                  <p className="text-sm text-gray-500">Gestiona tus ofertas y descuentos</p>
               </div>

               {/* Tab Switcher */}
               <div className="flex bg-gray-100 p-1 rounded-xl mx-4">
                  <button
                     onClick={() => setActiveTab('PROMOTIONS')}
                     className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'PROMOTIONS' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                     Reglas de Promoción
                  </button>
                  <button
                     onClick={() => setActiveTab('COUPONS')}
                     className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'COUPONS' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                     Cupones Externos
                  </button>
               </div>

               <div className="flex gap-2">
                  {activeTab === 'PROMOTIONS' && (
                     <button onClick={handleCreateNew} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 transition-all flex items-center gap-2">
                        <Plus size={20} /> Nueva Promoción
                     </button>
                  )}
                  <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
                     <X size={24} />
                  </button>
               </div>
            </div>

            {activeTab === 'COUPONS' ? (
               <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full">
                  <CouponManager config={config} onUpdateConfig={onUpdateConfig || (() => { })} />
               </div>
            ) : (
               <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full space-y-4">
                  {promotions.length === 0 ? (
                     <div className="text-center py-20 opacity-50">
                        <Tag size={64} className="mx-auto mb-4 text-gray-300" />
                        <p className="text-xl font-bold text-gray-400">No hay promociones activas</p>
                        <p className="text-sm text-gray-400">Crea tu primera oferta para aumentar las ventas</p>
                     </div>
                  ) : (
                     promotions.map(promo => {
                        const typeInfo = PROMO_TYPES.find(t => t.id === promo.type);
                        return (
                           <div key={promo.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all flex items-center gap-4 group">
                              <div className={`p-3 rounded-xl text-white ${typeInfo?.color || 'bg-gray-400'}`}>
                                 {typeInfo?.icon ? <typeInfo.icon size={24} /> : <Tag size={24} />}
                              </div>
                              <div className="flex-1">
                                 <div className="flex items-center gap-2 mb-1">
                                    <h3 className="font-bold text-gray-800">{promo.name}</h3>
                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${isPromotionActive(promo) ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                                       {isPromotionActive(promo) ? 'Activa' : 'Inactiva'}
                                    </span>
                                 </div>
                                 <p className="text-xs text-gray-500">
                                    {typeInfo?.label} • {describePromotionTarget(promo)} • Prio: {promo.priority || 1}
                                 </p>
                              </div>

                              {/* Analytics Columns */}
                              <div className="hidden md:flex items-center gap-6 mr-4">
                                 {(() => {
                                    // Calculate Stats on the Fly
                                    const usageCount = (transactions || []).filter(t => (t.items || []).some(i => i.appliedPromotionId === promo.id)).length;

                                    const revenueGenerated = (transactions || []).reduce((acc, t) => {
                                       const promoItemsRevenue = (t.items || [])
                                          .filter(i => i.appliedPromotionId === promo.id)
                                          .reduce((sum, i) => sum + (i.price * i.quantity), 0);
                                       return acc + promoItemsRevenue;
                                    }, 0);

                                    const conversionRate = transactions.length > 0 ? (usageCount / transactions.length) : 0;

                                    return (
                                       <>
                                          <div className="text-right">
                                             <p className="text-[10px] text-gray-400 font-bold uppercase">Uso</p>
                                             <p className="font-bold text-gray-700">{usageCount}</p>
                                          </div>
                                          <div className="text-right">
                                             <p className="text-[10px] text-gray-400 font-bold uppercase">Ingresos</p>
                                             <p className="font-bold text-green-600">${revenueGenerated.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                          </div>
                                          <div className="text-right">
                                             <p className="text-[10px] text-gray-400 font-bold uppercase">Conv.</p>
                                             <p className="font-bold text-blue-600">{(conversionRate * 100).toFixed(1)}%</p>
                                          </div>
                                       </>
                                    );
                                 })()}
                              </div>
                              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                 <button onClick={() => handleToggleActive(promo)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-blue-600" title={isPromotionActive(promo) ? "Desactivar" : "Activar"}>
                                    {isPromotionActive(promo) ? <Check size={18} /> : <X size={18} />}
                                 </button>
                                 <button onClick={() => handleEdit(promo)} className="p-2 hover:bg-blue-50 rounded-lg text-gray-400 hover:text-blue-600" title="Editar">
                                    <Edit size={18} />
                                 </button>
                                 <button onClick={() => handleDelete(promo.id)} className="p-2 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-600" title="Eliminar">
                                    <Trash2 size={18} />
                                 </button>
                              </div>
                           </div>
                        );
                     })
                  )}
               </div>
            )}
         </div>
      );
   }

   return (
      <div className="h-full flex flex-col bg-gray-50 animate-in slide-in-from-right-10 duration-300">

         {/* Header */}
         <div className="flex justify-between items-center p-6 bg-white border-b border-gray-200 shadow-sm shrink-0 z-10">
            <div>
               <h2 className="text-2xl font-black text-gray-800">{editingId ? 'Editar Promoción' : 'Nueva Promoción'}</h2>
               <p className="text-sm text-gray-500">Crea reglas dinámicas de precios</p>
            </div>
            <div className="flex items-center gap-4">
               <div className="flex items-center gap-2 bg-gray-100 rounded-full p-1 pr-4">
                  <button
                     onClick={() => setIsActive(!isActive)}
                     className={`w-10 h-6 rounded-full transition-colors relative ${isActive ? 'bg-green-500' : 'bg-gray-300'}`}
                  >
                     <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${isActive ? 'left-5' : 'left-1'}`} />
                  </button>
                  <span className="text-xs font-bold text-gray-600">{isActive ? 'ACTIVA' : 'INACTIVA'}</span>
               </div>

               <button
                  onClick={handleSave}
                  className={`px-6 py-2.5 rounded-xl font-bold text-white shadow-lg hover:brightness-110 active:scale-95 transition-all flex items-center gap-2 text-sm ${currentTypeConfig?.color || 'bg-blue-600'}`}
               >
                  <Save size={18} />
                  <span className="hidden sm:inline">Guardar</span>
               </button>

               <div className="h-8 w-px bg-gray-200 mx-2"></div>

               <button onClick={() => setViewMode('LIST')} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
                  <X size={24} />
               </button>
            </div>
         </div>

         <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full space-y-8 pb-20">

            {/* Step 1: Promotion Type */}
            <section>
               <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">1. Tipo de Oferta</label>
               <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {PROMO_TYPES.map(type => (
                     <button
                        key={type.id}
                        onClick={() => setSelectedType(type.id)}
                        className={`relative p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 text-center group ${selectedType === type.id
                           ? `border-${type.color.replace('bg-', '')} bg-white shadow-lg scale-105 z-10`
                           : 'border-transparent bg-white hover:bg-gray-50'
                           }`}
                     >
                        <div className={`p-3 rounded-xl text-white ${type.color} shadow-md group-hover:scale-110 transition-transform`}>
                           <type.icon size={24} />
                        </div>
                        <div>
                           <h3 className="font-bold text-gray-800 text-sm">{type.label}</h3>
                           <p className="text-[10px] text-gray-400 mt-1 leading-tight">{type.description}</p>
                        </div>
                        {selectedType === type.id && (
                           <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${type.color}`} />
                        )}
                     </button>
                  ))}
               </div>
            </section>

            {/* Step 2: Rule Builder (The "Sentence") */}
            <section>
               <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">2. Regla de Negocio</label>

               {selectedType !== 'CONDITIONAL_TARGET' ? (
                  <div className="bg-white rounded-3xl shadow-sm border border-gray-200 p-6 md:p-8 relative overflow-hidden">
                     <div className={`absolute top-0 left-0 w-2 h-full ${currentTypeConfig?.color}`} />

                     <div className="flex flex-col gap-6">
                        {/* Condition Row */}
                        <div className="flex flex-col md:flex-row md:items-center gap-4">
                           <span className="font-black text-2xl text-gray-300 w-12">SI</span>
                           <div className="flex-1 bg-gray-50 p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-center border border-gray-100">
                              <div className="flex items-center gap-2 text-gray-600 font-medium">
                                 <ShoppingBag size={20} />
                                 <span>El cliente compra:</span>
                              </div>

                              <select
                                 value={targetType}
                                 onChange={(e) => setTargetType(e.target.value as any)}
                                 className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100"
                              >
                                 <option value="PRODUCT">Producto Específico</option>
                                 <option
                                    value="VARIANT"
                                    disabled={editingPromotion?.targetType !== 'VARIANT'}
                                 >Variantes específicas (ERP)</option>
                                 <option value="CATEGORY">Categoría Completa</option>
                                 <option value="BRAND">Por Marca</option>
                                 <option value="SEASON">Por Temporada</option>
                                 <option value="GROUP">Por Grupo/Colección</option>
                                 <option value="ALL">Cualquier Producto</option>
                              </select>

                              {targetType !== 'ALL' && (
                                 <select
                                    value={targetValue}
                                    onChange={(e) => setTargetValue(e.target.value)}
                                    className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 w-full md:w-auto"
                                 >
                                    <option value="">Seleccionar...</option>
                                    {targetType === 'PRODUCT' && productOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                                    {targetType === 'VARIANT' && productOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                                    {targetType === 'CATEGORY' && categoryOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                                    {targetType === 'SEASON' && seasonOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                                    {targetType === 'GROUP' && groupOptions.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                                 </select>
                              )}
                           </div>
                        </div>

                        <div className="flex justify-center md:justify-start pl-3">
                           <ArrowRight className="text-gray-300" size={24} transform="rotate(90 md:0)" />
                        </div>

                        {/* Consequence Row */}
                        <div className="flex flex-col md:flex-row md:items-center gap-4">
                           <span className="font-black text-2xl text-gray-300 w-12 tracking-tighter">ENTONCES</span>
                           <div className="flex-1 bg-blue-50 p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-center border border-blue-100">
                              <div className="flex items-center gap-2 text-blue-700 font-medium">
                                 <Gift size={20} />
                                 <span>Obtiene:</span>
                              </div>

                              {selectedType === 'DISCOUNT' && (
                                 <div className="flex items-center gap-2">
                                    <input
                                       type="number"
                                       value={benefitValue}
                                       onChange={(e) => setBenefitValue(parseFloat(e.target.value))}
                                       className="w-24 text-center font-black text-2xl bg-white border border-blue-200 rounded-xl py-1 text-blue-600 outline-none"
                                       placeholder="0"
                                    />
                                    <span className="font-bold text-blue-400">% de Descuento</span>
                                 </div>
                              )}

                              {selectedType === 'BOGO' && (
                                 <div className="flex items-center gap-2">
                                    <span className="text-blue-600">Impacto en precio:</span>
                                    <input
                                       type="number"
                                       value={benefitValue}
                                       onChange={(e) => setBenefitValue(parseFloat(e.target.value))}
                                       className="w-24 text-center font-black text-2xl bg-white border border-blue-200 rounded-xl py-1 text-blue-600 outline-none"
                                       placeholder="0"
                                    />
                                    <span className="font-bold text-blue-400">% sobre la mecánica 2x1</span>
                                 </div>
                              )}

                              {selectedType === 'HAPPY_HOUR' && (
                                 <div className="flex items-center gap-2">
                                    <span className="text-blue-600">Precio especial de:</span>
                                    <input
                                       type="number"
                                       className="w-24 text-center font-black text-2xl bg-white border border-blue-200 rounded-xl py-1 text-blue-600 outline-none"
                                       placeholder="$0.00"
                                    />
                                 </div>
                              )}
                           </div>
                        </div>
                     </div>
                  </div>
               ) : (
                  <div className="bg-emerald-50 rounded-3xl shadow-sm border border-emerald-100 p-6 md:p-8 relative overflow-hidden">
                     <div className="flex flex-col gap-6">
                        {/* Trigger Row */}
                        <div className="flex flex-col md:flex-row md:items-center gap-4">
                           <span className="font-black text-xl text-emerald-700 w-24">SI GASTA</span>
                           <div className="flex-1 bg-white p-4 rounded-2xl flex items-center gap-4 border border-emerald-200">
                              <span className="text-gray-500 font-bold">$</span>
                              <input
                                 type="number"
                                 value={triggerAmount}
                                 onChange={(e) => setTriggerAmount(parseFloat(e.target.value))}
                                 className="w-full text-2xl font-black text-gray-800 outline-none"
                                 placeholder="0.00"
                              />
                           </div>
                        </div>

                        {/* Target Strategy Row */}
                        <div className="flex flex-col md:flex-row md:items-center gap-4">
                           <span className="font-black text-xl text-emerald-700 w-24">APLICAR A</span>
                           <div className="flex-1 bg-white p-4 rounded-2xl flex flex-col gap-3 border border-emerald-200">
                              <select
                                 value={targetStrategyMode}
                                 onChange={(e) => setTargetStrategyMode(e.target.value as any)}
                                 className="w-full bg-transparent font-bold text-gray-700 outline-none"
                              >
                                 <option value="CHEAPEST_ITEM">El artículo más barato del ticket</option>
                                 <option value="MOST_EXPENSIVE_ITEM">El artículo más caro del ticket</option>
                                 <option value="CATEGORY_CHEAPEST">El más barato de una categoría...</option>
                              </select>

                              {targetStrategyMode === 'CATEGORY_CHEAPEST' && (
                                 <select
                                    value={targetStrategyValue}
                                    onChange={(e) => setTargetStrategyValue(e.target.value)}
                                    className="w-full bg-gray-50 p-2 rounded-lg text-sm border border-gray-200 outline-none"
                                 >
                                    <option value="">Seleccionar Categoría...</option>
                                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                 </select>
                              )}
                           </div>
                        </div>

                        {/* Benefit Row */}
                        <div className="flex flex-col md:flex-row md:items-center gap-4">
                           <span className="font-black text-xl text-emerald-700 w-24">BENEFICIO</span>
                           <div className="flex-1 bg-white p-4 rounded-2xl flex items-center gap-4 border border-emerald-200">
                              <input
                                 type="number"
                                 value={benefitValue}
                                 onChange={(e) => setBenefitValue(parseFloat(e.target.value))}
                                 className="w-24 text-center font-black text-2xl text-emerald-600 outline-none border-b-2 border-emerald-100 focus:border-emerald-500"
                                 placeholder="0"
                              />
                              <span className="font-bold text-emerald-800">% de Descuento en ese artículo</span>
                           </div>
                        </div>
                     </div>
                  </div>
               )}
            </section>

            {/* Step 3: Name & Schedule */}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
               <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">3. Detalles</label>
                  <input
                     type="text"
                     value={promoName}
                     onChange={(e) => setPromoName(e.target.value)}
                     className="w-full p-4 bg-white border border-gray-200 rounded-2xl font-bold text-gray-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50 transition-all"
                     placeholder="Nombre de la Promoción (Ej. Viernes Negro)"
                  />

                  <div className="mt-4">
                     <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Prioridad (Peso)</label>
                     <div className="flex items-center gap-2">
                        <input
                           type="number"
                           min="1"
                           max="100"
                           value={priority}
                           onChange={(e) => setPriority(parseInt(e.target.value) || 1)}
                           className="w-24 p-3 bg-gray-100 rounded-xl border-none outline-none focus:ring-2 focus:ring-blue-500 font-bold text-center"
                        />
                        <p className="text-xs text-gray-400">Si hay conflicto, gana la mayor prioridad.</p>
                     </div>
                  </div>
               </div>

               <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">4. Programación</label>
                  <div className="bg-white p-4 rounded-2xl border border-gray-200 space-y-4">

                     {/* Days Toggle */}
                     <div className="flex justify-between items-center bg-gray-50 p-2 rounded-xl">
                        <CalendarDays size={20} className="text-gray-400 ml-2" />
                        <div className="flex gap-1">
                           {DAYS.map(day => {
                              const isActiveDay = activeDays.includes(day.key);
                              return (
                                 <button
                                    key={day.key}
                                    onClick={() => toggleDay(day.key)}
                                    className={`w-8 h-8 rounded-full text-xs font-bold transition-all ${isActiveDay
                                       ? 'bg-blue-600 text-white shadow-md scale-110'
                                       : 'bg-white text-gray-400 hover:bg-gray-200'
                                       }`}
                                 >
                                    {day.key}
                                 </button>
                              );
                           })}
                        </div>
                     </div>

                     {/* Time Range */}
                     <div className="flex items-center gap-3">
                        <Clock size={20} className="text-gray-400 ml-2" />
                        <input
                           type="time"
                           value={timeStart}
                           onChange={(e) => setTimeStart(e.target.value)}
                           className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:border-blue-400"
                        />
                        <span className="text-gray-300">-</span>
                        <input
                           type="time"
                           value={timeEnd}
                           onChange={(e) => setTimeEnd(e.target.value)}
                           className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:border-blue-400"
                        />
                     </div>

                     <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                        <div className="space-y-1">
                           <span className="text-[10px] font-bold text-gray-400 uppercase ml-1">Vigencia Desde</span>
                           <input
                              type="date"
                              value={startDate}
                              onChange={(e) => setStartDate(e.target.value)}
                              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:border-blue-400"
                           />
                        </div>
                        <div className="space-y-1">
                           <span className="text-[10px] font-bold text-gray-400 uppercase ml-1">Vigencia Hasta</span>
                           <input
                              type="date"
                              value={endDate}
                              onChange={(e) => setEndDate(e.target.value)}
                              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:border-blue-400"
                           />
                        </div>
                     </div>
                  </div>
               </div>
            </section>

            <section>
               <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">5. Multimedia de la oferta</label>
               <div className="bg-white p-5 rounded-2xl border border-gray-200 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                     <input type="url" value={videoUrl} onChange={event => setVideoUrl(event.target.value)} placeholder="URL HTTPS del video (MP4/WebM)" className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-400" />
                     <input type="url" value={videoPosterUrl} onChange={event => setVideoPosterUrl(event.target.value)} placeholder="URL de portada (opcional)" className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-400" />
                     <p className="text-xs text-gray-400">Compatible con productos, promociones y ofertas. El archivo debe vivir en el ERP/CDN.</p>
                  </div>
                  {videoUrl && isValidRemoteMediaUrl(videoUrl) && (
                     <video src={videoUrl} poster={videoPosterUrl || undefined} controls playsInline className="w-full aspect-video rounded-xl bg-black object-contain" />
                  )}
               </div>
            </section>

            {/* Step 4: Terminal Scope */}
            <section>
               <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">5. Terminales</label>
               <div className="bg-white p-4 rounded-2xl border border-gray-200">
                  <div className="flex flex-wrap gap-2">
                     <button
                        onClick={() => setSelectedTerminals([])}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${selectedTerminals.length === 0
                           ? 'bg-slate-800 text-white border-slate-800'
                           : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                           }`}
                     >
                        Todas las Terminales
                     </button>
                     {config.terminals.map(term => {
                        const isSelected = selectedTerminals.includes(term.id);
                        return (
                           <button
                              key={term.id}
                              onClick={() => {
                                 if (isSelected) {
                                    setSelectedTerminals(prev => prev.filter(id => id !== term.id));
                                 } else {
                                    setSelectedTerminals(prev => [...prev, term.id]);
                                 }
                              }}
                              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-2 ${isSelected
                                 ? 'bg-blue-50 text-blue-600 border-blue-200'
                                 : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                                 }`}
                           >
                              <Monitor size={14} />
                              {term.id}
                           </button>
                        );
                     })}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-3 ml-1">
                     {selectedTerminals.length === 0
                        ? "Esta promoción estará disponible en todas las cajas registradoras."
                        : "Esta promoción solo se aplicará en las terminales seleccionadas."}
                  </p>
               </div>
            </section>



            {/* Step 5: AI Insights & Analytics (Only for existing promos) */}
            {
               editingId && (
                  <section className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                     <div className="flex items-center gap-2 mb-4">
                        <Lightbulb className="text-yellow-500" size={20} />
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest">IA Insights & Recomendaciones</label>
                     </div>

                     <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Performance Card */}
                        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                           <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                              <BarChart3 size={18} className="text-blue-500" />
                              Rendimiento Actual
                           </h4>
                           <div className="space-y-4">
                              <div className="flex justify-between items-end">
                                 <span className="text-sm text-gray-500">Ventas Totales</span>
                                 <span className="text-xl font-black text-gray-800">$12,450</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                                 <div className="bg-blue-500 h-full rounded-full" style={{ width: '65%' }}></div>
                              </div>
                              <div className="flex justify-between items-end">
                                 <span className="text-sm text-gray-500">Tasa de Conversión</span>
                                 <span className="text-xl font-black text-green-600">18.5%</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                                 <div className="bg-green-500 h-full rounded-full" style={{ width: '18.5%' }}></div>
                              </div>
                              <p className="text-xs text-gray-400 mt-2">
                                 * Datos simulados basados en el histórico de 30 días.
                              </p>
                           </div>
                        </div>

                        {/* AI Recommendations */}
                        <div className="lg:col-span-2 space-y-3">
                           {generateRecommendations({
                              id: editingId,
                              name: promoName,
                              type: selectedType,
                              targetType,
                              targetValue,
                              benefitValue,
                              schedule: {
                                 days: activeDays,
                                 startTime: timeStart,
                                 endTime: timeEnd,
                                 startDate: startDate || undefined,
                                 endDate: endDate || undefined,
                                 isActive
                              },
                              terminalIds: selectedTerminals
                           } as Promotion).map((rec, idx) => (
                              <div key={idx} className="bg-gradient-to-r from-indigo-50 to-white p-4 rounded-2xl border border-indigo-100 flex gap-4 items-start">
                                 <div className="p-2 bg-white rounded-xl shadow-sm text-indigo-600 shrink-0">
                                    <TrendingUp size={20} />
                                 </div>
                                 <div>
                                    <div className="flex items-center gap-2 mb-1">
                                       <span className="text-xs font-black text-indigo-600 uppercase tracking-wider bg-indigo-100 px-2 py-0.5 rounded-md">
                                          {rec.type}
                                       </span>
                                       <span className="text-xs font-bold text-green-600">
                                          {(rec.confidence * 100).toFixed(0)}% Confianza
                                       </span>
                                    </div>
                                    <p className="text-sm text-gray-700 font-medium leading-relaxed">
                                       {rec.message}
                                    </p>
                                 </div>
                              </div>
                           ))}
                        </div>
                     </div>
                  </section>
               )
            }

         </div >

      </div >
   );
};

export default PromotionBuilder;
