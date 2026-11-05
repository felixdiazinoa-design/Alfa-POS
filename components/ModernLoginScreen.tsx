import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Delete, Lock, Fingerprint, User as UserIcon } from 'lucide-react';
import { User as UserType, TerminalConfig } from '../types';
import { biometricService } from '../services/BiometricAuthService';
import './ModernLoginScreen.css';
import {
  beginPosInteraction,
  expectInteractionRender,
  markInteractionStage,
  markInteractionStateUpdate,
  markRenderEnd,
  markRenderStart,
} from '../utils/interactionPerformance';

/** En WebView/Capacitor, enfocar un input numérico abre el teclado virtual y desplaza la UI; el PIN se sigue pudiendo digitar con teclado físico vía `keydown` global. */
const suppressNativeSoftKeyboardForPin = Capacitor.isNativePlatform();

const isGeneratedAvatarPlaceholder = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes('api.dicebear.com') ||
    normalized.includes('/avataaars/') ||
    normalized.includes('placeholder') ||
    normalized.includes('placehold.co')
  );
};

interface ModernLoginScreenProps {
  onLogin: (user: UserType) => void;
  subVertical: string;
  availableUsers: UserType[];
  config: TerminalConfig;
}

const ModernLoginScreen: React.FC<ModernLoginScreenProps> = ({
  onLogin,
  subVertical,
  availableUsers,
  config
}) => {
  markRenderStart('LOGIN_PIN');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserType | null>(null);
  const [biometricError, setBiometricError] = useState(false);
  const [biometricFailCount, setBiometricFailCount] = useState(0);
  const [isHardwareAvailable, setIsHardwareAvailable] = useState(false);
  const [isExternalReaderListening, setIsExternalReaderListening] = useState(false);
  const [buildVersion, setBuildVersion] = useState<string>('');
  const [currentDateTime, setCurrentDateTime] = useState(() => new Date());
  const [failedUserPhotos, setFailedUserPhotos] = useState<Record<string, boolean>>({});
  const pinInputRef = useRef<HTMLInputElement>(null);
  const biometricScanInFlightRef = useRef(false);
  useLayoutEffect(() => markRenderEnd('LOGIN_PIN'));
  const usersByPin = useMemo(() => {
    const map = new Map<string, UserType>();
    for (const user of availableUsers) {
      if (user.pin && !map.has(user.pin)) map.set(user.pin, user);
    }
    return map;
  }, [availableUsers]);

  const focusPinInput = useCallback(() => {
    if (suppressNativeSoftKeyboardForPin) return;
    window.requestAnimationFrame(() => {
      pinInputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    const initBiometrics = async () => {
      const available = await biometricService.isAvailable();
      setIsHardwareAvailable(available);
    };
    void initBiometrics();
  }, []);

  useEffect(() => {
    const loadBuildVersion = async () => {
      const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          const runtimeWindow = window as any;
          let deviceInfo: { versionName?: string; versionCode?: number } | null = null;

          if (typeof runtimeWindow.ClicPOSNativePrinter?.getDeviceInfo === 'function') {
            deviceInfo = await runtimeWindow.ClicPOSNativePrinter.getDeviceInfo();
          } else if (typeof runtimeWindow.AndroidPrinter?.getDeviceInfo === 'function') {
            const raw = runtimeWindow.AndroidPrinter.getDeviceInfo();
            deviceInfo = raw ? JSON.parse(raw) : null;
          }

          if (deviceInfo?.versionName) {
            setBuildVersion(
              deviceInfo.versionCode
                ? `APK v${deviceInfo.versionName} (${deviceInfo.versionCode})`
                : `APK v${deviceInfo.versionName}`
            );
            return;
          }
        } catch (loadError) {
          console.warn('No se pudo leer la versión del compilado:', loadError);
        }

        await wait(250);
      }

      setBuildVersion('Web');
    };

    void loadBuildVersion();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentDateTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const dateTimeLabel = useMemo(() => currentDateTime.toLocaleString('es-DO', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }), [currentDateTime]);

  const checkLogin = useCallback((inputPin: string) => {
    const user = selectedUser?.pin === inputPin ? selectedUser : usersByPin.get(inputPin);
    if (user) {
      onLogin(user);
    } else {
      setError(true);
      setPin('');
    }
  }, [onLogin, selectedUser, usersByPin]);

  const handleKeyPress = useCallback((key: string) => {
    const trace = beginPosInteraction('PIN_LOGIN', { source: 'keypad', key: key === 'BACK' ? 'BACK' : key === 'C' ? 'CLEAR' : 'DIGIT' });
    expectInteractionRender(trace, 'LOGIN_PIN');
    setError(false);
    if (key === 'C') {
      setPin('');
    } else if (key === 'BACK') {
      setPin((prev) => prev.slice(0, -1));
    } else {
      setPin((prev) => {
        if (prev.length < 4) return prev + key;
        return prev;
      });
    }
    markInteractionStateUpdate(trace, 1);
    markInteractionStage(trace, 'HANDLER_END');
    focusPinInput();
  }, [focusPinInput]);

  const handlePinInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const trace = beginPosInteraction('PIN_LOGIN', { source: 'hardware_input' });
    expectInteractionRender(trace, 'LOGIN_PIN');
    const nextPin = event.target.value.replace(/\D/g, '').slice(0, 4);
    setError(false);
    setPin(nextPin);
    markInteractionStateUpdate(trace, 1);
    markInteractionStage(trace, 'HANDLER_END');
  }, []);

  useEffect(() => {
    if (pin.length === 4) {
      checkLogin(pin);
    }
  }, [pin, checkLogin]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // En web, con el input enfocado el propio campo recibe la entrada; en nativo no enfocamos (evita IME) pero si hubiera foco readonly, seguir capturando aquí.
    if (document.activeElement === pinInputRef.current && !suppressNativeSoftKeyboardForPin) {
      return;
    }

    const keypadDigit = event.code.match(/^Numpad([0-9])$/)?.[1];
    const digit = /^[0-9]$/.test(event.key) ? event.key : keypadDigit;

    if (digit) {
      event.preventDefault();
      handleKeyPress(digit);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      handleKeyPress('BACK');
    } else if (event.key === 'Escape' || event.key.toLowerCase() === 'c') {
      event.preventDefault();
      handleKeyPress('C');
    } else if (event.key === 'Enter' && pin.length === 4) {
      event.preventDefault();
      checkLogin(pin);
    }
  }, [checkLogin, handleKeyPress, pin]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    focusPinInput();
  }, [focusPinInput]);

  useEffect(() => {
    if (!suppressNativeSoftKeyboardForPin) return;
    pinInputRef.current?.blur();
  }, []);

  const handleBiometricLogin = async () => {
    if (biometricFailCount >= 3) {
      setBiometricError(true);
      return;
    }

    if (biometricScanInFlightRef.current) return;
    biometricScanInFlightRef.current = true;

    try {
      setBiometricError(false);
      const enrolledUsers = availableUsers.filter((user) => user.biometrics?.credentialID);
      if (enrolledUsers.length === 0) return;

      const credentials = enrolledUsers.map((user) => user.biometrics!);
      const matchedId = await biometricService.verify(credentials);

      if (matchedId) {
        const targetUser = enrolledUsers.find((user) => user.biometrics?.credentialID === matchedId);
        if (targetUser) {
          onLogin(targetUser);
          return;
        }
      }

      setBiometricFailCount((prev) => prev + 1);
      setBiometricError(true);
      window.setTimeout(() => setBiometricError(false), 2000);
    } catch {
      setBiometricFailCount((prev) => prev + 1);
      setBiometricError(true);
      window.setTimeout(() => setBiometricError(false), 2000);
    } finally {
      biometricScanInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!config.security?.allowBiometrics || !isHardwareAvailable) {
      setIsExternalReaderListening(false);
      return;
    }

    const enrolledUsers = availableUsers.filter((user) => user.biometrics?.publicKey?.startsWith('sourceafis:'));
    if (enrolledUsers.length === 0) {
      setIsExternalReaderListening(false);
      return;
    }

    let cancelled = false;
    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const listenForFingerprint = async () => {
      const externalReaderAvailable = await biometricService.isExternalReaderAvailable();
      if (cancelled || !externalReaderAvailable) return;

      setIsExternalReaderListening(true);
      const credentials = enrolledUsers.map((user) => user.biometrics!);

      while (!cancelled) {
        if (biometricScanInFlightRef.current) {
          await wait(250);
          continue;
        }

        biometricScanInFlightRef.current = true;
        try {
          const matchedId = await biometricService.verify(credentials);
          if (cancelled) return;

          const targetUser = enrolledUsers.find((user) => user.biometrics?.credentialID === matchedId);
          if (targetUser) {
            setIsExternalReaderListening(false);
            onLogin(targetUser);
            return;
          }
        } finally {
          biometricScanInFlightRef.current = false;
        }

        if (!cancelled) await wait(500);
      }
    };

    void listenForFingerprint();
    return () => {
      cancelled = true;
      setIsExternalReaderListening(false);
    };
  }, [availableUsers, config.security?.allowBiometrics, isHardwareAvailable, onLogin]);

  const loginFooterText =
    config.security?.allowBiometrics && isHardwareAvailable
      ? biometricError
        ? 'Reintente huella o tarjeta'
        : isExternalReaderListening
          ? 'Lector listo: coloque el dedo'
          : 'Preparando lector de huella...'
      : 'Escanear Tarjeta o Login con Huella';

  return (
    <div className="modern-login-container">
      <aside className="modern-login-brand">
        <div className="alfa-brand-top">
          <svg className="alfa-brand-mark" viewBox="0 0 64 64" aria-label="ALFA">
            <path fill="#F4F7F6" d="M7 52 26.5 12 35 29.2 23.8 52Z" />
            <path fill="#00A7A0" d="M29.8 8H43l14 29.3-16.4-5.8Z" />
            <path fill="#B8E336" d="m38.8 35 16.8 6L61 52H46.7Z" />
            <path fill="#132124" d="m28.4 33.4 6.2 12.7L31.7 52h-8Z" />
          </svg>
          <div className="modern-login-brand-wordmark">
            <span className="modern-login-brand-mark">ALFA</span>
            <span className="modern-login-brand-pos">-POS</span>
          </div>
          <p className="alfa-brand-tag">Punto de venta · Retail Suite</p>
        </div>

        <div className="alfa-brand-bottom">
          <div className="alfa-brand-store">
            <span className="alfa-brand-dot" />
            {subVertical || 'Terminal'}
          </div>
          <div className="alfa-brand-meta">
            <div>Terminal<b>{config.terminalName || config.stationNumber || 'POS-001'}</b></div>
            {buildVersion ? <div>Versión<b>{buildVersion}</b></div> : null}
            <div>Hora<b>{dateTimeLabel}</b></div>
          </div>
        </div>
      </aside>

      <div className={`modern-login-card animate-fade-in ${error ? 'animate-shake' : ''}`}>
        {/* Left Side: Company & User Selection */}
        <div className="modern-login-left">
          <div className="modern-login-header">
            <div className="modern-lock-icon-container">
              <Lock className="text-blue-400" size={30} />
            </div>
            <p className="modern-login-subtitle">{subVertical}</p>
            <h1 className="modern-login-title">Acceso de Sistema</h1>
          </div>

          <div className="modern-user-grid">
            {availableUsers.slice(0, 12).map((user) => {
              const photoSrc = typeof user.photo === 'string' ? user.photo.trim() : '';
              const shouldShowPhoto = photoSrc && !isGeneratedAvatarPlaceholder(photoSrc) && !failedUserPhotos[user.id];

              return (
                <button
                  key={user.id}
                  onClick={() => {
                    setSelectedUser(user);
                    setPin('');
                    setError(false);
                  }}
                  className={`modern-user-card ${selectedUser?.id === user.id ? 'active' : ''}`}
                >
                  <div className="modern-user-avatar-wrapper">
                    <div className="modern-user-avatar">
                      {shouldShowPhoto ? (
                        <img
                          src={photoSrc}
                          alt={user.name}
                          className="w-full h-full object-cover"
                          onError={() => setFailedUserPhotos((prev) => ({ ...prev, [user.id]: true }))}
                        />
                      ) : (
                        <UserIcon className="modern-user-avatar-fallback" aria-hidden="true" />
                      )}
                    </div>
                  </div>
                  <span className="modern-user-name">{user.name.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Side: PIN Entry & Keypad */}
        <div className="modern-login-right">
          <div
            className="modern-pin-section"
            onClick={suppressNativeSoftKeyboardForPin ? undefined : focusPinInput}
          >
            <input
              ref={pinInputRef}
              type={suppressNativeSoftKeyboardForPin ? 'text' : 'tel'}
              inputMode={suppressNativeSoftKeyboardForPin ? 'none' : 'numeric'}
              pattern={suppressNativeSoftKeyboardForPin ? undefined : '[0-9]*'}
              readOnly={suppressNativeSoftKeyboardForPin}
              autoComplete="off"
              enterKeyHint="done"
              className="modern-pin-input"
              value={pin}
              onChange={handlePinInputChange}
              onKeyDown={(event) => {
                if (event.key === 'Escape' || event.key.toLowerCase() === 'c') {
                  event.preventDefault();
                  handleKeyPress('C');
                } else if (event.key === 'Enter' && pin.length === 4) {
                  event.preventDefault();
                  checkLogin(pin);
                }
              }}
              aria-label="PIN de acceso"
            />
            <div className="modern-pin-display">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className={`modern-pin-dot ${pin.length > index ? (error ? 'error' : 'filled') : ''}`}
                />
              ))}
            </div>
            {error && (
              <div className="text-center text-red-500 text-xs mt-2 font-semibold">
                PIN Incorrecto. Intente nuevamente.
              </div>
            )}
          </div>

          <div className="modern-keypad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button key={num} onClick={() => handleKeyPress(num.toString())} className="modern-key">
                {num}
              </button>
            ))}
            <button onClick={() => handleKeyPress('C')} className="modern-key special clear">
              C
            </button>
            <button onClick={() => handleKeyPress('0')} className="modern-key">
              0
            </button>
            <button onClick={() => handleKeyPress('BACK')} className="modern-key special">
              <Delete size={24} />
            </button>
          </div>

          <div className="modern-biometrics-footer">
            {config.security?.allowBiometrics && isHardwareAvailable ? (
              <button
                onClick={handleBiometricLogin}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 transition-all ${
                  biometricError
                    ? 'bg-red-400/10 text-red-400'
                    : 'text-slate-500 hover:bg-blue-400/10 hover:text-blue-400'
                }`}
              >
                <Fingerprint size={16} />
                <span className="modern-biometrics-text">{loginFooterText}</span>
              </button>
            ) : (
              <p className="modern-biometrics-text italic">{loginFooterText}</p>
            )}

            <div className="mt-6 text-center text-[11px] text-[#6C7F80]">
              <p>{subVertical || 'Terminal'} · {config.terminalName || config.stationNumber || 'POS-001'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModernLoginScreen;
