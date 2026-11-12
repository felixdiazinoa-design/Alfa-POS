import React, { useState, useEffect } from 'react';
import { Mail, Save, RefreshCw, CheckCircle2, AlertTriangle, Lock, Key, ArrowLeft } from 'lucide-react';
import { EmailConfig } from '../types';
import { isNativeAndroidRuntime } from '../utils/erpBaseUrl';

interface EmailSettingsProps {
   onSave: (config: EmailConfig) => void;
   onBack: () => void;
}

const EmailSettings: React.FC<EmailSettingsProps> = ({ onSave, onBack }) => {
   const managedByErp = isNativeAndroidRuntime();
   const [config, setConfig] = useState<EmailConfig>({
      provider: 'resend',
      apiKey: '',
      from: 'Alfa POS <no-reply@clicsuite.com>'
   });

   const [isTesting, setIsTesting] = useState(false);
   const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

   useEffect(() => {
      if (managedByErp) return;
      // Load config from backend
      fetch('/smtp/config')
         .then(async res => {
            const contentType = res.headers.get('content-type') || '';
            if (!res.ok || !contentType.includes('application/json')) return null;
            return res.json();
         })
         .then(data => {
            if (data?.apiKey) setConfig(data);
         })
         .catch(err => console.error('Error loading email config:', err));
   }, [managedByErp]);

   const handleChange = (field: keyof EmailConfig, value: string) => {
      setConfig(prev => ({ ...prev, [field]: value }));
   };

   const handleSave = async () => {
      if (managedByErp) {
         setTestResult({ success: false, message: 'La clave de Resend se configura de forma segura en el ERP.' });
         return;
      }
      onSave(config);

      try {
         const res = await fetch('/smtp/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
         });
         const contentType = res.headers.get('content-type') || '';
         if (contentType.includes('application/json')) {
            await res.json().catch(() => null);
         }
         if (!res.ok) {
            console.warn('Email backend config endpoint unavailable:', res.status);
         }
         alert('Configuración guardada');
      } catch (err: any) {
         console.warn('Email backend config save skipped:', err);
         alert('Configuración guardada localmente');
      }
   };

   const handleTest = async () => {
      if (managedByErp) {
         setTestResult({ success: false, message: 'La conexión de correo debe probarse desde el ERP.' });
         return;
      }
      setIsTesting(true);
      setTestResult(null);

      try {
         const res = await fetch('/smtp/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
         });
         const contentType = res.headers.get('content-type') || '';
         const data = contentType.includes('application/json') ? await res.json() : null;
         console.log('Email test response:', data);

         if (data?.success) {
            setTestResult({ success: true, message: 'Conexión exitosa. Email de prueba enviado.' });
         } else if (res.ok && !data) {
            setTestResult({ success: true, message: 'Endpoint alcanzable. No devolvió JSON de prueba, pero respondió correctamente.' });
         } else {
            setTestResult({ success: false, message: 'Error: ' + (data?.message || `Endpoint no disponible (${res.status})`) });
         }
      } catch (error: any) {
         setTestResult({ success: false, message: 'Error de red: ' + (error.message || String(error)) });
      } finally {
         setIsTesting(false);
      }
   };

   return (
      <div className="h-full flex flex-col bg-gray-50 animate-in fade-in duration-300">
         {/* Header */}
         <div className="bg-white border-b border-gray-200 p-6 flex justify-between items-center">
            <div className="flex items-center gap-4">
               <button
                  onClick={onBack}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
               >
                  <ArrowLeft size={24} className="text-gray-600" />
               </button>
               <div>
                  <h2 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                     <Mail className="text-blue-600" /> Configuración de Email (Resend)
                  </h2>
                  <p className="text-sm text-gray-500">Usa Resend.com para enviar correos de forma fiable y sencilla.</p>
               </div>
            </div>
         </div>

         {/* Content */}
         <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-6">

            {managedByErp && (
               <div className="bg-amber-50 p-5 rounded-2xl border border-amber-200 flex items-start gap-3 text-amber-900">
                  <Lock className="mt-0.5 shrink-0" size={20} />
                  <div>
                     <p className="font-bold">Configuración protegida por el ERP</p>
                     <p className="text-sm mt-1">Por seguridad, el APK no almacena claves de Resend. Configura <code>RESEND_API_KEY</code> y el remitente en el ERP; el POS usa la autorización de esta terminal para solicitar el envío.</p>
                  </div>
               </div>
            )}

            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6">
               <h3 className="font-bold text-gray-800 text-lg border-b border-gray-100 pb-2">Credenciales de Resend</h3>

               <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-2">
                     <Key size={14} /> API Key
                  </label>
                  <div className="relative">
                     <input
                        type="password"
                        value={config.apiKey}
                        onChange={(e) => handleChange('apiKey', e.target.value)}
                        disabled={managedByErp}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder={managedByErp ? 'Administrada por el ERP' : 're_123456789...'}
                     />
                     <Lock size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">Obtén tu API Key en <a href="https://resend.com/api-keys" target="_blank" className="text-blue-500 underline">resend.com</a></p>
               </div>

               <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Remitente (From)</label>
                  <input
                     type="text"
                     value={config.from}
                     onChange={(e) => handleChange('from', e.target.value)}
                     disabled={managedByErp}
                     className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500"
                     placeholder="Alfa POS <no-reply@tudominio.com>"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Usa un remitente de un dominio verificado en Resend.</p>
               </div>

               <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Email Destinatario por Defecto</label>
                  <input
                     type="email"
                     value={config.defaultRecipient || ''}
                     onChange={(e) => handleChange('defaultRecipient', e.target.value)}
                     disabled={managedByErp}
                     className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500"
                     placeholder="admin@tuempresa.com"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Este correo recibirá los Reportes Z si no se especifica uno por terminal.</p>
               </div>
            </div>

            {/* Actions */}
            <div className="mt-8 flex items-center justify-end gap-4">
               {testResult && (
                  <div className={`flex items-center gap-2 text-sm font-bold px-4 py-2 rounded-lg animate-in fade-in ${testResult.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                     {testResult.success ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                     {testResult.message}
                  </div>
               )}

               <button
                  onClick={handleTest}
                  disabled={managedByErp || isTesting || !config.apiKey}
                  className="px-6 py-3 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold hover:bg-gray-50 transition-all flex items-center gap-2 disabled:opacity-50"
               >
                  {isTesting ? <RefreshCw size={20} className="animate-spin" /> : <RefreshCw size={20} />}
                  Probar Conexión
               </button>

               <button
                  onClick={handleSave}
                  disabled={managedByErp}
                  className="px-8 py-3 bg-gray-900 text-white rounded-xl font-bold shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 disabled:hover:scale-100"
               >
                  <Save size={20} />
                  Guardar Configuración
               </button>
            </div>

         </div>
      </div>
   );
};

export default EmailSettings;
