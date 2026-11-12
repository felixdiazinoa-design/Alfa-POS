import React, { useEffect, useRef, useState } from 'react';
import { Check, CreditCard, Loader2, Search, X } from 'lucide-react';
import type { Customer } from '../types';
import { describeCardKind, identifyCard, type CardIdentity } from '../utils/cardIdentity';

interface CardReaderModalProps {
    customers: Customer[];
    /** Se invoca cuando el código leído corresponde a un socio de esta caja. */
    onCustomer: (customer: Customer, identity: CardIdentity) => void;
    /** Se invoca con el resultado cuando el código no es utilizable. */
    onUnknown: (identity: CardIdentity) => void;
    onClose: () => void;
}

/**
 * Lector de tarjetas de la caja.
 *
 * Acepta cualquier código: el QR de la tarjeta digital EGO Club (formato nuevo
 * con datos y formato antiguo), el código de barras de un socio o el texto
 * pegado a mano. Clasifica el tipo y resuelve al socio en una sola pantalla,
 * sin abrir después el modal antiguo de lealtad.
 */
const CardReaderModal: React.FC<CardReaderModalProps> = ({ customers, onCustomer, onUnknown, onClose }) => {
    const [value, setValue] = useState('');
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const timer = setTimeout(() => inputRef.current?.focus(), 60);
        return () => clearTimeout(timer);
    }, []);

    const handleRead = (rawValue: string) => {
        const raw = String(rawValue || '').trim();
        if (!raw) return;
        setBusy(true);
        setStatus(null);
        setError(null);
        try {
            const identity = identifyCard(raw, customers);
            if (identity.kind === 'UNKNOWN') {
                setError(`${describeCardKind('UNKNOWN')}: ${raw}`);
                onUnknown(identity);
                return;
            }
            // `identifyCard` devuelve el id del socio cuando el código coincide
            // con su id o con cualquiera de sus tarjetas.
            const customer = customers.find(entry => String(entry.id) === identity.ref);
            if (!customer) {
                setError(`${describeCardKind(identity.kind)} de otra caja: ${identity.ref}`);
                onUnknown(identity);
                return;
            }
            setStatus(`${describeCardKind(identity.kind)} · ${customer.name}`);
            onCustomer(customer, identity);
        } finally {
            setBusy(false);
        }
    };

    const canSubmit = Boolean(value.trim()) && !busy;

    return (
        <div className="fixed inset-0 z-[135] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
                <div className="px-6 pb-4 pt-5">
                    <div className="flex items-start justify-between">
                        <h2 className="flex items-center gap-2 text-lg font-black text-[#132124]">
                            <CreditCard size={20} className="text-[#00A7A0]" />
                            Tarjeta de Lealtad
                        </h2>
                        <button
                            onClick={onClose}
                            className="grid h-8 w-8 place-items-center rounded-full bg-[#EFF3F2] text-[#8A9A99] transition-colors hover:bg-[#E2E8E7]"
                            aria-label="Cerrar"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    <label className="mt-5 block text-[10px] font-black uppercase tracking-[0.14em] text-[#9DAEAD]">
                        Número de tarjeta
                    </label>
                    <div className="relative mt-1.5">
                        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9DAEAD]" />
                        <input
                            ref={inputRef}
                            value={value}
                            onChange={(event) => { setValue(event.target.value); setError(null); }}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    if (canSubmit) handleRead(event.currentTarget.value);
                                }
                            }}
                            placeholder="Escanea o digita…"
                            inputMode="text"
                            autoComplete="off"
                            className="h-14 w-full rounded-xl border border-[#DEE7E6] bg-white pl-11 pr-3 text-[15px] font-bold text-[#132124] outline-none transition-colors placeholder:font-semibold placeholder:text-[#B9C7C6] focus:border-[#00A7A0] focus:ring-2 focus:ring-[#00A7A0]/20"
                        />
                    </div>

                    <button
                        type="button"
                        onClick={() => handleRead(value)}
                        disabled={!canSubmit}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#00A7A0] px-4 py-3.5 text-[15px] font-black text-white shadow-[0_16px_30px_-20px_rgba(0,167,160,1)] transition-colors hover:bg-[#00877F] disabled:cursor-not-allowed disabled:bg-[#9ED9D4]"
                    >
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={17} />}
                        Buscar y Asignar
                    </button>

                    {status && (
                        <p className="mt-3 rounded-xl bg-[#F5FBEA] px-3 py-2 text-[12px] font-bold text-[#4C6B12]">{status}</p>
                    )}
                    {error && (
                        <p className="mt-3 rounded-xl bg-[#FEF6F5] px-3 py-2 text-[12px] font-bold text-[#C0392B]">{error}</p>
                    )}
                </div>

                <div className="border-t border-[#EEF3F2] bg-[#FAFCFB] px-6 py-3">
                    <p className="text-center text-[11px] font-semibold text-[#8A9A99]">
                        Escanea el código de barras o QR de la tarjeta física o digital.
                        Se reconoce la tarjeta EGO Club y la de cliente.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default CardReaderModal;
