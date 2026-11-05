import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Search,
  ShieldAlert,
  Terminal,
  X,
} from 'lucide-react';
import {
  PaymentIntegrationAuditAction,
  PaymentIntegrationAuditEvent,
  PaymentIntegrationDefinition,
} from '../types';

interface IntegrationAuditModalProps {
  integration: PaymentIntegrationDefinition;
  onClose: () => void;
}

type StatusFilter = 'ALL' | 'SUCCESS' | 'FAILED';

const ACTION_LABELS: Record<PaymentIntegrationAuditAction, string> = {
  SALE: 'Sale',
  SALE_CANCELLATION: 'SaleCancellation',
  REFUND: 'Refund',
  GET_LAST_TRX: 'GetLastTrx',
  PINPAD_INIT: 'PinpadInit',
  PINPAD_TRANSACTION_TOTALS: 'PinpadTransactionTotals',
  PINPAD_SETTLE: 'PinpadSettle',
  TIP_ADJUST: 'TipAdjust',
};

const IntegrationAuditModal: React.FC<IntegrationAuditModalProps> = ({ integration, onClose }) => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  const allEvents = useMemo(
    () => [...(integration.auditEvents || [])].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [integration.auditEvents]
  );

  const stats = useMemo(() => {
    const successCount = allEvents.filter(event => event.status === 'SUCCESS').length;
    return {
      total: allEvents.length,
      success: successCount,
      failed: allEvents.length - successCount,
    };
  }, [allEvents]);

  const filteredEvents = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return allEvents.filter((event) => {
      if (statusFilter !== 'ALL' && event.status !== statusFilter) return false;
      if (!normalizedSearch) return true;

      const details = [
        event.message,
        event.action,
        event.responseCode,
        event.responseMessage,
        event.authorizationCode,
        event.referenceNumber,
        event.invoiceNumber,
        event.sequenceNumber,
        ...Object.values(event.requestDetails || {}),
        ...Object.values(event.responseDetails || {}),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return details.includes(normalizedSearch);
    });
  }, [allEvents, searchTerm, statusFilter]);

  const renderDetails = (title: string, details?: Record<string, string>) => {
    if (!details || Object.keys(details).length === 0) return null;

    return (
      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
        <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">{title}</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {Object.entries(details).map(([key, value]) => (
            <div key={key} className="rounded-xl bg-white px-3 py-2 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{key}</p>
              <p className="mt-1 break-all text-sm font-semibold text-slate-700">{value}</p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const statusButtonClass = (filter: StatusFilter): string => {
    const active = statusFilter === filter;
    if (filter === 'SUCCESS') {
      return active
        ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
        : 'border-emerald-100 bg-white text-emerald-700 hover:bg-emerald-50';
    }
    if (filter === 'FAILED') {
      return active
        ? 'border-red-200 bg-red-100 text-red-800'
        : 'border-red-100 bg-white text-red-700 hover:bg-red-50';
    }
    return active
      ? 'border-slate-200 bg-slate-900 text-white'
      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50';
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-500">Auditoría por integración</p>
            <h2 className="mt-2 text-2xl font-black text-slate-900">{integration.name}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Eventos del adquirente con resultado exitoso o fallido para soporte y diagnóstico.
            </p>
          </div>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6 overflow-y-auto px-6 py-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-sky-100 bg-sky-50 p-5">
              <p className="text-xs font-black uppercase tracking-widest text-sky-500">Eventos</p>
              <p className="mt-2 text-3xl font-black text-sky-950">{stats.total}</p>
              <p className="mt-1 text-sm text-sky-700">Registrados para esta integración.</p>
            </div>
            <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5">
              <p className="text-xs font-black uppercase tracking-widest text-emerald-500">Exitosos</p>
              <p className="mt-2 text-3xl font-black text-emerald-950">{stats.success}</p>
              <p className="mt-1 text-sm text-emerald-700">Flujos aprobados o respondidos correctamente.</p>
            </div>
            <div className="rounded-3xl border border-red-100 bg-red-50 p-5">
              <p className="text-xs font-black uppercase tracking-widest text-red-500">Fallidos</p>
              <p className="mt-2 text-3xl font-black text-red-950">{stats.failed}</p>
              <p className="mt-1 text-sm text-red-700">Errores de red, autenticación o rechazo.</p>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {(['ALL', 'SUCCESS', 'FAILED'] as const).map(filter => (
                <button
                  key={filter}
                  onClick={() => setStatusFilter(filter)}
                  className={`rounded-2xl border px-4 py-2 text-sm font-bold transition-all ${statusButtonClass(filter)}`}
                >
                  {filter === 'ALL' ? 'Todos' : filter === 'SUCCESS' ? 'Exitosos' : 'Fallidos'}
                </button>
              ))}
            </div>
            <div className="relative w-full lg:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar por AUT, REF, código o mensaje"
                className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm font-medium text-slate-700 outline-none transition-all focus:ring-2 focus:ring-sky-400"
              />
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white px-8 py-16 text-center">
              <ShieldAlert className="mx-auto text-slate-300" size={42} />
              <h3 className="mt-4 text-lg font-black text-slate-700">Todavía no hay eventos para mostrar</h3>
              <p className="mt-2 text-sm text-slate-500">
                Aquí se registrarán eventos como <strong>Sale</strong>, <strong>GetLastTrx</strong>, <strong>PinpadTransactionTotals</strong> o <strong>PinpadSettle</strong>.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredEvents.map((event: PaymentIntegrationAuditEvent) => (
                <div
                  key={event.id}
                  className={`rounded-[2rem] border bg-white p-5 shadow-sm ${
                    event.status === 'SUCCESS'
                      ? 'border-emerald-100'
                      : 'border-red-100'
                  }`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest ${
                          event.status === 'SUCCESS'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {event.status === 'SUCCESS' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                          {event.status === 'SUCCESS' ? 'Exitoso' : 'Fallido'}
                        </span>
                        <span className="rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-sky-700">
                          {ACTION_LABELS[event.action]}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold text-slate-500">
                          {new Date(event.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-3 text-base font-bold text-slate-900">{event.message}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                        {event.responseCode && (
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">Código: {event.responseCode}</span>
                        )}
                        {event.authorizationCode && (
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">AUT: {event.authorizationCode}</span>
                        )}
                        {event.referenceNumber && (
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">REF: {event.referenceNumber}</span>
                        )}
                        {event.invoiceNumber && (
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">INV: {event.invoiceNumber}</span>
                        )}
                        {event.sequenceNumber && (
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">SEQ: {event.sequenceNumber}</span>
                        )}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                      <div className="flex items-center gap-2">
                        <CreditCard size={14} />
                        <span className="font-bold">{event.provider}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Terminal size={14} />
                        <span>{event.terminalId || integration.terminalId || 'Terminal no registrada'}</span>
                      </div>
                    </div>
                  </div>

                  {(event.requestDetails || event.responseDetails) && (
                    <details className="mt-4 rounded-3xl border border-slate-100 bg-slate-50 p-4">
                      <summary className="cursor-pointer list-none text-sm font-black text-slate-700">
                        Ver detalle técnico
                      </summary>
                      <div className="mt-4 space-y-4">
                        {renderDetails('Solicitud', event.requestDetails)}
                        {renderDetails('Respuesta', event.responseDetails)}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default IntegrationAuditModal;
