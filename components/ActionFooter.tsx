import React from 'react';
import {
    Percent, QrCode, Inbox, StickyNote, ArrowRightLeft,
    Lock, LogOut, Settings, Box, Save, CreditCard
} from 'lucide-react';
import { BusinessConfig } from '../types';

interface ActionFooterProps {
    onAction: (action: string) => void;
    config: BusinessConfig;
    parkedTicketsCount: number;
    globalDiscountValue: number;
    isReturnMode: boolean;
    hasCartItems: boolean;
}

const ActionFooter: React.FC<ActionFooterProps> = ({
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
        icon: React.ReactNode,
        group: 'transactional' | 'retention' | 'risk' | 'admin',
        disabled: boolean = false,
        badge?: number | boolean
    ) => {
        let baseColors = "";
        let borderColors = "";
        const textColors = "text-slate-700";

        switch (group) {
            case 'transactional':
                baseColors = globalDiscountValue > 0 && id === 'DISCOUNT' ? "bg-blue-100" : "bg-blue-50";
                borderColors = "border-b-blue-600";
                break;
            case 'retention':
                baseColors = "bg-orange-50";
                borderColors = "border-b-orange-500";
                break;
            case 'risk':
                baseColors = id === 'LOGOUT' ? "bg-red-50" : "bg-purple-50";
                borderColors = id === 'LOGOUT' ? "border-b-red-600" : "border-b-purple-600";
                break;
            case 'admin':
                baseColors = "bg-slate-100";
                borderColors = "border-b-slate-400";
                break;
        }

        return (
            <button
                key={id}
                disabled={disabled}
                onClick={() => onAction(id)}
                className={`
                    flex flex-col items-center justify-center h-16 w-full
                    ${baseColors} border-b-4 ${borderColors}
                    transition-all active:scale-95 active:opacity-80
                    ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:brightness-95'}
                    relative rounded-t-lg
                `}
            >
                <div className={`${disabled ? 'text-slate-400' : ''} mb-1 scale-90 md:scale-100`}>
                    {icon}
                </div>
                <span className={`text-[10px] font-black uppercase tracking-tighter text-center leading-none ${disabled ? 'text-slate-400' : 'text-slate-700'}`}>
                    {label}
                </span>

                {badge && (
                    <span className="absolute top-1 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-orange-600 text-[10px] font-bold text-white border border-white shadow-sm">
                        {typeof badge === 'number' ? badge : ''}
                    </span>
                )}
            </button>
        );
    };

    return (
        <div className="w-full bg-white border-t border-slate-200 p-2 shadow-2xl">
            <div className="grid grid-cols-6 gap-2 max-w-[1600px] mx-auto">
                {/* ROW 1: Transactional (Blue) + Retention (Orange) */}
                {renderButton('DISCOUNT', 'Descuento', <Percent size={18} />, 'transactional')}
                {renderButton('COUPON', 'Cupón', <QrCode size={18} />, 'transactional')}
                {renderButton('loyalty_card', 'Tarjeta', <CreditCard size={18} />, 'transactional')}
                {renderButton('PARK_LIST', 'Espera', <Inbox size={18} />, 'retention', false, parkedTicketsCount > 0 ? parkedTicketsCount : false)}
                {renderButton('RESERVATION', 'Reserva', <StickyNote size={18} />, 'retention')}
                {renderButton('RECOVER_RESERVATION', 'Rec. Res.', <QrCode size={18} />, 'retention')}

                {/* ROW 2: Risk (Red/Purple) + Admin (Gray) */}
                {renderButton('Z_REPORT', 'Cierre Z', <Lock size={18} />, 'risk')}
                {renderButton('LOGOUT', 'Salir', <LogOut size={18} />, 'risk')}
                {renderButton('SETTINGS', 'Ajustes', <Settings size={18} />, 'admin')}
                {renderButton('DRAWER', 'Cajón', <Box size={18} />, 'admin')}
                {renderButton('SAVE', 'Guardar', <Save size={18} />, 'admin')}
                {renderButton('RETURN', isReturnMode ? 'Venta' : 'Devol.', <ArrowRightLeft size={18} />, 'admin', !hasCartItems)}
            </div>
        </div>
    );
};

export default ActionFooter;
