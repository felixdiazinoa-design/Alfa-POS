import React from 'react';
import {
    Award, TrendingUp, Calendar, CreditCard, Gift, Trash2,
    Medal, Star, Zap, Crown
} from 'lucide-react';
import { BusinessConfig } from '../types';

interface LoyaltyDashboardProps {
    customer: any;
    config: BusinessConfig;
    onLinkCard: () => void;
    onUnlinkCard: (cardId: string) => void;
}

const LoyaltyDashboard: React.FC<LoyaltyDashboardProps> = ({
    customer,
    config,
    onLinkCard,
    onUnlinkCard
}) => {
    if (!customer?.id) {
        return (
            <div className="text-center py-16 text-gray-400 border-2 border-dashed border-gray-100 rounded-3xl bg-white">
                <Award size={44} className="mx-auto mb-4 opacity-20" />
                <p className="text-xs font-black uppercase tracking-widest">Selecciona un cliente para ver su lealtad</p>
            </div>
        );
    }

    const defaultLoyaltyTiers = [
        { id: 'bronze', name: 'BRONZE', minPoints: 0 },
        { id: 'silver', name: 'SILVER', minPoints: 500 },
        { id: 'gold', name: 'GOLD', minPoints: 1500 },
        { id: 'platinum', name: 'PLATINUM', minPoints: 3000 }
    ];
    const loyaltyTiers = Array.isArray(config.loyalty?.tiers) && config.loyalty.tiers.length > 0
        ? config.loyalty.tiers
        : defaultLoyaltyTiers;
    // `minPoints` es opcional en el snapshot del ERP (EGO Club deriva el nivel del gasto).
    const minPointsOf = (tier: { minPoints?: number }) => tier.minPoints ?? 0;

    const currentPoints = customer.loyaltyPoints || 0;
    const currentTierIdx = [...loyaltyTiers].findIndex(t => currentPoints < minPointsOf(t)) === -1
        ? loyaltyTiers.length - 1
        : Math.max(0, [...loyaltyTiers].findIndex(t => currentPoints < minPointsOf(t)) - 1);

    const currentTier = loyaltyTiers[currentTierIdx] || defaultLoyaltyTiers[0];
    const nextTier = loyaltyTiers[currentTierIdx + 1];

    const progressPercent = nextTier
        ? Math.min(100, Math.max(0, ((currentPoints - minPointsOf(currentTier)) / (minPointsOf(nextTier) - minPointsOf(currentTier) || 1)) * 100))
        : 100;

    return (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-700 max-w-6xl mx-auto px-6 py-4 flex flex-col items-center">

            {/* 1. HERO CARD (Institutional Blue POS) */}
            <div className="w-full bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 rounded-3xl p-10 text-white relative overflow-hidden shadow-lg border border-white/5 flex flex-col justify-center min-h-[320px]">
                {/* Subtle Branding Texture Pattern */}
                <div className="absolute inset-0 opacity-5 mix-blend-overlay pointer-events-none">
                    <div className="absolute inset-0 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:20px_20px]"></div>
                </div>

                <div className="relative z-10">
                    <div className="flex flex-col md:flex-row justify-between items-start gap-8 mb-12">
                        <div>
                            <p className="text-white/80 font-bold uppercase tracking-[0.2em] text-[11px] mb-3">PUNTOS ACUMULADOS</p>
                            <div className="flex items-baseline gap-3">
                                <h3 className="text-6xl md:text-7xl font-black tracking-tighter drop-shadow-md">
                                    {currentPoints.toLocaleString()}
                                </h3>
                                <span className="text-white/60 font-bold text-2xl uppercase tracking-widest">PTS</span>
                            </div>
                        </div>

                        {/* Badge de Rango (Pill Style) */}
                        <div className="bg-white/10 backdrop-blur-sm border border-white/30 px-6 py-2 rounded-full flex items-center gap-3 shadow-sm self-end md:self-start">
                            {currentTier.id === 'gold' || currentTier.id === 'platinum' ? (
                                <Crown size={20} className="text-yellow-400 fill-yellow-400/20" />
                            ) : (
                                <Medal size={20} className="text-yellow-400 fill-yellow-400/20" />
                            )}
                            <span className="text-xs font-black uppercase tracking-widest whitespace-nowrap">RANGO: {customer.tier || currentTier.name}</span>
                        </div>
                    </div>

                    {/* 2. BARRA DE PROGRESO MINIMALISTA (Estilizada) */}
                    <div className="space-y-4 max-w-3xl mx-auto md:mx-0">
                        <div className="flex justify-between items-end text-[11px] font-black uppercase tracking-widest mb-1 text-white/90">
                            <span className="opacity-70">{currentTier.name}</span>
                            {nextTier && <span>SIGUIENTE: {nextTier.name}</span>}
                        </div>

                        {/* Línea de progreso estilizada */}
                        <div className="relative h-1.5 w-full bg-blue-900/30 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-yellow-400 shadow-[0_0_12px_rgba(253,224,71,0.5)] transition-all duration-1000 ease-out"
                                style={{ width: `${progressPercent}%` }}
                            ></div>
                        </div>

                        <div className="flex justify-center md:justify-start">
                            {nextTier ? (
                                <p className="text-[12px] font-bold text-white/90 bg-blue-400/20 px-4 py-1.5 rounded-full inline-block">
                                    Faltan <span className="text-yellow-300 font-black">{(minPointsOf(nextTier) - currentPoints).toLocaleString()}</span> puntos para alcanzar el nivel <span className="text-yellow-300">{nextTier.name}</span>
                                </p>
                            ) : (
                                <p className="text-yellow-300 font-black flex items-center gap-2 text-xs uppercase tracking-widest">
                                    <Star size={14} className="fill-yellow-300" /> ¡FELICIDADES! NIVEL MÁXIMO ALCANZADO
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 3. ESPACIADO Y COMPOSICIÓN (Benefits & Grid) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-6 group hover:shadow-md transition-all">
                    <div className="p-5 bg-blue-50 text-blue-600 rounded-2xl group-hover:scale-105 transition-transform duration-300">
                        <TrendingUp size={28} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Tasa de Ganancia</p>
                        <p className="text-base font-bold text-gray-800">
                            Ganas <span className="text-blue-600 font-extrabold">1 punto</span> por cada <span className="text-gray-500">{config.currencySymbol}100</span>
                        </p>
                    </div>
                </div>

                <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-6 group hover:shadow-md transition-all">
                    <div className="p-5 bg-orange-50 text-orange-600 rounded-2xl group-hover:scale-105 transition-transform duration-300">
                        <Calendar size={28} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Vencimiento</p>
                        <p className="text-base font-bold text-gray-800">
                            Los puntos vencen el <span className="text-orange-600 font-extrabold">31 de diciembre</span>
                        </p>
                    </div>
                </div>
            </div>

            {/* CARDS SECTION */}
            <div className="bg-white rounded-3xl p-10 border border-gray-100 shadow-sm w-full">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                    <div>
                        <h3 className="font-black text-xs uppercase tracking-[0.2em] text-gray-400 flex items-center gap-2">
                            <CreditCard size={18} className="text-blue-600" /> TARJETAS REGISTRADAS
                        </h3>
                    </div>
                    <button
                        onClick={onLinkCard}
                        className="text-[11px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-6 py-2.5 rounded-xl hover:bg-blue-600 hover:text-white transition-all border border-blue-100"
                    >
                        + AGREGAR NUEVA
                    </button>
                </div>

                <div className="space-y-4">
                    {(customer.cards || []).length > 0 ? (
                        (customer.cards || []).map((card: any, idx: number) => (
                            <div
                                key={card.id || `card-${idx}`}
                                className="p-5 bg-gray-50/50 rounded-2xl border border-gray-100 flex items-center justify-between group hover:border-blue-200 transition-all"
                            >
                                <div className="flex items-center gap-5">
                                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border ${card.type === 'GIFT' ? 'bg-pink-100 border-pink-200 text-pink-600' : 'bg-blue-100 border-blue-200 text-blue-600'}`}>
                                        {card.type === 'GIFT' ? <Gift size={28} /> : <Zap size={28} />}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{card.type === 'GIFT' ? 'GIFT CARD' : 'LOYALTY PASS'}</p>
                                            <span className="text-[8px] font-black bg-green-100 text-green-700 px-2 py-0.5 rounded-full uppercase">ACTIVA</span>
                                        </div>
                                        <p className="font-mono font-bold text-sm text-gray-800 tracking-[0.2em] mt-1">
                                            {card.cardNumber?.replace(/(.{4})/g, '$1 ').trim()}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-6">
                                    {card.type === 'GIFT' && (
                                        <div className="text-right">
                                            <p className="text-[9px] text-gray-400 font-black uppercase">SALDO</p>
                                            <p className="font-black text-gray-900 text-base">{config.currencySymbol}{card.pointsBalance.toLocaleString()}</p>
                                        </div>
                                    )}
                                    <button
                                        onClick={() => onUnlinkCard(card.id)}
                                        className="p-3 hover:bg-red-50 text-gray-300 hover:text-red-500 rounded-xl transition-all"
                                    >
                                        <Trash2 size={20} />
                                    </button>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="text-center py-16 text-gray-300 border-2 border-dashed border-gray-100 rounded-3xl">
                            <Award size={48} className="mx-auto mb-4 opacity-10" />
                            <p className="text-xs font-black uppercase tracking-widest opacity-50">SIN TARJETAS VINCULADAS</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default LoyaltyDashboard;
