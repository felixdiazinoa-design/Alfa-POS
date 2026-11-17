import React from 'react';
import { Building2, ShoppingBag, Truck } from 'lucide-react';
import { OrderServiceType } from '../types';

/**
 * Tipo de servicio del ticket (En local / Para llevar / Delivery).
 *
 * Comparte la anatomía del resto de controles de la cabecera del ticket:
 * 48 px de alto, radio 16 px, borde neutro-violeta y una "tile" de 32 px con el
 * icono. Antes era una tarjeta violeta rellena y en columna, y rompía la simetría
 * con los chips de Cliente/Vendedor y con los botones cuadrados de carrito/acciones.
 */
export default function OrderServiceTypeButton({ value, onClick }: { value: OrderServiceType; onClick: () => void }) {
   const label = value === 'DINE_IN' ? 'En local' : value === 'TAKEOUT' ? 'Para llevar' : 'Delivery';
   const Icon = value === 'DINE_IN' ? Building2 : value === 'TAKEOUT' ? ShoppingBag : Truck;
   return (
      <button
         type="button"
         data-testid="ticket-service-type-button"
         aria-label={`Tipo de servicio: ${label}`}
         aria-haspopup="dialog"
         title={`Tipo de servicio: ${label}`}
         onClick={onClick}
         className="group inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl border border-violet-200 bg-white pl-2 pr-3 transition-all hover:border-violet-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
      >
         <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-violet-100 bg-violet-50 text-violet-600 transition-colors group-hover:bg-violet-100">
            <Icon size={16} strokeWidth={2.3} aria-hidden="true" />
         </span>
         <span className="text-left">
            <span className="block text-[8.5px] font-black uppercase leading-none tracking-[0.16em] text-[#9DAEAD]">Servicio</span>
            <span className="mt-1 block text-[10.5px] font-black uppercase leading-none tracking-[0.02em] text-violet-700">{label}</span>
         </span>
      </button>
   );
}
