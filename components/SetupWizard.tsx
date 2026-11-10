import React, { useState, useEffect } from 'react';
import { 
  ArrowRight, ArrowLeft, Check, UploadCloud, FileSpreadsheet, 
  Map, DollarSign, Flag, Building2, Package, Percent, Wand2,
  CheckCircle2, ChevronDown, AlertCircle, Monitor, ShoppingBag, ScanLine, Boxes, Tablet, Smartphone
} from 'lucide-react';
import { BusinessConfig, CompanyInfo, CurrencyConfig, DeviceFormFactor, DeviceOrientation, DeviceProfile, DeviceRole, DocumentSeries, DocumentType, PaymentMethodDefinition, TaxDefinition, Tariff, TerminalConfig, Warehouse } from '../types';
import { DEFAULT_DOCUMENT_SERIES, DEFAULT_TERMINAL_CONFIG, INITIAL_TAXES, INITIAL_TARIFFS } from '../constants';
import { db } from '../utils/db';
import { PRODUCT_SEED_PACKS, ProductSeedPackId, buildSeedProducts, getProductSeedPack } from '../utils/productSeedPacks';
import { getDefaultRoleConfig } from '../utils/deviceRoleHelpers';
import { getDefaultDeviceProfile, resolveDeviceProfile } from '../utils/deviceProfile';

interface SetupWizardProps {
  initialConfig: BusinessConfig;
  onComplete: (finalConfig: BusinessConfig) => void;
  onCancel?: () => void;
}

type WizardStep =
  | 'SEED'
  | 'BUSINESS'
  | 'TERMINAL'
  | 'CURRENCIES'
  | 'TAXES'
  | 'WAREHOUSES'
  | 'TARIFFS'
  | 'PAYMENTS'
  | 'SERIES'
  | 'CATALOG'
  | 'READY';

const STEPS: { id: WizardStep; label: string; icon: any }[] = [
  { id: 'SEED', label: 'Base', icon: Map },
  { id: 'BUSINESS', label: 'Negocio', icon: Building2 },
  { id: 'TERMINAL', label: 'Terminal', icon: Building2 },
  { id: 'CURRENCIES', label: 'Monedas', icon: Flag },
  { id: 'TAXES', label: 'Impuestos', icon: DollarSign },
  { id: 'WAREHOUSES', label: 'Almacenes', icon: Package },
  { id: 'TARIFFS', label: 'Tarifas', icon: Percent },
  { id: 'PAYMENTS', label: 'Pagos', icon: DollarSign },
  { id: 'SERIES', label: 'Series', icon: FileSpreadsheet },
  { id: 'CATALOG', label: 'Catálogo', icon: Package },
  { id: 'READY', label: 'Listo', icon: CheckCircle2 },
];

const ALLOW_FULL_DEMO_SEED_STORAGE_KEY = 'clic_pos_allow_demo_seed';

const DOCUMENT_TYPES: DocumentType[] = [
  'TICKET',
  'REFUND',
  'VOID',
  'TRANSFER',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'PURCHASE',
  'PRODUCTION',
  'CASH_IN',
  'CASH_OUT',
  'CASH_DEPOSIT',
  'CASH_WITHDRAWAL',
  'Z_REPORT',
  'X_REPORT',
  'RECEIVABLE',
  'PAYABLE',
  'PAYMENT_IN',
  'PAYMENT_OUT'
];

const DEFAULT_BASE_CURRENCY: CurrencyConfig = {
  code: 'DOP',
  name: 'Peso Dominicano',
  symbol: 'RD$',
  rate: 1,
  isEnabled: true,
  isBase: true,
};

const DEFAULT_PAYMENT_METHODS: PaymentMethodDefinition[] = [
  {
    id: 'cash',
    name: 'Efectivo',
    type: 'CASH',
    isEnabled: true,
    icon: 'Banknote',
    color: 'bg-green-500',
    opensDrawer: true,
    requiresSignature: false,
    integration: 'NONE',
    foreignCurrencyRounding: 'NONE',
  },
  {
    id: 'card',
    name: 'Tarjeta',
    type: 'CARD',
    isEnabled: true,
    icon: 'CreditCard',
    color: 'bg-blue-500',
    opensDrawer: false,
    requiresSignature: false,
    integration: 'NONE',
    foreignCurrencyRounding: 'NONE',
  },
];

const DEFAULT_WAREHOUSE: Warehouse = {
  id: 'wh-1',
  code: 'ALM-1',
  name: 'Almacén General',
  type: 'PHYSICAL',
  address: '',
  allowPosSale: true,
  allowNegativeStock: false,
  isMain: true,
  erpWarehouseId: 'wh-1',
};

const SUGGESTED_DOCUMENT_SERIES: DocumentSeries[] = [
  { id: 'TICKET', documentType: 'TICKET', name: 'Ticket de Venta', description: 'Comprobante estándar de venta.', prefix: 'TCK', nextNumber: 1, padding: 6, icon: 'Receipt', color: 'blue' },
  { id: 'REFUND', documentType: 'REFUND', name: 'Devolución / Abono', description: 'Notas de crédito por devoluciones.', prefix: 'NC', nextNumber: 1, padding: 6, icon: 'RotateCcw', color: 'orange' },
  { id: 'VOID', documentType: 'VOID', name: 'Anulación', description: 'Anulación de ventas.', prefix: 'ANU', nextNumber: 1, padding: 6, icon: 'X', color: 'red' },
  { id: 'TRANSFER', documentType: 'TRANSFER', name: 'Traspaso', description: 'Movimiento entre almacenes.', prefix: 'TR', nextNumber: 1, padding: 6, icon: 'ArrowRightLeft', color: 'purple' },
  { id: 'ADJ_IN', documentType: 'ADJUSTMENT_IN', name: 'Ajuste +', description: 'Ajuste positivo de inventario.', prefix: 'AJI', nextNumber: 1, padding: 6, icon: 'Plus', color: 'green' },
  { id: 'ADJ_OUT', documentType: 'ADJUSTMENT_OUT', name: 'Ajuste -', description: 'Ajuste negativo de inventario.', prefix: 'AJO', nextNumber: 1, padding: 6, icon: 'Minus', color: 'red' },
  { id: 'PURCHASE', documentType: 'PURCHASE', name: 'Compra', description: 'Recepción de compras.', prefix: 'COM', nextNumber: 1, padding: 6, icon: 'Package', color: 'blue' },
  { id: 'PRODUCTION', documentType: 'PRODUCTION', name: 'Producción', description: 'Producción / ensamble.', prefix: 'PRO', nextNumber: 1, padding: 6, icon: 'Wand2', color: 'teal' },
  { id: 'CASH_IN', documentType: 'CASH_IN', name: 'Entrada de Caja', description: 'Entrada de efectivo.', prefix: 'CI', nextNumber: 1, padding: 6, icon: 'ArrowRight', color: 'green' },
  { id: 'CASH_OUT', documentType: 'CASH_OUT', name: 'Salida de Caja', description: 'Salida de efectivo.', prefix: 'CO', nextNumber: 1, padding: 6, icon: 'ArrowLeft', color: 'red' },
  { id: 'CASH_DEPOSIT', documentType: 'CASH_DEPOSIT', name: 'Depósito', description: 'Depósito bancario.', prefix: 'DEP', nextNumber: 1, padding: 6, icon: 'Banknote', color: 'blue' },
  { id: 'CASH_WITHDRAWAL', documentType: 'CASH_WITHDRAWAL', name: 'Retiro', description: 'Retiro bancario.', prefix: 'RET', nextNumber: 1, padding: 6, icon: 'Banknote', color: 'orange' },
  { id: 'Z_REPORT', documentType: 'Z_REPORT', name: 'Cierre Z', description: 'Cierre de caja.', prefix: 'Z', nextNumber: 1, padding: 6, icon: 'FileText', color: 'gray' },
  { id: 'X_REPORT', documentType: 'X_REPORT', name: 'Corte X', description: 'Reporte parcial.', prefix: 'X', nextNumber: 1, padding: 6, icon: 'FileText', color: 'gray' },
  { id: 'RECEIVABLE', documentType: 'RECEIVABLE', name: 'Cuentas por Cobrar', description: 'Registro CxC.', prefix: 'CXC', nextNumber: 1, padding: 6, icon: 'Wallet', color: 'indigo' },
  { id: 'PAYABLE', documentType: 'PAYABLE', name: 'Cuentas por Pagar', description: 'Registro CxP.', prefix: 'CXP', nextNumber: 1, padding: 6, icon: 'Wallet', color: 'purple' },
  { id: 'PAYMENT_IN', documentType: 'PAYMENT_IN', name: 'Pago Recibido', description: 'Ingreso de pago.', prefix: 'PR', nextNumber: 1, padding: 6, icon: 'ArrowDown', color: 'green' },
  { id: 'PAYMENT_OUT', documentType: 'PAYMENT_OUT', name: 'Pago Realizado', description: 'Salida de pago.', prefix: 'PP', nextNumber: 1, padding: 6, icon: 'ArrowUp', color: 'red' },
];

const DEVICE_ROLE_OPTIONS: Array<{ role: DeviceRole; label: string; description: string; icon: any }> = [
  { role: DeviceRole.STANDARD_POS, label: 'POS estándar', description: 'Caja para ventas, cobros y operación diaria.', icon: ShoppingBag },
  { role: DeviceRole.KITCHEN_DISPLAY, label: 'Pantalla cocina', description: 'KDS dedicado para visualizar y marcar comandas.', icon: Monitor },
  { role: DeviceRole.SELF_CHECKOUT, label: 'SelfCheckout', description: 'Terminal de autoservicio para cliente final.', icon: ScanLine },
  { role: DeviceRole.PRICE_CHECKER, label: 'Verificador precio', description: 'Consulta rápida de artículos por código.', icon: ScanLine },
  { role: DeviceRole.HANDHELD_INVENTORY, label: 'Inventario móvil', description: 'Conteos, ajustes y operaciones de almacén.', icon: Boxes },
];

const DEVICE_PROFILE_OPTIONS: Array<{ formFactor: DeviceFormFactor; label: string; description: string; icon: any }> = [
  { formFactor: DeviceFormFactor.DESKTOP_POS, label: 'POS normal', description: 'Equipo fijo o computadora.', icon: Monitor },
  { formFactor: DeviceFormFactor.TABLET, label: 'Tablet', description: 'Pantalla táctil adaptable.', icon: Tablet },
  { formFactor: DeviceFormFactor.HANDHELD, label: 'Móvil / PDA', description: 'Equipo compacto de mano.', icon: Smartphone },
  { formFactor: DeviceFormFactor.KIOSK, label: 'Kiosco', description: 'Pantalla fija de autoservicio.', icon: ScanLine },
];

const makeId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;

// Available fields in the App to map to
const SYSTEM_FIELDS = [
  { id: 'ignore', label: '⛔ Ignorar columna' },
  { id: 'name', label: 'Nombre Producto' },
  { id: 'price', label: 'Precio Venta' },
  { id: 'cost', label: 'Costo Unitario' },
  { id: 'sku', label: 'Código Barras / SKU' },
  { id: 'stock', label: 'Stock Inicial' },
  { id: 'category', label: 'Categoría' },
  { id: 'attr_size', label: 'Atributo: Talla' },
  { id: 'attr_color', label: 'Atributo: Color' },
];

// Simulating headers detected from the user's CSV
const DETECTED_CSV_HEADERS = [
  'Código', 
  'Descripción Item', 
  'Talla', 
  'Color', 
  'PVP'
];

const SetupWizard: React.FC<SetupWizardProps> = ({ initialConfig, onComplete, onCancel }) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>('SEED');
  const [seedMode, setSeedMode] = useState<'DEMO' | 'BLANK'>('BLANK');
  const [productSeedPackId, setProductSeedPackId] = useState<ProductSeedPackId>('NONE');
  const [config, setConfig] = useState<BusinessConfig>(initialConfig);
  const [taxes, setTaxes] = useState<TaxDefinition[]>(initialConfig.taxes || []);
  const [tariffs, setTariffs] = useState<Tariff[]>(initialConfig.tariffs || []);
  const [currencies, setCurrencies] = useState<CurrencyConfig[]>(initialConfig.currencies || []);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodDefinition[]>(initialConfig.paymentMethods || []);
  const [documentSeries, setDocumentSeries] = useState<DocumentSeries[]>(DEFAULT_DOCUMENT_SERIES);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [defaultCurrencyCode, setDefaultCurrencyCode] = useState<string>('');
  const [defaultTariffId, setDefaultTariffId] = useState<string>('');
  const [defaultWarehouseId, setDefaultWarehouseId] = useState<string>('');
  const [terminalId, setTerminalId] = useState('t1');
  const [terminalName, setTerminalName] = useState('Caja 1');
  const [stationNumber, setStationNumber] = useState('1');
  const [deviceRole, setDeviceRole] = useState<DeviceRole>(DeviceRole.STANDARD_POS);
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile>(() => getDefaultDeviceProfile(DeviceRole.STANDARD_POS));
  
  // Catalog Import State
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isMappingMode, setIsMappingMode] = useState(false);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [isAutoMatching, setIsAutoMatching] = useState(false);
  const selectedProductPack = getProductSeedPack(productSeedPackId);

  const hydrateFromConfig = (nextConfig: BusinessConfig, mode: 'DEMO' | 'BLANK') => {
    const terminal = (nextConfig.terminals || [])[0];
    const terminalConfig = (terminal?.config || DEFAULT_TERMINAL_CONFIG) as TerminalConfig;
    const nextTaxes = Array.isArray(nextConfig.taxes) ? nextConfig.taxes : [];
    const nextTariffs = Array.isArray(nextConfig.tariffs) ? nextConfig.tariffs : [];
    const nextCurrencies = Array.isArray(nextConfig.currencies) ? nextConfig.currencies : [];
    const nextPayments = Array.isArray(nextConfig.paymentMethods) ? nextConfig.paymentMethods : [];
    const nextSeries = Array.isArray(terminalConfig.documentSeries) && terminalConfig.documentSeries.length > 0
      ? terminalConfig.documentSeries
      : DEFAULT_DOCUMENT_SERIES;
    const nextWarehouses = Array.isArray(terminalConfig.inventoryScope?.warehouses)
      ? terminalConfig.inventoryScope?.warehouses
      : [];

    setConfig(nextConfig);
    setTaxes(nextTaxes);
    setTariffs(nextTariffs);
    setCurrencies(nextCurrencies);
    setPaymentMethods(nextPayments);
    setDocumentSeries(nextSeries);
    setWarehouses(nextWarehouses || []);
    setTerminalId(terminal?.id || 't1');
    setTerminalName(terminalConfig.terminalName || 'Caja 1');
    setStationNumber(terminalConfig.stationNumber ? String(terminalConfig.stationNumber) : '1');
    setDeviceRole(terminalConfig.deviceRole?.role || DeviceRole.STANDARD_POS);
    setDeviceProfile(resolveDeviceProfile([terminalConfig], terminalConfig.deviceRole?.role || DeviceRole.STANDARD_POS));

    const baseCurrency = (nextCurrencies || []).find((c) => c.isBase) || nextCurrencies[0];
    setDefaultCurrencyCode(baseCurrency?.code || '');
    setDefaultTariffId(terminalConfig.pricing?.defaultTariffId || nextTariffs[0]?.id || '');
    setDefaultWarehouseId(terminalConfig.inventoryScope?.defaultSalesWarehouseId || nextWarehouses?.[0]?.id || '');

    if (mode === 'BLANK') {
      if (!nextCurrencies.length) {
        setCurrencies([DEFAULT_BASE_CURRENCY]);
        setDefaultCurrencyCode(DEFAULT_BASE_CURRENCY.code);
      }
      if (!nextPayments.length) setPaymentMethods(DEFAULT_PAYMENT_METHODS);
      if (!nextSeries.length) setDocumentSeries(SUGGESTED_DOCUMENT_SERIES);
      if (!nextTaxes.length) setTaxes(INITIAL_TAXES);
      if (!nextTariffs.length) {
        setTariffs(INITIAL_TARIFFS);
        setDefaultTariffId(INITIAL_TARIFFS[0]?.id || '');
      }
      if (!nextWarehouses.length) {
        setWarehouses([DEFAULT_WAREHOUSE]);
        setDefaultWarehouseId(DEFAULT_WAREHOUSE.id);
      }
    }
  };

  useEffect(() => {
    if (seedMode === 'DEMO') {
      hydrateFromConfig(initialConfig, 'DEMO');
      return;
    }

    const blankConfig: BusinessConfig = {
      ...initialConfig,
      taxes: [],
      tariffs: [],
      currencies: [],
      paymentMethods: [],
      inventoryScope: {
        defaultSalesWarehouseId: '',
        visibleWarehouseIds: []
      },
      terminals: [
        {
          id: 't1',
          config: {
            ...DEFAULT_TERMINAL_CONFIG,
            isPrimaryNode: true,
            currentDeviceId: undefined,
          }
        }
      ]
    };
    hydrateFromConfig(blankConfig, 'BLANK');
  }, [seedMode, initialConfig]);

  // --- HANDLERS ---

  const buildFinalConfig = () => {
    const normalizedCurrencies = (currencies.length ? currencies : [DEFAULT_BASE_CURRENCY]).map((currency) => ({
      ...currency,
      isEnabled: currency.isEnabled ?? true,
      isBase: currency.code === (defaultCurrencyCode || currencies[0]?.code || DEFAULT_BASE_CURRENCY.code)
    }));

    const normalizedTaxes = taxes.length ? taxes : INITIAL_TAXES;
    const normalizedTariffs = tariffs.length ? tariffs : INITIAL_TARIFFS;
    const normalizedPayments = paymentMethods.length ? paymentMethods : DEFAULT_PAYMENT_METHODS;
    const normalizedWarehouses = warehouses.length ? warehouses : [DEFAULT_WAREHOUSE];
    const normalizedSeries = documentSeries.length ? documentSeries : SUGGESTED_DOCUMENT_SERIES;

    const baseCurrency = normalizedCurrencies.find((currency) => currency.isBase) || normalizedCurrencies[0];
    const primaryVat = normalizedTaxes.find((tax) => tax.type === 'VAT');
    const effectiveDefaultTariffId = defaultTariffId || normalizedTariffs[0]?.id || '';
    const effectiveDefaultWarehouseId = defaultWarehouseId || normalizedWarehouses[0]?.id || '';

    const documentAssignments = normalizedSeries.reduce<Record<string, string>>((acc, series) => {
      if (!acc[series.documentType]) acc[series.documentType] = series.id;
      return acc;
    }, {});

    const terminalConfig = {
      ...DEFAULT_TERMINAL_CONFIG,
      terminalName,
      stationNumber,
      pricing: {
        ...DEFAULT_TERMINAL_CONFIG.pricing,
        allowedTariffIds: normalizedTariffs.map((tariff) => tariff.id),
        defaultTariffId: effectiveDefaultTariffId,
        tariffs: normalizedTariffs
      },
      financial: {
        ...DEFAULT_TERMINAL_CONFIG.financial,
        acceptedCurrencies: normalizedCurrencies.map((currency) => currency.code)
      },
      inventoryScope: {
        defaultSalesWarehouseId: effectiveDefaultWarehouseId,
        visibleWarehouseIds: normalizedWarehouses.map((warehouse) => warehouse.id),
        warehouses: normalizedWarehouses,
        defaultWarehouse: normalizedWarehouses.find((warehouse) => warehouse.id === effectiveDefaultWarehouseId)
      },
      documentSeries: normalizedSeries,
      documentAssignments,
      deviceRole: getDefaultRoleConfig(deviceRole),
      deviceProfile,
      operational: {
        ...DEFAULT_TERMINAL_CONFIG.operational,
        defaultTaxIds: primaryVat ? [primaryVat.id] : []
      }
    };

    return {
      ...config,
      metadata: {
        ...(config.metadata || {}),
        seedMode,
        productSeedPackId
      },
      currencySymbol: baseCurrency?.symbol || config.currencySymbol,
      taxRate: primaryVat?.rate ?? config.taxRate,
      taxes: normalizedTaxes,
      tariffs: normalizedTariffs,
      currencies: normalizedCurrencies,
      paymentMethods: normalizedPayments,
      inventoryScope: {
        defaultSalesWarehouseId: effectiveDefaultWarehouseId,
        visibleWarehouseIds: normalizedWarehouses.map((warehouse) => warehouse.id)
      },
      terminals: [
        {
          id: terminalId || 't1',
          config: terminalConfig
        }
      ]
    };
  };

  const finalizeConfig = async () => {
    const finalConfig = buildFinalConfig();
    const warehousesToPersist = finalConfig.terminals[0]?.config.inventoryScope?.warehouses || [];
    const defaultTaxIds = finalConfig.terminals[0]?.config.operational?.defaultTaxIds || [];
    const defaultTariffIdToPersist = finalConfig.terminals[0]?.config.pricing?.defaultTariffId || '';
    const defaultWarehouseIdToPersist = finalConfig.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || '';
    const starterProducts = buildSeedProducts(productSeedPackId, {
      defaultTaxIds,
      defaultTariffId: defaultTariffIdToPersist,
      defaultWarehouseId: defaultWarehouseIdToPersist
    });

    try {
      if (seedMode === 'DEMO') {
        localStorage.setItem(ALLOW_FULL_DEMO_SEED_STORAGE_KEY, '1');
      } else {
        localStorage.removeItem(ALLOW_FULL_DEMO_SEED_STORAGE_KEY);
      }
    } catch (error) {
      console.warn('No se pudo actualizar la bandera local de seed demo:', error);
    }

    if (warehousesToPersist.length) {
      await db.save('warehouses', warehousesToPersist);
    }
    if (seedMode === 'BLANK' || productSeedPackId !== 'NONE') {
      const collectionsToClear = [
        'products',
        'customers',
        'transactions',
        'transactionHistory',
        'cashMovements',
        'transfers',
        'parkedTickets',
        'purchaseOrders',
        'suppliers',
        'inventoryLedger',
        'watchlists',
        'campaigns',
        'coupons',
        'zReports',
        'receptions',
        'productStocks',
        'productPrices',
        'reservations',
        'inventoryCommitments',
        'supplierProductPrices',
        'inventoryTracking',
        'inventorySnapshots',
        'inventoryAuditLogs',
        'inventoryCounts',
        'locations',
        'offline_receptions',
        'offline_reception_queue',
        'offline_reception_conflicts',
        'offline_inventory_counts',
        'offline_inventory_count_queue',
        'offline_inventory_count_conflicts',
        'offline_print_queue',
        'rooms',
        'tables',
        'collections',
        'activities',
        'wallet_transactions',
        'loyalty_events'
      ] as const;

      await Promise.all(
        collectionsToClear.map((collection) => db.save(collection as any, []))
      );

      await db.save('warehouses' as any, warehousesToPersist);
      await db.save('products' as any, starterProducts);
      await db.save('paymentMethods' as any, finalConfig.paymentMethods || []);
      await db.save('internalSequences' as any, finalConfig.terminals[0]?.config.documentSeries || []);
      await db.saveDocument('config' as any, {
        id: '_db_initialized',
        timestamp: new Date().toISOString(),
        version: 1,
        seedMode,
        productSeedPackId
      });
    }
    return finalConfig;
  };

  const handleNext = async () => {
    if (currentStep === 'TERMINAL' && deviceRole === DeviceRole.KITCHEN_DISPLAY) {
      const finalConfig = await finalizeConfig();
      setConfig(finalConfig);
      setCurrentStep('READY');
      return;
    }

    if (currentStep === 'CATALOG') {
      const finalConfig = await finalizeConfig();
      setConfig(finalConfig);
      setCurrentStep('READY');
      return;
    }

    if (currentStep === 'READY') {
      onComplete(config);
      return;
    }

    const currentIndex = STEPS.findIndex(s => s.id === currentStep);
    if (currentIndex < STEPS.length - 1) {
      setCurrentStep(STEPS[currentIndex + 1].id);
    }
  };

  const handleBack = () => {
    const currentIndex = STEPS.findIndex(s => s.id === currentStep);
    if (currentIndex > 0) {
      setCurrentStep(STEPS[currentIndex - 1].id);
    }
  };

  const handleUpdateCompany = (field: keyof CompanyInfo, value: string) => {
    setConfig(prev => ({
      ...prev,
      companyInfo: { ...prev.companyInfo, [field]: value }
    }));
  };

  // Mock File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setImportFile(e.target.files[0]);
      // Simulate processing delay
      setTimeout(() => {
        setIsMappingMode(true);
        // Initialize mapping with 'ignore'
        const initialMap: Record<string, string> = {};
        DETECTED_CSV_HEADERS.forEach(h => initialMap[h] = 'ignore');
        setColumnMapping(initialMap);
      }, 800);
    }
  };

  const handleAutoMap = () => {
    setIsAutoMatching(true);
    setTimeout(() => {
      const newMap: Record<string, string> = {};
      DETECTED_CSV_HEADERS.forEach(header => {
        const h = header.toLowerCase();
        // Simple fuzzy matching logic simulation
        if (h.includes('código') || h.includes('sku') || h.includes('000')) newMap[header] = 'sku';
        else if (h.includes('descripción') || h.includes('nombre') || h.includes('item')) newMap[header] = 'name';
        else if (h.includes('pvp') || h.includes('precio') || h.includes('venta')) newMap[header] = 'price';
        else if (h.includes('costo')) newMap[header] = 'cost';
        else if (h.includes('stock') || h.includes('cantidad')) newMap[header] = 'stock';
        else if (h.includes('talla')) newMap[header] = 'attr_size';
        else if (h.includes('color')) newMap[header] = 'attr_color';
        else newMap[header] = 'ignore';
      });
      setColumnMapping(newMap);
      setIsAutoMatching(false);
    }, 600);
  };

  const handleManualMapChange = (header: string, fieldId: string) => {
    setColumnMapping(prev => ({
      ...prev,
      [header]: fieldId
    }));
  };

  const updateCurrency = (index: number, patch: Partial<CurrencyConfig>) => {
    setCurrencies(prev =>
      prev.map((currency, i) => (i === index ? { ...currency, ...patch } : currency))
    );
  };

  const updateTax = (index: number, patch: Partial<TaxDefinition>) => {
    setTaxes(prev =>
      prev.map((tax, i) => {
        if (i !== index) return tax;
        const nextTax = { ...tax, ...patch };
        if (typeof patch.rate === 'number') {
          nextTax.rate = Math.max(0, Math.min(1, patch.rate));
        }
        return nextTax;
      })
    );
  };

  const updateWarehouse = (index: number, patch: Partial<Warehouse>) => {
    setWarehouses(prev =>
      prev.map((warehouse, i) => (i === index ? { ...warehouse, ...patch } : warehouse))
    );
  };

  const updateTariff = (index: number, patch: Partial<Tariff>) => {
    setTariffs(prev =>
      prev.map((tariff, i) => (i === index ? { ...tariff, ...patch } : tariff))
    );
  };

  const updatePayment = (index: number, patch: Partial<PaymentMethodDefinition>) => {
    setPaymentMethods(prev =>
      prev.map((payment, i) => (i === index ? { ...payment, ...patch } : payment))
    );
  };

  const updateSeries = (index: number, patch: Partial<DocumentSeries>) => {
    setDocumentSeries(prev =>
      prev.map((series, i) => (i === index ? { ...series, ...patch } : series))
    );
  };

  // --- RENDER STEPS ---

  const renderBusinessStep = () => (
    <div className="space-y-6 animate-in slide-in-from-right-8 duration-500">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-800">Datos del Negocio</h2>
        <p className="text-gray-500">Información básica para tus tickets y facturas.</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="col-span-2">
          <label className="block text-sm font-bold text-gray-600 mb-2">Nombre Comercial</label>
          <input 
            type="text" 
            value={config.companyInfo.name}
            onChange={(e) => handleUpdateCompany('name', e.target.value)}
            className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-lg"
            placeholder="Ej. Cafetería Central"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-600 mb-2">Identificación Fiscal (RNC/NIF)</label>
          <input 
            type="text" 
            value={config.companyInfo.rnc}
            onChange={(e) => handleUpdateCompany('rnc', e.target.value)}
            className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            placeholder="XXX-XXXXXX-X"
          />
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-600 mb-2">Teléfono</label>
          <input 
            type="tel" 
            value={config.companyInfo.phone}
            onChange={(e) => handleUpdateCompany('phone', e.target.value)}
            className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            placeholder="+1 (000) 000-0000"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-bold text-gray-600 mb-2">Dirección</label>
          <input 
            type="text" 
            value={config.companyInfo.address}
            onChange={(e) => handleUpdateCompany('address', e.target.value)}
            className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            placeholder="Calle Principal #123"
          />
        </div>
      </div>
    </div>
  );

  const renderSeedStep = () => (
    <div className="space-y-6 animate-in slide-in-from-right-8 duration-500">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-800">Base de Datos Inicial</h2>
        <p className="text-gray-500">Inicia en blanco y, si quieres, carga solo artículos de arranque.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => setSeedMode('BLANK')}
          className={`p-6 rounded-2xl border-2 text-left transition-all hover:-translate-y-1 hover:shadow-lg ${
            seedMode === 'BLANK' ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200 bg-white'
          }`}
        >
          <div className="text-lg font-bold text-gray-800">Base en Blanco</div>
          <p className="text-sm text-gray-500 mt-2">
            Configura terminal, almacenes, tarifas, impuestos y series sin ventas demo.
          </p>
        </button>
        <button
          onClick={() => setProductSeedPackId('NONE')}
          className={`p-6 rounded-2xl border-2 text-left transition-all hover:-translate-y-1 hover:shadow-lg ${
            productSeedPackId === 'NONE' ? 'border-green-500 bg-green-50/50' : 'border-gray-200 bg-white'
          }`}
        >
          <div className="text-lg font-bold text-gray-800">Sin artículos</div>
          <p className="text-sm text-gray-500 mt-2">
            Deja el catálogo vacío para cargar tus productos manualmente o por importación.
          </p>
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-black uppercase tracking-[0.18em] text-gray-500">Artículos por tipo de negocio</h3>
          <p className="text-sm text-gray-500 mt-1">Estos paquetes solo crean artículos; no crean clientes, ventas, caja ni auditoría.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PRODUCT_SEED_PACKS.map((pack) => (
            <button
              key={pack.id}
              onClick={() => setProductSeedPackId(pack.id)}
              className={`p-4 rounded-2xl border-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${
                productSeedPackId === pack.id ? 'border-blue-500 bg-blue-50/60' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-black text-gray-800">{pack.label}</span>
                <span className="text-xs font-black text-gray-400">{pack.items.length} artículos</span>
              </div>
              <p className="text-sm text-gray-500 mt-1">{pack.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderTerminalStep = () => (
    <div className="space-y-6 animate-in slide-in-from-right-8 duration-500">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-800">Terminal Local</h2>
        <p className="text-gray-500">Define el tipo, nombre y número de estación.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {DEVICE_ROLE_OPTIONS.map(option => {
          const Icon = option.icon;
          const selected = deviceRole === option.role;
          return (
            <button
              key={option.role}
              type="button"
              onClick={() => setDeviceRole(option.role)}
              className={`rounded-2xl border-2 p-4 text-left transition-all ${
                selected ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-100' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`rounded-xl p-2 ${selected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  <Icon size={20} />
                </div>
                <div>
                  <div className="font-black text-gray-800">{option.label}</div>
                  <p className="mt-1 text-sm font-medium text-gray-500">{option.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {deviceRole === DeviceRole.KITCHEN_DISPLAY && (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">
          Esta terminal quedará como pantalla de cocina y el wizard saltará las configuraciones de venta.
        </div>
      )}

      <div className="space-y-3 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
        <div>
          <h3 className="font-black text-gray-800">Tipo de dispositivo</h3>
          <p className="text-sm font-medium text-gray-500">Describe el equipo físico sin cambiar las funciones de la terminal.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {DEVICE_PROFILE_OPTIONS.map(option => {
            const Icon = option.icon;
            const selected = deviceProfile.formFactor === option.formFactor;
            return (
              <button
                key={option.formFactor}
                type="button"
                onClick={() => setDeviceProfile(current => ({
                  ...current,
                  formFactor: option.formFactor,
                  touchOptimized: option.formFactor !== DeviceFormFactor.DESKTOP_POS,
                }))}
                className={`rounded-2xl border-2 p-3 text-left transition-all ${selected ? 'border-indigo-500 bg-white shadow-sm' : 'border-transparent bg-white/70 hover:border-indigo-200'}`}
              >
                <Icon size={20} className={selected ? 'text-indigo-600' : 'text-gray-400'} />
                <p className="mt-2 text-sm font-black text-gray-800">{option.label}</p>
                <p className="mt-1 text-xs font-medium text-gray-500">{option.description}</p>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-2">
            <span className="block text-xs font-black uppercase tracking-wider text-gray-500">Orientación</span>
            <select
              value={deviceProfile.orientation}
              onChange={(event) => setDeviceProfile(current => ({ ...current, orientation: event.target.value as DeviceOrientation }))}
              className="w-full rounded-xl border border-gray-200 bg-white p-3 font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value={DeviceOrientation.AUTO}>Automática</option>
              <option value={DeviceOrientation.PORTRAIT}>Vertical</option>
              <option value={DeviceOrientation.LANDSCAPE}>Horizontal</option>
            </select>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
            <input
              type="checkbox"
              checked={deviceProfile.touchOptimized}
              onChange={(event) => setDeviceProfile(current => ({ ...current, touchOptimized: event.target.checked }))}
              className="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>
              <span className="block text-sm font-black text-gray-800">Optimizado para táctil</span>
              <span className="block text-xs font-medium text-gray-500">Amplía controles y usa el corte adaptable.</span>
            </span>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-bold text-gray-600 mb-2">ID de Terminal</label>
          <input
            type="text"
            value={terminalId}
            onChange={(e) => setTerminalId(e.target.value)}
            className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
          />
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-600 mb-2">Número de Estación</label>
          <input
            type="text"
            value={stationNumber}
            onChange={(e) => setStationNumber(e.target.value)}
            className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-bold text-gray-600 mb-2">Nombre de la Caja</label>
          <input
            type="text"
            value={terminalName}
            onChange={(e) => setTerminalName(e.target.value)}
            className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-lg"
            placeholder="Ej. Caja Principal"
          />
        </div>
      </div>
    </div>
  );

  const renderCurrenciesStep = () => (
    <div className="space-y-6 animate-in slide-in-from-right-8 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Monedas</h2>
          <p className="text-gray-500">Define la moneda base y las adicionales.</p>
        </div>
        <button
          onClick={() =>
            setCurrencies(prev => [
              ...prev,
              { code: '', name: '', symbol: '', rate: 1, isEnabled: true }
            ])
          }
          className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold"
        >
          + Agregar moneda
        </button>
      </div>

      <div className="space-y-3">
        {currencies.map((currency, index) => (
          <div key={`${currency.code}-${index}`} className="grid grid-cols-12 gap-3 items-center bg-white border border-gray-200 rounded-2xl p-4">
            <div className="col-span-1 flex items-center justify-center">
              <input
                type="radio"
                name="baseCurrency"
                checked={defaultCurrencyCode === currency.code && !!currency.code}
                onChange={() => {
                  setDefaultCurrencyCode(currency.code);
                  setConfig(prev => ({ ...prev, currencySymbol: currency.symbol || prev.currencySymbol }));
                }}
              />
            </div>
            <input
              className="col-span-2 p-2 border rounded-lg text-sm"
              placeholder="Código"
              value={currency.code}
              onChange={(e) => {
                const value = e.target.value.toUpperCase();
                updateCurrency(index, { code: value });
                if (!defaultCurrencyCode || defaultCurrencyCode === currency.code) {
                  setDefaultCurrencyCode(value);
                }
              }}
            />
            <input
              className="col-span-3 p-2 border rounded-lg text-sm"
              placeholder="Nombre"
              value={currency.name}
              onChange={(e) => updateCurrency(index, { name: e.target.value })}
            />
            <input
              className="col-span-2 p-2 border rounded-lg text-sm"
              placeholder="Símbolo"
              value={currency.symbol}
              onChange={(e) => {
                const symbol = e.target.value;
                updateCurrency(index, { symbol });
                if (currency.code === defaultCurrencyCode) {
                  setConfig(prev => ({ ...prev, currencySymbol: symbol }));
                }
              }}
            />
            <input
              className="col-span-2 p-2 border rounded-lg text-sm"
              type="number"
              step="0.0001"
              placeholder="Tasa"
              value={currency.rate}
              onChange={(e) => updateCurrency(index, { rate: Number(e.target.value) })}
            />
            <div className="col-span-2 flex justify-end">
              <button
                onClick={() => {
                  setCurrencies(prev => {
                    const next = prev.filter((_, i) => i !== index);
                    if (defaultCurrencyCode === currency.code) {
                      setDefaultCurrencyCode(next[0]?.code || '');
                    }
                    return next;
                  });
                }}
                className="text-sm text-red-500 font-bold"
              >
                Quitar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderTaxesStep = () => (
    <div className="space-y-6 animate-in slide-in-from-right-8 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Impuestos</h2>
          <p className="text-gray-500">Configura tasas e identifica la principal.</p>
        </div>
        <button
          onClick={() => setTaxes(prev => [...prev, { id: makeId('tax'), name: 'Nuevo impuesto', rate: 0, type: 'VAT' }])}
          className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold"
        >
          + Agregar impuesto
        </button>
      </div>

      <div className="space-y-3">
        {taxes.map((tax, index) => (
          <div key={tax.id} className="grid grid-cols-12 gap-3 items-center bg-white border border-gray-200 rounded-2xl p-4">
            <input
              className="col-span-5 p-2 border rounded-lg text-sm"
              value={tax.name}
              onChange={(e) => updateTax(index, { name: e.target.value })}
            />
            <input
              className="col-span-3 p-2 border rounded-lg text-sm"
              type="number"
              step="0.01"
              value={Number.isFinite(tax.rate) ? tax.rate * 100 : 0}
              onChange={(e) => {
                const percentValue = Number(e.target.value || 0);
                updateTax(index, { rate: percentValue / 100 });
              }}
            />
            <select
              className="col-span-3 p-2 border rounded-lg text-sm"
              value={tax.type}
              onChange={(e) => updateTax(index, { type: e.target.value as TaxDefinition['type'] })}
            >
              <option value="VAT">IVA/ITBIS</option>
              <option value="SERVICE_CHARGE">Propina</option>
              <option value="EXEMPT">Exento</option>
              <option value="OTHER">Otro</option>
            </select>
            <button
              onClick={() => setTaxes(prev => prev.filter((_, i) => i !== index))}
              className="col-span-1 text-sm text-red-500 font-bold justify-self-end"
            >
              Quitar
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  const renderWarehousesStep = () => (
    <div className="space-y-6 animate-in slide-in-from-right-8 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Almacenes</h2>
          <p className="text-gray-500">Define almacenes y selecciona el principal.</p>
        </div>
        <button
          onClick={() => {
            const warehouseId = makeId('wh');
            setWarehouses(prev => [
              ...prev,
              {
                id: warehouseId,
                code: '',
                name: 'Nuevo almacén',
                type: 'PHYSICAL',
                address: '',
                allowPosSale: true,
                allowNegativeStock: false,
                erpWarehouseId: warehouseId,
              }
            ]);
          }}
          className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold"
        >
          + Agregar almacén
        </button>
      </div>

      <div className="space-y-3">
        {warehouses.map((warehouse, index) => (
          <div key={warehouse.id} className="grid grid-cols-12 gap-3 items-center bg-white border border-gray-200 rounded-2xl p-4">
            <div className="col-span-1 flex items-center justify-center">
              <input
                type="radio"
                name="defaultWarehouse"
                checked={defaultWarehouseId === warehouse.id}
                onChange={() => setDefaultWarehouseId(warehouse.id)}
              />
            </div>
            <input
              className="col-span-2 p-2 border rounded-lg text-sm"
              placeholder="Código"
              value={warehouse.code}
              onChange={(e) => updateWarehouse(index, { code: e.target.value })}
            />
            <input
              className="col-span-4 p-2 border rounded-lg text-sm"
              placeholder="Nombre"
              value={warehouse.name}
              onChange={(e) => updateWarehouse(index, { name: e.target.value })}
            />
            <input
              className="col-span-3 p-2 border rounded-lg text-sm"
              placeholder="Dirección"
              value={warehouse.address}
              onChange={(e) => updateWarehouse(index, { address: e.target.value })}
            />
            <div className="col-span-2 flex justify-end gap-3">
              <label className="text-xs text-gray-500 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={warehouse.allowPosSale}
                  onChange={(e) => updateWarehouse(index, { allowPosSale: e.target.checked })}
                />
                POS
              </label>
              <button
                onClick={() =>
                  setWarehouses(prev => {
                    const next = prev.filter((_, i) => i !== index);
                    if (defaultWarehouseId === warehouse.id) {
                      setDefaultWarehouseId(next[0]?.id || '');
                    }
                    return next;
                  })
                }
                className="text-sm text-red-500 font-bold"
              >
                Quitar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderTariffsStep = () => (
    <div className="space-y-6 animate-in slide-in-from-right-8 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Tarifas</h2>
          <p className="text-gray-500">Configura precios y selecciona la tarifa base.</p>
        </div>
        <button
          onClick={() =>
            setTariffs(prev => [
              ...prev,
              {
                id: makeId('trf'),
                name: 'Nueva tarifa',
                active: true,
                currency: defaultCurrencyCode || currencies[0]?.code || DEFAULT_BASE_CURRENCY.code,
                taxIncluded: true,
                strategy: { type: 'MANUAL', rounding: 'NONE' },
                scope: { storeIds: ['ALL'], priority: 0 },
                schedule: { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], timeStart: '00:00', timeEnd: '23:59' },
                items: {}
              }
            ])
          }
          className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold"
        >
          + Agregar tarifa
        </button>
      </div>

      <div className="space-y-3">
        {tariffs.map((tariff, index) => (
          <div key={tariff.id} className="grid grid-cols-12 gap-3 items-center bg-white border border-gray-200 rounded-2xl p-4">
            <div className="col-span-1 flex items-center justify-center">
              <input
                type="radio"
                name="defaultTariff"
                checked={defaultTariffId === tariff.id}
                onChange={() => setDefaultTariffId(tariff.id)}
              />
            </div>
            <input
              className="col-span-4 p-2 border rounded-lg text-sm"
              value={tariff.name}
              onChange={(e) => updateTariff(index, { name: e.target.value })}
            />
            <select
              className="col-span-2 p-2 border rounded-lg text-sm"
              value={tariff.currency}
              onChange={(e) => updateTariff(index, { currency: e.target.value })}
            >
              {currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code}
                </option>
              ))}
            </select>
            <select
              className="col-span-3 p-2 border rounded-lg text-sm"
              value={tariff.strategy.rounding}
              onChange={(e) =>
                updateTariff(index, { strategy: { ...tariff.strategy, rounding: e.target.value as Tariff['strategy']['rounding'] } })
              }
            >
              <option value="NONE">Sin redondeo</option>
              <option value="ROUND_HALF_UP">Redondeo normal</option>
              <option value="ROUND_FLOOR">Redondear abajo</option>
              <option value="CEILING">Redondear arriba</option>
              <option value="ENDING_99">Finalizar en .99</option>
            </select>
            <div className="col-span-2 flex justify-end">
              <button
                onClick={() =>
                  setTariffs(prev => {
                    const next = prev.filter((_, i) => i !== index);
                    if (defaultTariffId === tariff.id) {
                      setDefaultTariffId(next[0]?.id || '');
                    }
                    return next;
                  })
                }
                className="text-sm text-red-500 font-bold"
              >
                Quitar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderPaymentsStep = () => (
    <div className="space-y-6 animate-in slide-in-from-right-8 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Medios de Pago</h2>
          <p className="text-gray-500">Define tus métodos y reglas de redondeo.</p>
        </div>
        <button
          onClick={() =>
            setPaymentMethods(prev => [
              ...prev,
              {
                id: makeId('pay'),
                name: 'Nuevo método',
                type: 'CASH',
                isEnabled: true,
                icon: 'Banknote',
                color: 'bg-gray-500',
                opensDrawer: false,
                requiresSignature: false,
                integration: 'NONE',
                foreignCurrencyRounding: 'NONE'
              }
            ])
          }
          className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold"
        >
          + Agregar método
        </button>
      </div>

      <div className="space-y-3">
        {paymentMethods.map((payment, index) => (
          <div key={payment.id} className="grid grid-cols-12 gap-3 items-center bg-white border border-gray-200 rounded-2xl p-4">
            <input
              className="col-span-4 p-2 border rounded-lg text-sm"
              value={payment.name}
              onChange={(e) => updatePayment(index, { name: e.target.value })}
            />
            <select
              className="col-span-3 p-2 border rounded-lg text-sm"
              value={payment.type}
              onChange={(e) => updatePayment(index, { type: e.target.value as PaymentMethodDefinition['type'] })}
            >
              <option value="CASH">Efectivo</option>
              <option value="CARD">Tarjeta</option>
              <option value="QR">QR</option>
              <option value="WALLET">Billetera</option>
              <option value="ADVANCE">Anticipo</option>
              <option value="CREDIT">Crédito</option>
              <option value="STORE_CREDIT">Crédito tienda</option>
              <option value="OTHER">Otro</option>
            </select>
            <select
              className="col-span-3 p-2 border rounded-lg text-sm"
              value={payment.foreignCurrencyRounding || 'NONE'}
              onChange={(e) => updatePayment(index, { foreignCurrencyRounding: e.target.value as PaymentMethodDefinition['foreignCurrencyRounding'] })}
            >
              <option value="NONE">Sin redondeo</option>
              <option value="UP">Redondear arriba</option>
              <option value="DOWN">Redondear abajo</option>
              <option value="ZERO_DECIMALS">A 0 decimales</option>
            </select>
            <div className="col-span-2 flex justify-end">
              <button
                onClick={() => setPaymentMethods(prev => prev.filter((_, i) => i !== index))}
                className="text-sm text-red-500 font-bold"
              >
                Quitar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const buildSeriesWithStation = (seriesList: DocumentSeries[]) => {
    const station = stationNumber.padStart(2, '0');
    return seriesList.map((series) => ({
      ...series,
      prefix: series.prefix ? `${series.prefix}-${station}` : series.prefix
    }));
  };

  const renderSeriesStep = () => (
    <div className="space-y-6 animate-in slide-in-from-right-8 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Series de Documentos</h2>
          <p className="text-gray-500">Define prefijos y numeración por tipo.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setDocumentSeries(buildSeriesWithStation(SUGGESTED_DOCUMENT_SERIES.map(series => ({ ...series }))))}
            className="px-4 py-2 rounded-xl border border-blue-200 text-blue-600 text-sm font-bold"
          >
            Sugerir series
          </button>
          <button
            onClick={() =>
              setDocumentSeries(prev => [
                ...prev,
                {
                  id: makeId('series'),
                  documentType: 'TICKET',
                  name: 'Nueva serie',
                  description: '',
                  prefix: '',
                  nextNumber: 1,
                  padding: 6,
                  icon: 'FileText',
                  color: 'blue'
                }
              ])
            }
            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold"
          >
            + Agregar serie
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {documentSeries.map((series, index) => (
          <div key={series.id} className="grid grid-cols-12 gap-3 items-center bg-white border border-gray-200 rounded-2xl p-4">
            <select
              className="col-span-3 p-2 border rounded-lg text-sm"
              value={series.documentType}
              onChange={(e) =>
                updateSeries(index, {
                  documentType: e.target.value as DocumentSeries['documentType'],
                  id: e.target.value
                })
              }
            >
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              className="col-span-3 p-2 border rounded-lg text-sm"
              value={series.prefix}
              onChange={(e) => updateSeries(index, { prefix: e.target.value })}
              placeholder="Prefijo"
            />
            <input
              className="col-span-2 p-2 border rounded-lg text-sm"
              type="number"
              value={series.nextNumber}
              onChange={(e) => updateSeries(index, { nextNumber: Number(e.target.value) })}
            />
            <input
              className="col-span-2 p-2 border rounded-lg text-sm"
              type="number"
              value={series.padding}
              onChange={(e) => updateSeries(index, { padding: Number(e.target.value) })}
            />
            <input
              className="col-span-1 p-2 border rounded-lg text-sm"
              value={series.name}
              onChange={(e) => updateSeries(index, { name: e.target.value })}
            />
            <button
              onClick={() => setDocumentSeries(prev => prev.filter((_, i) => i !== index))}
              className="col-span-1 text-sm text-red-500 font-bold justify-self-end"
            >
              Quitar
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  const renderCatalogStep = () => (
    <div className="space-y-6 animate-in slide-in-from-right-8 duration-500 h-full flex flex-col">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold text-gray-800">Importación de Catálogo</h2>
        <p className="text-gray-500">Carga tus productos masivamente o salta este paso.</p>
      </div>

      {!isMappingMode ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <label className="w-full max-w-lg aspect-video border-2 border-dashed border-gray-300 rounded-3xl bg-gray-50 hover:bg-blue-50 hover:border-blue-400 transition-all cursor-pointer flex flex-col items-center justify-center group relative overflow-hidden">
            <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="p-4 bg-white rounded-full shadow-sm mb-4 group-hover:scale-110 transition-transform">
              <UploadCloud size={32} className="text-blue-500" />
            </div>
            <h3 className="font-bold text-gray-700 text-lg">Arrastra tu Excel o CSV aquí</h3>
            <p className="text-gray-400 text-sm mt-2">o haz click para buscar</p>
            <input type="file" className="hidden" accept=".csv,.xlsx" onChange={handleFileUpload} />
          </label>
          <div className="mt-8 flex gap-4 text-sm text-gray-400">
            <span className="flex items-center gap-2"><FileSpreadsheet size={16} /> Plantilla CSV</span>
            <span className="flex items-center gap-2"><FileSpreadsheet size={16} /> Plantilla Excel</span>
          </div>
        </div>
      ) : (
        <div className="flex-1 bg-white border border-gray-200 rounded-2xl overflow-hidden flex flex-col shadow-sm">
          {/* Header Bar */}
          <div className="bg-gray-50 p-4 border-b border-gray-200 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="bg-green-100 text-green-700 p-2 rounded-lg"><FileSpreadsheet size={20} /></div>
              <div>
                <p className="font-bold text-gray-800 text-sm truncate max-w-[200px]">{importFile?.name}</p>
                <p className="text-xs text-gray-500">Detectadas {DETECTED_CSV_HEADERS.length} columnas</p>
              </div>
            </div>
            <button 
              onClick={handleAutoMap} 
              disabled={isAutoMatching}
              className="text-blue-600 text-sm font-bold flex items-center gap-2 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              <Wand2 size={16} className={isAutoMatching ? 'animate-spin' : ''} /> 
              {isAutoMatching ? 'Analizando...' : 'Auto-Match'}
            </button>
          </div>
          
          {/* Mapping Table */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="grid grid-cols-12 gap-4 mb-4 px-2">
              <div className="col-span-5 text-xs font-bold text-gray-400 uppercase tracking-wider">Columna Archivo</div>
              <div className="col-span-2 flex justify-center text-xs font-bold text-gray-400 uppercase tracking-wider">Estado</div>
              <div className="col-span-5 text-xs font-bold text-gray-400 uppercase tracking-wider">Campo en Sistema</div>
            </div>

            {DETECTED_CSV_HEADERS.map((header, idx) => {
              const mappedFieldId = columnMapping[header];
              const isMapped = mappedFieldId && mappedFieldId !== 'ignore';
              
              return (
                <div key={idx} className="grid grid-cols-12 gap-4 items-center mb-3 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50/50 rounded-lg px-2 transition-colors">
                  {/* Left: CSV Header */}
                  <div className="col-span-5">
                    <div className="bg-gray-100 text-gray-700 px-3 py-2.5 rounded-xl text-sm font-medium border border-gray-200 flex items-center gap-2">
                      <FileSpreadsheet size={14} className="text-gray-400" />
                      {header}
                    </div>
                  </div>

                  {/* Center: Status Indicator */}
                  <div className="col-span-2 flex justify-center">
                    {isMapped ? (
                      <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center animate-in zoom-in">
                        <Check size={16} strokeWidth={3} />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-300 flex items-center justify-center">
                        <ArrowRight size={16} />
                      </div>
                    )}
                  </div>

                  {/* Right: Dropdown Selector */}
                  <div className="col-span-5 relative">
                    <select
                      value={mappedFieldId || 'ignore'}
                      onChange={(e) => handleManualMapChange(header, e.target.value)}
                      className={`
                        w-full appearance-none px-3 py-2.5 rounded-xl text-sm font-bold border outline-none transition-all cursor-pointer
                        ${isMapped 
                          ? 'bg-blue-50 text-blue-700 border-blue-200 hover:border-blue-300 focus:ring-2 focus:ring-blue-200' 
                          : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300 focus:ring-2 focus:ring-gray-100'
                        }
                      `}
                    >
                      {SYSTEM_FIELDS.map(field => (
                        <option key={field.id} value={field.id}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <ChevronDown size={16} className={isMapped ? 'text-blue-500' : 'text-gray-400'} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          <div className="bg-blue-50/50 p-3 text-center border-t border-blue-100">
             <p className="text-xs text-blue-600 font-medium flex items-center justify-center gap-2">
                <AlertCircle size={14} />
                Asegúrate de revisar todas las columnas antes de continuar.
             </p>
          </div>
        </div>
      )}
    </div>
  );

  const renderReadyStep = () => (
    <div className="flex flex-col items-center justify-center text-center space-y-8 animate-in zoom-in duration-500 py-10">
      <div className="relative">
        <div className="absolute inset-0 bg-green-500 blur-3xl opacity-20 rounded-full animate-pulse"></div>
        <div className="bg-white p-6 rounded-full shadow-xl relative z-10">
          <CheckCircle2 size={80} className="text-green-500" />
        </div>
      </div>
      
      <div className="space-y-2">
        <h2 className="text-3xl font-black text-gray-800">¡Todo Listo!</h2>
        <p className="text-gray-500 max-w-xs mx-auto">
          Hemos configurado tu punto de venta. Ya puedes empezar a vender.
        </p>
      </div>

      <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 w-full max-w-sm text-left space-y-3">
        <div className="flex justify-between border-b border-gray-200 pb-2">
          <span className="text-gray-500 text-sm">Negocio</span>
          <span className="font-bold text-gray-800">{config.companyInfo.name || 'Sin nombre'}</span>
        </div>
        <div className="flex justify-between border-b border-gray-200 pb-2">
          <span className="text-gray-500 text-sm">Terminal</span>
          <span className="font-bold text-gray-800">{DEVICE_ROLE_OPTIONS.find(option => option.role === deviceRole)?.label || 'POS estándar'}</span>
        </div>
        <div className="flex justify-between border-b border-gray-200 pb-2">
          <span className="text-gray-500 text-sm">Dispositivo</span>
          <span className="font-bold text-gray-800">{DEVICE_PROFILE_OPTIONS.find(option => option.formFactor === deviceProfile.formFactor)?.label || 'POS normal'}</span>
        </div>
        <div className="flex justify-between border-b border-gray-200 pb-2">
          <span className="text-gray-500 text-sm">Moneda</span>
          <span className="font-bold text-gray-800">{config.currencySymbol}</span>
        </div>
        <div className="flex justify-between border-b border-gray-200 pb-2">
          <span className="text-gray-500 text-sm">Artículos</span>
          <span className="font-bold text-gray-800">
            {selectedProductPack ? `${selectedProductPack.label} (${selectedProductPack.items.length})` : 'Sin artículos'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 text-sm">Vertical</span>
          <span className="font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-xs uppercase">{config.subVertical}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-4xl bg-white rounded-[2rem] shadow-2xl overflow-hidden flex flex-col h-[700px] max-h-[90vh]">
        
        {/* Header - Progress Stepper */}
        <div className="bg-gray-50/50 border-b border-gray-100 px-8 py-6">
          <div className="flex justify-between relative">
            {/* Connecting Line */}
            <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-200 -z-0 rounded-full transform -translate-y-1/2"></div>
            <div 
              className="absolute top-1/2 left-0 h-1 bg-blue-600 -z-0 rounded-full transform -translate-y-1/2 transition-all duration-500"
              style={{ width: `${(STEPS.findIndex(s => s.id === currentStep) / (STEPS.length - 1)) * 100}%` }}
            ></div>

            {STEPS.map((step, idx) => {
              const isActive = step.id === currentStep;
              const isCompleted = STEPS.findIndex(s => s.id === currentStep) > idx;
              
              return (
                <div key={step.id} className="relative z-10 flex flex-col items-center gap-2">
                  <div 
                    className={`
                      w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 border-4
                      ${isActive 
                        ? 'bg-blue-600 text-white border-blue-100 shadow-lg scale-110' 
                        : isCompleted 
                          ? 'bg-green-500 text-white border-green-100' 
                          : 'bg-white text-gray-400 border-gray-200'
                      }
                    `}
                  >
                    {isCompleted ? <Check size={18} strokeWidth={3} /> : <step.icon size={18} />}
                  </div>
                  <span className={`text-xs font-bold transition-colors ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-8 overflow-y-auto relative">
          {currentStep === 'SEED' && renderSeedStep()}
          {currentStep === 'BUSINESS' && renderBusinessStep()}
          {currentStep === 'TERMINAL' && renderTerminalStep()}
          {currentStep === 'CURRENCIES' && renderCurrenciesStep()}
          {currentStep === 'CATALOG' && renderCatalogStep()}
          {currentStep === 'TAXES' && renderTaxesStep()}
          {currentStep === 'WAREHOUSES' && renderWarehousesStep()}
          {currentStep === 'TARIFFS' && renderTariffsStep()}
          {currentStep === 'PAYMENTS' && renderPaymentsStep()}
          {currentStep === 'SERIES' && renderSeriesStep()}
          {currentStep === 'READY' && renderReadyStep()}
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-gray-100 flex justify-between items-center bg-white">
          <button
            onClick={currentStep === 'SEED' ? onCancel : handleBack}
            disabled={(currentStep === 'SEED' && !onCancel) || currentStep === 'READY'}
            className={`
              flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-gray-500 transition-colors
              ${(currentStep === 'SEED' && !onCancel) || currentStep === 'READY' ? 'opacity-0 pointer-events-none' : 'hover:bg-gray-100'}
            `}
          >
            <ArrowLeft size={20} /> {currentStep === 'SEED' ? 'Cancelar configuración local' : 'Atrás'}
          </button>

          <button 
            onClick={handleNext}
            className={`
              flex items-center gap-2 px-8 py-3 rounded-xl font-bold text-white shadow-lg transition-all active:scale-95
              ${currentStep === 'READY' 
                ? 'bg-green-600 hover:bg-green-500 shadow-green-500/30 w-full md:w-auto justify-center' 
                : 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/30'
              }
            `}
          >
            {currentStep === 'READY' ? 'Empezar a Vender' : 'Continuar'} 
            {currentStep !== 'READY' && <ArrowRight size={20} />}
          </button>
        </div>

      </div>
    </div>
  );
};

export default SetupWizard;
