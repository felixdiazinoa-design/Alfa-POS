import React from 'react';

interface Props {
  symbol: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  units: number;
  points: number;
}

export default function SupermarketTicketSummary({ symbol, subtotal, discount, tax, total, units, points }: Props) {
  const money = (value: number) => symbol + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <section className="supermarket-footer-summary" aria-label="Resumen del ticket">
    <div className="flex flex-wrap gap-2 mb-3">
      <div className="rounded-lg bg-blue-100 px-3 py-2 text-blue-900">
        <span className="text-base font-black tabular-nums">{units}</span>
        <span className="ml-1.5 text-[11px] font-bold">{units === 1 ? 'unidad' : 'unidades'}</span>
      </div>
      {points > 0 && <div className="rounded-lg bg-purple-100 px-3 py-1.5 text-purple-800 text-[11px] font-bold">Ganarás <strong className="text-sm tabular-nums">{points}</strong> puntos</div>}
    </div>
    {/* Los importes iban pegados porque cada columna podía encogerse hasta
        solaparse. Ahora no se encogen y el espacio entre columnas es explícito. */}
    <dl className="flex flex-wrap items-start gap-x-8 gap-y-1 text-[11px] text-slate-500">
      <div className="shrink-0">
        <dt>Subtotal</dt>
        <dd className="whitespace-nowrap text-[13px] font-bold tabular-nums text-slate-700">{money(subtotal)}</dd>
      </div>
      {discount > 0 && (
        <div className="shrink-0 text-red-600">
          <dt>Descuento</dt>
          <dd className="whitespace-nowrap text-[13px] font-bold tabular-nums">-{money(discount)}</dd>
        </div>
      )}
      <div className="shrink-0">
        <dt>Impuestos</dt>
        <dd className="whitespace-nowrap text-[13px] font-bold tabular-nums text-slate-700">{money(tax)}</dd>
      </div>
    </dl>
    <div className="border-t border-slate-200 mt-3 pt-3">
      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Total a pagar</p>
      <p className="supermarket-payable font-black text-slate-900 tabular-nums mt-1">{money(total)}</p>
    </div>
  </section>;
}
