import React, { useState } from 'react';
import { ArrowLeft, Save, Globe, CheckCircle2, AlertCircle, Zap, Activity } from 'lucide-react';
import { BusinessConfig, N8nConfig } from '../types';

interface N8nSettingsProps {
    config: BusinessConfig;
    onUpdateConfig: (newConfig: BusinessConfig) => void;
    onClose: () => void;
}

const N8nSettings: React.FC<N8nSettingsProps> = ({ config, onUpdateConfig, onClose }) => {
    const [webhookUrl, setWebhookUrl] = useState(config.n8nConfig?.webhookUrl || '');
    const [events, setEvents] = useState(config.n8nConfig?.events || { onSale: false, onZReport: false });
    const [isTesting, setIsTesting] = useState(false);
    const [testStatus, setTestStatus] = useState<'IDLE' | 'SUCCESS' | 'ERROR'>('IDLE');

    const handleSave = () => {
        const newConfig: N8nConfig = {
            webhookUrl,
            events
        };
        onUpdateConfig({ ...config, n8nConfig: newConfig });
        onClose();
    };

    const handleTestConnection = async () => {
        if (!webhookUrl) return;
        setIsTesting(true);
        setTestStatus('IDLE');
        try {
            const res = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event: 'TEST_CONNECTION',
                    timestamp: new Date().toISOString(),
                    message: 'Hello from Alfa POS!'
                })
            });
            if (res.ok) {
                setTestStatus('SUCCESS');
            } else {
                setTestStatus('ERROR');
            }
        } catch (e) {
            console.error(e);
            setTestStatus('ERROR');
        } finally {
            setIsTesting(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-4">
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <ArrowLeft size={24} className="text-gray-600" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                            <Globe className="text-pink-600" /> Integración n8n
                        </h1>
                        <p className="text-sm text-gray-500">Automatiza flujos de trabajo con Webhooks</p>
                    </div>
                </div>
                <button
                    onClick={handleSave}
                    className="px-6 py-3 bg-pink-600 hover:bg-pink-700 text-white rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-pink-200 transition-all active:scale-95"
                >
                    <Save size={20} /> Guardar Configuración
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 md:p-10">
                <div className="max-w-3xl mx-auto space-y-8">

                    {/* Webhook URL Section */}
                    <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
                        <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                            <Zap size={20} className="text-yellow-500" /> Endpoint del Webhook
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-gray-500 mb-2 uppercase tracking-wide">URL del Webhook (POST)</label>
                                <input
                                    type="url"
                                    value={webhookUrl}
                                    onChange={(e) => { setWebhookUrl(e.target.value); setTestStatus('IDLE'); }}
                                    placeholder="https://tu-instancia-n8n.com/webhook/..."
                                    className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-xl font-mono text-sm outline-none focus:border-pink-500 focus:bg-white transition-all"
                                />
                                <p className="text-xs text-gray-400 mt-2">
                                    Alfa POS enviará datos en formato JSON a esta URL cuando ocurran los eventos seleccionados.
                                </p>
                            </div>

                            <div className="flex items-center gap-4 pt-2">
                                <button
                                    onClick={handleTestConnection}
                                    disabled={!webhookUrl || isTesting}
                                    className={`px-4 py-2 rounded-lg font-bold text-sm border-2 transition-all ${testStatus === 'SUCCESS' ? 'border-green-500 text-green-600 bg-green-50' : testStatus === 'ERROR' ? 'border-red-500 text-red-600 bg-red-50' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                >
                                    {isTesting ? 'Probando...' : testStatus === 'SUCCESS' ? '¡Conexión Exitosa!' : testStatus === 'ERROR' ? 'Error de Conexión' : 'Probar Conexión'}
                                </button>
                                {testStatus === 'SUCCESS' && <CheckCircle2 size={20} className="text-green-500 animate-in zoom-in" />}
                                {testStatus === 'ERROR' && <AlertCircle size={20} className="text-red-500 animate-in zoom-in" />}
                            </div>
                        </div>
                    </div>

                    {/* Events Section */}
                    <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
                        <h2 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                            <Activity size={20} className="text-blue-500" /> Eventos Disponibles
                        </h2>
                        <div className="space-y-4">
                            <label className="flex items-center justify-between p-4 bg-gray-50 rounded-xl cursor-pointer hover:bg-blue-50 transition-colors border border-transparent hover:border-blue-200 group">
                                <div>
                                    <span className="block font-bold text-gray-800 group-hover:text-blue-700">Nueva Venta (Sale Completed)</span>
                                    <span className="text-xs text-gray-500">Se envía el objeto completo de la transacción.</span>
                                </div>
                                <div className={`w-14 h-8 rounded-full p-1 transition-colors ${events.onSale ? 'bg-blue-600' : 'bg-gray-300'}`} onClick={(e) => { e.preventDefault(); setEvents(prev => ({ ...prev, onSale: !prev.onSale })); }}>
                                    <div className={`w-6 h-6 bg-white rounded-full shadow-sm transition-transform ${events.onSale ? 'translate-x-6' : 'translate-x-0'}`} />
                                </div>
                            </label>

                            <label className="flex items-center justify-between p-4 bg-gray-50 rounded-xl cursor-pointer hover:bg-purple-50 transition-colors border border-transparent hover:border-purple-200 group">
                                <div>
                                    <span className="block font-bold text-gray-800 group-hover:text-purple-700">Cierre de Caja (Z-Report)</span>
                                    <span className="text-xs text-gray-500">Se envía el reporte Z con totales y desglose.</span>
                                </div>
                                <div className={`w-14 h-8 rounded-full p-1 transition-colors ${events.onZReport ? 'bg-purple-600' : 'bg-gray-300'}`} onClick={(e) => { e.preventDefault(); setEvents(prev => ({ ...prev, onZReport: !prev.onZReport })); }}>
                                    <div className={`w-6 h-6 bg-white rounded-full shadow-sm transition-transform ${events.onZReport ? 'translate-x-6' : 'translate-x-0'}`} />
                                </div>
                            </label>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default N8nSettings;
