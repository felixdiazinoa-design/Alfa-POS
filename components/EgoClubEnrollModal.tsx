import React, { useMemo, useState } from 'react';
import { AlertCircle, BadgeCheck, Check, Loader2, ShieldCheck, X } from 'lucide-react';
import type { BusinessConfig } from '../types';
import { getStoredErpSyncBinding } from '../utils/erpSyncLifecycle';
import { isEgoClubEnabled } from '../utils/egoClub';
import {
    EGO_CLUB_MARKETING_BODY,
    EGO_CLUB_MARKETING_CHANNELS,
    EGO_CLUB_MARKETING_TITLE,
    EGO_CLUB_PRIVACY,
    EGO_CLUB_TERMS,
} from '../constants/egoClubLegal';
import {
    calculateAge,
    enqueueEnrollment,
    normalizeCedula,
    normalizePhone,
    validateEnrollInput,
    type LoyaltyConsent,
    type LoyaltyEnrollInput,
    type LoyaltyMarketingChannel,
} from '../services/loyalty/LoyaltyService';

interface EgoClubEnrollModalProps {
    config: BusinessConfig;
    onClose: () => void;
    /** Se invoca cuando el alta quedó registrada (en cola o enviada). */
    onEnrolled?: (result: { queued: boolean; name: string }) => void;
}

type FormState = {
    nombre: string;
    cedula: string;
    celular: string;
    email: string;
    birthDate: string;
    registrationStoreId: string;
};

/**
 * Alta de socio EGO Club desde caja.
 *
 * Los seis campos son obligatorios y los tres consentimientos arrancan **desmarcados**.
 * El alta se encola siempre: si hay red se envía de inmediato y si no, queda pendiente
 * en la cola local (que sobrevive al cierre de la app) y se reintenta al reconectar.
 */
const EgoClubEnrollModal: React.FC<EgoClubEnrollModalProps> = ({ config, onClose, onEnrolled }) => {
    const programEnabled = isEgoClubEnabled(config);
    const storeId = useMemo(() => getStoredErpSyncBinding().storeId || '', []);

    const [form, setForm] = useState<FormState>({
        nombre: '',
        cedula: '',
        celular: '',
        email: '',
        birthDate: '',
        registrationStoreId: storeId,
    });

    // Todos los consentimientos arrancan en false por diseño.
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
    const [marketingChannels, setMarketingChannels] = useState<LoyaltyMarketingChannel[]>([]);
    const [submitted, setSubmitted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [queued, setQueued] = useState<boolean | null>(null);

    const age = calculateAge(form.birthDate);

    const buildInput = (): LoyaltyEnrollInput => {
        const consents: LoyaltyConsent[] = [
            { type: 'TERMS', granted: acceptedTerms },
            { type: 'PRIVACY', granted: acceptedPrivacy },
            ...marketingChannels.map(channel => ({ type: channel, granted: true })),
        ];
        return {
            nombre: form.nombre,
            cedula: form.cedula,
            celular: form.celular,
            email: form.email,
            birthDate: form.birthDate,
            registrationStoreId: form.registrationStoreId,
            consents,
        };
    };

    const validation = validateEnrollInput(buildInput());
    const showError = (field: keyof typeof validation.errors) => submitted && validation.errors[field];

    const handleSubmit = async () => {
        setSubmitted(true);
        if (!programEnabled || !validation.valid) return;

        setSaving(true);
        try {
            await enqueueEnrollment(buildInput());
            const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
            setQueued(!online);
            onEnrolled?.({ queued: !online, name: form.nombre.trim() });
            if (online) {
                // El alta ya está en la cola; se avisa igual aunque el endpoint del ERP
                // todavía no exista, porque el estado real lo refleja el listado.
                setTimeout(() => onClose(), 900);
            }
        } finally {
            setSaving(false);
        }
    };

    const field = (
        label: string,
        key: keyof FormState,
        options: { type?: string; placeholder?: string; maxLength?: number; hint?: string } = {},
    ) => (
        <label className="block">
            <span className="text-[11px] font-black uppercase tracking-wide text-gray-500">{label}</span>
            <input
                type={options.type || 'text'}
                value={form[key]}
                placeholder={options.placeholder}
                maxLength={options.maxLength}
                disabled={!programEnabled}
                onChange={(event) => setForm(prev => ({ ...prev, [key]: event.target.value }))}
                className={`mt-1 w-full rounded-xl border-2 px-3 py-2 text-sm font-bold text-gray-800 outline-none transition-colors disabled:bg-gray-100 ${
                    showError(key as keyof typeof validation.errors) ? 'border-red-300 bg-red-50' : 'border-gray-200 focus:border-blue-400'
                }`}
            />
            {options.hint && <span className="text-[10px] text-gray-400">{options.hint}</span>}
            {showError(key as keyof typeof validation.errors) && (
                <span className="text-[11px] font-bold text-red-600">{validation.errors[key as keyof typeof validation.errors]}</span>
            )}
        </label>
    );

    const consentRow = (
        label: string,
        description: string,
        checked: boolean,
        onChange: (value: boolean) => void,
    ) => (
        <button
            type="button"
            disabled={!programEnabled}
            onClick={() => onChange(!checked)}
            className={`w-full text-left p-3 rounded-xl border-2 transition-all flex items-start gap-3 disabled:opacity-60 ${
                checked ? 'bg-emerald-50 border-emerald-400' : 'bg-white border-gray-200 hover:border-gray-300'
            }`}
        >
            <span className={`mt-0.5 w-5 h-5 shrink-0 rounded flex items-center justify-center border ${
                checked ? 'bg-emerald-600 border-emerald-600' : 'bg-white border-gray-300'
            }`}>
                {checked && <Check size={14} className="text-white" />}
            </span>
            <span className="min-w-0">
                <span className={`block text-sm font-bold ${checked ? 'text-emerald-800' : 'text-gray-700'}`}>{label}</span>
                <span className="block text-[11px] text-gray-500 leading-snug">{description}</span>
            </span>
        </button>
    );

    return (
        <div className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
                <header className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
                            <BadgeCheck className="text-blue-600" size={20} /> Alta de socio EGO Club
                        </h2>
                        <p className="text-xs text-gray-500">Los datos se envían al ERP; el POS no crea socios por su cuenta.</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full text-gray-400 hover:bg-gray-100">
                        <X size={18} />
                    </button>
                </header>

                <div className="px-6 py-5 overflow-y-auto space-y-4">
                    {!programEnabled && (
                        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <p className="text-xs font-bold">
                                El programa EGO Club está apagado en esta sucursal. No se puede dar de alta socios.
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {field('Nombre y apellido', 'nombre', { placeholder: 'Ana Pérez' })}
                        {field('Cédula', 'cedula', {
                            placeholder: '00112345678',
                            maxLength: 11,
                            hint: `${normalizeCedula(form.cedula).length}/11 dígitos`,
                        })}
                        {field('Celular', 'celular', { placeholder: '8095550101', hint: normalizePhone(form.celular) || undefined })}
                        {field('Correo electrónico', 'email', { type: 'email', placeholder: 'ana@correo.com' })}
                        {field('Fecha de nacimiento', 'birthDate', {
                            type: 'date',
                            hint: age !== null ? `${age} años` : undefined,
                        })}
                        <label className="block">
                            <span className="text-[11px] font-black uppercase tracking-wide text-gray-500">Tienda de registro</span>
                            <input
                                value={form.registrationStoreId}
                                disabled={!programEnabled}
                                onChange={(event) => setForm(prev => ({ ...prev, registrationStoreId: event.target.value }))}
                                className={`mt-1 w-full rounded-xl border-2 px-3 py-2 text-sm font-bold text-gray-800 outline-none disabled:bg-gray-100 ${
                                    showError('registrationStoreId') ? 'border-red-300 bg-red-50' : 'border-gray-200 focus:border-blue-400'
                                }`}
                            />
                            {showError('registrationStoreId') && (
                                <span className="text-[11px] font-bold text-red-600">{validation.errors.registrationStoreId}</span>
                            )}
                            <span className="text-[10px] text-gray-400">Tomada del vínculo de la terminal con el ERP</span>
                        </label>
                    </div>

                    <div className="pt-2 border-t border-gray-100 space-y-2">
                        <p className="text-[11px] font-black uppercase tracking-wide text-gray-400 flex items-center gap-1">
                            <ShieldCheck size={14} /> Consentimientos
                        </p>

                        {consentRow(
                            EGO_CLUB_TERMS.title,
                            EGO_CLUB_TERMS.body[0],
                            acceptedTerms,
                            setAcceptedTerms,
                        )}
                        {consentRow(
                            EGO_CLUB_PRIVACY.title,
                            EGO_CLUB_PRIVACY.body[0],
                            acceptedPrivacy,
                            setAcceptedPrivacy,
                        )}

                        <div className="p-3 rounded-xl border-2 border-gray-200 bg-white">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-bold text-gray-700">{EGO_CLUB_MARKETING_TITLE}</span>
                                <span className="text-[10px] font-bold text-gray-400 uppercase">Opcional</span>
                            </div>
                            <p className="text-[11px] text-gray-500 leading-snug mb-2">{EGO_CLUB_MARKETING_BODY}</p>
                            <div className="flex flex-wrap gap-2">
                                {EGO_CLUB_MARKETING_CHANNELS.map(channel => {
                                    const selected = marketingChannels.includes(channel.type);
                                    return (
                                        <button
                                            key={channel.type}
                                            type="button"
                                            disabled={!programEnabled}
                                            onClick={() => setMarketingChannels(prev => (
                                                selected ? prev.filter(c => c !== channel.type) : [...prev, channel.type]
                                            ))}
                                            className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase border transition-colors ${
                                                selected
                                                    ? 'bg-blue-600 border-blue-600 text-white'
                                                    : 'bg-white border-gray-300 text-gray-500'
                                            }`}
                                        >
                                            {channel.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {showError('consents') && (
                            <p className="text-[11px] font-bold text-red-600">{validation.errors.consents}</p>
                        )}
                    </div>

                    {queued === false && (
                        <p className="text-[11px] font-bold text-emerald-700">
                            Alta registrada. Se envía al ERP por el canal de sincronización.
                        </p>
                    )}
                    {queued === true && (
                        <p className="text-[11px] font-bold text-amber-700">
                            Sin conexión: el alta quedó en cola y se enviará automáticamente al reconectar.
                        </p>
                    )}
                </div>

                <footer className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100">
                        Cancelar
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!programEnabled || saving}
                        className="px-5 py-2 rounded-xl text-sm font-black text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 flex items-center gap-2"
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <BadgeCheck size={16} />}
                        Dar de alta
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default EgoClubEnrollModal;
