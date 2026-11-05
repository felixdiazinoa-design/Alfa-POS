import React, { useMemo, useState } from 'react';
import { AlertCircle, Coins, Loader2, X } from 'lucide-react';
import type { BusinessConfig, Customer } from '../types';
import { calculateRedemptionBounds, getTierLabel, pointsToCurrency } from '../utils/egoClub';
import { getLoyaltyChannelStatus, redeemPoints } from '../services/loyalty/LoyaltyService';

interface LoyaltyRedeemModalProps {
    config: BusinessConfig;
    customer: Customer;
    /** Total que el cliente paga por el ticket (con impuestos). */
    ticketTotal: number;
    currencySymbol: string;
    /** Saldo disponible según el ERP (último sincronizado). */
    availablePoints: number;
    onClose: () => void;
    /** Se invoca sólo si el ERP autorizó el canje. */
    onRedeemed: (result: { points: number; value: number; balanceAfter?: number; reason: string }) => void;
}

/**
 * Canje de puntos EGO Club en el ticket.
 *
 * La operación es en línea y **falla cerrada**: si el ERP no autoriza, no se aplica ningún
 * descuento y la línea del ticket no se toca. El tope es
 * `min(puntos disponibles, total del ticket / tasa de canje)` y el mínimo es el umbral de
 * canje del nivel del socio (un umbral, no un saldo residual).
 *
 * Si el canal de lealtad no está disponible en esta caja (`/loyalty/redeem` no publicado o
 * bandera apagada), el modal se muestra degradado: explica el motivo y no deja canjear,
 * sin bloquear la venta ni mostrar un error de red.
 */
const LoyaltyRedeemModal: React.FC<LoyaltyRedeemModalProps> = ({
    config,
    customer,
    ticketTotal,
    currencySymbol,
    availablePoints,
    onClose,
    onRedeemed,
}) => {
    const channel = useMemo(() => getLoyaltyChannelStatus('/loyalty/redeem'), []);
    const redemptionEnabled = channel.enabled;

    const bounds = useMemo(() => calculateRedemptionBounds({
        availablePoints,
        ticketTotal,
        config,
        tier: customer.tier,
    }), [availablePoints, ticketTotal, config, customer.tier]);

    const [pointsInput, setPointsInput] = useState<string>(String(bounds.canRedeem ? bounds.max : bounds.minUnits));
    const [reason, setReason] = useState('Canje EGO Club');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const points = Math.floor(Number(pointsInput) || 0);
    const value = pointsToCurrency(points, config);
    const overMax = points > bounds.max;
    const invalid = points <= 0 || overMax;

    const handleConfirm = async () => {
        setError(null);
        if (!redemptionEnabled) {
            setError(channel.reason || 'Canje no disponible en esta caja');
            return;
        }
        if (invalid) {
            setError(`El máximo canjeable en este ticket es ${bounds.max.toLocaleString('es-DO')} puntos`);
            return;
        }

        setSaving(true);
        try {
            const result = await redeemPoints({
                customerId: customer.id,
                points,
                reason: reason.trim() || 'Canje EGO Club',
            });

            if (!result.ok) {
                // Falla cerrada: no se aplica nada y se avisa al cajero. Si la capacidad no
                // está publicada, el mensaje ya viene como "no disponible en esta caja".
                setError(result.error || 'No se pudo canjear los puntos');
                return;
            }

            onRedeemed({
                points,
                value,
                balanceAfter: result.balance,
                reason: reason.trim() || 'Canje EGO Club',
            });
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden">
                <header className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
                            <Coins className="text-amber-500" size={18} /> Canjear puntos
                        </h2>
                        <p className="text-xs text-gray-500">
                            {customer.name}
                            {customer.tier ? ` · ${getTierLabel(config, customer.tier)}` : ''}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full text-gray-400 hover:bg-gray-100">
                        <X size={18} />
                    </button>
                </header>

                <div className="px-5 py-5 space-y-4">
                    {!redemptionEnabled && (
                        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
                            <AlertCircle size={16} className="mt-0.5 shrink-0" />
                            <p className="text-[11px] font-bold">
                                {channel.reason || 'Canje no disponible en esta caja.'}
                                {' '}El saldo mostrado es el último sincronizado con el ERP.
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="p-2 rounded-xl bg-gray-50 border border-gray-100">
                            <p className="text-[10px] font-black uppercase text-gray-400">Disponibles</p>
                            <p className="text-sm font-black text-gray-800">{bounds.available.toLocaleString('es-DO')}</p>
                        </div>
                        <div className="p-2 rounded-xl bg-gray-50 border border-gray-100">
                            <p className="text-[10px] font-black uppercase text-gray-400">Mínimo nivel</p>
                            <p className="text-sm font-black text-gray-800">{bounds.minUnits.toLocaleString('es-DO')}</p>
                        </div>
                        <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-100">
                            <p className="text-[10px] font-black uppercase text-emerald-600">Máximo</p>
                            <p className="text-sm font-black text-emerald-700">{bounds.max.toLocaleString('es-DO')}</p>
                        </div>
                    </div>

                    {!bounds.canRedeem && (
                        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
                            <AlertCircle size={16} className="mt-0.5 shrink-0" />
                            <p className="text-[11px] font-bold">{bounds.blockedReason}</p>
                        </div>
                    )}

                    <label className="block">
                        <span className="text-[11px] font-black uppercase tracking-wide text-gray-500">Puntos a canjear</span>
                        <input
                            type="number"
                            inputMode="numeric"
                            min={bounds.minAmount}
                            max={bounds.max}
                            value={pointsInput}
                            disabled={!redemptionEnabled || !bounds.canRedeem}
                            onChange={(event) => setPointsInput(event.target.value)}
                            className={`mt-1 w-full rounded-xl border-2 px-3 py-2 text-lg font-black text-gray-900 outline-none disabled:bg-gray-100 ${
                                invalid && points > 0 ? 'border-red-300 bg-red-50' : 'border-gray-200 focus:border-blue-400'
                            }`}
                        />
                        <div className="flex items-center justify-between mt-1">
                            <span className="text-[11px] font-bold text-gray-500">
                                Equivale a {currencySymbol}{value.toFixed(2)}
                            </span>
                            {redemptionEnabled && bounds.canRedeem && (
                                <button
                                    type="button"
                                    onClick={() => setPointsInput(String(bounds.max))}
                                    className="text-[11px] font-black text-blue-600 uppercase"
                                >
                                    Usar máximo
                                </button>
                            )}
                        </div>
                    </label>

                    <label className="block">
                        <span className="text-[11px] font-black uppercase tracking-wide text-gray-500">Motivo</span>
                        <input
                            value={reason}
                            disabled={!redemptionEnabled || !bounds.canRedeem}
                            onChange={(event) => setReason(event.target.value)}
                            className="mt-1 w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-blue-400 disabled:bg-gray-100"
                        />
                        <span className="text-[10px] text-gray-400">Queda registrado en la línea del ticket y en el cierre de caja</span>
                    </label>

                    {error && (
                        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700">
                            <AlertCircle size={16} className="mt-0.5 shrink-0" />
                            <p className="text-[11px] font-bold">{error}</p>
                        </div>
                    )}
                </div>

                <footer className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100">
                        Cancelar
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!redemptionEnabled || !bounds.canRedeem || saving || invalid}
                        className="px-5 py-2 rounded-xl text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 flex items-center gap-2"
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Coins size={16} />}
                        Canjear {currencySymbol}{value.toFixed(2)}
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default LoyaltyRedeemModal;
