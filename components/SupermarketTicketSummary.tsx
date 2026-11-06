import React, { useEffect, useState } from 'react';

interface Props {
  symbol: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  units: number;
  points: number;
  /** Envíos pendientes de sincronizar (cola de documentos/reportes). */
  pendingSync?: number;
}

export default function SupermarketTicketSummary({ symbol, subtotal, discount, tax, total, units, points, pendingSync = 0 }: Props) {
  // Estado de conexión real del WebView: verde en línea, ámbar/rojo sin red.
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  const money = (value: number) => symbol + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <section className="supermarket-footer-summary" aria-label="Resumen del ticket">
    <div className="flex flex-wrap gap-2 mb-3">
      <div className="rounded-lg bg-blue-100 px-3 py-2 text-blue-900">
        <span className="text-base font-black tabular-nums">{units}</span>
        <span className="ml-1.5 text-[11px] font-bold">{units === 1 ? 'unidad' : 'unidades'}</span>
      </div>
      {points > 0 && <div className="rounded-lg bg-purple-100 px-3 py-1.5 text-purple-800 text-[11px] font-bold">Ganarás <strong className="text-sm tabular-nums">{points}</strong> puntos</div>}
    </div>
    {/* Los importes se solapaban en la caja porque las columnas podían
        encogerse. Se fija con estilos en línea: ninguna clase los sobrescribe. */}
    <dl
      className="text-[11px] text-slate-500"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: '2rem', rowGap: '0.25rem' }}
    >
      <div style={{ flex: '0 0 auto', minWidth: '7.5rem' }}>
        <dt>Subtotal</dt>
        <dd
          className="text-[13px] font-bold tabular-nums text-slate-700"
          style={{ whiteSpace: 'nowrap', marginLeft: 0 }}
        >
          {money(subtotal)}
        </dd>
      </div>
      {discount > 0 && (
        <div style={{ flex: '0 0 auto', minWidth: '7.5rem' }} className="text-red-600">
          <dt>Descuento</dt>
          <dd className="text-[13px] font-bold tabular-nums" style={{ whiteSpace: 'nowrap', marginLeft: 0 }}>
            -{money(discount)}
          </dd>
        </div>
      )}
      <div style={{ flex: '0 0 auto', minWidth: '7.5rem' }}>
        <dt>Impuestos</dt>
        <dd
          className="text-[13px] font-bold tabular-nums text-slate-700"
          style={{ whiteSpace: 'nowrap', marginLeft: 0 }}
        >
          {money(tax)}
        </dd>
      </div>
    </dl>
    <div className="border-t border-slate-200 mt-3 pt-3">
      {/* 'TOTAL A PAGAR' a la izquierda y el estado de conexión en la esquina
          inferior derecha, en la misma fila. */}
      <div className="flex items-end justify-between gap-3">
        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Total a pagar</p>
        <div className="flex flex-col items-end gap-1 pb-0.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide ${
              isOnline ? 'bg-[#F5FBEA] text-[#4C6B12]' : 'bg-[#FEF6F5] text-[#C0392B]'
            }`}
            title={isOnline ? 'La caja está conectada al ERP' : 'Sin conexión: el ticket se guarda localmente'}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: isOnline ? '#B8E336' : '#C0392B' }}
            />
            {isOnline ? 'En línea' : 'Sin conexión'}
          </span>
          {pendingSync > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-[#FEFAF1] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#9A5B00]"
              title="Documentos pendientes de enviar al ERP"
            >
              {pendingSync} pendiente{pendingSync === 1 ? '' : 's'} de envío
            </span>
          )}
        </div>
      </div>
      <p className="supermarket-payable font-black text-slate-900 tabular-nums mt-1">{money(total)}</p>
    </div>
  </section>;
}
