

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

// --- SYNC CONFIGURATION TYPES ---
export type SyncMode = 'MASTER' | 'SLAVE';
export type SyncStatus = 'PENDING' | 'SYNCING' | 'COMPLETED' | 'ERROR' | 'BLOCKED_FUNCTIONAL';
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
  SELF_CHECKOUT = 'SELF_CHECKOUT',
  PRICE_CHECKER = 'PRICE_CHECKER',
  HANDHELD_INVENTORY = 'HANDHELD_INVENTORY',
  KITCHEN_DISPLAY = 'KITCHEN_DISPLAY'
}

export enum AuthLevel {
  USER_REQUIRED = 'USER_REQUIRED',    // Level A: Requiere login de empleado
  HEADLESS = 'HEADLESS'                // Level B: Autenticación automática vía API Token
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
}

// --- FISCAL NCF TYPES ---
export type NCFType = 'B01' | 'B02' | 'B04' | 'B14' | 'B15';

export interface FiscalRangeDGII {
  id: string;
  type: NCFType;
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
  type: NCFType;
  rangeStart: number;
  rangeEnd: number;
  assignedAt: string;
  status: 'ACTIVE' | 'EXHAUSTED';
}

export interface LocalFiscalBuffer {
  id: string;
  type: NCFType;
  prefix: string;
  currentNumber: number; // El que se usará en la próxima factura
  endNumber: number;     // Límite de este lote
  expiryDate: string;
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
  name: string;
  rate: number;
  type: 'VAT' | 'SERVICE_CHARGE' | 'EXEMPT' | 'OTHER';
}

export interface CompanyInfo {
  name: string;
  rnc: string;
  phone: string;
  address: string;
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
}

// Document Types for all transaction categories
export type DocumentType =
  // Sales
  | 'TICKET'           // Regular sale
  | 'REFUND'           // Refund/Return
  | 'VOID'             // Voided transaction

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
  documentType: DocumentType;  // Functional type
  name: string;
  description: string;
  prefix: string;
  nextNumber: number;
  padding: number;
  icon: string;
  color: string;
  businessUnit?: string;  // Optional: "Tienda Norte", "Caja Express"
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
  isPrimaryNode?: boolean; // Rol jerárquico de la terminal
  governedByMaster?: boolean; // NEW: If true, this terminal follows the configuration defined by the Master
  startWithAgenda?: boolean; // NEW: Boot directly into Agenda view
  deviceRole?: DeviceRoleConfig; // NEW: Configuración de rol de dispositivo

  fiscal: {
    batchSize: number; // Deprecated but kept for compatibility
    lowBatchThreshold: number;
    // New: Configuration per NCF Type
    typeConfigs?: Partial<Record<NCFType, NCFConfig>>;
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
    allowBiometrics?: boolean; // NEW: Biometric Auth Toggle
  };
  pricing: {
    allowedTariffIds: string[];
    defaultTariffId: string;
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
      zReportEmails?: string;
      // New fields for Z Report Expansion
      checkOpenOrders: boolean;
      forceDenominationCount: boolean;
      cashVarianceThreshold: number;
      emailZReport: boolean;
      // New fields for Force Z on Day Change
      forceZChange: boolean;
      businessStartHour: number;
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
  };
  documentSeries: DocumentSeries[];
  documentAssignments?: Record<string, string>; // Mapeo de Rol -> ID de DocumentSeries maestra
  hardware: {
    cashDrawerTrigger: 'PRINTER' | 'DIRECT';
    receiptPrinterId?: string;
    printerAssignments?: Record<string, string>; // Roles: TICKET, LABEL, KITCHEN, LOGISTICS
    customerDisplay?: CustomerDisplayConfig;
    scales?: ScaleDevice[];
  };
  operational: {
    vertical_negocio: VerticalType;
    usa_mesas: boolean;
    pantalla_inicio: 'VENTA_DIRECTA' | 'MAPA_MESAS';
    bloqueo_meseros: boolean;
    pedir_comensales: boolean;
    usa_modulos_cocina: boolean;
    defaultTaxIds?: string[];
    reservationPolicy?: {
      validityDays: number;
      requireAdvance: boolean;
      minimumAdvancePercent: number;
    };
    fiscalThreshold?: number;
    expandTicket?: boolean;
    showGlobalSales?: boolean;
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
  };
  inventoryScope?: {
    defaultSalesWarehouseId: string;
    visibleWarehouseIds: string[];
  };
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
}

export type PaymentMethod = 'CASH' | 'CARD' | 'QR' | 'WALLET' | 'ADVANCE' | 'OTHER' | 'CREDIT';

export interface PaymentMethodDefinition {
  id: string;
  name: string;
  type: PaymentMethod;
  isEnabled: boolean;
  icon: string;
  color: string;
  opensDrawer: boolean;
  requiresSignature: boolean;
  integration: 'NONE' | 'CARNET' | 'VISANET' | 'STRIPE';
  integrationConfig?: Record<string, string>;
  paymentTermDays?: number; // Solo aplica para tipo CREDIT
}


export type AttributeType = 'TEXT' | 'COLOR' | 'IMAGE';
export type PricingStrategyType = 'MANUAL' | 'COST_PLUS' | 'DERIVED';
export type RoundingRule = 'NONE' | 'ENDING_99' | 'CEILING' | 'ROUND_HALF_UP' | 'ROUND_FLOOR';

export interface Modifier {
  id: string;
  name: string;
  price: number;
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
  allowCustomTip: boolean;
  serviceCharge: {
    enabled: boolean;
    percentage: number;
    applyIfTotalOver: number;
    applyIfGuestsOver: number;
  };
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
}

export interface BusinessConfig {
  vertical: VerticalType;
  subVertical: SubVertical;
  currencySymbol: string;
  taxRate: number;
  taxes: TaxDefinition[];
  themeColor: 'blue' | 'orange' | 'gray';
  features: {
    stockTracking: boolean;
  };
  units?: UnitDefinition[]; // NEW: Centralized units list
  loyalty?: LoyaltyConfig;
  companyInfo: CompanyInfo;
  currencies: CurrencyConfig[];
  paymentMethods: PaymentMethodDefinition[];
  terminals: { id: string; config: TerminalConfig }[];
  tariffs: Tariff[];
  productGroups?: ProductGroup[];
  seasons?: Season[];
  receiptConfig?: ReceiptConfig;
  labelTemplates?: LabelTemplate[];
  tipsConfig?: TipConfiguration;
  emailConfig?: EmailConfig;

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
    reservationPolicy?: {
      validityDays: number;
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
}

export interface RoleDefinition {
  id: string;
  name: string;
  permissions: Permission[];
  maxDiscountPercent?: number;
  isSystem?: boolean;
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
  name: string;
  phone?: string;
  email?: string;
  taxId?: string;
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
  defaultNcfType?: NCFType;
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

export type ProductType = 'MATERIA_PRIMA' | 'PRODUCTO_TERMINADO' | 'RECETA' | 'KIT' | 'PRODUCT' | 'SERVICE';

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
  name: string;
  price: number;
  category: string;
  stock?: number;
  qty_committed?: number; // Committed for events/bookings
  image?: string;
  barcode?: string;
  cost?: number;
  is_sellable?: boolean;
  theoreticalCost?: number; // New calculated cost
  type?: ProductType;
  isInventoriable?: boolean;
  recipeDetails?: RecipeDetail[]; // The BOM
  images: string[];
  attributes: ProductAttribute[];
  variants: ProductVariant[];
  tariffs: TariffPrice[];
  stockBalances?: Record<string, number>;
  activeInWarehouses?: string[];
  appliedTaxIds: string[];
  minStock?: number;
  warehouseSettings?: Record<string, { min: number, max: number }>;
  availableModifiers?: Modifier[];
  description?: string;
  departmentId?: string;
  sectionId?: string;
  familyId?: string;
  subfamilyId?: string;
  brandId?: string;
  operationalFlags?: ProductOperationalFlags;
  requires_verification?: boolean;
  updatedAt?: string;
  hasActivePromotion?: boolean; // UI Flag for badges
  returnReason?: string; // For items with qty < 0
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
export type TableShape = 'SQUARE' | 'CIRCLE' | 'OBSTACLE';

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
  };
}

export interface Table {
  id: string;
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
  modifiers?: string[];
  note?: string;
  originalPrice?: number; // Optional: track original product price for auditing
  salespersonId?: string;
  ncf?: string; // NCF asignado a esta línea o al ticket
  appliedPromotionId?: string;
  trackingId?: string; // NEW: Assigned lot/serial ID
  trackingCode?: string; // NEW: Assigned lot/serial code
  trackingData?: any[]; // NEW: Detailed tracking records selected
  variantSku?: string; // NEW: Specific SKU for variants
  variantInfo?: string; // NEW: Human readable variant detail
}

export interface Transaction {
  // Identifiers
  id: string;
  globalSequence?: number;          // Global unique sequence number
  displayId?: string;               // User-visible ID (e.g., "TCK01-000123")

  // Document Classification
  documentType?: DocumentType;      // Type of transaction
  seriesId?: string;                // Reference to DocumentSeries
  seriesNumber?: number;            // Number within the series

  // Transaction Data
  date: string;
  items: CartItem[];
  total: number;
  payments: any[];

  // User & Terminal
  userId: string;
  userName: string;
  terminalId?: string;

  // Status
  status: 'COMPLETED' | 'REFUNDED' | 'PARTIAL_REFUND';

  // Audit (RBAC)
  authorizedById?: string;
  authorizedByName?: string;

  // Customer
  customerId?: string;
  customerName?: string;
  customerSnapshot?: {
    name: string;
    taxId?: string;
    address?: string;
    phone?: string;
    email?: string;
  };

  // Accounting
  taxAmount?: number;               // Total tax amount
  netAmount?: number;               // Net amount (before tax)
  discountAmount?: number;
  isTaxIncluded?: boolean;

  // Fiscal
  ncf?: string;                     // NCF final del documento
  ncfType?: NCFType;
  affectedNCF?: string;             // NCF de la factura afectada (para Notas de Crédito B04)
  affectedInvoiceNumber?: string;   // No. de factura afectada (displayId para búsquedas)
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

  // Relationships
  relatedTransactions?: string[];   // Related transaction IDs
  originalTransactionId?: string;   // For refunds/voids
  refundReason?: string;
  syncStatus?: SyncStatus;
  syncError?: string;
  zReportId?: string; // ID of the Z-Report that closed this transaction
  zReportSequence?: string; // Human readable sequence number of the Z-Report (e.g. "Z-000123")

  // Wallet Interaction
  walletDepositAmount?: number;     // Amount sent to customer wallet (advance/refund)
  walletPaymentAmount?: number;     // Amount paid using customer wallet balance
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
}

export interface StockTransferItem {
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
  status: 'IN_TRANSIT' | 'COMPLETED';
  createdAt: string;
  sentAt?: string;
  receivedAt?: string;
  createdBy?: string;
  terminalId?: string;
  syncStatus?: SyncStatus;
  syncError?: string;
  updatedAt?: string;
  discrepancyReason?: string;
}

export type PromotionType = 'DISCOUNT' | 'BOGO' | 'SECOND_PAIR' | 'HAPPY_HOUR' | 'CONDITIONAL_TARGET' | 'BUNDLE';
export type PromotionTargetType = 'ALL' | 'PRODUCT' | 'CATEGORY' | 'GROUP' | 'SEASON';
export type PromotionBenefitType = 'DISCOUNT_PERCENT' | 'FIXED_PRICE' | 'CASHBACK' | 'POINTS_MULTIPLIER';

export interface PromotionCondition {
  type: 'HAS_WALLET' | 'CUSTOMER_TIER' | 'HAS_POINTS_MIN';
  value: string; // "GOLD", "100", "TRUE"
}

export interface Promotion {
  id: string;
  name: string;
  type: PromotionType;
  priority: number;

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
  targetValue?: string; // ID of Product, Category, Group, Season
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
}

export interface Supplier {
  id: string;
  name: string;
  taxId: string; // RNC o Cédula
  email: string;
  phone: string;
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
  customerId?: string;
  customerName?: string;
  timestamp: string;
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
}

export interface PaymentEntry {
  id: string;
  method: PaymentMethod;
  methodId?: string;
  methodLabel?: string;
  methodIcon?: string;
  amount: number;
  timestamp: Date;
  currencyCode?: string;
  amountOriginal?: number;
  exchangeRate?: number;
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

export interface CustomerDisplayConfig {
  isEnabled: boolean;
  welcomeMessage: string;
  showItemImages: boolean;
  showQrPayment: boolean;
  layout: 'SPLIT' | 'FULL_TOTAL' | 'MARKETING_ONLY';
  connectionType: 'NETWORK' | 'USB' | 'VIRTUAL' | 'HDMI';
  ipAddress?: string;
  ads: { id: string; url: string; active: boolean }[];
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



// --- SUPERVISOR INTERVENTION ---

export type Permission =
  | 'ALL'
  | 'CAN_REFUND'
  | 'POS_CREDIT_OVERRIDE'
  | 'POS_PAY_CREDIT'
  | 'POS_NEW_SALE'
  | 'POS_ALLOW_ZERO_PRICE'
  // --- POS CORE ---
  | 'SALE'
  | 'POS_VOID_ITEM'
  | 'POS_VOID_TICKET'
  | 'POS_VOID_PAID_TICKET'
  | 'POS_DISCOUNT'
  | 'POS_PRICE_OVERRIDE'
  | 'POS_OPEN_DRAWER'
  | 'POS_RETURNS'
  | 'POS_REPRINT_RECEIPT'
  | 'POS_CLOSE_Z'
  | 'POS_VIEW_ACTIVE_CASH'
  | 'POS_MANAGE_PARKED'

  // --- CATALOG ---
  | 'CATALOG_VIEW'
  | 'CATALOG_MANAGE'
  | 'CATALOG_VIEW_COST'
  | 'TARIFF_MANAGE'

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
  cashierId: string;
  supervisorId: string;
  terminalId: string;
  ticketId?: string;
  itemId?: string;
  originalValue?: number;
  newValue?: number;
  reason?: string;
  hash: string;
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

export type ZReportModule = 'FINANCIAL' | 'PAYMENTS' | 'CASH_DETAILS' | 'KPIS' | 'AUDIT';

export interface ZReport {
  id: string;
  terminalId: string;
  sequenceNumber: string; // e.g., Z-0001
  openedAt: string; // Timestamp of first transaction/movement since last Z
  closedAt: string;
  closedByUserId: string;
  closedByUserName: string;

  // Financials
  baseCurrency: string;
  totalsByMethod: Record<string, number>; // CASH, CARD, etc.

  // Cash Details (Multi-currency)
  cashExpected: Record<string, number>;
  cashCounted: Record<string, number>;
  cashDiscrepancy: Record<string, number>;

  // Movements
  cashSales: number;
  cashIn: number;
  cashOut: number;

  // Metadata
  transactionCount: number;
  notes: string;

  // Analytics
  stats?: ZReportStats;
  syncStatus?: SyncStatus;
  syncError?: string;
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
  reference?: string;
  userId: string;
  userName: string;
  terminalId: string;
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
  assignedToId: string; // Employee/User assigned
  assignedToName: string;
  spaceId?: string; // Room ID if BOOKING
  spaceName?: string;

  // Integration
  linkedTransactionId?: string; // To Quote/Invoice
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
