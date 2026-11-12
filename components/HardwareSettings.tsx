
import React, { useState, useMemo, useEffect } from 'react';
import {
   Printer, ScanBarcode, Bluetooth, RefreshCw, CheckCircle,
   X, Zap, Settings as SettingsIcon, Usb, Network, Plus,
   Monitor, MessageSquare, DollarSign, Scale,
   Save, Info, AlertTriangle, Check, Tv, MonitorPlay, QrCode, Trash2,
   Cable, Radio, MousePointer2, Image as ImageIcon, ArrowLeft,
   Smartphone, Wallet, ShieldCheck, Database, HardDrive, Loader2, Wifi,
   Cpu, Keyboard, Activity, Layers, Activity as Wave, Barcode, Fingerprint,
   Coffee, Truck
} from 'lucide-react';
import { BusinessConfig, Product, CustomerDisplayConfig, ScaleDevice, ScaleTech, PrinterDevice, ConnectionType, ScaleLabelConfig, FingerprintReaderConfig, FingerprintDriver, FingerprintDiscoveredDevice } from '../types';
import { parseScaleBarcodeDetailed } from '../utils/barcodeParser';
import { nativePrintBridge } from '../services/printer/NativePrintBridge';
import { buildEscPosHardwareTestPayload } from '../services/printer/EscPosFormatter';
import { biometricService } from '../services/BiometricAuthService';
import {
   launchCustomerDisplay,
   normalizeCustomerDisplayConfig,
   normalizeCustomerDisplayConnectionType,
   resetCustomerDisplayAutoLaunch,
} from '../utils/customerDisplay';
import { inferMediaType, isValidRemoteMediaUrl } from '../utils/media';

// Perfiles predefinidos de balanzas populares
const SCALE_PRESETS = [
   { id: 'CAS_PD2', brand: 'CAS', model: 'PD-II / ER', baud: 9600, data: 7, parity: 'Even', protocol: 'NCI', icon: '⚖️' },
   { id: 'TOLEDO_8217', brand: 'Toledo', model: 'Mettler 8217', baud: 9600, data: 7, parity: 'Even', protocol: 'Standard', icon: '⚖️' },
   { id: 'DIBAL_G310', brand: 'Dibal', model: 'G-310 / G-325', baud: 9600, data: 8, parity: 'None', protocol: 'Protocolo T', icon: '⚖️' },
   { id: 'BIZERBA', brand: 'Bizerba', model: 'SC-II / BC-II', baud: 9600, data: 8, parity: 'None', protocol: 'Dialog 06', icon: '⚖️' },
   { id: 'ISHIDA', brand: 'Ishida', model: 'Uni-7 / Uni-5', baud: 9600, data: 8, parity: 'None', protocol: 'Standard', icon: '⚖️' },
   { id: 'MANUAL', brand: 'Genérica', model: 'Configuración Manual', baud: 9600, data: 8, parity: 'None', protocol: 'NCI', icon: '⚙️' },
];

const DEFAULT_DISPLAY_CONFIG: CustomerDisplayConfig = {
   isEnabled: true,
   welcomeMessage: '¡Bienvenido a Alfa POS!',
   showItemImages: true,
   showQrPayment: true,
   layout: 'SPLIT',
   connectionType: 'ANDROID_SECONDARY',
   ads: [
      { id: 'ad1', type: 'IMAGE', url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=600&auto=format&fit=crop', active: true },
      { id: 'ad2', type: 'IMAGE', url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=600&auto=format&fit=crop', active: true }
   ]
};

const MOCK_DISCOVERY: Record<string, Partial<PrinterDevice>[]> = {
   'BLUETOOTH': [{ name: 'Star mPOP (BT)', address: '00:11:22:33:44:55' }],
   'USB': [{ name: 'Epson TM-T88VI (USB)', address: 'USB_PORT_001' }],
   'NETWORK': [{ name: 'Impresora Cocina 1', address: '192.168.1.50' }]
};

const DEFAULT_FINGERPRINT_READER_CONFIG: FingerprintReaderConfig = {
   isEnabled: false,
   connectionType: 'USB',
   port: 'USB_AUTO',
   driver: 'AUTO',
   notes: ''
};

const FINGERPRINT_DRIVER_OPTIONS: { id: FingerprintDriver; label: string; helper: string }[] = [
   { id: 'AUTO', label: 'Auto detectar', helper: 'Recomendado para la mayoría de cajas POS.' },
   { id: 'WEBAUTHN', label: 'Biometría integrada / WebAuthn', helper: 'Para huella integrada del equipo o navegador compatible.' },
   { id: 'DIGITAL_PERSONA', label: 'DigitalPersona / HID', helper: 'Muy común en lectores USB de mostrador.' },
   { id: 'SECUGEN', label: 'SecuGen', helper: 'Lectores USB y SDK de retail.' },
   { id: 'ZKTECO', label: 'ZKTeco', helper: 'Usado en terminales POS y control de acceso.' },
   { id: 'SUPREMA', label: 'Suprema', helper: 'Dispositivos BioMini y lectores corporativos.' },
   { id: 'FUTRONIC', label: 'Futronic', helper: 'Lectores FS80/FS88 en Windows y Android integrados.' },
   { id: 'NITGEN', label: 'Nitgen', helper: 'Lectores HAMSTER y líneas compatibles.' }
];

const FINGERPRINT_CONNECTION_OPTIONS: { id: FingerprintReaderConfig['connectionType']; label: string; icon: React.ElementType; helper: string }[] = [
   { id: 'USB', label: 'USB', icon: Usb, helper: 'La más común en POS Android y Windows.' },
   { id: 'SERIAL', label: 'Serie / COM', icon: Cable, helper: 'Para lectores industriales RS-232.' },
   { id: 'NETWORK', label: 'Red IP', icon: Wifi, helper: 'Solo si el lector expone servicio por red.' }
];

const PRINTER_ROLE_OPTIONS: Array<{
   id: string;
   label: string;
   helper: string;
   type: PrinterDevice['type'];
   icon: React.ElementType;
}> = [
   { id: 'GENERAL', label: 'General / Caja', helper: 'Tickets y recibos de venta', type: 'TICKET', icon: Printer },
   { id: 'LABEL', label: 'Etiquetas / Label', helper: 'Etiquetas de artículos y góndola', type: 'LABEL', icon: Barcode },
   { id: 'COCINA', label: 'Cocina / KDS', helper: 'Comandas para cocina', type: 'KITCHEN', icon: MonitorPlay },
   { id: 'BAR', label: 'Bar / Bebidas', helper: 'Comandas de barra', type: 'KITCHEN', icon: Coffee },
   { id: 'LOGISTICS', label: 'Logística / Delivery', helper: 'Despacho y entregas', type: 'LOGISTICS', icon: Truck }
];

const resolvePrinterRoleId = (printer: Partial<PrinterDevice>): string => {
   if (printer.type === 'LABEL') return 'LABEL';
   if (printer.type === 'LOGISTICS') return 'LOGISTICS';
   if (printer.productionAreaId) return printer.productionAreaId;
   return printer.type === 'KITCHEN' ? 'COCINA' : 'GENERAL';
};


interface HardwareSettingsProps {
   config: BusinessConfig;
   products: Product[];
   onUpdateConfig: (cfg: BusinessConfig) => void | Promise<void>;
   onClose: () => void;
   terminalId?: string;
}

type HardwareTab = 'PERIPHERALS' | 'SCALES' | 'DISPLAY' | 'CASHDRO' | 'LABELS' | 'FINGERPRINT';

const HardwareSettings: React.FC<HardwareSettingsProps> = ({ config: globalConfig, products, onUpdateConfig, onClose, terminalId }) => {
   const [activeTab, setActiveTab] = useState<HardwareTab>('PERIPHERALS');

   // -- Local State synced with Config --
   const [scales, setScales] = useState<ScaleDevice[]>(globalConfig.scales || []);
   const [printers, setPrinters] = useState<PrinterDevice[]>(globalConfig.availablePrinters || []);
   const [editingScale, setEditingScale] = useState<ScaleDevice | null>(null);

   // -- Discovery State --
   const [isScanning, setIsScanning] = useState<ConnectionType | null>(null);
   const [isDiscoveryLoading, setIsDiscoveryLoading] = useState(false);
   const [discoveryNotice, setDiscoveryNotice] = useState<string | null>(null);
   const [discoveredDevices, setDiscoveredDevices] = useState<Partial<PrinterDevice>[]>([]);
   const [isManualMode, setIsManualMode] = useState(false);
   const [manualData, setManualData] = useState({ name: '', address: '' });
   const [manualTestResult, setManualTestResult] = useState<{ success: boolean; message: string } | null>(null);
   const [testingPrinterId, setTestingPrinterId] = useState<string | null>(null);
   const [printerTestFeedback, setPrinterTestFeedback] = useState<Record<string, { success: boolean; message: string }>>({});
   const [isSavingHardware, setIsSavingHardware] = useState(false);
   const [hardwareSaveFeedback, setHardwareSaveFeedback] = useState<{ success: boolean; message: string } | null>(null);

   // -- Customer Display State --
   const currentTerminalConfig = useMemo(() => {
      // If terminalId is provided, look it up. Otherwise fallback to first terminal or default.
      if (terminalId) {
         return globalConfig.terminals?.find(t => t.id === terminalId) || globalConfig.terminals?.[0];
      }
      return globalConfig.terminals?.[0];
   }, [globalConfig.terminals, terminalId]);

   const [displayConfig, setDisplayConfig] = useState<CustomerDisplayConfig>(
      normalizeCustomerDisplayConfig(currentTerminalConfig?.config?.hardware?.customerDisplay || DEFAULT_DISPLAY_CONFIG)
   );
   const [displayLaunchFeedback, setDisplayLaunchFeedback] = useState<string | null>(null);
   const [isLaunchingDisplay, setIsLaunchingDisplay] = useState(false);
   const [allowBiometrics, setAllowBiometrics] = useState<boolean>(
      currentTerminalConfig?.config?.security?.allowBiometrics || false
   );
   const [fingerprintReader, setFingerprintReader] = useState<FingerprintReaderConfig>(
      currentTerminalConfig?.config?.hardware?.fingerprintReader || DEFAULT_FINGERPRINT_READER_CONFIG
   );
   const [biometricAvailable, setBiometricAvailable] = useState(false);
   const [biometricChecking, setBiometricChecking] = useState(true);
   const [fpDiscovered, setFpDiscovered] = useState<FingerprintDiscoveredDevice[]>([]);
   const [fpScanning, setFpScanning] = useState(false);
   const [fpNotice, setFpNotice] = useState<string | null>(null);
   const [fpTestFeedback, setFpTestFeedback] = useState<{ ok: boolean; message: string } | null>(null);
   const [previewMode, setPreviewMode] = useState<'IDLE' | 'CHECKOUT'>('CHECKOUT');
   const [currentPreviewAdIndex, setCurrentPreviewAdIndex] = useState(0);

   // Auto-rotate preview ads in IDLE mode
   useEffect(() => {
      if (previewMode === 'IDLE' && displayConfig.ads && displayConfig.ads.length > 1) {
         const interval = setInterval(() => {
            setCurrentPreviewAdIndex(prev => (prev + 1) % displayConfig.ads.length);
         }, 3000); // Faster rotation for preview (3s)
         return () => clearInterval(interval);
      } else {
         setCurrentPreviewAdIndex(0);
      }
   }, [previewMode, displayConfig.ads?.length]);

   useEffect(() => {
      setDisplayConfig(normalizeCustomerDisplayConfig(currentTerminalConfig?.config?.hardware?.customerDisplay || DEFAULT_DISPLAY_CONFIG));
      setDisplayLaunchFeedback(null);
   }, [currentTerminalConfig?.config?.hardware?.customerDisplay]);

   useEffect(() => {
      setAllowBiometrics(currentTerminalConfig?.config?.security?.allowBiometrics || false);
   }, [currentTerminalConfig?.config?.security?.allowBiometrics]);

   useEffect(() => {
      setFingerprintReader(currentTerminalConfig?.config?.hardware?.fingerprintReader || DEFAULT_FINGERPRINT_READER_CONFIG);
   }, [currentTerminalConfig?.config?.hardware?.fingerprintReader]);

   useEffect(() => {
      let mounted = true;

      const checkBiometricAvailability = async () => {
         setBiometricChecking(true);
         try {
            const available = await biometricService.isAvailable();
            if (mounted) {
               setBiometricAvailable(available);
            }
         } catch (error) {
            console.warn('No se pudo validar la disponibilidad biométrica:', error);
            if (mounted) {
               setBiometricAvailable(false);
            }
         } finally {
            if (mounted) {
               setBiometricChecking(false);
            }
         }
      };

      void checkBiometricAvailability();
      return () => { mounted = false; };
   }, []);

   const handleDiscoverFingerprintReaders = async () => {
      setFpScanning(true);
      setFpNotice(null);
      setFpTestFeedback(null);
      try {
         if (!nativePrintBridge.supportsFingerprintDiscovery()) {
            setFpNotice('La detección automática de lectores requiere la app Android Alfa POS con el bridge nativo actualizado.');
            setFpDiscovered([]);
            return;
         }
         const found = await nativePrintBridge.discoverFingerprintReaders('USB');
         setFpDiscovered(found);
         if (found.length === 0) {
            setFpNotice('No se encontraron lectores USB candidatos (HID/vendor típico). Revise cable u OTG, o use el puerto manual.');
         } else {
            setFpNotice(`${found.length} dispositivo(s) encontrado(s). Pulse «Usar» para cargar el puerto o «Probar» para validar permiso USB.`);
         }
      } catch (error) {
         setFpNotice(error instanceof Error ? error.message : 'Error al buscar lectores USB.');
         setFpDiscovered([]);
      } finally {
         setFpScanning(false);
      }
   };

   const handleTestFingerprintDevice = async (device?: FingerprintDiscoveredDevice) => {
      setFpTestFeedback(null);
      const addr = device?.address?.trim() || fingerprintReader.port?.trim();
      const id = device?.id?.trim() || '';
      if (!addr && !id) {
         setFpTestFeedback({ ok: false, message: 'Indique un puerto, seleccione un dispositivo detectado o use «Usar» primero.' });
         return;
      }
      const result = await nativePrintBridge.testFingerprintReader({
         address: addr || undefined,
         id: id || undefined,
         connection: 'USB'
      });
      const ok = result.status === 'ONLINE' && result.captured;
      setFpTestFeedback({
         ok,
         message: result.message
      });
   };

   useEffect(() => {
      let cancelled = false;

      const prefillUsbPort = async () => {
         if (!isManualMode || isScanning !== 'USB') return;
         if (manualData.address.trim()) return;

         const detected = await nativePrintBridge.discoverPrinters('USB');
         if (cancelled || detected.length === 0) {
            setDiscoveryNotice(prev => prev || 'No se detectó automáticamente un puerto USB. Revise cable, OTG y energía de la impresora.');
            return;
         }

         const first = detected[0];
         setManualData(prev => ({
            name: prev.name || first.name || 'Impresora USB',
            address: prev.address || first.address || ''
         }));
         setDiscoveryNotice(`Puerto USB detectado automáticamente: ${first.address || first.name}`);
      };

      prefillUsbPort();
      return () => { cancelled = true; };
   }, [isManualMode, isScanning, manualData.address]);

   // -- Scale Label State --
   const [scaleLabelConfig, setScaleLabelConfig] = useState<ScaleLabelConfig>(globalConfig.scaleLabelConfig || {
      isEnabled: false,
      prefixes: ['20'],
      structure: {
         totalLength: 13,
         prefixLength: 2,
         pluStart: 2,
         pluLength: 5,
         valueStart: 7,
         valueLength: 5,
         checksumLength: 1
      },
      valueType: 'WEIGHT',
      decimals: 3
   });
   const [testBarcode, setTestBarcode] = useState('');
   const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

   const selectedTerminalId = terminalId || globalConfig.terminals?.[0]?.id || 'T1';
   const normalizedTestBarcode = testBarcode.replace(/\D/g, '');
   const buildScalePreviewSegments = () => {
      const totalLength = Math.max(1, scaleLabelConfig.structure.totalLength || 13);
      const samplePrefix = scaleLabelConfig.prefixes[0] || '20';
      const sample = (normalizedTestBarcode || `${samplePrefix}1234501234`).padEnd(totalLength, '0').slice(0, totalLength);
      const segment = (start: number, length: number) => sample.slice(Math.max(0, start), Math.max(0, start + length));
      const prefixLength = scaleLabelConfig.structure.prefixLength || samplePrefix.length || 2;
      const pluStart = scaleLabelConfig.structure.pluStart || prefixLength;
      const pluLength = scaleLabelConfig.structure.pluLength || 5;
      const valueStart = scaleLabelConfig.structure.valueStart || pluStart + pluLength;
      const valueLength = scaleLabelConfig.structure.valueLength || 5;
      const checksumStart = Math.max(prefixLength, pluStart + pluLength, valueStart + valueLength);

      return [
         { label: 'Prefijo', value: segment(0, prefixLength), className: 'bg-purple-100 text-purple-700 border-purple-200' },
         { label: 'PLU', value: segment(pluStart, pluLength), className: 'bg-blue-100 text-blue-700 border-blue-200' },
         { label: scaleLabelConfig.valueType === 'WEIGHT' ? 'Peso' : 'Precio', value: segment(valueStart, valueLength), className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
         { label: 'Check', value: sample.slice(checksumStart) || '-', className: 'bg-slate-100 text-slate-600 border-slate-200' }
      ];
   };

   // --- ACTIONS ---

   const createNewScale = () => {
      setEditingScale({
         id: `scale_${Date.now()}`,
         name: 'Nueva Balanza',
         isEnabled: true,
         technology: 'DIRECT',
         directConfig: {
            port: 'COM1',
            baudRate: 9600,
            dataBits: 8,
            protocol: 'NCI'
         }
      });
   };

   const handleApplyPreset = (preset: typeof SCALE_PRESETS[0]) => {
      if (!editingScale) return;
      setEditingScale({
         ...editingScale,
         name: preset.id === 'MANUAL' ? editingScale.name : `${preset.brand} ${preset.model}`,
         directConfig: {
            port: editingScale.directConfig?.port || 'COM1',
            baudRate: preset.baud,
            dataBits: preset.data,
            protocol: preset.protocol
         }
      });
   };

   const handleDeleteScale = async (id: string) => {
      if (await clicConfirm('¿Eliminar esta balanza?')) {
         setScales(scales.filter(s => s.id !== id));
      }
   };

   const launchConfiguredCustomerDisplay = async (nextConfig: CustomerDisplayConfig = displayConfig) => {
      const normalizedConfig = normalizeCustomerDisplayConfig(nextConfig);
      const connectionType = normalizeCustomerDisplayConnectionType(normalizedConfig.connectionType);

      if (!normalizedConfig.isEnabled) {
         setDisplayLaunchFeedback('Activa el visor para lanzar una segunda pantalla.');
         return null;
      }

      if (connectionType === 'NETWORK' && !normalizedConfig.ipAddress?.trim()) {
         setDisplayLaunchFeedback('Indica la IP o URL del visor remoto para abrir la vista del cliente.');
         return null;
      }

      setIsLaunchingDisplay(true);
      setDisplayLaunchFeedback(null);

      try {
         resetCustomerDisplayAutoLaunch(selectedTerminalId);
         const launched = await launchCustomerDisplay(normalizedConfig, { contextKey: selectedTerminalId });
         const displayLabel = launched.mode === 'NETWORK'
            ? 'remoto'
            : launched.mode === 'ANDROID_SECONDARY'
               ? 'integrado de Android'
               : launched.mode === 'USB'
                  ? 'USB / DisplayLink'
                  : 'HDMI';
         setDisplayLaunchFeedback(
            launched.mode === 'NETWORK'
               ? `Visor remoto abierto en ${launched.url}.`
               : launched.usedSecondScreen
                  ? `Visor lanzado automáticamente en la pantalla secundaria ${displayLabel}.`
                  : 'Visor lanzado. Si no cambió de pantalla, el sistema abrió la vista sin detectar una secundaria disponible.',
         );
         return launched;
      } catch (error) {
         const message = error instanceof Error ? error.message : 'No se pudo lanzar el visor del cliente.';
         setDisplayLaunchFeedback(message);
         return null;
      } finally {
         setIsLaunchingDisplay(false);
      }
   };

   const handleSaveAllHardware = async () => {
      if (isSavingHardware) return;

      setIsSavingHardware(true);
      setHardwareSaveFeedback(null);
      const normalizedDisplayConfig = normalizeCustomerDisplayConfig(displayConfig);
      const newConfig = { ...globalConfig, scales, availablePrinters: printers, scaleLabelConfig };
      if (newConfig.terminals) {
         // Update the specific terminal config
         newConfig.terminals = newConfig.terminals.map(t => {
            if (t.id === selectedTerminalId) {
               return {
                  ...t,
                  config: {
                     ...t.config,
                     hardware: {
                        ...t.config.hardware,
                        customerDisplay: normalizedDisplayConfig,
                        fingerprintReader
                     },
                     security: {
                        ...t.config.security,
                        allowBiometrics
                     }
                  }
               };
            }
            return t;
         });
      }

      try {
         await onUpdateConfig(newConfig);
         setHardwareSaveFeedback({ success: true, message: 'Configuración de hardware guardada correctamente.' });
      } catch (error) {
         const message = error instanceof Error ? error.message : 'No se pudo guardar la configuración de hardware.';
         setHardwareSaveFeedback({ success: false, message });
      } finally {
         setIsSavingHardware(false);
      }
   };

   const renderFingerprintSettings = () => {
      const biometricRuntime = nativePrintBridge.getRuntime();
      const secureContextReady = window.isSecureContext || window.location.hostname === 'localhost';
      const driverMeta = FINGERPRINT_DRIVER_OPTIONS.find(option => option.id === fingerprintReader.driver);
      const connectionMeta = FINGERPRINT_CONNECTION_OPTIONS.find(option => option.id === fingerprintReader.connectionType);
      const hardwareReady = allowBiometrics && fingerprintReader.isEnabled;

      return (
         <div className="bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-sm animate-in slide-in-from-right-4">
            <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-50">
               <div>
                  <h3 className="text-xl font-black text-slate-800 flex items-center gap-3">
                     <Fingerprint className="text-cyan-600" />
                     Detector de Huella
                  </h3>
                  <p className="text-xs text-slate-400 font-medium">
                     Controla si esta terminal puede usar autenticación biométrica y valida la compatibilidad del dispositivo actual.
                  </p>
               </div>
               <label className="relative inline-flex items-center cursor-pointer">
                  <input
                     type="checkbox"
                     checked={allowBiometrics}
                     onChange={(e) => setAllowBiometrics(e.target.checked)}
                     className="sr-only peer"
                  />
                  <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-cyan-600"></div>
               </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
               <div className="p-5 rounded-3xl border border-slate-200 bg-slate-50">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">Estado del Detector</p>
                  <div className="flex items-center gap-3">
                     <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${biometricAvailable ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                        <Fingerprint size={22} />
                     </div>
                     <div>
                        <p className="text-sm font-black text-slate-800">
                           {biometricChecking ? 'Verificando...' : biometricAvailable ? 'Disponible' : 'No detectado'}
                        </p>
                        <p className="text-xs text-slate-500">Compatibilidad del dispositivo actual</p>
                     </div>
                  </div>
               </div>

               <div className="p-5 rounded-3xl border border-slate-200 bg-slate-50">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">Runtime</p>
                  <p className="text-lg font-black text-slate-800">{biometricRuntime}</p>
                  <p className="text-xs text-slate-500 mt-1">Usado para interpretar el soporte del equipo actual.</p>
               </div>

               <div className="p-5 rounded-3xl border border-slate-200 bg-slate-50">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">Entorno Seguro</p>
                  <p className={`text-lg font-black ${secureContextReady ? 'text-emerald-600' : 'text-amber-600'}`}>
                     {secureContextReady ? 'Listo' : 'Requerido'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">WebAuthn necesita HTTPS o localhost para funcionar correctamente.</p>
               </div>
            </div>

            <div className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
               <div className="flex flex-col gap-6">
                  <div className="flex items-start justify-between gap-4">
                     <div>
                        <p className="text-sm font-black text-slate-900">Lector de huella externo</p>
                        <p className="text-xs text-slate-500 mt-1">
                           Configura cómo se conectará el lector en la terminal. En la mayoría de POS Android el puerto recomendado es USB.
                        </p>
                     </div>
                     <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                           type="checkbox"
                           checked={fingerprintReader.isEnabled}
                           onChange={(e) => setFingerprintReader(prev => ({ ...prev, isEnabled: e.target.checked }))}
                           className="sr-only peer"
                        />
                        <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-blue-600"></div>
                     </label>
                  </div>

                  <div className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50/90 to-white p-5 space-y-4 shadow-sm">
                     <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                           <p className="text-sm font-black text-slate-900">Detección automática (USB)</p>
                           <p className="text-xs text-slate-600 mt-1">
                              Misma ruta nativa que impresoras: el APK enumera USB y permite probar apertura del dispositivo (permiso OTG).
                           </p>
                        </div>
                        <button
                           type="button"
                           disabled={fpScanning || !nativePrintBridge.supportsFingerprintDiscovery()}
                           onClick={() => void handleDiscoverFingerprintReaders()}
                           className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-45 disabled:pointer-events-none text-white font-bold text-sm shadow-md shadow-cyan-600/20"
                        >
                           {fpScanning ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                           Buscar lectores USB
                        </button>
                     </div>
                     {!nativePrintBridge.supportsFingerprintDiscovery() && (
                        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3 leading-relaxed">
                           El bridge actual no expone <span className="font-mono">discoverFingerprintReaders</span>. Actualice la APK o configure el puerto manualmente abajo.
                        </p>
                     )}
                     {fpNotice && (
                        <p className="text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">{fpNotice}</p>
                     )}
                     {fpDiscovered.length > 0 && (
                        <div className="space-y-2">
                           {fpDiscovered.map(d => (
                              <div
                                 key={d.id}
                                 className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-white border border-slate-200"
                              >
                                 <div className="min-w-0">
                                    <p className="text-sm font-bold text-slate-900 truncate">{d.name}</p>
                                    <p className="text-[11px] font-mono text-slate-500 truncate">
                                       {d.address}
                                       {typeof d.vendorId === 'number' && typeof d.productId === 'number'
                                          ? ` · VID ${d.vendorId} · PID ${d.productId}`
                                          : ''}
                                    </p>
                                 </div>
                                 <div className="flex flex-wrap gap-2 shrink-0">
                                    <button
                                       type="button"
                                       onClick={() => {
                                          setFingerprintReader(prev => ({
                                             ...prev,
                                             connectionType: 'USB',
                                             port: d.address,
                                             isEnabled: true
                                          }));
                                          setFpNotice(`Puerto aplicado: ${d.address}`);
                                       }}
                                       className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                                    >
                                       Usar
                                    </button>
                                    <button
                                       type="button"
                                       onClick={() => void handleTestFingerprintDevice(d)}
                                       className="px-3 py-1.5 rounded-lg border border-cyan-300 text-cyan-800 text-xs font-bold hover:bg-cyan-50"
                                    >
                                       Probar
                                    </button>
                                 </div>
                              </div>
                           ))}
                        </div>
                     )}
                     <div className="flex flex-wrap items-center gap-3">
                        <button
                           type="button"
                           onClick={() => void handleTestFingerprintDevice()}
                           className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-slate-200 text-slate-800 text-xs font-bold hover:bg-slate-50"
                        >
                           <Activity size={16} />
                           Probar puerto / ID actual
                        </button>
                        {fpTestFeedback && (
                           <span className={`text-xs font-bold ${fpTestFeedback.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                              {fpTestFeedback.message}
                           </span>
                        )}
                     </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     {FINGERPRINT_CONNECTION_OPTIONS.map(option => (
                        <button
                           key={option.id}
                           type="button"
                           onClick={() => setFingerprintReader(prev => ({
                              ...prev,
                              connectionType: option.id,
                              port: prev.connectionType === option.id
                                 ? prev.port
                                 : option.id === 'USB'
                                    ? 'USB_AUTO'
                                    : option.id === 'SERIAL'
                                       ? 'COM1'
                                       : '192.168.1.120:5000'
                           }))}
                           className={`rounded-3xl border-2 p-5 text-left transition-all ${
                              fingerprintReader.connectionType === option.id
                                 ? 'border-blue-500 bg-blue-50 shadow-sm'
                                 : 'border-slate-200 bg-white hover:border-slate-300'
                           }`}
                        >
                           <div className="flex items-center gap-3">
                              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${
                                 fingerprintReader.connectionType === option.id ? 'bg-white text-blue-600' : 'bg-slate-100 text-slate-500'
                              }`}>
                                 <option.icon size={20} />
                              </div>
                              <div>
                                 <p className="text-sm font-black text-slate-800">{option.label}</p>
                                 <p className="text-[11px] text-slate-500 leading-relaxed">{option.helper}</p>
                              </div>
                           </div>
                        </button>
                     ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Puerto / Dirección</label>
                        <div className="relative">
                           <input
                              type="text"
                              value={fingerprintReader.port}
                              onChange={(e) => setFingerprintReader(prev => ({ ...prev, port: e.target.value }))}
                              placeholder={fingerprintReader.connectionType === 'NETWORK' ? '192.168.1.120:5000' : fingerprintReader.connectionType === 'SERIAL' ? 'COM1 o /dev/ttyS1' : 'USB_AUTO o /dev/bus/usb/001/002'}
                              className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-mono font-bold text-slate-800 focus:bg-white focus:border-blue-400 outline-none transition-all"
                           />
                           <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300">
                              {fingerprintReader.connectionType === 'NETWORK' ? <Wifi size={18} /> : fingerprintReader.connectionType === 'SERIAL' ? <Cable size={18} /> : <Usb size={18} />}
                           </div>
                        </div>
                     </div>
                     <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Driver / SDK</label>
                        <select
                           value={fingerprintReader.driver}
                           onChange={(e) => setFingerprintReader(prev => ({ ...prev, driver: e.target.value as FingerprintDriver }))}
                           className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-bold text-slate-800 outline-none focus:bg-white focus:border-blue-400"
                        >
                           {FINGERPRINT_DRIVER_OPTIONS.map(option => (
                              <option key={option.id} value={option.id}>{option.label}</option>
                           ))}
                        </select>
                        <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">{driverMeta?.helper}</p>
                     </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Configuración activa</p>
                        <p className={`text-sm font-black ${hardwareReady ? 'text-emerald-600' : 'text-slate-600'}`}>
                           {hardwareReady ? 'Lista para la terminal' : 'Pendiente de habilitar'}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                           {connectionMeta?.label} • {fingerprintReader.port || 'Sin puerto'} • {driverMeta?.label}
                        </p>
                     </div>
                     <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600 mb-2">Nota operativa</p>
                        <p className="text-xs text-amber-800 leading-relaxed">
                           Esta configuración deja preparado el lector externo. La autenticación del navegador sigue dependiendo de WebAuthn o del bridge nativo/SDK instalado en el equipo.
                        </p>
                     </div>
                  </div>

                  <div>
                     <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Observaciones técnicas</label>
                     <textarea
                        value={fingerprintReader.notes || ''}
                        onChange={(e) => setFingerprintReader(prev => ({ ...prev, notes: e.target.value }))}
                        placeholder="Ej. Lector DigitalPersona USB frontal. Requiere OTG y servicio nativo activo."
                        className="w-full min-h-[96px] p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-medium text-slate-700 focus:bg-white focus:border-blue-400 outline-none transition-all resize-none"
                     />
                  </div>
               </div>
            </div>

            <div className="mt-6 rounded-[2rem] border border-cyan-100 bg-cyan-50 p-6">
               <div className="flex items-start gap-4">
                  <div className="w-12 h-12 shrink-0 rounded-2xl bg-white text-cyan-600 border border-cyan-100 flex items-center justify-center">
                     <ShieldCheck size={22} />
                  </div>
                  <div className="space-y-2">
                     <p className="text-sm font-black text-cyan-900">Autenticación biométrica para la terminal</p>
                     <p className="text-sm text-cyan-800 leading-relaxed">
                        Al habilitar esta opción, la terminal permitirá login por huella donde el dispositivo y el navegador lo soporten.
                     </p>
                     <p className="text-xs font-semibold text-cyan-700">
                        Nota: la disponibilidad mostrada arriba corresponde al dispositivo actual desde el que estás abriendo esta pantalla.
                     </p>
                  </div>
               </div>
            </div>
         </div>
      );
   };

   const handleSaveScale = () => {
      if (!editingScale) return;
      const newScales = scales.some(s => s.id === editingScale.id)
         ? scales.map(s => s.id === editingScale.id ? editingScale : s)
         : [...scales, editingScale];

      setScales(newScales);
      setEditingScale(null);
   };

   const handleStartDiscovery = async (type: ConnectionType) => {
      setIsScanning(type);
      setIsDiscoveryLoading(true);
      setDiscoveryNotice(null);
      setIsManualMode(false);
      setManualData({ name: '', address: '' });
      setManualTestResult(null);
      setDiscoveredDevices([]);

      const runtime = nativePrintBridge.getRuntime();
      const isNativeRuntime = runtime === 'ANDROID' || runtime === 'ELECTRON' || runtime === 'WINDOWS';

      if (nativePrintBridge.supportsPeripheralBinding()) {
         try {
            const nativeDevices = await nativePrintBridge.discoverPrinters(type);
            setDiscoveredDevices(nativeDevices);
            if (nativeDevices.length === 0) {
               if (runtime === 'ANDROID' && type === 'USB') {
                  setDiscoveryNotice('No se detectó una impresora USB conectada. Revise cable, OTG, permisos y energía del equipo.');
               } else if (runtime === 'ANDROID' && type === 'NETWORK') {
                  setDiscoveryNotice('La búsqueda automática por red no está disponible en APK. Use configuración manual para IP y puerto.');
               } else if (runtime === 'ANDROID') {
                  setDiscoveryNotice('No se encontraron impresoras Bluetooth vinculadas en Android.');
               } else {
                  setDiscoveryNotice(`No se encontraron impresoras ${type.toLowerCase()}.`);
               }
            }
            setIsDiscoveryLoading(false);
            return;
         } catch (error) {
            console.warn('Native printer discovery failed, using local fallback:', error);
            if (isNativeRuntime) {
               setDiscoveryNotice(error instanceof Error ? error.message : 'No se pudo completar el reconocimiento nativo.');
               setIsDiscoveryLoading(false);
               return;
            }
         }
      }

      setTimeout(() => {
         setDiscoveredDevices(MOCK_DISCOVERY[type] || []);
         setDiscoveryNotice('Modo demostración: mostrando dispositivos simulados.');
         setIsDiscoveryLoading(false);
      }, 1500);
   };

   const resolveUsbAddress = async () => {
      const detected = await nativePrintBridge.discoverPrinters('USB');
      if (detected.length === 0) {
         return null;
      }

      const first = detected[0];
      setManualData(prev => ({
         name: prev.name || first.name || 'Impresora USB',
         address: prev.address || first.address || ''
      }));
      return first.address || null;
   };

   const buildPrinterTestHtml = (printer: Partial<PrinterDevice>) => `
      <!DOCTYPE html>
      <html>
      <head>
         <meta charset="utf-8" />
         <style>
            body { font-family: monospace; width: 72mm; margin: 0 auto; padding: 6mm; color: #111; }
            h1 { font-size: 18px; margin: 0 0 8px; text-align: center; }
            .row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
            .divider { border-top: 1px dashed #222; margin: 10px 0; }
            .center { text-align: center; }
         </style>
      </head>
      <body>
         <h1>ALFA POS</h1>
         <div class="center">Ticket de prueba de impresora</div>
         <div class="divider"></div>
         <div class="row"><span>Impresora</span><strong>${printer.name || 'Sin nombre'}</strong></div>
         <div class="row"><span>Conexión</span><strong>${printer.connection || 'N/D'}</strong></div>
         <div class="row"><span>Puerto / Dirección</span><strong>${printer.address || 'N/D'}</strong></div>
         <div class="row"><span>Fecha</span><strong>${new Date().toLocaleString()}</strong></div>
         <div class="divider"></div>
         <div class="center">Si este ticket salió impreso, la conexión está operativa.</div>
      </body>
      </html>
   `;

   const handlePairPrinter = async (dev: Partial<PrinterDevice>) => {
      const detectedConnection = isScanning || dev.connection || 'BLUETOOTH';
      let generatedId = dev.id || `prn_${Date.now()}`;

      if (nativePrintBridge.supportsPeripheralBinding()) {
         const paired = await nativePrintBridge.pairPrinter({
            id: dev.id,
            name: dev.name || 'Impresora',
            connection: detectedConnection,
            address: dev.address,
            type: (dev.type as any) || 'TICKET'
         });
         if (paired?.id) generatedId = paired.id;
      }

      const newPrinter: PrinterDevice = {
         id: generatedId,
         name: dev.name || 'Impresora',
         connection: detectedConnection,
         address: dev.address,
         status: 'CONNECTED',
         type: (dev.type as any) || 'TICKET'
      };
      setPrinters([...printers, newPrinter]);
      setIsScanning(null);
      setIsDiscoveryLoading(false);
      setManualTestResult(null);
   };

   const handleSaveManualPrinter = async () => {
      let resolvedAddress = manualData.address.trim();
      if (isScanning === 'USB' && !resolvedAddress) {
         resolvedAddress = (await resolveUsbAddress()) || '';
      }

      if (!manualData.name || !resolvedAddress) {
         alert("Por favor completa el nombre y la dirección.");
         return;
      }
      let generatedId = `prn_man_${Date.now()}`;

      if (nativePrintBridge.supportsPeripheralBinding()) {
         const paired = await nativePrintBridge.pairPrinter({
            name: manualData.name,
            connection: isScanning || 'BLUETOOTH',
            address: resolvedAddress,
            type: 'TICKET'
         });
         if (paired?.id) generatedId = paired.id;
      }

      const newPrinter: PrinterDevice = {
         id: generatedId,
         name: manualData.name,
         connection: isScanning || 'BLUETOOTH',
         address: resolvedAddress,
         status: 'CONNECTED',
         type: 'TICKET'
      };
      setPrinters([...printers, newPrinter]);
      setIsScanning(null);
      setIsDiscoveryLoading(false);
      setIsManualMode(false);
      setManualTestResult(null);
   };

   const handleTestPrinter = async (printer: Partial<PrinterDevice>, feedbackKey?: string) => {
      const printerKey = feedbackKey || printer.id || printer.address || printer.name || `printer-${Date.now()}`;
      setTestingPrinterId(printerKey);

      try {
         const printPayload = {
            printerId: printer.id,
            printerName: printer.name,
            printerAddress: printer.address,
            connection: printer.connection,
            role: (printer.type || 'TICKET') as any,
            jobType: 'HARDWARE_TEST',
            referenceId: `test-${printerKey}`
         };
         const printed = String(printer.connection || '').toUpperCase() === 'NETWORK'
            ? await nativePrintBridge.printEscPos({
               ...printPayload,
               dataBase64: buildEscPosHardwareTestPayload({
                  printerName: printer.name,
                  connection: printer.connection,
                  address: printer.address,
                  printedAt: new Date().toLocaleString(),
               }),
            })
            : await nativePrintBridge.printHtml({
               ...printPayload,
               html: buildPrinterTestHtml(printer),
            });

         let success = printed;
         let message = printed
            ? `Se imprimió correctamente el ticket de prueba en ${printer.name || 'la impresora seleccionada'}.`
            : `No se pudo imprimir el ticket de prueba en ${printer.name || 'la impresora seleccionada'}.`;

         if (!printed) {
            const status = await nativePrintBridge.testPrinterConnection({
               id: printer.id,
               name: printer.name,
               address: printer.address,
               connection: printer.connection,
               type: printer.type
            });

            if (status === 'ONLINE') {
               message = `La impresora ${printer.name || 'seleccionada'} responde, pero no aceptó el trabajo de impresión.`;
            }
            success = false;
         }

         setPrinterTestFeedback(prev => ({
            ...prev,
            [printerKey]: { success, message }
         }));

         return { success, message };
      } finally {
         setTestingPrinterId(null);
      }
   };

   const handleTestManualPrinter = async () => {
      let resolvedAddress = manualData.address.trim();
      if (isScanning === 'USB' && !resolvedAddress) {
         resolvedAddress = (await resolveUsbAddress()) || '';
      }

      if (!resolvedAddress) {
         setManualTestResult({ success: false, message: 'No se pudo detectar automáticamente el puerto o dirección para esta impresora.' });
         return;
      }

      const result = await handleTestPrinter({
         id: `manual-${resolvedAddress}`,
         name: manualData.name || 'Impresora manual',
         address: resolvedAddress,
         connection: isScanning || 'BLUETOOTH',
         type: 'TICKET'
      }, 'manual-draft');

      setManualTestResult(result);
   };

   const addAd = async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const url = await clicPrompt("Introduce la URL de la imagen o video publicitario (JPG/PNG/MP4/WebM):");
      if (url && isValidRemoteMediaUrl(url.trim())) {
         const type = inferMediaType(url);
         const posterUrl = type === 'VIDEO'
            ? (await clicPrompt('URL del póster del video (opcional):') || '').trim() || undefined
            : undefined;
         setDisplayConfig(prev => ({
            ...prev,
            ads: [...(prev.ads || []), { id: `ad_${Date.now()}`, type, url: url.trim(), posterUrl, active: true }]
         }));
      } else if (url) {
         alert("Por favor introduce una URL válida");
      }
   };

   const toggleAdActive = (adId: string) => {
      setDisplayConfig(prev => ({
         ...prev,
         ads: (prev.ads || []).map(ad =>
            ad.id === adId ? { ...ad, active: !ad.active } : ad
         )
      }));
   };

   const removeAd = (adId: string) => {
      setDisplayConfig(prev => ({
         ...prev,
         ads: prev.ads.filter(a => a.id !== adId)
      }));
   };

   const renderCustomerDisplay = () => {
      const activeDisplayConnection = normalizeCustomerDisplayConnectionType(displayConfig.connectionType);
      const launchButtonLabel = activeDisplayConnection === 'NETWORK'
         ? 'Lanzar visor por IP'
         : activeDisplayConnection === 'ANDROID_SECONDARY'
            ? 'Lanzar visor en pantalla integrada Android'
            : `Auto detectar y lanzar visor ${activeDisplayConnection === 'USB' ? 'USB' : 'HDMI'}`;

      return (
         <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 pb-32">
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-6">
               <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-200">
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-2xl ${displayConfig.isEnabled ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                           <Tv size={24} />
                        </div>
                        <div>
                           <h3 className="font-bold text-gray-800">Estado del Visor</h3>
                           <p className="text-xs text-gray-500">Muestra precios y publicidad al cliente.</p>
                        </div>
                     </div>
                     <button
                        onClick={() => setDisplayConfig({ ...displayConfig, isEnabled: !displayConfig.isEnabled })}
                        className={`w-14 h-7 rounded-full transition-all relative ${displayConfig.isEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}
                     >
                        <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all shadow-sm ${displayConfig.isEnabled ? 'left-8' : 'left-1'}`} />
                     </button>
                  </div>
                  {displayConfig.isEnabled && (
                     <div className="mt-6 pt-6 border-t border-slate-50">
                        <button
                           onClick={() => void launchConfiguredCustomerDisplay()}
                           className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-slate-800 transition-all shadow-xl active:scale-95 shadow-slate-200"
                           disabled={isLaunchingDisplay}
                        >
                           {isLaunchingDisplay ? <RefreshCw size={20} className="animate-spin" /> : <MonitorPlay size={20} />}
                           {launchButtonLabel}
                        </button>
                        {displayLaunchFeedback && (
                           <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
                              {displayLaunchFeedback}
                           </p>
                        )}
                     </div>
                  )}
               </div>

               <div className={`bg-white p-8 rounded-3xl shadow-sm border border-gray-200 space-y-6 transition-all ${displayConfig.isEnabled ? 'opacity-100' : 'opacity-60 grayscale cursor-not-allowed'}`}>
                  <div>
                     <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Método de Conexión</label>
                     <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        {[
                           { id: 'ANDROID_SECONDARY', label: 'Pantalla integrada Android', icon: Smartphone },
                           { id: 'HDMI', label: 'HDMI', icon: MonitorPlay },
                           { id: 'USB', label: 'USB / DisplayLink', icon: Usb },
                           { id: 'NETWORK', label: 'Tablet por IP', icon: Network },
                        ].map(conn => (
                           <button
                              key={conn.id}
                              onClick={() => setDisplayConfig({ ...displayConfig, connectionType: conn.id as any })}
                              className={`p-4 rounded-2xl border-2 flex items-center gap-3 transition-all ${activeDisplayConnection === conn.id ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm' : 'border-gray-100 text-gray-500 hover:border-gray-200'}`}
                           >
                              <conn.icon size={20} />
                              <span className="text-xs font-bold">{conn.label}</span>
                           </button>
                        ))}
                     </div>
                  </div>

                  {activeDisplayConnection === 'NETWORK' ? (
                     <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-2">IP o URL del visor remoto</label>
                        <input
                           type="text"
                           value={displayConfig.ipAddress || ''}
                           onChange={(e) => setDisplayConfig({ ...displayConfig, ipAddress: e.target.value })}
                           className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 outline-none focus:bg-white focus:ring-2 focus:ring-blue-100"
                           placeholder="Ej. 192.168.1.44:3000 o https://visor.local"
                        />
                        <p className="mt-2 text-xs font-medium text-gray-500">
                           Se abrirá la vista del cliente usando esa dirección y quedará lista para el segundo display remoto.
                        </p>
                     </div>
                  ) : (
                     <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Detección automática</p>
                        <p className="mt-2 text-sm font-medium text-slate-600">
                           {activeDisplayConnection === 'ANDROID_SECONDARY'
                              ? 'El APK usará la detección nativa de Android con DisplayManager / Presentation para abrir el visor en una pantalla secundaria integrada o gestionada por el sistema.'
                              : `El APK intentará detectar una pantalla secundaria conectada por ${activeDisplayConnection === 'USB' ? 'USB / DisplayLink' : 'HDMI'} y mover el visor automáticamente.`}
                        </p>
                     </div>
                  )}

                  <div>
                     <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Mensaje de Bienvenida</label>
                     <input
                        type="text"
                        value={displayConfig.welcomeMessage}
                        onChange={(e) => setDisplayConfig({ ...displayConfig, welcomeMessage: e.target.value })}
                        className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 outline-none focus:bg-white focus:ring-2 focus:ring-blue-100"
                        placeholder="Ej. ¡Gracias por preferirnos!"
                     />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                     <button
                        onClick={() => setDisplayConfig({ ...displayConfig, showItemImages: !displayConfig.showItemImages })}
                        className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${displayConfig.showItemImages ? 'border-blue-500 bg-blue-50' : 'border-gray-100'}`}
                     >
                        <Check size={16} className={displayConfig.showItemImages ? 'text-blue-600' : 'text-transparent'} />
                        <span className="text-xs font-bold text-gray-600">Fotos de Artículos</span>
                     </button>
                     <button
                        onClick={() => setDisplayConfig({ ...displayConfig, showQrPayment: !displayConfig.showQrPayment })}
                        className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${displayConfig.showQrPayment ? 'border-blue-500 bg-blue-50' : 'border-gray-100'}`}
                     >
                        <Check size={16} className={displayConfig.showQrPayment ? 'text-blue-600' : 'text-transparent'} />
                        <span className="text-xs font-bold text-gray-600">QR de Pago</span>
                     </button>
                  </div>
               </div>

               <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-200">
                  <div className="flex justify-between items-center mb-6">
                     <div>
                        <h3 className="font-bold text-gray-800 text-sm uppercase">Anuncios Publicitarios</h3>
                        <p className="text-[10px] text-gray-400 uppercase font-bold mt-0.5">Rotación automática en modo inactivo</p>
                     </div>
                     <button
                        onClick={addAd}
                        className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 active:scale-90 transition-all"
                     >
                        <Plus size={20} />
                     </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                     {(displayConfig.ads || []).map(ad => (
                        <div key={ad.id} className="relative group rounded-2xl overflow-hidden aspect-video border border-gray-200 bg-gray-100">
                           {ad.type === 'VIDEO' ? (
                              <video src={ad.url} poster={ad.posterUrl} className="w-full h-full object-cover" muted playsInline />
                           ) : (
                              <img src={ad.url} className="w-full h-full object-cover" alt="Ad" />
                           )}
                           <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                              <button
                                 onClick={() => toggleAdActive(ad.id)}
                                 className={`p-2.5 rounded-xl text-white transition-all shadow-lg ${ad.active ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'}`}
                                 title={ad.active ? 'Desactivar' : 'Activar'}
                              >
                                 <Monitor size={18} />
                              </button>
                              <button
                                 onClick={() => removeAd(ad.id)}
                                 className="p-2.5 bg-red-600 rounded-xl text-white hover:bg-red-700 transition-all shadow-lg"
                                 title="Eliminar"
                              >
                                 <Trash2 size={18} />
                              </button>
                           </div>
                           {!ad.active && (
                              <div className="absolute top-2 right-2 bg-red-500 text-white text-[8px] font-black px-2 py-1 rounded-full uppercase tracking-tighter shadow-sm">
                                 Inactivo
                              </div>
                           )}
                        </div>
                     ))}
                     {(displayConfig.ads || []).length === 0 && (
                        <div className="col-span-2 py-10 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center text-gray-300">
                           <ImageIcon size={32} className="mb-2 opacity-20" />
                           <p className="text-xs font-bold uppercase tracking-widest">Sin anuncios</p>
                        </div>
                     )}
                  </div>
               </div>
            </div>

            <div className="flex flex-col items-center">
               <div className="flex bg-gray-200 p-1 rounded-2xl mb-8">
                  <button onClick={() => setPreviewMode('CHECKOUT')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${previewMode === 'CHECKOUT' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>Modo Cobro</button>
                  <button onClick={() => setPreviewMode('IDLE')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${previewMode === 'IDLE' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>Modo Inactivo</button>
               </div>

               <div className="relative w-full max-w-lg bg-gray-900 rounded-[3rem] p-5 shadow-2xl border-8 border-gray-800">
                  <div className="bg-white rounded-[2rem] overflow-hidden aspect-[16/10] flex flex-col relative shadow-inner">
                     {previewMode === 'IDLE' ? (
                        <div className="flex-1 flex flex-col">
                           <div className="flex-1 relative overflow-hidden">
                              {displayConfig.ads?.[currentPreviewAdIndex] ? (
                                 displayConfig.ads[currentPreviewAdIndex].type === 'VIDEO' ? (
                                    <video
                                       key={displayConfig.ads[currentPreviewAdIndex].id}
                                       src={displayConfig.ads[currentPreviewAdIndex].url}
                                       poster={displayConfig.ads[currentPreviewAdIndex].posterUrl}
                                       className="w-full h-full object-cover opacity-90"
                                       autoPlay muted loop playsInline
                                    />
                                 ) : (
                                    <img src={displayConfig.ads[currentPreviewAdIndex].url} className="w-full h-full object-cover opacity-90 transition-all duration-500" alt="Ad" />
                                 )
                              ) : (
                                 <div className="w-full h-full bg-slate-100 flex items-center justify-center"><ImageIcon size={48} className="text-slate-200" /></div>
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/20 to-transparent flex flex-col justify-end p-8 text-white text-center">
                                 <h4 className="text-3xl font-black mb-1">{displayConfig.welcomeMessage}</h4>
                                 <p className="text-xs text-blue-400 font-bold uppercase tracking-[0.2em]">Terminal {selectedTerminalId}</p>
                              </div>
                           </div>
                        </div>
                     ) : (
                        <div className="flex-1 flex overflow-hidden">
                           <div className="flex-1 flex flex-col border-r border-gray-100 bg-white p-6">
                              <span className="font-black text-[10px] uppercase text-slate-300 tracking-widest mb-4">Items en Ticket</span>
                              <div className="space-y-4">
                                 <div className="flex gap-4 items-center">
                                    {displayConfig.showItemImages && <div className="w-12 h-12 rounded-xl bg-gray-100 border border-gray-50 shadow-sm" />}
                                    <div className="flex-1"><p className="font-black text-slate-700 text-sm">Zapatillas Runner X</p><p className="text-[10px] text-slate-400 font-bold">CALZADO</p></div>
                                    <div className="text-sm font-black text-slate-900">$2,500.00</div>
                                 </div>
                              </div>
                           </div>
                           <div className="w-40 bg-slate-50 flex flex-col p-6 items-center justify-between text-center border-l border-white shadow-[inset_10px_0_15px_rgba(0,0,0,0.02)]">
                              <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total</p><p className="text-2xl font-black text-slate-900">$2,950.00</p></div>
                              {displayConfig.showQrPayment && (
                                 <div className="p-3 bg-white rounded-2xl shadow-md border border-slate-100">
                                    <QrCode size={48} className="text-slate-800" />
                                 </div>
                              )}
                           </div>
                        </div>
                     )}
                  </div>
                  <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 w-48 h-12 bg-gray-800 rounded-t-[2rem] shadow-lg"></div>
               </div>
            </div>
         </div>
      </div>
   );
   };

   return (
      <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300">
         <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-4">
               <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"><ArrowLeft size={24} /></button>
               <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2"><SettingsIcon className="text-slate-900" /> Hardware & Periféricos</h1>
            </div>
         </div>

         <div className="flex-1 overflow-hidden p-8 flex flex-col">
            <div className="flex flex-wrap gap-2 mb-6 self-start">
               {[
                  { id: 'PERIPHERALS', label: 'Impresoras y Escáneres', icon: Printer },
                  { id: 'SCALES', label: 'Balanzas', icon: Scale },
                  { id: 'LABELS', label: 'Etiquetas', icon: Barcode },
                  { id: 'DISPLAY', label: 'Visor Cliente', icon: Tv },
                  { id: 'FINGERPRINT', label: 'Detector de Huella', icon: Fingerprint },
               ].map(tab => (
                  <button
                     key={tab.id}
                     onClick={() => setActiveTab(tab.id as HardwareTab)}
                     className={`px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all border ${activeTab === tab.id ? 'bg-white text-blue-600 shadow-md border-blue-200' : 'bg-white text-gray-500 border-gray-200 hover:text-gray-700 hover:border-gray-300'
                        }`}
                  >
                     <tab.icon size={16} /> {tab.label}
                  </button>
               ))}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
               {activeTab === 'PERIPHERALS' && (
                  <div className="space-y-6 animate-in slide-in-from-right-4">
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <button onClick={() => handleStartDiscovery('BLUETOOTH')} className="p-6 bg-white border border-gray-200 rounded-3xl flex flex-col items-center gap-3 hover:border-blue-400 hover:shadow-lg transition-all group"><Bluetooth size={32} className="text-blue-500 group-hover:scale-110 transition-transform" /><span className="text-sm font-black uppercase tracking-widest text-slate-700">Bluetooth</span></button>
                        <button onClick={() => handleStartDiscovery('NETWORK')} className="p-6 bg-white border border-gray-200 rounded-3xl flex flex-col items-center gap-3 hover:border-blue-400 hover:shadow-lg transition-all group"><Wifi size={32} className="text-indigo-500 group-hover:scale-110 transition-transform" /><span className="text-sm font-black uppercase tracking-widest text-slate-700">Red IP</span></button>
                        <button onClick={() => handleStartDiscovery('USB')} className="p-6 bg-white border border-gray-200 rounded-3xl flex flex-col items-center gap-3 hover:border-blue-400 hover:shadow-lg transition-all group"><Usb size={32} className="text-slate-600 group-hover:scale-110 transition-transform" /><span className="text-sm font-black uppercase tracking-widest text-slate-700">USB</span></button>
                     </div>
                     {isScanning && (
                        <div className="fixed inset-0 z-[120] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
                           <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl p-10 overflow-hidden">
                              <div className="flex justify-between items-center mb-8 border-b border-slate-50 pb-4">
                                 <h3 className="font-black text-2xl text-slate-800">{isManualMode ? 'Configuración Manual' : 'Buscando...'}</h3>
                                 <button onClick={() => setIsScanning(null)} className="p-2 hover:bg-slate-100 rounded-full"><X size={20} /></button>
                              </div>

                              {isManualMode ? (
                                 <div className="space-y-6 animate-in zoom-in-95">
                                    <div>
                                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Nombre del Dispositivo</label>
                                       <input
                                          type="text"
                                          value={manualData.name}
                                          onChange={e => setManualData({ ...manualData, name: e.target.value })}
                                          placeholder="Ej. Impresora Cocina Central"
                                          className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-bold text-slate-800 focus:bg-white focus:border-blue-400 outline-none transition-all"
                                       />
                                    </div>
                                    <div>
                                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">
                                          {isScanning === 'NETWORK' ? 'Dirección IP Address' : 'Puerto / ID USB'}
                                       </label>
                                       <div className="relative">
                                          <input
                                             type="text"
                                             value={manualData.address}
                                             onChange={e => setManualData({ ...manualData, address: e.target.value })}
                                             placeholder={isScanning === 'NETWORK' ? '192.168.1.100' : 'COM3 o USB001'}
                                             className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-mono font-bold text-slate-800 focus:bg-white focus:border-blue-400 outline-none transition-all"
                                          />
                                          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300">
                                             {isScanning === 'NETWORK' ? <Wifi size={18} /> : <Usb size={18} />}
                                          </div>
                                       </div>
                                    </div>
                                    {manualTestResult && (
                                       <div className={`p-4 rounded-2xl border flex items-center gap-3 ${manualTestResult.success ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                                          {manualTestResult.success ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
                                          <span className="text-sm font-semibold">{manualTestResult.message}</span>
                                       </div>
                                    )}
                                    <div className="flex gap-4 mt-8 pt-4 border-t border-slate-50">
                                       <button onClick={() => setIsManualMode(false)} className="flex-1 py-4 font-black text-slate-400 hover:bg-slate-50 rounded-2xl">Volver al Escaneo</button>
                                       <button onClick={handleTestManualPrinter} className="flex-1 py-4 bg-slate-100 text-slate-700 rounded-[1.5rem] font-black text-sm shadow-sm active:scale-95 transition-all flex items-center justify-center gap-2">
                                          {testingPrinterId === 'manual-draft' ? <Loader2 size={16} className="animate-spin" /> : <Activity size={16} />}
                                          Imprimir prueba
                                       </button>
                                       <button onClick={handleSaveManualPrinter} className="flex-[2] py-4 bg-blue-600 text-white rounded-[1.5rem] font-black text-lg shadow-xl shadow-blue-200 active:scale-95 transition-all">Vincular Manualmente</button>
                                    </div>
                                 </div>
                              ) : (
                                 <>
                                    {isDiscoveryLoading ? (
                                       <div className="py-12 flex flex-col items-center">
                                          <Loader2 className="animate-spin text-blue-500 mb-4" size={56} />
                                          <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">Escaneando puerto {isScanning}...</p>
                                          <button onClick={() => setIsManualMode(true)} className="mt-8 px-6 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-black hover:bg-slate-200 transition-colors flex items-center gap-2">
                                             <Keyboard size={14} /> NO DETECTADO? CONFIGURAR MANUAL
                                          </button>
                                       </div>
                                    ) : discoveredDevices.length === 0 ? (
                                       <div className="py-12 flex flex-col items-center text-center">
                                          <AlertTriangle className="text-amber-500 mb-4" size={56} />
                                          <p className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em]">No se detectaron impresoras {isScanning?.toLowerCase()}</p>
                                          {discoveryNotice && (
                                             <p className="mt-4 max-w-md text-sm font-medium text-slate-500 leading-relaxed">{discoveryNotice}</p>
                                          )}
                                          <div className="mt-8 flex gap-3">
                                             <button onClick={() => isScanning && handleStartDiscovery(isScanning)} className="px-6 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-black hover:bg-slate-200 transition-colors flex items-center gap-2">
                                                <RefreshCw size={14} /> REINTENTAR
                                             </button>
                                             <button onClick={() => setIsManualMode(true)} className="px-6 py-2 bg-blue-600 text-white rounded-xl text-xs font-black hover:bg-blue-700 transition-colors flex items-center gap-2">
                                                <Keyboard size={14} /> CONFIGURAR MANUAL
                                             </button>
                                          </div>
                                       </div>
                                    ) : (
                                       <div className="space-y-3">
                                          {discoveryNotice && (
                                             <div className="px-4 py-3 bg-blue-50 border border-blue-100 rounded-2xl text-sm font-medium text-blue-700">
                                                {discoveryNotice}
                                             </div>
                                          )}
                                          {discoveredDevices.map((dev, i) => (
                                             <div key={i} className="flex justify-between items-center p-5 bg-slate-50 border border-slate-100 rounded-2xl hover:border-blue-300 transition-all group">
                                                <div><p className="font-black text-slate-700">{dev.name}</p><p className="text-[10px] text-slate-400 font-mono">{dev.address}</p></div>
                                                <button onClick={() => handlePairPrinter(dev)} className="px-5 py-2 bg-blue-600 text-white rounded-xl text-xs font-black shadow-lg shadow-blue-200 active:scale-95 transition-all">VINCULAR</button>
                                             </div>
                                          ))}
                                          <div className="mt-6 pt-4 border-t border-slate-50 flex justify-center">
                                             <button onClick={() => setIsManualMode(true)} className="text-blue-500 text-xs font-black hover:underline flex items-center gap-2">
                                                <Keyboard size={14} /> ¿BUSCAS OTRO? AGREGAR MANUALMENTE
                                             </button>
                                          </div>
                                       </div>
                                    )}
                                 </>
                              )}
                           </div>
                        </div>
                     )}
                     <div className="bg-white rounded-3xl border border-gray-200 shadow-sm divide-y divide-slate-50 overflow-hidden">
                        <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                           <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Hardware Activo</h3>
                        </div>
                        {printers.map(p => (
                           <div key={p.id} className="p-5 flex justify-between items-center hover:bg-slate-50/50 group transition-colors">
                              <div className="flex gap-4 items-center">
                                 <div className="p-3 bg-slate-100 rounded-xl text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors"><Printer size={24} /></div>
                                 <div>
                                    <p className="font-black text-slate-800">{p.name}</p>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">{p.connection} • {p.address}</p>
                     {printerTestFeedback[p.id] && (
                                       <p className={`mt-2 text-[11px] font-semibold ${printerTestFeedback[p.id].success ? 'text-green-600' : 'text-red-500'}`}>
                                          {printerTestFeedback[p.id].message}
                                       </p>
                                    )}
                                 </div>
                              </div>
                              <div className="flex items-center gap-4">
                                 <div className="flex flex-col gap-1 min-w-[220px]">
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Tipo / Uso de Impresora</label>
                                    <select
                                       value={resolvePrinterRoleId(p)}
                                       onChange={(e) => {
                                          const selectedRole = PRINTER_ROLE_OPTIONS.find(option => option.id === e.target.value) || PRINTER_ROLE_OPTIONS[0];
                                          const productionAreaId = selectedRole.type === 'KITCHEN' ? selectedRole.id : undefined;
                                          setPrinters(printers.map(x => x.id === p.id ? {
                                             ...x,
                                             productionAreaId,
                                             type: selectedRole.type
                                          } : x));
                                       }}
                                       className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-400"
                                    >
                                       {PRINTER_ROLE_OPTIONS.map(option => (
                                          <option key={option.id} value={option.id}>{option.label}</option>
                                       ))}
                                    </select>
                                    <span className="text-[10px] font-semibold text-slate-400 ml-1">
                                       {PRINTER_ROLE_OPTIONS.find(option => option.id === resolvePrinterRoleId(p))?.helper}
                                    </span>
                                 </div>
                                 <div className="flex items-center gap-2">
                                 <button
                                    onClick={() => handleTestPrinter(p)}
                                    className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-black hover:bg-slate-200 transition-colors flex items-center gap-2"
                                 >
                                    {testingPrinterId === p.id ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
                                    Imprimir prueba
                                 </button>
                                 <button onClick={() => setPrinters(printers.filter(x => x.id !== p.id))} className="p-2 text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={20} /></button>
                                 </div>
                              </div>
                           </div>
                        ))}
                        {printers.length === 0 && (
                           <div className="p-16 text-center text-slate-300">
                              <Cable size={48} className="mx-auto mb-3 opacity-20" />
                              <p className="text-sm font-bold uppercase tracking-widest">Sin dispositivos vinculados</p>
                           </div>
                        )}
                     </div>
                  </div>
               )}
               {activeTab === 'SCALES' && (
                  <div className="bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-sm animate-in slide-in-from-right-4">
                     <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-50">
                        <div><h3 className="text-xl font-black text-slate-800 flex items-center gap-3"><Scale className="text-blue-600" /> Gestión de Balanzas</h3><p className="text-xs text-slate-400 font-medium">Configura dispositivos de pesaje por serie o USB.</p></div>
                        <button onClick={createNewScale} className="px-6 py-3 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-500/20 active:scale-95 transition-all flex items-center gap-2"><Plus size={24} /> Nueva Balanza</button>
                     </div>
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {scales.map(scale => (
                           <div key={scale.id} className="p-8 bg-white border-2 border-slate-100 rounded-[2.5rem] relative group hover:border-blue-400 hover:shadow-xl transition-all">
                              <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 flex gap-2 transition-opacity">
                                 <button onClick={() => setEditingScale(scale)} className="p-2.5 bg-slate-50 rounded-xl text-blue-600 hover:bg-blue-50"><SettingsIcon size={18} /></button>
                                 <button onClick={() => handleDeleteScale(scale.id)} className="p-2.5 bg-slate-50 rounded-xl text-red-500 hover:bg-red-50"><Trash2 size={18} /></button>
                              </div>
                              <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-blue-500 mb-6 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-inner"><Scale size={32} /></div>
                              <h4 className="font-black text-slate-800 text-lg leading-tight mb-1">{scale.name}</h4>
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{scale.technology === 'DIRECT' ? 'SERIAL/COM' : 'ETIQUETADO'}</span>
                           </div>
                        ))}
                        {scales.length === 0 && (
                           <div className="col-span-full py-20 border-2 border-dashed border-slate-200 rounded-[3rem] text-center text-slate-400">
                              <Scale size={64} className="mx-auto mb-4 opacity-10" />
                              <p className="text-sm font-bold uppercase tracking-widest">No hay balanzas registradas</p>
                           </div>
                        )}
                     </div>
                  </div>
               )}
               {activeTab === 'LABELS' && (
                  <div className="bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-sm animate-in slide-in-from-right-4">
                     <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-50">
                        <div>
                           <h3 className="text-xl font-black text-slate-800 flex items-center gap-3"><Barcode className="text-purple-600" /> Lector de Etiquetas</h3>
                           <p className="text-xs text-slate-400 font-medium">Configura la lectura de códigos de barras impresos por balanzas.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                           <input type="checkbox" checked={scaleLabelConfig.isEnabled} onChange={(e) => setScaleLabelConfig({ ...scaleLabelConfig, isEnabled: e.target.checked })} className="sr-only peer" />
                           <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-purple-600"></div>
                        </label>
                     </div>

                     {scaleLabelConfig.isEnabled && (
                        <div className="space-y-8 animate-in fade-in">
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                              <div className="space-y-4">
                                 <label className="block text-sm font-bold text-gray-700">Prefijos (Separados por coma)</label>
                                 <input
                                    type="text"
                                    value={scaleLabelConfig.prefixes.join(',')}
                                    onChange={(e) => setScaleLabelConfig({ ...scaleLabelConfig, prefixes: e.target.value.split(',').map(s => s.trim()) })}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-mono text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                    placeholder="Ej: 20, 02"
                                 />
                              </div>
                              <div className="space-y-4">
                                 <label className="block text-sm font-bold text-gray-700">Tipo de Valor</label>
                                 <div className="flex gap-4">
                                    <button onClick={() => setScaleLabelConfig({ ...scaleLabelConfig, valueType: 'WEIGHT' })} className={`flex-1 py-3 px-4 rounded-xl border-2 font-bold text-sm transition-all ${scaleLabelConfig.valueType === 'WEIGHT' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>Peso (kg/lb)</button>
                                    <button onClick={() => setScaleLabelConfig({ ...scaleLabelConfig, valueType: 'PRICE' })} className={`flex-1 py-3 px-4 rounded-xl border-2 font-bold text-sm transition-all ${scaleLabelConfig.valueType === 'PRICE' ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>Precio ($)</button>
                                 </div>
                              </div>
                           </div>

                           <div className="bg-gradient-to-br from-slate-50 to-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 mb-6">
                                 <div>
                                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Estructura del Código (EAN-13)</h3>
                                    <p className="mt-2 text-sm font-semibold text-slate-500">
                                       Visualiza cómo el POS separa prefijo, PLU y valor antes de buscar el artículo.
                                    </p>
                                 </div>
                                 <div className="flex flex-wrap gap-2">
                                    {buildScalePreviewSegments().map(segment => (
                                       <div key={segment.label} className={`rounded-2xl border px-4 py-3 min-w-[96px] ${segment.className}`}>
                                          <p className="text-[9px] font-black uppercase tracking-[0.18em] opacity-70">{segment.label}</p>
                                          <p className="mt-1 font-mono text-lg font-black tracking-wider">{segment.value}</p>
                                       </div>
                                    ))}
                                 </div>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                 {[
                                    { label: 'Longitud Total', key: 'totalLength', helper: 'EAN-13 = 13' },
                                    { label: 'Inicio PLU', key: 'pluStart', helper: 'Posición 0-based' },
                                    { label: 'Largo PLU', key: 'pluLength', helper: 'Dígitos del artículo' },
                                    { label: 'Inicio Valor', key: 'valueStart', helper: 'Peso o precio' },
                                    { label: 'Decimales', key: 'decimals', root: true, helper: 'Divisor 10^n' }
                                 ].map((field: any) => (
                                    <div key={field.label} className="rounded-2xl bg-white border border-slate-200 p-3">
                                       <label className="text-[10px] font-black text-slate-500 uppercase tracking-wide">{field.label}</label>
                                       <input
                                          type="number"
                                          value={field.root ? (scaleLabelConfig as any)[field.key] : (scaleLabelConfig.structure as any)[field.key]}
                                          onChange={(e) => {
                                             const val = parseInt(e.target.value, 10);
                                             const safeVal = Number.isFinite(val) ? val : 0;
                                             if (field.root) setScaleLabelConfig({ ...scaleLabelConfig, [field.key]: safeVal });
                                             else setScaleLabelConfig({ ...scaleLabelConfig, structure: { ...scaleLabelConfig.structure, [field.key]: safeVal } });
                                          }}
                                          className="w-full mt-2 p-3 rounded-xl border border-slate-200 bg-slate-50 text-center font-mono font-black outline-none focus:bg-white focus:border-purple-500"
                                       />
                                       <p className="mt-1 text-[10px] font-semibold text-slate-400">{field.helper}</p>
                                    </div>
                                 ))}
                              </div>
                           </div>

                           <div className="border-t border-slate-100 pt-6">
                              <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2"><Barcode size={18} /> Probador de Configuración</h3>
                              <div className="flex gap-4">
                                 <input
                                    type="text"
                                    placeholder="Escanea o escribe un código de prueba..."
                                    value={testBarcode}
                                    onChange={(e) => setTestBarcode(e.target.value)}
                                    className="flex-1 p-4 bg-white border border-gray-300 rounded-2xl font-mono text-lg outline-none focus:border-purple-500 shadow-sm"
                                 />
                                 <button
                                    onClick={() => {
                                       const result = parseScaleBarcodeDetailed(testBarcode, scaleLabelConfig as any);
                                       setTestResult(result.success && result.item
                                          ? { success: true, message: `Código ${result.normalizedBarcode} | PLU: ${result.item.plu} | ${result.item.type === 'WEIGHT' ? 'Peso' : 'Precio'}: ${result.item.value}` }
                                          : { success: false, message: result.message });
                                    }}
                                    className="px-8 py-3 bg-slate-800 text-white font-bold rounded-2xl hover:bg-slate-900 transition-colors"
                                 >
                                    Probar
                                 </button>
                              </div>
                              {testResult && (
                                 <div className={`mt-4 p-4 rounded-2xl flex items-center gap-3 ${testResult.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                                    {testResult.success ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
                                    <span className="font-bold">{testResult.message}</span>
                                 </div>
                              )}
                           </div>
                        </div>
                     )}
                  </div>
               )}
               {activeTab === 'DISPLAY' && renderCustomerDisplay()}
               {activeTab === 'FINGERPRINT' && renderFingerprintSettings()}
            </div>
         </div>

         <div className="fixed bottom-6 right-6 z-50">
            {hardwareSaveFeedback && (
               <div className={`mb-3 max-w-sm rounded-2xl border px-4 py-3 text-sm font-bold shadow-lg ${hardwareSaveFeedback.success
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-red-200 bg-red-50 text-red-700'
                  }`}>
                  {hardwareSaveFeedback.message}
               </div>
            )}
            <button
               onClick={() => void handleSaveAllHardware()}
               disabled={isSavingHardware}
               className="px-8 py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg shadow-xl shadow-blue-600/30 flex items-center gap-3 transition-all hover:scale-105 active:scale-95 animate-in slide-in-from-bottom-8 duration-500 disabled:cursor-wait disabled:opacity-60 disabled:hover:scale-100"
            >
               {isSavingHardware ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
               {isSavingHardware ? 'Guardando...' : 'Guardar configuración'}
            </button>
         </div>

         {editingScale && (
            <div className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
               <div className="bg-white rounded-[3rem] w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 flex flex-col max-h-[90vh]">
                  <div className="p-8 border-b border-slate-50 flex justify-between items-center shrink-0">
                     <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-100 text-blue-600 rounded-2xl"><Scale size={28} /></div>
                        <div>
                           <h3 className="text-2xl font-black text-slate-800">Parámetros de Balanza</h3>
                           <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Configuración del Puerto RS-232 / USB</p>
                        </div>
                     </div>
                     <button onClick={() => setEditingScale(null)} className="p-2 hover:bg-slate-100 rounded-full"><X size={24} /></button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                     {/* SELECTOR DE PRESETS */}
                     <section>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 ml-1">Seleccionar Marca / Modelo</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                           {SCALE_PRESETS.map(preset => (
                              <button
                                 key={preset.id}
                                 onClick={() => handleApplyPreset(preset)}
                                 className="p-4 rounded-2xl border-2 border-slate-100 hover:border-blue-400 bg-white hover:shadow-lg transition-all text-left flex flex-col gap-2 group"
                              >
                                 <span className="text-2xl">{preset.icon}</span>
                                 <div>
                                    <p className="font-black text-slate-800 text-sm">{preset.brand}</p>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase leading-tight">{preset.model}</p>
                                 </div>
                              </button>
                           ))}
                        </div>
                     </section>

                     <div className="h-px bg-slate-100"></div>

                     <section className="space-y-6">
                        <div>
                           <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Alias del Dispositivo</label>
                           <input
                              type="text"
                              value={editingScale.name}
                              onChange={e => setEditingScale({ ...editingScale, name: e.target.value })}
                              className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-bold text-slate-800 focus:bg-white focus:border-blue-400 outline-none transition-all"
                              placeholder="Ej. Balanza Carnicería 1"
                           />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                           <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Tecnología</label>
                              <select value={editingScale.technology} onChange={e => setEditingScale({ ...editingScale, technology: e.target.value as any })} className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-bold text-slate-800 outline-none focus:bg-white focus:border-blue-400">
                                 <option value="DIRECT">Comunicación Directa (Serie)</option>
                                 <option value="LABEL">Lectura Etiquetas (EAN-13)</option>
                              </select>
                           </div>
                           <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Puerto de Comunicación</label>
                              <div className="relative">
                                 <input
                                    type="text"
                                    value={editingScale.directConfig?.port || 'COM1'}
                                    onChange={e => setEditingScale({ ...editingScale, directConfig: { ...editingScale.directConfig!, port: e.target.value } })}
                                    className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-black text-slate-800 focus:bg-white focus:border-blue-400 outline-none transition-all"
                                    placeholder="COM1 o /dev/ttyUSB0"
                                 />
                                 <Cpu className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
                              </div>
                           </div>
                        </div>

                        <div className="bg-slate-900 rounded-3xl p-6 border border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-6">
                           <div>
                              <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Baud Rate</label>
                              <select
                                 value={editingScale.directConfig?.baudRate}
                                 onChange={e => setEditingScale({ ...editingScale, directConfig: { ...editingScale.directConfig!, baudRate: parseInt(e.target.value) } })}
                                 className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl p-3 font-mono text-sm font-bold outline-none"
                              >
                                 {[2400, 4800, 9600, 19200, 38400, 57600, 115200].map(b => <option key={b} value={b}>{b}</option>)}
                              </select>
                           </div>
                           <div>
                              <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Protocolo Data</label>
                              <select
                                 value={editingScale.directConfig?.protocol}
                                 onChange={e => setEditingScale({ ...editingScale, directConfig: { ...editingScale.directConfig!, protocol: e.target.value } })}
                                 className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl p-3 font-mono text-sm font-bold outline-none"
                              >
                                 <option value="NCI">NCI Standard</option>
                                 <option value="Standard">Standard (PosScale)</option>
                                 <option value="Dialog 06">Dialog 06</option>
                                 <option value="Protocolo T">Dibal T</option>
                              </select>
                           </div>
                           <div className="flex items-center justify-center pt-5">
                              <button className="flex items-center gap-2 text-blue-400 font-black text-[10px] uppercase hover:text-blue-300 transition-colors">
                                 <Wave size={16} className="animate-pulse" /> Probar Conexión
                              </button>
                           </div>
                        </div>
                     </section>
                  </div>

                  <div className="p-8 bg-gray-50 border-t flex gap-4 shrink-0">
                     <button onClick={() => setEditingScale(null)} className="flex-1 py-4 font-black text-slate-400 hover:bg-white rounded-2xl border border-transparent hover:border-slate-200 transition-all">Cancelar</button>
                     <button onClick={handleSaveScale} className="flex-[2] py-4 bg-blue-600 text-white rounded-[1.5rem] font-black text-lg shadow-xl shadow-blue-200 active:scale-95 transition-all">Aplicar Configuración</button>
                  </div>
               </div>
            </div>
         )}
      </div>
   );
};

export default HardwareSettings;
