
import { RoleDefinition, User, Customer, Product, BusinessConfig, SubVertical, DocumentSeries, Tariff, TaxDefinition, DeviceRole, AuthLevel, LabelTemplate, DeviceFormFactor, DeviceOrientation } from './types';

export const DEFAULT_DOCUMENT_SERIES: DocumentSeries[] = [
  { id: 'TICKET', documentType: 'TICKET', name: 'Ticket de Venta', description: 'Comprobante estándar para todas las ventas.', prefix: 'TCK', nextNumber: 1, padding: 6, icon: 'Receipt', color: 'blue' },
  { id: 'REFUND', documentType: 'REFUND', name: 'Devolución / Abono', description: 'Notas de crédito por devoluciones.', prefix: 'NC', nextNumber: 1, padding: 6, icon: 'RotateCcw', color: 'orange' },
  { id: 'TRANSFER', documentType: 'TRANSFER', name: 'Nota de Traspaso', description: 'Movimiento de inventario entre almacenes.', prefix: 'TR', nextNumber: 1, padding: 6, icon: 'ArrowRightLeft', color: 'purple' },
  { id: 'Z_REPORT', documentType: 'Z_REPORT', name: 'Cierre Z', description: 'Cierre final de caja.', prefix: 'Z', nextNumber: 1, padding: 6, icon: 'FileText', color: 'gray' },
  { id: 'X_REPORT', documentType: 'X_REPORT', name: 'Cierre X', description: 'Arqueo parcial sin limpiar ventas.', prefix: 'X', nextNumber: 1, padding: 6, icon: 'FileText', color: 'gray' },
];

export const DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS = {
  TICKET: 'TICKET',
  REFUND: 'REFUND',
  TRANSFER: 'TRANSFER',
  Z_REPORT: 'Z_REPORT',
  X_REPORT: 'X_REPORT'
} as const;

export const INITIAL_TAXES: TaxDefinition[] = [
  { id: 'tax-18', name: 'ITBIS 18%', rate: 0.18, type: 'VAT' },
  { id: 'tax-16', name: 'ITBIS 16%', rate: 0.16, type: 'VAT' },
  { id: 'tax-propina', name: 'Propina Legal 10%', rate: 0.10, type: 'SERVICE_CHARGE' },
  { id: 'tax-exempt', name: 'Exento 0%', rate: 0, type: 'EXEMPT' },
];

export const INITIAL_TARIFFS: Tariff[] = [
  {
    id: 'trf-gen',
    name: 'General (PVP)',
    active: true,
    currency: 'DOP',
    taxIncluded: true,
    strategy: { type: 'MANUAL', rounding: 'NONE' },
    scope: { storeIds: ['ALL'], priority: 0 },
    schedule: { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], timeStart: '00:00', timeEnd: '23:59' },
    items: {}
  },
  {
    id: 'trf-vip',
    name: 'VIP / Cliente Oro',
    active: true,
    currency: 'DOP',
    taxIncluded: true,
    strategy: { type: 'MANUAL', rounding: 'NONE' },
    scope: { storeIds: ['ALL'], priority: 5 },
    schedule: { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], timeStart: '00:00', timeEnd: '23:59' },
    items: {}
  }
];

export const DEFAULT_TERMINAL_CONFIG = {
  deviceBindingToken: 'dev_token_init',
  isPrimaryNode: true,
  deviceProfile: {
    formFactor: DeviceFormFactor.DESKTOP_POS,
    orientation: DeviceOrientation.AUTO,
    touchOptimized: false,
  },
  fiscal: {
    batchSize: 100,
    lowBatchThreshold: 20,
    typeConfigs: {
      'B01': { batchSize: 50, lowBatchThreshold: 10, lowBatchThresholdPct: 20 },
      'B02': { batchSize: 200, lowBatchThreshold: 20, lowBatchThresholdPct: 20 },
      'B04': { batchSize: 50, lowBatchThreshold: 10, lowBatchThresholdPct: 20 },
      'B14': { batchSize: 50, lowBatchThreshold: 10, lowBatchThresholdPct: 20 },
      'B15': { batchSize: 50, lowBatchThreshold: 10, lowBatchThresholdPct: 20 }
    }
  },
  security: {
    deviceBindingToken: 'dev_token_init',
    requirePinForVoid: true,
    requirePinForDiscount: true,
    requireManagerForRefunds: true,
    allowBiometrics: false,
    autoLogoutMinutes: 15,
    reduceSyncAfterMinutes: 0
  },
  pricing: {
    allowedTariffIds: ['trf-gen', 'trf-vip'],
    defaultTariffId: 'trf-gen'
  },
  workflow: {
    inventory: {
      realTimeValidation: true,
      allowNegativeStock: false,
      reserveStockOnCart: true,
      showStockOnTiles: true,
      showProductImagesInReceipt: false
    },
    session: {
      blindClose: true,
      allowSalesWithOpenZ: false,
      maxCashInDrawer: 20000,
      askGuestsOnTicketOpen: false,
      autoPrintZReport: true,
      autoPrintCashMovementReceipt: false,
      zReportEmails: '',
      checkOpenOrders: true,
      forceDenominationCount: false,
      cashVarianceThreshold: 0,
      emailZReport: false,
      forceZChange: false,
      businessStartHour: 0,
      allowPartialXReport: true,
      closeReportOptionsByUser: {},
    },
    offline: {
      mode: 'OPTIMISTIC' as const,
      maxOfflineTransactionLimit: 500
    }
  },
  financial: {
    roundingMethod: 'ROUND_HALF_UP' as const,
    taxInclusivePrices: true,
    printTaxBreakdown: true,
    returnChangeInBaseCurrency: true,
    acceptedCurrencies: ['USD', 'EUR'],
    serviceTaxPolicies: {}
  },
  documentSeries: DEFAULT_DOCUMENT_SERIES,
  documentAssignments: { ...DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS },
  hardware: {
    cashDrawerTrigger: 'PRINTER' as const,
    printerAssignments: {},
    customerDisplay: {
      isEnabled: true,
      welcomeMessage: '¡Bienvenidos a Alfa POS!',
      showItemImages: true,
      showQrPayment: true,
      layout: 'SPLIT' as const,
      connectionType: 'VIRTUAL' as const,
      ads: [
        { id: 'ad1', url: 'https://images.unsplash.com/photo-1550989460-0adf9ea622e2?q=80&w=800&auto=format&fit=crop', active: true },
        { id: 'ad2', url: 'https://images.unsplash.com/photo-1571781926291-2805903e13d4?q=80&w=800&auto=format&fit=crop', active: true },
        { id: 'ad3', url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=800&auto=format&fit=crop', active: true }
      ]
    },
    scales: []
  },
  operational: {
    vertical_negocio: 'RETAIL' as const,
    usa_mesas: false,
    pantalla_inicio: 'VENTA_DIRECTA' as const,
    bloqueo_meseros: false,
    pedir_comensales: true,
    usa_modulos_cocina: false,
    recibir_consignaciones: false,
    receiveConsignments: false,
    defaultTaxIds: [],
    reservationPolicy: {
      validityDays: 7,
      printCopies: 1,
      requireAdvance: false,
      minimumAdvancePercent: 20
    },
    deliveryAlerts: {
      isDeliveryTerminal: false,
      showUberEatsToast: true,
      autoOpenUberEatsModal: false
    }
  },
  ux: {
    theme: 'LIGHT' as const,
    gridDensity: 'COMFORTABLE' as const,
    showProductImages: true,
    quickKeysLayout: 'A' as const,
    viewMode: 'VISUAL' as const
  },
  catalog: {
    allowedCategories: []
  },
  deviceRole: {
    role: DeviceRole.STANDARD_POS,
    authLevel: AuthLevel.USER_REQUIRED,
    allowedModules: ['SALES', 'CUSTOMERS', 'INVENTORY', 'REPORTS'],
    uiSettings: {
      fullscreenForced: false,
      escapeHatch: {
        enabled: true,
        gesture: 'logo-press-5s',
        requirePin: true
      }
    }
  }
};

export const MOCK_USERS: User[] = [
  { id: 'u1', name: 'Admin Master', pin: '1234', role: 'ADMIN', roleId: 'ADMIN', syncSource: 'LOCAL_SEED' },
  { id: 'u2', name: 'Cajero Principal', pin: '0000', role: 'CASHIER', roleId: 'CASHIER', syncSource: 'LOCAL_SEED' },
  { id: 'u3', name: 'Supervisor Turno', pin: '9999', role: 'SUPERVISOR', roleId: 'SUPERVISOR', syncSource: 'LOCAL_SEED' }
];

export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    id: 'ADMIN',
    name: 'Administrador',
    permissions: ['ALL'],
    isSystem: true,
    maxDiscountPercent: 100
  },
  {
    id: 'SUPERVISOR',
    name: 'Supervisor',
    permissions: [
      'POS_VOID_ITEM', 'POS_DISCOUNT', 'POS_OPEN_DRAWER',
      'POS_RETURNS', 'POS_REPRINT_RECEIPT', 'POS_NEW_SALE', 'POS_CHECKOUT', 'POS_CHANGE_TARIFF', 'POS_VIEW_X_REPORT', 'POS_CLOSE_X', 'POS_ALLOW_SALES_WITH_OPEN_Z', 'POS_ACCESS_OTHER_SELLER_TABLES', 'TABLE_CONTROL_CENTER'
    ],
    isSystem: true,
    maxDiscountPercent: 20
  },
  {
    id: 'CASHIER',
    name: 'Cajero',
    permissions: ['POS_CHECKOUT', 'POS_REPRINT_RECEIPT', 'POS_ALLOW_SALES_WITH_OPEN_Z'],
    isSystem: true,
    maxDiscountPercent: 0
  }
];

export const MOCK_CUSTOMERS: Customer[] = [
  { id: 'c1', name: 'Juan Pérez', phone: '809-555-0123', email: 'juan.perez@email.com', tier: 'GOLD', loyaltyPoints: 1250, currentDebt: 0 },
  { id: 'c2', name: 'María García', phone: '829-555-0456', email: 'm.garcia@email.com', tier: 'SILVER', loyaltyPoints: 450, currentDebt: 150.00 },
  { id: 'c3', name: 'Cliente de Contado', phone: '', email: '', tier: 'BRONZE', loyaltyPoints: 0, currentDebt: 0 }
];

const generateProducts = () => {
  const categories = [
    { name: 'Verduras', type: 'SERVICE', unit: '/kg' },
    { name: 'Frutas', type: 'SERVICE', unit: '/kg' },
    { name: 'Carnicería', type: 'SERVICE', unit: '/lb' },
    { name: 'Lácteos', type: 'PRODUCT', unit: '' },
    { name: 'Bebidas', type: 'PRODUCT', unit: '' },
    { name: 'Alacena', type: 'PRODUCT', unit: '' },
    { name: 'Snacks', type: 'PRODUCT', unit: '' },
    { name: 'Panadería', type: 'PRODUCT', unit: '' },
    { name: 'Limpieza', type: 'PRODUCT', unit: '' },
    { name: 'Cuidado Personal', type: 'PRODUCT', unit: '' },
  ];

  const items = [
    { n: 'Zanahoria Fresca', c: 'Verduras', p: 25.00 }, { n: 'Cebolla Roja', c: 'Verduras', p: 45.00 },
    { n: 'Papa Granola', c: 'Verduras', p: 30.00 }, { n: 'Tomate Barceló', c: 'Verduras', p: 35.00 },
    { n: 'Pimiento Morrón', c: 'Verduras', p: 60.00 }, { n: 'Ajo Importado', c: 'Verduras', p: 120.00 },
    { n: 'Brócoli', c: 'Verduras', p: 55.00 }, { n: 'Lechuga Repollada', c: 'Verduras', p: 40.00 },
    { n: 'Pepino', c: 'Verduras', p: 20.00 }, { n: 'Cilantro Ancho', c: 'Verduras', p: 10.00 },
    { n: 'Manzana Roja', c: 'Frutas', p: 40.00 }, { n: 'Guineo Maduro', c: 'Frutas', p: 15.00 },
    { n: 'Uva Globo', c: 'Frutas', p: 180.00 }, { n: 'Fresa Paquete', c: 'Frutas', p: 150.00 },
    { n: 'Melón Cantaloupe', c: 'Frutas', p: 85.00 }, { n: 'Sandía', c: 'Frutas', p: 25.00 },
    { n: 'Piña Dulce', c: 'Frutas', p: 70.00 }, { n: 'Mango Mingolo', c: 'Frutas', p: 20.00 },
    { n: 'Limón Persa', c: 'Frutas', p: 12.00 }, { n: 'Chinola', c: 'Frutas', p: 15.00 },
    { n: 'Pollo Entero', c: 'Carnicería', p: 75.00 }, { n: 'Carne Molida Res', c: 'Carnicería', p: 145.00 },
    { n: 'Chuleta Ahumada', c: 'Carnicería', p: 160.00 }, { n: 'Bistec de Res', c: 'Carnicería', p: 220.00 },
    { n: 'Pechuga Pollo', c: 'Carnicería', p: 135.00 }, { n: 'Costilla Cerdo', c: 'Carnicería', p: 180.00 },
    { n: 'Salchicha Italiana', c: 'Carnicería', p: 210.00 }, { n: 'Filete Pescado', c: 'Carnicería', p: 195.00 },
    { n: 'Camarones', c: 'Carnicería', p: 450.00 }, { n: 'Longaniza', c: 'Carnicería', p: 110.00 },
    { n: 'Leche Entera 1L', c: 'Lácteos', p: 75.00 }, { n: 'Queso Gouda', c: 'Lácteos', p: 350.00 },
    { n: 'Yogurt Fresa', c: 'Lácteos', p: 45.00 }, { n: 'Mantequilla Barra', c: 'Lácteos', p: 95.00 },
    { n: 'Crema de Leche', c: 'Lácteos', p: 120.00 }, { n: 'Queso Mozzarella', c: 'Lácteos', p: 280.00 },
    { n: 'Leche Evaporada', c: 'Lácteos', p: 55.00 }, { n: 'Queso Cheddar', c: 'Lácteos', p: 220.00 },
    { n: 'Helado Vainilla', c: 'Lácteos', p: 350.00 }, { n: 'Leche Condensada', c: 'Lácteos', p: 85.00 },
    { n: 'Coca Cola 2L', c: 'Bebidas', p: 80.00 }, { n: 'Agua 500ml', c: 'Bebidas', p: 15.00 },
    { n: 'Jugo Naranja 1L', c: 'Bebidas', p: 110.00 }, { n: 'Cerveza Presidente', c: 'Bebidas', p: 150.00 },
    { n: 'Sprite 2L', c: 'Bebidas', p: 80.00 }, { n: 'Malta Morena', c: 'Bebidas', p: 45.00 },
    { n: 'Gatorade Azul', c: 'Bebidas', p: 65.00 }, { n: 'Vino Tinto Mesa', c: 'Bebidas', p: 450.00 },
    { n: 'Ron Dorado', c: 'Bebidas', p: 600.00 }, { n: 'Agua con Gas', c: 'Bebidas', p: 35.00 },
    { n: 'Arroz Premium 5lb', c: 'Alacena', p: 220.00 }, { n: 'Aceite Soja 1L', c: 'Alacena', p: 180.00 },
    { n: 'Pasta Espagueti', c: 'Alacena', p: 45.00 }, { n: 'Salsa Tomate', c: 'Alacena', p: 30.00 },
    { n: 'Habichuelas Lata', c: 'Alacena', p: 55.00 }, { n: 'Azúcar Crema 2lb', c: 'Alacena', p: 60.00 },
    { n: 'Sal Molida', c: 'Alacena', p: 15.00 }, { n: 'Harina Trigo', c: 'Alacena', p: 40.00 },
    { n: 'Atún en Agua', c: 'Alacena', p: 75.00 }, { n: 'Café Molido 1lb', c: 'Alacena', p: 280.00 },
    { n: 'Papas Lay\'s', c: 'Snacks', p: 60.00 }, { n: 'Galletas Chocolate', c: 'Snacks', p: 45.00 },
    { n: 'Chocolate Barra', c: 'Snacks', p: 35.00 }, { n: 'Maní Salado', c: 'Snacks', p: 25.00 },
    { n: 'Doritos Queso', c: 'Snacks', p: 65.00 }, { n: 'Gomitas Osito', c: 'Snacks', p: 30.00 },
    { n: 'Galletas Soda', c: 'Snacks', p: 20.00 }, { n: 'Barra Cereal', c: 'Snacks', p: 40.00 },
    { n: 'Palomitas Micro', c: 'Snacks', p: 50.00 }, { n: 'Chicle Menta', c: 'Snacks', p: 10.00 },
    { n: 'Pan Sobao', c: 'Panadería', p: 10.00 }, { n: 'Baguette', c: 'Panadería', p: 45.00 },
    { n: 'Pan Viga Blanco', c: 'Panadería', p: 110.00 }, { n: 'Donas Glaseadas', c: 'Panadería', p: 60.00 },
    { n: 'Croissant', c: 'Panadería', p: 75.00 }, { n: 'Pastelito Pollo', c: 'Panadería', p: 35.00 },
    { n: 'Bizcocho Libra', c: 'Panadería', p: 450.00 }, { n: 'Pan de Maíz', c: 'Panadería', p: 50.00 },
    { n: 'Galletas Avena', c: 'Panadería', p: 15.00 }, { n: 'Tostadas', c: 'Panadería', p: 85.00 },
    { n: 'Detergente Polvo', c: 'Limpieza', p: 120.00 }, { n: 'Cloro 1L', c: 'Limpieza', p: 45.00 },
    { n: 'Jabón Lavaplatos', c: 'Limpieza', p: 85.00 }, { n: 'Suavizante Ropa', c: 'Limpieza', p: 110.00 },
    { n: 'Desinfectante', c: 'Limpieza', p: 95.00 }, { n: 'Escoba Plástica', c: 'Limpieza', p: 150.00 },
    { n: 'Bolsas Basura', c: 'Limpieza', p: 70.00 }, { n: 'Esponja Fregar', c: 'Limpieza', p: 25.00 },
    { n: 'Limpiavidrios', c: 'Limpieza', p: 130.00 }, { n: 'Papel Toalla', c: 'Limpieza', p: 90.00 },
    { n: 'Shampoo 400ml', c: 'Cuidado Personal', p: 220.00 }, { n: 'Jabón Baño', c: 'Cuidado Personal', p: 45.00 },
    { n: 'Pasta Dental', c: 'Cuidado Personal', p: 115.00 }, { n: 'Desodorante', c: 'Cuidado Personal', p: 140.00 },
    { n: 'Papel Higiénico 4u', c: 'Cuidado Personal', p: 85.00 }, { n: 'Cepillo Dental', c: 'Cuidado Personal', p: 75.00 },
    { n: 'Acondicionador', c: 'Cuidado Personal', p: 220.00 }, { n: 'Crema Cuerpo', c: 'Cuidado Personal', p: 190.00 },
    { n: 'Alcohol Gel', c: 'Cuidado Personal', p: 60.00 }, { n: 'Toallas Húmedas', c: 'Cuidado Personal', p: 110.00 },
  ];

  return items.map((item, idx) => {
    const cat = categories.find(c => c.name === item.c);
    const type = (cat?.type as any) || 'PRODUCT';
    const isWeighable = type === 'SERVICE';

    return {
      id: `prod-${idx + 100}`,
      name: item.n,
      price: item.p,
      category: item.c,
      stock: Math.floor(Math.random() * 150),
      cost: item.p * 0.6,
      barcode: `74000${idx + 100}`,
      type: type,
      images: [],
      attributes: [],
      variants: [],
      tariffs: [{ tariffId: 'trf-gen', price: item.p }],
      appliedTaxIds: isWeighable ? ['tax-exempt'] : ['tax-18'],
      image: `https://placehold.co/200x200/e2e8f0/1e293b?text=${encodeURIComponent(item.n)}`
    } as Product;
  });
};

export const RETAIL_PRODUCTS: Product[] = [
  {
    id: 'p-pesado-1',
    name: 'Tomates Orgánicos (Peso)',
    price: 3.50,
    category: 'Verduras',
    stock: 150,
    cost: 1.20,
    barcode: 'SC001',
    type: 'SERVICE',
    images: ['https://images.unsplash.com/photo-1592924357228-91a4daadcfea?q=80&w=200&auto=format&fit=crop'],
    image: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?q=80&w=200&auto=format&fit=crop',
    attributes: [],
    variants: [],
    tariffs: [{ tariffId: 'trf-gen', price: 3.50 }],
    appliedTaxIds: ['tax-exempt']
  },
  {
    id: 'p-pesado-2',
    name: 'Pollo Entero (Peso)',
    price: 5.99,
    category: 'Carnicería',
    stock: 80,
    cost: 3.50,
    barcode: 'SC002',
    type: 'SERVICE',
    images: ['https://images.unsplash.com/photo-1587593810167-a84920ea0781?q=80&w=200&auto=format&fit=crop'],
    image: 'https://images.unsplash.com/photo-1587593810167-a84920ea0781?q=80&w=200&auto=format&fit=crop',
    attributes: [],
    variants: [],
    tariffs: [{ tariffId: 'trf-gen', price: 5.99 }],
    appliedTaxIds: ['tax-18']
  },
  {
    id: 'p-var-1',
    name: 'Zapatillas Runner 5.0',
    price: 85.00,
    category: 'Calzado',
    stock: 100,
    cost: 40.00,
    barcode: 'RUN-001',
    type: 'PRODUCT',
    images: ['https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=200&auto=format&fit=crop'],
    image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=200&auto=format&fit=crop',
    attributes: [
      { id: 'attr_size', name: 'Talla', options: ['38', '39', '40', '41', '42'], optionCodes: ['38', '39', '40', '41', '42'] },
      { id: 'attr_color', name: 'Color', options: ['Rojo', 'Azul', 'Negro'], optionCodes: ['RJ', 'AZ', 'NG'] }
    ],
    variants: [
      { sku: 'RUN-01-38-RJ', barcode: ['RUN0138RJ'], attributeValues: { 'Talla': '38', 'Color': 'Rojo' }, price: 85.00 },
      { sku: 'RUN-01-39-RJ', barcode: ['RUN0139RJ'], attributeValues: { 'Talla': '39', 'Color': 'Rojo' }, price: 85.00 },
      { sku: 'RUN-01-40-RJ', barcode: ['RUN0140RJ'], attributeValues: { 'Talla': '40', 'Color': 'Rojo' }, price: 85.00 },
      { sku: 'RUN-01-41-RJ', barcode: ['RUN0141RJ'], attributeValues: { 'Talla': '41', 'Color': 'Rojo' }, price: 85.00 },
      { sku: 'RUN-01-42-RJ', barcode: ['RUN0142RJ'], attributeValues: { 'Talla': '42', 'Color': 'Rojo' }, price: 85.00 },
      { sku: 'RUN-01-38-AZ', barcode: ['RUN0138AZ'], attributeValues: { 'Talla': '38', 'Color': 'Azul' }, price: 85.00 },
      { sku: 'RUN-01-39-AZ', barcode: ['RUN0139AZ'], attributeValues: { 'Talla': '39', 'Color': 'Azul' }, price: 85.00 },
      { sku: 'RUN-01-40-AZ', barcode: ['RUN0140AZ'], attributeValues: { 'Talla': '40', 'Color': 'Azul' }, price: 85.00 },
      { sku: 'RUN-01-41-AZ', barcode: ['RUN0141AZ'], attributeValues: { 'Talla': '41', 'Color': 'Azul' }, price: 85.00 },
      { sku: 'RUN-01-42-AZ', barcode: ['RUN0142AZ'], attributeValues: { 'Talla': '42', 'Color': 'Azul' }, price: 85.00 },
      { sku: 'RUN-01-38-NG', barcode: ['RUN0138NG'], attributeValues: { 'Talla': '38', 'Color': 'Negro' }, price: 85.00 },
      { sku: 'RUN-01-39-NG', barcode: ['RUN0139NG'], attributeValues: { 'Talla': '39', 'Color': 'Negro' }, price: 85.00 },
      { sku: 'RUN-01-40-NG', barcode: ['RUN0140NG'], attributeValues: { 'Talla': '40', 'Color': 'Negro' }, price: 85.00 },
      { sku: 'RUN-01-41-NG', barcode: ['RUN0141NG'], attributeValues: { 'Talla': '41', 'Color': 'Negro' }, price: 85.00 },
      { sku: 'RUN-01-42-NG', barcode: ['RUN0142NG'], attributeValues: { 'Talla': '42', 'Color': 'Negro' }, price: 85.00 }
    ],
    tariffs: [{ tariffId: 'trf-gen', price: 85.00 }],
    stockBalances: { 'wh_central': 10 },
    warehouseSettings: {
      'wh_central': { min: 20, max: 50 }
    },
    appliedTaxIds: ['tax-18']
  },
  { id: 'p1', name: 'Camiseta Algodón Premium', price: 25.00, category: 'Ropa', stock: 45, minStock: 10, cost: 12.00, barcode: '74210001', images: [], attributes: [], variants: [], tariffs: [{ tariffId: 'trf-gen', price: 25.00 }, { tariffId: 'trf-vip', price: 20.00 }], appliedTaxIds: ['tax-18'] },
  ...generateProducts()
];

export const FOOD_PRODUCTS: Product[] = [
  { id: 'f1', name: 'Hamburguesa Especial', price: 12.50, category: 'Comida', stock: 99, cost: 4.50, images: [], attributes: [], variants: [], tariffs: [{ tariffId: 'trf-gen', price: 12.50 }, { tariffId: 'trf-vip', price: 10.00 }], appliedTaxIds: ['tax-18', 'tax-propina'] },
  { id: 'f2', name: 'Pizza Pepperoni Mediana', price: 15.00, category: 'Comida', stock: 99, cost: 6.00, images: [], attributes: [], variants: [], tariffs: [{ tariffId: 'trf-gen', price: 15.00 }], appliedTaxIds: ['tax-18', 'tax-propina'] },
];

export const AVAILABLE_PERMISSIONS = [
  // --- POS CORE ---
  { key: 'SALE', label: 'Realizar Ventas', description: 'Acceso a pantalla de cobro', category: 'SALES' },
  { key: 'POS_CHECKOUT', label: 'Cobrar', description: 'Permite abrir la pantalla de pago y finalizar ventas', category: 'SALES' },
  { key: 'POS_ALLOW_SALES_WITH_OPEN_Z', label: 'Permitir ventas con cierre Z abierto', description: 'Permite agregar y cobrar ventas durante la jornada/corte Z abierto', category: 'SALES' },
  { key: 'POS_PAY_CREDIT', label: 'Cobrar a Crédito (Pendiente)', description: 'Permite finalizar ventas con el método de pago a crédito', category: 'SALES' },
  { key: 'POS_DISCOUNT', label: 'Aplicar Descuentos', description: 'Descuentos manuales en ítems o total', category: 'SALES' },
  { key: 'POS_PRICE_OVERRIDE', label: 'Modificar Precios', description: 'Cambiar precio unitario de productos', category: 'SALES' },
  { key: 'POS_ALLOW_ZERO_PRICE', label: 'Permitir Precio Cero', description: 'Permitir vender artículos con precio en 0', category: 'SALES' },
  { key: 'POS_CREDIT_OVERRIDE', label: 'Vender sobre límite de crédito', description: 'Vender a clientes excediendo su límite de crédito', category: 'SALES' },
  { key: 'POS_VOID_ITEM', label: 'Anular Ítem', description: 'Eliminar productos del carrito', category: 'SALES' },
  { key: 'POS_VOID_TICKET', label: 'Anular Ticket (En Curso)', description: 'Cancelar venta antes de pago', category: 'SALES' },
  { key: 'POS_EDIT_SUBTOTALIZED_TICKET', label: 'Modificar Ticket Subtotalizado', description: 'Agregar, borrar o modificar artículos, cantidades y descuentos después de imprimir el subtotal', category: 'SALES' },
  { key: 'POS_VOID_SUBTOTALIZED_TICKET', label: 'Eliminar Ticket Subtotalizado', description: 'Eliminar por completo una cuenta después de imprimir el subtotal', category: 'SALES' },
  { key: 'POS_VOID_PAID_TICKET', label: 'Anular Factura Pagada', description: 'Revertir una venta finalizada', category: 'SALES' },
  { key: 'POS_RETURNS', label: 'Autorizar Devoluciones y Notas de Crédito', description: 'Permite activar el modo de devolución en el POS y procesar notas de crédito', category: 'SALES' },
  { key: 'POS_MANAGE_PARKED', label: 'Gestionar Cuentas', description: 'Ver y recuperar cuentas de otros', category: 'SALES' },
  { key: 'POS_ACCESS_OTHER_SELLER_TABLES', label: 'Acceder a mesas de otros vendedores', description: 'Permite abrir mesas ocupadas por otro vendedor sin habilitarlo para todo el terminal', category: 'SALES' },
  { key: 'POS_NEW_SALE', label: 'Nueva Venta sin Imprimir', description: 'Permite cerrar la pantalla de venta exitosa sin forzar ticket o email', category: 'SALES' },
  { key: 'POS_CHANGE_TARIFF', label: 'Cambiar Tarifa de Venta', description: 'Permite seleccionar la tarifa activa desde la pantalla de ventas', category: 'SALES' },
  { key: 'POS_RESEND_INVOICE_EMAIL', label: 'Reenviar Factura por Email', description: 'Enviar nuevamente una factura histórica por correo', category: 'SALES' },
  { key: 'POS_ADJUST_INVOICE_TIP', label: 'Ajustar Propina Voluntaria', description: 'Corregir únicamente la propina voluntaria de una factura', category: 'SALES' },
  { key: 'POS_CHANGE_INVOICE_CUSTOMER', label: 'Corregir Cliente e-CF', description: 'Cambiar el cliente de un e-CF pendiente o con error', category: 'SALES' },
  { key: 'POS_FLAG_INVOICE_REVIEW', label: 'Marcar Factura para Revisión', description: 'Reportar una factura para revisión administrativa o contable', category: 'SALES' },
  { key: 'POS_VIEW_INVOICE_AUDIT', label: 'Ver Historial de Factura', description: 'Consultar eventos y correcciones de una factura', category: 'SALES' },
  { key: 'POS_COMPLIMENTARY_SALE', label: 'Registrar Invitaciones', description: 'Crear documentos de cortesía sin emisión fiscal', category: 'SALES' },
  { key: 'POS_OVERRIDE_INVOICE_LIMIT', label: 'Autorizar Límite de Factura', description: 'Autorizar ventas que superen el límite configurado', category: 'SALES' },
  { key: 'TABLE_CONTROL_CENTER', label: 'Ver Control de Salas', description: 'Muestra el centro en tiempo real del mapa de mesas', category: 'SALES' },

  // --- CASH & FINANCE ---
  { key: 'POS_OPEN_DRAWER', label: 'Abrir Cajón', description: 'Sin venta', category: 'CASH' },
  { key: 'POS_CLOSE_X', label: 'Hacer Cierre X', description: 'Generar arqueo parcial sin limpiar ventas ni movimientos', category: 'CASH' },
  { key: 'POS_CLOSE_Z', label: 'Cierre Z (Corte)', description: 'Realizar cierre de caja', category: 'CASH' },
  { key: 'POS_REPEAT_Z_REPORT', label: 'Repetir Cierre Z', description: 'Permite repetir/imprimir un cierre Z desde el historial', category: 'CASH' },
  { key: 'POS_VIEW_X_REPORT', label: 'Ver Reporte X', description: 'Consultar ventas en Monitor (Reporte X)', category: 'CASH' },
  { key: 'POS_VIEW_ACTIVE_CASH', label: 'Ver Efectivo Actual', description: 'Auditoría de caja en tiempo real', category: 'CASH' },
  { key: 'CASH_IN_OUT', label: 'Entrada/Salida Efectivo', description: 'Registrar entradas y salidas de caja', category: 'CASH' },
  { key: 'EXPENSE_MANAGE', label: 'Gastos de Caja', description: 'Registrar salidas de efectivo', category: 'CASH' },
  { key: 'REPORTS_VIEW_SALES', label: 'Ver Ventas', description: 'Reportes básicos de venta', category: 'FINANCE' },
  { key: 'REPORTS_VIEW_FINANCIAL', label: 'Reportes Financieros', description: 'Ver costos, márgenes e impuestos', category: 'FINANCE' },

  // --- CATALOG ---
  { key: 'CATALOG_VIEW', label: 'Ver Catálogo', description: 'Acceso a lista de productos', category: 'CATALOG' },
  { key: 'CATALOG_MANAGE', label: 'Gestionar Productos', description: 'Crear, editar y eliminar productos', category: 'CATALOG' },
  { key: 'CATALOG_VIEW_COST', label: 'Ver Costos', description: 'Ver CPP y márgenes de ganancia', category: 'CATALOG' },
  { key: 'TARIFF_MANAGE', label: 'Gestionar Tarifas', description: 'Editar listas de precios', category: 'CATALOG' },

  // --- INVENTORY ---
  { key: 'INVENTORY_VIEW', label: 'Ver Existencias', description: 'Consultar stock actual', category: 'INVENTORY' },
  { key: 'INVENTORY_ADJUST', label: 'Ajustes de Stock', description: 'Entrada/Salida manual', category: 'INVENTORY' },
  { key: 'INVENTORY_TRANSFER', label: 'Traspasos', description: 'Mover mercancía entre almacenes', category: 'INVENTORY' },
  { key: 'SUPPLY_CHAIN_ORDER', label: 'Compras', description: 'Crear órdenes a proveedores', category: 'INVENTORY' },
  { key: 'SUPPLY_CHAIN_RECEIVE', label: 'Recepción', description: 'Recibir mercancía de compras', category: 'INVENTORY' },

  // --- CUSTOMERS ---
  { key: 'CUSTOMER_VIEW', label: 'Ver Clientes', description: 'Acceso a directorio', category: 'CUSTOMERS' },
  { key: 'CUSTOMER_MANAGE', label: 'Gestionar Clientes', description: 'Crear y editar clientes', category: 'CUSTOMERS' },
  { key: 'CUSTOMER_CREDIT_LIMIT', label: 'Límite de Crédito', description: 'Modificar cupo de crédito', category: 'CUSTOMERS' },
  { key: 'CUSTOMER_VIEW_DEBT', label: 'Ver Deudas', description: 'Acceso a estados de cuenta', category: 'CUSTOMERS' },
  { key: 'CUSTOMER_ALERT_VIEW', label: 'Ver Alertas de Clientes', description: 'Consultar alertas internas restringidas', category: 'CUSTOMERS' },
  { key: 'CUSTOMER_ALERT_MANAGE', label: 'Gestionar Alertas de Clientes', description: 'Crear, editar y desactivar alertas internas', category: 'CUSTOMERS' },

  // --- ADMIN ---
  { key: 'SETTINGS_ACCESS', label: 'Acceso Configuración', description: 'Entrar al panel de ajustes', category: 'ADMIN' },
  { key: 'SETTINGS_HARDWARE', label: 'Config. Hardware', description: 'Impresoras y periféricos', category: 'ADMIN' },
  { key: 'SETTINGS_USERS', label: 'Gestión Usuarios', description: 'Crear usuarios y roles', category: 'ADMIN' },
  { key: 'SETTINGS_TAXES', label: 'Config. Fiscal', description: 'Impuestos y NCF', category: 'ADMIN' },
  { key: 'AUDIT_LOG_VIEW', label: 'Ver Auditoría', description: 'Registro de actividades', category: 'ADMIN' }
];

const createArticleTemplate = (id: string, name: string, widthMm: number, heightMm: number): LabelTemplate => ({
  id,
  name,
  category: 'ARTICLE',
  widthMm,
  heightMm,
  elements: [
    {
      id: `${id}-name`,
      type: 'TEXT',
      x: 2,
      y: 1,
      width: Math.max(8, widthMm - 4),
      height: Math.max(4, Math.round(heightMm * 0.28)),
      content: 'Nombre Producto',
      dataSource: 'PRODUCT_NAME',
      fontSize: Math.max(6, Math.round(heightMm * 0.22)),
      isBold: true
    },
    {
      id: `${id}-barcode`,
      type: 'BARCODE',
      x: 2,
      y: Math.max(4, Math.round(heightMm * 0.42)),
      width: Math.max(10, widthMm - 12),
      height: Math.max(4, Math.round(heightMm * 0.35)),
      content: '123456',
      dataSource: 'PRODUCT_SKU'
    },
    {
      id: `${id}-price`,
      type: 'TEXT',
      x: Math.max(2, widthMm - 18),
      y: Math.max(1, heightMm - 6),
      width: Math.min(16, widthMm - 4),
      height: 5,
      content: '$99.00',
      dataSource: 'PRODUCT_PRICE',
      fontSize: Math.max(8, Math.round(heightMm * 0.24)),
      isBold: true
    }
  ]
});

export const DEFAULT_LABEL_TEMPLATES: LabelTemplate[] = [
  createArticleTemplate('lbl-article-xs', 'Articulo XS (30x15 mm)', 30, 15),
  createArticleTemplate('lbl-article-s', 'Articulo S (40x20 mm)', 40, 20),
  createArticleTemplate('lbl-article-m', 'Articulo M (50x25 mm)', 50, 25),
  createArticleTemplate('lbl-article-l', 'Articulo L (60x30 mm)', 60, 30),
  createArticleTemplate('lbl-article-xl', 'Articulo XL (80x40 mm)', 80, 40),
  {
    id: 'lbl-gondola',
    name: 'Gondola (100x35 mm)',
    category: 'GONDOLA',
    widthMm: 100,
    heightMm: 35,
    elements: [
      {
        id: 'lbl-gondola-name',
        type: 'TEXT',
        x: 3,
        y: 2,
        width: 70,
        height: 8,
        content: 'Nombre Producto',
        dataSource: 'PRODUCT_NAME',
        fontSize: 12,
        isBold: true
      },
      {
        id: 'lbl-gondola-price',
        type: 'TEXT',
        x: 74,
        y: 3,
        width: 23,
        height: 9,
        content: '$99.00',
        dataSource: 'PRODUCT_PRICE',
        fontSize: 16,
        isBold: true
      },
      {
        id: 'lbl-gondola-barcode',
        type: 'BARCODE',
        x: 3,
        y: 15,
        width: 62,
        height: 14,
        content: '123456',
        dataSource: 'PRODUCT_SKU'
      },
      {
        id: 'lbl-gondola-sku',
        type: 'TEXT',
        x: 68,
        y: 19,
        width: 29,
        height: 6,
        content: 'SKU',
        dataSource: 'PRODUCT_SKU',
        fontSize: 10,
        isBold: false
      }
    ]
  }
];

export const DEFAULT_LABEL_TEMPLATE_IDS = DEFAULT_LABEL_TEMPLATES.map(template => template.id);

export const getInitialConfig = (subVertical: SubVertical): BusinessConfig => {
  const isFood = ([SubVertical.RESTAURANT, SubVertical.FAST_FOOD, SubVertical.BAR] as string[]).includes(subVertical);

  return {
    vertical: isFood ? 'RESTAURANT' : 'RETAIL',
    subVertical,
    currencySymbol: '$',
    taxRate: 0.18,
    taxes: INITIAL_TAXES,
    serviceTaxPolicies: {
      DINE_IN: { legalTip: { enabled: isFood, percentage: isFood ? 10 : 0 } },
      TAKEOUT: { legalTip: { enabled: false, percentage: 0 } },
      DELIVERY: { legalTip: { enabled: false, percentage: 0 } },
    },
    themeColor: 'blue',
    features: { stockTracking: true },
    ux: DEFAULT_TERMINAL_CONFIG.ux,
    companyInfo: { name: 'ALFA POS DEMO', rnc: '131-12345-1', phone: '809-555-POS1', address: 'Av. Principal #1, Santo Domingo' },
    currencies: [{ code: 'DOP', name: 'Peso Dominicano', symbol: 'RD$', rate: 1, isEnabled: true, isBase: true }],
    integrations: [],
    paymentMethods: [
      { id: 'cash', name: 'Efectivo', type: 'CASH', isEnabled: true, icon: 'Banknote', color: 'bg-green-500', opensDrawer: true, requiresSignature: false, integration: 'NONE', integrationMode: 'MANUAL' },
      { id: 'card', name: 'Tarjeta', type: 'CARD', isEnabled: true, icon: 'CreditCard', color: 'bg-blue-500', opensDrawer: false, requiresSignature: false, integration: 'NONE', integrationMode: 'MANUAL' }
    ],
    tariffs: INITIAL_TARIFFS,
    labelTemplates: DEFAULT_LABEL_TEMPLATES.map(template => ({
      ...template,
      elements: template.elements.map(element => ({ ...element }))
    })),
    terminals: [
      { id: 't1', config: { ...DEFAULT_TERMINAL_CONFIG, isPrimaryNode: true } },
      { id: 't2', config: { ...DEFAULT_TERMINAL_CONFIG, isPrimaryNode: false, currentDeviceId: undefined } },
      { id: 't3', config: { ...DEFAULT_TERMINAL_CONFIG, isPrimaryNode: false, currentDeviceId: undefined } },
      { id: 't4', config: { ...DEFAULT_TERMINAL_CONFIG, isPrimaryNode: false, currentDeviceId: undefined } }
    ],
    availablePrinters: [],
    scales: [],
    loyalty: {
      isEnabled: true,
      earnRate: 0.1,
      redeemRate: 1.0,
      minRedemptionPoints: 10,
      expirationMonths: 12,
      excludedCategories: [],
      tiers: [
        { id: 'bronze', name: 'BRONZE', minPoints: 0, color: 'text-orange-600', icon: 'Award' },
        { id: 'silver', name: 'SILVER', minPoints: 500, color: 'text-gray-400', icon: 'Award' },
        { id: 'gold', name: 'GOLD', minPoints: 1500, color: 'text-yellow-500', icon: 'Award' },
        { id: 'platinum', name: 'PLATINUM', minPoints: 3000, color: 'text-purple-600', icon: 'Award' }
      ]
    }
  };
};
