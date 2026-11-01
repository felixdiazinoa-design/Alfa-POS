/**
 * KioskProductBrowser
 *
 * Product scanning and browsing interface for self-checkout.
 * Touch-first layout optimized for vertical kiosks.
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Search,
  ShoppingCart,
  Plus,
  X,
  Scale,
  Minus,
  ChevronRight,
  Tag,
  CreditCard,
  Sparkles
} from 'lucide-react';
import { Product, CartItem, BusinessConfig } from '../../types';
import { hasProductPromotion } from '../../utils/promotionEngine';
import PromoBottomSheet from '../PromoBottomSheet';
import SecurityOverlay from './SecurityOverlay';
import { useKioskSecurityContext } from './KioskContext';

interface KioskProductBrowserProps {
  products: Product[];
  cart: CartItem[];
  onAddToCart: (product: Product, quantity?: number) => void;
  onRemoveFromCart: (productId: string) => void;
  onCheckout: () => void;
  onCancel: () => void;
  config: BusinessConfig;
  terminalId?: string;
  customerConfidenceIndex?: number;
}

const KioskProductBrowser: React.FC<KioskProductBrowserProps> = ({
  products,
  cart,
  onAddToCart,
  onRemoveFromCart,
  onCheckout,
  onCancel,
  config,
  terminalId,
  customerConfidenceIndex = 0.75
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');
  const [activeAddProductId, setActiveAddProductId] = useState<string | null>(null);
  const [cartPulse, setCartPulse] = useState(false);
  const [language, setLanguage] = useState<'ES' | 'EN'>('ES');
  const [logoLoadError, setLogoLoadError] = useState(false);

  const [showPromoSheet, setShowPromoSheet] = useState(false);
  const [selectedPromoProduct, setSelectedPromoProduct] = useState<Product | null>(null);

  const [weightInstructionOpen, setWeightInstructionOpen] = useState(false);
  const [weightModalOpen, setWeightModalOpen] = useState(false);
  const [weighingProduct, setWeighingProduct] = useState<Product | null>(null);
  const [currentWeight, setCurrentWeight] = useState(0);
  const [isWeighing, setIsWeighing] = useState(false);

  const cartContainerRef = useRef<HTMLDivElement>(null);
  const cartEndRef = useRef<HTMLDivElement>(null);
  const {
    isLocked,
    needsVerification,
    auditTriggered,
    lockReason,
    lockMessage,
    conflictProductId,
    conflictProductName,
    expectedWeightKg,
    sensorWeightKg,
    supervisorAuthorized,
    markNeedsVerification,
    syncVerificationState,
    checkVerificationBeforePayment,
    shouldAuditTransaction,
    mockSensorWeightKg,
    evaluateScaleDiscrepancy,
    submitSupervisorPin,
    approveTransaction,
    clearSecurityState
  } = useKioskSecurityContext();

  useEffect(() => {
    setTimeout(() => {
      cartEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 100);
  }, [cart.length]);

  useEffect(() => {
    syncVerificationState(cart);
    if (cart.length === 0 && !isLocked) {
      clearSecurityState();
    }
  }, [cart, isLocked, syncVerificationState, clearSecurityState]);

  useEffect(() => {
    if (weightModalOpen && weighingProduct) {
      setIsWeighing(true);
      setCurrentWeight(0);

      const interval = setInterval(() => {
        setCurrentWeight(prev => prev + (Math.random() * 0.5));
      }, 100);

      const timeout = setTimeout(() => {
        clearInterval(interval);
        const finalWeight = Number((Math.random() * 2 + 0.5).toFixed(3));
        setCurrentWeight(finalWeight);
        setIsWeighing(false);
      }, 2500);

      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
  }, [weightModalOpen, weighingProduct]);

  const triggerAddFeedback = (productName: string, productId: string) => {
    setLastScanned(productName);
    setActiveAddProductId(productId);
    setCartPulse(true);

    setTimeout(() => setCartPulse(false), 500);
    setTimeout(() => setActiveAddProductId(null), 650);
    setTimeout(() => setLastScanned(null), 2000);
  };

  const handleProductClick = (product: Product) => {
    if (product.type === 'SERVICE') {
      setWeighingProduct(product);
      setWeightInstructionOpen(true);
      return;
    }

    onAddToCart(product);
    markNeedsVerification(product);
    triggerAddFeedback(product.name, product.id);
  };

  const startWeighingFlow = () => {
    setWeightInstructionOpen(false);
    setWeightModalOpen(true);
  };

  const cancelWeighingFlow = () => {
    setWeightInstructionOpen(false);
    setWeightModalOpen(false);
    setWeighingProduct(null);
    setCurrentWeight(0);
    setIsWeighing(false);
  };

  const confirmWeight = () => {
    if (!weighingProduct) return;

    onAddToCart(weighingProduct, currentWeight);
    markNeedsVerification(weighingProduct);
    triggerAddFeedback(`${weighingProduct.name} (${currentWeight}kg)`, weighingProduct.id);

    setWeightModalOpen(false);
    setWeighingProduct(null);
  };

  const terminal = (config.terminals || []).find(t => t.id === terminalId);
  const allowedCats = terminal?.config?.catalog?.allowedCategories || [];

  const sellableProducts = useMemo(
    () => products.filter(p => {
      if (!p || p.is_sellable === false) return false;
      if (allowedCats.length > 0 && !allowedCats.includes(p.category)) return false;
      return true;
    }),
    [products, allowedCats]
  );

  const categories = useMemo(
    () => ['Todos', ...Array.from(new Set(sellableProducts.map(p => p.category))).sort()],
    [sellableProducts]
  );

  const filteredProducts = useMemo(
    () => sellableProducts.filter(p => {
      const matchesSearch = (p.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || p.barcode?.includes(searchQuery);
      const matchesCategory = selectedCategory === 'Todos' || p.category === selectedCategory;
      return matchesSearch && matchesCategory;
    }),
    [sellableProducts, searchQuery, selectedCategory]
  );

  const suggestions = useMemo(
    () => sellableProducts.filter(p => !cart.some(c => c.id === p.id)).slice(0, 4),
    [sellableProducts, cart]
  );

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const total = subtotal;
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const moneySymbol = config.currencySymbol || '$';
  const formatMoney = (amount: number) => `${moneySymbol}${amount.toFixed(2)}`;
  const kioskLogoSrc = !logoLoadError ? '/favicon.png' : '';

  const handleDecrease = (item: CartItem) => {
    if (item.quantity <= 1) {
      onRemoveFromCart(item.id);
      return;
    }
    onAddToCart(item, -1);
  };

  const handleIncrease = (item: CartItem) => {
    onAddToCart(item, 1);
  };

  const handleCheckoutAttempt = () => {
    if (cart.length === 0) return;
    if (checkVerificationBeforePayment(cart)) return;

    const auditHit = shouldAuditTransaction({
      monto_total: total,
      cantidad_items: itemCount,
      indice_confianza_cliente: customerConfidenceIndex,
      transaction_signature: cart.map(item => `${item.id}:${Number(item.quantity || 0).toFixed(3)}`).sort().join('|')
    });
    if (auditHit) return;

    const sensorWeight = mockSensorWeightKg(cart);
    const weightMismatch = evaluateScaleDiscrepancy(cart, sensorWeight);
    if (weightMismatch) return;

    onCheckout();
  };

  const handleCancelPurchase = () => {
    clearSecurityState();
    onCancel();
  };

  return (
    <div className="fixed inset-0 w-screen h-screen flex bg-slate-50 overflow-hidden">
      <section className="flex-[7] min-w-0 h-full flex flex-col overflow-hidden">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-600 text-white font-black flex items-center justify-center overflow-hidden shadow-sm">
              {kioskLogoSrc ? (
                <img
                  src={kioskLogoSrc}
                  alt="Logo CLIC POS"
                  className="w-full h-full object-contain"
                  onError={() => setLogoLoadError(true)}
                />
              ) : (
                <span>C</span>
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Self Checkout</p>
              <p className="text-xl font-black text-slate-800">{config.companyInfo?.name || 'CLIC POS'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-100 rounded-2xl p-1">
            <button
              onClick={() => setLanguage('ES')}
              className={`px-4 min-h-[52px] rounded-xl font-bold text-sm transition-colors ${language === 'ES' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              ES
            </button>
            <button
              onClick={() => setLanguage('EN')}
              className={`px-4 min-h-[52px] rounded-xl font-bold text-sm transition-colors ${language === 'EN' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              EN
            </button>
          </div>
        </header>

        {lastScanned && (
          <div className="bg-emerald-500 text-white px-6 py-4 text-center animate-in slide-in-from-top flex-shrink-0">
            <p className="text-xl font-black">Producto agregado: {lastScanned}</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 pb-40">
          <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {filteredProducts.slice(0, 30).map(product => (
              <button
                key={product.id}
                onClick={() => handleProductClick(product)}
                className={`bg-white rounded-3xl border text-left overflow-hidden group flex flex-col h-[360px] transition-all active:scale-[0.98] ${activeAddProductId === product.id ? 'border-emerald-400 ring-4 ring-emerald-100' : 'border-slate-200 hover:border-blue-200 hover:shadow-xl hover:-translate-y-1'}`}
              >
                <div className="relative h-[62%] bg-slate-50 border-b border-slate-100 p-5 flex items-center justify-center">
                  {product.type === 'SERVICE' && (
                    <div className="absolute top-3 left-3 bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full text-xs font-black flex items-center gap-1">
                      <Scale size={12} />
                      Requiere pesaje
                    </div>
                  )}

                  {hasProductPromotion(product, config, terminalId || 'T1') && (
                    <div
                      className="absolute top-0 right-0 cursor-pointer z-20"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPromoProduct(product);
                        setShowPromoSheet(true);
                      }}
                    >
                      <div className="bg-red-500 text-white text-xs font-black px-3 py-1.5 rounded-bl-2xl shadow-md flex items-center gap-1.5 animate-in slide-in-from-top-2 hover:bg-red-600 transition-colors">
                        <Tag size={12} className="fill-white" />
                        OFERTA
                      </div>
                    </div>
                  )}

                  {product.image || product.images?.[0] ? (
                    <img
                      src={product.image || product.images?.[0]}
                      alt={product.name}
                      className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        if (e.currentTarget.parentElement) {
                          e.currentTarget.parentElement.innerHTML += `<span class="text-7xl">${product.category === 'Bebidas' ? '🥤' : '📦'}</span>`;
                        }
                      }}
                    />
                  ) : (
                    <span className="text-7xl">{product.category === 'Bebidas' ? '🥤' : '📦'}</span>
                  )}
                </div>

                <div className="h-[38%] p-5 flex flex-col">
                  <h3 className="font-black text-slate-800 text-xl leading-tight line-clamp-2">{product.name}</h3>
                  <p className="text-sm text-slate-400 mt-1">{product.category}</p>

                  <div className="mt-auto flex items-center justify-between">
                    <div className="text-2xl font-black text-slate-900">
                      {formatMoney(product.price)}
                      {product.type === 'SERVICE' && <span className="text-xs font-bold text-slate-400 ml-1">/kg</span>}
                    </div>
                    <div className="w-12 h-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center shadow-md">
                      <Plus size={24} />
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {filteredProducts.length === 0 && (
            <div className="text-center py-20">
              <div className="text-7xl mb-4">🔍</div>
              <p className="text-2xl font-black text-slate-400">No se encontraron productos</p>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 bg-white/95 backdrop-blur p-5 space-y-4">
          <div className="relative">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={22} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar producto o codigo"
              className="w-full pl-14 pr-6 min-h-[64px] bg-slate-100 border-2 border-transparent focus:bg-white focus:border-blue-500 rounded-2xl text-lg font-semibold outline-none transition-all"
            />
          </div>

          <div className="overflow-x-auto no-scrollbar">
            <div className="flex gap-3 pb-1">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-5 min-h-[60px] rounded-2xl font-black whitespace-nowrap transition-all ${selectedCategory === cat
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <aside className={`flex-[3] min-w-[360px] bg-white border-l border-slate-200 h-full flex flex-col shadow-2xl ${cartPulse ? 'animate-pulse' : ''}`}>
        <div className="bg-blue-700 text-white p-6">
          <div className="flex items-center gap-3 mb-1">
            <ShoppingCart size={30} strokeWidth={2.5} />
            <h2 className="text-3xl font-black">Tu Carrito</h2>
          </div>
          <p className="text-blue-100 text-lg font-semibold">{itemCount} {itemCount === 1 ? 'articulo' : 'articulos'}</p>
          {(needsVerification || auditTriggered) && (
            <div className="mt-3 inline-flex items-center gap-2 text-xs font-black uppercase px-3 py-1 rounded-full bg-amber-200 text-amber-900">
              {needsVerification ? 'Mantenida para verificación' : 'Auditoría aleatoria pendiente'}
            </div>
          )}
        </div>

        <div ref={cartContainerRef} className="flex-1 overflow-y-auto p-5">
          {cart.length === 0 ? (
            <div className="text-center py-12 space-y-5">
              <div className="text-6xl">🛒</div>
              <p className="text-xl font-black text-slate-500">Carrito vacio</p>
              <p className="text-sm text-slate-400">Toca un producto para agregarlo</p>

              {suggestions.length > 0 && (
                <div className="text-left mt-8">
                  <div className="flex items-center gap-2 mb-3 text-amber-600 font-black text-sm uppercase tracking-wide">
                    <Sparkles size={16} />
                    Sugerencias del dia
                  </div>
                  <div className="space-y-2">
                    {suggestions.map(suggestion => (
                      <button
                        key={suggestion.id}
                        onClick={() => handleProductClick(suggestion)}
                        className="w-full px-3 py-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-blue-200 hover:bg-blue-50 text-left transition-colors"
                      >
                        <p className="font-bold text-slate-800 truncate">{suggestion.name}</p>
                        <p className="text-sm font-black text-slate-500">{formatMoney(suggestion.price)}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {cart.map(item => (
                <div key={item.id} className="rounded-2xl border border-slate-200 p-4 bg-white shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="font-black text-slate-800 text-lg leading-tight line-clamp-2">{item.name}</h4>
                      <p className="text-sm text-slate-500 mt-1">{formatMoney(item.originalPrice || item.price)} x {item.quantity}</p>
                    </div>
                    <button
                      onClick={() => onRemoveFromCart(item.id)}
                      className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-600 flex items-center justify-center transition-colors"
                      title="Eliminar"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <span className={`text-2xl font-black ${item.price < (item.originalPrice || item.price) ? 'text-green-600' : 'text-slate-800'}`}>
                      {formatMoney(item.price * item.quantity)}
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDecrease(item)}
                        className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center"
                      >
                        <Minus size={20} />
                      </button>
                      <div className="w-10 text-center text-xl font-black text-slate-800">{item.quantity}</div>
                      <button
                        onClick={() => handleIncrease(item)}
                        className="w-12 h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center"
                      >
                        <Plus size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={cartEndRef} className="h-4" />
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 p-5 space-y-4 bg-white">
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2">
            <div className="flex items-center justify-between text-lg">
              <span className="font-bold text-slate-500">Subtotal</span>
              <span className="font-black text-slate-800">{formatMoney(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-3xl">
              <span className="font-black text-slate-900">Total</span>
              <span className="font-black text-slate-900">{formatMoney(total)}</span>
            </div>
          </div>

          <button
            onClick={handleCheckoutAttempt}
            disabled={cart.length === 0}
            className="w-full min-h-[78px] bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-2xl font-black text-3xl shadow-lg transition-all flex items-center justify-center gap-3"
          >
            <CreditCard size={30} />
            PAGAR AHORA
          </button>

          <button
            onClick={handleCancelPurchase}
            className="w-full min-h-[62px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-black text-lg transition-colors"
          >
            Cancelar compra
          </button>
        </div>
      </aside>

      {weightInstructionOpen && weighingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl p-8 w-full max-w-lg shadow-2xl text-center">
            <div className="w-24 h-24 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <Scale size={50} className="text-orange-600" />
            </div>
            <h3 className="text-3xl font-black text-slate-900 mb-2">Producto con pesaje</h3>
            <p className="text-slate-600 text-lg mb-6">
              Coloca <span className="font-black">{weighingProduct.name}</span> en la balanza para registrar el peso.
            </p>

            <div className="flex gap-3">
              <button
                onClick={cancelWeighingFlow}
                className="flex-1 min-h-[58px] rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black"
              >
                Cancelar
              </button>
              <button
                onClick={startWeighingFlow}
                className="flex-1 min-h-[58px] rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black flex items-center justify-center gap-2"
              >
                Comenzar pesaje
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      {weightModalOpen && weighingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl transform transition-all scale-100">
            <div className="text-center">
              <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <Scale size={48} className="text-blue-600" />
              </div>

              <h3 className="text-2xl font-black text-gray-800 mb-2">
                {isWeighing ? 'Pesando producto...' : 'Peso confirmado'}
              </h3>
              <p className="text-gray-500 mb-8">{weighingProduct.name}</p>

              <div className="bg-gray-50 rounded-2xl p-8 mb-8 border-2 border-gray-100">
                <div className="text-6xl font-black text-gray-900 font-mono tracking-tighter">
                  {currentWeight.toFixed(3)}
                  <span className="text-2xl text-gray-400 ml-2">kg</span>
                </div>
                <div className="mt-2 text-blue-600 font-bold">Total: {formatMoney(currentWeight * weighingProduct.price)}</div>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={cancelWeighingFlow}
                  className="flex-1 py-4 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmWeight}
                  disabled={isWeighing}
                  className="flex-1 py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isWeighing ? <span className="animate-pulse">Calculando...</span> : <><span>Confirmar</span><ChevronRight size={20} /></>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PromoBottomSheet
        isOpen={showPromoSheet}
        onClose={() => setShowPromoSheet(false)}
        product={selectedPromoProduct}
        onAddToCart={(p) => handleProductClick(p)}
        config={config}
      />

      <SecurityOverlay
        isOpen={isLocked}
        lockReason={lockReason}
        lockMessage={lockMessage}
        conflictProductName={conflictProductName}
        expectedWeightKg={expectedWeightKg}
        sensorWeightKg={sensorWeightKg}
        canRemoveItem={Boolean(conflictProductId)}
        supervisorAuthorized={supervisorAuthorized}
        onValidateSupervisorPin={submitSupervisorPin}
        onApproveTransaction={() => {
          approveTransaction(cart);
        }}
        onRemoveConflictItem={() => {
          if (conflictProductId) {
            onRemoveFromCart(conflictProductId);
          }
          approveTransaction();
        }}
        onResetCart={() => {
          clearSecurityState();
          onCancel();
        }}
      />
    </div>
  );
};

export default KioskProductBrowser;
