import React, { useState, useEffect, useRef } from 'react';
import { ShoppingCart, Monitor, MonitorPlay, Zap } from 'lucide-react';
import { visorSync, VisorState } from '../utils/visorSync';

const CustomerVisor: React.FC = () => {
    const [state, setState] = useState<VisorState | null>(null);
    const [currentAdIndex, setCurrentAdIndex] = useState(0);
    const listEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Recover initial state from localStorage if available
        const initialState = visorSync.getLastState();
        if (initialState) {
            setState(initialState);
        }

        const unsubscribe = visorSync.onStateUpdate((newState) => {
            setState(newState);
        });

        return () => unsubscribe();
    }, []);

    // Auto-scroll logic
    useEffect(() => {
        if (state?.cart && state.cart.length > 0) {
            listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [state?.cart]);

    // Ads Rotation Logic
    useEffect(() => {
        if (state?.ads && state.ads.length > 1) {
            const interval = setInterval(() => {
                setCurrentAdIndex((prev) => (prev + 1) % state.ads!.length);
            }, 5000); // 5 seconds per ad
            return () => clearInterval(interval);
        } else {
            setCurrentAdIndex(0); // Reset to 0 if only one or no ads
        }
    }, [state?.ads?.length]); // Only restart if the number of ads changes

    if (!state) {
        return (
            <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-900 text-white">
                <Monitor className="w-16 h-16 text-blue-500 mb-6 animate-pulse" />
                <h1 className="text-3xl font-bold tracking-tight mb-2">Alfa POS Visor</h1>
                <p className="text-slate-400">Esperando sincronización con la terminal principal...</p>
            </div>
        );
    }

    const { cart, subtotal, tax, total, welcomeMessage, ads, currencySymbol } = state;

    return (
        <div className="h-screen w-screen flex flex-row bg-white overflow-hidden font-sans">
            {/* LEFT PANEL: Ads & Welcome */}
            <div className="flex-1 bg-slate-100 flex flex-col relative">
                <div className="flex-1 flex items-center justify-center p-4">
                    {ads && ads.length > 0 ? (
                        <div className="w-full h-full max-h-[85vh] relative rounded-2xl overflow-hidden shadow-2xl bg-black">
                            {ads[currentAdIndex].type === 'VIDEO' ? (
                                <video
                                    key={ads[currentAdIndex].id}
                                    src={ads[currentAdIndex].url}
                                    poster={ads[currentAdIndex].posterUrl}
                                    className="w-full h-full object-contain"
                                    autoPlay
                                    muted
                                    loop
                                    playsInline
                                />
                            ) : (
                                <img
                                    src={ads[currentAdIndex].url}
                                    alt="Publicidad"
                                    className="w-full h-full object-contain"
                                />
                            )}
                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                                {ads.map((_, i) => (
                                    <div
                                        key={i}
                                        className={`h-2 rounded-full transition-all ${i === currentAdIndex ? 'w-6 bg-white' : 'w-2 bg-white/40'}`}
                                    />
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center p-12">
                            <div className="w-32 h-32 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6 text-blue-600">
                                <MonitorPlay className="w-16 h-16" />
                            </div>
                            <h2 className="text-4xl font-extrabold text-slate-800 mb-4">¡Bienvenidos!</h2>
                            <p className="text-2xl text-slate-500 max-w-lg mx-auto">
                                {welcomeMessage || "Gracias por visitarnos. Disfrute su experiencia de compra."}
                            </p>
                        </div>
                    )}
                </div>

                {/* BOTTOM BRANDING */}
                <div className="p-6 bg-slate-200/50 flex items-center justify-between border-t border-slate-300">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">CP</div>
                        <span className="font-bold text-slate-800 tracking-tight">Alfa POS OS</span>
                    </div>
                    <div className="text-slate-500 text-sm font-medium italic">
                        {welcomeMessage || "Calidad y eficiencia en cada venta."}
                    </div>
                </div>
            </div>

            {/* RIGHT PANEL: Cart & Totals */}
            <div className="w-[450px] border-l border-slate-200 bg-slate-50 flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.05)]">
                <div className="p-6 bg-white border-b border-slate-200 flex items-center justify-between">
                    <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                        <ShoppingCart className="w-6 h-6 text-blue-600" />
                        Su Pedido
                    </h3>
                    <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-bold">
                        {cart.reduce((s, i) => s + i.quantity, 0)} items
                    </span>
                </div>

                {/* CART LIST */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-50 italic">
                            <Zap className="w-12 h-12 mb-4" />
                            <p className="text-lg">Inicie su compra</p>
                        </div>
                    ) : (
                        <>
                            {cart.map((item, idx) => {
                                const hasDiscount = item.originalPrice && item.price < item.originalPrice;
                                const discountPct = hasDiscount ? Math.round((1 - item.price / item.originalPrice!) * 100) : 0;
                                const lineTotal = item.price * item.quantity;
                                const taxRate = 0.18; // ITBIS 18%
                                const itemTax = lineTotal * taxRate;

                                return (
                                    <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm animate-in slide-in-from-right duration-300">
                                        <div className="flex justify-between items-start mb-2">
                                            <p className="font-bold text-slate-800 leading-tight flex-1 pr-2">{item.name}</p>
                                            <p className="font-bold text-blue-700 text-lg whitespace-nowrap">
                                                {currencySymbol}{lineTotal.toFixed(2)}
                                            </p>
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-slate-600 text-sm font-semibold">
                                                        {item.quantity}X {currencySymbol}{item.price.toFixed(2)}
                                                    </span>
                                                    {hasDiscount && (
                                                        <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-md text-xs font-bold">
                                                            -{discountPct}%
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="text-slate-400 text-xs font-medium">
                                                    (ITBIS: {currencySymbol}{itemTax.toFixed(2)})
                                                </span>
                                            </div>

                                            {hasDiscount && (
                                                <span className="text-slate-400 line-through text-sm">
                                                    {currencySymbol}{item.originalPrice?.toFixed(2)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={listEndRef} />
                        </>
                    )}
                </div>

                {/* TOTALS */}
                <div className="p-8 bg-slate-900 text-white rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.2)]">
                    <div className="space-y-3 mb-6">
                        <div className="flex justify-between text-slate-400 font-medium">
                            <span>Subtotal</span>
                            <span>{currencySymbol}{subtotal.toFixed(2)}</span>
                        </div>
                        {state.discountAmount > 0 && (
                            <div className="flex justify-between text-red-400 font-bold">
                                <span>Descuento</span>
                                <span>-{currencySymbol}{state.discountAmount.toFixed(2)}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-slate-400 font-medium">
                            <span>ITBIS (18%)</span>
                            <span>{currencySymbol}{tax.toFixed(2)}</span>
                        </div>
                    </div>
                    <div className="pt-6 border-t border-slate-800 flex justify-between items-baseline">
                        <span className="text-2xl font-bold text-blue-400">TOTAL</span>
                        <span className="text-5xl font-black tracking-tight tracking-tighter">
                            {currencySymbol}{total.toFixed(2)}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CustomerVisor;
