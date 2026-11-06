import React, { CSSProperties, useEffect, useRef, useState } from 'react';
import { Copy, Minus, MoreHorizontal, Percent, Plus, Tag, Trash2, UserPlus } from 'lucide-react';
import { CartItem, BusinessConfig } from '../types';
import './supermarketTicket.css';

interface ProductTableSupermarketProps {
    cart: CartItem[];
    config: BusinessConfig;
    currencySymbol: string;
    lastAddedCartId: string | null;
    onRemoveItem: (cartId: string) => void;
    /** Clona la línea al instante (no vuelve a consultar catálogo ni stock). */
    onDuplicateItem?: (cartId: string) => void;
    /** Abre el descuento acotado a esta línea. */
    onLineDiscount?: (cartId: string) => void;
    /** Abre el selector de vendedor para esta línea. */
    onAssignSeller?: (cartId: string) => void;
    /** Cambia la cantidad de la línea (editor dentro del menú de acciones). */
    onChangeQuantity?: (cartId: string, quantity: number) => void;
    /** Resuelve el nombre del vendedor ya asignado a la línea. */
    resolveSellerName?: (salespersonId?: string | null) => string;
    containerStyle?: CSSProperties;
    taxIncluded?: boolean;
}

type VariantParts = { color: string; size: string; material: string; extra: string[] };

/**
 * La variante llega como "Color: X / Talla: Y / Material: Z". Se separa en
 * columnas propias para que la tabla se lea como una ficha de producto y no
 * como un párrafo dentro de la descripción.
 */
const parseVariantParts = (variantInfo?: string): VariantParts => {
    const parts: VariantParts = { color: '', size: '', material: '', extra: [] };
    String(variantInfo || '')
        .split('/')
        .map((token) => token.trim())
        .filter(Boolean)
        .forEach((token) => {
            const separator = token.indexOf(':');
            const label = (separator > 0 ? token.slice(0, separator) : '').trim().toLowerCase();
            const value = (separator > 0 ? token.slice(separator + 1) : token).trim();
            if (!value) return;
            if (/color/.test(label)) { parts.color = value; return; }
            if (/talla|size|medida/.test(label)) { parts.size = value; return; }
            if (/material|tela/.test(label)) { parts.material = value; return; }
            parts.extra.push(token);
        });
    return parts;
};

const ProductTableSupermarket: React.FC<ProductTableSupermarketProps> = ({
    cart,
    config,
    currencySymbol,
    lastAddedCartId,
    onRemoveItem,
    onDuplicateItem,
    onLineDiscount,
    onAssignSeller,
    onChangeQuantity,
    resolveSellerName,
    containerStyle,
    taxIncluded = false
}) => {
    const [highlightedId, setHighlightedId] = useState<string | null>(null);
    const [openActionsId, setOpenActionsId] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (lastAddedCartId) {
            setHighlightedId(lastAddedCartId);
            if (containerRef.current) containerRef.current.scrollTop = 0;
            const timer = setTimeout(() => setHighlightedId(null), 1500);
            return () => clearTimeout(timer);
        }
    }, [lastAddedCartId]);

    // Cerrar el menú de acciones al tocar fuera.
    useEffect(() => {
        if (!openActionsId) return;
        const close = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('[data-line-actions]')) return;
            setOpenActionsId(null);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [openActionsId]);

    return (
        <div
            ref={containerRef}
            className="flex-1 min-h-0 overflow-auto custom-scrollbar bg-white scroll-smooth relative"
            style={containerStyle}
        >
            <table className="supermarket-ticket-table w-full text-left border-collapse table-fixed">
                <thead className="bg-[#F4F7F6] sticky top-0 z-10 text-[9px] text-[#6C7F80] font-black tracking-[0.1em] uppercase">
                    <tr>
                        <th className="w-[56px] px-2 py-2 text-center text-[#132124]">Cant</th>
                        <th className="w-[30%] px-2 py-2">Descripción</th>
                        <th className="w-[13%] px-2 py-2">Color</th>
                        <th className="w-[8%] px-2 py-2">Talla</th>
                        <th className="w-[13%] px-2 py-2">Material</th>
                        <th className="w-[11%] px-2 py-2 text-right">Precio<span className="block text-[8px] tracking-normal font-medium normal-case">Unitario</span></th>
                        <th className="w-[9%] px-2 py-2 text-right">ITBIS<span className="block text-[8px] tracking-normal font-medium normal-case">{taxIncluded ? 'Incluido' : 'Línea'}</span></th>
                        <th className="w-[11%] px-2 py-2 text-right text-[#132124]">Total</th>
                        <th className="w-[52px] px-1 py-2 text-center">Acciones</th>
                    </tr>
                </thead>
                <tbody className="text-sm divide-y divide-[#EDF2F1]">
                    {cart.map((item) => {
                        const isHighlighted = highlightedId === item.cartId;
                        const taxAmount = item.price * item.quantity * (config.taxRate || 0.18);
                        const total = item.price * item.quantity;
                        const hasDiscount = item.originalPrice && item.price < item.originalPrice;
                        const displayCode = item.barcode || item.variantSku || item.sku || item.id;
                        const isReturn = item.quantity < 0;
                        const sellerName = item.salespersonId && resolveSellerName ? resolveSellerName(item.salespersonId) : '';
                        const variant = parseVariantParts(item.variantInfo);
                        const money = (value: number) => `${currencySymbol}${value.toFixed(2)}`;

                        const discountAmount = Math.max(
                            0,
                            ((Number(item.originalPrice) || item.price) - item.price) * Math.abs(item.quantity || 1),
                        );
                        const discountPct = item.originalPrice && item.originalPrice > 0
                            ? Math.round((1 - item.price / item.originalPrice) * 100)
                            : 0;
                        const discountOrigin = (() => {
                            if (item.appliedPromotionName) return item.appliedPromotionName;
                            if (item.adjustmentSource === 'MANUAL_DISCOUNT') return 'Manual';
                            if (item.adjustmentSource === 'PROMOTION') return 'Promoción';
                            if (item.adjustmentSource === 'TARIFF') return 'Tarifa';
                            return 'Descuento';
                        })();
                        const discountLabel = discountAmount > 0
                            ? `${discountOrigin} −${money(discountAmount)}${discountPct > 0 ? ` (${discountPct}%)` : ''}`
                            : discountOrigin;

                        const actionsOpen = openActionsId === item.cartId;
                        const quantity = Math.abs(Number(item.quantity) || 0);

                        return (
                            <tr
                                key={item.cartId}
                                className={`
                                    group transition-colors duration-500
                                    ${isHighlighted ? 'bg-[#E7F7F6]' : 'hover:bg-[#F7FAF9]'}
                                    ${isReturn ? 'bg-[#FEF6F5]' : ''}
                                `}
                            >
                                <td className={`px-2 py-2 text-center font-black text-[11px] tabular-nums ${isReturn ? 'text-[#C0392B]' : 'text-[#132124]'}`}>
                                    {item.quantity}
                                </td>

                                <td className="px-2 py-2">
                                    <span className={`block font-bold text-[11px] leading-tight break-words ${isReturn ? 'text-[#C0392B]' : 'text-[#1B3034]'}`}>
                                        {item.name}
                                    </span>
                                    {displayCode && (
                                        <span className="supermarket-code mt-0.5 block break-all text-[9px] text-[#8A9A99] font-mono">{displayCode}</span>
                                    )}
                                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                        {variant.extra.map((token, index) => (
                                            <span key={`${item.cartId}-extra-${index}`} className="inline-flex items-baseline gap-1 rounded border border-[#DEE7E6] bg-[#F4F7F6] px-1.5 py-0.5 text-[9px] font-black text-[#00877F]">
                                                {token}
                                            </span>
                                        ))}
                                        {hasDiscount && (
                                            <span
                                                className="inline-flex items-center gap-1 rounded-md bg-[#FDECEA] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#C0392B]"
                                                title={`Precio de lista ${money(item.originalPrice || 0)} · cobrado ${money(item.price)}`}
                                            >
                                                <Percent size={9} />
                                                {discountLabel}
                                            </span>
                                        )}
                                        {sellerName && (
                                            <span className="inline-flex items-center gap-1 rounded-md bg-[#F4F7F6] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#6C7F80]">
                                                <Tag size={9} /> {sellerName}
                                            </span>
                                        )}
                                    </div>
                                </td>

                                <td className="px-2 py-2 align-top">
                                    <span className="block truncate text-[10px] font-semibold text-[#1B3034]" title={variant.color || undefined}>
                                        {variant.color || <span className="text-[#C3D0CF]">—</span>}
                                    </span>
                                </td>
                                <td className="px-2 py-2 align-top">
                                    <span className="block truncate text-[10px] font-semibold text-[#1B3034]" title={variant.size || undefined}>
                                        {variant.size || <span className="text-[#C3D0CF]">—</span>}
                                    </span>
                                </td>
                                <td className="px-2 py-2 align-top">
                                    <span className="block truncate text-[10px] font-semibold text-[#1B3034]" title={variant.material || undefined}>
                                        {variant.material || <span className="text-[#C3D0CF]">—</span>}
                                    </span>
                                </td>

                                <td className="px-2 py-2 text-right text-[10px] font-semibold text-[#1B3034] tabular-nums whitespace-nowrap">
                                    {money(item.price)}
                                </td>
                                <td className="px-2 py-2 text-right text-[10px] text-[#6C7F80] tabular-nums whitespace-nowrap">
                                    {money(taxAmount)}
                                </td>
                                <td className={`px-2 py-2 text-right text-[11px] font-bold tabular-nums whitespace-nowrap ${isReturn ? 'text-[#C0392B]' : 'text-[#132124]'}`}>
                                    {money(total)}
                                </td>

                                <td className="relative px-1 py-2 text-center" data-line-actions>
                                    <button
                                        type="button"
                                        onClick={() => setOpenActionsId(actionsOpen ? null : item.cartId!)}
                                        aria-label="Acciones de la línea"
                                        aria-expanded={actionsOpen}
                                        className="mx-auto grid h-7 w-7 place-items-center rounded-lg border border-[#E6EDEC] bg-[#F7FAF9] text-[#5E7B7A] transition-colors hover:border-[#00A7A0] hover:text-[#00877F]"
                                    >
                                        <MoreHorizontal size={14} />
                                    </button>

                                    {actionsOpen && (
                                        <div className="absolute right-2 top-full z-30 w-56 rounded-xl border border-[#E1E9E8] p-2 text-left shadow-xl" style={{ backgroundColor: "#ffffff" }}>
                                            {onChangeQuantity && (
                                                <div className="mb-1 rounded-lg border border-[#E6EDEC] p-1.5" style={{ backgroundColor: "#F7FAF9" }}>
                                                    <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-[#8A9A99]">Cantidad</p>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => onChangeQuantity(item.cartId!, Math.max(1, quantity - 1))}
                                                            disabled={quantity <= 1}
                                                            className="grid h-7 w-7 place-items-center rounded-md border border-[#E1E9E8] bg-white text-[#1B3034] disabled:opacity-40"
                                                        >
                                                            <Minus size={12} />
                                                        </button>
                                                        <span className="text-[13px] font-black tabular-nums text-[#132124]">{quantity}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => onChangeQuantity(item.cartId!, quantity + 1)}
                                                            className="grid h-7 w-7 place-items-center rounded-md border border-[#E1E9E8] bg-white text-[#1B3034]"
                                                        >
                                                            <Plus size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {onDuplicateItem && (
                                                <button
                                                    type="button"
                                                    onClick={() => { onDuplicateItem(item.cartId!); setOpenActionsId(null); }}
                                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-bold text-[#1B3034] hover:bg-[#F4F7F6]" style={{ backgroundColor: "transparent", border: "none" }}
                                                >
                                                    <Copy size={13} className="text-[#00877F]" /> Duplicar línea
                                                </button>
                                            )}
                                            {onLineDiscount && (
                                                <button
                                                    type="button"
                                                    onClick={() => { onLineDiscount(item.cartId!); setOpenActionsId(null); }}
                                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-bold text-[#1B3034] hover:bg-[#F4F7F6]" style={{ backgroundColor: "transparent", border: "none" }}
                                                >
                                                    <Percent size={13} className="text-[#00877F]" /> Descuento en la línea
                                                </button>
                                            )}
                                            {onAssignSeller && (
                                                <button
                                                    type="button"
                                                    onClick={() => { onAssignSeller(item.cartId!); setOpenActionsId(null); }}
                                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-bold text-[#1B3034] hover:bg-[#F4F7F6]" style={{ backgroundColor: "transparent", border: "none" }}
                                                >
                                                    <UserPlus size={13} className="text-[#00877F]" /> Asignar vendedor
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => { onRemoveItem(item.cartId!); setOpenActionsId(null); }}
                                                className="mt-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-bold text-[#C0392B] hover:bg-[#FDECEA]" style={{ backgroundColor: "transparent", border: "none" }}
                                            >
                                                <Trash2 size={13} /> Borrar línea
                                            </button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {cart.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-[#9DAEAD] pointer-events-none">
                    <p className="text-lg font-black opacity-70">Ticket vacío</p>
                    <p className="mt-2 text-xs uppercase tracking-[0.24em] opacity-60">Modo supermercado activo</p>
                </div>
            )}
        </div>
    );
};

export default ProductTableSupermarket;
