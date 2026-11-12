import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Send, X } from 'lucide-react';
import { listLoyaltyOutbox, type LoyaltyOutboxItem } from '../utils/loyaltyOutbox';
import { flushLoyaltyOutbox } from '../services/loyalty/LoyaltyService';

interface LoyaltySyncPanelProps {
    onClose: () => void;
    /** Se invoca tras un reintento para que el resumen refresque su contador. */
    onFlushed?: () => void;
}

const TYPE_LABEL: Record<string, string> = {
    ENROLL: 'Alta de socio',
    SALE_DOCUMENT: 'Reporte de venta',
};

const STATUS_LABEL: Record<string, string> = {
    PENDING: 'En cola',
    FAILED: 'Con error',
    SYNCED: 'Enviado',
};

const relativeTime = (iso?: string): string => {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '';
    const diff = Date.now() - then;
    if (diff < 60_000) return 'hace menos de un minuto';
    const minutes = Math.round(diff / 60_000);
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    return `hace ${Math.round(hours / 24)} d`;
};

/**
 * Panel de envíos de EGO Club.
 *
 * El chip 'En línea' del resumen abre esta lista: muestra qué operaciones están
 * esperando salir al ERP (altas y reportes de venta), con sus intentos y el
 * último error, y permite forzar un reenvío sin reiniciar la caja.
 */
const LoyaltySyncPanel: React.FC<LoyaltySyncPanelProps> = ({ onClose, onFlushed }) => {
    const [items, setItems] = useState<LoyaltyOutboxItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [flushing, setFlushing] = useState(false);
    const [lastResult, setLastResult] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const queue = await listLoyaltyOutbox();
            setItems(queue);
        } catch {
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    const pending = useMemo(
        () => items.filter(item => item.status === 'PENDING' || item.status === 'FAILED'),
        [items],
    );
    const recentSynced = useMemo(
        () => items.filter(item => item.status === 'SYNCED').slice(-3).reverse(),
        [items],
    );

    const handleFlush = async () => {
        setFlushing(true);
        setLastResult(null);
        try {
            const result = await flushLoyaltyOutbox();
            const sent = Number(result?.synced ?? 0);
            const failed = Number(result?.failed ?? 0);
            const deferred = Number(result?.deferred ?? 0);
            if (sent > 0) {
                setLastResult(`Enviadas ${sent}${failed > 0 ? `, ${failed} con error` : ''}.`);
            } else if (deferred > 0) {
                setLastResult('El canal de lealtad no está publicado en el ERP; quedan en cola.');
            } else {
                setLastResult(failed > 0 ? `${failed} operación(es) siguen fallando.` : 'No había nada que enviar.');
            }
            await refresh();
            onFlushed?.();
        } catch (error) {
            setLastResult(error instanceof Error ? error.message : 'No se pudo reintentar el envío.');
        } finally {
            setFlushing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                <header className="flex items-start justify-between border-b border-[#E1E9E8] px-5 py-4">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#9DAEAD]">EGO Club · envíos</p>
                        <h2 className="mt-0.5 text-base font-black text-[#132124]">
                            {pending.length === 0 ? 'Todo enviado' : `${pending.length} operación(es) por enviar`}
                        </h2>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-1.5 text-[#9DAEAD] hover:bg-[#F4F7F6]" aria-label="Cerrar">
                        <X size={18} />
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto px-4 py-3">
                    {loading && (
                        <p className="py-6 text-center text-xs font-semibold text-[#6C7F80]">Leyendo la cola…</p>
                    )}

                    {!loading && pending.length === 0 && (
                        <div className="flex flex-col items-center gap-2 py-6 text-center">
                            <CheckCircle2 size={26} className="text-[#00A7A0]" />
                            <p className="text-xs font-bold text-[#1B3034]">No hay envíos pendientes al ERP.</p>
                        </div>
                    )}

                    {pending.map(item => (
                        <div key={item.id} className="mb-2 rounded-xl border border-[#E1E9E8] bg-white p-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-[11px] font-black uppercase tracking-wide text-[#00877F]">
                                        {TYPE_LABEL[item.type] || item.type}
                                    </p>
                                    <p className="mt-0.5 truncate text-[12px] font-bold text-[#132124]" title={item.reference || item.id}>
                                        {item.reference || item.id}
                                    </p>
                                </div>
                                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide ${
                                    item.status === 'FAILED'
                                        ? 'bg-[#FEF6F5] text-[#C0392B]'
                                        : 'bg-[#FEFAF1] text-[#9A5B00]'
                                }`}>
                                    {STATUS_LABEL[item.status] || item.status}
                                </span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-[#6C7F80]">
                                <span>Intentos: {item.attempts}</span>
                                {item.lastAttemptAt && <span>Último: {relativeTime(item.lastAttemptAt)}</span>}
                                {item.nextAttemptAt && <span>Reintento: {relativeTime(item.nextAttemptAt).replace('hace', 'en')}</span>}
                            </div>
                            {item.error && (
                                <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-[#FEF6F5] px-2 py-1.5 text-[10px] font-semibold text-[#C0392B]">
                                    <AlertCircle size={12} className="mt-0.5 shrink-0" />
                                    <span className="min-w-0 break-words">{item.error}</span>
                                </p>
                            )}
                        </div>
                    ))}

                    {recentSynced.length > 0 && (
                        <div className="mt-3 border-t border-[#EEF3F2] pt-3">
                            <p className="mb-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-[#9DAEAD]">Últimos enviados</p>
                            {recentSynced.map(item => (
                                <p key={`synced-${item.id}`} className="truncate text-[11px] font-semibold text-[#6C7F80]">
                                    ✓ {TYPE_LABEL[item.type] || item.type} · {item.reference || item.id}
                                </p>
                            ))}
                        </div>
                    )}
                </div>

                <footer className="flex items-center justify-between gap-3 border-t border-[#E1E9E8] px-4 py-3">
                    <p className="min-w-0 flex-1 text-[10px] font-semibold text-[#6C7F80]">{lastResult || ''}</p>
                    <button
                        onClick={() => void handleFlush()}
                        disabled={flushing || pending.length === 0}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#00A7A0] px-3 text-[12px] font-bold text-white transition-colors hover:bg-[#00877F] disabled:opacity-50"
                    >
                        {flushing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                        Reintentar ahora
                    </button>
                    <button
                        onClick={() => void refresh()}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#E1E9E8] px-2.5 text-[12px] font-bold text-[#4A615F] hover:bg-[#F4F7F6]"
                        title="Actualizar la lista"
                    >
                        <RefreshCw size={13} />
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default LoyaltySyncPanel;
