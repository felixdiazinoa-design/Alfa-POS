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
  /** ¿El ERP responde? Si es false el chip se pinta en rojo. */
  erpReachable?: boolean;
  /** Comprobante fiscal por defecto del ticket (p. ej. 'B02'). */
  fiscalLabel?: string | null;
  /** Abre el detalle de envíos al tocar el chip de estado. */
  onOpenSync?: () => void;
}

export default function SupermarketTicketSummary({ symbol, subtotal, discount, tax, total, units, points, pendingSync = 0, erpReachable, fiscalLabel, onOpenSync }: Props) {
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
  // Rojo si el equipo está sin red o si el ERP no responde, aunque haya internet.
  const connected = isOnline && erpReachable !== false;
  const money = (value: number) => symbol + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <section className="supermarket-footer-summary" aria-label="Resumen del ticket">
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {fiscalLabel && (
        <span
          className="ml-auto inline-flex h-6 items-center gap-1 rounded-md bg-[#F5FBEA] px-1.5 text-[9px] font-black uppercase tracking-wide text-[#5B7A18]"
          title="Comprobante fiscal del ticket"
        >
          <span className="text-[10px]">▤</span>
          {fiscalLabel}
        </span>
      )}

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
      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Total a pagar</p>
      <p className="supermarket-payable font-black text-slate-900 tabular-nums mt-1">{money(total)}</p>
      {/* Estado de conexión al pie del recuadro, en la esquina inferior derecha. */}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onOpenSync}
          disabled={!onOpenSync}
          className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide transition-shadow ${
            connected ? 'bg-[#F5FBEA] text-[#4C6B12]' : 'bg-[#FEF6F5] text-[#C0392B]'
          } ${onOpenSync ? 'cursor-pointer hover:ring-1 hover:ring-[#C9D8D7]' : 'cursor-default'}`}
          title={!(connected)
            ? 'Sin conexión con el ERP: las operaciones quedan en cola local'
            : (onOpenSync ? 'Ver envíos pendientes al ERP' : 'Caja conectada al ERP')}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: connected ? '#B8E336' : '#C0392B' }}
          />
          {connected ? 'En línea' : 'Sin conexión'}
        </button>
        <span
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide ${
            pendingSync > 0 ? 'bg-[#FEFAF1] text-[#9A5B00]' : 'bg-[#F4F7F6] text-[#6C7F80]'
          }`}
          title={pendingSync > 0
            ? 'Operaciones de lealtad pendientes de enviar al ERP'
            : 'Sin operaciones en cola'}
        >
          {pendingSync} pendiente{pendingSync === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  </section>;
}
