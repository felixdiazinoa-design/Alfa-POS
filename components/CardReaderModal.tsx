import React, { useEffect, useRef, useState } from 'react';
import { CreditCard, Loader2, ScanLine, X } from 'lucide-react';
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
 * pegado a mano. Clasifica el tipo antes de actuar para no confundir una
 * tarjeta de fidelización con un producto.
 */
const CardReaderModal: React.FC<CardReaderModalProps> = ({ customers, onCustomer, onUnknown, onClose }) => {
    const [value, setValue] = useState('');
    const [status, setStatus] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const handleRead = (rawValue: string) => {
        const raw = String(rawValue || '').trim();
        if (!raw) return;
        setBusy(true);
        setStatus(null);
        try {
            const identity = identifyCard(raw, customers);
            if (identity.kind === 'UNKNOWN') {
                setStatus(`${describeCardKind('UNKNOWN')}: ${raw}`);
                onUnknown(identity);
                return;
            }
            // `identifyCard` ya devuelve la referencia del socio cuando el código
            // coincide con su id o con cualquiera de sus tarjetas (incluidas las
            // que el ERP entrega en metadata.loyaltyCards).
            const customer = customers.find(entry => String(entry.id) === identity.ref);
            if (!customer) {
                setStatus(`${describeCardKind(identity.kind)} de otra caja: ${identity.ref}`);
                onUnknown(identity);
                return;
            }
            setStatus(`${describeCardKind(identity.kind)} · ${customer.name}`);
            onCustomer(customer, identity);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[135] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
                <header className="flex items-start justify-between border-b border-[#E1E9E8] px-5 py-4">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#9DAEAD]">Caja</p>
                        <h2 className="mt-0.5 flex items-center gap-2 text-base font-black text-[#132124]">
                            <ScanLine size={16} className="text-[#00A7A0]" /> Leer tarjeta
                        </h2>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-1.5 text-[#9DAEAD] hover:bg-[#F4F7F6]" aria-label="Cerrar">
                        <X size={18} />
                    </button>
                </header>

                <div className="px-5 py-4">
                    <p className="text-[11px] font-semibold text-[#6C7F80]">
                        Pasa la tarjeta por el lector o escribe su código. Se reconoce la tarjeta EGO Club,
                        la de cliente y cualquier código registrado en esta caja.
                    </p>

                    <div className="mt-3 flex items-center gap-2">
                        <div className="relative flex-1">
                            <CreditCard size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9DAEAD]" />
                            <input
                                ref={inputRef}
                                value={value}
                                onChange={(event) => setValue(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        handleRead(event.currentTarget.value);
                                    }
                                }}
                                placeholder="Código o número de tarjeta"
                                className="h-10 w-full rounded-xl border border-[#DEE7E6] bg-white pl-9 pr-3 text-sm font-bold text-[#132124] outline-none focus:border-[#00A7A0] focus:ring-2 focus:ring-[#00A7A0]/20"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => handleRead(value)}
                            disabled={busy || !value.trim()}
                            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#00A7A0] px-3 text-[12px] font-bold text-white transition-colors hover:bg-[#00877F] disabled:opacity-50"
                        >
                            {busy ? <Loader2 size={13} className="animate-spin" /> : <ScanLine size={13} />}
                            Leer
                        </button>
                    </div>

                    {status && (
                        <p className="mt-3 rounded-lg bg-[#F4F7F6] px-3 py-2 text-[11px] font-bold text-[#1B3034]">{status}</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CardReaderModal;
