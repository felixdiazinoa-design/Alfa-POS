import React from 'react';
import {
    Percent, QrCode, Inbox, StickyNote, ArrowRightLeft,
    Lock, LogOut, Settings, Box, Save, CreditCard, RotateCcw
} from 'lucide-react';
import { BusinessConfig } from '../types';

interface ModernActionFooterProps {
    onAction: (action: string) => void;
    config: BusinessConfig;
    parkedTicketsCount: number;
    globalDiscountValue: number;
    isReturnMode: boolean;
    hasCartItems: boolean;
}

const ModernActionFooter: React.FC<ModernActionFooterProps> = ({
    onAction,
    config,
    parkedTicketsCount,
    globalDiscountValue,
    isReturnMode,
    hasCartItems
}) => {

    const renderButton = (
        id: string,
        label: string,
        icon: React.ReactElement,
        group: 'sales' | 'flow' | 'terminal' | 'closing',
        disabled: boolean = false,
        badge?: number | boolean
    ) => {
        let accentColor = "";
        let hoverColor = "";
        let iconColor = "";
        const textColor = "text-slate-600";

        switch (group) {
            case 'sales':
                accentColor = "border-l-indigo-600";
                hoverColor = "hover:bg-indigo-50";
                iconColor = "text-indigo-800";
                break;
            case 'flow':
                accentColor = "border-l-amber-500";
                hoverColor = "hover:bg-amber-50";
                iconColor = "text-amber-800";
                break;
            case 'terminal':
                accentColor = "border-l-slate-400";
                hoverColor = "hover:bg-slate-50";
                iconColor = "text-slate-800";
                break;
            case 'closing':
                accentColor = "border-l-rose-500";
                hoverColor = "hover:bg-rose-50";
                iconColor = "text-rose-800";
                break;
        }

        // Specific color for Discount when active
        const isActiveDiscount = id === 'DISCOUNT' && globalDiscountValue > 0;
        const finalIconColor = isActiveDiscount ? 'text-red-600' : iconColor;
        const finalAccentColor = isActiveDiscount ? 'border-l-red-500' : accentColor;

        return (
            <button
                key={id}
                disabled={disabled}
                onClick={() => onAction(id)}
                className={`
                    flex flex-col items-center justify-center 
                    bg-white rounded-2xl border-l-[4px] ${finalAccentColor}
                    shadow-sm hover:shadow-md transition-all duration-200
                    active:scale-95 py-2 px-1 relative h-16
                    ${disabled ? 'opacity-40 grayscale pointer-events-none' : hoverColor}
                `}
            >
                <div className={`${finalIconColor} mb-1.5`}>
                    {React.cloneElement(icon, { size: 22, strokeWidth: 2.5 })}
                </div>
                <span className={`text-[10px] font-extrabold uppercase tracking-wider text-center px-1 leading-none ${disabled ? 'text-slate-400' : 'text-slate-700'}`}>
                    {label}
                </span>

                {badge && (
                    <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-orange-600 text-[10px] font-black text-white shadow-sm ring-2 ring-white">
                        {typeof badge === 'number' ? badge : ''}
                    </span>
                )}
            </button>
        );
    };

    return (
        <div className="w-full bg-gray-50 border-t border-gray-200 p-3 pt-4">
            <div className="max-w-[1800px] mx-auto grid grid-cols-6 gap-2 lg:gap-3 xl:gap-4">
                {/* GROUP 1: VENTAS (Indigo) */}
                {renderButton('DISCOUNT', 'Descuento', <Percent />, 'sales')}
                {renderButton('COUPON', 'Cupón', <QrCode />, 'sales')}
                {renderButton('loyalty_card', 'Tarjeta', <CreditCard />, 'sales')}
                {renderButton('RETURN', isReturnMode ? 'Venta' : 'Devol.', <RotateCcw />, 'sales', !hasCartItems)}

                {/* GROUP 2: FLUJO (Amber) */}
                {renderButton('PARK_LIST', 'Espera', <Inbox />, 'flow', false, parkedTicketsCount > 0 ? parkedTicketsCount : false)}
                {renderButton('RESERVATION', 'Reserva', <StickyNote />, 'flow')}
                {renderButton('RECOVER_RESERVATION', 'Rec. Res.', <QrCode />, 'flow')}
                {renderButton('SAVE', 'Guardar', <Save />, 'flow')}

                {/* GROUP 3: TERMINAL (Slate) + GROUP 4: CIERRE (Rose) */}
                {renderButton('SETTINGS', 'Ajustes', <Settings />, 'terminal')}
                {renderButton('DRAWER', 'Cajón', <Box />, 'terminal')}
                {renderButton('Z_REPORT', 'Cierre Z', <Lock />, 'closing')}
                {renderButton('LOGOUT', 'Salir', <LogOut />, 'closing')}
            </div>
        </div>
    );
};

export default ModernActionFooter;
