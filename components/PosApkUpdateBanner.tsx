import React from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { PosApkUpdateAvailable } from '../services/version/posApkUpdateService';

interface PosApkUpdateBannerProps {
  update: PosApkUpdateAvailable;
  onDownload: () => void;
  onDismiss: () => void;
}

const PosApkUpdateBanner: React.FC<PosApkUpdateBannerProps> = ({ update, onDownload, onDismiss }) => {
  const currentVersion = update.local.versionName
    ? `${update.local.versionName}${update.local.versionCode ? ` (${update.local.versionCode})` : ''}`
    : update.local.versionCode
      ? `Código ${update.local.versionCode}`
      : 'No disponible';
  const availableVersion = `${update.release.version_name} (${update.release.version_code})`;
  const changelog = update.release.changelog?.trim();
  const canDownload = Boolean(update.release.direct_download_url || update.release.apk_url);
  const sourceHost = (() => {
    try {
      return new URL(update.endpointUrl).host;
    } catch {
      return '';
    }
  })();

  return (
    <aside className="fixed bottom-4 left-4 right-4 z-[10000] mx-auto max-w-[460px] rounded-2xl border border-sky-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.20)] sm:left-auto sm:mx-0">
      <div className="flex items-start gap-3 p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
          <RefreshCw size={22} strokeWidth={2.5} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-900">Nueva versión disponible</h2>
              <p className="mt-1 text-sm font-bold text-slate-600">
                Actual: {currentVersion} · Disponible: {availableVersion}
              </p>
              {sourceHost && (
                <p className="mt-1 text-[11px] font-semibold text-slate-400">Origen: {sourceHost}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Recordar luego"
            >
              <X size={18} />
            </button>
          </div>

          {changelog && (
            <p className="mt-3 max-h-20 overflow-y-auto text-sm leading-snug text-slate-600">
              {changelog}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onDownload}
              disabled={!canDownload}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Download size={16} />
              Descargar APK
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50"
            >
              Recordar luego
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default PosApkUpdateBanner;
