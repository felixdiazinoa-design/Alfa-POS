import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Printer,
  RefreshCw,
  Terminal,
  X,
} from 'lucide-react';

import { PaymentIntegrationDefinition } from '../types';
import { AzulNormalizedResult } from '../services/payments/AzulMcmService';
import { IngenicoAzulWebApiNormalizedResult } from '../services/payments/IngenicoAzulWebApiService';
import { CardNetEcrNormalizedResult } from '../services/payments/CardNetEcrService';

type TerminalSettlementResult = AzulNormalizedResult | IngenicoAzulWebApiNormalizedResult | CardNetEcrNormalizedResult;

interface AzulSettlementModalProps {
  integration: PaymentIntegrationDefinition;
  mode: 'TOTALS' | 'SETTLE';
  providerLabel?: string;
  isLoadingTotals: boolean;
  isSettling: boolean;
  previewResult: TerminalSettlementResult | null;
  settledResult: TerminalSettlementResult | null;
  errorMessage: string | null;
  printWarning: string | null;
  allowSettleWithoutPreview?: boolean;
  onRefreshTotals: () => void;
  onConfirmSettle: () => void;
  onClose: () => void;
}

const formatReceipt = (value?: string): string => String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

const buildHighlights = (result: TerminalSettlementResult | null, integration: PaymentIntegrationDefinition) => (
  [
    { label: 'Merchant', value: result?.merchantId || integration.merchantId || '' },
    { label: 'Terminal', value: result?.terminalId || integration.terminalId || '' },
    { label: 'Batch', value: result?.batchNumber || result?.responseFields?.BTC || '' },
    { label: 'Código', value: result?.responseCode || '' },
    { label: 'Estado', value: result?.responseMessage || '' },
  ].filter(item => item.value)
);

const AzulSettlementModal: React.FC<AzulSettlementModalProps> = ({
  integration,
  mode,
  providerLabel = 'AZUL',
  isLoadingTotals,
  isSettling,
  previewResult,
  settledResult,
  errorMessage,
  printWarning,
  allowSettleWithoutPreview = false,
  onRefreshTotals,
  onConfirmSettle,
  onClose,
}) => {
  const receipt = formatReceipt(settledResult?.receiptMerchant || previewResult?.receiptMerchant);
  const highlights = buildHighlights(settledResult || previewResult, integration);

  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-500">Operación {providerLabel}</p>
            <h2 className="mt-2 text-2xl font-black text-slate-900">
              {mode === 'TOTALS' ? 'Totales de terminal' : 'Cierre de terminal'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {integration.name} · Terminal {integration.terminalId || 'sin terminal'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6 overflow-y-auto px-6 py-6">
          {(isLoadingTotals || isSettling) && (
            <div className="rounded-[2rem] border border-sky-100 bg-sky-50 px-6 py-5">
              <div className="flex items-center gap-3">
                <RefreshCw className="animate-spin text-sky-600" size={20} />
                <div>
                  <p className="text-sm font-black text-sky-900">
                    {isSettling ? `Cerrando lote en ${providerLabel}...` : 'Consultando totales de la terminal...'}
                  </p>
                  <p className="text-sm text-sky-700">
                    {isSettling
                      ? 'Por favor espere la confirmación del procesador antes de cerrar este modal.'
                      : 'Estamos leyendo el estado actual de la terminal para mostrarlo antes del cierre.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {settledResult?.approved && (
            <div className="rounded-[2rem] border border-emerald-100 bg-emerald-50 px-6 py-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 text-emerald-600" size={22} />
                <div>
                  <p className="text-base font-black text-emerald-950">Cierre completado correctamente</p>
                  <p className="mt-1 text-sm text-emerald-700">
                    {providerLabel} confirmó el cierre del lote y el comprobante se envió a impresión automáticamente.
                  </p>
                </div>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="rounded-[2rem] border border-red-100 bg-red-50 px-6 py-5">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 text-red-600" size={22} />
                <div>
                  <p className="text-base font-black text-red-950">No se pudo completar la operación</p>
                  <p className="mt-1 text-sm text-red-700">{errorMessage}</p>
                </div>
              </div>
            </div>
          )}

          {printWarning && (
            <div className="rounded-[2rem] border border-amber-100 bg-amber-50 px-6 py-5">
              <div className="flex items-start gap-3">
                <Printer className="mt-0.5 text-amber-600" size={22} />
                <div>
                  <p className="text-base font-black text-amber-950">El cierre se aprobó, pero la impresión necesita atención</p>
                  <p className="mt-1 text-sm text-amber-700">{printWarning}</p>
                </div>
              </div>
            </div>
          )}

          {highlights.length > 0 && (
            <div className="grid gap-4 md:grid-cols-3">
              {highlights.map((item) => (
                <div key={item.label} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <p className="text-xs font-black uppercase tracking-widest text-slate-400">{item.label}</p>
                  <p className="mt-2 break-all text-lg font-black text-slate-900">{item.value}</p>
                </div>
              ))}
            </div>
          )}

          {previewResult && !settledResult && (
            <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-3">
                <CreditCard className="text-sky-500" size={18} />
                <h3 className="text-lg font-black text-slate-900">Totales actuales antes del cierre</h3>
                <span className="rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-sky-700">
                  {previewResult.responseMessage || 'Totales consultados'}
                </span>
              </div>
                  {receipt ? (
                <pre className="mt-4 max-h-[32vh] overflow-auto rounded-3xl border border-slate-100 bg-slate-50 p-4 text-xs font-medium leading-6 text-slate-700 whitespace-pre-wrap">
                  {receipt}
                </pre>
              ) : (
                <p className="mt-4 text-sm text-slate-500">
                  {providerLabel} respondió correctamente, pero no devolvió un comprobante legible para mostrar aquí.
                </p>
              )}
            </div>
          )}

          {settledResult && receipt && (
            <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <Terminal className="text-slate-500" size={18} />
                <h3 className="text-lg font-black text-slate-900">Comprobante de cierre</h3>
              </div>
              <pre className="mt-4 max-h-[32vh] overflow-auto rounded-3xl border border-slate-100 bg-slate-50 p-4 text-xs font-medium leading-6 text-slate-700 whitespace-pre-wrap">
                {receipt}
              </pre>
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-5">
          <button
            onClick={onClose}
            className="rounded-2xl px-5 py-3 text-sm font-bold text-slate-500 hover:bg-slate-200"
          >
            {settledResult ? 'Cerrar' : 'Cancelar'}
          </button>
          <button
            onClick={onRefreshTotals}
            disabled={isLoadingTotals || isSettling}
            className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition-all hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={16} className={isLoadingTotals ? 'animate-spin' : ''} />
            Actualizar totales
          </button>
          {mode === 'SETTLE' && !settledResult && (
            <button
              onClick={onConfirmSettle}
              disabled={isLoadingTotals || isSettling || (!allowSettleWithoutPreview && !previewResult)}
              className="flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CheckCircle2 size={16} />
              Cerrar lote ahora
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AzulSettlementModal;
