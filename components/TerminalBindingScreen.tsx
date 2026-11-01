
import React, { useState } from 'react';
import {
  Monitor, ShieldCheck, Lock, ChevronRight,
  Smartphone, AlertCircle, CheckCircle2, User, KeyRound, Server, Wifi
} from 'lucide-react';
import { BusinessConfig, User as UserType } from '../types';

interface TerminalBindingScreenProps {
  config: BusinessConfig;
  deviceId: string;
  adminUsers: UserType[];
  onPair: (terminalId: string) => void;
  onConfigUpdate?: (newConfig: BusinessConfig) => void;
  onUsersUpdate?: (users: UserType[]) => void;
  initialError?: string | null;
  initialMasterIp?: string;
}

const TerminalBindingScreen: React.FC<TerminalBindingScreenProps> = ({ config, deviceId, adminUsers, onPair, onConfigUpdate, onUsersUpdate, initialError, initialMasterIp }) => {
  const [step, setStep] = useState<'MODE_SELECT' | 'SLAVE_CONNECT' | 'AUTH' | 'SELECT' | 'CONFLICT'>(initialError ? 'SLAVE_CONNECT' : 'MODE_SELECT');
  const [adminPin, setAdminPin] = useState('');
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError || null);
  const [masterIp, setMasterIp] = useState(initialMasterIp || '');
  const [isConnecting, setIsConnecting] = useState(false);
  const [masterAdmins, setMasterAdmins] = useState<UserType[]>([]); // NEW: Local cache of master admins
  const [localIps, setLocalIps] = useState<string[]>([]); // NEW: For diagnostics

  // MODE SELECTION
  const handleModeSelect = (mode: 'MASTER' | 'SLAVE') => {
    if (mode === 'MASTER') {
      setStep('AUTH');
    } else {
      setStep('SLAVE_CONNECT');
      // Proactive IP discovery for the user
      fetch('/api/network')
        .then(res => res.json())
        .then(data => data.addresses && setLocalIps(data.addresses))
        .catch(() => { });
    }
  };

  // SLAVE CONNECTION LOGIC
  const handleConnectToMaster = async () => {
    if (!masterIp) return setError('Ingrese la IP de la Maestra');
    setIsConnecting(true);
    setError(null);

    try {
      console.log(`Connecting to Master at ${masterIp}...`);

      // Sanitize input: Remove protocol if entered, and check for existing port
      const host = masterIp.trim().replace(/^https?:\/\//, '');

      const port = window.location.port;
      const finalHost = host.includes(':') ? host : (port ? `${host}:${port}` : host);

      const protocol = window.location.protocol;
      const targetUrl = `${protocol}//${finalHost}/api/config`;
      console.log(`Fetching config from: ${targetUrl}`);

      const response = await fetch(targetUrl);
      if (!response.ok) throw new Error(`El servidor respondió con error ${response.status}`);

      const fetchedConfig = await response.json();

      // Update local config with Master's config
      if (onConfigUpdate && fetchedConfig && fetchedConfig.terminals) {
        // Ensure "t2" exists in the fetched config if it's not there (auto-provisioning logic)
        // DISABLED: User requested manual creation only.
        /*
        const hasT2 = fetchedConfig.terminals.some((t: any) => t.id === 't2');
        if (!hasT2) {
          fetchedConfig.terminals.push({
            id: 't2',
            config: {
              ...fetchedConfig.terminals[0].config,
              isPrimaryNode: false,
              currentDeviceId: undefined
            }
          });
        }
        */

        onConfigUpdate(fetchedConfig);
      }


      // FETCH USERS FROM MASTER
      const usersUrl = `${protocol}//${finalHost}/api/users`;
      console.log(`Fetching users from: ${usersUrl}`);

      try {
        const usersResponse = await fetch(usersUrl);
        if (usersResponse.ok) {
          const fetchedUsers = await usersResponse.json();
          console.log(`Fetched ${fetchedUsers.length} users from master.`);

          // Case-insensitive filtering for ADMIN role
          const fetchedAdmins = fetchedUsers.filter((u: any) =>
            u.role?.toUpperCase() === 'ADMIN' || u.role?.toUpperCase() === 'ADMINISTRADOR'
          );

          console.log(`Found ${fetchedAdmins.length} admins in master list.`);
          setMasterAdmins(fetchedAdmins);

          if (onUsersUpdate) onUsersUpdate(fetchedUsers);
        } else {
          console.warn(`Failed to fetch users from Master: ${usersResponse.status}`);
        }
      } catch (userErr) {
        console.error("Error fetching users during binding:", userErr);
      }

      localStorage.setItem('pos_master_ip', masterIp);
      setStep('AUTH');
    } catch (err) {
      console.error(err);
      const isHttps = window.location.protocol === 'https:';
      const isNetworkError = (err as Error).message.includes('fetch') || (err as Error).name === 'TypeError';

      let cleanError = `No se pudo conectar a la Maestra (${masterIp}).`;

      if (isNetworkError && isHttps) {
        cleanError += "\n\n⚠️ Posible error de Certificado SSL detectado:\nAl usar HTTPS, debes 'Aceptar el riesgo' visitando la IP de la Maestra en el navegador primero.";
      } else {
        cleanError += `\nError: ${(err as Error).message}`;
      }

      setError(cleanError);
    } finally {
      setIsConnecting(false);
    }
  };

  // AUTH LOGIC
  const handleAuth = () => {
    // Combine local adminUsers with freshly fetched ones
    const allAvailableAdmins = [...adminUsers];

    // Add master admins avoiding duplicates by ID
    masterAdmins.forEach(ma => {
      if (!allAvailableAdmins.some(a => a.id === ma.id)) {
        allAvailableAdmins.push(ma);
      }
    });

    // FALLBACK: Allow '1234' if no admin users loaded (Safety net for setup)
    if (adminPin === '1234' && allAvailableAdmins.length === 0) {
      console.warn("⚠️ Using Fallback Admin PIN (1234) because no admin users loaded.");
      setStep('SELECT');
      setError(null);
      return;
    }

    // Find admin by PIN, ensuring role is ADMIN (case-insensitive)
    const admin = allAvailableAdmins.find(u =>
      u.pin === adminPin && (u.role?.toUpperCase() === 'ADMIN' || u.role?.toUpperCase() === 'ADMINISTRADOR')
    );

    if (admin) {
      setStep('SELECT');
      setError(null);
    } else {
      setError(`PIN de Administrador inválido (Loaded: ${allAvailableAdmins.length} admins)`);
      setAdminPin('');
    }
  };



  const handleSelectTerminal = (tId: string) => {
    const terminal = (config.terminals || []).find(t => t.id === tId);
    if (terminal?.config.currentDeviceId && terminal.config.currentDeviceId !== deviceId) {
      setSelectedTerminalId(tId);
      setStep('CONFLICT');
    } else {
      onPair(tId);
    }
  };

  // Helper function to construct the SSL certificate acceptance URL
  const getCertificateUrl = (): string => {
    if (!masterIp) return '#';

    // Remove any existing protocol prefix
    let cleanIp = masterIp.trim().replace(/^https?:\/\//, '');

    // Add port if not already present
    if (!cleanIp.includes(':')) {
      const port = window.location.port || '3000';
      cleanIp = `${cleanIp}:${port}`;
    }

    // Construct full URL
    const protocol = window.location.protocol;
    const url = `${protocol}//${cleanIp}/api/status`;

    console.log('SSL Certificate URL:', url);
    return url;
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-500 rounded-full blur-[160px]"></div>
      </div>

      <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-10 z-10 animate-in zoom-in-95 duration-300">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-blue-50 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-inner">
            <Smartphone className="text-blue-600" size={40} />
          </div>
          <h1 className="text-2xl font-black text-slate-800">Vinculación de Terminal</h1>
          <p className="text-slate-400 text-sm mt-2 font-medium">Este dispositivo no ha sido autorizado.</p>
        </div>

        {/* STEP 0: MODE SELECTION */}
        {step === 'MODE_SELECT' && (
          <div className="space-y-4 animate-in slide-in-from-bottom-4">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest text-center mb-2">¿Cómo operará esta caja?</p>

            <button
              onClick={() => handleModeSelect('MASTER')}
              className="w-full p-6 bg-slate-50 hover:bg-white border-2 border-slate-100 hover:border-blue-500 rounded-2xl group transition-all text-left relative overflow-hidden"
            >
              <div className="flex items-center gap-4 relative z-10">
                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm text-slate-400 group-hover:text-blue-600 transition-colors">
                  <Server size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">Caja Maestra / Independiente</h3>
                  <p className="text-xs text-slate-400 mt-1">Servidor local o única caja.</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => handleModeSelect('SLAVE')}
              className="w-full p-6 bg-slate-50 hover:bg-white border-2 border-slate-100 hover:border-purple-500 rounded-2xl group transition-all text-left relative overflow-hidden"
            >
              <div className="flex items-center gap-4 relative z-10">
                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm text-slate-400 group-hover:text-purple-600 transition-colors">
                  <Wifi size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">Caja Esclava / Adicional</h3>
                  <p className="text-xs text-slate-400 mt-1">Se conecta a una Maestra existente.</p>
                </div>
              </div>
            </button>
          </div>
        )}

        {/* STEP 0.5: SLAVE CONNECTION */}
        {step === 'SLAVE_CONNECT' && (
          <div className="space-y-6 animate-in slide-in-from-right-4">
            <div className="bg-purple-50 p-6 rounded-2xl border border-purple-100">
              <div className="flex items-center gap-2 mb-4 text-purple-600">
                <Wifi size={16} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Conexión a Maestra</span>
              </div>
              <label className="block text-xs font-bold text-purple-400 mb-2">IP de la Caja Maestra</label>
              <input
                type="text"
                placeholder="Ej: 192.168.1.50"
                value={masterIp}
                onChange={e => setMasterIp(e.target.value)}
                className="w-full p-4 bg-white border-2 border-purple-200 rounded-xl font-mono text-lg outline-none focus:border-purple-500 transition-all text-purple-900 placeholder:text-purple-200"
              />

              {localIps.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="text-[9px] font-bold text-purple-400 uppercase">IP de este equipo:</span>
                  {localIps.map(ip => (
                    <button
                      key={ip}
                      onClick={() => setMasterIp(ip)}
                      className="text-[9px] bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full font-bold hover:bg-purple-200 transition-colors"
                    >
                      {ip}
                    </button>
                  ))}
                </div>
              )}

              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-xl">
                  <p className="text-red-500 text-xs font-bold text-center whitespace-pre-line">{error}</p>
                  {error.includes('SSL') && (
                    <div className="mt-3 p-3 bg-white rounded-lg border border-red-200">
                      <p className="text-[10px] text-red-700 leading-relaxed font-medium">
                        <strong>Para solucionar:</strong><br />
                        1. Abre <a
                          href={getCertificateUrl()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline text-red-600"
                        >este enlace</a> en una pestaña nueva.<br />
                        2. Haz clic en "Configuración avanzada" y "Continuar a {masterIp} (no seguro)".<br />
                        3. Regresa aquí e intenta conectar de nuevo.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={handleConnectToMaster}
              disabled={isConnecting}
              className="w-full py-4 bg-purple-600 text-white rounded-2xl font-black text-lg shadow-xl shadow-purple-200 hover:bg-purple-700 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isConnecting ? 'Conectando...' : 'Conectar y Sincronizar'} <ChevronRight size={20} />
            </button>

            <button
              onClick={() => setStep('MODE_SELECT')}
              className="w-full py-3 text-slate-400 font-bold text-sm hover:text-slate-600 transition-colors"
            >
              Volver
            </button>
          </div>
        )}

        {/* STEP 1: ADMIN AUTH */}
        {step === 'AUTH' && (
          <div className="space-y-6 animate-in slide-in-from-right-4">
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
              <div className="flex items-center gap-2 mb-4 text-slate-500">
                <Lock size={16} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Autorización Requerida</span>
              </div>
              <input
                type="password"
                placeholder="PIN de Administrador"
                value={adminPin}
                maxLength={4}
                onChange={e => setAdminPin(e.target.value)}
                className="w-full p-4 bg-white border-2 border-slate-200 rounded-xl text-center text-2xl font-mono tracking-[1rem] outline-none focus:border-blue-500 transition-all"
              />
              {error && <p className="text-red-500 text-xs mt-3 font-bold text-center">{error}</p>}
            </div>
            <button
              onClick={handleAuth}
              className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-lg shadow-xl shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              Continuar <ChevronRight size={20} />
            </button>
            <button
              onClick={() => setStep('MODE_SELECT')}
              className="w-full py-3 text-slate-400 font-bold text-sm hover:text-slate-600 transition-colors"
            >
              Volver
            </button>
          </div>
        )}

        {/* STEP 2: SELECT TERMINAL */}
        {step === 'SELECT' && (
          <div className="space-y-4 animate-in fade-in">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Selecciona una posición:</p>
            <div className="space-y-3">
              {(config.terminals || []).map(t => (
                <button
                  key={t.id}
                  onClick={() => handleSelectTerminal(t.id)}
                  className="w-full p-4 bg-slate-50 border-2 border-transparent hover:border-blue-400 hover:bg-white rounded-2xl flex items-center justify-between group transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-slate-400 group-hover:text-blue-600 shadow-sm transition-colors">
                      <Monitor size={20} />
                    </div>
                    <div className="text-left">
                      <h4 className="font-bold text-slate-800">{t.id}</h4>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">
                        {t.config.currentDeviceId ? 'Ocupada' : 'Disponible'}
                      </p>
                    </div>
                  </div>
                  {t.config.currentDeviceId && <Lock size={16} className="text-slate-300" />}
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep('AUTH')}
              className="w-full py-3 text-slate-400 font-bold text-sm hover:text-slate-600 transition-colors"
            >
              Volver
            </button>
          </div>
        )}

        {/* STEP 3: CONFLICT RESOLUTION (Takeover) */}
        {step === 'CONFLICT' && (
          <div className="space-y-8 animate-in zoom-in-95 duration-500">
            <div className="relative">
              <div className="w-24 h-24 bg-orange-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-xl shadow-orange-100/50">
                <AlertCircle className="text-orange-500" size={48} />
              </div>
              <div className="absolute -top-2 -right-2 w-8 h-8 bg-orange-500 rounded-full border-4 border-white flex items-center justify-center animate-pulse">
                <ShieldCheck className="text-white" size={14} />
              </div>
            </div>

            <div className="text-center space-y-3">
              <h3 className="text-2xl font-black text-slate-800 tracking-tight">Terminal en Uso</h3>
              <p className="text-slate-500 text-sm leading-relaxed px-4">
                La terminal <strong className="text-orange-600 px-2 py-0.5 bg-orange-50 rounded-md">{selectedTerminalId}</strong> ya está vinculada a otro hardware en el sistema.
              </p>
            </div>

            <div className="bg-slate-50 rounded-3xl p-6 border-2 border-slate-100/50 space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 shrink-0">
                  <CheckCircle2 size={20} />
                </div>
                <div>
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest mb-1">Migración Automática</h4>
                  <p className="text-[11px] text-slate-400 leading-tight">
                    Si tomas el control, migraremos automáticamente:
                    <br />
                    <span className="text-slate-500 font-bold">•</span> Ventas e Historial
                    <br />
                    <span className="text-slate-500 font-bold">•</span> Secuencias de Documentos
                    <br />
                    <span className="text-slate-500 font-bold">•</span> Movimientos de Caja
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => onPair(selectedTerminalId!)}
                className="w-full py-5 bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-2xl font-black text-lg shadow-xl shadow-orange-200 hover:shadow-orange-300 active:scale-95 transition-all flex items-center justify-center gap-3"
              >
                Tomar Control y Migrar <ChevronRight size={22} />
              </button>

              <button
                onClick={() => setStep('SELECT')}
                className="w-full py-4 text-slate-400 font-bold text-sm hover:text-slate-800 hover:bg-slate-50 rounded-2xl transition-all"
              >
                Elegir otra posición
              </button>
            </div>
          </div>
        )}

        <div className="mt-10 pt-6 border-t border-slate-100 text-center">
          <p className="text-[10px] text-slate-300 font-mono">Fingerprint: {deviceId.substring(0, 18)}...</p>
        </div>
      </div>
    </div>
  );
};

export default TerminalBindingScreen;
