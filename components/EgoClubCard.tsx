import React, { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Coins, Loader2, RefreshCw, WifiOff, X } from 'lucide-react';
import QRCode from 'qrcode';
import type { BusinessConfig, Customer } from '../types';
import { getTierBadgeClass } from '../utils/egoClub';
import {
    getEgoClubCardSnapshot,
    resolveEgoClubCardView,
    saveEgoClubCardSnapshot,
    type EgoClubCardSnapshot,
} from '../utils/egoClubCard';

interface EgoClubCardProps {
    config: BusinessConfig;
    customer: Customer;
    currencySymbol: string;
    onClose: () => void;
}

/**
 * Tarjeta digital del socio EGO Club.
 *
 * Muestra identidad, nivel, saldo, equivalente en RD$, última actividad y QR. Funciona
 * sin conexión: si no hay datos vivos usa el **último saldo sincronizado** y lo dice con
 * su marca de tiempo («actualizado hace X»). Si nunca se sincronizó, lo indica y no
 * muestra una cifra inventada.
 */
const EgoClubCard: React.FC<EgoClubCardProps> = ({ config, customer, currencySymbol, onClose }) => {
    const [snapshot, setSnapshot] = useState<EgoClubCardSnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [qrError, setQrError] = useState<string | null>(null);
    const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const cached = await getEgoClubCardSnapshot(customer.id);
                if (cancelled) return;
                setSnapshot(cached);

                // Si el cliente trae saldo del ERP, se refresca la caché local para poder
                // mostrarla después sin conexión.
                if (typeof customer.loyaltyPoints === 'number') {
                    await saveEgoClubCardSnapshot(customer, config);
                    if (!cancelled) setSnapshot(await getEgoClubCardSnapshot(customer.id));
                }
            } catch (error) {
                console.warn('[EGO CLUB] no se pudo leer la tarjeta en caché:', error);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        const handleOnline = () => setOnline(true);
        const handleOffline = () => setOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            cancelled = true;
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [customer, config]);

    const view = useMemo(() => resolveEgoClubCardView({ customer, snapshot, config }), [customer, snapshot, config]);

    // QR generado localmente (sin CDN): la tarjeta debe verse igual sin conexión.
    useEffect(() => {
        let cancelled = false;
        QRCode.toDataURL(view.qrPayload, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
            .then(url => { if (!cancelled) setQrDataUrl(url); })
            .catch(error => { if (!cancelled) setQrError(error?.message || 'No se pudo generar el QR'); });
        return () => { cancelled = true; };
    }, [view.qrPayload]);

    const lastActivity = view.lastActivityAt
        ? new Date(view.lastActivityAt).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
        : 'Sin registro';

    return (
        <div className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-sm">
                {/* TARJETA */}
                <div className="relative rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-gray-900 text-white shadow-2xl overflow-hidden">
                    <div className="absolute inset-0 opacity-10 pointer-events-none bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:18px_18px]" />

                    <div className="relative p-5">
                        <div className="flex items-start justify-between">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">EGO Club</p>
                                <h2 className="text-xl font-black leading-tight">{view.name}</h2>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-black uppercase tracking-wide px-2 py-1 rounded-lg border ${getTierBadgeClass(view.tier)}`}>
                                    {view.tierLabel}
                                </span>
                                <button onClick={onClose} className="p-1.5 rounded-full bg-white/10 hover:bg-white/20">
                                    <X size={16} />
                                </button>
                            </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-4">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-wide text-white/40">Saldo de puntos</p>
                                {loading ? (
                                    <div className="flex items-center gap-2 text-white/60 text-sm font-bold">
                                        <Loader2 size={14} className="animate-spin" /> leyendo…
                                    </div>
                                ) : view.source === 'NONE' ? (
                                    <p className="text-sm font-bold text-amber-300">Sin saldo sincronizado</p>
                                ) : (
                                    <>
                                        <p className="text-3xl font-black leading-none flex items-center gap-2">
                                            <Coins size={20} className="text-amber-300" />
                                            {view.points.toLocaleString('es-DO')}
                                        </p>
                                        <p className="text-[11px] font-bold text-white/60 mt-1">
                                            ≈ {currencySymbol}{view.value.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </p>
                                    </>
                                )}
                            </div>

                            <div className="w-24 h-24 shrink-0 rounded-xl bg-white p-1.5 flex items-center justify-center">
                                {qrDataUrl ? (
                                    <img src={qrDataUrl} alt={`QR de socio ${view.name}`} className="w-full h-full" />
                                ) : (
                                    <span className="text-[9px] font-bold text-gray-400 text-center">
                                        {qrError ? 'QR no disponible' : 'generando QR…'}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[10px] font-bold text-white/60">
                            <span>Última actividad: {lastActivity}</span>
                            <span className={`flex items-center gap-1 ${online ? 'text-emerald-300' : 'text-amber-300'}`}>
                                {online ? <RefreshCw size={11} /> : <WifiOff size={11} />}
                                {view.source === 'LIVE' ? 'en línea' : view.freshness}
                            </span>
                        </div>
                    </div>
                </div>

                {view.source !== 'LIVE' && (
                    <div className="mt-3 rounded-2xl bg-white/95 px-4 py-3 text-[11px] font-bold text-gray-600">
                        {view.source === 'CACHED' ? (
                            <>
                                Mostrando el último saldo sincronizado con el ERP ({view.freshness}).
                                {view.syncedAt && (
                                    <span className="block text-gray-400 font-normal">
                                        Sincronizado el {new Date(view.syncedAt).toLocaleString('es-DO')}
                                    </span>
                                )}
                            </>
                        ) : (
                            <>
                                Este socio todavía no tiene saldo sincronizado en este terminal.
                                Conecta el terminal para consultarlo en el ERP.
                            </>
                        )}
                    </div>
                )}

                <button
                    onClick={onClose}
                    className="mt-3 w-full py-2.5 rounded-xl bg-white text-slate-900 font-black text-sm flex items-center justify-center gap-2"
                >
                    <BadgeCheck size={16} /> Cerrar tarjeta
                </button>
            </div>
        </div>
    );
};

export default EgoClubCard;
