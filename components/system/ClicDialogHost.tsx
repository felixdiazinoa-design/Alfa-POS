import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, X } from 'lucide-react';
import {
  resolveClicDialog,
  subscribeToClicDialogs,
  type ClicDialogRequest,
  type ClicDialogTone,
  type ClicPromptOptions,
} from '../../services/dialog/ClicDialogService';

const toneStyles: Record<ClicDialogTone, { icon: React.ReactNode; panel: string; button: string }> = {
  info: {
    icon: <Info size={26} />,
    panel: 'bg-blue-50 text-blue-700',
    button: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-300',
  },
  success: {
    icon: <CheckCircle2 size={26} />,
    panel: 'bg-emerald-50 text-emerald-700',
    button: 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-300',
  },
  warning: {
    icon: <AlertTriangle size={26} />,
    panel: 'bg-amber-50 text-amber-700',
    button: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-300',
  },
  danger: {
    icon: <ShieldAlert size={26} />,
    panel: 'bg-red-50 text-red-700',
    button: 'bg-red-600 hover:bg-red-700 focus:ring-red-300',
  },
};

const defaultTitle = (request: ClicDialogRequest, tone: ClicDialogTone): string => {
  if (request.kind === 'confirm') return tone === 'danger' ? 'Confirmar acción crítica' : 'Confirmar acción';
  if (request.kind === 'prompt') return 'Información requerida';
  if (tone === 'success') return 'Operación completada';
  if (tone === 'warning') return 'Atención';
  if (tone === 'danger') return 'No se pudo completar';
  return 'Alfa POS';
};

const ClicDialogHost: React.FC = () => {
  const [request, setRequest] = useState<ClicDialogRequest | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => subscribeToClicDialogs(setRequest), []);

  useEffect(() => {
    if (!request) return;
    const promptOptions = request.options as ClicPromptOptions;
    setValue(request.kind === 'prompt' ? String(promptOptions.initialValue || '') : '');
    window.setTimeout(() => {
      if (request.kind === 'prompt') inputRef.current?.focus();
      else confirmRef.current?.focus();
    }, 0);
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && request.kind !== 'alert') {
        event.preventDefault();
        resolveClicDialog(request.id, request.kind === 'confirm' ? false : null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [request]);

  if (!request || typeof document === 'undefined') return null;

  const tone = request.options.tone || 'info';
  const styles = toneStyles[tone];
  const promptOptions = request.options as ClicPromptOptions;
  const promptInputType = promptOptions.inputType
    || (/\bpin\b|contrase[nñ]a/i.test(request.message) ? 'password'
      : /correo|email/i.test(request.message) ? 'email'
        : /\burl\b|enlace/i.test(request.message) ? 'url' : 'text');
  const promptInvalid = request.kind === 'prompt' && promptOptions.required === true && !value.trim();
  const acceptDialog = () => resolveClicDialog(
    request.id,
    request.kind === 'prompt' ? value : true,
  );
  const cancel = () => resolveClicDialog(request.id, request.kind === 'confirm' ? false : null);

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]" role="presentation">
      <section
        role={request.kind === 'alert' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={`clic-dialog-title-${request.id}`}
        aria-describedby={`clic-dialog-message-${request.id}`}
        className="w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-white/70 bg-white shadow-2xl"
      >
        <div className="flex items-start gap-4 p-6 sm:p-7">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${styles.panel}`}>
            {styles.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h2 id={`clic-dialog-title-${request.id}`} className="text-xl font-black tracking-tight text-slate-900">
                {request.options.title || defaultTitle(request, tone)}
              </h2>
              {request.kind !== 'alert' && (
                <button type="button" onClick={cancel} aria-label="Cerrar" className="-mr-2 -mt-2 rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                  <X size={22} />
                </button>
              )}
            </div>
            <p id={`clic-dialog-message-${request.id}`} className="mt-3 whitespace-pre-wrap break-words text-base leading-7 text-slate-600">
              {request.message}
            </p>
            {request.kind === 'prompt' && (
              <input
                ref={inputRef}
                type={promptInputType}
                autoComplete="off"
                value={value}
                placeholder={promptOptions.placeholder}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !promptInvalid) {
                    event.preventDefault();
                    acceptDialog();
                  }
                }}
                className="mt-5 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
            )}
          </div>
        </div>
        <footer className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50/80 px-6 py-4 sm:flex-row sm:justify-end">
          {request.kind !== 'alert' && (
            <button type="button" onClick={cancel} className="min-h-12 rounded-xl border border-slate-300 bg-white px-6 font-bold text-slate-700 transition hover:bg-slate-100">
              {request.options.cancelLabel || 'Cancelar'}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={acceptDialog}
            disabled={promptInvalid}
            className={`min-h-12 rounded-xl px-7 font-black text-white shadow-lg transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50 ${styles.button}`}
          >
            {request.options.confirmLabel || (request.kind === 'alert' ? 'Entendido' : request.kind === 'prompt' ? 'Continuar' : 'Confirmar')}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
};

export default ClicDialogHost;
