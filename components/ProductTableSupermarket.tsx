import React, { CSSProperties, useEffect, useRef, useState } from 'react';
import { Copy, Percent, Tag, Trash2, UserPlus } from 'lucide-react';
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
    /** Resuelve el nombre del vendedor ya asignado a la línea. */
    resolveSellerName?: (salespersonId?: string | null) => string;
    containerStyle?: CSSProperties;
    taxIncluded?: boolean;
}

/**
 * Ticket denso del modo supermercado.
 *
 * Cada línea expone sus acciones (duplicar, descuento, vendedor y borrar).
 * Las acciones sin handler no se dibujan: preferimos ausencia a un botón que no
 * hace nada.
 */
const ProductTableSupermarket: React.FC<ProductTableSupermarketProps> = ({
    cart,
    config,
    currencySymbol,
    lastAddedCartId,
    onRemoveItem,
    onDuplicateItem,
    onLineDiscount,
    onAssignSeller,
    resolveSellerName,
    containerStyle,
    taxIncluded = false
}) => {
    const [highlightedId, setHighlightedId] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (lastAddedCartId) {
            setHighlightedId(lastAddedCartId);
            if (containerRef.current) {
                containerRef.current.scrollTop = 0;
            }
            const timer = setTimeout(() => setHighlightedId(null), 1500);
            return () => clearTimeout(timer);
        }
    }, [lastAddedCartId]);

    const hasActions = Boolean(onDuplicateItem || onLineDiscount || onAssignSeller || onRemoveItem);

    return (
        <div
            ref={containerRef}
            className="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-white scroll-smooth relative"
            style={containerStyle}
        >
            <table className="supermarket-ticket-table w-full text-left border-collapse table-fixed">
                <thead className="bg-[#F4F7F6] sticky top-0 z-10 text-[11px] text-[#6C7F80] font-black tracking-[0.18em] uppercase">
                    <tr>
                        <th className="px-2 py-2 text-center w-16 text-[#132124]">Cant</th>
                        <th className="px-3 py-2 w-auto">Descripción</th>
                        <th className="supermarket-money px-4 py-3 text-right">Precio<span className="block text-[9px] tracking-normal font-medium normal-case">Unitario</span></th>
                        <th className="supermarket-money px-4 py-3 text-right">ITBIS<span className="block text-[9px] tracking-normal font-medium normal-case">{taxIncluded ? 'Incluido · línea' : 'Por línea'}</span></th>
                        <th className="supermarket-money px-4 py-3 text-right text-[#132124]">Total</th>
                        {hasActions && <th className="w-[168px] pr-4 text-right text-[10px] tracking-[0.14em]">Acciones</th>}
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
                        const sellerName = item.salespersonId && resolveSellerName
                            ? resolveSellerName(item.salespersonId)
                            : '';
                        // El origen del descuento importa en caja: sin esto el operador ve
                        // 'Descuento aplicado' y no sabe si fue promoción, cupón o manual.
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
                            ? `${discountOrigin} −${currencySymbol}${discountAmount.toFixed(2)}${discountPct > 0 ? ` (${discountPct}%)` : ''}`
                            : discountOrigin;
                        const longPrice = currencySymbol.length + item.price.toFixed(2).length > 13;
                        const longTax = currencySymbol.length + taxAmount.toFixed(2).length > 13;
                        const longTotal = currencySymbol.length + total.toFixed(2).length > 13;

                        return (
                            <tr
                                key={item.cartId}
                                className={`
                                    group transition-colors duration-500
                                    ${isHighlighted ? 'bg-[#E7F7F6]' : 'hover:bg-[#F7FAF9]'}
                                    ${isReturn ? 'bg-[#FEF6F5]' : ''}
                                `}
                            >
                                <td className={`px-2 py-3 text-center font-black text-xl tabular-nums ${isReturn ? 'text-[#C0392B]' : 'text-[#132124]'}`}>
                                    {item.quantity}
                                </td>

                                <td className="px-3 py-3">
                                    <div className="flex flex-col justify-center h-full">
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                                            <span className={`font-black text-[1.02rem] break-words min-w-0 ${isReturn ? 'text-[#C0392B]' : 'text-[#1B3034]'}`}>
                                                {item.name}
                                            </span>
                                            {item.variantInfo && (
                                                <span className="supermarket-variant inline-flex rounded-lg border border-[#DEE7E6] bg-[#F4F7F6] px-2 py-1 text-sm font-bold text-[#00877F]">
                                                    {item.variantInfo}
                                                </span>
                                            )}
                                        </div>
                                        {displayCode && <span className="supermarket-code mt-1 block break-all text-xs text-[#6C7F80] font-mono">{displayCode}</span>}
                                        <div className="mt-1 flex flex-wrap items-center gap-2">
                                            {hasDiscount && (
                                                <span
                                                    className="inline-flex items-center gap-1 rounded-md bg-[#E7F7F6] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#00877F]"
                                                    title={`Precio de lista ${currencySymbol}${(item.originalPrice || 0).toFixed(2)} · cobrado ${currencySymbol}${item.price.toFixed(2)}`}
                                                >
                                                    <Percent size={10} />
                                                    {discountLabel}
                                                </span>
                                            )}
                                            {sellerName && (
                                                <span className="inline-flex items-center gap-1 rounded-md bg-[#F4F7F6] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#6C7F80]">
                                                    <Tag size={10} /> {sellerName}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </td>

                                <td className={`supermarket-money px-4 py-3 text-right text-[#1B3034] tabular-nums font-bold ${longPrice ? 'supermarket-money-long' : ''}`}>
                                    {currencySymbol}{item.price.toFixed(2)}
                                </td>

                                <td className={`supermarket-money px-4 py-3 text-right text-[#6C7F80] tabular-nums ${longTax ? 'supermarket-money-long' : ''}`}>
                                    {currencySymbol}{taxAmount.toFixed(2)}
                                </td>

                                <td className={`supermarket-money supermarket-line-total px-4 py-3 text-right font-black tabular-nums ${longTotal ? 'supermarket-money-long' : ''} ${isReturn ? 'text-[#C0392B]' : 'text-[#132124]'}`}>
                                    {currencySymbol}{total.toFixed(2)}
                                </td>

                                {hasActions && (
                                    <td className="px-3 py-2">
                                        <div className="flex items-center justify-end gap-1">
                                            {onDuplicateItem && (
                                                <button
                                                    type="button"
                                                    onClick={() => onDuplicateItem(item.cartId!)}
                                                    title="Duplicar línea"
                                                    aria-label="Duplicar línea"
                                                    className="grid h-[34px] w-[34px] place-items-center rounded-[10px] border border-[#E6EDEC] bg-[#F7FAF9] text-[#5E7B7A] transition-colors hover:border-[#00A7A0] hover:bg-[#EAF6F5] hover:text-[#00877F]"
                                                >
                                                    <Copy size={15} />
                                                </button>
                                            )}
                                            {onLineDiscount && (
                                                <button
                                                    type="button"
                                                    onClick={() => onLineDiscount(item.cartId!)}
                                                    title="Descuento en la línea"
                                                    aria-label="Descuento en la línea"
                                                    className="grid h-[34px] w-[34px] place-items-center rounded-[10px] border border-[#E6EDEC] bg-[#F7FAF9] text-[#5E7B7A] transition-colors hover:border-[#00A7A0] hover:bg-[#EAF6F5] hover:text-[#00877F]"
                                                >
                                                    <Percent size={15} />
                                                </button>
                                            )}
                                            {onAssignSeller && (
                                                <button
                                                    type="button"
                                                    onClick={() => onAssignSeller(item.cartId!)}
                                                    title="Asignar vendedor"
                                                    aria-label="Asignar vendedor"
                                                    className="grid h-[34px] w-[34px] place-items-center rounded-[10px] border border-[#E6EDEC] bg-[#F7FAF9] text-[#5E7B7A] transition-colors hover:border-[#00A7A0] hover:bg-[#EAF6F5] hover:text-[#00877F]"
                                                >
                                                    <UserPlus size={15} />
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => onRemoveItem(item.cartId!)}
                                                title="Borrar línea"
                                                aria-label="Borrar línea"
                                                className="grid h-[34px] w-[34px] place-items-center rounded-[10px] border border-[#E6EDEC] bg-[#F7FAF9] text-[#5E7B7A] transition-colors hover:border-[#F2DCD8] hover:bg-[#FEF3F1] hover:text-[#C0392B]"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                    </td>
                                )}
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
