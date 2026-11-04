

export type VerticalType = 'RETAIL' | 'RESTAURANT';

export const SubVertical = {
  SUPERMARKET: 'Supermercado',
  CLOTHING: 'Tienda Ropa',
  PHARMACY: 'Farmacia',
  SERVICES: 'Servicios',
  RESTAURANT: 'Restaurante',
  FAST_FOOD: 'Fast Food',
  BAR: 'Discoteca/Bar'
} as const;

export type SubVertical = typeof SubVertical[keyof typeof SubVertical];

export interface ServiceType {
  id: string;
  name: string; // Internal codename/value
  label: string; // Display name
  nature: 'CRM' | 'BOOKING';
  color?: string;
  icon?: string;
  isActive: boolean;
  defaultDuration?: number; // In minutes
  basePrice?: number;
  requiresSpace?: boolean; // For BOOKING nature
  order?: number; // For drag and drop sorting

  // Suggested Action Fields
  next_suggested_type_id?: string;
  suggested_interval?: number;
  suggested_interval_unit?: 'HOURS' | 'DAYS';
}

export type OpportunityStage = 'NEW' | 'CONTACTED' | 'QUOTED' | 'WON' | 'LOST';

export interface Opportunity {
  id: string;
  title: string;
  customer_id?: string;
  customerId?: string;
  customer_name?: string;
  customerName?: string;
  assigned_user_id?: string;
  assignedUserId?: string;
  assigned_user_name?: string;
  assignedUserName?: string;
  stage: OpportunityStage;
  amount: number;
  probability: number;
  expected_close_date?: string;
  expectedCloseDate?: string;
  source?: 'POS' | 'ERP' | 'WEB' | 'MANUAL';
  notes?: string;
  lost_reason?: string;
  lostReason?: string;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  syncStatus?: SyncStatus;
}

export type BookingSalesDocumentType = 'QUOTE' | 'SALES_ORDER' | 'INVOICE';

export interface BookingSalesDocumentLine {
  id: string;
  itemId?: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  source: 'SPACE' | 'ITEM' | 'SERVICE';
}

export interface BookingSalesDocument {
  id: string;
  displayId: string;
  documentType: BookingSalesDocumentType;
  status: 'DRAFT' | 'APPROVED' | 'INVOICED' | 'CANCELLED';
  bookingActivityId: string;
  opportunityId?: string;
  customerId?: string;
  customerName?: string;
  date: string;
  expectedDate?: string;
  subtotal: number;
  total: number;
  lines: BookingSalesDocumentLine[];
  notes?: string;
  createdBy?: string;
  terminalId?: string;
  syncStatus?: SyncStatus;
}

// --- SYNC CONFIGURATION TYPES ---
export type SyncMode = 'MASTER' | 'SLAVE';
export type SyncStatus =
  | 'PENDING'
  | 'SYNCING'
  | 'COMPLETED'
  | 'ERROR'
  | 'SYNCED_CLOUD'
  | 'SYNCED_ACTIVE'
  | 'SYNCED_MASTER'
  | 'APPLIED_ERP'
  | 'RETRY_WAIT'
  | 'BLOCKED_FUNCTIONAL'
  | 'FAILED_FINAL';
export type CloudSyncStatus = 'PENDING' | 'SYNCED' | 'ERROR';

export interface SyncConfig {
  mode: SyncMode;
  masterUrl?: string; // Required for SLAVE terminals (e.g., "https://192.168.1.100:3001")
  authToken?: string;
  autoSyncIntervalMs: number;
  isEnabled: boolean;
}


// --- DEVICE ROLE TYPES ---
export enum DeviceRole {
  STANDARD_POS = 'STANDARD_POS',
  ORDER_TAKER = 'ORDER_TAKER',
  SELF_CHECKOUT = 'SELF_CHECKOUT',
  PRICE_CHECKER = 'PRICE_CHECKER',
  HANDHELD_INVENTORY = 'HANDHELD_INVENTORY',
  KITCHEN_DISPLAY = 'KITCHEN_DISPLAY'
}

export enum AuthLevel {
  USER_REQUIRED = 'USER_REQUIRED',    // Level A: Requiere login de empleado
  HEADLESS = 'HEADLESS'                // Level B: Autenticación automática vía API Token
}

export enum DeviceFormFactor {
  DESKTOP_POS = 'DESKTOP_POS',
  TABLET = 'TABLET',
  HANDHELD = 'HANDHELD',
  KIOSK = 'KIOSK'
}

export enum DeviceOrientation {
  AUTO = 'AUTO',
  PORTRAIT = 'PORTRAIT',
  LANDSCAPE = 'LANDSCAPE'
}

export interface DeviceProfile {
  formFactor: DeviceFormFactor;
  orientation: DeviceOrientation;
  touchOptimized: boolean;
}

export interface DeviceRoleConfig {
  role: DeviceRole;
  authLevel: AuthLevel;
  apiToken?: string;              // Para autenticación headless
  defaultRoute?: string;          // Ruta inicial después de auth
  allowedModules: string[];       // Módulos permitidos
  uiSettings: {
    fullscreenForced?: boolean;
    touchTargetSize?: number;    // En px (>60px recomendado para kiosco)
    navigationLocked?: boolean;   // Prevenir navegación hacia atrás
    escapeHatch?: {
      enabled: boolean;
      gesture: string;            // ej: "logo-press-5s"
      requirePin: boolean;
      adminPin?: string;
    };
  };
  hardwareConfig?: {
    disablePrinter?: boolean;
    disableCashDrawer?: boolean;
    disableScanner?: boolean;
  };
}

// --- HARDWARE TYPES ---
export type ConnectionType = 'BLUETOOTH' | 'NETWORK' | 'USB' | 'SERIAL' | 'VIRTUAL';

export interface PrinterDevice {
  id: string;
  name: string;
  connection: ConnectionType;
  address?: string; // IP o MAC
  status: 'CONNECTED' | 'DISCONNECTED';
  type: 'TICKET' | 'LABEL' | 'KITCHEN' | 'LOGISTICS';
  productionAreaId?: string;
}

export type FingerprintDriver =
  | 'AUTO'
  | 'WEBAUTHN'
  | 'DIGITAL_PERSONA'
  | 'SECUGEN'
  | 'ZKTECO'
  | 'SUPREMA'
  | 'FUTRONIC'
  | 'NITGEN';

export interface FingerprintReaderConfig {
  isEnabled: boolean;
  connectionType: Extract<ConnectionType, 'USB' | 'SERIAL' | 'NETWORK'>;
  port: string;
  driver: FingerprintDriver;
  notes?: string;
}

/** Dispositivo USB/red detectado por el bridge nativo (misma familia que impresoras). */
export interface FingerprintDiscoveredDevice {
  id: string;
  name: string;
  connection: ConnectionType;
  address: string;
  vendorId?: number;
  productId?: number;
  status?: string;
}

// --- FISCAL NCF TYPES ---
export type NCFType = 'B01' | 'B02' | 'B04' | 'B14' | 'B15';
export type ElectronicNCFType = 'E31' | 'E32' | 'E34' | 'E44' | 'E45';
export type FiscalDocumentCode = NCFType | ElectronicNCFType;
export type FiscalMode = 'NONE' | 'LEGACY_B' | 'ECF';
export type FiscalProviderId = 'NONE' | 'POLARIS' | 'DIGIFACT';
export type FiscalProviderEnvironment = 0 | 1 | 2 | 3;
export type FiscalProviderDeliveryMode = 'LOCAL_DIRECT' | 'DELEGATED_ERP';

export interface FiscalProviderConfig {
  id: FiscalProviderId;
  enabled: boolean;
  environment?: FiscalProviderEnvironment;
  displayName?: string;
  deliveryMode?: FiscalProviderDeliveryMode;
  apiBaseUrl?: string;
  testUrl?: string;
  issueUrl?: string;
  statusUrl?: string;
  credentialKey?: string;
  establishmentCode?: string;
  branchCode?: string;
  branchName?: string;
  cashierCode?: string;
  tipoIngreso?: number;
  modificationCode?: number;
  unitCodeGoods?: number;
  unitCodeServices?: number;
}

export interface FiscalReserveAlertConfig {
  quantity?: number;
  percent?: number;
}

export interface FiscalComplianceConfig {
  mode: FiscalMode;
  defaultProvider: FiscalProviderId;
  allowLegacyFallback: boolean;
  providers: FiscalProviderConfig[];
  reserveAlert?: FiscalReserveAlertConfig;
}

export interface FiscalRangeDGII {
  id: string;
  type: FiscalDocumentCode;
  prefix: string;
  startNumber: number;
  endNumber: number;
  currentGlobal: number; // Último entregado a cualquier terminal
  expiryDate: string;
  isActive: boolean;
}

export interface FiscalAllocation {
  id: string;
  terminalId: string;
  fiscalRangeId: string;
  ncfType: FiscalDocumentCode;
  reservedStart: number;
  reservedEnd: number;
  nextNumber: number;
  status: 'ACTIVE' | 'PAUSED' | 'EXHAUSTED' | 'RELEASED' | 'CONFLICTED' | 'LEGACY';
  releasedAt: string | null;
  prefix?: string;
  metadata?: Record<string, any>;
}

export interface LocalFiscalBuffer {
  id: string;
  type: FiscalDocumentCode;
  prefix: string;
  currentNumber: number; // El que se usará en la próxima factura
  endNumber: number;     // Límite de este lote
  expiryDate: string;
  startNumber?: number;
  terminalId?: string;
  fiscalRangeId?: string;
  allocationId?: string;
}

// --- KARDEX TYPES ---
export type LedgerConcept = 'COMPRA' | 'VENTA' | 'AJUSTE_ENTRADA' | 'AJUSTE_SALIDA' | 'TRASPASO_ENTRADA' | 'TRASPASO_SALIDA' | 'INICIAL' | 'DEVOLUCION' | 'DEVOLUCIÓN_VENTA' | 'TRASPASO_AJUSTE_DIFERENCIA';

export interface InventoryCountItem {
  productId: string;
  productName: string;
  category?: string;
  systemQty: number;
  countedQty: number;
  difference: number;
}

export interface InventoryCountSnapshotItem {
  productId: string;
  productName: string;
  category?: string;
  systemQty: number;
  avgCost: number;
}

export interface InventoryCountSession {
  id: string;
  warehouseId: string;
  warehouseName?: string;
  createdAt: string;
  finalizedAt?: string;
  status?: 'OPEN' | 'FINALIZED';
  createdBy?: string;
  createdByName?: string;
  systemSnapshot?: InventoryCountSnapshotItem[];
  items: InventoryCountItem[];
  cloudSyncStatus?: CloudSyncStatus;
  cloudSyncError?: string;
  cloudSyncedAt?: string;
}

export interface InventorySnapshotItem {
  productId: string;
  productName: string;
  category?: string;
  warehouseId: string;
  qty: number;
  avgCost: number;
  value: number;
}

export interface InventorySnapshot {
  id: string;
  label: string;
  warehouseId: string;
  categoryId?: string;
  createdAt: string;
  closedAt: string;
  cutoffDate?: string;
  lockDate?: string;
  immutable?: boolean;
  status: 'CLOSED' | 'REOPENED';
  createdBy?: string;
  createdByName?: string;
  items: InventorySnapshotItem[];
  totalValue: number;
  reopenedAt?: string;
  reopenedBy?: string;
  reopenedByName?: string;
  reopenReason?: string;
}

export interface InventoryAuditLog {
  id: string;
  sessionId: string;
  warehouseId: string;
  productId?: string;
  productName?: string;
  category?: string;
  systemQty?: number;
  countedQty?: number;
  diffQty?: number;
  action: 'COUNT' | 'APPLY' | 'CLOSE' | 'REOPEN';
  createdAt: string;
  createdBy?: string;
  createdByName?: string;
  reason?: string;
  details?: string;
  cloudSyncStatus?: CloudSyncStatus;
  cloudSyncError?: string;
  cloudSyncedAt?: string;
}

export interface InventoryLedgerEntry {
  id: string;
  createdAt: string;
  warehouseId: string;
  productId: string;
  concept: LedgerConcept;
  documentRef: string;
  qtyIn: number;
  qtyOut: number;
  unitCost: number;
  balanceQty: number;
  balanceAvgCost: number;
  terminalId?: string; // Terminal ID or Series
  source_channel?: 'POS';
  source_inventory_movement_id?: string;
  source_terminal_id?: string;
  device_id?: string;
  created_at?: string;
  syncStatus?: SyncStatus;
  syncError?: string;
  variantId?: string; // NEW: Specific variant ID
  variantName?: string; // NEW: Human readable variant detail (e.g. "Talla 40")
  trackingId?: string; // NEW: Assigned lot/serial ID
  trackingCode?: string; // NEW: Assigned lot/serial code
  cloudSyncStatus?: CloudSyncStatus;
  cloudSyncError?: string;
  cloudSyncedAt?: string;
}

// --- WATCHLIST & BI TYPES ---
export type WatchlistCriteria = 'MANUAL' | 'RECENT_IN' | 'DORMANT_STOCKS' | 'LOW_STOCK';

export interface WatchlistAlertSettings {
  maxDormancyDays: number;
  minVelocity: number;
  minSellThrough: number;
  criticalWeeksOfSupply: number;
  overstockWeeksOfSupply: number;
}

export interface Watchlist {
  id: string;
  name: string;
  description?: string;
  criteria: WatchlistCriteria;
  productIds: string[];
  createdAt: string;
  color?: string;
  alertSettings: WatchlistAlertSettings;
}

export interface WatchlistKPIs {
  productId: string;
  lastSaleDate: string | null;
  daysSinceLastSale: number;
  velocity7d: number;
  sellThrough: number;
  weeksOfSupply: number;
  totalSoldPeriod: number;
}

export type ScaleTech = 'DIRECT' | 'LABEL';

export interface TaxDefinition {
  id: string;
  code?: string;
  name: string;
  rate: number;
  type: 'VAT' | 'SERVICE_CHARGE' | 'EXEMPT' | 'OTHER';
}

export interface CompanyInfo {
  name: string;
  rnc: string;
  phone: string;
  address: string;
  email?: string;
  website?: string;
}

export interface ReceiptConfig {
  logo?: string;
  footerMessage?: string;
  showCustomerInfo?: boolean;
  showSavings?: boolean;
  showQr?: boolean;
  showForeignCurrencyTotals?: boolean;
  showSerialNumbers?: boolean; // NEW: Toggle printing serial numbers
  showLotNumbers?: boolean; // NEW: Toggle printing lot numbers
  showOrderNumber?: boolean;
  showVariantLabels?: boolean; // Default: print only variant values
  documentCopies?: {
    invoice?: number;
    creditNote?: number;
    kitchenOrder?: number;
    xReport?: number;
    zReport?: number;
    other?: number;
  };
}

// Document Types for all transaction categories
export type DocumentType =
  // Sales
  | 'TICKET'           // Regular sale
  | 'REFUND'           // Refund/Return
  | 'VOID'             // Voided transaction
  | 'COMPLIMENTARY'    // Invitation/courtesy with inventory impact and no fiscal emission

  // Inventory
  | 'TRANSFER'         // Transfer between warehouses
  | 'ADJUSTMENT_IN'    // Positive inventory adjustment
  | 'ADJUSTMENT_OUT'   // Negative inventory adjustment
  | 'PURCHASE'         // Purchase from supplier
  | 'PRODUCTION'       // Production/Assembly

  // Cash
  | 'CASH_IN'          // Cash in
  | 'CASH_OUT'         // Cash out
  | 'CASH_DEPOSIT'     // Bank deposit
  | 'CASH_WITHDRAWAL'  // Cash withdrawal

  // Closures
  | 'Z_REPORT'         // Cash register closure
  | 'X_REPORT'         // Partial report

  // Accounts
  | 'RECEIVABLE'       // Accounts receivable
  | 'PAYABLE'          // Accounts payable
  | 'PAYMENT_IN'       // Payment received
  | 'PAYMENT_OUT';     // Payment made

export interface DocumentSeries {
  id: string;
  /** Monotonic ERP counter revision used to prove post-reset continuity. */
  sequenceRevision?: string | number;
  /** Highest Z number durably committed by ERP for this exact scope/series. */
  lastCommittedNumber?: number;
  code?: string;
  documentType: DocumentType;  // Functional type
  name: string;
  description: string;
  prefix: string;
  nextNumber: number;
  padding: number;
  enabled?: boolean;
  source?: string;
  icon: string;
  color: string;
  businessUnit?: string;  // Optional: "Tienda Norte", "Caja Express"
}

export interface TerminalConfigResolvedPricingSnapshot {
  default_tariff_id?: string;
  allowed_tariff_ids?: string[];
  tariffs?: any[];
}

export interface TerminalConfigResolvedInventorySnapshot {
  default_warehouse_id?: string;
  transfer_warehouse_id?: string;
  allowed_warehouse_ids?: string[];
  default_warehouse?: any;
  warehouses?: any[];
}

export interface TerminalConfigResolvedDocumentsSnapshot {
  assignments?: Record<string, any> | any[];
  default_fiscal_range_id?: string;
  document_series?: any[];
  fiscal_ranges?: any[];
  fiscal_allocations?: any[];
}

export interface TerminalConfigResolvedCatalogSnapshot {
  allowed_categories?: string[] | any[];
  full_pull_on_pairing?: boolean;
}

export interface TerminalConfigResolvedLoyaltySnapshot {
  config?: any;
  campaigns?: any[];
  coupons?: any[];
}

export interface TerminalConfigResolvedSnapshot {
  company?: Record<string, any>;
  company_info?: Record<string, any>;
  companyInfo?: Record<string, any>;
  identity?: Record<string, any>;
  terminal?: Record<string, any>;
  deviceRole?: Record<string, any> | string;
  device_role?: Record<string, any> | string;
  role?: string;
  role_code?: string;
  device_role_code?: string;
  pricing?: TerminalConfigResolvedPricingSnapshot;
  inventory?: TerminalConfigResolvedInventorySnapshot;
  documents?: TerminalConfigResolvedDocumentsSnapshot;
  catalog?: TerminalConfigResolvedCatalogSnapshot;
  taxes?: TaxDefinition[];
  financial?: Record<string, any>;
  serviceTaxPolicies?: ServiceTaxPolicyMap;
  service_tax_policies?: ServiceTaxPolicyMap;
  /** Promociones ERP → POS (forma camelCase, ver `posPromotionsSnapshot.js`). */
  promotions?: any[];
  loyalty?: TerminalConfigResolvedLoyaltySnapshot;
}

export interface TerminalConfigSnapshot {
  terminal_id?: string;
  tenant_id?: string;
  company_id?: string;
  store_id?: string;
  device_id?: string;
  terminal_name?: string;
  station_number?: string | number;
  role?: string;
  company?: Record<string, any>;
  company_info?: Record<string, any>;
  companyInfo?: Record<string, any>;
  masters?: {
    items?: Record<string, any>[];
    customers?: Customer[];
    suppliers?: Supplier[];
    sellers?: Array<Record<string, any>>;
    users?: Array<Record<string, any>>;
    pos_users?: Array<Record<string, any>>;
    roles?: Array<Record<string, any>>;
    pos_roles?: Array<Record<string, any>>;
    purchaseOrders?: PurchaseOrder[];
    transfers?: StockTransfer[];
    [key: string]: any;
  };
  resolved?: TerminalConfigResolvedSnapshot;
  config?: Record<string, any>;
  resolution_error?: any;
}

export interface NCFConfig {
  batchSize: number;
  lowBatchThreshold: number;
  lowBatchThresholdPct?: number; // Umbral de alerta por porcentaje
}

export interface TerminalConfig {
  currentDeviceId?: string;
  lastPairingDate?: string;
  isBlocked?: boolean;
  deviceBindingToken: string;
  erpTerminalId?: string;
  terminalName?: string;
  stationNumber?: string | null;
  currencyCode?: string;
  primaryCurrencyCode?: string;
  currency?: string;
  allowedCurrencyCodes?: string[];
  allowed_currency_codes?: string[];
  currencyCodes?: string[];
  currency_codes?: string[];
  currencies?: {
    default?: string;
    base?: string;
    list: Array<CurrencyConfig & {
      exchange_rate: number;
      is_base: boolean;
      enabled: boolean;
    }>;
  };
  isPrimaryNode?: boolean; // Rol jerárquico de la terminal
  governedByMaster?: boolean; // NEW: If true, this terminal follows the configuration defined by the Master
  startWithAgenda?: boolean; // NEW: Boot directly into Agenda view
  deviceRole?: DeviceRoleConfig; // NEW: Configuración de rol de dispositivo
  deviceProfile?: DeviceProfile; // Formato físico y comportamiento visual, independiente del rol
  device_profile?: Partial<DeviceProfile> & Record<string, unknown>; // Contrato ERP snake_case
  terminalType?: 'STANDARD_POS' | 'ORDER_TAKER' | string;
  terminal_type?: 'STANDARD_POS' | 'ORDER_TAKER' | string;
  masterTerminalId?: string;
  master_terminal_id?: string;
  capabilities?: string[];
  restrictions?: string[];
  productionCenterId?: string;
  production_center_id?: string;

  fiscal: {
    enabled?: boolean;
    mode?: FiscalMode;
    fiscalMode?: FiscalMode;
    fiscal_mode?: FiscalMode;
    providerId?: FiscalProviderId;
    environment?: FiscalProviderEnvironment;
    deliveryMode?: FiscalProviderDeliveryMode;
    apiBaseUrl?: string;
    testUrl?: string;
    issueUrl?: string;
    statusUrl?: string;
    credentialKey?: string;
    establishmentCode?: string;
    branchCode?: string;
    branchName?: string;
    cashierCode?: string;
    tipoIngreso?: number;
    modificationCode?: number;
    unitCodeGoods?: number;
    unitCodeServices?: number;
    batchSize: number; // Deprecated but kept for compatibility
    lowBatchThreshold: number;
    // New: Configuration per NCF Type
    typeConfigs?: Partial<Record<FiscalDocumentCode, NCFConfig>>;
    defaultFiscalRangeId?: string;
    fiscalRanges?: FiscalRangeDGII[];
    fiscalAllocations?: FiscalAllocation[];
  };

  tables?: {
    behavior: 'SIEMPRE_MOSTRAR' | 'A_DEMANDA' | 'NO_MOSTRAR';
    defaultRoomId?: string;
    autoRedirectToMap?: boolean; // NEW: Redirect to map after order save
  };

  security: {
    deviceBindingToken: string;
    requirePinForVoid: boolean;
    requirePinForDiscount: boolean;
    requireManagerForRefunds: boolean;
    autoLogoutMinutes: number;
    reduceSyncAfterMinutes?: number;
    allowBiometrics?: boolean; // NEW: Biometric Auth Toggle
  };
  pricing: {
    allowedTariffIds: string[];
    defaultTariffId: string;
    tariffs?: Tariff[];
  };
  workflow: {
    inventory: {
      realTimeValidation: boolean;
      allowNegativeStock: boolean;
      reserveStockOnCart: boolean;
      showStockOnTiles: boolean;
      showProductImagesInReceipt: boolean;
    };
    session: {
      blindClose: boolean;
      allowSalesWithOpenZ: boolean;
      maxCashInDrawer: number;
      askGuestsOnTicketOpen: boolean;
      autoPrintZReport: boolean;
      /** Imprime un comprobante al registrar una entrada o salida de efectivo. */
      autoPrintCashMovementReceipt?: boolean;
      zReportEmails?: string;
      // New fields for Z Report Expansion
      checkOpenOrders: boolean;
      forceDenominationCount: boolean;
      cashVarianceThreshold: number;
      emailZReport: boolean;
      requireCashFundOnZ?: boolean;
      fixedCashFundAmount?: number;
      // New fields for Force Z on Day Change
      forceZChange: boolean;
      businessStartHour: number;
      /**
       * Si es false: sin monitor X en Finanzas, sin asignación de serie X (`documentAssignments.X_REPORT` se quita al aplicar snapshot ERP),
       * y las operaciones que validen `X_REPORT` fallan (ver `validateTerminalSeries`).
       */
      allowPartialXReport?: boolean;
      /** Secciones opcionales que se incluyen en cada cierre, configuradas por usuario y tipo de reporte. */
      closeReportOptionsByUser?: Record<string, {
        X?: CloseReportSection[];
        Z?: CloseReportSection[];
      }>;
      /** Formas no efectivas que deben ser declaradas manualmente durante el cierre Z. */
      zReportDeclaredPaymentMethodIds?: string[];
    };
    offline: {
      mode: 'OPTIMISTIC' | 'STRICT' | 'READ_ONLY';
      maxOfflineTransactionLimit: number;
    };
  };
  financial: {
    roundingMethod: 'ROUND_HALF_UP' | 'ROUND_FLOOR' | 'NONE';
    taxInclusivePrices: boolean;
    printTaxBreakdown: boolean;
    returnChangeInBaseCurrency: boolean;
    acceptedCurrencies: string[];
    /** Terminal-specific overrides over the POS-wide service policies. */
    serviceTaxPolicies?: ServiceTaxPolicyMap;
    service_tax_policies?: ServiceTaxPolicyMap;
  };
  documentSeries: DocumentSeries[];
  documentAssignments?: Record<string, string>; // Mapeo de Rol -> ID de DocumentSeries maestra
  hardware: {
    cashDrawerTrigger: 'PRINTER' | 'DIRECT';
    receiptPrinterId?: string;
    printerAssignments?: Record<string, string>; // Roles: TICKET, LABEL, KITCHEN, LOGISTICS
    customerDisplay?: CustomerDisplayConfig;
    scales?: ScaleDevice[];
    fingerprintReader?: FingerprintReaderConfig;
  };
  operational: {
    vertical_negocio: VerticalType;
    usa_mesas: boolean;
    pantalla_inicio: 'VENTA_DIRECTA' | 'MAPA_MESAS';
    bloqueo_meseros: boolean;
    pedir_comensales: boolean;
    usa_modulos_cocina: boolean;
    recibir_consignaciones?: boolean;
    receiveConsignments?: boolean;
    receive_consignments?: boolean;
    descargar_consignaciones?: boolean;
    defaultTaxIds?: string[];
    reservationPolicy?: {
      validityDays: number;
      printCopies: number;
      requireAdvance: boolean;
      minimumAdvancePercent: number;
    };
    deliveryAlerts?: {
      isDeliveryTerminal?: boolean;
      showUberEatsToast?: boolean;
      autoOpenUberEatsModal?: boolean;
    };
    fiscalThreshold?: number;
    expandTicket?: boolean;
    showGlobalSales?: boolean;
    orderNumbers?: {
      enabled?: boolean;
      nextNumber?: number;
      prefix?: string;
      padding?: number;
    };
  };
  ux: {
    theme: 'LIGHT' | 'DARK';
    gridDensity: 'COMFORTABLE' | 'COMPACT';
    showProductImages: boolean;
    quickKeysLayout: 'A' | 'B';
    viewMode: 'VISUAL' | 'RETAIL';
  };
  catalog?: {
    allowedCategories: string[];
    fullPullOnPairing?: boolean;
  };
  inventoryScope?: {
    defaultSalesWarehouseId: string;
    visibleWarehouseIds: string[];
    transferWarehouseId?: string;
    defaultWarehouse?: Warehouse;
    warehouses?: Warehouse[];
  };
  erpBinding?: {
    terminalId?: string;
    tenantId?: string;
    companyId?: string;
    storeId?: string;
    deviceId?: string;
    terminalName?: string;
    stationNumber?: string;
    role?: string;
  };
  erpSnapshot?: TerminalConfigSnapshot;
  metadata?: Record<string, any>;
  lan?: Record<string, any>;
  wallet?: WalletConfig;
  syncConfig?: SyncConfig;
}

export interface WalletConfig {

  apple: {
    teamId: string;
    passTypeIdentifier: string;
    p12Cert: string; // Base64 (Encrypted in storage)
    p12Password: string; // (Encrypted in storage)
    isConfigured: boolean;
  };
  google: {
    issuerId: string;
    serviceAccountJson: string; // JSON String (Encrypted in storage)
    isConfigured: boolean;
  };
}

export interface CurrencyConfig {
  code: string;
  name: string;
  symbol: string;

  // --- TASAS DUALES ---
  rate: number;                    // Valor unificado (retrocompatibilidad)
  buyRate?: number;                // Tasa de Recepción/Compra (cuando cliente paga en POS)
  sellRate?: number;               // Tasa de Valoración/Venta (para reportes/contabilidad)
  useDualRates?: boolean;          // Flag para activar modo dual

  isEnabled: boolean;
  isBase?: boolean;

  // --- AUTOMATIZACIÓN ---
  autoSync?: {
    enabled: boolean;              // Activar actualización automática
    spread: number;                // Margen de ajuste (ej: +0.50 DOP)
    scheduleTime?: string;         // Hora programada "HH:MM" (ej: "08:00")
    lastSync?: string;             // Timestamp última sincronización
    source?: string;               // API de origen (ej: "exchangerate-api.com")
  };

  // --- POLÍTICAS DE CAJA ---
  changePolicy?: {
    forceBaseChange: boolean;      // Forzar vuelto en moneda base (DOP)
    roundingRule: 'NONE' | 'NEAREST' | 'TO_99';  // Regla de redondeo
  };

  // --- VISIBILIDAD ---
  showExchangeRateOnTicket?: boolean;  // Mostrar tasa en ticket impreso

  // --- AUDITORÍA ---
  lastModified?: string;           // Timestamp última modificación
  lastModifiedBy?: string;         // Usuario que modificó
}

export interface CurrencyAuditLog {
  id: string;
  currencyCode: string;
  field: string;                   // Campo modificado (ej: "rate", "buyRate", "sellRate")
  oldValue: any;
  newValue: any;
  changedAt: string;               // ISO timestamp
  changedBy: string;               // User ID
  changedByName: string;           // User name
  terminalId?: string;             // Terminal donde se hizo el cambio
  source?: 'MANUAL' | 'SCHEDULED' | 'ERP';
}

export interface CurrencyRateSchedule {
  id: string;
  currencyCode: string;
  rate: number;
  buyRate?: number;
  sellRate?: number;
  executeAt: string;
  status: 'PENDING' | 'APPLIED' | 'CANCELLED' | 'FAILED';
  createdAt: string;
  createdBy: string;
  createdByName: string;
  terminalId?: string;
  appliedAt?: string;
  error?: string;
}

export type PaymentMethod = 'CASH' | 'CARD' | 'QR' | 'WALLET' | 'ADVANCE' | 'OTHER' | 'CREDIT' | 'STORE_CREDIT' | 'UBER_EATS';
export type PaymentIntegrationProvider =
  | 'AZUL'
  | 'INGENICO_AZUL_WEBAPI'
  | 'CARDNET'
  | 'CARNET'
  | 'VISANET'
  | 'STRIPE';
export type PaymentIntegrationEnvironment = 'TEST' | 'PRODUCTION';
export type PaymentIntegrationMode = 'MANUAL' | 'INTEGRATED';
export type PaymentIntegrationAuditAction =
  | 'SALE'
  | 'SALE_CANCELLATION'
  | 'REFUND'
  | 'GET_LAST_TRX'
  | 'PINPAD_INIT'
  | 'PINPAD_TRANSACTION_TOTALS'
  | 'PINPAD_SETTLE'
  | 'TIP_ADJUST';
export type PaymentIntegrationAuditStatus = 'SUCCESS' | 'FAILED';

export interface PaymentIntegrationAuditEvent {
  id: string;
  timestamp: string;
  integrationId: string;
  integrationName: string;
  provider: PaymentIntegrationProvider;
  environment: PaymentIntegrationEnvironment;
  action: PaymentIntegrationAuditAction;
  status: PaymentIntegrationAuditStatus;
  message: string;
  requestDetails?: Record<string, string>;
  responseDetails?: Record<string, string>;
  responseCode?: string;
  responseMessage?: string;
  authorizationCode?: string;
  referenceNumber?: string;
  invoiceNumber?: string;
  sequenceNumber?: string;
  maskedPan?: string;
  entryMode?: string;
  merchantId?: string;
  terminalId?: string;
}

export interface PaymentIntegrationCapabilities {
  sale?: boolean;
  void?: boolean;
  refund?: boolean;
  getLastTrx?: boolean;
  pinpadInit?: boolean;
  transactionTotals?: boolean;
  settle?: boolean;
}

export interface PaymentIntegrationDefinition {
  id: string;
  name: string;
  provider: PaymentIntegrationProvider;
  isEnabled: boolean;
  environment: PaymentIntegrationEnvironment;
  baseUrl: string;
  secondaryBaseUrl?: string;
  merchantId?: string;
  terminalId?: string;
  auth1?: string;
  auth2?: string;
  timeoutMs?: number;
  capabilities?: PaymentIntegrationCapabilities;
  metadata?: Record<string, string>;
  auditEvents?: PaymentIntegrationAuditEvent[];
}

export type PaymentMethodRoundingRule = 'NONE' | 'UP' | 'DOWN' | 'ZERO_DECIMALS';

export interface PaymentMethodDefinition {
  id: string;
  name: string;
  type: PaymentMethod;
  isEnabled: boolean;
  icon: string;
  color: string;
  opensDrawer: boolean;
  requiresSignature: boolean;
  integration: 'NONE' | PaymentIntegrationProvider;
  integrationMode?: PaymentIntegrationMode;
  integrationId?: string;
  integrationConfig?: Record<string, string>;
  paymentTermDays?: number; // Solo aplica para tipo CREDIT
  foreignCurrencyRounding?: PaymentMethodRoundingRule;
}


export type AttributeType = 'TEXT' | 'COLOR' | 'IMAGE';
export type PricingStrategyType = 'MANUAL' | 'COST_PLUS' | 'DERIVED';
export type RoundingRule = 'NONE' | 'ENDING_99' | 'CEILING' | 'ROUND_HALF_UP' | 'ROUND_FLOOR';

export interface Modifier {
  id: string;
  product_id?: string;
  name: string;
  price: number;
  price_delta?: number;
  modifier_type?: 'ADD' | 'REMOVE' | 'NOTE_PRESET' | string;
  affects_price?: boolean;
  sort_order?: number;
  active?: boolean;
}

export interface ModifierGroup {
  id: string;
  name: string;
  selection_type?: 'SINGLE' | 'MULTIPLE' | string;
  required?: boolean;
  min_select?: number;
  max_select?: number | null;
  free_quantity?: number;
  sort_order?: number;
  modifiers: Modifier[];
}

export interface ProductFractionOption {
  id?: string;
  option_product_id?: string;
  product_id?: string;
  name?: string;
  price?: number;
  price_override?: number | null;
  active?: boolean;
}

export interface ProductFractionRule {
  id?: string;
  fraction_mode?: 'HALF' | 'QUARTER' | 'CUSTOM' | string;
  pricing_rule?: 'HIGHEST_PRICE' | 'AVERAGE_PRICE' | 'SUM_PARTS' | 'BASE_PLUS_DIFF' | string;
  max_parts?: number;
  require_equal_parts?: boolean;
  options?: ProductFractionOption[];
}

export interface ComboGroupItem {
  id?: string;
  product_id?: string;
  name?: string;
  price_delta?: number;
  active?: boolean;
  sort_order?: number;
}

export interface ComboGroup {
  id: string;
  name: string;
  required?: boolean;
  min_select?: number;
  max_select?: number | null;
  sort_order?: number;
  items: ComboGroupItem[];
}

export interface ProductGroup {
  id: string;
  name: string;
  code: string;
  color?: string;
  description?: string;
  productIds: string[];
}

export interface Season {
  id: string;
  name: string;
  code: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  productIds: string[];
  multiplier: number; // Demand factor (e.g., 1.5)
  affectedCategories: string[]; // Categories affected by this season
}

export interface TipConfiguration {
  enabled: boolean;
  defaultOptions: [number, number, number];
  fixedAmountOptions?: number[];
  allowCustomTip: boolean;
  serviceCharge: {
    enabled: boolean;
    percentage: number;
    applyIfTotalOver: number;
    applyIfGuestsOver: number;
  };
}

export type OrderServiceType = 'DINE_IN' | 'TAKEOUT' | 'DELIVERY';

/** Fiscal behavior selected when a ticket changes its service type. */
export interface ServiceTaxPolicy {
  /**
   * Allow-list over taxes already assigned to each product. Undefined keeps
   * the product configuration; an empty array explicitly applies no taxes.
   */
  taxIds?: string[];
  legalTip?: {
    enabled: boolean;
    percentage?: number;
  };
  updatedAt?: string;
}

export type ServiceTaxPolicyMap = Partial<Record<OrderServiceType, ServiceTaxPolicy>>;

export interface AppliedServiceTaxPolicySnapshot extends ServiceTaxPolicy {
  serviceType: OrderServiceType;
  source: 'TERMINAL' | 'POS' | 'LEGACY';
}

export interface N8nConfig {
  webhookUrl: string;
  events: {
    onSale: boolean;
    onZReport: boolean;
  };
}

export interface EmailConfig {
  provider: 'resend';
  apiKey: string;
  from: string;
  defaultRecipient?: string; // Fallback recipient for system emails
  subjectTemplate?: string;
  accentColor?: string;
  bannerImage?: string;
  customFooter?: string;
  showSocialLinks?: boolean;
}

export interface ScaleLabelConfig {
  isEnabled: boolean;
  prefixes: string[];
  structure: {
    totalLength: number;
    prefixLength: number;
    pluStart: number;
    pluLength: number;
    valueStart: number;
    valueLength: number;
    checksumLength: number;
  };
  valueType: 'WEIGHT' | 'PRICE';
  decimals: number;
}



export interface LoyaltyTier {
  id: string;
  name: string;
  minPoints: number;
  color: string;
  icon?: string;
}

export interface LoyaltyConfig {
  isEnabled: boolean;
  earnRate: number; // Points per 1 unit of currency (e.g., 0.1 for 1 point per $10)
  redeemRate: number; // Value of 1 point (e.g., 0.10)
  minRedemptionPoints: number;
  expirationMonths: number;
  excludedCategories: string[];
  tiers?: LoyaltyTier[];
}



export interface UnitDefinition {
  code: string;
  name: string;
  type?: 'MASS' | 'VOLUME' | 'UNIT';
}

export interface ClassificationItem {
  id: string;
  name: string;
  code?: string;
  parentId?: string; // For hierarchy (e.g. Section -> Department)
  /** Presentación y disponibilidad de la clasificación en el catálogo POS. */
  color?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface BusinessConfig {
  vertical: VerticalType;
  business_config?: {
    vertical_negocio?: VerticalType;
    businessVertical?: VerticalType;
    usa_mesas?: boolean;
    useTables?: boolean;
    pantalla_inicio?: 'VENTA_DIRECTA' | 'MAPA_MESAS';
    rooms?: Room[];
    tables?: Table[];
    [key: string]: unknown;
  };
  businessConfig?: BusinessConfig['business_config'];
  subVertical: SubVertical;
  currencySymbol: string;
  taxRate: number;
  taxes: TaxDefinition[];
  serviceTaxPolicies?: ServiceTaxPolicyMap;
  service_tax_policies?: ServiceTaxPolicyMap;
  themeColor: 'blue' | 'orange' | 'gray';
  features: {
    stockTracking: boolean;
  };
  units?: UnitDefinition[]; // NEW: Centralized units list
  loyalty?: LoyaltyConfig;
  companyInfo: CompanyInfo;
  currencies: CurrencyConfig[];
  paymentMethods: PaymentMethodDefinition[];
  paymentMethodsSource?: 'ERP';
  integrations?: PaymentIntegrationDefinition[];
  terminals: { id: string; config: TerminalConfig }[];
  tariffs: Tariff[];
  productGroups?: ProductGroup[];
  seasons?: Season[];
  receiptConfig?: ReceiptConfig;
  labelTemplates?: LabelTemplate[];
  tipsConfig?: TipConfiguration;
  emailConfig?: EmailConfig;
  fiscalCompliance?: FiscalComplianceConfig;

  // Classifications
  departments?: ClassificationItem[];
  sections?: ClassificationItem[];
  families?: ClassificationItem[];
  subfamilies?: ClassificationItem[];
  brands?: ClassificationItem[];
  posCategories?: ClassificationItem[]; // Standardized POS Categories

  availablePrinters?: PrinterDevice[];
  scales?: ScaleDevice[];
  scaleLabelConfig?: ScaleLabelConfig;
  promotions?: Promotion[];
  campaigns?: Campaign[];
  coupons?: Coupon[];
  roles?: RoleDefinition[];
  auditLogs?: AuditLogEntry[];
  n8nConfig?: N8nConfig;
  inventoryScope?: {
    defaultSalesWarehouseId: string;
    visibleWarehouseIds: string[];
  };
  operational?: {
    vertical_negocio: VerticalType;
    usa_mesas: boolean;
    pantalla_inicio: 'VENTA_DIRECTA' | 'MAPA_MESAS';
    bloqueo_meseros: boolean;
    pedir_comensales: boolean;
    usa_modulos_cocina: boolean;
    recibir_consignaciones?: boolean;
    receiveConsignments?: boolean;
    receive_consignments?: boolean;
    descargar_consignaciones?: boolean;
    reservationPolicy?: {
      validityDays: number;
      printCopies: number;
      requireAdvance: boolean;
      minimumAdvancePercent: number;
    };
  };
  ux: {
    theme: 'LIGHT' | 'DARK';
    gridDensity: 'COMFORTABLE' | 'COMPACT';
    showProductImages: boolean;
    quickKeysLayout: 'A' | 'B';
    viewMode: 'VISUAL' | 'RETAIL';
  };
  terminalSnapshots?: Record<string, TerminalConfigSnapshot>;
  metadata?: Record<string, any>;
}

export interface RoleDefinition {
  id: string;
  name: string;
  permissions: Permission[];
  maxDiscountPercent?: number;
  isSystem?: boolean;
  isActive?: boolean;
  version?: number;
  syncSource?: 'LOCAL' | 'LOCAL_SEED' | 'ERP_SNAPSHOT';
  zReportConfig?: {
    hiddenModules: ZReportModule[];
  };
}

export interface User {
  id: string;
  name: string;
  pin: string;
  role: string; // Legacy role string, keep for compatibility or migrate
  roleId?: string; // Link to RoleDefinition
  photo?: string;
  biometrics?: UserBiometrics; // NEW: Biometric methods
  syncSource?: 'LOCAL' | 'LOCAL_SEED' | 'ERP_SNAPSHOT';
  isActive?: boolean;
  version?: number;
  /** Límite individual de descuento. Si falta, hereda el límite del rol. */
  maxDiscountPercent?: number;
  /** Porcentaje de comisión capturado en cada venta finalizada. */
  commissionPercent?: number;
}

export interface UserBiometrics {
  credentialID: string;
  publicKey: string;
  registeredAt: string; // ISO Date
}

export interface CustomerAddress {
  id: string;
  type: 'BILLING' | 'SHIPPING';
  isDefault: boolean;
  country: string;
  state: string;
  city: string;
  street: string;
  number: string;
  zipCode: string;
  latitude?: number;
  longitude?: number;
  receptionHours?: string;
  contactPhone?: string;
}

export interface Customer {
  id: string;
  customer_code?: string;
  customerCode?: string;
  external_code?: string;
  externalCode?: string;
  source_customer_id?: string;
  sourceCustomerId?: string;
  created_source?: 'POS' | string;
  source_terminal_id?: string;
  master_number_range_id?: string;
  master_number_value?: number;
  name: string;
  phone?: string;
  email?: string;
  taxId?: string;
  image?: string;
  imageUrl?: string;
  imageVersion?: string;
  imageLocalPath?: string | null;
  photo?: string;
  photoUrl?: string;
  photoVersion?: string;
  photoLocalPath?: string | null;
  avatar?: string;
  avatarUrl?: string;
  avatarVersion?: string;
  avatarLocalPath?: string | null;
  address?: string;
  notes?: string;
  loyaltyPoints?: number;
  creditLimit?: number;
  currentDebt?: number;
  tier?: string;
  createdAt?: string;
  updatedAt?: string;
  totalSpent?: number;
  lastVisit?: string;
  tags?: string[];
  requiresFiscalInvoice?: boolean;
  prefersEmail?: boolean;
  isTaxExempt?: boolean;
  applyChainedTax?: boolean;
  addresses?: CustomerAddress[];
  creditDays?: number;
  defaultNcfType?: FiscalDocumentCode;
  wallet?: Wallet;
  cards?: LoyaltyCard[];
  loyalty?: LoyaltyCard; // Deprecated, kept for backward compatibility during migration

  // DGII Fiscal Validation (Dominican Republic)
  fiscalStatus?: 'ACTIVO' | 'INACTIVO' | 'NO_REGISTRADO';
  verifiedAt?: string; // ISO timestamp of last DGII validation
  dgiiData?: {
    commercialName?: string;
    economicActivity?: string;
    regimeType?: string;
  };
  isTemporary?: boolean; // Flag for ephemeral customers from DGII search
}

export interface ProductAttribute {
  id: string;
  name: string;
  options: string[];
  optionCodes: string[];
}

export interface ProductVariant {
  id?: string;
  variantId?: string;
  sku: string;
  barcode: string[];
  attributeValues: Record<string, string>;
  price: number;
  initialStock?: number;
}

export interface TariffPrice {
  tariffId: string;
  name?: string;
  price: number;
  costBase?: number;
  margin?: number;
  tax?: number;
}

export interface ProductOperationalFlags {
  isWeighted: boolean;
  trackInventory: boolean;
  autoPrintLabel: boolean;
  promptPrice: boolean;
  integersOnly: boolean;
  ageRestricted: boolean;
  allowNegativeStock: boolean;
  excludeFromPromotions: boolean;
  excludeFromLoyalty: boolean;
  usesLots: boolean;
  usesSerial: boolean;
}

export type ProductType = 'MATERIA_PRIMA' | 'PRODUCTO_TERMINADO' | 'RECETA' | 'KIT' | 'PRODUCT' | 'SERVICE' | 'SIMPLE' | 'COMBO' | 'FRACTIONABLE';
export type KitInventoryMode = 'FINISHED_GOOD' | 'COMPONENT_CONSUMPTION';

export interface RecipeDetail {
  id: string;
  parentItemId: string;
  childItemId: string;
  childItemName?: string; // For UI display
  quantity: number;
  unit: string; // The unit used in the recipe (e.g., 'gr')
  originalUnit?: string; // The purchasing unit of the ingredient (e.g., 'lb')
  conversionFactor?: number; // Cost multiplier or conversion ratio
  wasteFactor: number; // 0.1 = 10%
  isOptional: boolean;
  cost?: number; // Calculated dynamic cost
}

export interface Product {
  id: string;
  sku?: string;
  external_code?: string;
  externalCode?: string;
  created_source?: 'POS' | string;
  source_terminal_id?: string;
  master_number_range_id?: string;
  master_number_value?: number;
  name: string;
  price: number;
  category: string;
  /** Orden visual del artículo dentro de su categoría en el POS. */
  posSortOrder?: number;
  stock?: number;
  qty_committed?: number; // Committed for events/bookings
  image?: string;
  imageUrl?: string;
  imageVersion?: string;
  imageLocalPath?: string | null;
  barcode?: string;
  barcode_2?: string;
  barcode2?: string;
  barcode_3?: string;
  barcode3?: string;
  reference?: string;
  referenceCode?: string;
  reference_code?: string;
  cost?: number;
  is_active?: boolean;
  is_sellable?: boolean;
  theoreticalCost?: number; // New calculated cost
  type?: ProductType;
  isInventoriable?: boolean;
  kitInventoryMode?: KitInventoryMode;
  recipeDetails?: RecipeDetail[]; // The BOM
  images: string[];
  media?: MediaAsset[];
  attributes: ProductAttribute[];
  variants: ProductVariant[];
  tariffs: TariffPrice[];
  stockBalances?: Record<string, number>;
  activeInWarehouses?: string[];
  appliedTaxIds: string[];
  minStock?: number;
  warehouseSettings?: Record<string, { min: number, max: number }>;
  availableModifiers?: Modifier[];
  modifier_groups?: ModifierGroup[];
  modifierGroups?: ModifierGroup[];
  fraction_rule?: ProductFractionRule;
  fractionRule?: ProductFractionRule;
  combo_groups?: ComboGroup[];
  comboGroups?: ComboGroup[];
  note_presets?: string[];
  notePresets?: string[];
  product_type?: 'SIMPLE' | 'COMBO' | 'FRACTIONABLE' | 'SERVICE' | string;
  restaurant?: {
    product_type?: 'SIMPLE' | 'COMBO' | 'FRACTIONABLE' | 'SERVICE' | string;
    production_area_id?: string;
    productType?: string;
    productionAreaId?: string;
    modifier_groups?: ModifierGroup[];
    modifierGroups?: ModifierGroup[];
    fraction_rule?: ProductFractionRule;
    fractionRule?: ProductFractionRule;
    combo_groups?: ComboGroup[];
    comboGroups?: ComboGroup[];
    note_presets?: string[];
    notePresets?: string[];
    [key: string]: any;
  };
  description?: string;
  departmentId?: string;
  sectionId?: string;
  familyId?: string;
  subfamilyId?: string;
  brandId?: string;
  posCategoryId?: string;
  operationalFlags?: ProductOperationalFlags;
  requires_verification?: boolean;
  updatedAt?: string;
  hasActivePromotion?: boolean; // UI Flag for badges
  returnReason?: string; // For items with qty < 0
  subtotalizedAt?: string;
  subtotalizedBy?: string;
  primarySupplierId?: string; // NEW: Preferred supplier for lead time calculation
  production_area_id?: string; // NEW: For command routing

  // UOM & Yield
  measurementUnit?: string; // e.g. 'gr', 'ml', 'oz'
  purchaseUnit?: string;    // e.g. 'Saco', 'Caja', 'Botella'
  conversionFactor?: number; // e.g. 1 Saco = 50,000 gr. Default: 1
  batchYield?: number;      // e.g. Recipe produces 50 units. Default: 1
}

export interface ProductStock {
  id: string; // generateId(productId, warehouseId)
  productId: string;
  warehouseId: string;
  quantity: number;
  qtyPhysical?: number;
  qtyCommitted?: number;
  qtyAvailable?: number;
  updatedAt: string;
}

export interface ProductPrice {
  id: string; // generateId(productId, tariffId)
  productId: string;
  tariffId: string;
  price: number;
  updatedAt: string;
  itemId?: string;
  erpProductId?: string;
  sourceProductId?: string;
  tariffCode?: string;
  currency?: string;
}

export interface InventoryCommitment {
  id: string; // productId + '_' + warehouseId
  productId: string;
  warehouseId: string;
  qtyCommitted: number;
  updatedAt: string;
}

export interface InventoryTracking {
  id: string;
  productId: string;
  variantId?: string;
  warehouseId: string;
  type: 'LOTE' | 'SERIE';
  trackingCode: string;
  expirationDate?: string;
  status: 'AVAILABLE' | 'SOLD' | 'RESERVED';
  receivedAt: string;
  receptionId?: string;
  saleId?: string;
}

// --- FLOOR PLAN TYPES ---
export type TableShape = 'SQUARE' | 'CIRCLE' | 'OBSTACLE' | 'BAR' | 'BOOTH' | 'CHAISE_LONGUE';

export interface Room {
  id: string;
  nombre: string;
  name?: string;
  consumo_minimo?: number; // Legacy, but keeping for compatibility
  capacidad_personas?: number; // Legacy
  capacity?: number; // Standardized capacity
  capacidad_pax?: number; // New standard for Spaces
  base_price?: number; // For quotes
  color?: string; // For calendar
  warehouse_id?: string; // For inventory mapping
  cargo_servicio_pct?: number;
  orden?: number;
  data?: {
    width?: number;
    height?: number;
    gridConfig?: any;
    backgroundImage?: string;
    backgroundStyle?: 'DARK' | 'WHITE';
    tableLayoutStyle?: 'NORMAL' | 'CHAIRS';
  };
}

export interface Table {
  id: string;
  code?: string;
  label?: string;
  room_id?: string;
  sort_order?: number;
  active?: boolean;
  roomId: string;
  nombre: string;
  name?: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  shape: TableShape;
  rotation: number;
  capacity?: number;
  consumo_minimo_mesa?: number;
  comensales_minimos?: number;
  // Runtime State
  status?: 'FREE' | 'OCCUPIED' | 'RESERVED';
  currentOrderId?: string;
  currentOrderTotal?: number;
  waiterName?: string;
  waiterId?: string;
  timeSeated?: string;
  guests?: number;
  barTabId?: string;
  barTabName?: string;
  /** Cuenta compartida: la mesa principal conserva el ticket y las secundarias la referencian. */
  joinedTableId?: string;
  joinedTableName?: string;
  joinedSourceTableId?: string;
  joinedSourceTableName?: string;
  editingLock?: {
    ownerId: string;
    terminalId?: string;
    userId?: string;
    userName?: string;
    acquiredAt: number;
    expiresAt: number;
  };
}

/**
 * Cart Item
 *
 * IMPORTANT - PRICE SNAPSHOT PROTECTION:
 * When a product is added to cart, its `price` field becomes a SNAPSHOT
 * and is FROZEN for the duration of that sale. Subsequent catalog updates
 * (price changes, bulk updates, etc.) WILL NOT affect items already in cart.
 *
 * This prevents the following scenario:
 * - Customer adds item @ $2.50
 * - Admin changes price to $3.00 on master terminal
 * - Catalog syncs to slave
 * - Customer would suddenly owe $3.00 instead of $2.50
 *
 * With snapshot protection:
 * - Price at time of adding to cart is preserved
 * - Customer pays what they saw when they added item
 * - Next sale will use new price
 */
export interface CartItem extends Product {
  quantity: number;
  cartId: string;
  isReturnLine?: boolean;
  createdAt?: string;
  modifiers?: string[];
  restaurantConfig?: {
    modifierGroups?: Record<string, string[]>;
    comboGroups?: Record<string, string[]>;
    fractions?: Array<{ id: string; name: string; price: number; ratio: number }>;
    selected_modifiers?: any[];
    selected_fraction_parts?: any[];
    selected_combo_items?: any[];
    product_type?: string;
    production_area_id?: string;
    note?: string;
  };
  selected_modifiers?: any[];
  selected_fraction_parts?: any[];
  selected_combo_items?: any[];
  note?: string;
  originalPrice?: number; // Optional: track original product price for auditing
  discountAmount?: number;
  discountRate?: number;
  netAmount?: number;
  taxAmount?: number;
  totalAmount?: number;
  taxRate?: number;
  adjustmentSource?: 'PROMOTION' | 'MANUAL_DISCOUNT' | 'MANUAL_PRICE_OVERRIDE' | 'TARIFF';
  appliedPromotionCode?: string;
  appliedPromotionName?: string;
  promotionTrace?: PromotionApplicationTrace;
  salespersonId?: string;
  ncf?: string; // NCF asignado a esta línea o al ticket
  appliedPromotionId?: string;
  trackingId?: string; // NEW: Assigned lot/serial ID
  trackingCode?: string; // NEW: Assigned lot/serial code
  trackingData?: any[]; // NEW: Detailed tracking records selected
  variantInfo?: string; // NEW: Human readable variant detail
  variantSku?: string; // NEW: Variant SKU for inventory/receipts
  variantId?: string;
  variantBarcodes?: string[];
  dispatched?: boolean; // NEW: Track if item was sent to kitchen
  restaurantCommittedAt?: string; // Línea guardada al salir de la mesa; cualquier reducción requiere autorización
  orderNumber?: string;
  tableDisplayLabel?: string;
  tableRoomLabel?: string;
  kdsStatus?: 'ENVIADO' | 'DEVUELTO' | 'RETURN_PENDING' | string;
  kdsOrderId?: string;
  kdsAreaId?: string;
  kdsItemIds?: string[];
  kdsReturnedAt?: string;
  kdsOriginalPrice?: number;
  voidedByKdsReturn?: boolean;
  consignmentId?: string;
  consignmentDocumentNo?: string;
  consignmentLineId?: string;
}

export interface Transaction {
  // Identifiers
  id: string;
  globalSequence?: number;          // Global unique sequence number
  displayId?: string;               // User-visible ID (e.g., "TCK01-000123")
  source_channel?: 'POS';
  source_transaction_id?: string;
  source_display_id?: string;
  source_terminal_id?: string;
  device_id?: string;
  source_credit_note_id?: string;
  original_transaction_id?: string;
  original_display_id?: string;
  /** Read-only ERP source used to compose an NC without importing the sale locally. */
  erpRefundSource?: ErpRefundSourceBinding;
  /** Reservation consumed by ERP when the resulting NC is received. */
  erpRefundPreparation?: ErpRefundPreparation;

  // Document Classification
  documentType?: DocumentType;      // Type of transaction
  seriesId?: string;                // Reference to DocumentSeries
  seriesNumber?: number;            // Number within the series

  // Transaction Data
  date: string;
  updatedAt?: string;
  items: CartItem[];
  total: number;
  payments: any[];

  // User & Terminal
  userId: string;
  userName: string;
  /** Snapshot inmutable de la comisión vigente al completar la venta. */
  salesCommissionPercent?: number;
  salesCommissionAmount?: number;
  terminalId?: string;
  terminalName?: string;

  // Status
  status: 'PENDING' | 'COMPLETED' | 'REFUNDED' | 'PARTIAL_REFUND';

  // Audit (RBAC)
  authorizedById?: string;
  authorizedByName?: string;

  // Customer
  customerId?: string;
  customerName?: string;
  customerSnapshot?: {
    name: string;
    customer_code?: string;
    master_number_range_id?: string;
    master_number_value?: number;
    source_terminal_id?: string;
    created_source?: string;
    taxId?: string;
    address?: string;
    phone?: string;
    email?: string;
    isTaxExempt?: boolean;
  };

  // Accounting
  taxAmount?: number;               // Total tax amount
  netAmount?: number;               // Net amount (before tax)
  taxBreakdown?: any[];             // Fiscal tax lines persisted for provider retries
  discountAmount?: number;
  discountType?: 'PERCENT' | 'FIXED';
  discountValue?: number;
  isTaxIncluded?: boolean;
  couponCode?: string;
  coupons?: RedeemedCouponRef[];

  // Fiscal
  ncf?: string;                     // NCF final del documento
  ncfType?: FiscalDocumentCode;
  legacyNcf?: string;
  electronicNcf?: string;
  fiscalMode?: FiscalMode;
  fiscalProvider?: FiscalProviderId;
  fiscalSyncStatus?: CloudSyncStatus;
  fiscalSyncError?: string;
  fiscalSyncedAt?: string;
  fiscalReferenceId?: string;
  fiscalResponseMessage?: string;
  fiscalCorrectionAudit?: FiscalCorrectionAuditEntry[];
  affectedNCF?: string;             // NCF de la factura afectada (para Notas de Crédito B04)
  affectedInvoiceNumber?: string;   // No. de factura afectada (displayId para búsquedas)
  affectedInvoiceDate?: string;
  observations?: string;
  cloudSyncStatus?: CloudSyncStatus;
  cloudSyncError?: string;
  cloudSyncedAt?: string;
  reservationId?: string;
  reservationCode?: string;
  priorAdvancePaid?: number;
  balanceDueAtSale?: number;

  // Accounts Receivable (CxC)
  dueDate?: string;         // ISO Date
  pendingBalance?: number;  // Amount still owed on this transaction

  // Settlement Summary
  settlementCurrencyCode?: string;
  settlementExchangeRate?: number;
  settlementReceivedOriginal?: number;
  settlementReceivedBase?: number;
  settlementAppliedBase?: number;
  settlementChangeBase?: number;
  settlementChangeCurrencyCode?: string;
  settlement_currency_code?: string;
  settlement_exchange_rate?: number;
  settlement_received_original?: number;
  settlement_received_base?: number;
  settlement_applied_base?: number;
  settlement_change_base?: number;
  settlement_change_currency_code?: string;

  // Relationships
  relatedTransactions?: string[];   // Related transaction IDs
  originalTransactionId?: string;   // For refunds/voids
  refundReason?: string;
  syncStatus?: SyncStatus;
  syncError?: string;
  syncResponse?: any;
  syncedAt?: string;
  erpSyncStatus?: 'APPLIED' | 'SKIPPED_ALREADY_APPLIED' | 'ERROR';
  erpSyncResponse?: any;
  erpSyncedAt?: string;
  zReportId?: string; // ID of the Z-Report that closed this transaction
  zReportSequence?: string; // Human readable sequence number of the Z-Report (e.g. "Z-000123")

  // Wallet Interaction
  walletDepositAmount?: number;     // Amount sent to customer wallet (advance/refund)
  walletPaymentAmount?: number;     // Amount paid using customer wallet balance

  // Restaurant fields
  serviceType?: OrderServiceType;
  service_type?: OrderServiceType;
  serviceTaxPolicySnapshot?: AppliedServiceTaxPolicySnapshot;
  service_tax_policy_snapshot?: AppliedServiceTaxPolicySnapshot;
  serviceChargeAmount?: number;     // Propina Legal (10%)
  voluntaryTipAmount?: number;      // Propina Voluntaria
  orderNumber?: string;
  tableDisplayLabel?: string;
  tableRoomLabel?: string;
  marketplaceSourceChannel?: 'UBER_EATS';
  marketplaceSourceOrderId?: string;
  marketplaceSourceStoreId?: string;
  marketplaceTenantId?: string;
  marketplaceCompanyId?: string;
  marketplaceStoreId?: string;
  skipErpSaleSync?: boolean;
  erpConfirmationStatus?: 'PENDING' | 'SYNCED' | 'ERROR';
  erpConfirmationError?: string;
  erpConfirmedAt?: string;
  consignmentId?: string;
  consignmentDocumentNo?: string;
  consignmentLineId?: string;
  consignmentSyncStatus?: 'PENDING' | 'SYNCED' | 'ERROR';
  consignmentSyncError?: string;
  consignmentSyncedAt?: string;
  consignmentSyncResponse?: any;
}

export interface FiscalDocumentCorrectionSnapshot {
  fiscalCode?: FiscalDocumentCode | null;
  ncf?: string;
  customerId?: string;
  customerName?: string;
  customerTaxId?: string;
  netAmount?: number;
  taxAmount?: number;
  total?: number;
  fiscalSyncStatus?: CloudSyncStatus;
  fiscalSyncError?: string;
}

export interface FiscalCorrectionAuditEntry {
  id: string;
  correctedAt: string;
  correctedById?: string;
  correctedByName?: string;
  reason: string;
  old: FiscalDocumentCorrectionSnapshot;
  next: FiscalDocumentCorrectionSnapshot;
}

export interface FiscalDocumentCorrectionInput {
  fiscalCode: FiscalDocumentCode;
  customerId?: string;
  reason: string;
  recalculateTaxes: boolean;
}

export type ViewState =
  // Standard views
  | 'ACTIVATION'
  | 'TERMINAL_MODE_SELECTOR'
  | 'VERTICAL_SELECTOR'
  | 'SETUP'
  | 'WIZARD'
  | 'LOGIN'
  | 'POS'
  | 'ATTENDANCE'
  | 'SETTINGS'
  | 'SETTINGS_SYNC'
  | 'CUSTOMERS'
  | 'HISTORY'
  | 'FINANCE'
  | 'Z_REPORT'
  | 'SUPPLY_CHAIN'
  | 'INVENTORY_TRACKING'
  | 'FRANCHISE_DASHBOARD'
  | 'TRACKING' // Added TRACKING view state
  | 'TABLE_MAP'
  | 'TABLE_DESIGNER'
  | 'INVENTORY_AUDIT'
  | 'DEVICE_UNAUTHORIZED'
  // Kiosk / Self-Checkout views
  | 'KIOSK_WELCOME'
  | 'KIOSK_BROWSER'
  | 'KIOSK_CART'
  | 'KIOSK_PAYMENT'
  // Price Checker views
  | 'CHECKER_SCAN'
  // Handheld Inventory views
  | 'INVENTORY_HOME'
  | 'INVENTORY_COUNT'
  | 'INVENTORY_RECEPTION'
  | 'INVENTORY_LABELS'
  // Kitchen Display views
  | 'KITCHEN_ORDERS'
  // Customer Visor views
  | 'VISOR'
  | 'TERMINAL_PAIRING'
  | 'AGENDA'; // Added for CRM & Booking Module

export interface TariffPriceOverride {
  productId: string;
  price: number;
  lockPrice: boolean;
}

export interface Tariff {
  id: string;
  code?: string;
  name: string;
  active: boolean;
  currency: string;
  taxIncluded: boolean;
  strategy: {
    type: PricingStrategyType;
    rounding: RoundingRule;
    factor?: number;
    baseTariffId?: string;
  };
  scope: {
    storeIds: string[];
    priority: number;
  };
  schedule: {
    daysOfWeek: number[];
    timeStart: string;
    timeEnd: string;
  };
  items: Record<string, TariffPriceOverride>;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: string;
  address: string;
  allowPosSale: boolean;
  allowNegativeStock: boolean;
  isMain?: boolean;
  storeId?: string;
  warehouseId?: string;
  inventoryLocalId?: string;
  erpWarehouseId: string;
  sourceWarehouseId?: string;
  uid?: string;
  label?: string;
}

export interface StockTransferItem {
  transferItemId?: string;
  productId: string;
  productName: string;
  quantity: number;
  receivedQuantity?: number; // Actual units received
}

export interface StockTransfer {
  id: string;
  seriesId?: string;
  seriesNumber?: number;
  displayId?: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  items: StockTransferItem[];
  status: 'IN_TRANSIT' | 'PARTIALLY_RECEIVED' | 'COMPLETED';
  createdAt: string;
  sentAt?: string;
  receivedAt?: string;
  createdBy?: string;
  terminalId?: string;
  syncStatus?: SyncStatus;
  syncError?: string;
  updatedAt?: string;
  discrepancyReason?: string;
  syncSource?: 'LOCAL' | 'ERP_SNAPSHOT';
}

export type PromotionType =
  | 'DISCOUNT'
  | 'BOGO'
  | 'HAPPY_HOUR'
  | 'CONDITIONAL_TARGET'
  | 'BUNDLE'
  | 'TIERED_QUANTITY'
  | 'MIX_AND_MATCH'
  | 'GIFT_WITH_PURCHASE'
  | 'PAYMENT_METHOD_DISCOUNT'
  | 'PREPAID_PACKAGE'
  | 'NEXT_PURCHASE_COUPON';
export type PromotionTargetType = 'ALL' | 'PRODUCT' | 'VARIANT' | 'CATEGORY' | 'GROUP' | 'SEASON';
export type PromotionBenefitType = 'DISCOUNT_PERCENT' | 'FIXED_PRICE' | 'CASHBACK' | 'POINTS_MULTIPLIER';

export interface PromotionApplicationTrace {
  promotionId: string;
  targetType: PromotionTargetType;
  targetValue?: string;
  matchedVariantRef?: string;
  matchedTargetRef?: string;
  matchedVariantRefType?: 'SKU' | 'VARIANT_ID' | 'BARCODE';
}

export interface PromotionCondition {
  type: 'HAS_WALLET' | 'CUSTOMER_TIER' | 'HAS_POINTS_MIN';
  value: string; // "GOLD", "100", "TRUE"
}

export interface Promotion {
  id: string;
  name: string;
  type: PromotionType;
  priority: number;
  media?: MediaAsset[];
  trigger_config?: Record<string, any>;
  triggerConfig?: Record<string, any>;

  // Trigger
  trigger?: {
    type: 'TOTAL_SPEND' | 'ITEM_QTY' | 'MIN_TICKET_AMOUNT';
    value: number;
    excludeCategories?: string[];
    isRecursive?: boolean;
  };

  // Conditions (New)
  conditions?: PromotionCondition[];

  // Target
  targetType: PromotionTargetType;
  targetValue?: string; // ID of Product (parent for VARIANT), Category, Group, Season
  targetLabel?: string;
  targetRefs?: string[];
  targetStrategy?: {
    mode: 'CHEAPEST_ITEM' | 'MOST_EXPENSIVE_ITEM' | 'SLOW_MOVER' | 'CATEGORY_CHEAPEST';
    filterValue?: string | number; // Category ID or Days threshold
    tieBreaker?: 'FIRST_ADDED' | 'LAST_ADDED';
    allowSelfTrigger?: boolean;
  };

  // Benefit
  benefitType?: PromotionBenefitType; // Optional for backward compatibility, defaults to DISCOUNT implied by type
  benefitValue: number; // % or Fixed Amount or Multiplier

  // Schedule & Scope
  schedule: {
    days: string[]; // L, M, X, J, V, S, D
    startTime: string;
    endTime: string;
    startDate?: string;
    endDate?: string;
    isActive: boolean;
  };
  terminalIds?: string[];

  stats?: {
    usageCount: number;
    revenueGenerated: number;
    conversionRate: number;
  };
}

export interface PromotionRecommendation {
  type: 'TIMING' | 'DISCOUNT_DEPTH' | 'TARGET' | 'TERMINAL';
  message: string;
  confidence: number;
  suggestedAction?: () => void;
}

export interface CashMovement {
  id: string;
  zReportId?: string;
  zReportSequence?: string;
  type: 'IN' | 'OUT';
  amount: number;
  reason: string;
  timestamp: string;
  userId: string;
  userName: string;
  currencyCode?: string; // For multi-currency support, defaults to base currency
  terminalId?: string; // ID of the terminal where the movement was recorded
  syncStatus?: SyncStatus;
  syncError?: string;
  source_channel?: 'POS';
  source_cash_movement_id?: string;
  source_terminal_id?: string;
  device_id?: string;
  created_at?: string;
}

export interface Supplier {
  id: string;
  supplier_code?: string;
  supplierCode?: string;
  external_code?: string;
  externalCode?: string;
  created_source?: 'POS' | string;
  source_terminal_id?: string;
  master_number_range_id?: string;
  master_number_value?: number;
  name: string;
  taxId: string; // RNC o Cédula
  email: string;
  phone: string;
  image?: string;
  imageUrl?: string;
  imageVersion?: string;
  imageLocalPath?: string | null;
  logo?: string;
  logoUrl?: string;
  logoVersion?: string;
  logoLocalPath?: string | null;
  contactPerson: string;
  paymentMethod: 'CASH' | 'TRANSFER' | 'CARD' | 'CREDIT';
  paymentTermDays: number; // Días de crédito
  creditLimit: number;
  balance: number; // Deuda actual
  leadTimeDays: number; // NEW: Average delivery time in days
  isActive: boolean;
}

export interface SupplierProductPrice {
  supplierId: string;
  productId: string;
  lastCost: number;
  updatedAt: string;
}

export interface PurchaseOrderItem {
  productId: string;
  productName: string;
  quantityOrdered: number;
  quantityReceived: number;
  cost: number;
  variantSku?: string;
  variantInfo?: string; // e.g. "Rojo / 42"
  trackingData?: { trackingCode: string; expirationDate?: string; id?: string }[];
}

export interface PurchaseOrder {
  id: string;
  code?: string;
  supplierId: string;
  supplierName?: string; // Denormalized for reports
  warehouseId?: string;
  date: string;
  expectedDate: string; // NEW: Promised delivery date
  dueDate?: string; // Derived from supplier.paymentTermDays
  status: 'ORDERED' | 'PARTIAL' | 'COMPLETED';
  items: PurchaseOrderItem[];
  totalCost: number;
  sentAt?: string; // For email tracking
  syncSource?: 'LOCAL' | 'ERP_SNAPSHOT';
}

export interface Reception {
  id: string;
  purchaseOrderId: string;
  date: string;
  receivedBy: string;
  receivedByUserName: string;
  items: PurchaseOrderItem[];
  terminalId?: string;
  syncStatus?: SyncStatus;
  syncError?: string;
  updatedAt?: string;
  parkedAt?: string;
  cloudSyncStatus?: CloudSyncStatus;
  cloudSyncError?: string;
  cloudSyncedAt?: string;
}

export interface ParkedTicket {
  id: string;
  name: string;
  alias?: string;
  items: CartItem[];
  total?: number;
  discountAmount?: number;
  discountType?: 'PERCENT' | 'FIXED';
  discountValue?: number;
  guests?: number;
  customerId?: string;
  customerName?: string;
  customerSnapshot?: {
    name?: string;
    taxId?: string;
    address?: string;
    phone?: string;
    email?: string;
    isTaxExempt?: boolean;
  };
  timestamp: string;
  tableId?: string | number;
  orderNumber?: string;
  tableDisplayLabel?: string;
  tableRoomLabel?: string;
  /** Mesa canónica de una cuenta compartida. */
  primaryTableId?: string;
  joinedTableIds?: string[];
  barTabId?: string;
  barTabName?: string;
  paymentFraction?: PaymentFractionPlan;
  serviceType?: OrderServiceType;
}

export interface PaymentFractionPart {
  index: number;
  amount: number;
  status: 'PENDING' | 'PAID';
  /** Nombre operativo independiente para identificar esta cuota en la mesa. */
  name?: string;
  payments?: PaymentEntry[];
  voluntaryTip?: number;
  paidAt?: string;
}

export interface PaymentFractionPlan {
  originalTotal: number;
  count: number;
  createdAt: string;
  parts: PaymentFractionPart[];
}

export type ReservationStatus = 'ACTIVE' | 'INVOICED' | 'EXPIRED' | 'CANCELLED';

export interface Reservation {
  id: string;
  code: string;
  qrPayload: string;
  customerId: string;
  customerName: string;
  total: number;
  balancePaid: number;
  expiryDate: string;
  status: ReservationStatus;
  items: CartItem[];
  warehouseId?: string;
  deliveryDate?: string;
  notes?: string;
  terminalId?: string;
  zReportId?: string;
  zReportSequence?: string;
  createdById?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  invoicedAt?: string;
  invoicedTransactionId?: string;
  expiredAt?: string;
  cloudSyncStatus?: CloudSyncStatus;
  cloudSyncError?: string;
  cloudSyncedAt?: string;
  sourceChannel?: 'UBER_EATS';
  sourceOrderId?: string;
  sourceStoreId?: string;
  tenantId?: string;
  companyId?: string;
  storeId?: string;
  sourceStatus?: string;
  prepaidPayment?: {
    method: PaymentMethod;
    label: string;
    amount: number;
    externalReference?: string;
  };
}

export interface PaymentEntry {
  id: string;
  method: PaymentMethod;
  methodId?: string;
  methodLabel?: string;
  methodIcon?: string;
  creditOverrideApproved?: boolean;
  amount: number;
  timestamp: Date;
  currencyCode?: string;
  amountOriginal?: number;
  exchangeRate?: number;
  appliedAmount?: number;
  changeAmount?: number;
  changeCurrencyCode?: string;
  amountApplied?: number;
  payment_method?: PaymentMethod | string;
  currency_code?: string;
  exchange_rate?: number;
  applied_amount?: number;
  change_amount?: number;
  change_currency_code?: string;
  source_channel?: 'POS';
  source_payment_id?: string;
  source_transaction_id?: string;
  source_display_id?: string;
  source_terminal_id?: string;
  device_id?: string;
  gatewayProvider?: PaymentIntegrationProvider;
  gatewayIntegrationId?: string;
  paymentIntentId?: string;
  gatewayIdempotencyKey?: string;
  gatewayTransactionType?: 'SALE' | 'VOID' | 'REFUND' | 'GET_LAST_TRX';
  gatewayStatus?: string;
  gatewayResponseCode?: string;
  gatewayResponseMessage?: string;
  gatewayAuthorizationCode?: string;
  gatewayReference?: string;
  gatewaySequenceNumber?: string;
  gatewayInvoiceNumber?: string;
  gatewayBatchNumber?: string;
  gatewayMerchantId?: string;
  gatewayTerminalId?: string;
  gatewayOrderNumber?: string;
  gatewayProcessedAmount?: number;
  gatewayProcessedTaxAmount?: number;
  gatewayMaskedPan?: string;
  gatewayCardBrand?: string;
  gatewayEntryMode?: string;
  /** HOST CardNET de la transacción (06=Crédito, 07=Débito, 08=AMEX, 09=Privada, 10=Peaje, 11=tPago, 12=Otro). */
  gatewayHost?: string;
  /** Tipo de producto CardNET (VC, MC, MD, AC, DC, OT...). */
  gatewayCardProduct?: string;
  gatewayReceiptMerchant?: string;
  gatewayReceiptClient?: string;
  gatewaySignatureData?: string;
  gatewayRequireSignature?: boolean;
  gatewayRawResponse?: Record<string, any>;
}

export type RefundSettlementMode = 'WALLET' | 'CARD_VOID' | 'CARD_REFUND';

export interface RefundProcessingOptions {
  refundPayments?: PaymentEntry[];
  settlementMode?: RefundSettlementMode;
  skipWalletDeposit?: boolean;
  autoPrintIntegratedArtifacts?: boolean;
  erpRefundPreparation?: ErpRefundPreparation;
  erpRefundAuthority?: ErpRefundAuthority;
}

export interface ErpRefundPreparation {
  commandId: string;
  reservationId: string;
  sourceId: string;
  sourceRevision: string;
  expiresAt?: string;
}

export interface ErpRefundAuthority {
  documentAuthority: {
    seriesId: string;
    seriesNumber: number;
    displayId: string;
  };
  fiscalAuthority: null | {
    ncfType: 'B04';
    ncf: string;
    reservationId: string;
  };
}

export interface ErpRefundSourceBinding {
  sourceId: string;
  sourceRevision: string;
  reference: string;
  originalTerminalId?: string;
  remainingQuantities: Record<string, number>;
  refundable: boolean;
  eligibilityCode?: string;
  eligibilityMessage?: string;
}

export interface CustomerTransaction {
  id: string;
  date: string;
  total: number;
  status: string;
}

export interface Shift {
  id: string;
  userId: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  label: string;
  color: string;
}

export interface TimeRecord {
  id: string;
  userId: string;
  type: 'IN' | 'OUT';
  timestamp: string;
  method: 'PIN' | 'FACE_ID';
}

export type LabelElementType = 'TEXT' | 'BARCODE' | 'QR';
export type LabelDataSource = 'CUSTOM_TEXT' | 'PRODUCT_NAME' | 'PRODUCT_PRICE' | 'PRODUCT_SKU';
export type LabelTemplateCategory = 'ARTICLE' | 'GONDOLA';

export interface LabelElement {
  id: string;
  type: LabelElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  dataSource: LabelDataSource;
  fontSize?: number;
  isBold?: boolean;
}

export interface LabelTemplate {
  id: string;
  name: string;
  category: LabelTemplateCategory;
  widthMm: number;
  heightMm: number;
  elements: LabelElement[];
}

export interface BehaviorConfig {
  allowNegativeStock: boolean;
  askGuestsOnTicketOpen: boolean;
  autoLogoutMinutes: number;
  requireManagerForRefunds: boolean;
  autoPrintZReport: boolean;
}

export interface AttributeValue {
  id: string;
  name: string;
  shortCode: string;
  value: string;
}

export interface AttributeDefinition {
  id: string;
  name: string;
  type: AttributeType;
  values: AttributeValue[];
}

export interface VariantTemplate {
  id: string;
  name: string;
  attributeId: string;
  valueIds: string[];
}

export type MediaType = 'IMAGE' | 'VIDEO';

export interface MediaAsset {
  id: string;
  type?: MediaType;
  url: string;
  posterUrl?: string;
  mimeType?: string;
  storagePath?: string;
  version?: string;
  sortOrder?: number;
  active?: boolean;
}

export interface CustomerDisplayAd extends MediaAsset {
  active: boolean;
}

export interface CustomerDisplayConfig {
  isEnabled: boolean;
  welcomeMessage: string;
  showItemImages: boolean;
  showQrPayment: boolean;
  layout: 'SPLIT' | 'FULL_TOTAL' | 'MARKETING_ONLY';
  connectionType: 'NETWORK' | 'USB' | 'VIRTUAL' | 'HDMI' | 'ANDROID_SECONDARY';
  ipAddress?: string;
  ads: CustomerDisplayAd[];
}

export interface ScaleDevice {
  id: string;
  name: string;
  isEnabled: boolean;
  technology: ScaleTech;
  directConfig?: {
    port: string;
    baudRate: number;
    dataBits: number;
    protocol: string;
  };
  labelConfig?: {
    mode: 'WEIGHT' | 'PRICE';
    prefixes: string[];
    decimals: number;
    itemDigits: number;
    valueDigits: number;
  };
}

// --- EXTERNAL COUPONS ---

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  benefitType: 'PERCENT' | 'FIXED_AMOUNT' | 'FREE_ITEM';
  benefitValue: number;
  minPurchaseAmount?: number;
  maxDiscountAmount?: number;
  activeDays?: string[]; // ['L', 'M', 'X', 'J', 'V', 'S', 'D']
  activeHours?: { start: string; end: string };
  startDate: string;
  endDate: string;
  totalGenerated: number;
  createdAt: string;
}

export interface Coupon {
  id: string;
  campaignId: string;
  code: string;
  status: 'GENERATED' | 'ASSIGNED' | 'REDEEMED' | 'EXPIRED';
  assignedTo?: string;
  redeemedAt?: string;
  ticketRef?: string;
  terminalId?: string;
  createdAt: string;
}

export interface RedeemedCouponRef {
  id: string;
  code: string;
  campaignId?: string;
  assignedTo?: string;
}



// --- SUPERVISOR INTERVENTION ---

export type Permission =
  | 'ALL'
  | 'CAN_REFUND'
  | 'POS_CREDIT_OVERRIDE'
  | 'POS_PAY_CREDIT'
  | 'POS_ALLOW_ZERO_PRICE'
  | 'POS_ALLOW_SALES_WITH_OPEN_Z'
  // --- POS CORE ---
  | 'SALE'
  | 'POS_VOID_ITEM'
  | 'POS_VOID_TICKET'
  | 'POS_EDIT_SUBTOTALIZED_TICKET'
  | 'POS_VOID_SUBTOTALIZED_TICKET'
  | 'POS_VOID_PAID_TICKET'
  | 'POS_DISCOUNT'
  | 'POS_PRICE_OVERRIDE'
  | 'POS_OPEN_DRAWER'
  | 'POS_RETURNS'
  | 'POS_REPRINT_RECEIPT'
  | 'POS_NEW_SALE'
  | 'POS_CHECKOUT'
  | 'POS_CHANGE_TARIFF'
  | 'POS_RESEND_INVOICE_EMAIL'
  | 'POS_ADJUST_INVOICE_TIP'
  | 'POS_CHANGE_INVOICE_CUSTOMER'
  | 'POS_FLAG_INVOICE_REVIEW'
  | 'POS_VIEW_INVOICE_AUDIT'
  | 'POS_COMPLIMENTARY_SALE'
  | 'POS_OVERRIDE_INVOICE_LIMIT'
  | 'POS_VIEW_X_REPORT'
  | 'POS_CLOSE_X'
  | 'POS_CLOSE_Z'
  | 'POS_REPEAT_Z_REPORT'
  | 'POS_VIEW_ACTIVE_CASH'
  | 'POS_MANAGE_PARKED'
  | 'POS_ACCESS_OTHER_SELLER_TABLES'
  | 'TABLE_CONTROL_CENTER'

  // --- CATALOG ---
  | 'CATALOG_VIEW'
  | 'CATALOG_MANAGE'
  | 'CATALOG_VIEW_COST'
  | 'TARIFF_MANAGE'
  | 'POS_CATALOG_CONFLICT_VIEW'
  | 'POS_CATALOG_CONFLICT_RETRY'
  | 'POS_CATALOG_CONFLICT_DISCARD'
  | 'POS_CATALOG_CONFLICT_ACCEPT_ERP'
  | 'POS_CATALOG_CONFLICT_FORCE'

  // --- INVENTORY ---
  | 'INVENTORY_VIEW'
  | 'INVENTORY_ADJUST'
  | 'INVENTORY_TRANSFER'
  | 'SUPPLY_CHAIN_ORDER'
  | 'SUPPLY_CHAIN_RECEIVE'

  // --- CUSTOMERS ---
  | 'CUSTOMER_VIEW'
  | 'CUSTOMER_MANAGE'
  | 'CUSTOMER_CREDIT_LIMIT'
  | 'CUSTOMER_VIEW_DEBT'
  | 'CUSTOMER_ALERT_VIEW'
  | 'CUSTOMER_ALERT_MANAGE'

  // --- FINANCE & REPORTS ---
  | 'REPORTS_VIEW_SALES'
  | 'REPORTS_VIEW_FINANCIAL'
  | 'EXPENSE_MANAGE'

  // --- ADMIN & SETTINGS ---
  | 'SETTINGS_ACCESS'
  | 'SETTINGS_HARDWARE'
  | 'SETTINGS_USERS'
  | 'SETTINGS_TAXES'
  | 'AUDIT_LOG_VIEW';



export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actionType: Permission;
  actionDescription?: string;
  cashierId: string;
  supervisorId: string;
  terminalId: string;
  ticketId?: string;
  itemId?: string;
  originalValue?: number;
  newValue?: number;
  reason?: string;
  details?: string;
  hash: string;
}

export type InvoiceReviewStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED';
export type InvoiceReviewPriority = 'LOW' | 'NORMAL' | 'HIGH';

export interface InvoiceReviewFlag {
  id: string;
  transactionId: string;
  transactionDisplayId?: string;
  status: InvoiceReviewStatus;
  category: 'PAYMENT_METHOD_ERROR' | 'CUSTOMER_DATA' | 'TIP' | 'FISCAL' | 'OTHER';
  priority: InvoiceReviewPriority;
  comment: string;
  tenantId?: string;
  companyId?: string;
  storeId?: string;
  terminalId: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  resolvedById?: string;
  resolvedByName?: string;
  resolvedAt?: string;
  resolutionComment?: string;
  syncStatus?: SyncStatus;
  syncError?: string;
}

export type InvoiceAuditEventType =
  | 'REVIEW_FLAGGED'
  | 'REVIEW_STATUS_CHANGED'
  | 'EMAIL_RESENT'
  | 'EMAIL_RESEND_FAILED'
  | 'VOLUNTARY_TIP_ADJUSTED'
  | 'ECF_CUSTOMER_CORRECTED'
  | 'COMPLIMENTARY_CREATED';

export interface InvoiceAuditEvent {
  id: string;
  transactionId: string;
  transactionDisplayId?: string;
  eventType: InvoiceAuditEventType;
  previousData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  reason?: string;
  metadata?: Record<string, unknown>;
  tenantId?: string;
  companyId?: string;
  storeId?: string;
  terminalId: string;
  actorId: string;
  actorName: string;
  authorizedById?: string;
  authorizedByName?: string;
  occurredAt: string;
  idempotencyKey: string;
  syncStatus?: SyncStatus;
  syncError?: string;
}

export type InvoiceAdjustmentType = 'VOLUNTARY_TIP_ADJUSTMENT' | 'ECF_CUSTOMER_CHANGE';

export interface InvoiceAdjustment {
  id: string;
  transactionId: string;
  transactionDisplayId?: string;
  type: InvoiceAdjustmentType;
  previousData: Record<string, unknown>;
  newData: Record<string, unknown>;
  reasonCode: string;
  reason: string;
  requestedById: string;
  requestedByName: string;
  authorizedById?: string;
  authorizedByName?: string;
  tenantId?: string;
  companyId?: string;
  storeId?: string;
  terminalId: string;
  occurredAt: string;
  baseRevision: number;
  idempotencyKey: string;
  fiscalImpact: 'NONE' | 'PENDING_FISCAL_RETRY';
  syncStatus?: SyncStatus;
  syncError?: string;
}

// --- LOYALTY & WALLET TYPES ---

export type WalletTransactionType = 'DEPOSIT' | 'PAYMENT' | 'REFUND' | 'CASHBACK';

export interface WalletTransaction {
  id: string;
  walletId: string;
  type: WalletTransactionType;
  amount: number;
  referenceId?: string; // Ticket ID or External Ref
  timestamp: string;
}

export interface Wallet {
  id: string;
  customerId: string;
  balance: number;
  currency: string;
  status: 'ACTIVE' | 'BLOCKED';
  lastActivity: string;
  transactions: WalletTransaction[];
  pushToken?: string;
}

export type LoyaltyTransactionType = 'EARN' | 'REDEEM' | 'ADJUSTMENT';

export interface LoyaltyTransaction {
  id: string;
  cardId: string;
  type: LoyaltyTransactionType;
  points: number;
  referenceId?: string;
  timestamp: string;
}

export interface LoyaltyCard {
  id: string;
  customerId: string;
  type: 'LOYALTY' | 'GIFT';
  cardNumber: string; // Barcode/QR
  pointsBalance: number;
  status: 'ACTIVE' | 'LOST';
  issuedAt: string;
  history: LoyaltyTransaction[];
}
// --- Z-REPORT HISTORY ---
export interface ZReportStats {
  averageTicket: number;
  itemsPerSale: number;
  peakHour: string; // e.g., "14:00 - 15:00"
  topProduct: {
    name: string;
    quantity: number;
    total: number;
  } | null;
  returnsCount: number;
  returnsTotal: number;
  grossSales: number; // New: Ventas Brutas
  netSales: number; // New: Ventas Netas
  discountsTotal: number; // New: Total discounts given
  advancementsTotal: number; // New: Total gift card / wallet deposits (Liabilities)
  collectionsTotal: number; // New: Total CXC Collections (Abonos)
}

export interface ServiceTypeSummaryLine {
  serviceType: OrderServiceType;
  transactionCount: number;
  total: number;
  taxAmount: number;
  serviceChargeAmount: number;
}

export interface ServiceTypeTransactionLine {
  transactionId: string;
  displayId: string;
  date: string;
  serviceType: Extract<OrderServiceType, 'TAKEOUT' | 'DELIVERY'>;
  total: number;
}

export type ZReportModule = 'FINANCIAL' | 'PAYMENTS' | 'CASH_DETAILS' | 'KPIS' | 'AUDIT';

export type CloseReportSection =
  | 'SELLER_SUMMARY'
  | 'ITEM_SUMMARY'
  | 'TAX_SUMMARY'
  | 'CURRENCY_BREAKDOWN'
  | 'HOURLY_SALES';

export interface CloseReportSellerSummaryLine {
  userId: string;
  userName: string;
  transactionCount: number;
  netSales: number;
}

export interface CloseReportItemSummaryLine {
  productId: string;
  productName: string;
  quantity: number;
  netSales: number;
}

export interface CloseReportTaxSummaryLine {
  taxId: string;
  taxName: string;
  rate: number;
  taxableBase: number;
  taxAmount: number;
}

export interface CloseReportHourlySalesLine {
  hour: number;
  label: string;
  transactionCount: number;
  netSales: number;
}

export interface CloseReportDetails {
  sellerSummary?: CloseReportSellerSummaryLine[];
  itemSummary?: CloseReportItemSummaryLine[];
  taxSummary?: CloseReportTaxSummaryLine[];
  hourlySales?: CloseReportHourlySalesLine[];
}

export interface ZReportDeclaredTotals {
  cash: number;
  card: number;
  other: number;
  total_declared: number;
}

export interface ZReportSystemTotals {
  expected_cash: number;
  expected_card: number;
  expected_other: number;
  total_expected: number;
  cash_difference: number;
  total_difference: number;
}

export interface ZReportSyncAudit {
  total_tickets_issued: number;
  first_ticket_id: string | null;
  last_ticket_id: string | null;
}

export interface ZReportDenominationLine {
  denomination: number;
  quantity: number;
  total: number;
}

export interface ZReportPaymentMethodLine {
  methodId?: string;
  methodType: PaymentMethod | string;
  name: string;
  amount: number;
  isPending?: boolean;
}

export interface ZReportPaymentMethodDeclaration extends ZReportPaymentMethodLine {
  expected: number;
  declared: number;
  difference: number;
}

export type ZReportDenominationBreakdown = Record<string, ZReportDenominationLine[]>;

export interface ZReportCashMovementLine {
  id: string;
  type: 'IN' | 'OUT';
  amount: number;
  reason: string;
  timestamp: string;
  userName?: string;
  currencyCode?: string;
}

export interface ZReport {
  id: string;
  terminalId: string;
  sequenceNumber: string; // e.g., Z-0001
  seriesId?: string;
  seriesNumber?: number;
  source_channel?: 'POS';
  source_z_report_id?: string;
  source_terminal_id?: string;
  device_id?: string;
  openedAt: string; // Timestamp of first transaction/movement since last Z
  closedAt: string;
  closedByUserId: string;
  closedByUserName: string;

  // Financials
  baseCurrency: string;
  totalsByMethod: Record<string, number>; // CASH, CARD, etc.
  /** Desglose con el nombre configurado y el monto aplicado a los tickets. */
  paymentMethodSummary?: ZReportPaymentMethodLine[];
  /** Medios que el usuario declaró manualmente en este cierre. */
  paymentMethodDeclarations?: ZReportPaymentMethodDeclaration[];

  // Cash Details (Multi-currency)
  cashExpected: Record<string, number>;
  cashCounted: Record<string, number>;
  cashDiscrepancy: Record<string, number>;
  denominationBreakdown?: ZReportDenominationBreakdown;
  denomination_breakdown?: ZReportDenominationBreakdown;

  // Movements
  cashSales: number;
  cashIn: number;
  cashOut: number;
  cashMovementDetails?: ZReportCashMovementLine[];
  requireCashFundOnZ?: boolean;
  fixedCashFundAmount?: number;
  cashToLeaveInDrawer?: number;
  cashToWithdraw?: number;

  // Metadata
  transactionCount: number;
  notes: string;
  declared_totals?: ZReportDeclaredTotals;
  system_totals?: ZReportSystemTotals;
  sync_audit?: ZReportSyncAudit;

  // Analytics
  stats?: ZReportStats;
  serviceTypeSummary?: ServiceTypeSummaryLine[];
  serviceTypeTransactions?: ServiceTypeTransactionLine[];
  // Immutable print summary of recorded amounts, independent of current tax settings.
  closeTaxSummary?: Array<{ name: string; rate?: number; amount: number }>;
  enabledSections?: CloseReportSection[];
  reportDetails?: CloseReportDetails;
  syncStatus?: SyncStatus;
  syncError?: string;
  /** Exact local members sealed when the close is first persisted. */
  recoveryMemberIds?: {
    transactions: string[];
    cashMovements: string[];
    collections: string[];
  };
}

export interface XReport extends ZReport {
  reportType: 'X';
  source_x_report_id?: string;
}
// --- ANALYTICS & ADVANCED REPORTING ---
export type AnalyticsCategory =
  | 'SOURCING'
  | 'INVENTORY'
  | 'CUSTOMERS'
  | 'FISCAL'
  | 'OPERATIONS'
  | 'CATALOG'
  | 'HR';

// --- ACCOUNTS RECEIVABLE (CxC) & COLLECTIONS ---
export type CollectionMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'CHECK' | 'WALLET';

export interface CollectionAllocation {
  id: string;
  collectionId: string;
  transactionId: string;
  amount: number;
  timestamp: string;
}

export interface Collection {
  id: string;
  displayId: string; // RC-000001
  seriesId?: string;
  seriesNumber?: number;
  customerId: string;
  customerName: string;
  date: string;
  totalAmount: number;
  method: CollectionMethod;
  currencyCode?: string;
  exchangeRate?: number;
  receivedAmountOriginal?: number;
  receivedAmountBase?: number;
  appliedAmountBase?: number;
  unappliedAmountBase?: number;
  reference?: string;
  userId: string;
  userName: string;
  terminalId: string;
  bookingActivityId?: string;
  opportunityId?: string;
  allocations: CollectionAllocation[];
  notes?: string;
  syncStatus?: SyncStatus;
  zReportId?: string;
  zReportSequence?: string;
}

export interface ReportField {
  key: string;
  label: string;
  type: 'TEXT' | 'NUMBER' | 'CURRENCY' | 'DATE' | 'PERCENT' | 'STATUS';
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
}

export interface ReportDefinition {
  id: string;
  category: AnalyticsCategory;
  title: string;
  description: string;
  icon: string; // Lucide icon name or component
  fields: ReportField[];
  filters: {
    warehouse?: boolean;
    dateRange?: boolean;
    supplier?: boolean;
    customer?: boolean;
    category?: boolean;
  };
}

// --- HR & ATTENDANCE ---
export interface AttendanceLog {
  id: string;
  userId: string;
  userName: string;
  type: 'CLOCK_IN' | 'CLOCK_OUT';
  timestamp: string;
  terminalId: string;
  gpsLocation?: {
    lat: number;
    lng: number;
  };
  notes?: string;
  syncStatus?: SyncStatus;
}

// --- CRM & BOOKING TYPES ---

export type ActivityNature = 'CRM' | 'BOOKING';

export type ActivityType = string;

export type ActivityPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type ActivityStatus = 'PLANNED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface Activity {
  id: string;
  displayId: string;
  nature: ActivityNature;
  type: ActivityType;
  title: string;
  description?: string;
  status: ActivityStatus;
  priority: ActivityPriority;
  outcome?: string; // Captured when completed (e.g., "Interesado", "Generó Cotización")

  // Timings
  startDate: string; // ISO
  endDate: string;   // ISO
  allDay?: boolean;
  reminderMinutes?: number; // Minutes before start

  // Relationships
  customerId?: string;
  customerName?: string;
  opportunityId?: string;
  opportunityTitle?: string;
  assignedToId: string; // Employee/User assigned
  assignedToName: string;
  spaceId?: string; // Room ID if BOOKING
  spaceName?: string;

  // Integration
  linkedTransactionId?: string; // To Quote/Invoice
  linked_document_id?: string; // ERP sales document id for BOOKING flows
  linkedDocumentId?: string;
  linkedDocumentType?: BookingSalesDocumentType;
  linkedDocumentDisplayId?: string;
  reservationId?: string;
  items?: CartItem[]; // Linked products/services
  required_deposit?: number;
  current_balance?: number;
  payment_status?: 'PENDING' | 'PARTIAL' | 'PAID';

  // Metadata
  terminalId: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface ActivityStats {
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byEmployee: Record<string, number>;
  successRate?: number;
}
