import React, { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { resolveTenantRecord } from '../utils/licenseGuard';
import {
    clearPersistedActivationIdentity,
    resolveActivationTenantIdentity,
} from '../services/setup/activationTenantIdentity';
import {
    Rocket,
    Lock,
    Mail,
    CheckCircle,
    AlertCircle,
    ShieldCheck,
    ArrowRight,
    Loader2,
    Building2,
    X,
} from 'lucide-react';

interface ActivationScreenProps {
    onActivationComplete: (tenantData: any) => void;
}

type ActivationStep = 'LOGIN' | 'CHANGE_PASSWORD' | 'SUCCESS';
type TenantType = 'full' | 'pos_only';

type DistributorOption = {
    id: string;
    name: string;
};

type ProvisionFormState = {
    name: string;
    email: string;
    taxId: string;
    contactName: string;
    contactEmail: string;
    city: string;
    capturedByDistributorId: string;
    servicedByDistributorId: string;
    type: TenantType;
    cloudSync: boolean;
};

type ProvisionResponse = {
    tenantId: string;
    slug: string;
    email: string;
    tempPassword: string;
};

const INITIAL_PROVISION_FORM: ProvisionFormState = {
    name: '',
    email: '',
    taxId: '',
    contactName: '',
    contactEmail: '',
    city: '',
    capturedByDistributorId: '',
    servicedByDistributorId: '',
    type: 'full',
    cloudSync: true,
};

const getErrorMessage = (error: unknown): string => {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;

    if (
        typeof error === 'object'
        && error !== null
        && 'message' in error
        && typeof (error as { message?: string }).message === 'string'
    ) {
        return (error as { message: string }).message;
    }

    return 'Error desconocido';
};

const getActivationApiBase = (): string => {
    const env = (import.meta as any).env || {};
    const explicitBase = String(env.VITE_ACTIVATION_API_BASE_URL || '').trim().replace(/\/$/, '');
    if (explicitBase) return explicitBase;

    const cloudAdminUrl = String(env.VITE_CLOUD_ADMIN_URL || '').trim().replace(/\/$/, '');
    if (cloudAdminUrl) return `${cloudAdminUrl}/api/activation`;

    return '/api/activation';
};

const getCloudAdminUrl = (): string => {
    const env = (import.meta as any).env || {};
    return String(env.VITE_CLOUD_ADMIN_URL || '').trim().replace(/\/$/, '');
};

const getSupabasePublicConfig = () => {
    const env = (import.meta as any).env || {};
    const url = String(env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
    const anonKey = String(env.VITE_SUPABASE_ANON_KEY || '').trim();

    return {
        url,
        anonKey,
        isConfigured: Boolean(url && anonKey),
    };
};

const looksLikeFetchFailure = (error: unknown): boolean => {
    const message = getErrorMessage(error).toLowerCase();
    return (
        message.includes('failed to fetch')
        || message.includes('networkerror')
        || message.includes('load failed')
        || message.includes('network request failed')
    );
};

const normalizeActivationErrorMessage = (error: unknown): string => {
    const message = getErrorMessage(error);
    if (looksLikeFetchFailure(error)) {
        return 'No se pudo conectar con Clic Cloud. Verifique su internet e intente nuevamente.';
    }

    return message;
};

const requiresPasswordChange = (user: any): boolean => {
    const metadata = user?.user_metadata || {};
    return metadata.is_new_user === true
        || metadata.must_change_password === true
        || metadata.force_password_change === true
        || metadata.password_change_required === true
        || metadata.temporary_password === true;
};

const ActivationScreen: React.FC<ActivationScreenProps> = ({ onActivationComplete }) => {
    const [step, setStep] = useState<ActivationStep>('LOGIN');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false);
    const [isProvisionSubmitting, setIsProvisionSubmitting] = useState(false);
    const [provisionError, setProvisionError] = useState<string | null>(null);
    const [distributorsLoading, setDistributorsLoading] = useState(false);
    const [distributors, setDistributors] = useState<DistributorOption[]>([]);
    const [provisionFormData, setProvisionFormData] = useState<ProvisionFormState>(INITIAL_PROVISION_FORM);
    const [provisionedCredentials, setProvisionedCredentials] = useState<{
        email: string;
        tempPassword: string;
    } | null>(null);
    const activationApiBase = getActivationApiBase();
    const cloudAdminUrl = getCloudAdminUrl();
    const { url: supabaseUrl, anonKey: supabaseAnonKey, isConfigured: hasSupabaseConfig } = getSupabasePublicConfig();
    const canProvisionInline = Boolean(String(((import.meta as any).env || {}).VITE_ACTIVATION_API_BASE_URL || '').trim());

    useEffect(() => {
        if (!isProvisionModalOpen) return;

        const abortController = new AbortController();
        setDistributorsLoading(true);

        void fetch(`${activationApiBase}/distributors`, {
            signal: abortController.signal,
        })
            .then(async (response) => {
                if (!response.ok) {
                    const payload = await response.json().catch(() => ({}));
                    throw new Error(payload.error || 'No se pudieron cargar los distribuidores.');
                }
                return response.json();
            })
            .then((payload) => {
                setDistributors(Array.isArray(payload) ? payload : []);
            })
            .catch((fetchError: unknown) => {
                if ((fetchError as { name?: string }).name === 'AbortError') return;
                console.warn('No se pudieron cargar distribuidores para aprovisionamiento:', fetchError);
                setDistributors([]);
            })
            .finally(() => {
                setDistributorsLoading(false);
            });

        return () => abortController.abort();
    }, [activationApiBase, isProvisionModalOpen]);

    const updateProvisionField = <K extends keyof ProvisionFormState>(field: K, value: ProvisionFormState[K]) => {
        setProvisionFormData((previous) => ({
            ...previous,
            [field]: value,
        }));
    };

    const openProvisionModal = () => {
        if (!canProvisionInline) {
            if (cloudAdminUrl) {
                window.open(cloudAdminUrl, '_blank', 'noopener,noreferrer');
                return;
            }
            setError('No hay una URL de Cloud Admin configurada para crear empresas desde esta pantalla.');
            return;
        }

        setProvisionError(null);
        setIsProvisionModalOpen(true);
    };

    const closeProvisionModal = () => {
        if (isProvisionSubmitting) return;
        setIsProvisionModalOpen(false);
    };

    const handleProvisionTenant = async (event: React.FormEvent) => {
        event.preventDefault();
        setProvisionError(null);
        setIsProvisionSubmitting(true);

        try {
            const response = await fetch(`${activationApiBase}/provision-tenant`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(provisionFormData),
            });

            const payload = await response.json().catch(() => ({})) as {
                error?: string;
                message?: string;
                tenantId?: string;
                slug?: string;
                email?: string;
                tempPassword?: string;
            };

            if (!response.ok) {
                throw new Error(payload.error || payload.message || 'No se pudo aprovisionar el tenant.');
            }

            const result = payload as ProvisionResponse;
            if (!result.email || !result.tempPassword || !result.tenantId) {
                throw new Error('Respuesta inválida del aprovisionamiento.');
            }

            setProvisionedCredentials({
                email: result.email,
                tempPassword: result.tempPassword,
            });
            setEmail(result.email);
            setPassword(result.tempPassword);
            setProvisionFormData(INITIAL_PROVISION_FORM);
            setIsProvisionModalOpen(false);
            setError(null);
        } catch (submitError) {
            setProvisionError(normalizeActivationErrorMessage(submitError));
        } finally {
            setIsProvisionSubmitting(false);
        }
    };

    const signInWithDirectSupabase = async () => {
        if (!hasSupabaseConfig) {
            throw new Error('Este APK no incluye credenciales Supabase. Use "Elegir tipo de POS" para seleccionar POS_ONLY, POS + ERP o POS Cliente.');
        }

        const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify({
                email,
                password,
            }),
        });

        const payload = await response.json().catch(() => ({})) as {
            access_token?: string;
            refresh_token?: string;
            error?: string;
            msg?: string;
            error_description?: string;
            user?: any;
        };

        if (!response.ok) {
            throw new Error(payload.msg || payload.error_description || payload.error || 'No se pudo iniciar sesión en Clic Cloud.');
        }

        if (!payload.access_token || !payload.refresh_token) {
            throw new Error('Respuesta inválida de autenticación de Clic Cloud.');
        }

        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
            access_token: payload.access_token,
            refresh_token: payload.refresh_token,
        });

        if (sessionError) throw sessionError;
        if (!sessionData.user) {
            throw new Error('La sesión fue creada pero no se pudo recuperar el usuario.');
        }

        return {
            user: sessionData.user,
            session: sessionData.session,
        };
    };

    const handleInitialLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!hasSupabaseConfig) {
            continueToTerminalModeSelection();
            return;
        }
        setLoading(true);
        setError(null);

        try {
            let signInResult = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (signInResult.error && looksLikeFetchFailure(signInResult.error)) {
                console.warn('[Activation] Supabase client sign-in failed, trying direct REST fallback:', signInResult.error);
                signInResult = { data: await signInWithDirectSupabase(), error: null } as typeof signInResult;
            }

            const { data, error: authError } = signInResult;

            if (authError) throw authError;

            const isNewUser = requiresPasswordChange(data.user);

            if (isNewUser) {
                setStep('CHANGE_PASSWORD');
            } else {
                await completeActivation(data.user, email);
            }
        } catch (err: unknown) {
            setError(normalizeActivationErrorMessage(err) || 'Error al iniciar sesión. Verifique sus credenciales.');
        } finally {
            setLoading(false);
        }
    };

    const continueToTerminalModeSelection = () => {
        setError(null);
        onActivationComplete({
            id: 'local-pos-activation',
            email: '',
            name: 'Activación local / ERP',
            tenantId: '',
            slug: null,
            activationMode: 'LOCAL_OR_ERP',
        });
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            setError('Las contraseñas no coinciden.');
            return;
        }
        if (newPassword.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres.');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const { data, error: updateError } = await supabase.auth.updateUser({
                password: newPassword,
                data: {
                    is_new_user: false,
                    must_change_password: false,
                    force_password_change: false,
                    password_change_required: false,
                    temporary_password: false,
                }
            });

            if (updateError) throw updateError;

            setStep('SUCCESS');
            setTimeout(() => {
                void completeActivation(data.user, email).catch((err: any) => {
                    setStep('CHANGE_PASSWORD');
                    setError(err.message || 'No se pudo completar la activacion.');
                });
            }, 2000);
        } catch (err: unknown) {
            setError(normalizeActivationErrorMessage(err) || 'Error al actualizar la contraseña.');
        } finally {
            setLoading(false);
        }
    };

    const completeActivation = async (user: any, fallbackEmail?: string) => {
        const fallbackTenantId = String(user?.id || '').trim();
        const identity = resolveActivationTenantIdentity(user, fallbackEmail);
        const metadataTenantId = identity.erpTenantId || '';
        const metadataSlug = identity.slug || '';
        const userMetadata = user?.user_metadata || {};
        const resolveTenantDisplayName = () => (
            identity.tenantName
            || userMetadata.company_name
            || userMetadata.business_name
            || userMetadata.tenant_name
            || userMetadata.organization_name
            || userMetadata.name
            || userMetadata.full_name
            || user.email?.split('@')[0]
            || 'Tenant'
        );

        // A new authenticated identity must not inherit a tenant or terminal from a previous session.
        clearPersistedActivationIdentity(localStorage);

        // Backward-compatible path:
        // Some clouds already embed tenant_id in auth metadata but don't expose resolve_tenant_license RPC.
        if (metadataTenantId) {
            const tenantData = {
                id: user.id,
                email: user.email,
                name: resolveTenantDisplayName(),
                tenantId: metadataTenantId,
                slug: metadataSlug || localStorage.getItem('clic_tenant_slug') || null,
            };

            localStorage.setItem('clic_tenant_id', tenantData.tenantId);
            localStorage.setItem('active_tenant_id', tenantData.tenantId);
            localStorage.setItem('clic_erp_tenant_id', tenantData.tenantId);
            localStorage.setItem('clic_tenant_email', identity.email || tenantData.email);
            if (identity.tenantName) {
                localStorage.setItem('clic_tenant_name', identity.tenantName);
            }
            if (identity.cloudAdminTenantId) {
                localStorage.setItem('clic_cloud_tenant_id', identity.cloudAdminTenantId);
                localStorage.setItem('cloud_admin_tenant_id', identity.cloudAdminTenantId);
                localStorage.setItem('clic_cloud_admin_tenant_id', identity.cloudAdminTenantId);
            }
            localStorage.removeItem('clic_tenant_unverified');
            if (tenantData.slug) {
                localStorage.setItem('clic_tenant_slug', tenantData.slug);
            }

            onActivationComplete(tenantData);
            return;
        }

        const resolvedTenant = await resolveTenantRecord({
            tenantId: metadataTenantId || undefined,
            slug: metadataSlug || undefined,
            email: fallbackEmail || user?.email,
        });

        if (!resolvedTenant?.id && !fallbackTenantId) {
            throw new Error(`No se pudo resolver la licencia para ${fallbackEmail || user?.email || 'este usuario'}. Solicite reprovisionar el tenant en Cloud Admin.`);
        }
        const resolvedSlug = userMetadata.slug || resolvedTenant?.slug || localStorage.getItem('clic_tenant_slug');

        const tenantData = {
            id: user.id,
            email: user.email,
            name: resolveTenantDisplayName(),
            tenantId: resolvedTenant?.id || fallbackTenantId,
            slug: resolvedSlug || null,
        };

        localStorage.setItem('clic_tenant_id', tenantData.tenantId);
        localStorage.setItem('active_tenant_id', tenantData.tenantId);
        localStorage.setItem('clic_erp_tenant_id', tenantData.tenantId);
        localStorage.setItem('clic_tenant_email', identity.email || tenantData.email);
        if (identity.tenantName) {
            localStorage.setItem('clic_tenant_name', identity.tenantName);
        }
        if (identity.cloudAdminTenantId) {
            localStorage.setItem('clic_cloud_tenant_id', identity.cloudAdminTenantId);
            localStorage.setItem('cloud_admin_tenant_id', identity.cloudAdminTenantId);
            localStorage.setItem('clic_cloud_admin_tenant_id', identity.cloudAdminTenantId);
        }
        if (!resolvedTenant?.id) {
            localStorage.setItem('clic_tenant_unverified', '1');
            console.warn('Activation completed with unverified tenant mapping. Using auth user id as fallback tenant key.');
        } else {
            localStorage.removeItem('clic_tenant_unverified');
        }
        if (tenantData.slug) {
            localStorage.setItem('clic_tenant_slug', tenantData.slug);
        }

        onActivationComplete(tenantData);
    };

    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 overflow-hidden relative">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 blur-[120px] rounded-full" />

            <div className="max-w-md w-full z-10 transition-all duration-500 transform">
                <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-8 rounded-[2.5rem] shadow-2xl">

                    <div className="flex justify-center mb-8">
                        <div className="bg-gradient-to-tr from-blue-600 to-purple-600 p-4 rounded-3xl shadow-lg shadow-blue-500/20">
                            <Rocket className="text-white" size={32} />
                        </div>
                    </div>

                    {step === 'LOGIN' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="text-center mb-8">
                                <h1 className="text-3xl font-black text-white mb-2">Activación</h1>
                                <p className="text-slate-400 text-sm">Ingrese las credenciales enviadas por Clic-Cloud para vincular su sistema.</p>
                            </div>

                            <form onSubmit={handleInitialLogin} className="space-y-5">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Email Registrado</label>
                                    <div className="relative group">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500 transition-colors" size={20} />
                                        <input
                                            type="email"
                                            required={hasSupabaseConfig}
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            className="w-full bg-slate-800/50 border border-slate-700 focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 rounded-2xl py-4 pl-12 pr-4 text-white outline-none transition-all placeholder:text-slate-600"
                                            placeholder="ejemplo@email.com"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Contraseña Temporal</label>
                                    <div className="relative group">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500 transition-colors" size={20} />
                                        <input
                                            type="password"
                                            required={hasSupabaseConfig}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="w-full bg-slate-800/50 border border-slate-700 focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 rounded-2xl py-4 pl-12 pr-4 text-white outline-none transition-all placeholder:text-slate-600"
                                            placeholder="••••••••"
                                        />
                                    </div>
                                </div>

                                {provisionedCredentials && (
                                    <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-2xl text-xs space-y-1">
                                        <p className="text-emerald-300 font-bold uppercase tracking-wider">Tenant creado correctamente</p>
                                        <p className="text-emerald-200">Email: <span className="font-bold">{provisionedCredentials.email}</span></p>
                                        <p className="text-emerald-200">Clave temporal: <span className="font-bold">{provisionedCredentials.tempPassword}</span></p>
                                    </div>
                                )}

                                {error && (
                                    <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-start gap-3 animate-in fade-in zoom-in">
                                        <AlertCircle className="text-red-500 shrink-0" size={18} />
                                        <p className="text-red-400 text-xs leading-relaxed">{error}</p>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 group"
                                >
                                    {loading ? (
                                        <Loader2 className="animate-spin" size={20} />
                                    ) : (
                                        <>
                                            {hasSupabaseConfig ? 'Continuar' : 'Elegir tipo de POS'} <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                                        </>
                                    )}
                                </button>

                                <button
                                    type="button"
                                    onClick={openProvisionModal}
                                    className="w-full border border-blue-500/40 hover:border-blue-400 text-blue-200 hover:text-white bg-blue-500/10 hover:bg-blue-500/20 font-bold py-3 rounded-2xl transition-colors flex items-center justify-center gap-2"
                                >
                                    <Building2 size={18} /> {canProvisionInline ? 'Crear Empresa y Activar' : 'Abrir Cloud Admin'}
                                </button>

                                {!hasSupabaseConfig && (
                                    <button
                                        type="button"
                                        onClick={continueToTerminalModeSelection}
                                        className="w-full border border-emerald-500/40 hover:border-emerald-400 text-emerald-200 hover:text-white bg-emerald-500/10 hover:bg-emerald-500/20 font-bold py-3 rounded-2xl transition-colors flex items-center justify-center gap-2"
                                    >
                                        <ShieldCheck size={18} /> Elegir tipo de POS
                                    </button>
                                )}
                            </form>
                        </div>
                    )}

                    {step === 'CHANGE_PASSWORD' && (
                        <div className="animate-in fade-in slide-in-from-right-8 duration-500">
                            <div className="text-center mb-8">
                                <div className="inline-flex items-center gap-2 bg-blue-500/10 text-blue-400 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest mb-3">
                                    <ShieldCheck size={12} /> Seguridad Obligatoria
                                </div>
                                <h1 className="text-2xl font-black text-white mb-2">Nueva Contraseña</h1>
                                <p className="text-slate-400 text-sm">Por seguridad, debe cambiar su clave temporal antes de continuar.</p>
                            </div>

                            <form onSubmit={handlePasswordChange} className="space-y-5">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Nueva Clave</label>
                                    <input
                                        type="password"
                                        required
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className="w-full bg-slate-800/50 border border-slate-700 focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 rounded-2xl py-4 px-4 text-white outline-none transition-all"
                                        placeholder="Contraseña segura"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Confirmar Clave</label>
                                    <input
                                        type="password"
                                        required
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="w-full bg-slate-800/50 border border-slate-700 focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 rounded-2xl py-4 px-4 text-white outline-none transition-all"
                                        placeholder="Repita la contraseña"
                                    />
                                </div>

                                {error && (
                                    <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-start gap-3">
                                        <AlertCircle className="text-red-500 shrink-0" size={18} />
                                        <p className="text-red-400 text-xs leading-relaxed">{error}</p>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-green-500/20 transition-all active:scale-[0.98] disabled:opacity-50"
                                >
                                    {loading ? <Loader2 className="animate-spin mx-auto" size={20} /> : 'Activar Sistema'}
                                </button>
                            </form>
                        </div>
                    )}

                    {step === 'SUCCESS' && (
                        <div className="text-center py-10 animate-in zoom-in duration-500">
                            <div className="flex justify-center mb-6">
                                <div className="bg-green-500/20 p-6 rounded-full">
                                    <CheckCircle className="text-green-500" size={64} />
                                </div>
                            </div>
                            <h1 className="text-3xl font-black text-white mb-2">¡Activado!</h1>
                            <p className="text-slate-400">Vinculación exitosa. Iniciando configuración...</p>
                        </div>
                    )}

                </div>

                <div className="mt-8 text-center space-y-4">
                    {getCloudAdminUrl() ? (
                        <a
                            href={getCloudAdminUrl()}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400/60 hover:text-blue-400 text-[11px] font-medium transition-colors border-b border-transparent hover:border-blue-400/30 pb-0.5 inline-block"
                        >
                            ¿Prefiere hacerlo desde el panel de administración? Abrir panel web
                        </a>
                    ) : null}
                    <p className="text-slate-600 text-[10px] uppercase font-bold tracking-[0.2em] pt-2">CLIC POS • CLOUD EDITION</p>
                </div>
            </div>

            {isProvisionModalOpen && (
                <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 sticky top-0">
                            <h3 className="font-black text-lg text-slate-800">Aprovisionar Nueva Empresa</h3>
                            <button
                                type="button"
                                onClick={closeProvisionModal}
                                disabled={isProvisionSubmitting}
                                className="text-slate-400 hover:text-slate-700 transition-colors disabled:opacity-50"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleProvisionTenant} className="p-6 space-y-5">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Nombre Comercial <span className="text-red-500">*</span></label>
                                <input
                                    required
                                    type="text"
                                    value={provisionFormData.name}
                                    onChange={(event) => updateProvisionField('name', event.target.value)}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                    placeholder="Ej. Supermercado El Sol"
                                />
                                <p className="text-xs text-slate-500 mt-1">El nombre se usará para generar el slug del esquema de base de datos.</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">RNC / Cédula</label>
                                    <input
                                        type="text"
                                        value={provisionFormData.taxId}
                                        onChange={(event) => updateProvisionField('taxId', event.target.value)}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                        placeholder="Opcional"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Email de Acceso <span className="text-red-500">*</span></label>
                                    <input
                                        required
                                        type="email"
                                        value={provisionFormData.email}
                                        onChange={(event) => updateProvisionField('email', event.target.value)}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                        placeholder="admin@empresa.com"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Persona de Contacto <span className="text-red-500">*</span></label>
                                    <input
                                        required
                                        type="text"
                                        value={provisionFormData.contactName}
                                        onChange={(event) => updateProvisionField('contactName', event.target.value)}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                        placeholder="Nombre y apellido"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Mail de Contacto <span className="text-red-500">*</span></label>
                                    <input
                                        required
                                        type="email"
                                        value={provisionFormData.contactEmail}
                                        onChange={(event) => updateProvisionField('contactEmail', event.target.value)}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                        placeholder="contacto@empresa.com"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Ciudad <span className="text-red-500">*</span></label>
                                    <input
                                        required
                                        type="text"
                                        value={provisionFormData.city}
                                        onChange={(event) => updateProvisionField('city', event.target.value)}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                        placeholder="Santo Domingo"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">
                                        Distribuidor que Captó
                                        {distributorsLoading ? ' (cargando...)' : ''}
                                    </label>
                                    <select
                                        value={provisionFormData.capturedByDistributorId}
                                        onChange={(event) => updateProvisionField('capturedByDistributorId', event.target.value)}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                    >
                                        <option value="">Sin asignar</option>
                                        {distributors.map((distributor) => (
                                            <option key={distributor.id} value={distributor.id}>
                                                {distributor.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">
                                        Distribuidor que da Servicio
                                        {distributorsLoading ? ' (cargando...)' : ''}
                                    </label>
                                    <select
                                        value={provisionFormData.servicedByDistributorId}
                                        onChange={(event) => updateProvisionField('servicedByDistributorId', event.target.value)}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                    >
                                        <option value="">Sin asignar</option>
                                        {distributors.map((distributor) => (
                                            <option key={distributor.id} value={distributor.id}>
                                                {distributor.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {distributors.length === 0 && !distributorsLoading && (
                                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                    No hay distribuidores activos. Puedes crear tenants sin asignación y completar este dato después.
                                </p>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Tipo de Solución</label>
                                    <select
                                        value={provisionFormData.type}
                                        onChange={(event) => updateProvisionField('type', event.target.value as TenantType)}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-800"
                                    >
                                        <option value="full">MALL POS + Cloud ERP</option>
                                        <option value="pos_only">Solo MALL POS</option>
                                    </select>
                                </div>

                                <div className="flex items-center pt-7">
                                    <label className="flex items-center gap-3 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={provisionFormData.cloudSync}
                                            onChange={(event) => updateProvisionField('cloudSync', event.target.checked)}
                                            className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 transition-colors"
                                        />
                                        <span className="text-sm font-bold text-slate-700 select-none group-hover:text-blue-700 transition-colors">Activar Respaldo Cloud</span>
                                    </label>
                                </div>
                            </div>

                            {provisionError && (
                                <div className="bg-red-50 border border-red-200 p-4 rounded-xl flex items-start gap-3">
                                    <AlertCircle className="text-red-500 shrink-0" size={18} />
                                    <p className="text-red-700 text-sm leading-relaxed">{provisionError}</p>
                                </div>
                            )}

                            <div className="pt-4 flex gap-3">
                                <button
                                    type="button"
                                    onClick={closeProvisionModal}
                                    disabled={isProvisionSubmitting}
                                    className="flex-1 px-4 py-3 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold transition-colors disabled:opacity-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={isProvisionSubmitting}
                                    className="flex-1 px-4 py-3 text-white bg-blue-600 hover:bg-blue-700 rounded-xl font-bold shadow-sm transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
                                >
                                    {isProvisionSubmitting ? <><Loader2 size={18} className="animate-spin" /> Creando Esquema...</> : 'Confirmar Registro'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ActivationScreen;
