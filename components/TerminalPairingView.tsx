import React, { useEffect, useState } from 'react';
import {
    Monitor,
    Server,
    WifiOff,
    ArrowRight,
    RefreshCw,
    CheckCircle,
    AlertTriangle,
    Lock
} from 'lucide-react';
import { TerminalConfig } from '../types';
import {
    buildMasterUrlCandidates,
    buildMasterUrlFromHost,
    normalizeMasterHost,
    resolveMasterEndpointFromCloud,
} from '../utils/cloudMasterRegistry';
import { NetworkScanner } from '../services/sync/NetworkScanner';

interface TerminalPairingViewProps {
    currentDeviceId: string;
    setupMode?: 'SERVER' | 'CLIENT' | null;
    localTerminals?: { id: string; config: TerminalConfig }[];
    onPair: (terminalId: string, masterIp: string, options?: { forceTakeover?: boolean }) => Promise<void>;
    initialMasterIp?: string;
    onBack?: () => void;
}

type ConnectionSource = 'CLOUD' | 'LAN' | 'MANUAL' | 'LOCAL' | null;

type MasterCandidate = {
    host: string;
    source: Exclude<ConnectionSource, null>;
};

export const TerminalPairingView: React.FC<TerminalPairingViewProps> = ({
    currentDeviceId,
    setupMode = null,
    localTerminals = [],
    onPair,
    initialMasterIp = '',
    onBack
}) => {
    const [masterIp, setMasterIp] = useState(() => normalizeMasterHost(initialMasterIp || localStorage.getItem('pos_master_ip') || ''));
    const [terminals, setTerminals] = useState<{ id: string; config: TerminalConfig }[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
    const [isPairing, setIsPairing] = useState(false);
    const [showIpInput, setShowIpInput] = useState(false);
    const [connectionSource, setConnectionSource] = useState<ConnectionSource>(null);

    const persistResolvedMaster = (
        host: string,
        source: Exclude<ConnectionSource, null>,
        resolvedUrl?: string,
    ) => {
        if (!host) return;
        localStorage.setItem('pos_master_ip', host);
        localStorage.setItem('CLIC_POS_MASTER_URL', resolvedUrl || buildMasterUrlFromHost(host));
        localStorage.setItem('CLIC_POS_MASTER_DISCOVERY', source);
    };

    const getExpectedTenantId = () => (
        localStorage.getItem('clic_erp_sync_tenant_id')
        || localStorage.getItem('active_tenant_id')
        || localStorage.getItem('clic_tenant_id')
        || ''
    ).trim();

    const discoverLanCandidates = async (): Promise<MasterCandidate[]> => {
        const expectedTenantId = getExpectedTenantId();
        const nativeBridge = window.ClicPOSNativePrinter;
        const candidates: MasterCandidate[] = [];
        let localIpHint = '';

        if (typeof nativeBridge?.discoverMasterServers === 'function') {
            try {
                const discovery = await nativeBridge.discoverMasterServers({ timeoutMs: 2500 });
                const masters = Array.isArray(discovery?.masters) ? discovery.masters : [];
                masters
                    .filter(master => {
                        const discoveredTenantId = String(master.tenantId || '').trim();
                        return !expectedTenantId || !discoveredTenantId || discoveredTenantId === expectedTenantId;
                    })
                    .sort((left, right) => {
                        const leftMatches = String(left.tenantId || '').trim() === expectedTenantId ? 1 : 0;
                        const rightMatches = String(right.tenantId || '').trim() === expectedTenantId ? 1 : 0;
                        return rightMatches - leftMatches;
                    })
                    .forEach(master => {
                        const host = normalizeMasterHost(master.host || master.url || '');
                        if (host && !candidates.some(candidate => candidate.host === host)) {
                            candidates.push({ host, source: 'LAN' });
                        }
                    });
            } catch (nativeError) {
                console.warn('📡 Native Master discovery failed:', nativeError);
            }
        }

        if (candidates.length > 0) return candidates;

        if (typeof nativeBridge?.getDeviceInfo === 'function') {
            try {
                const deviceInfo = await nativeBridge.getDeviceInfo();
                localIpHint = String(deviceInfo?.localIp || deviceInfo?.localIps?.[0] || '');
            } catch {
                localIpHint = '';
            }
        }

        const scannedUrl = await NetworkScanner.findMaster(localIpHint || undefined, expectedTenantId || undefined);
        const scannedHost = normalizeMasterHost(scannedUrl || '');
        return scannedHost ? [{ host: scannedHost, source: 'LAN' }] : [];
    };

    const fetchAvailableTerminals = async (resolvedMasterIp: string) => {
        const candidateBaseUrls = buildMasterUrlCandidates(resolvedMasterIp);
        let lastError: Error | null = null;

        for (const baseUrl of candidateBaseUrls) {
            const targetUrl = `${baseUrl}/api/config`;
            console.log(`📡 Fetching terminals from: ${targetUrl}`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            try {
                const res = await fetch(targetUrl, { signal: controller.signal });
                if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

                const data = await res.json();

                if (!data || !Array.isArray(data.terminals)) {
                    throw new Error('Formato de respuesta inválido del servidor.');
                }

                return {
                    terminals: data.terminals.filter((t: any) => (
                        !t.config?.currentDeviceId || t.config?.currentDeviceId === currentDeviceId
                    )),
                    resolvedMasterHost: normalizeMasterHost(new URL(baseUrl).hostname),
                    resolvedMasterUrl: baseUrl,
                };
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
            } finally {
                clearTimeout(timeoutId);
            }
        }

        throw lastError || new Error('No se pudo conectar al Master.');
    };

    const buildConnectionError = (resolvedMasterIp: string, err: any) => {
        if (err?.name === 'AbortError') {
            return 'Tiempo de espera agotado. Verifique la IP.';
        }

        const detail = String(err?.message || err || '').toLowerCase();
        if (detail.includes('ssl') || detail.includes('certificate') || detail.includes('certificado')) {
            return `La red intentó usar SSL para ${resolvedMasterIp}. La conexión local debe usar http://${resolvedMasterIp}:3001.`;
        }

        return `No se pudo conectar al Master (${resolvedMasterIp}).`;
    };

    const fetchTerminals = async (
        hostOverride?: string,
        sourceOverride?: Exclude<ConnectionSource, null>,
        allowAutomaticFallback = true
    ) => {
        const requestedHost = normalizeMasterHost(hostOverride ?? masterIp);
        const requestedSource = sourceOverride || connectionSource || 'MANUAL';

        setIsLoading(true);
        setError(null);
        setTerminals([]);

        const candidates: MasterCandidate[] = [];
        const appendCandidate = (candidate: MasterCandidate) => {
            if (candidate.host && !candidates.some(existing => existing.host === candidate.host)) {
                candidates.push(candidate);
            }
        };

        if (requestedHost) appendCandidate({ host: requestedHost, source: requestedSource });
        let lastHost = requestedHost;
        let lastError: unknown = null;
        const attemptedHosts = new Set<string>();

        const connectToCandidates = async (): Promise<boolean> => {
            for (const candidate of candidates) {
                if (attemptedHosts.has(candidate.host)) continue;
                attemptedHosts.add(candidate.host);
                lastHost = candidate.host;
                try {
                    const result = await fetchAvailableTerminals(candidate.host);
                    setMasterIp(result.resolvedMasterHost);
                    setConnectionSource(candidate.source);
                    setShowIpInput(false);
                    persistResolvedMaster(result.resolvedMasterHost, candidate.source, result.resolvedMasterUrl);
                    setTerminals(result.terminals);
                    setError(result.terminals.length === 0 ? 'No hay terminales disponibles en el servidor.' : null);
                    return true;
                } catch (candidateError) {
                    lastError = candidateError;
                    console.warn(`❌ No se pudo conectar al Master candidato ${candidate.host}:`, candidateError);
                }
            }
            return false;
        };

        try {
            if (allowAutomaticFallback) {
                const cloudEndpoint = await resolveMasterEndpointFromCloud();
                const cloudHost = normalizeMasterHost(cloudEndpoint?.localIp || cloudEndpoint?.endpointUrl || '');
                if (cloudHost) appendCandidate({ host: cloudHost, source: 'CLOUD' });
            }

            if (await connectToCandidates()) return;

            if (allowAutomaticFallback) {
                const lanCandidates = await discoverLanCandidates();
                lanCandidates.forEach(appendCandidate);
                if (await connectToCandidates()) return;
            }

            setMasterIp(lastHost);
            setConnectionSource(null);
            setShowIpInput(true);
            setError(lastHost
                ? buildConnectionError(lastHost, lastError)
                : 'No se encontró una Caja Master en esta red. Ingrese la IP manualmente.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (setupMode === 'SERVER') {
            setTerminals(localTerminals);
            setShowIpInput(false);
            setError(localTerminals.length === 0 ? 'No hay terminales configuradas para vincular.' : null);

            let isMounted = true;

            const resolveExistingMaster = async () => {
                const storedHost = normalizeMasterHost(initialMasterIp || localStorage.getItem('pos_master_ip') || '');
                if (storedHost) {
                    if (!isMounted) return;
                    setMasterIp(storedHost);
                    const storedDiscovery = localStorage.getItem('CLIC_POS_MASTER_DISCOVERY');
                    setConnectionSource(storedDiscovery === 'CLOUD' || storedDiscovery === 'LAN' ? storedDiscovery : 'MANUAL');
                    return;
                }

                const cloudEndpoint = await resolveMasterEndpointFromCloud();
                const cloudHost = normalizeMasterHost(cloudEndpoint?.localIp || cloudEndpoint?.endpointUrl || '');
                if (!isMounted || !cloudHost) return;

                setMasterIp(cloudHost);
                setConnectionSource('CLOUD');
            };

            void resolveExistingMaster();

            return () => {
                isMounted = false;
            };
        }

        let isMounted = true;

        const bootstrapDiscovery = async () => {
            const storedHost = normalizeMasterHost(initialMasterIp || localStorage.getItem('pos_master_ip') || '');
            const storedDiscovery = localStorage.getItem('CLIC_POS_MASTER_DISCOVERY');
            const storedSource: Exclude<ConnectionSource, null> = storedDiscovery === 'CLOUD' || storedDiscovery === 'LAN'
                ? storedDiscovery
                : 'MANUAL';

            if (storedHost) {
                if (!isMounted) return;
                setMasterIp(storedHost);
                setConnectionSource(storedSource);
                await fetchTerminals(storedHost, storedSource, true);
                return;
            }

            if (!isMounted) return;
            await fetchTerminals('', 'LAN', true);
        };

        void bootstrapDiscovery();

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        if (setupMode === 'SERVER') {
            setTerminals(localTerminals);
        }
    }, [localTerminals, setupMode]);

    const handleConfirmPairing = async () => {
        if (!selectedTerminalId) return;

        const selectedTerminal = terminals.find((terminal) => terminal.id === selectedTerminalId);
        const isOccupiedByAnotherDevice =
            !!selectedTerminal?.config?.currentDeviceId &&
            selectedTerminal.config.currentDeviceId !== currentDeviceId;

        if (setupMode === 'SERVER') {
            setIsPairing(true);
            try {
                await onPair(selectedTerminalId, normalizeMasterHost(masterIp), {
                    forceTakeover: isOccupiedByAnotherDevice
                });
            } catch (e: any) {
                setError(e.message || 'Error al vincular.');
                setIsPairing(false);
            }
            return;
        }

        const resolvedMasterIp = normalizeMasterHost(masterIp);
        if (!resolvedMasterIp) {
            setError('Ingrese la IP del servidor master.');
            setShowIpInput(true);
            return;
        }

        setIsPairing(true);
        try {
            await onPair(selectedTerminalId, resolvedMasterIp);
        } catch (e: any) {
            setError(e.message || 'Error al vincular.');
            setIsPairing(false);
        }
    };

    const selectedTerminal = terminals.find((terminal) => terminal.id === selectedTerminalId);
    const selectedTerminalOccupiedByAnotherDevice =
        !!selectedTerminal?.config?.currentDeviceId &&
        selectedTerminal.config.currentDeviceId !== currentDeviceId;

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 font-sans text-slate-800">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
                <div className="bg-slate-900 p-6 text-white text-center">
                    <div className="mx-auto bg-blue-600 w-12 h-12 rounded-xl flex items-center justify-center mb-4 shadow-lg ring-4 ring-blue-500/20">
                        <Monitor size={24} className="text-white" />
                    </div>
                    <h1 className="text-2xl font-bold mb-1">Vincular Dispositivo</h1>
                    <p className="text-slate-400 text-sm">
                        Este equipo no está autorizado.
                    </p>
                </div>

                <div className="p-6">
                    <div className="flex justify-center mb-6">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-full text-xs font-mono font-medium text-gray-500 border border-gray-200">
                            <span>ID: {currentDeviceId}</span>
                        </div>
                    </div>

                    {setupMode !== 'SERVER' && (
                        <div className="mb-6">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Servidor Master</label>
                                <button
                                    onClick={() => {
                                        setShowIpInput(!showIpInput);
                                        if (!showIpInput) {
                                            setConnectionSource('MANUAL');
                                        }
                                    }}
                                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                                >
                                    {showIpInput ? 'Ocultar' : 'Cambiar IP'}
                                </button>
                            </div>

                            {showIpInput ? (
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={masterIp}
                                        onChange={(e) => {
                                            setMasterIp(e.target.value);
                                            setConnectionSource('MANUAL');
                                        }}
                                        className="flex-1 bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                        placeholder="Ej: 192.168.1.100"
                                    />
                                    <button
                                        onClick={() => void fetchTerminals(masterIp, 'MANUAL')}
                                        disabled={isLoading}
                                        className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-lg transition-colors flex items-center justify-center"
                                    >
                                        {isLoading ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                                    </button>
                                </div>
                            ) : (
                                <div onClick={() => void fetchTerminals(masterIp, connectionSource || 'MANUAL')} className="group cursor-pointer flex items-center gap-3 p-3 bg-blue-50/50 hover:bg-blue-50 border border-blue-100/50 hover:border-blue-200 rounded-xl transition-all">
                                    <div className={`p-2 rounded-lg ${error ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                                        {error ? <WifiOff size={18} /> : <Server size={18} />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-slate-700 truncate">{masterIp || 'Sin Configurar'}</p>
                                        <p className="text-xs text-slate-500 truncate">
                                            {isLoading ? 'Conectando...' : (error ? 'Sin conexión' : 'Conectado')}
                                        </p>
                                        {connectionSource && (
                                            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mt-1">
                                                {connectionSource === 'CLOUD' && 'Detectado desde Cloud'}
                                                {connectionSource === 'LAN' && 'Detectado automáticamente en la red'}
                                                {connectionSource === 'MANUAL' && 'Configurado manualmente'}
                                                {connectionSource === 'LOCAL' && 'Host local'}
                                            </p>
                                        )}
                                    </div>
                                    <div className="text-gray-400 group-hover:text-blue-500">
                                        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                                    </div>
                                </div>
                            )}

                            {error && !showIpInput && (
                                <p className="mt-2 text-xs text-red-500 flex items-center gap-1 animate-in fade-in slide-in-from-top-1">
                                    <AlertTriangle size={12} /> {error}
                                </p>
                            )}
                        </div>
                    )}

                    {setupMode === 'SERVER' && masterIp && (
                        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            Se detectó una caja activa en <span className="font-semibold">{masterIp}</span>. Si eliges una terminal ocupada, ese equipo se desvinculará y este dispositivo intentará restaurar maestros y transacciones.
                        </div>
                    )}

                    <div className="mb-6">
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                            {setupMode === 'SERVER' ? 'Terminales Configuradas' : 'Terminales Disponibles'}
                        </label>

                        {terminals.length === 0 && !isLoading && !error && (
                            <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                                <p className="text-sm">
                                    {setupMode === 'SERVER' ? 'No se encontraron terminales configuradas.' : 'No se encontraron terminales libres.'}
                                </p>
                            </div>
                        )}

                        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                            {terminals.map((t) => {
                                const isSelected = selectedTerminalId === t.id;
                                const isRebind = t.config?.currentDeviceId === currentDeviceId;
                                const isOccupiedByAnotherDevice =
                                    !!t.config?.currentDeviceId && t.config.currentDeviceId !== currentDeviceId;

                                return (
                                    <div
                                        key={t.id}
                                        onClick={() => setSelectedTerminalId(t.id)}
                                        className={`
                        relative cursor-pointer p-3 rounded-xl border transition-all duration-200
                        ${isSelected
                                                ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-500/20'
                                                : 'bg-white border-gray-200 text-slate-700 hover:border-blue-300 hover:shadow-sm'}
                      `}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className={`font-semibold text-sm ${isSelected ? 'text-white' : 'text-slate-800'}`}>
                                                    {t.config?.deviceRole?.role.replace('_', ' ') || 'Terminal POS'}
                                                </p>
                                                <p className={`text-xs ${isSelected ? 'text-blue-100' : 'text-slate-500'}`}>
                                                    ID: {t.id} {isRebind && '(Actual)'}
                                                </p>
                                                <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${
                                                    isSelected
                                                        ? 'bg-white/15 text-white'
                                                        : isOccupiedByAnotherDevice
                                                            ? 'bg-amber-100 text-amber-700'
                                                            : 'bg-emerald-100 text-emerald-700'
                                                }`}>
                                                    {isOccupiedByAnotherDevice ? <Lock size={12} /> : <CheckCircle size={12} />}
                                                    {isOccupiedByAnotherDevice ? `En uso por ${t.config.currentDeviceId}` : 'Disponible'}
                                                </div>
                                            </div>
                                            {isSelected && <CheckCircle size={18} className="text-white" />}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {selectedTerminalOccupiedByAnotherDevice && (
                        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                            <p className="font-semibold">Esta terminal ya está en uso.</p>
                            <p className="mt-1 text-xs leading-relaxed text-amber-800">
                                Si continúas, se desvinculará el equipo <span className="font-semibold">{selectedTerminal?.config?.currentDeviceId}</span> de la terminal <span className="font-semibold">{selectedTerminal?.id}</span> y este dispositivo asumirá ese rol. Si la caja anterior está accesible desde Cloud o red local, se restaurarán maestros y transacciones aquí.
                            </p>
                        </div>
                    )}

                    <button
                        onClick={handleConfirmPairing}
                        disabled={!selectedTerminalId || isPairing}
                        className={`
              w-full py-3.5 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2
              ${!selectedTerminalId || isPairing
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/25 active:scale-[0.98]'}
            `}
                    >
                        {isPairing ? (
                            <>
                                <RefreshCw size={18} className="animate-spin" />
                                Vinculando...
                            </>
                        ) : (
                            <>
                                Confirmar Vinculación
                                <ArrowRight size={18} />
                            </>
                        )}
                    </button>

                    {onBack && (
                        <button
                            type="button"
                            onClick={onBack}
                            className="w-full mt-3 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
                        >
                            Volver a elegir modo
                        </button>
                    )}
                </div>
            </div>

            <p className="mt-8 text-xs text-slate-400 font-medium">
                Alfa POS v2.5 &bull; Powered by Antigravity
            </p>
        </div>
    );
};
