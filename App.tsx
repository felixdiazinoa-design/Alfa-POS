import RecoveryCloseDialog from './components/RecoveryCloseDialog';
import AutomaticRecoveryDialog from './components/AutomaticRecoveryDialog';
import type { RecoveryCloseInput } from './services/recovery/RecoveryCloseController';
import { originalProvenance } from './services/recovery/RecoveryRuntime';
import { isRecoveredOperation } from './services/recovery/PendingOperationsRecovery';
import { recordCheckoutDiagnostic } from './services/CheckoutDiagnostics';
import { allowsDefaultPaymentMethods } from './utils/erpPaymentMethods';
import { createStartupTrace } from './utils/startupTrace';
import {
  beginPosInteraction,
  expectInteractionRender,
  getLatestPosInteraction,
  markInteractionStage,
  markInteractionStateUpdate,
  markRenderEnd,
  markRenderStart,
  measureInteractionStage,
} from './utils/interactionPerformance';

import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { v4 as uuidv4 } from 'uuid';
import { Layout, LockKeyhole, Monitor, RefreshCw } from 'lucide-react';
import {
  User,
  RoleDefinition,
  BusinessConfig,
  Transaction,
  Customer,
  Product,
  CashMovement,
  PurchaseOrder,
  Supplier,
  PurchaseOrderItem,
  CartItem,
  ViewState,
  Tariff,
  Warehouse,
  ParkedTicket,
  StockTransfer,
  ZReport,
  XReport,
  DeviceRole,
  Reception,
  ProductStock,
  InventoryCountSession,
  LedgerConcept,
  DocumentSeries,
  Room,
  Table,
  Collection,
  PaymentEntry,
  RedeemedCouponRef,
  RefundProcessingOptions,
  PaymentMethodDefinition,
  FiscalDocumentCorrectionInput,
  TerminalConfig
} from './types';
import {
  DEFAULT_ROLES,
  DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS,
  DEFAULT_LABEL_TEMPLATES,
  FOOD_PRODUCTS,
  MOCK_USERS,
  RETAIL_PRODUCTS,
  getInitialConfig
} from './constants';
import { parseScaleBarcode } from './utils/barcodeParser';
import { useKioskMode } from './hooks/useKioskMode';
import { useBarcodeScanner } from './hooks/useBarcodeScanner';
import { db } from './utils/db'; // Import Local DB
import { dbAdapter } from './services/db'; // Import Adapter for Healthcheck
import { syncManager } from './services/sync/SyncManager';
import { apiSyncAdapter } from './services/sync/ApiSyncAdapter';
import { requestJson } from './services/network/httpClient';
import { sendZReportEmailViaErp } from './services/email/zReportEmailService';
import { backgroundSyncManager } from './services/sync/BackgroundSyncManager';
import { realtimeNotificationService } from './services/sync/RealtimeNotificationService';
import { createAdaptivePollingScheduler } from './services/sync/AdaptivePollingScheduler';
import { authenticatedActivityTracker } from './services/sync/AuthenticatedActivityTracker';
import { isSyncFeatureEnabled } from './services/sync/SyncFeatureFlags';
import { syncMetrics } from './services/sync/SyncMetrics';
import { durableOutboxRepository } from './services/sync/DurableOutboxRepository';
import { buildPaymentPostedPayload, buildSalePostedPayload } from './services/sync/SalePostedContract';
import { paymentIntentService } from './services/payments/PaymentIntentService';
import { syncTriggerCoordinator, type SyncTriggerReason } from './services/sync/SyncTriggerCoordinator';
import { queueCustomerMutation } from './services/sync/CustomerSyncQueue';
import { selectCustomersCreatedByClients } from './services/sync/masterCustomerReconciliation';
import { withCustomerNumberSnapshot } from './services/sync/customerIdentityContract';
import { createNumberedMaster } from './services/sync/MasterNumberRangeService';
import {
  queuePosUserRosterChanges,
  queueUnsyncedLocalPosUsers,
} from './services/sync/PosUserSyncQueue';
import { currencyScheduleExecutor } from './services/currency/CurrencyService';
import { productImageCacheService } from './services/sync/ProductImageCacheService';
import { posCloudStagingService } from './services/sync/PosCloudStagingService';
import { buildNativeZReportContent } from './services/recovery/NativeZReport';
import { calculateZReportStats } from './utils/analytics';
import { buildServiceTypeReport } from './utils/orderServiceType';
import { ALL_CLOSE_REPORT_SECTIONS, buildCloseReportDetails, resolveCloseReportSections } from './utils/closeReportOptions';
import { buildCloseTaxSummary } from './utils/closeReceiptSummary';
import { buildZReportPaymentMethodSummary } from './utils/zReportPaymentSummary';
import { applyPromotions, hasProductPromotion } from './utils/promotionEngine';
import { calculateTransactionTaxSummary } from './utils/taxSummary';
import { mapCustomersFromErp } from './utils/egoClub';
import { flushLoyaltyOutbox } from './services/loyalty/LoyaltyService';
import { calculateTransactionFiscalSummary } from './utils/fiscalBreakdown';
import { extractTerminalOperationalDocumentState } from './utils/terminalConfigSnapshot';
import { mergeDocumentSeriesCollection, resolveDocumentAssignmentId } from './utils/documentSeriesIdentity';
import { requireErpZSequenceAuthority, resolveZSequenceContinuity } from './services/zreports/ZReportSequenceContinuity';
import { ThermalPrinterService } from './services/printer/ThermalPrinterService';
import { resolveDeviceRoleValue } from './utils/deviceRoleHelpers';
import { isPosSaleActive, POS_SALE_ACTIVITY_EVENT } from './utils/posSaleActivity';
import { canEnterReducedSyncMode, resolveReducedSyncAfterMinutes } from './utils/syncInactivityPolicy';
import { validateRefundItems } from './utils/refundAvailability';
import { validateErpRefundItems } from './services/refunds/erpRefundSource';
import { buildPosMasterCatalogSnapshot } from './utils/posMasterCatalogContract';
import { applyProductionAreaAssignments } from './utils/productionRoutingAssignment';
import {
  isEligibleOperationalMasterConfig,
  isEligibleOperationalMasterTerminal,
} from './utils/masterServerEligibility';
import {
  canUseLocalOperationalTableStore,
  isClientTerminalMode,
  resolveOperationalApiUrl
} from './utils/masterOperationalApi';
import {
  hasDesignedFloorPlan,
  selectAuthoritativeFloorPlan,
} from './utils/tableLayout';
import { NativeLaunchContext, shouldRestoreNativeSession } from './utils/nativeSessionResume';
import { markRestaurantLinesCommitted } from './utils/restaurantHotReversal';

// Component Imports
import ModernLoginScreen from './components/ModernLoginScreen';
import LoginScreen from './components/LoginScreen';
import ErrorBoundary from './components/ErrorBoundary';
import POSInterface from './components/POSInterface';
import VerticalSelector from './components/VerticalSelector';
import SetupWizard from './components/SetupWizard';
import ActivationScreen from './components/ActivationScreen';
import TerminalModeSelector from './components/TerminalModeSelector';
import TerminalBindingScreen from './components/TerminalBindingScreen';
import SyncErrorDiagnosticModal from './components/SyncErrorDiagnosticModal';
import CustomerVisor from './components/CustomerVisor';
import PosApkUpdateBanner from './components/PosApkUpdateBanner';
import GlobalVirtualKeyboard from './components/GlobalVirtualKeyboard';
import { visorSync } from './utils/visorSync';
import {
  isCustomerDisplaySurface,
  isCustomerDisplayView,
  recoverNativePrimaryDisplayUrl,
} from './utils/customerDisplay';
import { markPosInteractionActivity, setPosSaleActivity } from './utils/posSaleActivity';
import { ORDER_TAKER_TERMINAL_TYPE, STANDARD_POS_TERMINAL_TYPE } from './utils/orderTakerPolicy';
import {
  hasErpSnapshotPosUsers,
  posUserRostersMatch,
  reconcilePosUsers,
  selectPosUsersForRuntime,
} from './utils/posUserReconciliation';

// Layout imports
import StandardPOSLayout from './components/layouts/StandardPOSLayout';
import SelfCheckoutLayout from './components/layouts/SelfCheckoutLayout';
import PriceCheckerLayout from './components/layouts/PriceCheckerLayout';
import HandheldLayout from './components/layouts/HandheldLayout';
import KitchenDisplayLayout from './components/layouts/KitchenDisplayLayout';
import TableMap from './components/TableMap';
import TableLayoutDesigner from './components/TableLayoutDesigner';

// View imports for device roles
import KioskWelcome from './components/kiosk/KioskWelcome';
import KioskProductBrowser from './components/kiosk/KioskProductBrowser';
import KioskPayment, { KioskResolvedPaymentMethod } from './components/kiosk/KioskPayment';
import { KioskSecurityProvider, useKioskSecurityContext } from './components/kiosk/KioskContext';
import PriceCheckerDisplay from './components/price-checker/PriceCheckerDisplay';
import InventoryHome from './components/inventory/InventoryHome';
import InventoryCount from './components/inventory/InventoryCount';
import MobileReception from './components/inventory/MobileReception';
import InventoryLabelsMobile from './components/inventory/InventoryLabelsMobile';
import InventoryTracking from './components/InventoryTracking';
import KitchenDisplay from './components/kds/KitchenDisplay';
import InventoryAuditClosure from './components/inventory/InventoryAuditClosure';

const Settings = React.lazy(() => import('./components/Settings'));
const TeamHub = React.lazy(() => import('./components/TeamHub'));
const CustomerManagement = React.lazy(() => import('./components/CustomerManagement'));
const TicketHistory = React.lazy(() => import('./components/TicketHistory'));
const FinanceDashboard = React.lazy(() => import('./components/FinanceDashboard'));
const ZReportDashboard = React.lazy(() => import('./components/ZReportDashboard'));
const SupplyChainManager = React.lazy(() => import('./components/SupplyChainManager'));
const FranchiseDashboard = React.lazy(() => import('./components/FranchiseDashboard'));

const RouteLoadingFallback: React.FC = () => (
  <div className="h-full min-h-[240px] w-full flex items-center justify-center bg-slate-50 text-slate-700">
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="h-5 w-5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
      <span className="text-sm font-black uppercase tracking-[0.18em]">Cargando módulo...</span>
    </div>
  </div>
);

type TerminalAuthorizationCheckState = 'idle' | 'checking' | 'authorized';


import { seriesSyncService } from './services/sync/SeriesSyncService';
import { permissionService } from './services/sync/PermissionService';
import { terminalRouter } from './services/routing/TerminalRouter';
import { authLevelService } from './services/auth/AuthLevelService';
import { transactionService } from './services/transactionService';
import './styles/high-contrast.css';
import { ThemeProvider } from './components/ThemeContext';
import { transactionSyncService } from './services/sync/TransactionSyncService';
import {
  collectClosedTransactionIds,
  partitionTransactionsByClosedMembership,
  persistInboundTransactionsIfOpen,
  isTransactionReservedForClose,
  releaseClosingTransactionIds,
  reserveClosingTransactionIds,
  reconcileTransactionsForZPreview,
} from './services/sync/ClosedTransactionMembership';
import { inventorySyncService } from './services/sync/InventorySyncService';
import { processInventoryDeduction } from './utils/inventoryEngine';
import { useOfflineInventoryCountSync } from './hooks/useOfflineInventoryCountSync';
import { printLabelsFromTemplate } from './utils/labelPrinter';
import { printIntegratedPaymentArtifacts, printPrecuenta, printTicket } from './utils/printer';
import { offlinePrintQueueService } from './services/printer/OfflinePrintQueueService';
import { nativePrintBridge } from './services/printer/NativePrintBridge';
import { persistStandaloneRefundTransaction } from './services/localRefundPersistence';
import { checkLicenseStatus, clearTenantIdentity, resolveTenantId } from './utils/licenseGuard';
import {
  buildMasterUrlCandidates,
  buildMasterUrlFromHost,
  getStoredTenantIdentity,
  publishMasterEndpointToCloud,
  resolveMasterEndpointFromCloud
} from './utils/cloudMasterRegistry';
import { discoverLanMasterCandidates } from './utils/masterLanDiscovery';
import {
  clearStoredErpSyncBinding,
  bootstrapErpSyncLifecycle,
  ensureErpSyncLifecycle,
  ERP_FULL_BOOTSTRAP_REQUIRED_EVENT,
  getLifecycleActivationBlockMessage,
  getLifecycleBlockingMessageFromError,
  getStoredErpSyncBinding,
  heartbeatErpSyncTerminal,
  isLifecycleActivationBlocked,
  persistStoredErpSyncBinding,
  registerErpSyncTerminal,
  triggerErpSyncOutbox
} from './utils/erpSyncLifecycle';
import { createErpHeartbeatScheduler } from './utils/erpHeartbeatScheduler';
import {
  SYNC_DIAGNOSTIC_EVENT,
  SYNC_DIAGNOSTIC_STORAGE_KEY,
  clearStaleSyncErrorDiagnosticIfRecovered,
  clearSyncErrorDiagnostic,
  CATALOG_SYNC_STATUS_KEY,
  isRecoverableNetworkConnectivityMessage,
  isRecoverableStaleSyncDiagnostic,
  isTerminalAuthorizationLossDiagnostic,
  reportSyncErrorDiagnostic,
  setCatalogDiagnosticStatus,
  setSalesPushDiagnosticStatus,
  setSyncAuthDiagnosticStatus,
  setTerminalBindingDiagnosticStatus,
  TERMINAL_BINDING_STATUS_KEY,
  type SyncErrorDiagnostic
} from './services/sync/SyncErrorDiagnostic';
import {
  DEVICE_REVOKED_EVENT,
  DEVICE_SUPERSEDED_MESSAGE,
  markDeviceReauthorized,
  persistLocalDeviceId,
  resetDeviceIdentityBySupport,
  resolveLocalDeviceId,
  resolveOrCreatePersistentDeviceId,
  restorePersistentDeviceIdAfterDbReset,
  type DeviceRevocationDetail
} from './utils/deviceRevocation';
import { terminalConfigRequestCoordinator } from './services/sync/TerminalConfigRequestCoordinator';
import { clearPersistedSupabaseSession, supabase } from './utils/supabase';
import type { RuntimeTerminalRecoveryState } from './services/setup/erpTerminalSetup';
import { resolveCustomerImageSrc } from './utils/entityImage';
import { posCatalogDebugElapsedMs, posCatalogDebugLog, posCatalogDebugLogDbRows, posCatalogDebugMatchesRaw, posCatalogDebugNow, posCatalogDebugSummarizeItem } from './utils/posCatalogDebugTrace';
import { buildTerminalConfigRefreshRequest, type TerminalConfigSyncRequestDetail } from './utils/terminalConfigPushScopes';
import { resolvePosSalesStartView } from './utils/posStartupView';
import {
  checkForPosApkUpdate,
  openPosApkDownloadUrl,
  type PosApkUpdateAvailable
} from './services/version/posApkUpdateService';
import {
  loadSyncProfile,
  isPosOnlyCloudStagingTarget,
  resolveSyncTarget,
  saveSyncProfileFromContract,
  type SyncPermissions,
  type SyncProfile,
  type SyncProfilePersistenceDiagnostic,
  type SyncProfileSource
} from './services/sync/SyncProfile';
import { markSyncDeviceTokenInvalid, persistSyncDeviceToken } from './services/sync/deviceToken';
import {
  extractErpRegisterAuth,
  resolveIncomingSyncProfileFromRegister,
  resolveNormalizedRegisterDeviceToken,
  resolveRegisterErpTerminalId,
  resolveRegisterTerminalCode,
} from './services/sync/erpRegisterResponse';
import { clearStoredSyncToken, readTerminalCredentials, saveTerminalCredentialsSync } from './services/sync/TerminalCredentialStore';
import {
  clearPersistedTerminalAuthorizationBlock,
  isDeviceExplicitlyAuthorizedByBootstrap,
  persistTerminalAuthorizationBlock,
  readPersistedTerminalAuthorizationBlock,
  type TerminalAuthorizationBlock,
} from './utils/terminalAuthorizationGuard';
import {
  normalizeCanonicalErpTerminalId,
  requireCanonicalErpTerminalId,
} from './services/sync/terminalIdentity';
import { normalizeErpBaseUrl, resolveErpBaseUrl } from './utils/erpBaseUrl';
import {
  canRetryFiscalTransaction,
  getEffectiveFiscalComplianceConfig,
  getFiscalDisplayCode,
  getFiscalProviderConfig,
  getProviderEnvironment,
  getDefaultFiscalProvider,
  resolveFiscalProviderEstablishmentCode,
  resolveFiscalProviderCashierCode,
  resolveCreditNoteFiscalCode
} from './utils/fiscal/fiscalHelpers';
import { getFiscalDocumentStatus, issueFiscalDocument } from './services/fiscal/fiscalService';
import { azulMcmService } from './services/payments/AzulMcmService';
import { ingenicoAzulWebApiService } from './services/payments/IngenicoAzulWebApiService';
import {
  cardNetEcrService,
  generateCardNetInvoiceTicket,
} from './services/payments/CardNetEcrService';
import { couponService } from './utils/couponService';

type ReceivableRepairSummary = {
  scannedTransactions: number;
  scannedWalletMovements: number;
  repairedTransactions: number;
  repairedCreditNotes: number;
  recalculatedCustomers: number;
  customersWithDebtChanges: number;
  totalPendingBefore: number;
  totalPendingAfter: number;
  transactionIds: string[];
  creditNoteIds: string[];
};

type RecoverySequencePromptState = RuntimeTerminalRecoveryState & {
  terminalId: string;
  terminalName?: string | null;
};

type ActiveCartDraft = {
  id: 'current';
  status: 'ACTIVE' | 'EMPTY';
  source: 'AUTO_CART_DRAFT';
  savedAt: string;
  reason?: string;
  currentView?: ViewState;
  terminalId?: string;
  activeTable?: Table | null;
  selectedCustomer?: Pick<Customer, 'id' | 'name'> | null;
  items: CartItem[];
  total: number;
};

type SafeExitSnapshot = {
  currentView: ViewState;
  cart: CartItem[];
  parkedTickets: ParkedTicket[];
  cashMovements: CashMovement[];
  selectedCustomer: Customer | null;
  activeTable: Table | null;
  terminalId?: string;
};

type ActiveTableEditLock = {
  tableId: string;
  ownerId: string;
  token: string;
  terminalId?: string;
  userId?: string;
  userName?: string;
  acquiredAt: number;
  expiresAt: number;
};

type PendingTableLockRelease = {
  lock: ActiveTableEditLock;
  phase: 'PERSIST_PENDING' | 'RELEASING';
  promise: Promise<boolean>;
};

type ParkedTicketSyncOptions = {
  deferRemote?: boolean;
  reason?: 'cart_changed' | 'debounced' | 'explicit' | 'customer_assigned';
  /** Persist only the active ticket while the operator is typing. */
  changedTicketId?: string;
};

type PendingClientTableSync = {
  id: 'current';
  status: 'PENDING' | 'EMPTY';
  tableId?: string;
  queuedAt: string;
  reason?: ParkedTicketSyncOptions['reason'];
  parkedTickets: ParkedTicket[];
};

const parseNativeBridgeJson = (value: unknown): any => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const LICENSE_REFRESH_BASE_MS = 60_000;
const TIMER_JITTER_MIN_MS = 3_000;
const TIMER_JITTER_MAX_MS = 5_000;
const ACTIVE_CART_DRAFT_STORAGE_KEY = 'clic_pos_active_cart_draft_v1';
const PARKED_TICKETS_STORAGE_KEY = 'clic_pos_parked_tickets_mirror_v1';
const CASH_MOVEMENTS_STORAGE_KEY = 'clic_pos_cash_movements_mirror_v1';
const FLOOR_PLAN_STORAGE_KEY = 'clic_pos_floor_plan_mirror_v1';
const ACTIVE_USER_SESSION_STORAGE_KEY = 'clic_pos_active_user_session_v1';
const FORCE_LOGIN_AFTER_EXIT_STORAGE_KEY = 'clic_pos_force_login_after_exit_v1';
const PENDING_CLIENT_TABLE_SYNC_STORAGE_KEY = 'clic_pos_pending_client_table_sync_v1';
const CLIENT_TABLE_POLL_INTERVAL_MS = 1000;
// Un operador puede encadenar mesa → artículo → mesa en menos de un segundo.
// El journal local ya está escrito; SQLite/Outbox esperan esta ventana para no
// competir con la siguiente pintura, pero conservan orden FIFO después de ella.
const TABLE_PERSISTENCE_IDLE_MS = 1_000;

type FloorPlanMirror = {
  rooms: Room[];
  tables: Table[];
  savedAt: string;
  tenantId?: string;
  terminalId?: string;
  layoutSource?: 'MASTER_DESIGNER' | 'MASTER_RUNTIME' | 'MASTER_SNAPSHOT' | 'DEFAULT_SEED';
  layoutRevision?: number;
  isDefaultSeed?: boolean;
};

const readFloorPlanMirror = (): FloorPlanMirror | null => {
  try {
    const raw = window.localStorage.getItem(FLOOR_PLAN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloorPlanMirror>;
    if (!Array.isArray(parsed.rooms) || parsed.rooms.length === 0) return null;
    if (!Array.isArray(parsed.tables) || parsed.tables.length === 0) return null;
    const activeTenantId = String(window.localStorage.getItem('active_tenant_id') || '').trim();
    const activeTerminalId = String(
      window.localStorage.getItem('active_terminal_id')
      || window.localStorage.getItem('CLIC_POS_TERMINAL_ID')
      || ''
    ).trim();
    if (parsed.tenantId && activeTenantId && parsed.tenantId !== activeTenantId) return null;
    if (parsed.terminalId && activeTerminalId && parsed.terminalId !== activeTerminalId) return null;
    return {
      rooms: parsed.rooms as Room[],
      tables: parsed.tables as Table[],
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      tenantId: parsed.tenantId,
      terminalId: parsed.terminalId,
      layoutSource: parsed.layoutSource,
      layoutRevision: parsed.layoutRevision,
      isDefaultSeed: parsed.isDefaultSeed,
    };
  } catch {
    return null;
  }
};

const writeFloorPlanMirror = (
  rooms: Room[],
  tables: Table[],
  metadata: Pick<FloorPlanMirror, 'layoutSource' | 'layoutRevision' | 'isDefaultSeed'> = {},
): void => {
  if (!Array.isArray(rooms) || rooms.length === 0) return;
  if (!Array.isArray(tables) || tables.length === 0) return;
  try {
    window.localStorage.setItem(FLOOR_PLAN_STORAGE_KEY, JSON.stringify({
      rooms,
      tables,
      savedAt: new Date().toISOString(),
      tenantId: String(window.localStorage.getItem('active_tenant_id') || '').trim() || undefined,
      terminalId: String(
        window.localStorage.getItem('active_terminal_id')
        || window.localStorage.getItem('CLIC_POS_TERMINAL_ID')
        || ''
      ).trim() || undefined,
      ...metadata,
    } satisfies FloorPlanMirror));
  } catch (error) {
    console.warn('No se pudo actualizar el respaldo local del layout:', error);
  }
};

const isTableManagedCartSnapshot = (snapshot: Pick<SafeExitSnapshot, 'activeTable'>): boolean =>
  Boolean(snapshot.activeTable?.id || snapshot.activeTable?.currentOrderId);

const isTableManagedCartDraft = (draft: Pick<ActiveCartDraft, 'activeTable'>): boolean =>
  Boolean(draft.activeTable?.id || draft.activeTable?.currentOrderId);

const buildActiveCartDraft = (snapshot: SafeExitSnapshot, reason = 'auto'): ActiveCartDraft => {
  const items = Array.isArray(snapshot.cart) ? snapshot.cart : [];
  return {
    id: 'current',
    status: items.length > 0 ? 'ACTIVE' : 'EMPTY',
    source: 'AUTO_CART_DRAFT',
    savedAt: new Date().toISOString(),
    reason,
    currentView: snapshot.currentView,
    terminalId: snapshot.terminalId,
    activeTable: snapshot.activeTable || null,
    selectedCustomer: snapshot.selectedCustomer
      ? { id: snapshot.selectedCustomer.id, name: snapshot.selectedCustomer.name }
      : null,
    items,
    total: items.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0),
  };
};

const normalizeActiveCartDraft = (value: unknown): ActiveCartDraft | null => {
  const candidate = Array.isArray(value)
    ? value.find((entry: any) => entry?.id === 'current') || value[0]
    : value;
  if (!candidate || typeof candidate !== 'object') return null;
  const draft = candidate as ActiveCartDraft;
  if (!Array.isArray(draft.items) || draft.items.length === 0 || draft.status === 'EMPTY') return null;
  if (isTableManagedCartDraft(draft)) return null;
  return {
    ...draft,
    id: 'current',
    status: 'ACTIVE',
    source: 'AUTO_CART_DRAFT',
    total: Number(draft.total || 0),
  };
};

const readActiveCartDraftFromLocalStorage = (): ActiveCartDraft | null => {
  try {
    const raw = window.localStorage.getItem(ACTIVE_CART_DRAFT_STORAGE_KEY);
    return raw ? normalizeActiveCartDraft(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

const readArrayMirrorFromLocalStorage = <T,>(key: string): T[] => {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
};

const persistActiveUserSession = (user: User | null, currentView: ViewState) => {
  try {
    // The native Presentation shares localhost/localStorage with MainActivity.
    // It must never overwrite or clear the operator session with VISOR state.
    if (isCustomerDisplayView(currentView)) return;
    if (!user?.id) {
      window.localStorage.removeItem(ACTIVE_USER_SESSION_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ACTIVE_USER_SESSION_STORAGE_KEY, JSON.stringify({
      userId: user.id,
      savedAt: new Date().toISOString(),
      currentView,
      terminalId: String(
        window.localStorage.getItem('active_terminal_id')
        || window.localStorage.getItem('CLIC_POS_TERMINAL_ID')
        || ''
      ).trim() || undefined,
    }));
  } catch {
    // Session restore is best-effort only. Login remains the source of truth.
  }
};

const readActiveUserSession = (): {
  userId: string;
  currentView?: ViewState;
  savedAt?: string;
  terminalId?: string;
} | null => {
  try {
    const raw = window.localStorage.getItem(ACTIVE_USER_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const userId = String(parsed?.userId || '').trim();
    if (!userId) return null;
    return {
      userId,
      currentView: parsed?.currentView,
      savedAt: typeof parsed?.savedAt === 'string' ? parsed.savedAt : undefined,
      terminalId: typeof parsed?.terminalId === 'string' ? parsed.terminalId : undefined,
    };
  } catch {
    return null;
  }
};

const readNativeLaunchContext = (): NativeLaunchContext => {
  try {
    const value = String((window as any).ClicPOSAppBridge?.getLaunchContext?.() || '').trim();
    if (value === 'activity_recreated' || value === 'fresh_start') return value;
  } catch {
    // A missing bridge is intentionally treated as a fresh/unknown launch.
  }
  return 'unknown';
};

const clearActiveUserSession = () => {
  try {
    window.localStorage.removeItem(ACTIVE_USER_SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
};

const readConfigNumber = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
};

const resolveTerminalAutoLogoutMinutes = (terminal: any): number => {
  const terminalConfig = terminal?.config as any;
  const security = terminalConfig?.security || {};
  const session = terminalConfig?.session || {};
  const workflowSession = terminalConfig?.workflow?.session || {};
  const operational = terminalConfig?.operational || {};

  return Math.max(0, readConfigNumber(
    security.autoLogoutMinutes,
    security.auto_logout_minutes,
    security.autoLockMinutes,
    security.auto_lock_minutes,
    session.autoLogoutMinutes,
    session.auto_logout_minutes,
    session.autoLockMinutes,
    session.auto_lock_minutes,
    workflowSession.autoLogoutMinutes,
    workflowSession.auto_logout_minutes,
    workflowSession.autoLockMinutes,
    workflowSession.auto_lock_minutes,
    operational.autoLogoutMinutes,
    operational.auto_logout_minutes,
    operational.autoLockMinutes,
    operational.auto_lock_minutes,
    terminalConfig?.autoLogoutMinutes,
    terminalConfig?.auto_logout_minutes,
    terminalConfig?.autoLockMinutes,
    terminalConfig?.auto_lock_minutes
  ) ?? 0);
};

const markForceLoginAfterExit = () => {
  try {
    window.localStorage.setItem(FORCE_LOGIN_AFTER_EXIT_STORAGE_KEY, new Date().toISOString());
  } catch {
    // ignore
  }
};

const consumeForceLoginAfterExit = (): boolean => {
  try {
    const shouldForceLogin = Boolean(window.localStorage.getItem(FORCE_LOGIN_AFTER_EXIT_STORAGE_KEY));
    if (shouldForceLogin) {
      window.localStorage.removeItem(FORCE_LOGIN_AFTER_EXIT_STORAGE_KEY);
    }
    return shouldForceLogin;
  } catch {
    return false;
  }
};

const writeCriticalCollectionsMirror = (parkedTickets: ParkedTicket[], cashMovements: CashMovement[]) => {
  try {
    window.localStorage.setItem(PARKED_TICKETS_STORAGE_KEY, JSON.stringify(Array.isArray(parkedTickets) ? parkedTickets : []));
    window.localStorage.setItem(CASH_MOVEMENTS_STORAGE_KEY, JSON.stringify(Array.isArray(cashMovements) ? cashMovements : []));
  } catch {
    // SQLite/native adapter remains the primary durable store; this mirror is a crash/kill safety net.
  }
};

const persistPendingClientTableSync = async (pending: PendingClientTableSync): Promise<void> => {
  writePendingTableSyncMirror(pending);
  await db.saveDocument('pendingClientTableSync' as any, pending);
};

const writePendingTableSyncMirror = (pending: PendingClientTableSync): void => {
  try {
    window.localStorage.setItem(PENDING_CLIENT_TABLE_SYNC_STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // SQLite remains the durable fallback when localStorage is unavailable.
  }
};

const readPendingClientTableSync = async (): Promise<PendingClientTableSync | null> => {
  try {
    const raw = window.localStorage.getItem(PENDING_CLIENT_TABLE_SYNC_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PendingClientTableSync;
      if (parsed?.status === 'PENDING' && Array.isArray(parsed.parkedTickets)) {
        return parsed;
      }
      return null;
    }
  } catch {
    // Fall through to the SQLite-backed copy.
  }

  try {
    const persisted = await db.getDocument('pendingClientTableSync' as any, 'current') as unknown as PendingClientTableSync | null;
    return persisted?.status === 'PENDING' && Array.isArray(persisted.parkedTickets)
      ? persisted
      : null;
  } catch {
    return null;
  }
};

const clearPendingClientTableSync = async (): Promise<void> => {
  const cleared: PendingClientTableSync = {
    id: 'current',
    status: 'EMPTY',
    queuedAt: new Date().toISOString(),
    parkedTickets: [],
  };
  try {
    window.localStorage.setItem(PENDING_CLIENT_TABLE_SYNC_STORAGE_KEY, JSON.stringify(cleared));
  } catch {
    // ignore
  }
  await db.saveDocument('pendingClientTableSync' as any, cleared).catch(() => undefined);
};

const mergeById = <T extends { id?: string }>(primary: T[], fallback: T[]): T[] => {
  const merged = new Map<string, T>();
  [...fallback, ...primary].forEach((item, index) => {
    const key = String(item?.id || `idx-${index}`).trim();
    if (key) merged.set(key, item);
  });
  return Array.from(merged.values());
};

const parkedTicketReferencesTable = (ticket: ParkedTicket, tableId: string): boolean => {
  const normalizedTableId = String(tableId || '').trim();
  if (!normalizedTableId) return false;
  if (String(ticket?.tableId || '').trim() === normalizedTableId) return true;
  const joinedTableIds = Array.isArray((ticket as any)?.joinedTableIds)
    ? (ticket as any).joinedTableIds
    : [];
  return joinedTableIds.some((joinedTableId: unknown) =>
    String(joinedTableId || '').trim() === normalizedTableId
  );
};

const scopeTicketsForTableSync = (tickets: ParkedTicket[], tableId?: string): ParkedTicket[] => {
  const normalizedTableId = String(tableId || '').trim();
  if (!normalizedTableId) return tickets;
  return tickets.filter(ticket => parkedTicketReferencesTable(ticket, normalizedTableId));
};

const mergePendingClientTableTickets = (
  remoteTickets: ParkedTicket[],
  pendingSync?: PendingClientTableSync | null,
): ParkedTicket[] => {
  const tableId = String(pendingSync?.tableId || '').trim();
  if (pendingSync?.status !== 'PENDING' || !tableId || !Array.isArray(pendingSync.parkedTickets)) {
    return remoteTickets;
  }

  const unrelatedRemoteTickets = remoteTickets.filter(ticket =>
    !parkedTicketReferencesTable(ticket, tableId)
  );
  const pendingTableTickets = pendingSync.parkedTickets.filter(ticket =>
    parkedTicketReferencesTable(ticket, tableId)
  );
  return mergeById(pendingTableTickets, unrelatedRemoteTickets);
};

const persistActiveCartDraftSnapshot = async (snapshot: SafeExitSnapshot, reason = 'auto') => {
  if (isTableManagedCartSnapshot(snapshot)) {
    await clearActiveCartDraftStorage();
    return;
  }

  const draft = buildActiveCartDraft(snapshot, reason);
  try {
    if (draft.status === 'ACTIVE') {
      window.localStorage.setItem(ACTIVE_CART_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } else {
      window.localStorage.removeItem(ACTIVE_CART_DRAFT_STORAGE_KEY);
    }
  } catch {
    // Best effort: SQLite/native adapter remains the durable source.
  }

  await db.save('activeCartDraft' as any, draft);
};

const clearActiveCartDraftStorage = async () => {
  try {
    window.localStorage.removeItem(ACTIVE_CART_DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
  await db.save('activeCartDraft' as any, {
    id: 'current',
    status: 'EMPTY',
    source: 'AUTO_CART_DRAFT',
    savedAt: new Date().toISOString(),
    items: [],
    total: 0,
  } as ActiveCartDraft);
};

const persistCriticalLocalStateSnapshot = async (
  snapshot: SafeExitSnapshot,
  options: { reason: string; parkActiveCart?: boolean; onParkedTickets?: (tickets: ParkedTicket[]) => void } = { reason: 'auto' },
) => {
  let nextParkedTickets = Array.isArray(snapshot.parkedTickets) ? [...snapshot.parkedTickets] : [];

  if (options.parkActiveCart && snapshot.currentView === 'POS' && Array.isArray(snapshot.cart) && snapshot.cart.length > 0) {
    const existingId = snapshot.activeTable?.currentOrderId;
    const ticketId = existingId || `AUTO-${Date.now()}`;
    const tableName = snapshot.activeTable?.nombre || snapshot.activeTable?.name || '';
    const autoTicket: ParkedTicket = {
      id: ticketId,
      name: tableName ? `Mesa: ${tableName}` : 'Ticket recuperado por cierre',
      alias: tableName ? undefined : 'Recuperado por cierre de app',
      items: snapshot.cart,
      total: snapshot.cart.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0),
      customerId: snapshot.selectedCustomer?.id,
      customerName: snapshot.selectedCustomer?.name,
      timestamp: new Date().toISOString(),
      tableId: snapshot.activeTable?.id,
    };

    nextParkedTickets = [
      ...nextParkedTickets.filter(ticket => ticket.id !== autoTicket.id),
      autoTicket,
    ];
    options.onParkedTickets?.(nextParkedTickets);
  }

  const nextCashMovements = Array.isArray(snapshot.cashMovements) ? snapshot.cashMovements : [];
  writeCriticalCollectionsMirror(nextParkedTickets, nextCashMovements);

  await Promise.allSettled([
    db.save('parkedTickets', nextParkedTickets),
    db.save('cashMovements', nextCashMovements),
    snapshot.currentView === 'POS' || (Array.isArray(snapshot.cart) && snapshot.cart.length > 0)
      ? persistActiveCartDraftSnapshot(snapshot, options.reason)
      : Promise.resolve(),
  ]);
};

const getTimerJitterMs = (): number => (
  TIMER_JITTER_MIN_MS + Math.floor(Math.random() * (TIMER_JITTER_MAX_MS - TIMER_JITTER_MIN_MS + 1))
);

const resolveSetupTenantId = (): string => {
  const candidates = [
    localStorage.getItem('active_tenant_id'),
    localStorage.getItem('clic_tenant_id'),
    localStorage.getItem('clic_erp_tenant_id'),
  ];

  return candidates
    .map((value) => (value || '').trim())
    .find((value) => Boolean(value) && value !== 'default-tenant') || '';
};

const normalizeSetupBaseUrl = (value?: string | null): string | null =>
  normalizeErpBaseUrl(value);

const resolveSetupErpBaseUrl = (): string | null => resolveErpBaseUrl();

const persistSetupErpBaseUrls = (value?: string | null) => {
  const normalized = normalizeSetupBaseUrl(value);
  if (!normalized) return;

  localStorage.setItem('CLIC_ERP_BASE_URL', normalized);
  localStorage.setItem('erp_base_url', normalized);
  localStorage.setItem('CLIC_ERP_SYNC_URL', `${normalized}/api/sync`);
};

const pickSetupAuthString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.replace(/[\r\n\t]/g, '').trim();
    if (!normalized) continue;
    if (['undefined', 'null', 'nan', '[object object]'].includes(normalized.toLowerCase())) continue;
    return normalized;
  }
  return undefined;
};

const extractSetupAuthPayload = (...sources: unknown[]) => {
  const records = sources
    .filter((source): source is Record<string, any> => Boolean(source) && typeof source === 'object')
    .flatMap((record) => [
      record,
      record.auth,
      record.syncAuth,
      record.terminal_config,
      record.terminal_config?.auth,
      record.terminal_config?.metadata,
      record.terminal_config?.metadata?.syncAuth,
      record.terminal,
      record.terminal?.auth,
      record.terminal?.config,
      record.terminal?.config?.auth,
      record.terminal?.config?.metadata,
      record.terminal?.config?.metadata?.syncAuth,
      record.config,
      record.config?.auth,
      record.config?.security,
      record.config?.runtime,
      record.metadata,
      record.metadata?.auth,
      record.metadata?.syncAuth,
      record.session,
    ])
    .filter((source): source is Record<string, any> => Boolean(source) && typeof source === 'object');

  const deviceToken = pickSetupAuthString(...records.flatMap((record) => [
    record.deviceToken,
    record.device_token,
    record.terminalToken,
    record.terminal_token,
    record.activationToken,
    record.activation_token,
    record.auth?.deviceToken,
    record.auth?.device_token,
    record.auth?.terminalToken,
    record.auth?.terminal_token,
    record.auth?.activationToken,
    record.auth?.activation_token,
    record.syncAuth?.deviceToken,
    record.syncAuth?.device_token,
  ]));
  const terminalToken = pickSetupAuthString(...records.flatMap((record) => [
    record.terminalToken,
    record.terminal_token,
    record.auth?.terminalToken,
    record.auth?.terminal_token,
    record.syncAuth?.terminalToken,
    record.syncAuth?.terminal_token,
  ]));
  const activationToken = pickSetupAuthString(...records.flatMap((record) => [
    record.activationToken,
    record.activation_token,
    record.auth?.activationToken,
    record.auth?.activation_token,
    record.syncAuth?.activationToken,
    record.syncAuth?.activation_token,
  ]));
  const syncToken = pickSetupAuthString(...records.flatMap((record) => [
    record.syncToken,
    record.sync_token,
    record.syncAuthToken,
    record.sync_auth_token,
    record.auth?.syncToken,
    record.auth?.sync_token,
    record.auth?.syncAuthToken,
    record.auth?.sync_auth_token,
    record.syncAuth?.syncToken,
    record.syncAuth?.sync_token,
    record.syncAuth?.syncAuthToken,
    record.syncAuth?.sync_auth_token,
  ]));
  const tokenExpiresAt = pickSetupAuthString(...records.flatMap((record) => [
    record.tokenExpiresAt,
    record.token_expires_at,
    record.expiresAt,
    record.expires_at,
    record.syncAuth?.tokenExpiresAt,
    record.syncAuth?.token_expires_at,
  ]));

  return { deviceToken, terminalToken, activationToken, syncToken, tokenExpiresAt };
};

const logRegisterResponseAuth = (auth: ReturnType<typeof extractErpRegisterAuth>) => {
  console.log('[REGISTER_RESPONSE_AUTH]', {
    deviceTokenPresent: Boolean(auth.deviceToken),
    terminalTokenPresent: Boolean(auth.terminalToken),
    activationTokenPresent: Boolean(auth.activationToken),
    syncTokenPresent: Boolean(auth.syncToken),
    tokenExpiresAt: auth.tokenExpiresAt || null,
    responseKeys: Object.keys(auth).filter((key) => Boolean((auth as Record<string, unknown>)[key])),
  });
};

const buildInitialTerminalConfigSnapshot = (config: BusinessConfig): BusinessConfig => {
  const metadata = config.metadata && typeof config.metadata === 'object'
    ? {
        tenantId: config.metadata.tenantId,
        tenantSlug: config.metadata.tenantSlug,
        setupMode: config.metadata.setupMode,
        syncMode: config.metadata.syncMode,
        integrationMode: config.metadata.integrationMode,
        cloudSync: config.metadata.cloudSync,
        erpTenantId: config.metadata.erpTenantId,
        erpBaseUrl: config.metadata.erpBaseUrl,
        syncAuth: config.metadata.syncAuth,
        deviceToken: config.metadata.deviceToken,
        syncToken: config.metadata.syncToken,
        tokenExpiresAt: config.metadata.tokenExpiresAt,
      }
    : undefined;

  return {
    vertical: config.vertical,
    subVertical: config.subVertical,
    currencySymbol: config.currencySymbol,
    taxRate: config.taxRate,
    taxes: Array.isArray(config.taxes) ? config.taxes : [],
    themeColor: config.themeColor,
    features: config.features || { stockTracking: false },
    units: Array.isArray(config.units) ? config.units : [],
    loyalty: config.loyalty,
    companyInfo: config.companyInfo,
    currencies: Array.isArray(config.currencies) ? config.currencies : [],
    paymentMethods: Array.isArray(config.paymentMethods) ? config.paymentMethods : [],
    integrations: Array.isArray(config.integrations) ? config.integrations : [],
    terminals: Array.isArray(config.terminals) ? config.terminals : [],
    tariffs: Array.isArray(config.tariffs) ? config.tariffs : [],
    receiptConfig: config.receiptConfig,
    labelTemplates: Array.isArray(config.labelTemplates) ? config.labelTemplates : [],
    tipsConfig: config.tipsConfig,
    emailConfig: config.emailConfig,
    fiscalCompliance: config.fiscalCompliance,
    availablePrinters: Array.isArray(config.availablePrinters) ? config.availablePrinters : [],
    scales: Array.isArray(config.scales) ? config.scales : [],
    scaleLabelConfig: config.scaleLabelConfig,
    roles: Array.isArray(config.roles) ? config.roles : [],
    inventoryScope: config.inventoryScope,
    operational: config.operational,
    ux: config.ux,
    metadata,
  };
};

const persistInitialTerminalConfig = (config: BusinessConfig) => {
  const key = 'initial_terminal_config';
  const recoverySnapshot = buildInitialTerminalConfigSnapshot(config);
  saveTerminalCredentialsSync({
    masterIp: localStorage.getItem('pos_master_ip'),
    masterUrl: localStorage.getItem('CLIC_POS_MASTER_URL'),
    setupMode: localStorage.getItem('clic_pos_terminal_setup_mode'),
    syncMode: localStorage.getItem('clic_sync_mode'),
    configSnapshot: recoverySnapshot,
  });
  try {
    localStorage.setItem(key, JSON.stringify(config));
    return;
  } catch (error) {
    console.warn('⚠️ initial_terminal_config completo excede cuota; guardando snapshot liviano.', error);
  }

  try {
    localStorage.setItem(key, JSON.stringify(recoverySnapshot));
  } catch (error) {
    console.warn('⚠️ No se pudo guardar initial_terminal_config liviano; se preserva config en SQLite.', error);
    localStorage.removeItem(key);
  }
};

const restorePersistentOperationalIdentity = (
  credentials: Record<string, any>,
  fallbackDeviceId?: string | null
): boolean => {
  const terminalId = normalizeCanonicalErpTerminalId(
    credentials?.erpTerminalId
    || credentials?.terminalId
    || localStorage.getItem('clic_erp_sync_terminal_id')
    || ''
  );
  const operationalTerminalId = String(
    credentials?.terminalCode
    || credentials?.stationNumber
    || localStorage.getItem('clic_erp_sync_terminal_code')
    || localStorage.getItem('active_terminal_id')
    || localStorage.getItem('CLIC_POS_TERMINAL_ID')
    || ''
  ).trim();
  const tenantId = String(
    credentials?.erpTenantId
    || credentials?.tenantId
    || credentials?.cloudAdminTenantId
    || localStorage.getItem('clic_erp_sync_tenant_id')
    || localStorage.getItem('active_tenant_id')
    || localStorage.getItem('clic_tenant_id')
    || ''
  ).trim();
  const deviceId = String(
    credentials?.deviceId
    || fallbackDeviceId
    || localStorage.getItem('CLIC_POS_DEVICE_ID')
    || ''
  ).trim();
  const hasToken = Boolean(
    credentials?.deviceToken
    || credentials?.syncToken
    || localStorage.getItem('CLIC_POS_DEVICE_TOKEN')
    || localStorage.getItem('clic_erp_sync_token')
  );
  const alreadyBound = localStorage.getItem(TERMINAL_BINDING_STATUS_KEY) === 'BOUND';
  const hasInitialConfig = Boolean(localStorage.getItem('initial_terminal_config'));
  const hasOperationalIdentity = Boolean(terminalId && deviceId && (hasToken || alreadyBound || hasInitialConfig));

  if (!hasOperationalIdentity) return false;

  if (operationalTerminalId) {
    localStorage.setItem('active_terminal_id', operationalTerminalId);
    localStorage.setItem('CLIC_POS_TERMINAL_ID', operationalTerminalId);
  }
  localStorage.setItem('clic_erp_sync_terminal_id', terminalId);
  localStorage.setItem('CLIC_POS_DEVICE_ID', deviceId);
  localStorage.setItem(TERMINAL_BINDING_STATUS_KEY, 'BOUND');
  localStorage.setItem('clic_sync_auth_status', 'BOUND');
  localStorage.removeItem(TERMINAL_SETUP_PENDING_KEY);
  localStorage.setItem(SETUP_WIZARD_COMPLETED_KEY, '1');
  if (tenantId) {
    localStorage.setItem('clic_tenant_id', tenantId);
    localStorage.setItem('active_tenant_id', tenantId);
    localStorage.setItem('clic_erp_sync_tenant_id', tenantId);
  }

  console.info('persistent_operational_identity_restored_before_boot_redirect', {
    terminalId,
    operationalTerminalId: operationalTerminalId || null,
    tenantId: tenantId || null,
    deviceId,
    hasToken,
    alreadyBound,
    hasInitialConfig,
  });
  return true;
};

const resolveFriendlyTerminalName = (terminal: any): string => {
  const candidates = [
    terminal?.config?.terminalName,
    terminal?.config?.erpBinding?.terminalName,
    terminal?.name,
    terminal?.config?.stationNumber,
    terminal?.config?.erpBinding?.stationNumber,
    terminal?.config?.erpTerminalId,
    terminal?.id,
  ];

  return candidates
    .map((value) => String(value || '').trim())
    .find(Boolean) || 'Terminal';
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const looksLikeUuid = (value?: string | null): boolean => UUID_PATTERN.test(String(value || '').trim());

const resolveTerminalErpIdentity = (terminal: any): string => (
  String(
    terminal?.config?.erpTerminalId
    || terminal?.config?.erpBinding?.terminalId
    || (looksLikeUuid(terminal?.id) ? terminal?.id : '')
    || ''
  ).trim()
);

const configuredTerminalReferenceMatches = (terminal: any, reference?: string | null): boolean => {
  const normalizedReference = String(reference || '').trim().toLowerCase();
  if (!normalizedReference) return false;
  return [
    terminal?.id,
    terminal?.config?.erpTerminalId,
    terminal?.config?.erpBinding?.terminalId,
    terminal?.config?.terminalName,
    terminal?.config?.erpBinding?.terminalName,
    terminal?.name,
    terminal?.config?.stationNumber,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .includes(normalizedReference);
};

const resolveErpTerminalAliasMatch = (terminals: any[], reference?: string | null) => {
  if (!reference || looksLikeUuid(reference)) return null;
  return terminals.find((terminal) =>
    looksLikeUuid(resolveTerminalErpIdentity(terminal)) &&
    configuredTerminalReferenceMatches(terminal, reference)
  ) || null;
};

const terminalCompletenessScore = (terminal: any): number => {
  let score = 0;
  if (looksLikeUuid(resolveTerminalErpIdentity(terminal))) score += 1000;
  if (terminal?.config?.erpSnapshot) score += 300;
  if (terminal?.config?.erpBinding) score += 250;
  if (terminal?.config?.erpTerminalId) score += 200;
  if (Array.isArray(terminal?.config?.documentSeries) && terminal.config.documentSeries.length > 0) score += 60;
  if (terminal?.config?.documentAssignments && Object.keys(terminal.config.documentAssignments).length > 0) score += 45;
  if (terminal?.config?.inventoryScope) score += 40;
  if (terminal?.config?.pricing) score += 35;
  if (terminal?.config?.fiscal) score += 30;
  if (terminal?.config?.currentDeviceId) score += 15;
  return score;
};

const mergeTerminalRecords = (base: any, incoming: any) => {
  const winner = terminalCompletenessScore(incoming) > terminalCompletenessScore(base) ? incoming : base;
  const fallback = winner === incoming ? base : incoming;
  return {
    ...fallback,
    ...winner,
    id: winner?.id || fallback?.id,
    config: {
      ...(fallback?.config || {}),
      ...(winner?.config || {}),
      erpTerminalId: resolveTerminalErpIdentity(winner) || resolveTerminalErpIdentity(fallback) || winner?.config?.erpTerminalId || fallback?.config?.erpTerminalId,
      terminalName: winner?.config?.terminalName || fallback?.config?.terminalName || resolveFriendlyTerminalName(winner) || resolveFriendlyTerminalName(fallback),
      currentDeviceId: winner?.config?.currentDeviceId || fallback?.config?.currentDeviceId,
      erpBinding: winner?.config?.erpBinding || fallback?.config?.erpBinding,
      erpSnapshot: winner?.config?.erpSnapshot || fallback?.config?.erpSnapshot,
    },
  };
};

const dedupeConfiguredTerminals = (items: any[]): any[] => {
  const byKey = new Map<string, any>();
  const aliasToErpKey = new Map<string, string>();

  for (const terminal of items || []) {
    const erpIdentity = resolveTerminalErpIdentity(terminal);
    const alias = String(resolveFriendlyTerminalName(terminal) || '').trim().toLowerCase();
    const key = looksLikeUuid(erpIdentity)
      ? `erp:${erpIdentity.toLowerCase()}`
      : (aliasToErpKey.get(alias) || (alias ? `alias:${alias}` : `id:${String(terminal?.id || '').trim().toLowerCase()}`));

    if (looksLikeUuid(erpIdentity) && alias) {
      aliasToErpKey.set(alias, key);
      const aliasKey = `alias:${alias}`;
      const aliasExisting = byKey.get(aliasKey);
      if (aliasExisting) {
        byKey.delete(aliasKey);
        byKey.set(key, mergeTerminalRecords(aliasExisting, terminal));
        continue;
      }
    }

    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeTerminalRecords(existing, terminal) : terminal);
  }

  return Array.from(byKey.values());
};

const resolvePreferredTerminalForDevice = (
  terminals: any[],
  deviceId: string,
  options?: {
    activeTerminalId?: string | null;
    bindingTerminalId?: string | null;
    bindingLocalTerminalId?: string | null;
  }
) => {
  const candidates = terminals.filter((terminal) => terminal?.config?.currentDeviceId === deviceId);
  if (candidates.length === 0) return null;

  const activeTerminalId = String(options?.activeTerminalId || '').trim();
  const bindingTerminalId = String(options?.bindingTerminalId || '').trim();
  const bindingLocalTerminalId = String(options?.bindingLocalTerminalId || '').trim();

  const scoreTerminal = (terminal: any) => {
    let score = 0;
    const localId = String(terminal?.id || '').trim();
    const erpTerminalId = String(terminal?.config?.erpTerminalId || '').trim();
    const erpBindingTerminalId = String(terminal?.config?.erpBinding?.terminalId || '').trim();
    const terminalName = String(terminal?.config?.terminalName || '').trim();
    const stationNumber = String(terminal?.config?.stationNumber || '').trim();
    const hasUuidIdentity = looksLikeUuid(localId) || looksLikeUuid(erpTerminalId) || looksLikeUuid(erpBindingTerminalId);

    if (hasUuidIdentity) score += 150;
    if (activeTerminalId && (localId === activeTerminalId || erpTerminalId === activeTerminalId || erpBindingTerminalId === activeTerminalId)) score += looksLikeUuid(activeTerminalId) ? 120 : 35;
    if (bindingLocalTerminalId && localId === bindingLocalTerminalId) score += 80;
    if (bindingTerminalId && (erpTerminalId === bindingTerminalId || erpBindingTerminalId === bindingTerminalId || localId === bindingTerminalId)) score += looksLikeUuid(bindingTerminalId) ? 140 : 45;
    if (terminalName) score += 20;
    if (stationNumber) score += 10;
    if (erpTerminalId) score += 8;
    if (erpBindingTerminalId) score += 8;

    return score;
  };

  return [...candidates].sort((left, right) => scoreTerminal(right) - scoreTerminal(left))[0] || candidates[0];
};

const clearDuplicateDeviceAssignments = (
  config: BusinessConfig,
  deviceId: string,
  options?: {
    activeTerminalId?: string | null;
    bindingTerminalId?: string | null;
    bindingLocalTerminalId?: string | null;
  }
): { config: BusinessConfig; changed: boolean; preferredTerminalId: string | null } => {
  if (!Array.isArray(config.terminals) || !deviceId) {
    return { config, changed: false, preferredTerminalId: null };
  }

  const preferred = resolvePreferredTerminalForDevice(config.terminals, deviceId, options);
  if (!preferred) {
    return { config, changed: false, preferredTerminalId: null };
  }

  let changed = false;
  const nextTerminals = config.terminals.map((terminal) => {
    if (terminal?.config?.currentDeviceId !== deviceId) {
      return terminal;
    }

    if (terminal.id === preferred.id) {
      return terminal;
    }

    changed = true;
    return {
      ...terminal,
      config: {
        ...terminal.config,
        currentDeviceId: undefined,
      },
    };
  });

  const dedupedTerminals = dedupeConfiguredTerminals(nextTerminals);
  if (!changed && dedupedTerminals.length === nextTerminals.length) {
    return { config, changed: false, preferredTerminalId: preferred.id || null };
  }

  return {
    config: {
      ...config,
      terminals: dedupedTerminals,
    },
    changed: true,
    preferredTerminalId: preferred.id || null,
  };
};

const resolvePersistedBusinessConfig = (rawConfig: unknown): BusinessConfig | null => {
  if (!rawConfig) return null;

  if (Array.isArray(rawConfig)) {
    const candidate =
      rawConfig.find((entry: any) => entry?.id === 'current')
      || rawConfig.find((entry: any) => entry?.id !== '_db_initialized' && entry?.id !== 'config_metadata')
      || rawConfig[0];

    return candidate && !Array.isArray(candidate) && Array.isArray(candidate.terminals)
      ? candidate as BusinessConfig
      : null;
  }

  return !Array.isArray(rawConfig) && Array.isArray((rawConfig as BusinessConfig).terminals)
    ? rawConfig as BusinessConfig
    : null;
};

const normalizeTerminalDocumentAssignments = (
  sourceConfig: BusinessConfig | null | undefined
): { config: BusinessConfig | null | undefined; changed: boolean } => {
  if (!sourceConfig || Array.isArray(sourceConfig) || !Array.isArray(sourceConfig.terminals)) {
    return { config: sourceConfig, changed: false };
  }

  let changed = false;
  const terminals = sourceConfig.terminals.map((terminal) => {
    const currentAssignments = terminal.config?.documentAssignments || {};
    const availableSeries = Array.isArray(terminal.config?.documentSeries) ? terminal.config.documentSeries : [];
    const nextAssignments = Object.entries(DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS).reduce<Record<string, string>>(
      (acc, [key, value]) => {
        const resolvedId = resolveDocumentAssignmentId(
          key,
          availableSeries,
          currentAssignments[key as keyof typeof DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS] || value
        );
        acc[key] = resolvedId || value;
        return acc;
      },
      { ...currentAssignments }
    );

    const assignmentsChanged = Object.entries(DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS).some(
      ([key, value]) => currentAssignments[key as keyof typeof DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS] !== value
    );

    const resolvedAssignmentsChanged = Object.entries(nextAssignments).some(
      ([key, value]) => currentAssignments[key as keyof typeof DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS] !== value
    );

    if (!assignmentsChanged && !resolvedAssignmentsChanged) {
      return terminal;
    }

    changed = true;
    return {
      ...terminal,
      config: {
        ...terminal.config,
        documentAssignments: nextAssignments
      }
    };
  });

  return {
    config: changed ? { ...sourceConfig, terminals } : sourceConfig,
    changed
  };
};

const createRuntimeId = (prefix: string): string => {
  const hasRandomUuid =
    typeof globalThis !== 'undefined' &&
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function';

  if (hasRandomUuid) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const CREDIT_PAYMENT_METHODS = new Set(['CREDIT', 'CREDITO', 'PENDIENTE']);
const SETUP_WIZARD_COMPLETED_KEY = 'clic_pos_setup_wizard_completed';
const SETUP_FLOW_STAGE_KEY = 'clic_pos_setup_flow_stage';
const SETUP_FLOW_VERSION_KEY = 'clic_pos_setup_flow_version';
const TERMINAL_SETUP_MODE_KEY = 'clic_pos_terminal_setup_mode';
const TERMINAL_SETUP_PENDING_KEY = 'clic_pos_terminal_setup_pending';
const TERMINAL_CONFIG_RESTART_NOTICE_KEY = 'clic_pos_terminal_config_restart_notice';
const SETUP_FLOW_VERSION = '2';
const buildRuntimeMasterUrl = () => buildMasterUrlFromHost(window.location.hostname);
const isNativeAndroidRuntime = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

const hydrateNativeCatalogFromDb = async (
  setters: {
    setProducts: (value: Product[]) => void;
    setWarehouses: (value: Warehouse[]) => void;
    setProductStocks: (value: ProductStock[]) => void;
  },
  reason: string,
) => {
  if (!isNativeAndroidRuntime()) return;

  try {
    const [dbProducts, dbWarehouses, dbProductStocks] = await Promise.all([
      db.get('products') as Promise<Product[]>,
      db.get('warehouses') as Promise<Warehouse[]>,
      db.get('productStocks') as Promise<ProductStock[]>,
    ]);

    if (Array.isArray(dbProducts) && dbProducts.length > 0) {
      setters.setProducts(dbProducts);
    }
    if (Array.isArray(dbWarehouses) && dbWarehouses.length > 0) {
      setters.setWarehouses(dbWarehouses);
    }
    if (Array.isArray(dbProductStocks) && dbProductStocks.length > 0) {
      setters.setProductStocks(dbProductStocks);
    }

    console.log(`[BOOT] Native catalog hydrated (${reason})`, {
      products: Array.isArray(dbProducts) ? dbProducts.length : 0,
      warehouses: Array.isArray(dbWarehouses) ? dbWarehouses.length : 0,
      productStocks: Array.isArray(dbProductStocks) ? dbProductStocks.length : 0,
    });

    if (Array.isArray(dbProducts) && dbProducts.length > 0) {
      setCatalogDiagnosticStatus('SYNCED');
      clearStaleSyncErrorDiagnosticIfRecovered();
    }
  } catch (error) {
    console.warn(`[BOOT] Native catalog hydration failed (${reason}):`, error);
  }
};
const normalizeMasterHost = (value: string | null | undefined) =>
  (value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');

type TerminalSetupMode = 'SERVER_LOCAL' | 'SERVER_ERP' | 'CLIENT' | 'ORDER_TAKER';
type TerminalIntegrationMode = 'LOCAL_ONLY' | 'ERP_DIRECT';

type TerminalConfigRestartNotice = {
  receivedAt: string;
  eventId?: string | null;
  terminalId?: string | null;
};

const readTerminalConfigRestartNotice = (): TerminalConfigRestartNotice | null => {
  const raw = localStorage.getItem(TERMINAL_CONFIG_RESTART_NOTICE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      receivedAt: typeof parsed.receivedAt === 'string' ? parsed.receivedAt : new Date().toISOString(),
      eventId: typeof parsed.eventId === 'string' ? parsed.eventId : null,
      terminalId: typeof parsed.terminalId === 'string' ? parsed.terminalId : null,
    };
  } catch {
    return null;
  }
};

const getStoredTerminalSetupMode = (): TerminalSetupMode | null => {
  const storedMode = localStorage.getItem(TERMINAL_SETUP_MODE_KEY);
  if (storedMode === 'SERVER_LOCAL' || storedMode === 'SERVER_ERP' || storedMode === 'CLIENT' || storedMode === 'ORDER_TAKER') {
    return storedMode;
  }

  if (storedMode === 'SERVER') return 'SERVER_LOCAL';
  if (storedMode === 'CLIENT') return 'CLIENT';
  return null;
};

const isErpManagedPosUserRuntime = (): boolean => (
  getStoredTerminalSetupMode() === 'SERVER_ERP'
  || localStorage.getItem('clic_sync_mode') === 'POS_ERP'
);

const visiblePosUsersForRuntime = (users: unknown): User[] => selectPosUsersForRuntime(users, {
  erpManaged: isErpManagedPosUserRuntime(),
  fallbackUsers: MOCK_USERS,
});

const getTerminalSetupIntegrationMode = (setupMode: TerminalSetupMode | null): TerminalIntegrationMode => {
  return setupMode === 'SERVER_ERP' ? 'ERP_DIRECT' : 'LOCAL_ONLY';
};

const getTerminalBindingMode = (setupMode: TerminalSetupMode | null): 'MASTER' | 'SLAVE' => {
  return setupMode === 'CLIENT' || setupMode === 'ORDER_TAKER' ? 'SLAVE' : 'MASTER';
};

const getExpectedSetupTerminalType = (setupMode: TerminalSetupMode | null) => (
  setupMode === 'ORDER_TAKER'
    ? ORDER_TAKER_TERMINAL_TYPE
    : setupMode === 'CLIENT'
      ? STANDARD_POS_TERMINAL_TYPE
      : null
);

const coerceOptionalBoolean = (...values: unknown[]): boolean | undefined => {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'si', 'sí', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
  }
  return undefined;
};

const hasPendingTerminalSetup = (): boolean => localStorage.getItem(TERMINAL_SETUP_PENDING_KEY) === '1';

const isNativeStandaloneTerminalRuntime = (terminal?: { config?: TerminalConfig } | null): boolean => {
  if (!isNativeAndroidRuntime()) return false;

  // Un KDS, toma de pedidos, verificador o kiosco nunca debe anunciarse como
  // Caja Master aunque una configuración ERP antigua lo marque como primario.
  if (terminal && !isEligibleOperationalMasterTerminal(terminal)) return false;

  const setupMode = getStoredTerminalSetupMode();
  if (setupMode === 'CLIENT' || setupMode === 'ORDER_TAKER') return false;

  const terminalConfig = terminal?.config;
  if (terminalConfig?.isPrimaryNode === false && terminalConfig?.governedByMaster) {
    return false;
  }

  if (setupMode === 'SERVER_LOCAL') return true;
  if (!normalizeMasterHost(localStorage.getItem('pos_master_ip'))) return true;

  return terminalConfig?.isPrimaryNode === true && terminalConfig?.governedByMaster !== true;
};

const buildConfigSyncUrl = (): string | null => {
  const masterHost = normalizeMasterHost(localStorage.getItem('pos_master_ip'));
  const isLoopbackMaster = masterHost === 'localhost' || masterHost === '127.0.0.1';

  if (masterHost && !isLoopbackMaster) {
    const baseUrl = buildMasterUrlFromHost(masterHost);
    return baseUrl ? `${baseUrl}/api/config` : null;
  }

  if (isNativeAndroidRuntime()) {
    return null;
  }

  return `${buildRuntimeMasterUrl()}/api/config`;
};

const resolveReachableMasterBinding = async (host: string): Promise<{ host: string; baseUrl: string } | null> => {
  const normalizedHost = normalizeMasterHost(host);
  if (!normalizedHost) return null;

  for (const baseUrl of buildMasterUrlCandidates(normalizedHost)) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 3500);

    try {
      const [response, configResponse] = await Promise.all([
        fetch(`${baseUrl}/api/sync/ping`, { signal: controller.signal }),
        fetch(`${baseUrl}/api/config`, { signal: controller.signal }),
      ]);
      if (!response.ok || !configResponse.ok) continue;
      const remoteConfig = await configResponse.json();
      if (!isEligibleOperationalMasterConfig(remoteConfig)) continue;

      return {
        host: new URL(baseUrl).hostname,
        baseUrl,
      };
    } catch {
      // try next candidate
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  return null;
};

const isSeedSetupBusinessConfig = (config: BusinessConfig | null | undefined): boolean => {
  if (!config?.companyInfo) return false;

  const normalizedCompanyName = String(config.companyInfo.name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

  return (
    (normalizedCompanyName === 'CLIC POS DEMO' || normalizedCompanyName === 'EMPRESA DEMO') &&
    (!config.companyInfo.rnc || config.companyInfo.rnc === '131-12345-1') &&
    (!config.companyInfo.phone || config.companyInfo.phone === '809-555-POS1') &&
    (!config.companyInfo.address || config.companyInfo.address === 'Av. Principal #1, Santo Domingo')
  );
};

const normalizeCompanyInfoFromTenantIdentity = (
  sourceConfig: BusinessConfig | null | undefined
): { config: BusinessConfig | null | undefined; changed: boolean } => {
  // Tenant identity selects the data boundary; it is not company master data.
  // The configured companyInfo (local or ERP snapshot) is therefore preserved.
  return { config: sourceConfig, changed: false };
};

const normalizePaymentMethod = (method: unknown): string => {
  if (typeof method !== 'string') return '';
  return method
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
};

const toPositiveNumber = (value: unknown): number => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num;
};

const resolveKioskPaymentMethods = (config: BusinessConfig, customer?: Customer | null): KioskResolvedPaymentMethod[] => {
  const enabledMethods = (config.paymentMethods || [])
    .filter((method: PaymentMethodDefinition) => method.isEnabled)
    .filter((method: PaymentMethodDefinition) => !['CREDIT', 'ADVANCE', 'STORE_CREDIT'].includes(String(method.type || '').toUpperCase()));

  const fallbackMethods: KioskResolvedPaymentMethod[] = [
      { key: 'CARD', id: 'CARD', type: 'CARD', label: 'Tarjeta', iconName: 'CreditCard' },
      { key: 'CASH', id: 'CASH', type: 'CASH', label: 'Efectivo', iconName: 'Banknote' },
  ];

  const methods: KioskResolvedPaymentMethod[] = enabledMethods.length === 0 && allowsDefaultPaymentMethods(config)
    ? fallbackMethods
    : enabledMethods.map((method) => ({
      key: method.id || `${method.type}-${method.name}`,
      id: method.id || method.type,
      type: method.type,
      label: method.name,
      iconName: method.icon,
      integrationProvider: method.integration !== 'NONE' ? method.integration : undefined,
      integrationMode: method.integrationMode || 'MANUAL',
    }));

  const walletBalance = Number(customer?.wallet?.balance || 0);
  const hasWalletMethod = methods.some((method) => method.type === 'WALLET');
  if (customer?.wallet?.status === 'ACTIVE' && walletBalance > 0 && !hasWalletMethod && allowsDefaultPaymentMethods(config)) {
    methods.push({
      key: 'WALLET',
      id: 'WALLET',
      type: 'WALLET',
      label: 'Wallet / Saldo',
      iconName: 'Wallet',
    });
  }

  return methods;
};

const createKioskGatewayOrderNumber = (): string => {
  const base = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
  return base.slice(-8);
};

const roundMoney = (value: number): number =>
  Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;

type KioskCouponBenefit = {
  type: 'PERCENT' | 'FIXED_AMOUNT' | 'FREE_ITEM';
  value: number;
  description: string;
};

const normalizeKioskLookupValue = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase();

const digitsOnly = (value: unknown): string =>
  String(value ?? '').replace(/\D/g, '');

const resetPromotionLineForRepricing = (item: CartItem): CartItem => {
  if (item.adjustmentSource !== 'PROMOTION') return item;

  return {
    ...item,
    price: Number(item.originalPrice ?? item.price) || 0,
    originalPrice: undefined,
    discountAmount: undefined,
    discountRate: undefined,
    adjustmentSource: undefined,
    appliedPromotionId: undefined,
    appliedPromotionCode: undefined,
    appliedPromotionName: undefined,
  };
};

const resetPromotionCartForRepricing = (items: CartItem[]): CartItem[] =>
  items.map(resetPromotionLineForRepricing);

const resolveKioskActiveTariff = (
  config: BusinessConfig,
  terminalConfig?: BusinessConfig['terminals'][number]['config']
): Tariff | undefined => {
  const tariffId =
    terminalConfig?.pricing?.defaultTariffId ||
    (terminalConfig as any)?.defaultTariffId ||
    (config as any).defaultTariffId ||
    config.tariffs?.find((tariff) => tariff.active)?.id ||
    config.tariffs?.[0]?.id;

  return config.tariffs?.find((tariff) => tariff.id === tariffId)
    || config.tariffs?.find((tariff) => tariff.active)
    || config.tariffs?.[0];
};

const buildKioskPaymentTotals = (
  cart: CartItem[],
  config: BusinessConfig,
  terminalConfig?: BusinessConfig['terminals'][number]['config'],
  discountAmount = 0
) => {
  const activeTariff = resolveKioskActiveTariff(config, terminalConfig);
  const isTaxIncluded = activeTariff?.taxIncluded ?? true;
  const defaultTaxRate = Math.max(0, Number(config.taxRate) || 0.18);
  const subtotalBeforeDiscounts = roundMoney(cart.reduce((sum, item) => {
    const quantity = Math.abs(Number(item.quantity) || 0);
    const originalPrice = Number(item.originalPrice ?? item.price) || 0;
    return sum + originalPrice * quantity;
  }, 0));
  const grossLineTotal = roundMoney(cart.reduce((sum, item) => {
    const quantity = Math.abs(Number(item.quantity) || 0);
    const price = Number(item.price) || 0;
    return sum + Math.abs(price * quantity);
  }, 0));
  const safeDiscountAmount = roundMoney(Math.min(Math.max(0, discountAmount), grossLineTotal));
  const summary = calculateTransactionFiscalSummary(
    {
      items: cart,
      total: 0,
      discountAmount: safeDiscountAmount,
      isTaxIncluded,
      taxAmount: defaultTaxRate > 0 ? 1 : 0,
    } as Transaction,
    config,
    { terminalConfig }
  );

  return {
    subtotal: summary.subtotal,
    tax: summary.taxTotal,
    total: summary.total,
    subtotalBeforeDiscounts,
    discountAmount: safeDiscountAmount,
    totalSavings: roundMoney(Math.max(0, subtotalBeforeDiscounts - summary.total)),
    taxIncluded: isTaxIncluded,
    taxLabel: `ITBIS${isTaxIncluded ? ' incluido' : ''} (${roundMoney(defaultTaxRate * 100)}%)`,
  };
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <KioskSecurityProvider>
        <AppContent />
      </KioskSecurityProvider>
    </ThemeProvider>
  );
};

const AppContent: React.FC = () => {
  markRenderStart('APP_VIEW');
  const { clearSecurityState, setSupervisorPinValidator } = useKioskSecurityContext();
  // --- GLOBAL STATE ---
  const [activeTable, setActiveTable] = useState<Table | null>(null); // New state for selected table context
  const [activeTableEditLock, setActiveTableEditLock] = useState<ActiveTableEditLock | null>(null);
  const activeTableEditLockRef = useRef<ActiveTableEditLock | null>(null);
  const tableLockLifecycleVersionRef = useRef(0);
  const pendingTableLockReleasesRef = useRef<Map<string, PendingTableLockRelease>>(new Map());
  const lastTableInteractionAtRef = useRef(0);
  const closedRestaurantOrderIdsRef = useRef<Set<string>>(new Set());
  /* original code */
  const [currentView, setCurrentView] = useState<ViewState>(() => {
    const isVisorMode = isCustomerDisplaySurface();
    if (!isVisorMode) {
      recoverNativePrimaryDisplayUrl();
    }
    return isVisorMode ? 'VISOR' : 'LOGIN';
  });
  const [tableMapExitPending, setTableMapExitPending] = useState(false);
  const currentViewRef = useRef<ViewState>(currentView);
  const currentUserRef = useRef<User | null>(null);
  const [scanTargetTicketId, setScanTargetTicketId] = useState<string | null>(null); // NEW: Auto-select ticket from scan
  const [restoringHistory, setRestoringHistory] = useState(false);
  useLayoutEffect(() => markRenderEnd('APP_VIEW'));
  const [config, setConfig] = useState<BusinessConfig>(() => getInitialConfig('Supermercado' as any));
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLandscape, setIsLandscape] = useState(window.innerWidth > window.innerHeight);

  useEffect(() => {
    currentViewRef.current = currentView;
    if (currentView !== 'TABLE_MAP') setTableMapExitPending(false);
  }, [currentView]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    terminalRouter.setCurrentUser(currentUser);
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      persistActiveUserSession(currentUser, currentView);
    }
  }, [currentUser, currentView]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const pushGuardState = () => {
      window.history.pushState({ clicPosBackGuard: true }, '', window.location.href);
    };
    pushGuardState();

    const handleNativeBack = (event?: Event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const view = currentViewRef.current;
      const user = currentUserRef.current;
      pushGuardState();

      if (view === 'LOGIN' || view === 'ACTIVATION' || view === 'WIZARD' || view === 'TERMINAL_PAIRING') return;

      if (!user) {
        setCurrentView('LOGIN');
        return;
      }

      if (view === 'POS') {
        if ((config.vertical === 'RESTAURANT' || (config as any).usesTables) && Array.isArray(rooms) && rooms.length > 0) {
          setViewData(null);
          setCurrentView('TABLE_MAP');
        }
        return;
      }

      setViewData(null);
      setCurrentView('POS');
    };

    window.addEventListener('popstate', handleNativeBack);
    document.addEventListener('backbutton', handleNativeBack, false);
    return () => {
      window.removeEventListener('popstate', handleNativeBack);
      document.removeEventListener('backbutton', handleNativeBack, false);
    };
  }, [clearSecurityState]);

  useEffect(() => {
    const handleResize = () => setIsLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- SECURITY & DEVICE HANDSHAKE ---
  const [deviceId, setDeviceId] = useState<string>('');
  const [isDataLoaded, setIsDataLoaded] = useState<boolean>(false);
  const [initialConnError, setInitialConnError] = useState<string | null>(null);
  const [failedMasterIp, setFailedMasterIp] = useState<string>('');
  const initLoadStartedRef = useRef(false);
  const forceSyncHandledRef = useRef(false);
  const lockdownHandledRef = useRef(Boolean(readPersistedTerminalAuthorizationBlock()));
  const [reconnectionStatus, setReconnectionStatus] = useState<'idle' | 'searching' | 'connected' | 'failed'>('idle');
  const [terminalConfigRestartNotice, setTerminalConfigRestartNotice] = useState<TerminalConfigRestartNotice | null>(() => readTerminalConfigRestartNotice());
  const [posApkUpdate, setPosApkUpdate] = useState<PosApkUpdateAvailable | null>(null);
  const [syncDiagnostic, setSyncDiagnostic] = useState<SyncErrorDiagnostic | null>(() => {
    try {
      const stored = localStorage.getItem(SYNC_DIAGNOSTIC_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) as SyncErrorDiagnostic : null;
      if (isRecoverableStaleSyncDiagnostic(parsed)) {
        clearSyncErrorDiagnostic();
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  });
  const posApkUpdateCheckStartedRef = useRef(false);
  const settingsPreloadStartedRef = useRef(false);
  const [recoverySequencePrompt, setRecoverySequencePrompt] = useState<RecoverySequencePromptState | null>(null);
  const [recoverySequenceInput, setRecoverySequenceInput] = useState('');
  const [recoveryCloseScreen, setRecoveryCloseScreen] = useState<{input?: RecoveryCloseInput} | null>(null);
  useEffect(() => {
    const open = () => { if (isSyncFeatureEnabled('pending_operations_recovery')) setRecoveryCloseScreen({}); };
    window.addEventListener('pos:resume-recovered-close', open);
    return () => window.removeEventListener('pos:resume-recovered-close', open);
  }, []);

  const [users, setUsers] = useState<User[]>([]);

  // --- SECURITY BOOTSTRAP STATE ---
  const [isSecurityLoaded, setIsSecurityLoaded] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [terminalAuthorizationBlock, setTerminalAuthorizationBlock] = useState<TerminalAuthorizationBlock | null>(
    () => readPersistedTerminalAuthorizationBlock(),
  );
  const [terminalAuthorizationCheckState, setTerminalAuthorizationCheckState] = useState<TerminalAuthorizationCheckState>('idle');
  const terminalAuthorizationCheckInFlightRef = useRef(false);
  const inactivityTimerRef = useRef<number | null>(null);
  const inactivityIntervalRef = useRef<number | null>(null);
  const lastUserActivityAtRef = useRef<number>(Date.now());
  const inactivitySessionKeyRef = useRef<string>('');
  const syncInactivityTimerRef = useRef<number | null>(null);
  const lastSyncActivityAtRef = useRef<number>(Date.now());
  const appBackgroundSinceRef = useRef<number | null>(null);
  const isAppInBackgroundRef = useRef(false);
  const lifecycleSyncInFlightRef = useRef<Promise<boolean> | null>(null);
  const erpHeartbeatInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!terminalAuthorizationBlock) return;
    syncManager.stopAutoSync();
    backgroundSyncManager.stopForAuthorizationLoss();
    clearActiveUserSession();
    setCurrentUser(null);
    void realtimeNotificationService.disconnect('DISABLED');
  }, [terminalAuthorizationBlock]);

  // Security bootstrap logic moved to loadData

  useEffect(() => {
    const handleDiagnostic = (event: Event) => {
      const detail = (event as CustomEvent<SyncErrorDiagnostic | null>).detail;
      if (!detail || isRecoverableStaleSyncDiagnostic(detail)) {
        clearSyncErrorDiagnostic();
        setSyncDiagnostic(null);
        return;
      }
      setSyncDiagnostic(detail);
    };

    window.addEventListener(SYNC_DIAGNOSTIC_EVENT, handleDiagnostic as EventListener);
    return () => window.removeEventListener(SYNC_DIAGNOSTIC_EVENT, handleDiagnostic as EventListener);
  }, []);

  useEffect(() => {
    if (!isDataLoaded || !isSecurityLoaded || posApkUpdateCheckStartedRef.current) return;
    posApkUpdateCheckStartedRef.current = true;

    void checkForPosApkUpdate({ config, timeoutMs: 3500 })
      .then((result) => {
        if (!result) {
          console.info('[posApkUpdate] Validación automática omitida: SKIPPED');
          return;
        }
        if (result.hasUpdate) {
          setPosApkUpdate(result);
          return;
        }
        console.info(
          '[posApkUpdate] Validación automática completada sin actualización:',
          'reason' in result ? result.reason : 'NOT_NEWER',
        );
      })
      .catch((error) => {
        console.info('[posApkUpdate] Validación omitida sin bloquear operación:', error);
      });
  }, [config, isDataLoaded, isSecurityLoaded]);

  useEffect(() => {
    if (!isNativeAndroidRuntime()) {
      return;
    }

    let wakeLock: any = null;
    let wakeLockRequested = false;

    const requestWakeLock = async () => {
      const runtimeNavigator = navigator as any;
      if (!runtimeNavigator?.wakeLock?.request || document.visibilityState !== 'visible') {
        return;
      }

      try {
        wakeLock = await runtimeNavigator.wakeLock.request('screen');
        wakeLockRequested = true;
        wakeLock?.addEventListener?.('release', () => {
          wakeLock = null;
        });
      } catch (error) {
        if (!wakeLockRequested) {
          console.info('[Android] Screen Wake Lock no disponible; usando FLAG_KEEP_SCREEN_ON nativo.', error);
          wakeLockRequested = true;
        }
      }
    };

    const installAndroidPrinterShim = (): boolean => {
      const runtimeWindow = window as any;
      if (!runtimeWindow.AndroidPrinter) {
        return Boolean(runtimeWindow.ClicPOSNativePrinter);
      }

      const parseResult = (value: any) => {
        if (!value) {
          return { status: 'error', success: false, printed: false, message: 'Empty native response' };
        }

        if (typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch (error) {
            return { status: 'error', success: false, printed: false, message: String(value) };
          }
        }

        return value;
      };

      let asyncRequestSequence = 0;
      const asyncMethods = new Set([
        'printEscPos',
        'printEscpos',
        'printRaw',
        'printHtml',
        'print',
        'startMasterServer',
        'updateMasterServerConfig',
        'stopMasterServer',
        'getMasterServerStatus',
        'getMasterRestaurantState',
        'getMasterRestaurantRevision',
        'acquireMasterTableLock',
        'releaseMasterTableLock',
      ]);
      const coalescedAsyncMethods = new Set([
        'startMasterServer',
        'updateMasterServerConfig',
        'stopMasterServer',
        'getMasterServerStatus',
        'getMasterRestaurantState',
        'getMasterRestaurantRevision',
      ]);
      const asyncInFlight: Map<string, Promise<unknown>> = runtimeWindow.__CLIC_NATIVE_ASYNC_IN_FLIGHT__
        || new Map<string, Promise<unknown>>();
      runtimeWindow.__CLIC_NATIVE_ASYNC_IN_FLIGHT__ = asyncInFlight;
      const call = (method: string, payload?: unknown) => {
        if (!runtimeWindow.AndroidPrinter || typeof runtimeWindow.AndroidPrinter[method] !== 'function') {
          return Promise.resolve({ status: 'error', success: false, printed: false, message: `Missing native method: ${method}` });
        }

        if (asyncMethods.has(method) && typeof runtimeWindow.AndroidPrinter.callAsync === 'function') {
          const existing = coalescedAsyncMethods.has(method) ? asyncInFlight.get(method) : undefined;
          if (existing) return existing;
          const requestID = `native-${Date.now()}-${++asyncRequestSequence}`;
          const pending = new Promise((resolve) => {
            const eventName = 'clic:native-async-result';
            let timeoutID: number | undefined;
            const onResult = (event: Event) => {
              const detail = (event as CustomEvent<{ requestID?: string; raw?: unknown }>).detail || {};
              if (detail.requestID !== requestID) return;
              window.removeEventListener(eventName, onResult);
              if (timeoutID) window.clearTimeout(timeoutID);
              resolve(parseResult(detail.raw));
            };
            window.addEventListener(eventName, onResult);
            timeoutID = window.setTimeout(() => {
              window.removeEventListener(eventName, onResult);
              resolve({ status: 'error', success: false, message: `Native async call timeout: ${method}` });
            }, 30000);
            runtimeWindow.AndroidPrinter.callAsync(requestID, method, JSON.stringify(payload || {}));
          });
          if (coalescedAsyncMethods.has(method)) {
            asyncInFlight.set(method, pending);
            void pending.finally(() => {
              if (asyncInFlight.get(method) === pending) asyncInFlight.delete(method);
            });
          }
          return pending;
        }

        const raw = runtimeWindow.AndroidPrinter[method](JSON.stringify(payload || {}));
        return Promise.resolve(parseResult(raw));
      };

      runtimeWindow.ClicPOSNativePrinter = {
        ...(runtimeWindow.ClicPOSNativePrinter || {}),
        platform: 'android',
        validateDgiiRnc: (payload: unknown) => call('validateDgiiRnc', payload),
        printEscPos: (payload: unknown) => call('printEscPos', payload),
        printEscpos: (payload: unknown) => call('printEscpos', payload),
        printRaw: (payload: unknown) => call('printRaw', payload),
        printHtml: (payload: unknown) => call('printHtml', payload),
        print: (payload: unknown) => call('print', payload),
        discoverPrinters: (payload: unknown) => call('discoverPrinters', payload),
        scanPrinters: (payload: unknown) => call('scanPrinters', payload),
        listPrinters: (payload: unknown) => call('listPrinters', payload),
        pairPrinter: (payload: unknown) => call('pairPrinter', payload),
        connectPrinter: (payload: unknown) => call('connectPrinter', payload),
        bindPrinter: (payload: unknown) => call('bindPrinter', payload),
        testPrinter: (payload: unknown) => call('testPrinter', payload),
        testPrinterConnection: (payload: unknown) => call('testPrinterConnection', payload),
        getPrinterStatus: (payload: unknown) => call('getPrinterStatus', payload),
        checkStatus: (payload: unknown) => call('checkStatus', payload),
        startKdsServer: (payload: unknown) => call('startKdsServer', payload),
        stopKdsServer: (payload: unknown) => call('stopKdsServer', payload),
        getKdsServerStatus: (payload: unknown) => call('getKdsServerStatus', payload),
        startMasterServer: (payload: unknown) => call('startMasterServer', payload),
        updateMasterServerConfig: (payload: unknown) => call('updateMasterServerConfig', payload),
        stopMasterServer: (payload: unknown) => call('stopMasterServer', payload),
        getMasterServerStatus: (payload: unknown) => call('getMasterServerStatus', payload),
        getMasterRestaurantState: (payload: unknown) => call('getMasterRestaurantState', payload),
        getMasterRestaurantRevision: (payload: unknown) => call('getMasterRestaurantRevision', payload),
        acquireMasterTableLock: (payload: unknown) => call('acquireMasterTableLock', payload),
        releaseMasterTableLock: (payload: unknown) => call('releaseMasterTableLock', payload),
        getDeviceProfile: () => Promise.resolve(parseResult(runtimeWindow.AndroidPrinter.getDeviceProfile?.())),
        getDeviceInfo: () => Promise.resolve(parseResult(runtimeWindow.AndroidPrinter.getDeviceInfo?.()))
      };

      return true;
    };

    const applyInputRuntimeHints = (target: EventTarget | null) => {
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        return;
      }

      target.setAttribute('autocomplete', 'off');
      target.setAttribute('autocorrect', 'off');
      target.setAttribute('autocapitalize', 'off');
      target.spellcheck = false;
    };

    const seedExistingInputs = () => {
      document.querySelectorAll('input, textarea').forEach((node) => {
        applyInputRuntimeHints(node);
      });
    };

    const handleFocusIn = (event: FocusEvent) => {
      applyInputRuntimeHints(event.target);
    };

    const handleVisibilityChange = () => {
      if (!document.hidden && !wakeLock) {
        void requestWakeLock();
      }
    };

    void requestWakeLock();
    installAndroidPrinterShim();
    const printerShimPoll = window.setInterval(() => {
      if (installAndroidPrinterShim()) {
        window.clearInterval(printerShimPoll);
      }
    }, 1000);

    seedExistingInputs();
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(printerShimPoll);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      wakeLock?.release?.().catch?.(() => undefined);
    };
  }, []);

  useEffect(() => {
    const handleReconnection = (e: CustomEvent) => {
      setReconnectionStatus(e.detail.status);
      if (e.detail.status === 'connected') {
        setTimeout(() => setReconnectionStatus('idle'), 3000);
      }
    };
    window.addEventListener('sync:reconnecting', handleReconnection as any);
    return () => window.removeEventListener('sync:reconnecting', handleReconnection as any);
  }, []);

  useEffect(() => {
    const handleTerminalConfigRestartRequired = (event: Event) => {
      const incomingNotice = (event as CustomEvent<TerminalConfigRestartNotice>)?.detail || readTerminalConfigRestartNotice();
      if (!incomingNotice) return;
      setTerminalConfigRestartNotice(incomingNotice);
    };

    window.addEventListener('terminalConfigRestartRequired', handleTerminalConfigRestartRequired as EventListener);
    return () => {
      window.removeEventListener('terminalConfigRestartRequired', handleTerminalConfigRestartRequired as EventListener);
    };
  }, []);

  useEffect(() => {
    const handleTerminalConfigSyncRequested = async (event: Event) => {
      if (isPosOnlyCloudStagingTarget()) {
        console.warn('[CLOUD STAGING] terminalConfigSyncRequested ignored; local catalog remains authoritative.');
        return;
      }

      try {
        const detail = (event as CustomEvent<TerminalConfigSyncRequestDetail>)?.detail || null;
        const refreshedConfig = await syncManager.refreshTerminalResolvedConfig(
          undefined,
          {
            ...buildTerminalConfigRefreshRequest(detail),
            deferDuringSale: true,
          },
        );
        if (refreshedConfig && !Array.isArray(refreshedConfig) && refreshedConfig.terminals) {
          setConfig(refreshedConfig);
        }

        const refreshedProducts = await db.get('products') as Product[];
        if (Array.isArray(refreshedProducts)) {
          setProducts(refreshedProducts);
        }

        const refreshedUsers = await db.get('users') as User[];
        if (Array.isArray(refreshedUsers)) {
          setUsers(visiblePosUsersForRuntime(refreshedUsers));
        }

        const refreshedRoles = await db.get('roles') as RoleDefinition[];
        if (Array.isArray(refreshedRoles)) {
          setRoles(refreshedRoles);
        }
      } catch (error) {
        console.warn('⚠️ Failed to apply terminal config refresh requested by ERP outbox:', error);
      }
    };

    window.addEventListener('terminalConfigSyncRequested', handleTerminalConfigSyncRequested as EventListener);
    return () => {
      window.removeEventListener('terminalConfigSyncRequested', handleTerminalConfigSyncRequested as EventListener);
    };
  }, []);

  useEffect(() => {
    let fullBootstrapInFlight = false;

    const handleErpFullBootstrapRequired = async () => {
      if (fullBootstrapInFlight) return;
      fullBootstrapInFlight = true;

      try {
        await syncManager.fullPull();

        const refreshedConfigRaw = await db.get('config') as unknown;
        if (refreshedConfigRaw && !Array.isArray(refreshedConfigRaw) && (refreshedConfigRaw as BusinessConfig).terminals) {
          setConfig(refreshedConfigRaw as BusinessConfig);
        }

        const refreshedProducts = await db.get('products') as Product[];
        if (Array.isArray(refreshedProducts)) {
          setProducts(refreshedProducts);
        }

        const refreshedUsers = await db.get('users') as User[];
        if (Array.isArray(refreshedUsers)) {
          setUsers(visiblePosUsersForRuntime(refreshedUsers));
        }

        const refreshedRoles = await db.get('roles') as RoleDefinition[];
        if (Array.isArray(refreshedRoles)) {
          setRoles(refreshedRoles);
        }

        localStorage.removeItem('clic_erp_sync_full_bootstrap_required');
        localStorage.removeItem('clic_erp_sync_full_bootstrap_reason');
      } catch (error) {
        console.warn('⚠️ Failed to apply ERP full bootstrap requested by auth:', error);
      } finally {
        fullBootstrapInFlight = false;
      }
    };

    window.addEventListener(ERP_FULL_BOOTSTRAP_REQUIRED_EVENT, handleErpFullBootstrapRequired as EventListener);
    return () => {
      window.removeEventListener(ERP_FULL_BOOTSTRAP_REQUIRED_EVENT, handleErpFullBootstrapRequired as EventListener);
    };
  }, []);

  const dismissTerminalConfigRestartNotice = useCallback(() => {
    localStorage.removeItem(TERMINAL_CONFIG_RESTART_NOTICE_KEY);
    setTerminalConfigRestartNotice(null);
  }, []);

  const restartForTerminalConfigUpdate = useCallback(() => {
    dismissTerminalConfigRestartNotice();
    window.location.reload();
  }, [dismissTerminalConfigRestartNotice]);

  const syncConfigToLocalServer = useCallback(async (
    nextConfig: BusinessConfig,
    options?: { surfaceErrors?: boolean }
  ) => {
    const serverUrl = buildConfigSyncUrl();
    const shouldSurfaceSyncErrors = options?.surfaceErrors ?? !isNativeAndroidRuntime();

    if (!serverUrl) {
      console.log('ℹ️ Skipping remote config sync: native standalone runtime without remote master.');
      return;
    }

    console.log(`Attempting to sync to: ${serverUrl}`);

    try {
      const res = await fetch(serverUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextConfig)
      });

      if (res.ok) {
        console.log('Sync success: Config pushed to server.');
      } else {
        const errorText = await res.text();
        console.error('Sync failed:', res.status, res.statusText, errorText);
        if (shouldSurfaceSyncErrors) {
          alert(`Error al sincronizar: El servidor respondió ${res.status}\nDetalle: ${errorText}`);
        }
      }
    } catch (e) {
      console.warn('Could not sync config to local server', e);
      if (shouldSurfaceSyncErrors) {
        alert(`Error de conexión con ${serverUrl}. Asegúrate de que 'npm run server' esté corriendo.`);
      }
    }
  }, []);

  const resolveBlockedTerminalLabel = React.useCallback((candidateTerminalId?: string | null) => {
    const normalizedId = String(candidateTerminalId || '').trim();
    const matchedTerminal = (config.terminals || []).find((terminal) => {
      const ids = [terminal.id, terminal.config?.erpTerminalId].map((value) => String(value || '').trim());
      return normalizedId ? ids.includes(normalizedId) : false;
    });
    const candidates = [
      matchedTerminal?.config?.stationNumber,
      matchedTerminal?.config?.terminalName,
      localStorage.getItem('clic_erp_sync_terminal_code'),
      localStorage.getItem('clic_erp_sync_terminal_name'),
      normalizedId,
    ].map((value) => String(value || '').trim()).filter(Boolean);
    const readable = candidates.find((value) => !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value));
    return readable || 'Caja vinculada';
  }, [config.terminals]);

  const triggerLockdown = React.useCallback((message: string, terminalBlock?: TerminalAuthorizationBlock | null) => {
    if (terminalBlock) {
      persistTerminalAuthorizationBlock(terminalBlock);
      markSyncDeviceTokenInvalid('DEVICE_SUPERSEDED');
      clearStoredSyncToken();
      localStorage.setItem(TERMINAL_BINDING_STATUS_KEY, 'NEEDS_REAUTH');
      localStorage.setItem('clic_sync_auth_status', 'NEEDS_REAUTH');
      localStorage.setItem('clic_sync_last_auth_error', 'DEVICE_SUPERSEDED');
      saveTerminalCredentialsSync({
        authStatus: 'NEEDS_REAUTH',
        lastAuthError: 'DEVICE_SUPERSEDED',
      });
    }
    if (lockdownHandledRef.current) return;
    lockdownHandledRef.current = true;
    syncManager.stopAutoSync();
    backgroundSyncManager.stopForAuthorizationLoss();
    setTerminalAuthorizationBlock(terminalBlock || null);
    setLicenseError(message);
    setIsDataLoaded(true);
    setIsSecurityLoaded(true);
    clearSyncErrorDiagnostic();
    setSyncDiagnostic(null);
    clearActiveUserSession();
    setCurrentUser(null);
    Object.keys(localStorage)
      .filter((key) => key.startsWith('sb-'))
      .forEach((key) => localStorage.removeItem(key));
    clearPersistedSupabaseSession();
    void realtimeNotificationService.disconnect('DISABLED');
    void supabase.auth.signOut().catch(error => {
      console.warn('Failed to clear Supabase session during lockdown', error);
    });
  }, []);

  const lockSupersededTerminal = React.useCallback((
    message: string,
    options?: { terminalId?: string | null; requestDeviceId?: string | null; payload?: unknown },
  ) => {
    const payload = options?.payload && typeof options.payload === 'object'
      ? options.payload as Record<string, any>
      : {};
    const terminalId = options?.terminalId || payload.terminal_id || payload.erp_terminal_id || null;
    const requestDeviceId = String(
      options?.requestDeviceId
      || payload.request_device_id
      || payload.requestDeviceId
      || deviceId
      || ''
    ).trim() || null;
    const authorizedDeviceId = String(
      payload.authorized_device_id
      || payload.authorizedDeviceId
      || payload.current_device_id
      || payload.currentDeviceId
      || ''
    ).trim() || null;
    const terminalLabel = resolveBlockedTerminalLabel(terminalId);
    triggerLockdown(message, {
      terminalId,
      terminalLabel,
      requestDeviceId,
      authorizedDeviceId,
      message: `La caja ${terminalLabel} está activa en otro equipo. La autorización debe completarse desde Cloud Admin; este dispositivo no puede autorizarse por sí mismo.`,
    });
  }, [deviceId, resolveBlockedTerminalLabel, triggerLockdown]);

  const completeErpDeviceReauthorization = React.useCallback(async (candidateDeviceId?: string | null): Promise<boolean> => {
    const normalizedDeviceId = String(
      deviceId
      || candidateDeviceId
      || localStorage.getItem('pos_device_id')
      || localStorage.getItem('CLIC_POS_DEVICE_ID')
      || ''
    ).trim().toUpperCase();
    if (!normalizedDeviceId || isPosOnlyCloudStagingTarget()) return false;

    try {
      const storedBinding = getStoredErpSyncBinding();
      const blockedTerminalId = normalizeCanonicalErpTerminalId(
        terminalAuthorizationBlock?.terminalId
        || storedBinding.terminalId
        || storedBinding.terminalUuid
      );
      if (!blockedTerminalId) return false;

      const bootstrap = await bootstrapErpSyncLifecycle(normalizedDeviceId, blockedTerminalId);
      const payload = (bootstrap || {}) as any;
      const terminal = payload.terminal || payload.terminal_config?.terminal || payload.terminalConfig?.terminal || {};
      const isAuthorized = isDeviceExplicitlyAuthorizedByBootstrap(payload, normalizedDeviceId);
      if (!isAuthorized) return false;

      const canonicalTerminalId = normalizeCanonicalErpTerminalId(
        terminal.id
        || payload.terminal_id
        || payload.erp_terminal_id
        || blockedTerminalId
      );
      if (!canonicalTerminalId) return false;

      const registered = await registerErpSyncTerminal({
        deviceId: normalizedDeviceId,
        terminalId: canonicalTerminalId,
        localTerminalId: storedBinding.localTerminalId,
        terminalName: storedBinding.terminalName,
        companyId: storedBinding.companyId,
        storeId: storedBinding.storeId,
      });
      const refreshedCredentials = await readTerminalCredentials();
      if (!registered || (!refreshedCredentials.deviceToken && !refreshedCredentials.syncToken)) {
        console.warn('[AUTHORIZATION_GUARD] register completed without fresh runtime credentials', {
          endpoint: '/api/sync/terminals/register',
          terminalId: canonicalTerminalId,
          deviceId: normalizedDeviceId,
        });
        return false;
      }

      markDeviceReauthorized(normalizedDeviceId);
      console.info('pos_reauthorization_completed', {
        deviceId: normalizedDeviceId,
        terminalId: canonicalTerminalId,
        source: 'ERP_BOOTSTRAP_CHECK_THEN_REGISTER',
      });
      return true;
    } catch (error) {
      console.warn('[AUTHORIZATION_GUARD] reauthorization remains pending', {
        endpoint: (error as any)?.code === 'SETUP_AUTH_REQUIRED'
          ? '/api/setup/bind-terminal'
          : '/api/sync/bootstrap/check',
        status: (error as any)?.status || (error as any)?.httpStatus || null,
        code: (error as any)?.code || null,
      });
      return false;
    }
  }, [deviceId, terminalAuthorizationBlock]);

  const retryTerminalAuthorization = React.useCallback(async (): Promise<boolean> => {
    if (terminalAuthorizationCheckInFlightRef.current || !terminalAuthorizationBlock) return false;

    terminalAuthorizationCheckInFlightRef.current = true;
    setTerminalAuthorizationCheckState('checking');
    try {
      const authorized = await completeErpDeviceReauthorization(deviceId);
      if (authorized) {
        lockdownHandledRef.current = false;
        setLicenseError(null);
        setTerminalAuthorizationBlock(null);
        clearSyncErrorDiagnostic();
        setSyncDiagnostic(null);
        setTerminalBindingDiagnosticStatus('BOUND');
        setCatalogDiagnosticStatus('SYNCED');
        setSalesPushDiagnosticStatus('ENABLED');
        setSyncAuthDiagnosticStatus('AUTHENTICATED');
        clearPersistedTerminalAuthorizationBlock();
        localStorage.setItem(TERMINAL_BINDING_STATUS_KEY, 'BOUND');
        localStorage.setItem('clic_sync_auth_status', 'AUTHENTICATED');
        localStorage.removeItem('clic_sync_last_auth_error');
        localStorage.removeItem('clic_sync_last_reauth_attempt_at');
        window.location.reload();
        return true;
      }
      setTerminalAuthorizationCheckState('idle');
      return false;
    } finally {
      terminalAuthorizationCheckInFlightRef.current = false;
    }
  }, [completeErpDeviceReauthorization, deviceId, terminalAuthorizationBlock]);

  useEffect(() => {
    const handleDeviceRevoked = (event: Event) => {
      const detail = (event as CustomEvent<DeviceRevocationDetail>).detail;
      const revokedDeviceId = detail?.previousDeviceId || (detail as any)?.deviceId || deviceId;
      lockSupersededTerminal(
        detail?.message || DEVICE_SUPERSEDED_MESSAGE,
        { terminalId: detail?.terminalId || null, requestDeviceId: revokedDeviceId, payload: detail?.payload },
      );
    };

    window.addEventListener(DEVICE_REVOKED_EVENT, handleDeviceRevoked as EventListener);
    return () => window.removeEventListener(DEVICE_REVOKED_EVENT, handleDeviceRevoked as EventListener);
  }, [deviceId, lockSupersededTerminal]);

  useEffect(() => {
    if (!isTerminalAuthorizationLossDiagnostic(syncDiagnostic)) {
      setTerminalAuthorizationCheckState('idle');
      return;
    }
    const affectedTerminalId = syncDiagnostic?.resolvedTarget?.terminalId || syncDiagnostic?.terminalId || null;
    lockSupersededTerminal(
      DEVICE_SUPERSEDED_MESSAGE,
      { terminalId: affectedTerminalId, requestDeviceId: deviceId, payload: syncDiagnostic },
    );
    setTerminalAuthorizationCheckState('idle');
  }, [deviceId, lockSupersededTerminal, syncDiagnostic]);

  useEffect(() => {
    if (!terminalAuthorizationBlock) return;
    let disposed = false;
    let attempt = 0;
    let timerId: number | null = null;

    const schedule = () => {
      const delayMs = Math.min(5000 * (2 ** attempt), 60000);
      timerId = window.setTimeout(async () => {
        const completed = await retryTerminalAuthorization();
        if (disposed || completed) return;
        attempt += 1;
        schedule();
      }, delayMs);
    };

    schedule();
    return () => {
      disposed = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [retryTerminalAuthorization, terminalAuthorizationBlock]);

  // --- REALTIME KILL SWITCH (FALLBACK: SMART POLLING) ---
  useEffect(() => {
    if (!isDataLoaded) return;

    const persistedTenantId = (localStorage.getItem('clic_tenant_id') || '').trim();
    const persistedTenantEmail = (localStorage.getItem('clic_tenant_email') || '').trim().toLowerCase();
    const hasActivationIdentity = Boolean(persistedTenantId && persistedTenantEmail);
    if (!hasActivationIdentity) return;

    let disposed = false;
    let timeoutId: number | null = null;

    const runLicenseCheck = async (fallbackMessage: string) => {
      try {
        const res = await checkLicenseStatus(persistedTenantId, deviceId);
        if (disposed) return;

        if (res.tenantId && res.tenantId !== persistedTenantId) {
          localStorage.setItem('clic_tenant_id', res.tenantId);
        }

        if (!res.isValid && res.cloudReachable !== false) {
          triggerLockdown(res.reason || fallbackMessage);
        } else if (!res.isValid) {
          console.warn('[LICENSE] Validation unavailable during polling; preserving recoverable POS access.', {
            tenantId: persistedTenantId,
            lastCloudError: res.lastCloudError || null,
          });
        }
      } catch {
        // Offline tolerance: avoid false positives on transient connectivity issues.
      }
    };

    void runLicenseCheck('Servicio Suspendido.');

    const scheduleNextLicenseCheck = () => {
      if (disposed) return;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }

      // Jitter: evita que múltiples terminales disparen el chequeo al mismo milisegundo.
      timeoutId = window.setTimeout(async () => {
        await runLicenseCheck('Servicio Suspendido por el Administrador.');
        scheduleNextLicenseCheck();
      }, LICENSE_REFRESH_BASE_MS + getTimerJitterMs());
    };

    scheduleNextLicenseCheck();

    return () => {
      disposed = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isDataLoaded, deviceId, triggerLockdown]);

  // --- AUTO-RETRY ON BOOT ERROR ---
  useEffect(() => {
    if (initialConnError || bootstrapError) {
      const timer = setTimeout(() => {
        window.location.reload();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [initialConnError, bootstrapError]);

  // Helper: Get current terminal configuration
  const getCurrentTerminal = React.useCallback(() => {
    const terminals = config.terminals || [];
    const activeTerminalId =
      localStorage.getItem('active_terminal_id')
      || localStorage.getItem('CLIC_POS_TERMINAL_ID')
      || '';

    const bindingTerminalId = localStorage.getItem('clic_erp_sync_terminal_id') || '';
    const bindingLocalTerminalId = localStorage.getItem('clic_erp_sync_local_terminal_id') || '';

    const byBinding = resolvePreferredTerminalForDevice(terminals, deviceId, {
      activeTerminalId,
      bindingTerminalId,
      bindingLocalTerminalId,
    });
    if (byBinding) return byBinding;

    const byErpAlias =
      resolveErpTerminalAliasMatch(terminals, activeTerminalId)
      || resolveErpTerminalAliasMatch(terminals, bindingLocalTerminalId)
      || resolveErpTerminalAliasMatch(terminals, bindingTerminalId);
    if (byErpAlias) return byErpAlias;

    const byActiveId = activeTerminalId
      ? terminals.find((terminal) =>
          terminal.id === activeTerminalId
          || terminal.config?.erpTerminalId === activeTerminalId
          || terminal.config?.erpBinding?.terminalId === activeTerminalId
        )
      : null;
    if (byActiveId) return byActiveId;

    if (!activeTerminalId) return undefined;

    return terminals.find((terminal) =>
      terminal.id === activeTerminalId
      || terminal.config?.erpTerminalId === activeTerminalId
      || terminal.config?.erpBinding?.terminalId === activeTerminalId
    );
  }, [config.terminals, deviceId]);

  useEffect(() => {
    const activeTerminalId = localStorage.getItem('active_terminal_id');
    const bindingTerminalId = localStorage.getItem('clic_erp_sync_terminal_id');
    const bindingLocalTerminalId = localStorage.getItem('clic_erp_sync_local_terminal_id');
    const sanitized = clearDuplicateDeviceAssignments(config, deviceId, {
      activeTerminalId,
      bindingTerminalId,
      bindingLocalTerminalId,
    });
    const nextConfig = sanitized.config;

    const aliasPreferredTerminal =
      resolveErpTerminalAliasMatch(nextConfig.terminals || [], activeTerminalId)
      || resolveErpTerminalAliasMatch(nextConfig.terminals || [], bindingLocalTerminalId)
      || resolveErpTerminalAliasMatch(nextConfig.terminals || [], bindingTerminalId);
    const preferredTerminal = aliasPreferredTerminal || (
      sanitized.preferredTerminalId
        ? nextConfig.terminals?.find((terminal) => terminal.id === sanitized.preferredTerminalId)
        : null
    );
    const preferredTerminalId = preferredTerminal?.id || sanitized.preferredTerminalId || null;
    const preferredErpTerminalId =
      resolveTerminalErpIdentity(preferredTerminal);
    const preferredLocalTerminalId = String(
      preferredTerminal?.config?.stationNumber
      || preferredTerminal?.config?.erpBinding?.stationNumber
      || (!looksLikeUuid(preferredTerminal?.config?.terminalName) ? preferredTerminal?.config?.terminalName : '')
      || (!looksLikeUuid(preferredTerminal?.name) ? preferredTerminal?.name : '')
      || preferredTerminalId
      || ''
    ).trim();
    const preferredTenantId = String(
      preferredTerminal?.config?.erpBinding?.tenantId
      || preferredTerminal?.config?.erpSnapshot?.tenant_id
      || nextConfig.metadata?.tenantId
      || localStorage.getItem('active_tenant_id')
      || localStorage.getItem('clic_tenant_id')
      || ''
    ).trim();
    const storedErpTerminalId = String(localStorage.getItem('clic_erp_sync_terminal_id') || '').trim();
    const storedLocalTerminalId = String(localStorage.getItem('clic_erp_sync_local_terminal_id') || '').trim();
    const storedErpTenantId = String(localStorage.getItem('clic_erp_sync_tenant_id') || '').trim();
    const shouldRepairActiveTerminal = Boolean(preferredTerminalId && preferredTerminalId !== activeTerminalId);
    const shouldRepairErpBinding = Boolean(preferredErpTerminalId && preferredErpTerminalId !== storedErpTerminalId);
    const shouldRepairLocalTerminal = Boolean(preferredLocalTerminalId && preferredLocalTerminalId !== storedLocalTerminalId);
    const shouldRepairErpTenant = Boolean(preferredTenantId && preferredTenantId !== storedErpTenantId);

    if (!sanitized.changed && !shouldRepairActiveTerminal && !shouldRepairErpBinding && !shouldRepairLocalTerminal && !shouldRepairErpTenant) return;

    setConfig(nextConfig);
    if (preferredTerminalId) {
      localStorage.setItem('active_terminal_id', preferredTerminalId);
      localStorage.setItem('CLIC_POS_TERMINAL_ID', preferredTerminalId);
    }
    if (shouldRepairErpBinding) {
      localStorage.setItem('clic_erp_sync_terminal_id', preferredErpTerminalId);
    }
    if (shouldRepairLocalTerminal) {
      localStorage.setItem('clic_erp_sync_local_terminal_id', preferredLocalTerminalId);
      localStorage.setItem('clic_erp_sync_terminal_code', preferredLocalTerminalId);
    }
    if (shouldRepairErpTenant) {
      localStorage.setItem('clic_erp_sync_tenant_id', preferredTenantId);
      localStorage.setItem('active_tenant_id', preferredTenantId);
      localStorage.setItem('clic_tenant_id', preferredTenantId);
    }
    if (shouldRepairErpBinding || shouldRepairLocalTerminal || shouldRepairErpTenant) {
      try {
        const existingProfile = loadSyncProfile();
        saveSyncProfileFromContract({
          ...existingProfile,
          erpTerminalId: preferredErpTerminalId || existingProfile.erpTerminalId,
          localTerminalId: preferredLocalTerminalId || existingProfile.localTerminalId,
          erpTenantId: preferredTenantId || existingProfile.erpTenantId || localStorage.getItem('clic_erp_sync_tenant_id') || localStorage.getItem('active_tenant_id') || undefined,
          cloudTenantId: preferredTenantId || existingProfile.cloudTenantId || existingProfile.erpTenantId,
        }, existingProfile.contractSource || 'ERP_REGISTER', {
          erpTerminalId: preferredErpTerminalId || existingProfile.erpTerminalId,
          localTerminalId: preferredLocalTerminalId || undefined,
        });
        saveTerminalCredentialsSync({
          terminalId: preferredErpTerminalId || null,
          erpTerminalId: preferredErpTerminalId || null,
          terminalCode: preferredLocalTerminalId || null,
          terminalName: resolveFriendlyTerminalName(preferredTerminal),
          tenantId: preferredTenantId || null,
          erpTenantId: preferredTenantId || null,
        });
      } catch (error) {
        console.warn('Failed to repair ERP terminal sync profile from selected terminal identity', error);
      }
    }
    void db.save('config', nextConfig).catch((error) => {
      console.warn('Failed to persist duplicate terminal assignment cleanup', error);
    });
  }, [config, deviceId]);

  // Helper: Get current device role (raw value, no fallback)
  const getCurrentDeviceRoleRaw = React.useCallback((): DeviceRole | undefined => {
    const terminal = getCurrentTerminal();
    return resolveDeviceRoleValue(
      [
        terminal,
        terminal?.config,
        terminal?.terminalType,
        terminal?.terminal_type,
        terminal?.deviceType,
        terminal?.device_type,
        terminal?.config?.erpBinding,
        terminal?.config?.deviceRole,
        terminal?.config?.role,
        terminal?.config?.roleCode,
        terminal?.config?.role_code,
        terminal?.config?.deviceRoleCode,
        terminal?.config?.device_role_code,
        terminal?.config?.deviceRole?.role_code,
        terminal?.config?.deviceRole?.device_role_code,
        terminal?.config?.terminalType,
        terminal?.config?.terminal_type,
        terminal?.config?.deviceType,
        terminal?.config?.device_type,
      ],
      undefined
    );
  }, [getCurrentTerminal]);

  const getCurrentDeviceRole = React.useCallback((): DeviceRole => {
    return getCurrentDeviceRoleRaw() ?? DeviceRole.STANDARD_POS;
  }, [getCurrentDeviceRoleRaw]);

  useEffect(() => {
    let disposed = false;
    const ensureKdsServer = () => {
      if (disposed || getCurrentDeviceRoleRaw() !== DeviceRole.KITCHEN_DISPLAY) return;
      const nativeBridge = (window as any).ClicPOSNativePrinter;
      if (typeof nativeBridge?.startKdsServer !== 'function') return;

      Promise.resolve(nativeBridge.startKdsServer({ port: 8001 }))
        .then((status: any) => {
          if (!disposed) {
            console.info('[KDS] Native server ensured', {
              running: Boolean(status?.running || status?.success),
              port: status?.port || 8001,
              localIp: status?.localIp || null,
            });
          }
        })
        .catch((error: unknown) => console.warn('[KDS] Could not ensure native server:', error));
    };

    const handleResume = () => {
      if (!document.hidden) ensureKdsServer();
    };
    ensureKdsServer();
    const watchdog = window.setInterval(ensureKdsServer, 30000);
    window.addEventListener('online', ensureKdsServer);
    document.addEventListener('visibilitychange', handleResume);
    const appPlugin = (window as any).Capacitor?.Plugins?.App;
    const resumeListener = appPlugin?.addListener?.('resume', ensureKdsServer);
    const stateListener = appPlugin?.addListener?.('appStateChange', (state: { isActive?: boolean }) => {
      if (state?.isActive) ensureKdsServer();
    });

    return () => {
      disposed = true;
      window.clearInterval(watchdog);
      window.removeEventListener('online', ensureKdsServer);
      document.removeEventListener('visibilitychange', handleResume);
      resumeListener?.remove?.();
      stateListener?.remove?.();
    };
  }, [getCurrentDeviceRoleRaw]);

  const navigateToUserLogin = React.useCallback(() => {
    clearActiveUserSession();
    clearSecurityState();
    setCurrentUser(null);
    setCurrentView('LOGIN');
  }, [clearSecurityState]);

  const handleExitApplication = React.useCallback(() => {
    const runtimeWindow = window as any;
    const exitNativeApp = () => {
      const capacitorApp = runtimeWindow.Capacitor?.Plugins?.App;
      if (typeof capacitorApp?.exitApp === 'function') {
        capacitorApp.exitApp();
        return;
      }
      if (typeof runtimeWindow.ClicPOSAppBridge?.exitApp === 'function') {
        runtimeWindow.ClicPOSAppBridge.exitApp();
        return;
      }
      const navigatorApp = (navigator as any).app;
      if (typeof navigatorApp?.exitApp === 'function') {
        navigatorApp.exitApp();
        return;
      }
      if (typeof runtimeWindow.androidBridge?.exitApp === 'function') {
        runtimeWindow.androidBridge.exitApp();
        return;
      }
      window.close();
    };

    markForceLoginAfterExit();
    clearActiveUserSession();
    clearSecurityState();
    setCurrentUser(null);
    setCurrentView('LOGIN');

    const persistBestEffort = persistCriticalLocalStateSnapshot(safeExitSnapshotRef.current, {
      reason: 'exit_app_button',
      parkActiveCart: true,
      onParkedTickets: setParkedTickets,
    }).catch((error) => {
      console.warn('[EXIT_APP] Critical state snapshot failed before native exit:', error);
    });

    const exitTimeout = new Promise<void>((resolve) => {
      window.setTimeout(resolve, 750);
    });

    void Promise.race([persistBestEffort, exitTimeout]).finally(exitNativeApp);
  }, [clearSecurityState]);

  useEffect(() => {
    const currentTerminal = getCurrentTerminal();
    const isNativeStandaloneApk = isNativeStandaloneTerminalRuntime(currentTerminal);
    if (isNativeStandaloneApk && normalizeMasterHost(localStorage.getItem('pos_master_ip'))) {
      console.info('[Security] Native standalone terminal detected; clearing stale master pointer for inactivity policy.');
      localStorage.removeItem('pos_master_ip');
    }
    const autoLogoutMinutes = resolveTerminalAutoLogoutMinutes(currentTerminal);
    const shouldTrackInactivity =
      Boolean(currentUser) &&
      currentView !== 'LOGIN' &&
      currentView !== 'ACTIVATION' &&
      currentView !== 'WIZARD' &&
      autoLogoutMinutes > 0;

    const inactivitySessionKey = `${currentUser?.id || ''}:${currentView}`;
    const isNewInactivitySession = inactivitySessionKeyRef.current !== inactivitySessionKey;
    if (isNewInactivitySession) {
      inactivitySessionKeyRef.current = inactivitySessionKey;
      lastUserActivityAtRef.current = Date.now();
    }

    if (!shouldTrackInactivity) {
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      if (inactivityIntervalRef.current) {
        window.clearInterval(inactivityIntervalRef.current);
        inactivityIntervalRef.current = null;
      }
      return;
    }

    const timeoutMs = autoLogoutMinutes * 60 * 1000;
    const clearInactivityTimer = () => {
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
    const triggerAutoLogout = (reason: string) => {
      if (isAppInBackgroundRef.current) return;
      clearInactivityTimer();
      if (inactivityIntervalRef.current) {
        window.clearInterval(inactivityIntervalRef.current);
        inactivityIntervalRef.current = null;
      }
      console.info(`[Security] Auto-logout triggered after ${autoLogoutMinutes} minute(s) of inactivity (${reason}).`);
      navigateToUserLogin();
    };
    const checkInactivityDeadline = () => {
      if (isAppInBackgroundRef.current) return;
      const idleMs = Date.now() - lastUserActivityAtRef.current;
      if (idleMs >= timeoutMs) {
        triggerAutoLogout('watchdog');
      }
    };
    const scheduleInactivityTimer = () => {
      if (isAppInBackgroundRef.current) return;
      clearInactivityTimer();
      const remainingMs = Math.max(0, timeoutMs - (Date.now() - lastUserActivityAtRef.current));
      inactivityTimerRef.current = window.setTimeout(() => {
        checkInactivityDeadline();
      }, remainingMs);
    };
    const resetInactivityTimer = () => {
      if (isAppInBackgroundRef.current) return;
      lastUserActivityAtRef.current = Date.now();
      scheduleInactivityTimer();
    };

    const handleForegroundSecurityResume = () => {
      if (document.hidden) return;
      const backgroundSince = appBackgroundSinceRef.current;
      isAppInBackgroundRef.current = false;
      appBackgroundSinceRef.current = null;
      if (backgroundSince && Date.now() - backgroundSince >= timeoutMs) {
        void persistCriticalLocalStateSnapshot(safeExitSnapshotRef.current, {
          reason: 'resume_auth_timeout',
          parkActiveCart: false,
        }).finally(() => {
          console.info(`[Security] Session requires revalidation after background timeout (${autoLogoutMinutes} minute(s)).`);
          navigateToUserLogin();
        });
        return;
      }
      resetInactivityTimer();
    };

    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart'];
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetInactivityTimer, { passive: true });
    });
    document.addEventListener('visibilitychange', handleForegroundSecurityResume);
    const appPlugin = (window as any).Capacitor?.Plugins?.App;
    const resumeListener = appPlugin?.addListener?.('resume', handleForegroundSecurityResume);
    const stateListener = appPlugin?.addListener?.('appStateChange', (state: { isActive?: boolean }) => {
      if (state?.isActive === true) handleForegroundSecurityResume();
    });

    console.info('[Security] Auto-lock armed', {
      terminalId: currentTerminal?.id,
      minutes: autoLogoutMinutes,
      view: currentView,
    });
    resetInactivityTimer();
    inactivityIntervalRef.current = window.setInterval(
      checkInactivityDeadline,
      Math.min(30000, Math.max(1000, Math.floor(timeoutMs / 4)))
    );

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetInactivityTimer as EventListener);
      });
      document.removeEventListener('visibilitychange', handleForegroundSecurityResume);
      resumeListener?.remove?.();
      stateListener?.remove?.();
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      if (inactivityIntervalRef.current) {
        window.clearInterval(inactivityIntervalRef.current);
        inactivityIntervalRef.current = null;
      }
    };
  }, [currentUser, currentView, getCurrentTerminal, navigateToUserLogin]);

  useEffect(() => {
    const currentTerminal = getCurrentTerminal();
    const reduceAfterMinutes = resolveReducedSyncAfterMinutes(currentTerminal);
    const shouldTrackSyncInactivity =
      Boolean(currentUser) &&
      currentView !== 'LOGIN' &&
      currentView !== 'ACTIVATION' &&
      currentView !== 'WIZARD' &&
      reduceAfterMinutes > 0;

    const clearTimer = () => {
      if (syncInactivityTimerRef.current) {
        window.clearTimeout(syncInactivityTimerRef.current);
        syncInactivityTimerRef.current = null;
      }
    };

    if (!shouldTrackSyncInactivity) {
      clearTimer();
      syncManager.setReducedSyncMode(false, 'disabled_or_logged_out');
      return;
    }

    const thresholdMs = reduceAfterMinutes * 60 * 1000;

    const scheduleCheck = (delayMs: number) => {
      clearTimer();
      syncInactivityTimerRef.current = window.setTimeout(checkDeadline, Math.max(1000, delayMs));
    };

    const checkDeadline = () => {
      const criticalState = backgroundSyncManager.getState();
      const idleMs = Date.now() - lastSyncActivityAtRef.current;
      const canReduce = canEnterReducedSyncMode({
        idleMs,
        thresholdMs,
        saleActive: isPosSaleActive(),
        pendingCriticalCount: criticalState.pendingCount,
        criticalSyncInProgress: criticalState.isSyncing,
      });

      if (canReduce) {
        clearTimer();
        syncManager.setReducedSyncMode(true, `idle_${reduceAfterMinutes}m`);
        return;
      }

      const remainingMs = thresholdMs - idleMs;
      scheduleCheck(remainingMs > 0 ? remainingMs : 15000);
    };

    const markActive = (reason: string) => {
      lastSyncActivityAtRef.current = Date.now();
      syncManager.setReducedSyncMode(false, reason);
      scheduleCheck(thresholdMs);
    };

    const handleActivity = () => markActive('user_activity');
    const handleOnline = () => markActive('network_reconnected');
    const handleVisibility = () => {
      if (!document.hidden) markActive('app_foreground');
    };
    const handleSaleActivity = () => {
      if (isPosSaleActive()) markActive('sale_activity');
      else checkDeadline();
    };

    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart'];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, handleActivity, { passive: true }));
    window.addEventListener('online', handleOnline);
    window.addEventListener(POS_SALE_ACTIVITY_EVENT, handleSaleActivity);
    document.addEventListener('visibilitychange', handleVisibility);

    console.info('[SYNC_POLICY] Inactivity reduction armed', {
      terminalId: currentTerminal?.id,
      minutes: reduceAfterMinutes,
    });
    markActive('policy_armed');

    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, handleActivity as EventListener));
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(POS_SALE_ACTIVITY_EVENT, handleSaleActivity);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearTimer();
    };
  }, [currentUser, currentView, getCurrentTerminal]);

  useEffect(() => {
    if (settingsPreloadStartedRef.current) return;
    if (!isDataLoaded || !isSecurityLoaded || !currentUser || currentView !== 'POS') return;

    settingsPreloadStartedRef.current = true;
    const preloadTimer = window.setTimeout(() => {
      import('./components/Settings').catch((error) => {
        settingsPreloadStartedRef.current = false;
        console.warn('Settings preload failed; will lazy-load on demand.', error);
      });
    }, 1200);

    return () => window.clearTimeout(preloadTimer);
  }, [currentUser, currentView, isDataLoaded, isSecurityLoaded]);

  useEffect(() => {
    if (!isNativeAndroidRuntime()) return;

    const applyNativeKeyboardGuard = () => {
      document.querySelectorAll('input, textarea').forEach((element) => {
        if (!(element instanceof HTMLElement)) return;
        if (element.dataset.allowNativeKeyboard === 'true') return;
        element.setAttribute('inputmode', 'none');
        element.setAttribute('autocomplete', 'off');
        element.setAttribute('autocorrect', 'off');
        element.setAttribute('autocapitalize', 'off');
      });
    };

    applyNativeKeyboardGuard();
    const observer = new MutationObserver(applyNativeKeyboardGuard);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (currentView !== 'POS') return;

    const timers = [0, 60, 180, 320].map((delay) =>
      window.setTimeout(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('orientationchange'));
      }, delay)
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [currentView]);

  const getStandalonePrimaryBinding = React.useCallback((sourceConfig: BusinessConfig, targetDeviceId: string) => {
    if (!targetDeviceId) return null;

    const terminals = Array.isArray(sourceConfig?.terminals) ? sourceConfig.terminals : [];
    if (terminals.length === 0) return null;

    const existingBinding = terminals.find(t => t.config?.currentDeviceId === targetDeviceId);
    if (existingBinding) {
      return {
        terminalId: existingBinding.id,
        nextConfig: sourceConfig,
        wasAutoBound: false
      };
    }

    const primaryTerminal = terminals.find(t => t.config?.isPrimaryNode) || terminals[0];
    const occupiedByAnotherDevice = primaryTerminal?.config?.currentDeviceId;
    const setupMode = getStoredTerminalSetupMode();
    const canForceStandaloneRebind =
      !hasPendingTerminalSetup() &&
      setupMode !== 'CLIENT' &&
      setupMode !== 'ORDER_TAKER' &&
      setupMode !== 'SERVER_ERP' &&
      !localStorage.getItem('pos_master_ip') &&
      primaryTerminal?.config?.governedByMaster !== true;

    if (
      !primaryTerminal ||
      (occupiedByAnotherDevice &&
        occupiedByAnotherDevice !== targetDeviceId &&
        !canForceStandaloneRebind)
    ) {
      return null;
    }

    const nextConfig: BusinessConfig = {
      ...sourceConfig,
      terminals: terminals.map(terminal => {
        if (terminal.config?.currentDeviceId === targetDeviceId) {
          return {
            ...terminal,
            config: {
              ...terminal.config,
              currentDeviceId: undefined
            }
          };
        }

        if (terminal.id !== primaryTerminal.id) {
          return terminal;
        }

        return {
          ...terminal,
          config: {
            ...terminal.config,
            isPrimaryNode: true,
            currentDeviceId: targetDeviceId,
            lastPairingDate: new Date().toISOString()
          }
        };
      })
    };

    return {
      terminalId: primaryTerminal.id,
      nextConfig,
      wasAutoBound: true
    };
  }, []);

  const activateLocalPrimaryTerminal = React.useCallback(async (sourceConfig: BusinessConfig, targetDeviceId: string) => {
    const standaloneBinding = getStandalonePrimaryBinding(sourceConfig, targetDeviceId);
    if (!standaloneBinding) return null;

    const { nextConfig, terminalId } = standaloneBinding;
    const activeTerminal = (nextConfig.terminals || []).find(t => t.id === terminalId);

    setConfig(nextConfig);
    await db.save('config', nextConfig);

    localStorage.removeItem('pos_master_ip');
    localStorage.setItem('CLIC_POS_MASTER_URL', buildRuntimeMasterUrl());

    permissionService.initialize(nextConfig, terminalId);
    authLevelService.init(nextConfig, terminalId);
    terminalRouter.init(nextConfig, terminalId, activeTerminal?.config?.deviceRole || null);
    await syncManager.initialize(nextConfig, terminalId);

    return standaloneBinding;
  }, [getStandalonePrimaryBinding]);

  const handleVerticalSelection = React.useCallback(async (selectedConfig: BusinessConfig) => {
    clearStoredErpSyncBinding();
    localStorage.removeItem('active_terminal_id');
    localStorage.removeItem('initial_terminal_config');
    localStorage.setItem('clic_sync_mode', 'POS_LOCAL');
    localStorage.setItem(TERMINAL_SETUP_PENDING_KEY, '1');
    localStorage.setItem(TERMINAL_SETUP_MODE_KEY, 'SERVER_LOCAL');
    localStorage.setItem(SETUP_FLOW_STAGE_KEY, 'VERTICAL_SELECTED');
    localStorage.setItem(SETUP_FLOW_VERSION_KEY, SETUP_FLOW_VERSION);
    setConfig(selectedConfig);
    await db.save('config', selectedConfig);
    setCurrentView('SETUP');
  }, []);

  const handleTerminalModeSelection = React.useCallback((mode: TerminalSetupMode) => {
    clearStoredErpSyncBinding();
    localStorage.removeItem('active_terminal_id');
    localStorage.removeItem('initial_terminal_config');
    localStorage.setItem('clic_sync_mode', mode === 'SERVER_ERP' ? 'POS_ERP' : (mode === 'CLIENT' || mode === 'ORDER_TAKER') ? 'POS_SLAVE' : 'POS_LOCAL');
    localStorage.setItem(TERMINAL_SETUP_PENDING_KEY, '1');
    localStorage.setItem(TERMINAL_SETUP_MODE_KEY, mode);

    if (mode === 'SERVER_LOCAL') {
      localStorage.removeItem('pos_master_ip');
      localStorage.setItem('CLIC_POS_MASTER_URL', buildRuntimeMasterUrl());
      setCurrentView('VERTICAL_SELECTOR');
      return;
    }

    if (mode === 'SERVER_ERP') {
      localStorage.removeItem('pos_master_ip');
      localStorage.setItem('CLIC_POS_MASTER_URL', buildRuntimeMasterUrl());
      localStorage.removeItem(SETUP_FLOW_STAGE_KEY);
      localStorage.removeItem(SETUP_FLOW_VERSION_KEY);
      setCurrentView('TERMINAL_PAIRING');
      return;
    }

    localStorage.removeItem(SETUP_FLOW_STAGE_KEY);
    localStorage.removeItem(SETUP_FLOW_VERSION_KEY);
    setCurrentView('TERMINAL_PAIRING');
  }, []);

  const erpLifecycleReady = ![
    'ACTIVATION',
    'VERTICAL_SELECTOR',
    'TERMINAL_PAIRING',
  ].includes(currentView);

  useEffect(() => {
    const setupPending = hasPendingTerminalSetup();
    const currentTerminal = getCurrentTerminal();
    const tenantIdentity = getStoredTenantIdentity();

    if (!isDataLoaded || setupPending || !erpLifecycleReady || terminalAuthorizationBlock) return;
    if (!deviceId || !currentTerminal?.id) return;
    if (!tenantIdentity.tenantId && !tenantIdentity.tenantSlug && !tenantIdentity.tenantEmail) return;

    let disposed = false;
    const recoveredErpBaseUrl = resolveSetupErpBaseUrl();

    if (recoveredErpBaseUrl) {
      persistSetupErpBaseUrls(recoveredErpBaseUrl);
    }

    const publishEndpoint = async () => {
      const operationalTerminalId = currentTerminal.config?.stationNumber || currentTerminal.id;
      const terminalName = currentTerminal.config?.terminalName || operationalTerminalId;
      const endpoint = await publishMasterEndpointToCloud({
        deviceId,
        terminalId: operationalTerminalId,
        terminalName,
        isPrimary: currentTerminal.config?.isPrimaryNode !== false,
      });

      if (!disposed && endpoint?.localIp) {
        console.log(`[CLOUD] Terminal ${terminalName} publicada en cloud: ${endpoint.localIp}`);
      }
    };

    const LEGACY_HEARTBEAT_INTERVAL_MS = 60_000;
    // Keep the active heartbeat ahead of the five-minute healthy reconciliation.
    // Equal cadences let a no-op reconciliation continually suppress heartbeat.
    const ACTIVE_HEARTBEAT_INTERVAL_MS = 4 * 60 * 1000;
    const BACKGROUND_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;
    const OUTBOX_POLL_BASE_MS = 30000;
    const OUTBOX_POLL_MAX_MS = 300000;
    const MANIFEST_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
    const CONFIG_SAFETY_CHECK_INTERVAL_MS = 15 * 60 * 1000;
    const lifecycleManifestKeyParts = [
      deviceId,
      currentTerminal?.config?.erpTerminalId || currentTerminal?.id || 'unknown-terminal',
      currentTerminal?.config?.stationNumber || 'unknown-local-terminal',
    ].join(':');
    const bootManifestSyncKey = `clic_pos_lifecycle_boot_manifest_synced:${lifecycleManifestKeyParts}`;
    const lastManifestRefreshKey = `clic_pos_lifecycle_last_manifest_refresh:${lifecycleManifestKeyParts}`;
    let lastManifestRefreshAt = Number(sessionStorage.getItem(lastManifestRefreshKey) || '0') || 0;
    let outboxPollTimeoutId: number | null = null;
    let configSafetyCheckTimeoutId: number | null = null;
    let outboxPollFailures = 0;
    const adaptivePollingEnabled = isSyncFeatureEnabled('adaptive_polling');
    const heartbeatV2Enabled = isSyncFeatureEnabled('heartbeat_v2');

    const requestConditionalTerminalConfig = async (
      reason: 'startup' | 'connection_restored' | 'safety_check',
    ) => {
      const erpTerminalId =
        currentTerminal.config?.erpTerminalId
        || loadSyncProfile().erpTerminalId
        || localStorage.getItem('clic_erp_sync_terminal_id')
        || currentTerminal.id;
      const erpBaseUrl = resolveSetupErpBaseUrl();
      const tenantId = tenantIdentity.tenantId || localStorage.getItem('active_tenant_id');
      if (!erpBaseUrl || !erpTerminalId || !tenantId || !navigator.onLine) return;

      await terminalConfigRequestCoordinator.request<Record<string, unknown>>({
        baseUrl: erpBaseUrl,
        terminalId: erpTerminalId,
        tenantId,
        deviceId,
        reason,
        apply: async (payload) => {
          const refreshedConfig = await syncManager.refreshTerminalResolvedConfig(payload, {
            dispatchEvent: true,
            forceRemoteFetch: false,
            forceFullCatalog: false,
            supplementalMode: 'background',
          });
          if (!refreshedConfig) {
            throw new Error('La configuración condicional no pudo aplicarse.');
          }
        },
      });
    };

    const resolveLifecycleTerminalContext = () => {
      const operationalTerminalId = currentTerminal.config?.stationNumber || currentTerminal.id;
      return {
        operationalTerminalId,
        erpTerminalId:
          currentTerminal.config?.erpTerminalId
          || loadSyncProfile().erpTerminalId
          || localStorage.getItem('clic_erp_sync_terminal_id')
          || operationalTerminalId,
        terminalName: currentTerminal.config?.terminalName || operationalTerminalId,
      };
    };

    const sendPeriodicErpHeartbeat = async () => {
      const { operationalTerminalId, erpTerminalId, terminalName } = resolveLifecycleTerminalContext();
      try {
        const result = await heartbeatErpSyncTerminal({
          deviceId,
          terminalId: erpTerminalId,
          localTerminalId: operationalTerminalId,
          terminalName,
          isPrimary: currentTerminal.config?.isPrimaryNode !== false,
          pendingEvents: 0,
        }, deviceId);

        if (!disposed && isLifecycleActivationBlocked(result?.activation)) {
          triggerLockdown(getLifecycleActivationBlockMessage(result?.activation));
          return;
        }

        if (!disposed) {
          console.info('[ERP HEARTBEAT]', {
            endpoint: '/terminals/heartbeat',
            terminalId: result?.terminal?.id || erpTerminalId,
            deviceId,
            status: result?.terminal?.status || result?.status || 'OK',
          });
        }
      } catch (error) {
        const blockingMessage = getLifecycleBlockingMessageFromError(error);
        if (!disposed && blockingMessage) {
          if (blockingMessage === DEVICE_SUPERSEDED_MESSAGE) {
            lockSupersededTerminal(blockingMessage, {
              terminalId: erpTerminalId,
              requestDeviceId: deviceId,
              payload: (error as any)?.payload,
            });
          } else {
            triggerLockdown(blockingMessage);
          }
          return;
        }
        throw error;
      }
    };

    const heartbeatScheduler = createErpHeartbeatScheduler({
      intervalMs: LEGACY_HEARTBEAT_INTERVAL_MS,
      getIntervalMs: () => heartbeatV2Enabled
        ? (document.hidden ? BACKGROUND_HEARTBEAT_INTERVAL_MS : ACTIVE_HEARTBEAT_INTERVAL_MS)
        : LEGACY_HEARTBEAT_INTERVAL_MS,
      getLastAuthenticatedActivityAt: () => heartbeatV2Enabled
        ? authenticatedActivityTracker.getSnapshot().lastAuthenticatedActivityAt
        : 0,
      getJitterMs: getTimerJitterMs,
      flightRef: erpHeartbeatInFlightRef,
      shouldRun: () => !disposed && navigator.onLine && !isPosOnlyCloudStagingTarget(),
      sendHeartbeat: async () => {
        // La publicación Cloud es complementaria y nunca sustituye ni bloquea el heartbeat ERP.
        void publishEndpoint();
        await sendPeriodicErpHeartbeat();
        authenticatedActivityTracker.record('HEARTBEAT');
        syncMetrics.increment('heartbeat_total');
      },
      onSuppressed: () => syncMetrics.increment('heartbeat_suppressed_total'),
      onError: (error) => {
        console.warn('[ERP HEARTBEAT] periodic /terminals/heartbeat failed; next interval remains scheduled.', error);
      },
    });

    const syncLifecycle = async (options?: {
      forceManifestRefresh?: boolean;
      reason?: 'startup' | 'connection_restored' | 'app_resumed';
    }) => {
      // Lifecycle effects can be recreated by runtime config updates. Keep one
      // shared operation so those recreations cannot overlap manifest refreshes.
      if (lifecycleSyncInFlightRef.current) {
        console.log('[ERP SYNC] lifecycle refresh already in flight; skipping overlap.');
        return lifecycleSyncInFlightRef.current;
      }

      const operation = (async () => {
      if (isPosOnlyCloudStagingTarget()) {
        return false;
      }

      try {
        const { operationalTerminalId, erpTerminalId, terminalName } = resolveLifecycleTerminalContext();
        const result = await ensureErpSyncLifecycle({
          deviceId,
          terminalId: erpTerminalId,
          localTerminalId: operationalTerminalId,
          terminalName,
          isPrimary: currentTerminal.config?.isPrimaryNode !== false,
          pendingEvents: 0,
        });

        const blockingActivation = result?.heartbeat?.activation || result?.registered?.activation || result?.bootstrap?.activation;
        if (!disposed && isLifecycleActivationBlocked(blockingActivation)) {
          triggerLockdown(getLifecycleActivationBlockMessage(blockingActivation));
          return false;
        }

        if (!disposed && result?.heartbeat?.terminal?.id) {
          console.log(`[ERP SYNC] Terminal ${terminalName} enlazada con ${result.heartbeat.terminal.id}`);
        }

        if (!disposed && (result?.outbox?.applied || 0) > 0) {
          console.log(`[ERP SYNC] ${result.outbox.applied} evento(s) ERP aplicados. El refresh runtime se resuelve por terminalConfigSyncRequested.`);
        }

        const now = Date.now();
        const forceManifestRefreshRequested = Boolean(options?.forceManifestRefresh);
        const shouldHonorForcedManifestRefresh = forceManifestRefreshRequested
          && sessionStorage.getItem(bootManifestSyncKey) !== 'true';
        const shouldRefreshManifest = shouldHonorForcedManifestRefresh
          || now - lastManifestRefreshAt >= MANIFEST_REFRESH_INTERVAL_MS;

        if (shouldRefreshManifest) {
          console.info('[SYNC_FALLBACK]', {
            reason: options?.reason || 'startup',
            mechanism: 'terminal_manifest',
            legacy_collection_sweep: false,
            interval_ms: MANIFEST_REFRESH_INTERVAL_MS,
          });
          const refreshedFromManifest = await syncManager.syncTerminalManifestInBackground(undefined, {
            bootstrapBlocks: shouldHonorForcedManifestRefresh,
            reason: options?.reason,
          });
          if (!disposed && refreshedFromManifest && !Array.isArray(refreshedFromManifest) && refreshedFromManifest.terminals) {
            console.log(`[ERP SYNC] ${terminalName} actualizó su estado runtime desde el manifest del ERP.`);
          }
          lastManifestRefreshAt = now;
          sessionStorage.setItem(lastManifestRefreshKey, String(now));
          if (forceManifestRefreshRequested) {
            sessionStorage.setItem(bootManifestSyncKey, 'true');
          }
        }
        return true;
      } catch (error) {
        const blockingMessage = getLifecycleBlockingMessageFromError(error);
        if (!disposed && blockingMessage) {
          if (blockingMessage === DEVICE_SUPERSEDED_MESSAGE) {
            lockSupersededTerminal(blockingMessage, {
              terminalId: currentTerminal.config?.erpTerminalId || currentTerminal.id,
              requestDeviceId: deviceId,
              payload: (error as any)?.payload,
            });
          } else {
            triggerLockdown(blockingMessage);
          }
          return false;
        }
        console.warn('[ERP SYNC] lifecycle registration skipped:', error);
        return false;
      }
      })();

      lifecycleSyncInFlightRef.current = operation;
      try {
        await operation;
      } finally {
        if (lifecycleSyncInFlightRef.current === operation) {
          lifecycleSyncInFlightRef.current = null;
        }
      }
    };

    const lifecycleReasons = new Set<SyncTriggerReason>([
      'STARTUP',
      'ONLINE',
      'FOREGROUND',
      'REALTIME_RECONNECTED',
    ]);

    syncTriggerCoordinator.configure(async ({ reasons, collections, imageOnly, domainVersions }) => {
      if (disposed || !navigator.onLine || isPosOnlyCloudStagingTarget()) return;
      const needsLifecycle = reasons.some((reason) => lifecycleReasons.has(reason));
      syncMetrics.increment('polls_total');
      syncMetrics.markPullStarted();
      let authenticatedRequestSucceeded = false;

      if (needsLifecycle) {
        const isStartup = reasons.includes('STARTUP');
        const reason = isStartup
          ? 'startup'
          : reasons.includes('ONLINE') || reasons.includes('REALTIME_RECONNECTED')
            ? 'connection_restored'
            : 'app_resumed';
        authenticatedRequestSucceeded = await syncLifecycle({ forceManifestRefresh: isStartup, reason });
      } else {
        const triggerReason = reasons.includes('REALTIME_HINT')
          ? 'force_sync'
          : reasons.includes('MANUAL')
            ? 'manual_sync'
            : 'periodic';
        authenticatedRequestSucceeded = await triggerErpSyncOutbox(triggerReason) !== null;

        if (reasons.includes('REALTIME_HINT')) {
          if (syncManager.isUsingConfigPushV2Primary() && !imageOnly) {
            console.info('[SYNC_STRATEGY]', {
              target: 'ERP_ACTIVE',
              strategy: 'CONFIG_PUSH_V2_PRIMARY',
              action: 'realtime_legacy_catalog_pull_skipped',
              requested_collections: collections.length,
              hinted_domains: Object.keys(domainVersions),
            });
          } else if (imageOnly || collections.length > 0) {
            const requestedCollections = collections.length > 0 ? collections : ['products'];
            for (const collection of requestedCollections) {
              await syncManager.pullCatalog(collection as any, false, { ignoreThrottle: true });
            }
            authenticatedRequestSucceeded = true;
          } else {
            await syncManager.refreshTerminalResolvedConfig(undefined, {
              forceRemoteFetch: true,
              forceFullCatalog: false,
              dispatchEvent: true,
            });
            await syncManager.syncAllCatalogs();
            authenticatedRequestSucceeded = true;
          }
        }
      }

      if (authenticatedRequestSucceeded) {
        authenticatedActivityTracker.record('PULL');
        syncMetrics.increment('pulls_total');
        syncMetrics.markPullFinished();
        syncMetrics.markSuccessfulSync();
      }
    });

    const adaptivePollingScheduler = createAdaptivePollingScheduler({
      isOnline: () => navigator.onLine,
      requestReconciliation: () => syncTriggerCoordinator.request({ reason: 'RECONCILIATION' }),
      onError: (error) => {
        syncMetrics.increment('retry_count');
        console.warn('[ERP SYNC] adaptive reconciliation failed; retrying with backoff.', error);
      },
    });
    const unsubscribeRealtimeState = realtimeNotificationService.subscribeState((state) => {
      adaptivePollingScheduler.updateRealtimeState(state);
    });

    const handleErpOnline = () => {
      if (!disposed) {
        adaptivePollingScheduler.notifyOnline();
        void syncTriggerCoordinator.request({ reason: 'ONLINE' });
        void requestConditionalTerminalConfig('connection_restored').catch((error) => {
          console.warn('[CONFIG_SYNC] connection recovery check failed; local config preserved.', error);
        });
      }
    };
    const handleErpAppResume = () => {
      if (!disposed && !document.hidden && navigator.onLine) {
        void syncTriggerCoordinator.request({ reason: 'FOREGROUND' });
      }
    };

    // Boot: publica endpoint; lifecycle ERP/manifest solo en contratos ERP o legacy con pull.
    void publishEndpoint();
    let startupSyncTimeoutId: number | null = null;
    if (!isPosOnlyCloudStagingTarget()) {
      startupSyncTimeoutId = window.setTimeout(() => {
        if (!disposed) void syncTriggerCoordinator.request({ reason: 'STARTUP' });
      }, 8000);
    } else {
      console.log('[CLOUD STAGING] ERP lifecycle and manifest refresh disabled for POS_CLOUD_STAGING.');
    }

    heartbeatScheduler.start();

    const scheduleNextOutboxPoll = (delayMs = OUTBOX_POLL_BASE_MS) => {
      if (disposed || isPosOnlyCloudStagingTarget()) return;
      if (outboxPollTimeoutId !== null) {
        window.clearTimeout(outboxPollTimeoutId);
      }
      outboxPollTimeoutId = window.setTimeout(async () => {
        if (disposed) return;
        if (navigator.onLine) {
          try {
            await triggerErpSyncOutbox('periodic');
            outboxPollFailures = 0;
          } catch (error) {
            outboxPollFailures += 1;
            console.warn('[ERP SYNC] periodic outbox pull failed; retrying with backoff.', {
              terminalId: currentTerminal.config?.erpTerminalId || currentTerminal.id,
              failures: outboxPollFailures,
              error,
            });
          }
        }
        const backoffMs = Math.min(
          OUTBOX_POLL_MAX_MS,
          OUTBOX_POLL_BASE_MS * (2 ** Math.min(outboxPollFailures, 4)),
        );
        scheduleNextOutboxPoll(backoffMs + getTimerJitterMs());
      }, delayMs);
    };

    if (adaptivePollingEnabled) {
      adaptivePollingScheduler.start(realtimeNotificationService.getState());
    } else {
      scheduleNextOutboxPoll();
    }

    const scheduleNextConfigSafetyCheck = () => {
      if (disposed || isPosOnlyCloudStagingTarget()) return;
      if (configSafetyCheckTimeoutId !== null) {
        window.clearTimeout(configSafetyCheckTimeoutId);
      }
      const jitterMs = Math.round(CONFIG_SAFETY_CHECK_INTERVAL_MS * ((Math.random() * 0.4) - 0.2));
      configSafetyCheckTimeoutId = window.setTimeout(async () => {
        if (!disposed && navigator.onLine) {
          try {
            await requestConditionalTerminalConfig('safety_check');
          } catch (error) {
            console.warn('[CONFIG_SYNC] safety check failed; local config preserved.', error);
          }
        }
        scheduleNextConfigSafetyCheck();
      }, CONFIG_SAFETY_CHECK_INTERVAL_MS + jitterMs);
    };

    scheduleNextConfigSafetyCheck();
    window.addEventListener('online', handleErpOnline);
    document.addEventListener('visibilitychange', handleErpAppResume);

    return () => {
      disposed = true;
      if (startupSyncTimeoutId !== null) window.clearTimeout(startupSyncTimeoutId);
      heartbeatScheduler.stop();
      adaptivePollingScheduler.stop();
      unsubscribeRealtimeState();
      syncTriggerCoordinator.clear();
      if (outboxPollTimeoutId !== null) {
        window.clearTimeout(outboxPollTimeoutId);
      }
      if (configSafetyCheckTimeoutId !== null) {
        window.clearTimeout(configSafetyCheckTimeoutId);
      }
      const erpTerminalId =
        currentTerminal.config?.erpTerminalId
        || loadSyncProfile().erpTerminalId
        || localStorage.getItem('clic_erp_sync_terminal_id')
        || currentTerminal.id;
      terminalConfigRequestCoordinator.cancel(erpTerminalId);
      window.removeEventListener('online', handleErpOnline);
      document.removeEventListener('visibilitychange', handleErpAppResume);
    };
  }, [erpLifecycleReady, deviceId, getCurrentTerminal, isDataLoaded, lockSupersededTerminal, terminalAuthorizationBlock]);

  // --- RECONNECTION BANNER ---
  const renderReconnectionBanner = () => {
    if (reconnectionStatus === 'idle') return null;

    const bannerStyle: React.CSSProperties = {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      padding: '8px',
      textAlign: 'center',
      fontWeight: 'bold',
      boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    };

    if (reconnectionStatus === 'searching') {
      return (
        <div style={{ ...bannerStyle, backgroundColor: '#f59e0b', color: '#fff' }}>
          📡 Buscando servidor Maestro en la red local... (Auto-recuperación)
        </div>
      );
    }

    if (reconnectionStatus === 'connected') {
      return (
        <div style={{ ...bannerStyle, backgroundColor: '#10b981', color: '#fff' }}>
          ✅ Conexión recuperada exitosamente.
        </div>
      );
    }

    if (reconnectionStatus === 'failed') {
      return (
        <div style={{ ...bannerStyle, backgroundColor: '#ef4444', color: '#fff' }}>
          ❌ No se pudo encontrar el servidor Maestro. Por favor revise su conexión.
        </div>
      );
    }
  };

  const renderTerminalConfigRestartBanner = () => {
    if (!terminalConfigRestartNotice) return null;

    const tenantIdentity = getStoredTenantIdentity();
    const restartTargetName =
      config.companyInfo?.name?.trim()
      || tenantIdentity.tenantSlug
      || tenantIdentity.tenantEmail
      || null;
    const currentTerminal = getCurrentTerminal();
    const restartTerminalName =
      currentTerminal?.config?.terminalName
      || currentTerminal?.config?.stationNumber
      || terminalConfigRestartNotice.terminalId
      || null;

    const bannerStyle: React.CSSProperties = {
      position: 'fixed',
      top: reconnectionStatus === 'idle' ? 0 : 44,
      left: 0,
      right: 0,
      zIndex: 9998,
      padding: '10px 16px',
      backgroundColor: '#1e293b',
      color: '#fff',
      boxShadow: '0 2px 8px rgba(15,23,42,0.25)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      flexWrap: 'wrap',
    };

    return (
      <div style={bannerStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800 }}>
            Nueva configuración recibida desde ERP
            {restartTargetName ? ` · ${restartTargetName}` : ''}
          </div>
          <div style={{ fontSize: '13px', opacity: 0.92 }}>
            Reinicia el POS para aplicar por completo cambios de tarifa, catálogo y configuración operativa.
            {restartTerminalName ? ` Terminal ${restartTerminalName}.` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={dismissTerminalConfigRestartNotice}
            style={{
              padding: '8px 12px',
              borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.08)',
              color: '#fff',
              fontWeight: 700,
            }}
          >
            Entendido
          </button>
          <button
            onClick={restartForTerminalConfigUpdate}
            style={{
              padding: '8px 14px',
              borderRadius: '10px',
              border: 'none',
              background: '#22c55e',
              color: '#052e16',
              fontWeight: 800,
            }}
          >
            Reiniciar ahora
          </button>
        </div>
      </div>
    );
  };

  // --- DATA STORES ---

  useEffect(() => {
    if (!isDataLoaded || !isSecurityLoaded || currentUser || !Array.isArray(users) || users.length === 0) return;
    if (isCustomerDisplaySurface()) return;
    const forceLoginAfterExit = consumeForceLoginAfterExit();
    if (forceLoginAfterExit || terminalAuthorizationBlock) {
      clearActiveUserSession();
      clearSecurityState();
      if (currentView !== 'LOGIN') setCurrentView('LOGIN');
      return;
    }
    const session = readActiveUserSession();
    if (!session) return;
    if (Capacitor.isNativePlatform()) {
      const nativeSetupViews = new Set<ViewState>([
        'ACTIVATION', 'WIZARD', 'TERMINAL_PAIRING', 'TERMINAL_BINDING',
        'SETUP', 'DEVICE_UNAUTHORIZED', 'VISOR',
      ] as ViewState[]);
      if (nativeSetupViews.has(currentView)) return;

      const currentTerminal = getCurrentTerminal();
      const canResumeRecreatedActivity = shouldRestoreNativeSession({
        launchContext: readNativeLaunchContext(),
        forceLogin: forceLoginAfterExit,
        savedAt: session.savedAt,
        autoLogoutMinutes: resolveTerminalAutoLogoutMinutes(currentTerminal),
        currentTerminalId: currentTerminal?.id,
        sessionTerminalId: session.terminalId,
      });
      if (!canResumeRecreatedActivity) {
        clearActiveUserSession();
        clearSecurityState();
        if (currentView !== 'LOGIN') setCurrentView('LOGIN');
        return;
      }
    }
    const restoredUser = users.find(user => String(user.id) === session.userId);
    if (!restoredUser) {
      clearActiveUserSession();
      return;
    }
    const forbiddenRestoreViews = new Set<ViewState>([
      'LOGIN',
      'ACTIVATION',
      'WIZARD',
      'TERMINAL_PAIRING',
      'TERMINAL_BINDING',
      'SETUP',
      'DEVICE_UNAUTHORIZED',
      'VISOR',
    ] as ViewState[]);
    const restoreView = session.currentView && !forbiddenRestoreViews.has(session.currentView)
      ? session.currentView
      : 'POS';
    setCurrentUser(restoredUser);
    if (currentView === 'LOGIN') {
      setCurrentView(restoreView);
    }
  }, [currentUser, currentView, getCurrentTerminal, isDataLoaded, isSecurityLoaded, terminalAuthorizationBlock, users]);

  const [roles, setRoles] = useState<RoleDefinition[]>(DEFAULT_ROLES);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [zReports, setZReports] = useState<ZReport[]>([]);
  const [xReports, setXReports] = useState<XReport[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [parkedTickets, setParkedTickets] = useState<ParkedTicket[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [internalSequences, setInternalSequences] = useState<any[]>([]);
  const [receptions, setReceptions] = useState<Reception[]>([]);
  const [productStocks, setProductStocks] = useState<ProductStock[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [clientMasterTablesStatus, setClientMasterTablesStatus] = useState<'CHECKING' | 'ONLINE' | 'OFFLINE'>(() =>
    isClientTerminalMode() ? 'CHECKING' : 'ONLINE'
  );
  const clientMasterFailureCountRef = useRef(0);
  const clientMasterLastSuccessAtRef = useRef(0);
  const clientMasterTablesFetchInFlightRef = useRef(false);
  const clientValidatedMasterBaseUrlRef = useRef('');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string>('');
  const [activeRoomId2, setActiveRoomId2] = useState<string>(''); // For backward compatibility if needed
  const [supplierProductPrices, setSupplierProductPrices] = useState<any[]>([]);
  const persistedFloorPlanMirror = useMemo(() => readFloorPlanMirror(), []);
  const defaultRoomBootstrapRef = useRef(false);
  const locallySavedFloorPlanRef = useRef<{
    roomIds: Set<string>;
    tableIds: Set<string>;
  } | null>(persistedFloorPlanMirror ? {
    roomIds: new Set(persistedFloorPlanMirror.rooms.map(room => String(room.id))),
    tableIds: new Set(persistedFloorPlanMirror.tables.map(table => String(table.id)))
  } : null);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [settingsInitialView, setSettingsInitialView] = useState<string | undefined>();
  const [settingsInitialData, setSettingsInitialData] = useState<any>();
  const tableDesignerReturnViewRef = useRef<ViewState>('SETTINGS');
  const [viewData, setViewData] = useState<any>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [activeCartDraftRestorePrompt, setActiveCartDraftRestorePrompt] = useState<ActiveCartDraft | null>(null);
  const masterRestaurantRevisionRef = useRef(0);
  const lastAppliedClientRestaurantRevisionRef = useRef(0);
  const masterRestaurantPollInFlightRef = useRef(false);
  const parkedTicketSyncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingClientTableSyncRef = useRef<PendingClientTableSync | null>(null);
  const pendingMasterTableSyncRef = useRef<PendingClientTableSync | null>(null);
  const masterRestaurantBootstrapRequestedRef = useRef(false);
  const masterFloorPlanRestoreInFlightRef = useRef(false);
  const masterOperationalSnapshotRef = useRef({ rooms, tables, parkedTickets, cashMovements });

  useEffect(() => {
    masterOperationalSnapshotRef.current = { rooms, tables, parkedTickets, cashMovements };
  }, [cashMovements, parkedTickets, rooms, tables]);

  useEffect(() => {
    if (!isNativeAndroidRuntime()) return;

    let disposed = false;
    // Antes de terminar el bootstrap, SQLite es más confiable que los estados
    // React todavía vacíos. Luego, los estados vivos evitan publicar datos viejos.
    const liveCatalogs = isDataLoaded ? {
      products,
      customers,
      warehouses,
      users,
      suppliers,
      roles,
      collections,
      internalSequences,
      transfers,
      receptions,
      productStocks,
    } : {};
    let catalogPublishInFlight = false;
    const ensureMasterServer = async (includeOperationalSnapshot = true) => {
      if (disposed) return;
      const nativeBridge = (window as any).ClicPOSNativePrinter;
      const currentTerminal = getCurrentTerminal();
      const shouldServeAsMaster = isNativeStandaloneTerminalRuntime(currentTerminal);

      if (!shouldServeAsMaster) {
        if (typeof nativeBridge?.stopMasterServer === 'function') {
          void Promise.resolve(nativeBridge.stopMasterServer({ port: 3001 }));
        }
        return;
      }

      if (typeof nativeBridge?.startMasterServer !== 'function') {
        console.error('[MASTER_LAN] Native Master server bridge is unavailable.');
        return;
      }

      if (catalogPublishInFlight) return;
      catalogPublishInFlight = true;

      const catalogs = await buildPosMasterCatalogSnapshot(
        (collection) => db.get(collection as any),
        liveCatalogs,
        config,
      );

      if (disposed) {
        catalogPublishInFlight = false;
        return;
      }

      const payload = {
        port: 3001,
        config,
        users,
        catalogs,
        restaurantRevision: masterRestaurantRevisionRef.current,
        ...(includeOperationalSnapshot ? {
          rooms: masterOperationalSnapshotRef.current.rooms,
          tables: masterOperationalSnapshotRef.current.tables,
          parkedTickets: masterOperationalSnapshotRef.current.parkedTickets,
        } : {}),
      };
      if (includeOperationalSnapshot) {
        masterRestaurantBootstrapRequestedRef.current = true;
      }
      return Promise.resolve(nativeBridge.startMasterServer(payload))
        .then((status: any) => {
          if (disposed) return;
          console.info('[MASTER_LAN] Native server ensured', {
            running: Boolean(status?.running || status?.success),
            port: status?.port || 3001,
            localIp: status?.localIp || null,
            localIps: status?.localIps || [],
            error: status?.message || null,
          });
        })
        .catch((error: unknown) => {
          if (includeOperationalSnapshot) {
            masterRestaurantBootstrapRequestedRef.current = false;
          }
          console.error('[MASTER_LAN] Could not ensure native server:', error);
        })
        .finally(() => {
          catalogPublishInFlight = false;
        });
    };

    const reconcileNativeRestaurantState = async () => {
      if (disposed || masterRestaurantPollInFlightRef.current) return;
      // El diseñador mantiene un borrador local hasta "Guardar y Volver".
      // No permitir que un snapshot nativo anterior reponga coordenadas mientras
      // el usuario está moviendo o agregando elementos del plano.
      if (currentViewRef.current === 'TABLE_DESIGNER' || activeTableEditLockRef.current) return;
      const nativeBridge = (window as any).ClicPOSNativePrinter;
      if (typeof nativeBridge?.getMasterRestaurantState !== 'function') return;
      if (!isNativeStandaloneTerminalRuntime(getCurrentTerminal())) return;
      // Never classify the native bootstrap snapshot against an empty React
      // customer array. Wait until SQLite hydration is complete so only a
      // customer genuinely created by a Client terminal is queued for ERP.
      if (!isDataLoaded) return;

      masterRestaurantPollInFlightRef.current = true;
      try {
        const rawState = await Promise.resolve(nativeBridge.getMasterRestaurantState({}));
        const state = parseNativeBridgeJson(rawState);
        const nextRooms = Array.isArray(state?.rooms) ? state.rooms : [];
        const nextTables = Array.isArray(state?.tables) ? state.tables : [];
        const revision = Number(state?.revision || 0);
        if (!Number.isFinite(revision)) return;

        // Un servidor nativo nuevo se inicializa una sola vez desde SQLite.
        // Después de esto el estado restaurante solo cambia mediante endpoints
        // atómicos; los renders de React nunca vuelven a reemplazarlo completo.
        if (
          revision === 0 &&
          nextRooms.length === 0 &&
          nextTables.length === 0 &&
          isDataLoaded &&
          rooms.length > 0 &&
          tables.length > 0 &&
          !masterRestaurantBootstrapRequestedRef.current
        ) {
          ensureMasterServer(true);
          return;
        }

        if (revision <= masterRestaurantRevisionRef.current) return;

        // El plano diseñado de la Master conserva autoridad aunque un bootstrap
        // posterior entregue otra cuadrícula (incluso si ya trae coordenadas).
        // Las mutaciones operativas solo se aceptan si conservan los UUID.
        const savedFloorPlan = readFloorPlanMirror();
        const floorPlanSelection = savedFloorPlan
          ? selectAuthoritativeFloorPlan({
              local: savedFloorPlan,
              incoming: { rooms: nextRooms, tables: nextTables },
              isClientTerminal: false,
            })
          : null;
        if (floorPlanSelection?.reason === 'PRESERVE_MASTER_DESIGN' && !masterFloorPlanRestoreInFlightRef.current) {
          masterFloorPlanRestoreInFlightRef.current = true;
          try {
            const response = await fetch(resolveOperationalApiUrl('/api/mesas/layout'), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                rooms: floorPlanSelection.rooms,
                tables: floorPlanSelection.tables,
              }),
            });
            const result = await response.json().catch(() => null);
            if (!response.ok || result?.success === false) {
              throw new Error(result?.message || `HTTP ${response.status}`);
            }
            const restoredRevision = Number(result?.revision || revision);
            masterRestaurantRevisionRef.current = Math.max(revision, restoredRevision);
            console.warn('[MASTER_LAN] Restored designed floor plan after rejecting ERP seed tables', {
              restoredTables: floorPlanSelection.tables.length,
              revision: restoredRevision,
            });
          } finally {
            masterFloorPlanRestoreInFlightRef.current = false;
          }
          return;
        }

        const remoteParkedTickets = Array.isArray(state?.parkedTickets) ? state.parkedTickets : [];
        // Una revisión nativa también puede cambiar por actividad de la Cliente
        // (locks, otra mesa, heartbeat). Mientras la Master guarda su mesa activa,
        // conservar ese borrador para que un snapshot anterior no borre la primera
        // digitación antes de que termine el PUT atómico.
        const nextParkedTickets = mergePendingClientTableTickets(
          remoteParkedTickets,
          pendingMasterTableSyncRef.current,
        );
        const selectedRooms = floorPlanSelection?.rooms || nextRooms;
        const selectedTables = floorPlanSelection?.tables || nextTables;
        const reconciledTables = reconcileTablesWithParkedTickets(selectedTables, nextParkedTickets);
        const nextCustomers = Array.isArray(state?.customers) ? state.customers : customers;
        const persistedCustomers = await db.get('customers') as Customer[] | null;
        const customersCreatedByClients = selectCustomersCreatedByClients(
          nextCustomers,
          customers,
          Array.isArray(persistedCustomers) ? persistedCustomers : [],
        );
        const productRoutingUpdates = Array.isArray(state?.productRoutingUpdates)
          ? state.productRoutingUpdates
          : [];
        const routingAssignments = Object.fromEntries(
          productRoutingUpdates
            .map((update: any) => [
              String(update?.productId || '').trim(),
              String(update?.productionAreaId || '').trim(),
            ])
            .filter(([productId, productionAreaId]: string[]) => Boolean(productId && productionAreaId)),
        );
        const routedCatalog = applyProductionAreaAssignments(products, routingAssignments);
        masterRestaurantRevisionRef.current = revision;
        if (hasDesignedFloorPlan(reconciledTables)) {
          locallySavedFloorPlanRef.current = {
            roomIds: new Set(selectedRooms.map((room: Room) => String(room.id))),
            tableIds: new Set(reconciledTables.map((table: Table) => String(table.id))),
          };
          writeFloorPlanMirror(selectedRooms, reconciledTables, {
            layoutSource: 'MASTER_RUNTIME',
            layoutRevision: revision,
            isDefaultSeed: false,
          });
        }
        setRooms(selectedRooms);
        setTables(reconciledTables);
        setParkedTickets(nextParkedTickets);
        setCustomers(nextCustomers);
        if (routedCatalog.updatedProducts.length > 0) {
          setProducts(routedCatalog.products);
          window.dispatchEvent(new CustomEvent('productsUpdated'));
        }
        writeCriticalCollectionsMirror(
          nextParkedTickets,
          masterOperationalSnapshotRef.current.cashMovements,
        );
        await Promise.all([
          db.save('rooms', selectedRooms),
          db.save('tables', reconciledTables),
          db.save('parkedTickets', nextParkedTickets),
          db.save('customers', nextCustomers),
          ...(routedCatalog.updatedProducts.length > 0
            ? [db.save('products', routedCatalog.products)]
            : []),
        ]);
        customersCreatedByClients.forEach((customer: Customer) => {
          queueCustomerMutation('UPSERT', customer).then(() => backgroundSyncManager.triggerSync()).catch(error => {
            console.warn('[MASTER_LAN] No se pudo colocar cliente nuevo en la cola ERP:', error);
          });
        });
        console.info('[MASTER_LAN] Applied client restaurant mutation', {
          revision,
          rooms: nextRooms.length,
          tables: nextTables.length,
          parkedTickets: nextParkedTickets.length,
          customers: nextCustomers.length,
          productRoutes: routedCatalog.updatedProducts.length,
        });
      } catch (error) {
        console.warn('[MASTER_LAN] Could not reconcile native restaurant state:', error);
      } finally {
        masterRestaurantPollInFlightRef.current = false;
      }
    };

    const pollNativeRestaurantRevision = async () => {
      if (disposed || masterRestaurantPollInFlightRef.current) return;
      if (currentViewRef.current === 'TABLE_DESIGNER' || activeTableEditLockRef.current) return;
      const nativeBridge = (window as any).ClicPOSNativePrinter;
      if (typeof nativeBridge?.getMasterRestaurantRevision !== 'function') {
        await reconcileNativeRestaurantState();
        return;
      }
      if (!isNativeStandaloneTerminalRuntime(getCurrentTerminal())) return;

      try {
        const rawRevision = await Promise.resolve(nativeBridge.getMasterRestaurantRevision({}));
        const revisionPayload = parseNativeBridgeJson(rawRevision);
        const revision = Number(revisionPayload?.revision || 0);
        if (!Number.isFinite(revision) || revision <= masterRestaurantRevisionRef.current) return;
        await reconcileNativeRestaurantState();
      } catch (error) {
        console.warn('[MASTER_LAN] Could not poll native restaurant revision:', error);
      }
    };

    const ensureMasterServerHealth = async () => {
      if (disposed) return;
      const nativeBridge = (window as any).ClicPOSNativePrinter;
      if (!isNativeStandaloneTerminalRuntime(getCurrentTerminal())) return;
      if (typeof nativeBridge?.getMasterServerStatus !== 'function') {
        await ensureMasterServer(false);
        return;
      }

      try {
        const rawStatus = await Promise.resolve(nativeBridge.getMasterServerStatus({ port: 3001 }));
        const status = parseNativeBridgeJson(rawStatus);
        if (!status?.running) {
          await ensureMasterServer(false);
        }
      } catch (error) {
        console.warn('[MASTER_LAN] Could not verify native server health:', error);
      }
      await pollNativeRestaurantRevision();
    };

    // Iniciar/actualizar configuración sin publicar rooms/tables/tickets. El
    // servidor nativo es la fuente operativa después de su bootstrap inicial.
    // Initial collection hydration updates several dependencies in a short burst.
    // Coalesce those renders so only the final catalog snapshot crosses the native bridge.
    const initialPublishTimer = window.setTimeout(() => {
      void ensureMasterServer(false).then(() => reconcileNativeRestaurantState());
    }, 250);
    let catalogPublishTimer: number | undefined;
    const publishMasterCatalog = () => {
      if (catalogPublishTimer) window.clearTimeout(catalogPublishTimer);
      catalogPublishTimer = window.setTimeout(() => {
        catalogPublishTimer = undefined;
        void ensureMasterServer(false);
      }, 250);
    };
    const watchdog = window.setInterval(() => void ensureMasterServerHealth(), 30000);
    const restaurantPoll = window.setInterval(() => void pollNativeRestaurantRevision(), 1000);
    window.addEventListener('online', ensureMasterServerHealth);
    window.addEventListener('productionAreasUpdated', publishMasterCatalog);
    const handleVisibilityChange = () => {
      if (!document.hidden) void ensureMasterServerHealth();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const appPlugin = (window as any).Capacitor?.Plugins?.App;
    const resumeListener = appPlugin?.addListener?.('resume', ensureMasterServerHealth);
    const stateListener = appPlugin?.addListener?.('appStateChange', (state: { isActive?: boolean }) => {
      if (state?.isActive) void ensureMasterServerHealth();
    });

    return () => {
      disposed = true;
      window.clearTimeout(initialPublishTimer);
      if (catalogPublishTimer) window.clearTimeout(catalogPublishTimer);
      window.clearInterval(watchdog);
      window.clearInterval(restaurantPoll);
      window.removeEventListener('online', ensureMasterServerHealth);
      window.removeEventListener('productionAreasUpdated', publishMasterCatalog);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      resumeListener?.remove?.();
      stateListener?.remove?.();
    };
  }, [
    collections,
    config,
    customers,
    getCurrentTerminal,
    internalSequences,
    isDataLoaded,
    productStocks,
    products,
    receptions,
    roles,
    suppliers,
    transfers,
    users,
    warehouses,
  ]);

  useEffect(() => {
    if (currentView !== 'TABLE_DESIGNER') {
      defaultRoomBootstrapRef.current = false;
      return;
    }
    if (!isDataLoaded) return;

    if (rooms.length === 0) {
      if (defaultRoomBootstrapRef.current) return;
      defaultRoomBootstrapRef.current = true;

      const defaultRoomId = `R-${Date.now()}`;
      const defaultRoom: Room = {
        id: defaultRoomId,
        name: 'Sala 1',
        nombre: 'Sala 1',
        orden: 1
      };
      const repairedTables = tables.map(table => (
        table.roomId ? table : { ...table, roomId: defaultRoomId }
      ));

      setRooms([defaultRoom]);
      setActiveRoomId(defaultRoomId);
      if (repairedTables.some((table, index) => table !== tables[index])) {
        setTables(repairedTables);
      }

      void (async () => {
        await db.save('rooms', [defaultRoom]);
        if (repairedTables.length > 0) {
          await db.save('tables', repairedTables);
        }
      })().catch(error => console.error('No se pudo crear la sala predeterminada:', error));
      return;
    }

    defaultRoomBootstrapRef.current = false;
    const fallbackRoomId = rooms[0].id;
    if (!activeRoomId || !rooms.some(room => room.id === activeRoomId)) {
      setActiveRoomId(fallbackRoomId);
    }

    const hasOrphanTables = tables.some(table => !table.roomId || !rooms.some(room => room.id === table.roomId));
    if (hasOrphanTables) {
      const repairedTables = tables.map(table => (
        table.roomId && rooms.some(room => room.id === table.roomId)
          ? table
          : { ...table, roomId: fallbackRoomId }
      ));
      setTables(repairedTables);
      void (async () => {
        await db.save('tables', repairedTables);
      })().catch(error => console.error('No se pudieron reparar las mesas del plano:', error));
    }
  }, [activeRoomId, currentView, isDataLoaded, rooms, tables]);

  const safeExitSnapshotRef = useRef<SafeExitSnapshot>({
    currentView,
    cart: [],
    parkedTickets: [],
    cashMovements: [],
    selectedCustomer: null,
    activeTable: null,
  });

  useEffect(() => {
    safeExitSnapshotRef.current = {
      currentView,
      cart,
      parkedTickets,
      cashMovements,
      selectedCustomer,
      activeTable,
      terminalId: getCurrentTerminal()?.id,
    };
  }, [currentView, cart, parkedTickets, cashMovements, selectedCustomer, activeTable, getCurrentTerminal]);

  useEffect(() => {
    if (!isDataLoaded || currentView !== 'POS') return;
    void persistActiveCartDraftSnapshot(safeExitSnapshotRef.current, 'cart_state_changed').catch((error) => {
      console.warn('No se pudo persistir el borrador activo del carrito:', error);
    });
  }, [cart, selectedCustomer, activeTable, currentView, isDataLoaded]);

  useEffect(() => {
    if (!isDataLoaded || cart.length > 0 || activeCartDraftRestorePrompt) return;
    let cancelled = false;

    const loadDraft = async () => {
      const localDraft = readActiveCartDraftFromLocalStorage();
      if (localDraft) {
        if (!cancelled) setActiveCartDraftRestorePrompt(localDraft);
        return;
      }

      try {
        const dbDraft = normalizeActiveCartDraft(await db.get('activeCartDraft' as any));
        if (dbDraft && !cancelled) {
          setActiveCartDraftRestorePrompt(dbDraft);
        }
      } catch (error) {
        console.warn('No se pudo leer el borrador activo del carrito:', error);
      }
    };

    void loadDraft();
    return () => {
      cancelled = true;
    };
  }, [activeCartDraftRestorePrompt, cart.length, isDataLoaded]);

  useEffect(() => {
    if (!isDataLoaded) return;

    const flushNow = (reason: string) => {
      void persistCriticalLocalStateSnapshot(safeExitSnapshotRef.current, {
        reason,
        parkActiveCart: false,
      }).catch((error) => {
        console.warn(`No se pudo persistir estado critico (${reason}):`, error);
      });
    };

    const markBackground = (reason: string) => {
      isAppInBackgroundRef.current = true;
      appBackgroundSinceRef.current = Date.now();
      persistActiveUserSession(currentUserRef.current, currentViewRef.current);
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      flushNow(reason);
    };

    const markForeground = () => {
      isAppInBackgroundRef.current = false;
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        markBackground('visibility_hidden');
      } else {
        markForeground();
      }
    };
    const handlePageHide = () => flushNow('pagehide');
    const handleBeforeUnload = () => flushNow('beforeunload');

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);

    const appPlugin = (window as any).Capacitor?.Plugins?.App;
    const pauseListener = appPlugin?.addListener?.('pause', () => markBackground('capacitor_pause'));
    const resumeListener = appPlugin?.addListener?.('resume', () => markForeground());
    const stateListener = appPlugin?.addListener?.('appStateChange', (state: { isActive?: boolean }) => {
      if (state?.isActive === false) markBackground('capacitor_inactive');
      if (state?.isActive === true) markForeground();
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      pauseListener?.remove?.();
      resumeListener?.remove?.();
      stateListener?.remove?.();
    };
  }, [isDataLoaded]);

  const [kioskRedeemedCoupon, setKioskRedeemedCoupon] = useState<RedeemedCouponRef | null>(null);
  const [kioskCouponBenefit, setKioskCouponBenefit] = useState<KioskCouponBenefit | null>(null);
  useEffect(() => {
    setPosSaleActivity({ active: cart.length > 0, cartCount: cart.length });
    return () => setPosSaleActivity({ active: false, cartCount: 0 });
  }, [cart.length]);

  useEffect(() => {
    const inputSensitiveViews = new Set<ViewState>([
      'LOGIN',
      'POS',
      'ATTENDANCE',
      'TABLE_MAP',
      'KIOSK_WELCOME',
      'KIOSK_BROWSER',
      'KIOSK_PAYMENT',
      'SETTINGS',
      'SETTINGS_SYNC',
    ]);
    if (!inputSensitiveViews.has(currentView)) return;

    const markInteraction = () => markPosInteractionActivity(5000);
    const pointerOptions: AddEventListenerOptions = { capture: true, passive: true };
    const keyOptions: AddEventListenerOptions = { capture: true };

    window.addEventListener('pointerdown', markInteraction, pointerOptions);
    window.addEventListener('touchstart', markInteraction, pointerOptions);
    window.addEventListener('keydown', markInteraction, keyOptions);

    return () => {
      window.removeEventListener('pointerdown', markInteraction, pointerOptions);
      window.removeEventListener('touchstart', markInteraction, pointerOptions);
      window.removeEventListener('keydown', markInteraction, keyOptions);
    };
  }, [currentView]);

  useEffect(() => {
    if (!selectedCustomer?.id) return;
    const refreshedCustomer = customers.find(customer => customer.id === selectedCustomer.id);
    if (!refreshedCustomer || refreshedCustomer === selectedCustomer) return;

    const selectedWalletBalance = Number(selectedCustomer.wallet?.balance || 0);
    const refreshedWalletBalance = Number(refreshedCustomer.wallet?.balance || 0);
    const selectedCustomerImage = resolveCustomerImageSrc(selectedCustomer);
    const refreshedCustomerImage = resolveCustomerImageSrc(refreshedCustomer);
    const shouldRefreshSelection =
      refreshedCustomer.name !== selectedCustomer.name ||
      refreshedCustomer.currentDebt !== selectedCustomer.currentDebt ||
      refreshedCustomer.creditLimit !== selectedCustomer.creditLimit ||
      refreshedCustomer.updatedAt !== selectedCustomer.updatedAt ||
      refreshedCustomerImage !== selectedCustomerImage ||
      refreshedWalletBalance !== selectedWalletBalance;

    if (shouldRefreshSelection) {
      setSelectedCustomer(refreshedCustomer);
    }
  }, [customers, selectedCustomer]);

  const findCustomerByKioskLookup = useCallback((rawValue: string): Customer | null => {
    const token = normalizeKioskLookupValue(rawValue);
    const digits = digitsOnly(rawValue);
    if (!token && !digits) return null;

    return (customers || []).find((customer) => {
      const customerTokens = [
        customer.id,
        customer.taxId,
        customer.email,
        customer.phone,
        customer.loyalty?.cardNumber,
      ].map(normalizeKioskLookupValue);
      const cardMatch = (customer.cards || []).some((card) =>
        card.status === 'ACTIVE' && normalizeKioskLookupValue(card.cardNumber) === token
      );
      const tokenMatch = token ? customerTokens.includes(token) : false;
      const digitMatch = digits
        ? [customer.phone, customer.taxId, customer.loyalty?.cardNumber]
            .map(digitsOnly)
            .filter(Boolean)
            .includes(digits)
        : false;

      return cardMatch || tokenMatch || digitMatch;
    }) || null;
  }, [customers]);

  const applyKioskCartPromotions = useCallback((
    items: CartItem[],
    customerOverride: Customer | null = selectedCustomer
  ): CartItem[] => {
    const currentTerminalId = getCurrentTerminal()?.id || 'T1';
    return applyPromotions(
      resetPromotionCartForRepricing(items),
      config,
      currentTerminalId,
      customerOverride || undefined
    );
  }, [config, getCurrentTerminal, selectedCustomer]);

  const clearKioskCoupon = useCallback(() => {
    setKioskRedeemedCoupon(null);
    setKioskCouponBenefit(null);
  }, []);

  const handleKioskCustomerLookup = useCallback((value: string) => {
    const customer = findCustomerByKioskLookup(value);
    if (!customer) {
      return {
        success: false,
        message: 'Cliente no encontrado. Verifique el ID, tarjeta, RNC o teléfono.',
      };
    }

    setSelectedCustomer(customer);
    setCart(prev => applyKioskCartPromotions(prev, customer));

    return {
      success: true,
      message: `OK: Cliente identificado: ${customer.name}`,
    };
  }, [applyKioskCartPromotions, findCustomerByKioskLookup]);

  const clearKioskCustomerSelection = useCallback(() => {
    setSelectedCustomer(null);
    setCart(prev => applyKioskCartPromotions(prev, null));
    if (kioskRedeemedCoupon?.assignedTo) {
      clearKioskCoupon();
    }
  }, [applyKioskCartPromotions, clearKioskCoupon, kioskRedeemedCoupon?.assignedTo]);

  const handleKioskCouponRedeem = useCallback((code: string) => {
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) {
      return { success: false, message: 'Digite o escanee un cupón válido.' };
    }

    if (kioskRedeemedCoupon) {
      return {
        success: false,
        message: `Ya hay un cupón aplicado: ${kioskRedeemedCoupon.code}.`,
      };
    }

    const cartGrossTotal = roundMoney(cart.reduce((sum, item) => {
      return sum + Math.abs((Number(item.price) || 0) * (Number(item.quantity) || 0));
    }, 0));
    const result = couponService.validateCoupon(
      normalizedCode,
      config,
      cartGrossTotal,
      selectedCustomer?.id
    );

    if (!result.success) {
      return {
        success: false,
        message: result.error || 'No se pudo canjear el cupón.',
      };
    }

    if (result.coupon) {
      setKioskRedeemedCoupon({
        id: result.coupon.id,
        code: result.coupon.code,
        campaignId: result.coupon.campaignId,
        assignedTo: result.coupon.assignedTo,
      });
    }
    if (result.benefit) {
      setKioskCouponBenefit(result.benefit);
    }

    return {
      success: true,
      message: `OK: ${result.benefit?.description || 'Cupón aplicado'}`,
    };
  }, [cart, config, kioskRedeemedCoupon, selectedCustomer?.id]);

  const getKioskCouponDiscountAmount = useCallback((cartTotal: number): number => {
    if (!kioskCouponBenefit) return 0;
    if (kioskCouponBenefit.type === 'PERCENT') {
      return roundMoney(cartTotal * (Math.max(0, kioskCouponBenefit.value) / 100));
    }
    if (kioskCouponBenefit.type === 'FIXED_AMOUNT') {
      return roundMoney(Math.min(Math.max(0, kioskCouponBenefit.value), cartTotal));
    }
    return 0;
  }, [kioskCouponBenefit]);

  const normalizeTerminalId = (value?: string | null) => (value || '').trim().toLowerCase();
  const getTerminalReferenceKeys = (terminalId: string) => {
    const normalizedInput = normalizeTerminalId(terminalId);
    const terminal = (config.terminals || []).find((candidate) => {
      const refs = [
        candidate.id,
        candidate.config?.erpTerminalId,
        candidate.config?.erpBinding?.terminalId,
        candidate.config?.erpBinding?.terminalName,
      ].map(normalizeTerminalId).filter(Boolean);
      return refs.includes(normalizedInput);
    });

    return new Set(
      [
        terminalId,
        terminal?.id,
        terminal?.config?.erpTerminalId,
        terminal?.config?.erpBinding?.terminalId,
        terminal?.config?.erpBinding?.terminalName,
      ]
        .map(normalizeTerminalId)
        .filter(Boolean)
    );
  };
  const terminalReferenceMatches = (aliases: Set<string>, isDefaultTerminal: boolean, ...values: Array<string | null | undefined>) => {
    const normalizedValues = values.map(normalizeTerminalId).filter(Boolean);
    if (normalizedValues.length === 0) return isDefaultTerminal;
    return normalizedValues.some(value => aliases.has(value));
  };
  const isRestaurantVertical = (value?: string | null) => value === 'RESTAURANT' || value === 'RESTAURANTE';
  const isRestaurantTerminal = (terminal?: any) =>
    isRestaurantVertical(terminal?.config?.operational?.vertical_negocio) || config.vertical === 'RESTAURANT';

  const getLatestZCloseTimestamp = (terminalId: string) => {
    const terminalAliases = getTerminalReferenceKeys(terminalId);
    const isDefaultTerminal = terminalAliases.has('t1');

    return zReports
      .filter(r => terminalReferenceMatches(terminalAliases, isDefaultTerminal, r.terminalId, r.source_terminal_id))
      .map(r => new Date(r.closedAt).getTime())
      .filter((value) => Number.isFinite(value))
      .reduce((max, value) => value > max ? value : max, 0);
  };

  const getPendingTransactionsForTerminal = (terminalId: string) => {
    const terminalAliases = getTerminalReferenceKeys(terminalId);
    const isDefaultTerminal = terminalAliases.has('t1');
    const latestCloseTs = getLatestZCloseTimestamp(terminalId);

    const pending = transactions.filter(t => {
      const belongsToTerminal = terminalReferenceMatches(terminalAliases, isDefaultTerminal, t.terminalId, t.source_terminal_id);
      if (!belongsToTerminal) return false;
      if (t.zReportId) return false;
      if (isRecoveredOperation(t)) return true;

      // Relaxed timestamp check: only filter out if it's significantly before the last close
      // to account for clock drift between terminals.
      const txTime = new Date(t.date).getTime();
      const DRIFT_TOLERANCE_MS = 1000 * 60 * 5; // 5 minutes tolerance
      if (!Number.isFinite(txTime)) return latestCloseTs <= 0;
      return latestCloseTs <= 0 || txTime > (latestCloseTs - DRIFT_TOLERANCE_MS);
    });

    return pending.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  };

  const getPendingCashMovementsForTerminal = (terminalId: string) => {
    const terminalAliases = getTerminalReferenceKeys(terminalId);
    const isDefaultTerminal = terminalAliases.has('t1');
    const latestCloseTs = getLatestZCloseTimestamp(terminalId);

    return cashMovements.filter(m => {
      const belongsToTerminal = terminalReferenceMatches(terminalAliases, isDefaultTerminal, m.terminalId, (m as any).source_terminal_id);
      if (!belongsToTerminal) return false;
      if ((m as any).zReportId) return false;
      if (isRecoveredOperation(m)) return true;

      const moveTime = new Date(m.timestamp).getTime();
      const DRIFT_TOLERANCE_MS = 1000 * 60 * 5; // 5 minutes tolerance
      if (!Number.isFinite(moveTime)) return latestCloseTs <= 0;
      return latestCloseTs <= 0 || moveTime > (latestCloseTs - DRIFT_TOLERANCE_MS);
    });
  };

  const handleOpenZReport = async () => {
    try {
      const terminal = getCurrentTerminal();
      const terminalRole = terminal?.config?.deviceRole?.role
        || terminal?.config?.terminalType
        || terminal?.config?.terminal_type;
      if (terminalRole === DeviceRole.ORDER_TAKER) {
        console.warn('[ORDER_TAKER_FINANCIAL_CLOSING_BLOCKED]', 'Z_REPORT');
        return;
      }
      const terminalIds = Array.from(getTerminalReferenceKeys(terminal?.id || 'T1'));
      const reconciliation = await reconcileTransactionsForZPreview(transactions, {
        loadHistory: async () => ((await db.get('transactionHistory')) as Transaction[]) || [],
        loadReports: async () => ((await db.get('zReports')) as ZReport[]) || [],
        deleteActive: async (transactionId) => db.deleteDocument('transactions', transactionId),
      }, { terminalIds });

      if (reconciliation.removedClosed.length > 0) {
        console.warn(
          `Z_PREVIEW_MEMBERSHIP_RECONCILED count=${reconciliation.removedClosed.length}`
          + ` lastClosedDocument=${reconciliation.lastClosedDocumentId || 'unknown'}`
        );
      }
      setTransactions(reconciliation.transactions);
      setViewData(undefined);
      setCurrentView('Z_REPORT');
    } catch (error) {
      console.error('Z_PREVIEW_MEMBERSHIP_FAILED', error);
      alert('No se pudo comprobar la pertenencia de las ventas a cierres anteriores. No se abrió el cierre Z.');
    }
  };

  const handleOpenFinanceFromPos = (initialCashMovementType?: 'IN' | 'OUT' | 'X_REPORT') => {
    const terminal = getCurrentTerminal();
    const terminalRole = terminal?.config?.deviceRole?.role
      || terminal?.config?.terminalType
      || terminal?.config?.terminal_type;
    if (initialCashMovementType === 'X_REPORT' && terminalRole === DeviceRole.ORDER_TAKER) {
      console.warn('[ORDER_TAKER_FINANCIAL_CLOSING_BLOCKED]', 'X_REPORT');
      return;
    }
    handleViewChange('FINANCE', { initialCashMovementType });
  };

  const belongsToCurrentCashier = useCallback((record?: { userId?: string | null; userName?: string | null }) => {
    if (!currentUser) return false;
    const currentUserId = (currentUser.id || '').trim();
    if (currentUserId && (record?.userId || '').trim() === currentUserId) return true;
    const currentUserName = (currentUser.name || '').trim().toLowerCase();
    return Boolean(currentUserName && (record?.userName || '').trim().toLowerCase() === currentUserName);
  }, [currentUser]);

  const reconcileTablesWithParkedTickets = useCallback((sourceTables: Table[], tickets: ParkedTicket[] = []): Table[] => {
    const ticketTotal = (ticket: ParkedTicket) =>
      typeof ticket.total === 'number'
        ? Number(ticket.total || 0)
        : (ticket.items || []).reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
    const byOrderId = new Map<string, ParkedTicket>();
    const byTableId = new Map<string, ParkedTicket>();

    (tickets || []).forEach(ticket => {
      const ticketId = String(ticket?.id || '').trim();
      if (!ticketId) return;
      // Una cuenta recién abierta es válida aunque todavía no tenga artículos.
      // La liberación debe llegar por el flujo explícito de cierre, no inferirse
      // a partir de un carrito temporalmente vacío.
      byOrderId.set(ticketId, ticket);
      if (ticket.tableId !== undefined && ticket.tableId !== null) {
        byTableId.set(String(ticket.tableId), ticket);
      }
      const joinedTableIds = Array.isArray((ticket as any).joinedTableIds)
        ? (ticket as any).joinedTableIds
        : [];
      joinedTableIds.forEach((joinedTableId: unknown) => {
        const normalizedId = String(joinedTableId || '').trim();
        if (normalizedId) byTableId.set(normalizedId, ticket);
      });
    });

    return (sourceTables || []).map(table => {
      const tableId = String(table.id);
      const orderTicket = table.currentOrderId ? byOrderId.get(String(table.currentOrderId)) : undefined;
      const orderTicketTableId = orderTicket?.tableId !== undefined && orderTicket?.tableId !== null
        ? String(orderTicket.tableId)
        : '';
      const joinedTableIds = Array.isArray((orderTicket as any)?.joinedTableIds)
        ? (orderTicket as any).joinedTableIds.map((id: unknown) => String(id))
        : [];
      const canLinkByOrder = Boolean(
        orderTicket &&
        (
          !orderTicketTableId ||
          orderTicketTableId === tableId ||
          joinedTableIds.includes(tableId) ||
          String((table as any).joinedTableId || '') === orderTicketTableId ||
          String((table as any).joinedSourceTableId || '') === tableId
        )
      );
      const linkedTicket = (canLinkByOrder ? orderTicket : undefined)
        || byTableId.get(tableId);
      if (!linkedTicket) {
        const hasStaleOccupancy =
          table.status === 'OCCUPIED' &&
          (table.currentOrderId || Number(table.currentOrderTotal || 0) > 0);
        if (!hasStaleOccupancy) return table;
        return {
          ...table,
          status: 'FREE',
          currentOrderId: undefined,
          currentOrderTotal: undefined,
          timeSeated: undefined,
          waiterId: undefined,
          waiterName: undefined,
          joinedTableId: undefined,
          joinedTableName: undefined,
          joinedSourceTableId: undefined,
          joinedSourceTableName: undefined
        } as Table;
      }

      const primaryTableId = String(linkedTicket.primaryTableId || linkedTicket.tableId || '').trim();
      const linkedTableIds = Array.isArray(linkedTicket.joinedTableIds)
        ? linkedTicket.joinedTableIds.map(String)
        : [];
      const isSharedAccount = Boolean(primaryTableId && linkedTableIds.length > 1);
      const primaryTable = sourceTables.find(candidate => String(candidate.id) === primaryTableId);
      const primaryTableName = String(primaryTable?.nombre || primaryTable?.name || '').trim();
      const isSecondaryTable = isSharedAccount && tableId !== primaryTableId;

      return {
        ...table,
        status: 'OCCUPIED',
        currentOrderId: linkedTicket.id,
        currentOrderTotal: isSecondaryTable ? 0 : ticketTotal(linkedTicket),
        timeSeated: table.timeSeated || linkedTicket.timestamp,
        guests: Number(linkedTicket.guests || 0) > 0
          ? Number(linkedTicket.guests)
          : table.guests,
        joinedSourceTableId: isSharedAccount ? primaryTableId : undefined,
        joinedSourceTableName: isSharedAccount ? primaryTableName : undefined,
        joinedTableId: isSharedAccount ? (isSecondaryTable ? primaryTableId : table.joinedTableId) : undefined,
        joinedTableName: isSharedAccount ? (isSecondaryTable ? primaryTableName : table.joinedTableName) : undefined,
      } as Table;
    });
  }, []);

  const markClientMasterOnline = () => {
    if (!isClientTerminalMode()) return;
    clientMasterFailureCountRef.current = 0;
    clientMasterLastSuccessAtRef.current = Date.now();
    setClientMasterTablesStatus('ONLINE');
  };

  const recordClientMasterFailure = (source: string, error: unknown): boolean => {
    clientMasterFailureCountRef.current += 1;
    const failureCount = clientMasterFailureCountRef.current;
    const hadRecentSuccess = Date.now() - clientMasterLastSuccessAtRef.current < 15_000;
    const shouldBlock = failureCount >= (hadRecentSuccess ? 3 : 2);
    if (shouldBlock) setClientMasterTablesStatus('OFFLINE');
    console.error(shouldBlock ? '[TABLE_LAYOUT_CLIENT_BLOCKED]' : '[TABLE_LAYOUT_CLIENT_RETRY]', {
      source,
      masterUrl: localStorage.getItem('CLIC_POS_MASTER_URL') || localStorage.getItem('pos_master_ip'),
      consecutiveFailures: failureCount,
      reason: error instanceof Error ? error.message : String(error)
    });
    return shouldBlock;
  };

  const ensureEligibleClientMasterEndpoint = async (): Promise<string> => {
    const candidates: Array<{ host: string; source: 'STORED' | 'CLOUD' | 'LAN' }> = [];
    const appendCandidate = (value: string | null | undefined, source: 'STORED' | 'CLOUD' | 'LAN') => {
      const host = normalizeMasterHost(value || '');
      if (host && !candidates.some(candidate => candidate.host === host)) candidates.push({ host, source });
    };
    appendCandidate(localStorage.getItem('CLIC_POS_MASTER_URL'), 'STORED');
    appendCandidate(localStorage.getItem('pos_master_ip'), 'STORED');

    const tryCandidates = async (): Promise<string | null> => {
      for (const candidate of candidates) {
        for (const baseUrl of buildMasterUrlCandidates(candidate.host)) {
          if (clientValidatedMasterBaseUrlRef.current === baseUrl) return baseUrl;
          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), 2500);
          try {
            const response = await fetch(`${baseUrl}/api/config`, { signal: controller.signal });
            if (!response.ok) continue;
            const remoteConfig = await response.json();
            if (!isEligibleOperationalMasterConfig(remoteConfig)) {
              console.warn('[MASTER_DISCOVERY] Se rechazó KDS/terminal no-Master', { baseUrl });
              continue;
            }
            const resolvedHost = normalizeMasterHost(new URL(baseUrl).hostname);
            localStorage.setItem('pos_master_ip', resolvedHost);
            localStorage.setItem('CLIC_POS_MASTER_URL', baseUrl);
            localStorage.setItem('CLIC_POS_MASTER_DISCOVERY', candidate.source);
            clientValidatedMasterBaseUrlRef.current = baseUrl;
            return baseUrl;
          } catch {
            // Probar siguiente candidato conocido o descubierto.
          } finally {
            window.clearTimeout(timeoutId);
          }
        }
      }
      return null;
    };

    const storedOrKnown = await tryCandidates();
    if (storedOrKnown) return storedOrKnown;

    const cloudEndpoint = await resolveMasterEndpointFromCloud().catch(() => null);
    appendCandidate(cloudEndpoint?.localIp || cloudEndpoint?.endpointUrl, 'CLOUD');
    const cloudResolved = await tryCandidates();
    if (cloudResolved) return cloudResolved;

    const lanCandidates = await discoverLanMasterCandidates({ timeoutMs: 2500 });
    lanCandidates.forEach(candidate => appendCandidate(candidate.host, 'LAN'));
    const lanResolved = await tryCandidates();
    if (lanResolved) return lanResolved;

    throw new Error('No se encontró una Caja Master operativa; se descartaron KDS y terminales auxiliares.');
  };

  const fetchTables = async () => {
    const isClientRuntime = isClientTerminalMode();
    if (isClientRuntime && clientMasterTablesFetchInFlightRef.current) {
      return;
    }
    if (isClientRuntime) clientMasterTablesFetchInFlightRef.current = true;
    try {
      const terminalId = getCurrentTerminal()?.id;
      const query = terminalId ? `?terminal_id=${encodeURIComponent(terminalId)}` : '';
      const endpoint = isClientRuntime
        ? `${await ensureEligibleClientMasterEndpoint()}/api/mesas${query}`
        : resolveOperationalApiUrl(`/api/mesas${query}`);
      const res = await fetch(endpoint);
      if (!res.ok) {
        throw new Error(`Master respondió HTTP ${res.status}`);
      }
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('application/json')) {
          throw new Error('API de mesas no disponible en este entorno.');
        }
        const data = await res.json();
        const responseRevision = Number(data?.revision || 0);
        const hasUnchangedClientRevision = isClientRuntime
          && Number.isFinite(responseRevision)
          && responseRevision > 0
          && responseRevision === lastAppliedClientRestaurantRevisionRef.current;
        if (Number.isFinite(responseRevision) && responseRevision > masterRestaurantRevisionRef.current) {
          masterRestaurantRevisionRef.current = responseRevision;
        }
        const hasAuthoritativeParkedTickets = Array.isArray(data?.parkedTickets);
        const responseParkedTickets = hasAuthoritativeParkedTickets ? data.parkedTickets : [];
        let pendingTableSync = isClientRuntime
          ? pendingClientTableSyncRef.current
          : pendingMasterTableSyncRef.current;
        if (isClientRuntime && !pendingTableSync) {
          pendingTableSync = await readPendingClientTableSync();
          if (pendingTableSync) pendingClientTableSyncRef.current = pendingTableSync;
        }
        if (hasUnchangedClientRevision && !pendingTableSync) {
          markClientMasterOnline();
          console.debug('[TABLE_LAYOUT_CLIENT_UNCHANGED]', { revision: responseRevision });
          return;
        }
        const nextParkedTickets = hasAuthoritativeParkedTickets
          ? mergePendingClientTableTickets(responseParkedTickets, pendingTableSync)
          : [];
        const ticketsForReconciliation = hasAuthoritativeParkedTickets ? nextParkedTickets : parkedTickets;
        const mergeRemoteTables = (incomingTables: Table[], previousTables: Table[]) => {
          if (isClientRuntime) {
            return reconcileTablesWithParkedTickets(incomingTables, ticketsForReconciliation);
          }

          const localFloorPlan = locallySavedFloorPlanRef.current;
          const allowedIncoming = localFloorPlan
            ? incomingTables.filter(table => localFloorPlan.tableIds.has(String(table.id)))
            : incomingTables;

          if (previousTables.length === 0) {
            return reconcileTablesWithParkedTickets(allowedIncoming, ticketsForReconciliation);
          }

          const incomingById = new Map(allowedIncoming.map(table => [String(table.id), table]));
          const merged = previousTables.map(localTable => {
            const remoteTable = incomingById.get(String(localTable.id));
            if (!remoteTable) return localTable;
            incomingById.delete(String(localTable.id));
            if (!localFloorPlan) return { ...localTable, ...remoteTable };
            return {
              ...remoteTable,
              ...localTable,
              status: remoteTable.status ?? localTable.status,
              currentOrderId: remoteTable.currentOrderId,
              currentOrderTotal: remoteTable.currentOrderTotal,
              timeSeated: remoteTable.timeSeated,
              waiterId: remoteTable.waiterId,
              waiterName: remoteTable.waiterName,
              // El snapshot de la Master es autoritativo para los locks. Cuando
              // editingLock no viene, el lock ya fue liberado y debe borrarse
              // en vez de conservar la copia local del render anterior.
              editingLock: remoteTable.editingLock
            };
          });

          incomingById.forEach(table => merged.push(table));
          // El endpoint ya entregó el snapshot atómico de mesas y órdenes.
          // No reconciliar contra el closure anterior: después de cobrar aún
          // podía contener la orden cerrada y volver a poner la mesa en rojo.
          return reconcileTablesWithParkedTickets(merged, ticketsForReconciliation);
        };

        // Backward compatibility: some endpoints may return only Table[].
        if (Array.isArray(data)) {
          markClientMasterOnline();
          setTables(previousTables => {
            if (!isClientRuntime && data.length === 0 && previousTables.length > 0) {
              console.warn('Se ignoró una respuesta vacía de mesas para preservar el layout local.');
              return previousTables;
            }
            return mergeRemoteTables(data, previousTables);
          });
          return;
        }

        const nextTables = Array.isArray(data?.tables) ? data.tables : [];
        const nextRooms = Array.isArray(data?.rooms) ? data.rooms : [];
        if (isClientRuntime) {
          markClientMasterOnline();
          locallySavedFloorPlanRef.current = {
            roomIds: new Set(nextRooms.map((room: Room) => String(room.id))),
            tableIds: new Set(nextTables.map((table: Table) => String(table.id)))
          };
          console.log('[TABLE_LAYOUT_CLIENT_SYNC]', {
            source: endpoint,
            rooms: nextRooms.length,
            tables: nextTables.length
          });
        }

        // También en Master el snapshot remoto es autoritativo. Esto evita
        // restaurar una cuenta ya cobrada al regresar a la pantalla de mesas.
        if (hasAuthoritativeParkedTickets) setParkedTickets(nextParkedTickets);

        setTables(previousTables => {
          if (!isClientRuntime && nextTables.length === 0 && previousTables.length > 0) {
            console.warn('Se ignoró una respuesta vacía de mesas para preservar el layout local.');
            return previousTables;
          }
          return mergeRemoteTables(nextTables, previousTables);
        });

        if (isClientRuntime) {
          setRooms(nextRooms);
          setActiveRoomId(prev =>
            prev && nextRooms.some((room: Room) => room.id === prev)
              ? prev
              : (nextRooms[0]?.id || '')
          );
          if (Number.isFinite(responseRevision) && responseRevision > 0) {
            lastAppliedClientRestaurantRevisionRef.current = responseRevision;
          }
        } else if (nextRooms.length > 0) {
          setRooms(previousRooms => {
            const localFloorPlan = locallySavedFloorPlanRef.current;
            if (!localFloorPlan || previousRooms.length === 0) return nextRooms;

            const incomingById = new Map<string, Room>(
              nextRooms
                .filter((room: Room) => localFloorPlan.roomIds.has(String(room.id)))
                .map((room: Room) => [String(room.id), room])
            );
            const merged = previousRooms.map(localRoom => {
              const remoteRoom = incomingById.get(String(localRoom.id));
              if (!remoteRoom) return localRoom;
              incomingById.delete(String(localRoom.id));
              return { ...remoteRoom, ...localRoom };
            });
            incomingById.forEach(room => merged.push(room));
            return merged;
          });
          setActiveRoomId(prev =>
            prev && nextRooms.some((room: Room) => room.id === prev)
              ? prev
              : (nextRooms[0]?.id || '')
          );
        }
      }
    } catch (e) {
      console.warn("Failed to fetch tables from Master/API:", e);
      if (isClientRuntime) {
        recordClientMasterFailure('tables_poll', e);
        return;
      }
      console.warn('Using local rooms/tables because this terminal owns its operational database.');
      try {
        const [localRooms, localTables] = await Promise.all([
          db.get('rooms') as Promise<Room[]>,
          db.get('tables') as Promise<Table[]>
        ]);
        const nextRooms = Array.isArray(localRooms) ? localRooms : [];
        const nextTables = Array.isArray(localTables) ? localTables : [];
        setTables(previousTables => {
          if (nextTables.length > 0) {
            return reconcileTablesWithParkedTickets(nextTables, parkedTickets);
          }
          if (previousTables.length > 0) return previousTables;
          return reconcileTablesWithParkedTickets(persistedFloorPlanMirror?.tables || [], parkedTickets);
        });
        if (nextRooms.length > 0) {
          setRooms(nextRooms);
          setActiveRoomId(prev =>
            prev && nextRooms.some((room: Room) => room.id === prev)
              ? prev
              : (nextRooms[0]?.id || '')
          );
        } else if (persistedFloorPlanMirror?.rooms?.length) {
          setRooms(persistedFloorPlanMirror.rooms);
          setActiveRoomId(prev =>
            prev && persistedFloorPlanMirror.rooms.some(room => room.id === prev)
              ? prev
              : persistedFloorPlanMirror.rooms[0].id
          );
        }
      } catch (fallbackError) {
        console.error('Failed to load tables from local DB:', fallbackError);
      }
    } finally {
      if (isClientRuntime) clientMasterTablesFetchInFlightRef.current = false;
    }
  };

  const invokeTableEditLock = useCallback(async (
    action: 'acquire' | 'release',
    payload: Record<string, unknown>
  ): Promise<any> => {
    const nativeBridge = (window as any).ClicPOSNativePrinter;
    const currentTerminal = getCurrentTerminal();
    const servesAsNativeMaster =
      isNativeAndroidRuntime() &&
      isNativeStandaloneTerminalRuntime(currentTerminal);
    const bridgeMethod = action === 'acquire'
      ? nativeBridge?.acquireMasterTableLock
      : nativeBridge?.releaseMasterTableLock;

    if (servesAsNativeMaster && typeof bridgeMethod === 'function') {
      return parseNativeBridgeJson(await Promise.resolve(bridgeMethod.call(nativeBridge, payload)));
    }

    const endpoint = action === 'acquire'
      ? '/api/mesas/bloquear'
      : '/api/mesas/desbloquear';
    const response = await requestJson<any>({
      url: resolveOperationalApiUrl(endpoint),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 5000,
      diagnosticContext: { operation: `TABLE_LOCK_${action.toUpperCase()}` },
    });
    const result = response.data;
    if (!response.ok || result?.success === false) {
      const error = new Error(result?.message || `Master respondió HTTP ${response.status}`);
      (error as any).code = result?.code;
      (error as any).lock = result?.lock;
      throw error;
    }
    return result;
  }, [getCurrentTerminal]);

  const releaseActiveTableEditLock = useCallback(async (
    options: {
      deferRemote?: boolean;
      waitForPersistence?: boolean;
      trace?: ReturnType<typeof getLatestPosInteraction>;
    } = {},
  ): Promise<boolean> => {
    const lock = activeTableEditLockRef.current;
    if (!lock) {
      markInteractionStage(options.trace, 'LOCAL_UNLOCK');
      return true;
    }

    const tableId = String(lock.tableId);
    lastTableInteractionAtRef.current = performance.now();
    const existingRelease = pendingTableLockReleasesRef.current.get(tableId);
    if (existingRelease?.lock.token === lock.token) {
      markInteractionStage(options.trace, 'LOCAL_UNLOCK');
      return options.deferRemote ? true : existingRelease.promise;
    }
    tableLockLifecycleVersionRef.current += 1;

    // LOCAL_COMMITTED: retirar el lock de la memoria interactiva antes de
    // esperar SQLite, Outbox o la Master. El lock remoto continúa vigente hasta
    // que la cola durable previa haya terminado y protege a otras terminales.
    activeTableEditLockRef.current = null;
    setActiveTableEditLock(null);
    setTables(previousTables => previousTables.map(table => (
      String(table.id) === tableId
        ? { ...table, editingLock: undefined }
        : table
    )));
    markInteractionStage(options.trace, 'LOCAL_UNLOCK');

    const persistenceBarrier = parkedTicketSyncQueueRef.current.catch((error) => {
      console.warn('[TABLE_SYNC] La última actualización falló antes de liberar la mesa:', error);
    });
    const pendingRelease = {
      lock,
      phase: 'PERSIST_PENDING' as const,
      promise: Promise.resolve(true),
    } as PendingTableLockRelease;

    const releaseOperation = (async (): Promise<boolean> => {
      if (options.waitForPersistence !== false) await persistenceBarrier;
      if (pendingTableLockReleasesRef.current.get(tableId) !== pendingRelease) return true;
      pendingRelease.phase = 'RELEASING';
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (pendingTableLockReleasesRef.current.get(tableId) !== pendingRelease) return true;
        try {
          await invokeTableEditLock('release', {
            tableId: lock.tableId,
            ownerId: lock.ownerId,
            token: lock.token,
          });
          return true;
        } catch (error) {
          console.warn(`[TABLE_EDIT_LOCK] No se pudo confirmar liberación (intento ${attempt}/3):`, error);
          if (attempt < 3) {
            await new Promise<void>(resolve => window.setTimeout(resolve, attempt * 250));
          }
        }
      }
      console.error('[TABLE_EDIT_LOCK_RELEASE_FAILED]', {
        tableId,
        ownerId: lock.ownerId,
        recovery: 'REMOTE_LOCK_RETAINS_TTL_AND_LOCAL_OWNER_CAN_REACQUIRE',
      });
      return false;
    })();

    pendingRelease.promise = releaseOperation.finally(() => {
      if (pendingTableLockReleasesRef.current.get(tableId) === pendingRelease) {
        pendingTableLockReleasesRef.current.delete(tableId);
      }
    });
    pendingTableLockReleasesRef.current.set(tableId, pendingRelease);
    return options.deferRemote ? true : pendingRelease.promise;
  }, [invokeTableEditLock]);

  const acquireTableEditLock = useCallback(async (table: Table): Promise<boolean> => {
    const tableId = String(table.id || '').trim();
    if (!tableId) return false;
    lastTableInteractionAtRef.current = performance.now();
    const ownerId = String(deviceId || getCurrentTerminal()?.config?.currentDeviceId || '').trim();
    if (!ownerId) {
      alert('No se pudo identificar este dispositivo para bloquear la mesa.');
      return false;
    }

    const currentLock = activeTableEditLockRef.current;
    if (currentLock && currentLock.tableId !== tableId) {
      const released = await releaseActiveTableEditLock({ deferRemote: true });
      if (!released) {
        alert('No se pudo liberar la mesa anterior. Reintente antes de abrir otra mesa.');
        return false;
      }
    }

    // No permitir que una misma terminal acumule locks remotos al recorrer mesas.
    // Antes de tomar otra, confirmar todas las liberaciones anteriores.
    const priorReleases = Array.from(pendingTableLockReleasesRef.current.entries())
      .filter(([pendingTableId]) => pendingTableId !== tableId)
      .map(([, pendingRelease]) => pendingRelease.promise);
    if (priorReleases.length > 0) {
      const releaseResults = await Promise.all(priorReleases);
      if (releaseResults.some(released => !released)) {
        alert('No se pudo liberar la mesa anterior en la Caja Master. Reintente antes de abrir otra mesa.');
        await fetchTables();
        return false;
      }
    }

    const pendingRelease = pendingTableLockReleasesRef.current.get(tableId);
    let reusableLock = currentLock?.tableId === tableId ? currentLock : undefined;
    if (pendingRelease?.phase === 'PERSIST_PENDING') {
      // La reapertura inmediata cancela el release antes de enviarlo y conserva
      // el token que ya protege esta mesa frente a otras terminales.
      pendingTableLockReleasesRef.current.delete(tableId);
      reusableLock = pendingRelease.lock;
    } else if (pendingRelease?.phase === 'RELEASING') {
      // Si el release remoto ya salió, terminarlo antes de solicitar un lock
      // nuevo evita una carrera que podría dejar la mesa sin protección real.
      await pendingRelease.promise;
    }

    try {
      const result = await invokeTableEditLock('acquire', {
        tableId,
        ownerId,
        terminalId: getCurrentTerminal()?.id,
        userId: currentUser?.id,
        userName: currentUser?.name,
        token: reusableLock?.token,
      });
      const lock = result?.lock;
      if (!result?.success || !lock?.token) {
        throw new Error(result?.message || 'No se pudo bloquear la mesa.');
      }
      activeTableEditLockRef.current = lock as ActiveTableEditLock;
      setActiveTableEditLock(lock as ActiveTableEditLock);
      return true;
    } catch (error: any) {
      const lockedBy = String(error?.lock?.userName || error?.lock?.terminalId || 'otra terminal');
      alert(error?.code === 'TABLE_EDIT_LOCKED'
        ? `Esta mesa está siendo digitada por ${lockedBy}. Intente nuevamente cuando vuelva al mapa de mesas.`
        : (error?.message || 'No se pudo bloquear la mesa.'));
      await fetchTables();
      return false;
    }
  }, [
    currentUser?.id,
    currentUser?.name,
    deviceId,
    getCurrentTerminal,
    invokeTableEditLock,
    releaseActiveTableEditLock,
  ]);

  useEffect(() => {
    if (!activeTableEditLock || (currentView !== 'POS' && currentView !== 'CUSTOMERS')) return;
    const heartbeat = window.setInterval(() => {
      const lifecycleVersion = tableLockLifecycleVersionRef.current;
      const heartbeatToken = activeTableEditLock.token;
      void invokeTableEditLock('acquire', {
        tableId: activeTableEditLock.tableId,
        ownerId: activeTableEditLock.ownerId,
        terminalId: activeTableEditLock.terminalId || getCurrentTerminal()?.id,
        userId: activeTableEditLock.userId || currentUser?.id,
        userName: activeTableEditLock.userName || currentUser?.name,
        token: activeTableEditLock.token,
      }).then(result => {
        const currentLock = activeTableEditLockRef.current;
        if (
          lifecycleVersion !== tableLockLifecycleVersionRef.current ||
          currentLock?.tableId !== activeTableEditLock.tableId ||
          currentLock?.token !== heartbeatToken
        ) {
          return;
        }
        if (result?.success && result?.lock?.token) {
          activeTableEditLockRef.current = result.lock as ActiveTableEditLock;
          setActiveTableEditLock(result.lock as ActiveTableEditLock);
        }
      }).catch(error => {
        console.warn('[TABLE_EDIT_LOCK] Heartbeat falló:', error);
      });
    }, 15_000);
    return () => window.clearInterval(heartbeat);
  }, [
    activeTableEditLock,
    currentUser?.id,
    currentUser?.name,
    currentView,
    getCurrentTerminal,
    invokeTableEditLock,
  ]);

  const retryClientMasterConnection = useCallback(async () => {
    clientMasterFailureCountRef.current = 0;
    setClientMasterTablesStatus('CHECKING');
    const candidates: Array<{ host: string; source: 'STORED' | 'CLOUD' | 'LAN' }> = [];
    const appendCandidate = (value: string | null | undefined, source: 'STORED' | 'CLOUD' | 'LAN') => {
      const host = normalizeMasterHost(value || '');
      if (host && !candidates.some(candidate => candidate.host === host)) candidates.push({ host, source });
    };
    appendCandidate(localStorage.getItem('CLIC_POS_MASTER_URL'), 'STORED');
    appendCandidate(localStorage.getItem('pos_master_ip'), 'STORED');
    const attemptedBaseUrls = new Set<string>();

    const tryCandidates = async (): Promise<boolean> => {
      for (const candidate of candidates) {
        for (const baseUrl of buildMasterUrlCandidates(candidate.host)) {
          if (attemptedBaseUrls.has(baseUrl)) continue;
          attemptedBaseUrls.add(baseUrl);
          let timeout: number | undefined;
          try {
            const controller = new AbortController();
            timeout = window.setTimeout(() => controller.abort(), 2500);
            const [response, configResponse] = await Promise.all([
              fetch(`${baseUrl}/api/sync/ping`, { signal: controller.signal }),
              fetch(`${baseUrl}/api/config`, { signal: controller.signal }),
            ]);
            if (!response.ok || !configResponse.ok) continue;
            const remoteConfig = await configResponse.json();
            if (!isEligibleOperationalMasterConfig(remoteConfig)) {
              console.warn('[MASTER_DISCOVERY] Se rechazó un terminal no-Master', { baseUrl });
              continue;
            }

            const resolvedHost = normalizeMasterHost(new URL(baseUrl).hostname);
            localStorage.setItem('pos_master_ip', resolvedHost);
            localStorage.setItem('CLIC_POS_MASTER_URL', baseUrl);
            localStorage.setItem('CLIC_POS_MASTER_DISCOVERY', candidate.source);
            await fetchTables();
            return true;
          } catch {
            // Try the next URL/host before declaring the Master offline.
          } finally {
            if (timeout !== undefined) window.clearTimeout(timeout);
          }
        }
      }
      return false;
    };

    if (await tryCandidates()) return;

    try {
      const cloudEndpoint = await resolveMasterEndpointFromCloud();
      appendCandidate(cloudEndpoint?.localIp || cloudEndpoint?.endpointUrl, 'CLOUD');
      if (await tryCandidates()) return;

      const lanCandidates = await discoverLanMasterCandidates({ timeoutMs: 2500 });
      lanCandidates.forEach(candidate => appendCandidate(candidate.host, 'LAN'));
      if (await tryCandidates()) return;
    } catch (error) {
      console.warn('[MASTER_LAN] Rediscovery failed:', error);
    }

    setClientMasterTablesStatus('OFFLINE');
  }, [fetchTables]);

  const openTableForService = useCallback(async (table: Table): Promise<Table | null> => {
    if (!currentUser) return null;

    const nowIso = new Date().toISOString();
    const baseUpdate = {
      ...table,
      status: 'FREE' as const,
      timeSeated: table.timeSeated || nowIso,
      waiterId: currentUser.id,
      waiterName: currentUser.name
    };

    try {
      const res = await requestJson<any>({
        url: resolveOperationalApiUrl('/api/mesas/abrir'),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          waiterId: currentUser.id,
          waiterName: currentUser.name
        }),
        timeoutMs: 5000,
        diagnosticContext: { operation: 'TABLE_OPEN' },
      });

      const data = res.data;
      if (res.ok && data.status === 'success') {
        markClientMasterOnline();
        const responseRevision = Number(data?.revision || 0);
        if (Number.isFinite(responseRevision) && responseRevision > masterRestaurantRevisionRef.current) {
          masterRestaurantRevisionRef.current = responseRevision;
        }
        const updated = { ...baseUpdate, currentOrderId: data.orden_id };
        setTables(prev => {
          const next = prev.map(t => t.id === updated.id ? updated : t);
          if (canUseLocalOperationalTableStore()) {
            db.save('tables', next).catch(error => console.error('Failed to persist tables:', error));
          }
          return next;
        });
        return updated;
      }

      alert(data?.message || 'Error abriendo mesa');
      return null;
    } catch (error) {
      console.warn('Table service not available, opening table locally:', error);
      if (isClientTerminalMode()) {
        recordClientMasterFailure('open_table', error);
        return null;
      }
    }

    const localOrderId = table.currentOrderId || `ORD-${Date.now()}`;
    const updated = { ...baseUpdate, currentOrderId: localOrderId };
    setTables(prev => {
      const next = prev.map(t => t.id === updated.id ? updated : t);
      db.save('tables', next).catch(error => console.error('Failed to persist tables:', error));
      return next;
    });
    return updated;
  }, [currentUser]);

  useKioskMode(getCurrentDeviceRoleRaw() === DeviceRole.SELF_CHECKOUT);

  useEffect(() => {
    if (!isDataLoaded || isAdminMode) return;
    if (['VISOR', 'ACTIVATION', 'SETTINGS', 'TERMINAL_PAIRING', 'TERMINAL_BINDING', 'SETUP', 'VERTICAL_SELECTOR'].includes(currentView)) {
      return;
    }

    const role = getCurrentDeviceRoleRaw();
    if (!role) return;

    const roleDefaultView: Partial<Record<DeviceRole, ViewState>> = {
      [DeviceRole.ORDER_TAKER]: 'TABLE_MAP',
      [DeviceRole.SELF_CHECKOUT]: 'KIOSK_WELCOME',
      [DeviceRole.PRICE_CHECKER]: 'CHECKER_SCAN',
      [DeviceRole.KITCHEN_DISPLAY]: 'KITCHEN_ORDERS',
    };
    const roleAllowedViews: Partial<Record<DeviceRole, ViewState[]>> = {
      [DeviceRole.ORDER_TAKER]: ['LOGIN', 'TABLE_MAP', 'POS'],
      [DeviceRole.SELF_CHECKOUT]: ['KIOSK_WELCOME', 'KIOSK_BROWSER', 'KIOSK_PAYMENT'],
      [DeviceRole.PRICE_CHECKER]: ['CHECKER_SCAN'],
      [DeviceRole.KITCHEN_DISPLAY]: ['KITCHEN_ORDERS'],
    };
    if (roleAllowedViews[role]?.includes(currentView)) return;

    const targetView = roleDefaultView[role];
    if (!targetView || currentView === targetView) return;

    if (role === DeviceRole.SELF_CHECKOUT) {
      clearSecurityState();
      setCurrentUser(null);
      recordCheckoutDiagnostic('CART_CLEAR_REQUEST', { items: cart, tableId: activeTable?.id, orderId: activeTable?.currentOrderId, reason: 'APP_CLEAR_01' });
      setCart([]);
    }
    setCurrentView(targetView);
  }, [clearSecurityState, currentView, getCurrentDeviceRole, isAdminMode, isDataLoaded]);

  const scannerEnabledViews = currentView === 'POS'
    || currentView === 'HISTORY'
    || currentView === 'KIOSK_BROWSER'
    || currentView === 'KIOSK_WELCOME';

  useBarcodeScanner({
    enabled: scannerEnabledViews,
    onScan: (barcode) => {
      if (currentView === 'KIOSK_WELCOME') {
        clearSecurityState();
        setCurrentView('KIOSK_BROWSER');

        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('barcodeScanned', { detail: { barcode } }));
        }, 0);
        return;
      }

      window.dispatchEvent(new CustomEvent('barcodeScanned', { detail: { barcode } }));
    },
    onTicketScan: currentView === 'POS' || currentView === 'HISTORY'
      ? (ticketId) => {
        console.log(`🎟️ Smart Scan: Opening Ticket History for ${ticketId}`);
        setScanTargetTicketId(ticketId);
        setCurrentView('HISTORY');
      }
      : undefined
  });

  const inventoryCountSync = useOfflineInventoryCountSync({ enabled: isDataLoaded });

  useEffect(() => {
    const status = nativePrintBridge.getContractStatus();
    if (!status.available) {
      console.log('🖨️ Native print bridge not detected (running with web/agent fallback).');
      return;
    }

    console.log('🖨️ Native print bridge detected:', status);
  }, []);

  const flushOfflinePrintQueue = useCallback(async () => {
    if (!isDataLoaded || isPosSaleActive()) return;

    try {
      const result = await offlinePrintQueueService.processPendingQueue(config);
      if (result.processed > 0) {
        console.log(`🖨️ Offline print queue processed: ${result.processed} jobs`);
      }
    } catch (error) {
      const message = String((error as any)?.message || error || '');
      if (message.toLowerCase().includes('db not connected')) {
        return;
      }
      console.warn('Offline print queue processing failed:', error);
    }
  }, [config, isDataLoaded]);

  useEffect(() => {
    if (!isDataLoaded) return;

    const wakeQueue = () => {
      flushOfflinePrintQueue().catch(console.error);
    };

    const handleVisibility = () => {
      if (document.hidden) return;
      wakeQueue();
    };

    const intervalId = window.setInterval(wakeQueue, 15000);
    window.addEventListener('online', wakeQueue);
    window.addEventListener('offlinePrintQueueWake', wakeQueue as EventListener);
    window.addEventListener(POS_SALE_ACTIVITY_EVENT, wakeQueue as EventListener);
    document.addEventListener('visibilitychange', handleVisibility);

    wakeQueue();

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', wakeQueue);
      window.removeEventListener('offlinePrintQueueWake', wakeQueue as EventListener);
      window.removeEventListener(POS_SALE_ACTIVITY_EVENT, wakeQueue as EventListener);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [flushOfflinePrintQueue, isDataLoaded]);

  // Cola de fidelización EGO Club: altas de socio y devengos pendientes se reintentan
  // al arrancar, al recuperar conexión y periódicamente. Nunca bloquea el cobro.
  useEffect(() => {
    if (!isDataLoaded) return;

    let cancelled = false;
    const flush = () => {
      if (cancelled) return;
      flushLoyaltyOutbox().catch(error => console.warn('[EGO CLUB] flush de cola falló:', error));
    };

    const handleVisibility = () => {
      if (document.hidden) return;
      flush();
    };

    const intervalId = window.setInterval(flush, 60000);
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', handleVisibility);

    flush();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isDataLoaded]);

  useEffect(() => {
    const handleAutoPrint = async (event: Event) => {
      const detail = (event as CustomEvent<any>)?.detail || {};
      const rawItems = Array.isArray(detail.items) ? detail.items : [];
      if (!rawItems.length) return;

      const templates = (config.labelTemplates && config.labelTemplates.length > 0)
        ? config.labelTemplates
        : DEFAULT_LABEL_TEMPLATES;
      const template = templates.find(t => t.category === 'ARTICLE') || templates[0];
      if (!template) return;

      const records = rawItems
        .map((item: any) => ({
          productId: String(item.productId || ''),
          productName: String(item.productName || item.productId || 'Producto'),
          sku: item.sku ? String(item.sku) : undefined,
          price: typeof item.price === 'number' ? item.price : undefined,
          copies: Math.max(1, Math.floor(Number(item.quantityReceived ?? item.copies ?? 1)))
        }))
        .filter((record: any) => !!record.productId && record.copies > 0);

      if (!records.length) return;

      try {
        await printLabelsFromTemplate({
          config,
          template,
          records,
          terminalId: detail.terminalId || getCurrentTerminal()?.id,
          referenceId: detail.referenceId || `${detail.source || 'AUTO_LABEL'}-${Date.now()}`
        });
        await flushOfflinePrintQueue();
      } catch (error) {
        console.warn('Auto label print flow failed:', error);
      }
    };

    window.addEventListener('autoPrintLabelRequested', handleAutoPrint as EventListener);
    return () => window.removeEventListener('autoPrintLabelRequested', handleAutoPrint as EventListener);
  }, [config, flushOfflinePrintQueue, getCurrentTerminal]);

  useEffect(() => {
    // Only the isolated Presentation may enter VISOR. MainActivity can briefly
    // inherit the same query while Android restores its WebView.
    if (isCustomerDisplaySurface()) {
      console.log("📺 VISOR MODE DETECTED: Initialization bypass.");
      setCurrentView('VISOR');
    } else if (isCustomerDisplayView(currentViewRef.current)) {
      setCurrentView('LOGIN');
    }
  }, []);

  useEffect(() => {
    if (!isDataLoaded || forceSyncHandledRef.current) return;

    const params = new URLSearchParams(window.location.search);
    if (params.get('force_sync_tickets') !== '1') return;

    forceSyncHandledRef.current = true;

    const normalizeTerminalId = (value?: string | null) => (value || '').trim().toLowerCase();
    const normalizeFolio = (value?: string | null) => (value || '').trim().toUpperCase();
    const parseFolio = (value?: string | null): { prefix: string; seq: number } | null => {
      const normalized = normalizeFolio(value);
      const match = normalized.match(/^([A-Z]+)(\d+)$/);
      if (!match) return null;
      return { prefix: match[1], seq: Number(match[2]) };
    };

    const cleanupForceParams = () => {
      [
        'force_sync_tickets',
        'terminal',
        'folio_from',
        'folio_to',
        'folios'
      ].forEach((key) => params.delete(key));
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash || ''}`;
      window.history.replaceState({}, '', nextUrl);
    };

    const run = async () => {
      try {
        const terminalFilter = normalizeTerminalId(params.get('terminal'));
        const foliosParam = params.get('folios');
        const fromFolio = parseFolio(params.get('folio_from'));
        const toFolio = parseFolio(params.get('folio_to'));

        const explicitFolios = (foliosParam || '')
          .split(',')
          .map((item) => normalizeFolio(item))
          .filter(Boolean);
        const explicitSet = new Set(explicitFolios);

        const hasRange =
          !!fromFolio &&
          !!toFolio &&
          fromFolio.prefix === toFolio.prefix &&
          fromFolio.seq <= toFolio.seq;

        const allTransactions = await db.get('transactions') as Transaction[] || [];
        if (!Array.isArray(allTransactions) || allTransactions.length === 0) {
          alert('No hay transacciones locales para forzar sincronizacion.');
          return;
        }

        let matched = 0;
        let marked = 0;

        const updatedTransactions = allTransactions.map((tx: any) => {
          const txTerminal = normalizeTerminalId(tx?.terminalId);
          if (terminalFilter && txTerminal !== terminalFilter) return tx;

          const displayId = normalizeFolio(tx?.displayId);
          let shouldMatch = false;

          if (explicitSet.size > 0 && explicitSet.has(displayId)) {
            shouldMatch = true;
          } else if (hasRange && displayId) {
            const parsed = parseFolio(displayId);
            if (parsed && parsed.prefix === fromFolio!.prefix && parsed.seq >= fromFolio!.seq && parsed.seq <= toFolio!.seq) {
              shouldMatch = true;
            }
          }

          if (!shouldMatch) return tx;

          matched++;
          const alreadyPending = tx.syncStatus === 'PENDING' && tx._forceSyncReplay === true;
          if (alreadyPending) return tx;

          marked++;
          return {
            ...tx,
            syncStatus: 'PENDING',
            syncError: 'Forced sync link replay',
            _forceSyncReplay: true
          };
        });

        if (matched === 0) {
          alert('No se encontraron tickets locales que coincidan con el link forzado.');
          return;
        }

        if (marked > 0) {
          await db.save('transactions', updatedTransactions as any);
        }

        await backgroundSyncManager.triggerSync();

        alert(`Forzado aplicado: ${matched} ticket(s) coinciden, ${marked} marcado(s) para reenvio.`);
      } catch (error: any) {
        console.error('Forced ticket sync failed:', error);
        alert(`Error en forzado de tickets: ${error?.message || 'Error desconocido'}`);
      } finally {
        cleanupForceParams();
      }
    };

    run().catch((error) => {
      console.error('Forced ticket sync bootstrap failed:', error);
      cleanupForceParams();
    });
  }, [isDataLoaded]);

  const handleViewChange = (view: ViewState, data?: any) => {
    console.log(`🚀 View Change: ${currentView} -> ${view}`, data);
    let nextData = data;
    if (view === 'INVENTORY_COUNT' && !data?.countSessionId) {
      nextData = { ...(data || {}), countSessionId: `COUNT-${Date.now()}` };
    }
    if (view === 'TABLE_MAP') {
      // Refresh immediately when returning to table map to avoid stale colors.
      fetchTables().catch((error) => console.error('Failed to refresh tables on TABLE_MAP view:', error));
    }
    setViewData(nextData);
    React.startTransition(() => {
      setCurrentView(view);
    });
  };

  const validateSupervisorPin = React.useCallback((pin: string): boolean => {
    const cleanedPin = pin.trim();
    if (!cleanedPin) return false;

    const supervisorCandidate = users.find(user => user.pin === cleanedPin);
    if (!supervisorCandidate) return false;

    const roleId = supervisorCandidate.roleId || supervisorCandidate.role;
    const role = roles.find(r => r.id === roleId);
    if (!role) return false;

    const roleName = role.name.toLowerCase();
    const hasSupervisorPrivileges =
      role.permissions.includes('ALL') ||
      role.permissions.includes('SETTINGS_ACCESS') ||
      roleName.includes('super') ||
      roleName.includes('admin') ||
      roleName.includes('gerente');

    return hasSupervisorPrivileges;
  }, [users, roles]);

  useEffect(() => {
    setSupervisorPinValidator(validateSupervisorPin);
  }, [setSupervisorPinValidator, validateSupervisorPin]);

  // --- EMERGENCY RESCUE MECHANISM ---
  useEffect(() => {
    const handleEmergencyReset = async (e: KeyboardEvent) => {
      // Shortcut: Ctrl + Shift + Alt + U (Unbind)
      if (e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyU') {
        if (await clicConfirm('🚨 EMERGENCY RESET: This will unbind this terminal and clear local database config. Continue?')) {
          try {
            console.warn("🧺 EMERGENCY UNBIND TRIGGERED");
            localStorage.removeItem('pos_master_ip');
            localStorage.removeItem('CLIC_POS_MASTER_URL');
            localStorage.removeItem('pos_sync_status');

            // Wipe Local DB Config to avoid stale Slave/Master role mismatch
            await db.deleteDocument('config', 'config' as any);
            await restorePersistentDeviceIdAfterDbReset();

            alert("Terminal Desvinculada. La aplicación se reiniciará.");
            window.location.reload();
          } catch (err) {
            console.error("Failed to perform emergency reset:", err);
            alert("Error doing reset. Please clear browser cache manually.");
          }
        }
      }
    };

    window.addEventListener('keydown', handleEmergencyReset);
    return () => window.removeEventListener('keydown', handleEmergencyReset);
  }, []);

  // --- INITIAL DATA LOAD ---
  useEffect(() => {
    if (initLoadStartedRef.current) return;
    initLoadStartedRef.current = true;

    // The secondary Presentation WebView only renders the customer visor and
    // shares its state with MainActivity through localStorage/BroadcastChannel.
    // It has no Capacitor bridge, so running the POS bootstrap here would use
    // the web database and attempt a redundant security sync.
    if (isCustomerDisplaySurface()) {
      console.log('📺 Customer visor surface: skipping POS data and security bootstrap.');
      return;
    }

    const loadData = async () => {
      console.log('🚀 loadData started');
      const markBootStage = createStartupTrace();
      markBootStage('STARTED');
      try {
        console.log('⏳ Calling db.init()...');
        const data = await Promise.race([
          db.init(),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => {
              reject(new Error('Timeout inicializando base local (IndexedDB). Si persiste, cierra otras pestañas de CLIC POS y reintenta.'));
            }, 60000);
          })
        ]);
        console.log('✅ db.init() returned:', data ? Object.keys(data) : 'null');
        markBootStage('LOCAL_DATABASE_READY');

        if (isSyncFeatureEnabled('sqlite_outbox_v2')) {
          if (!durableOutboxRepository.isSupported()) {
            throw new Error('POS-2A requiere el adaptador SQLite nativo.');
          }
          const recoveredLeases = await durableOutboxRepository.recoverExpiredLeases();
          const recoveredPaymentIntents = await paymentIntentService.recoverAbandoned();
          if (recoveredLeases > 0) {
            console.warn(`[POS-2A] Recovered ${recoveredLeases} abandoned outbox lease(s).`);
          }
          if (recoveredPaymentIntents > 0) {
            console.warn(`[POS-2A] Flagged ${recoveredPaymentIntents} interrupted payment intent(s) for reconciliation.`);
          }
        }

        let currentConfig = data.config;
        const normalizedBootConfig = normalizeTerminalDocumentAssignments(currentConfig);
        if (normalizedBootConfig.changed && normalizedBootConfig.config) {
          currentConfig = normalizedBootConfig.config;
          await db.save('config', currentConfig);
        }
        const tenantCompanyBootConfig = normalizeCompanyInfoFromTenantIdentity(currentConfig);
        if (tenantCompanyBootConfig.changed && tenantCompanyBootConfig.config) {
          currentConfig = tenantCompanyBootConfig.config;
          await db.save('config', currentConfig);
        }

        // 2. Gestión de Identidad de Dispositivo (early, used for safe config source selection)
        const storedDeviceId = await resolveOrCreatePersistentDeviceId();
        setDeviceId(storedDeviceId);
        const persistedTerminalCredentials = await readTerminalCredentials();
        if (
          persistedTerminalCredentials.terminalId ||
          persistedTerminalCredentials.deviceToken ||
          persistedTerminalCredentials.syncToken
        ) {
          saveTerminalCredentialsSync({
            ...persistedTerminalCredentials,
            deviceId: persistedTerminalCredentials.deviceId || storedDeviceId,
            tenantId: persistedTerminalCredentials.tenantId || persistedTerminalCredentials.erpTenantId || localStorage.getItem('clic_tenant_id') || null,
          });
          console.info('terminal_credentials_loaded_from_persistent_storage', {
            terminalId: persistedTerminalCredentials.terminalId || null,
            deviceId: persistedTerminalCredentials.deviceId || storedDeviceId,
            deviceTokenPresent: Boolean(persistedTerminalCredentials.deviceToken),
            syncTokenPresent: Boolean(persistedTerminalCredentials.syncToken),
          });
        }
        const restoredPersistentOperationalIdentity = restorePersistentOperationalIdentity(
          persistedTerminalCredentials as Record<string, any>,
          storedDeviceId
        );

        const persistedTenantId = (localStorage.getItem('clic_tenant_id') || '').trim();
        const persistedTenantEmail = (localStorage.getItem('clic_tenant_email') || '').trim().toLowerCase();
        const hasActivationIdentity = Boolean(persistedTenantId && persistedTenantEmail) || restoredPersistentOperationalIdentity;
        if (!hasActivationIdentity) {
          // En primera activacion, forzamos sesion cloud limpia para evitar auto-login heredado.
          clearTenantIdentity();
          localStorage.removeItem(TERMINAL_SETUP_PENDING_KEY);
          localStorage.removeItem(TERMINAL_SETUP_MODE_KEY);
          Object.keys(localStorage)
            .filter((key) => key.startsWith('sb-'))
            .forEach((key) => localStorage.removeItem(key));
          clearPersistedSupabaseSession();
          await supabase.auth.signOut().catch((error) => {
            console.warn('[BOOT] Failed to clear stale Supabase session before activation:', error);
          });

          console.warn('[BOOT] Sistema no activado. Redirigiendo a pantalla de activación...');
          setIsDataLoaded(true);
          setIsSecurityLoaded(true);
          setCurrentView('ACTIVATION');
          return;
        }

        markBootStage('IDENTITY_READY');
        // --- LICENSE / KILL-SWITCH VALIDATION ---
        const license = await checkLicenseStatus(persistedTenantId, storedDeviceId);
        markBootStage('LICENSE_CHECKED');
        if (!license.isValid && license.cloudReachable !== false) {
          triggerLockdown(license.reason || 'Servicio Suspendido.');
          return;
        } else if (!license.isValid) {
          console.warn('[BOOT] License validation unavailable; continuing without permanent lockdown.', {
            tenantId: persistedTenantId,
            lastCloudError: license.lastCloudError || null,
          });
        }

        // IMPORTANT:
        // Only pull remote config when this device is a SLAVE (or not yet paired locally).
        // If a MASTER keeps stale pos_master_ip, blindly pulling here corrupts local runtime config.
        let masterIp = localStorage.getItem('pos_master_ip');
        const setupWizardCompleted = localStorage.getItem(SETUP_WIZARD_COMPLETED_KEY) === '1';
        const setupFlowStage = localStorage.getItem(SETUP_FLOW_STAGE_KEY);
        const setupFlowVersion = localStorage.getItem(SETUP_FLOW_VERSION_KEY);
        const setupMode = getStoredTerminalSetupMode();
        const terminalSetupPending = hasPendingTerminalSetup();
        const localTerminals = (!Array.isArray(currentConfig) && currentConfig?.terminals) ? currentConfig.terminals : [];
        let localPairedTerminal = (localTerminals || []).find(
          (t: any) => t.config?.currentDeviceId === storedDeviceId
        );
        const credentialTerminalId = String(
          persistedTerminalCredentials.terminalId
          || persistedTerminalCredentials.erpTerminalId
          || localStorage.getItem('clic_erp_sync_terminal_id')
          || localStorage.getItem('active_terminal_id')
          || ''
        ).trim();
        const hasPersistedOperationalAuth = Boolean(
          credentialTerminalId
          && (persistedTerminalCredentials.deviceToken || persistedTerminalCredentials.syncToken || localStorage.getItem('CLIC_POS_DEVICE_TOKEN') || localStorage.getItem('clic_erp_sync_token'))
        );
        if (!localPairedTerminal && hasPersistedOperationalAuth && credentialTerminalId && !Array.isArray(currentConfig)) {
          try {
            const storedInitialConfig = localStorage.getItem('initial_terminal_config');
            const parsedInitialConfig = storedInitialConfig ? JSON.parse(storedInitialConfig) : null;
            const initialTerminals = Array.isArray(parsedInitialConfig?.terminals) ? parsedInitialConfig.terminals : [];
            const matchedInitialTerminal = initialTerminals.find((terminal: any) => {
              const refs = [
                terminal?.id,
                terminal?.config?.erpTerminalId,
                terminal?.config?.erpBinding?.terminalId,
                terminal?.config?.terminalId,
                terminal?.config?.localTerminalId,
              ].map((value) => String(value || '').trim()).filter(Boolean);
              return terminal?.config?.currentDeviceId === storedDeviceId || refs.includes(credentialTerminalId);
            });

            if (matchedInitialTerminal) {
              const patchedInitialTerminal = {
                ...matchedInitialTerminal,
                config: {
                  ...(matchedInitialTerminal.config || {}),
                  currentDeviceId: storedDeviceId,
                  erpBinding: {
                    ...(matchedInitialTerminal.config?.erpBinding || {}),
                    terminalId: matchedInitialTerminal.config?.erpBinding?.terminalId || credentialTerminalId,
                    deviceId: storedDeviceId,
                  },
                },
              };
              currentConfig = {
                ...currentConfig,
                ...parsedInitialConfig,
                terminals: dedupeConfiguredTerminals([
                  ...((currentConfig as any).terminals || []),
                  ...initialTerminals.filter((terminal: any) => terminal !== matchedInitialTerminal),
                  patchedInitialTerminal,
                ]),
              };
              localPairedTerminal = (currentConfig.terminals || []).find(
                (terminal: any) => terminal.config?.currentDeviceId === storedDeviceId
              );
              await db.save('config', currentConfig);
              setConfig((prev) => ({ ...prev, ...currentConfig }));
              console.info('terminal_binding_restored_from_initial_terminal_config', {
                terminalId: localPairedTerminal?.id || credentialTerminalId,
                deviceId: storedDeviceId,
              });
            }
          } catch (error) {
            console.warn('No se pudo restaurar terminal desde initial_terminal_config durante boot:', error);
          }
        }
        if (!localPairedTerminal && hasPersistedOperationalAuth && !Array.isArray(currentConfig)) {
          const matchedCredentialTerminal = (localTerminals || []).find((terminal: any) => {
            const refs = [
              terminal?.id,
              terminal?.config?.erpTerminalId,
              terminal?.config?.erpBinding?.terminalId,
              terminal?.config?.terminalId,
              terminal?.config?.localTerminalId,
            ].map((value) => String(value || '').trim()).filter(Boolean);
            return refs.includes(credentialTerminalId);
          });
          if (matchedCredentialTerminal) {
            currentConfig = {
              ...currentConfig,
              terminals: (localTerminals || []).map((terminal: any) => {
                if (terminal !== matchedCredentialTerminal) return terminal;
                return {
                  ...terminal,
                  config: {
                    ...(terminal.config || {}),
                    currentDeviceId: storedDeviceId,
                    erpBinding: {
                      ...(terminal.config?.erpBinding || {}),
                      terminalId: terminal.config?.erpBinding?.terminalId || credentialTerminalId,
                      deviceId: storedDeviceId,
                    },
                  },
                };
              }),
            };
            localPairedTerminal = (currentConfig.terminals || []).find((terminal: any) => terminal.config?.currentDeviceId === storedDeviceId);
            await db.save('config', currentConfig);
            console.info('terminal_binding_restored_from_persistent_credentials', {
              terminalId: localPairedTerminal?.id || credentialTerminalId,
              deviceId: storedDeviceId,
            });
          }
        }
        const isVisorMode = isCustomerDisplaySurface();
        const hasStartupTransactions = Array.isArray(data.transactions) && data.transactions.length > 0;
        const shouldResumeSetupWizard =
          terminalSetupPending &&
          setupMode === 'SERVER_LOCAL' &&
          setupFlowStage === 'VERTICAL_SELECTED' &&
          !masterIp &&
          !localPairedTerminal &&
          !isVisorMode;
        const shouldResumeVerticalSelection =
          terminalSetupPending &&
          setupMode === 'SERVER_LOCAL' &&
          !setupWizardCompleted &&
          !setupFlowStage &&
          !masterIp &&
          !localPairedTerminal &&
          !isVisorMode;
        const shouldReplayLegacySetupFlow =
          setupWizardCompleted &&
          setupFlowVersion !== SETUP_FLOW_VERSION &&
          !masterIp &&
          !localPairedTerminal &&
          !isVisorMode &&
          !hasStartupTransactions &&
          isSeedSetupBusinessConfig(currentConfig);
        const shouldChooseTerminalMode =
          terminalSetupPending &&
          !isVisorMode &&
          !setupMode &&
          !localPairedTerminal;
        const shouldPairAsServerErp =
          terminalSetupPending &&
          !isVisorMode &&
          setupMode === 'SERVER_ERP' &&
          !localPairedTerminal;
        const shouldPairAsClient =
          terminalSetupPending &&
          !isVisorMode &&
          (setupMode === 'CLIENT' || setupMode === 'ORDER_TAKER') &&
          !localPairedTerminal;

        markBootStage('PAIRING_READY');
        const shouldResolveMasterFromCloud = !masterIp && (
          shouldPairAsClient || localPairedTerminal?.config?.isPrimaryNode === false
        );

        if (shouldResolveMasterFromCloud) {
          const cloudEndpoint = await resolveMasterEndpointFromCloud();
          const discoveredMasterIp = normalizeMasterHost(cloudEndpoint?.localIp || cloudEndpoint?.endpointUrl || '');
          if (discoveredMasterIp) {
            masterIp = discoveredMasterIp;
            console.log(`[BOOT] Master resuelto desde Cloud-Admin: ${discoveredMasterIp}`);
          }
        }

        if (shouldResumeSetupWizard || shouldReplayLegacySetupFlow || shouldResumeVerticalSelection) {
          const resumeView = shouldResumeSetupWizard
            ? 'SETUP'
            : 'VERTICAL_SELECTOR';
          console.log(`[BOOT] Resuming initial setup flow in ${resumeView} mode...`);
          setCurrentView(resumeView);
          setIsDataLoaded(true);
          setIsSecurityLoaded(true);
          return;
        }

        if (shouldChooseTerminalMode) {
          console.log('[BOOT] Activation completed. Waiting for server/client selection...');
          setCurrentView('TERMINAL_MODE_SELECTOR');
          setIsDataLoaded(true);
          setIsSecurityLoaded(true);
          return;
        }

        if (shouldPairAsClient) {
          console.warn('[ACTIVATION_REDIRECT_REASON]', 'CLIENT_MODE_SELECTED', { currentView, deviceId, terminalSetupMode: getStoredTerminalSetupMode() });
          setCurrentView('TERMINAL_PAIRING');
          setIsDataLoaded(true);
          setIsSecurityLoaded(true);
          return;
        }

        if (shouldPairAsServerErp) {
          console.warn('[ACTIVATION_REDIRECT_REASON]', 'ERP_DIRECT_MODE_SELECTED', { currentView, deviceId, terminalSetupMode: getStoredTerminalSetupMode() });
          setCurrentView('TERMINAL_PAIRING');
          setIsDataLoaded(true);
          setIsSecurityLoaded(true);
          return;
        }

        // --- PAIRING CHECK & REDIRECT ---
        // If no local pairing exists and we have no master IP, we are definitely unpaired.
        // We must bail OUT of the loading sequence to let the user pair.
        if (!localPairedTerminal && setupWizardCompleted) {
          console.warn('[ACTIVATION_REDIRECT_REASON]', 'NO_LOCAL_PAIRED_TERMINAL_AFTER_SETUP', { currentView, deviceId, setupWizardCompleted });
          setIsDataLoaded(true); // Stop "Loading CLIC POS..."
          setIsSecurityLoaded(true); // Bypass "Loading Security..."
          setCurrentView('TERMINAL_PAIRING');
          return;
        }

        // --- AGENDA STARTUP CHECK ---
        if (localPairedTerminal?.config?.startWithAgenda && !new URLSearchParams(window.location.search).get('view')) {
          console.log('📅 Startup: Configured to start in AGENDA mode.');
          // We set the view but still allow data loading to proceed
          // Authentication will be handled by the Agenda view or App layout if needed
          setCurrentView('AGENDA');
        }

        const shouldFetchConfigFromMaster = !!masterIp && (
          !localPairedTerminal || localPairedTerminal?.config?.isPrimaryNode === false
        );

        if (masterIp && !shouldFetchConfigFromMaster && localPairedTerminal?.config?.isPrimaryNode) {
          console.warn('⚠️ Stale pos_master_ip detected on MASTER terminal. Clearing slave pointer.');
          localStorage.removeItem('pos_master_ip');
        }

        if (shouldFetchConfigFromMaster) {
          console.log("🔄 Slave Mode: Fetching latest config from Master...");
          const fetchConfigFromMaster = async (host: string) => {
            for (const baseUrl of buildMasterUrlCandidates(host)) {
              const targetUrl = `${baseUrl}/api/config`;
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 3000);

              try {
                const res = await fetch(targetUrl, { signal: controller.signal });
                if (!res.ok) continue;

                const payload = await res.json();
                localStorage.setItem('CLIC_POS_MASTER_URL', baseUrl);
                localStorage.setItem('pos_master_ip', new URL(baseUrl).hostname);
                return payload;
              } finally {
                clearTimeout(timeoutId);
              }
            }

            return null;
          };

          try {
            let fetchedConfig = masterIp ? await fetchConfigFromMaster(masterIp) : null;

            if (!fetchedConfig) {
              const cloudEndpoint = await resolveMasterEndpointFromCloud();
              const refreshedMasterIp = normalizeMasterHost(cloudEndpoint?.localIp || cloudEndpoint?.endpointUrl || '');

              if (refreshedMasterIp && refreshedMasterIp !== masterIp) {
                console.warn(`⚠️ Master IP actualizada desde cloud: ${masterIp || 'N/D'} -> ${refreshedMasterIp}`);
                masterIp = refreshedMasterIp;
                fetchedConfig = await fetchConfigFromMaster(refreshedMasterIp);
              }
            }

            if (fetchedConfig && fetchedConfig.terminals) {
              const normalizedFetchedConfig = normalizeTerminalDocumentAssignments(fetchedConfig);
              const configFromMaster = normalizedFetchedConfig.config;
              if (configFromMaster && !Array.isArray(configFromMaster) && configFromMaster.terminals) {
                console.log("✅ Config fetched from Master. Saving to local DB...");
                await db.save('config', configFromMaster);
                currentConfig = configFromMaster;
              }
            }
          } catch (e: any) {
            console.error("❌ Failed to fetch config from Master (Timeout/Network):", e.name === 'AbortError' ? 'Timeout' : e.message);
          }
        }

        if (localPairedTerminal && currentConfig && !Array.isArray(currentConfig)) {
          persistInitialTerminalConfig(currentConfig);
          console.info('terminal_upgrade_recovery_checkpoint_refreshed', {
            terminalId: localPairedTerminal.id,
            deviceId: storedDeviceId,
            masterIp: localStorage.getItem('pos_master_ip') || null,
            setupMode: getStoredTerminalSetupMode(),
          });
        }

        markBootStage('MASTER_CONFIG_READY');
        // CLEAN SYNC CACHE if recovering from error
        const lastStatus = localStorage.getItem('pos_sync_status');
        if (lastStatus === 'ERROR') {
          console.warn("⚠️ Detectado reinicio tras error. Forzando Snapshot fresco.");
          localStorage.removeItem('pos_sync_status');
          await dbAdapter.saveCollection('syncMetadata', {} as any);
        }

        // EMERGENCY CLEANUP: Detect if we switched from localhost to IP (or vice versa)
        const currentOrigin = window.location.origin;
        const lastOrigin = localStorage.getItem('pos_last_origin');

        if (lastOrigin && lastOrigin !== currentOrigin) {
          console.warn(`🚨 Origin changed (${lastOrigin} -> ${currentOrigin}). NUKING LOCAL DB.`);
          localStorage.setItem('pos_last_origin', currentOrigin);
          const DB_NAME = 'clic_pos_db_v1';
          try {
            localStorage.removeItem('sync_tokens');
            localStorage.removeItem('connected_terminals');
            const req = indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = () => window.location.reload();
            return;
          } catch (e) {
            console.error("Error clearing DB:", e);
          }
        } else {
          localStorage.setItem('pos_last_origin', currentOrigin);
        }

        if (data) {
          const isErpSetupMode = isErpManagedPosUserRuntime();
          const hydrateDeferredCollections = async () => {
            // Avoid long full scans of transactions during startup for history, 
            // but ALWAYS load active transactions to ensure Monitor X / Finance Dashboard accuracy.
            try {
              console.log('📦 Loading active transactions for session...');
              console.log('📦 Loading active transactions for session...');
              const [activeTxns, txHistory, persistedZReports] = await Promise.all([
                db.get('transactions') as Promise<Transaction[]>,
                db.get('transactionHistory') as Promise<Transaction[]>,
                db.get('zReports') as Promise<ZReport[]>,
              ]);

              // --- SELF-HEAL: Commented out to prevent regression ---
              /*
              if (Array.isArray(activeTxns)) {
                // ... (Healing logic disabled)
              }
              */
              // ------------------------------------------------

              const closedTransactionIds = collectClosedTransactionIds(
                Array.isArray(txHistory) ? txHistory : [],
                Array.isArray(persistedZReports) ? persistedZReports : [],
              );
              const hydrated = partitionTransactionsByClosedMembership(
                Array.isArray(activeTxns) ? activeTxns : [],
                closedTransactionIds,
              );

              if (hydrated.closed.length > 0) {
                console.warn(`Z_MEMBERSHIP_ACTIVE_DUPLICATES_IGNORED count=${hydrated.closed.length}`);
              }

              if (hydrated.open.length > 0) {
                setTransactions(hydrated.open.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
              } else {
                setTransactions([]);
              }

              if (Array.isArray(txHistory) && txHistory.length > 0) {
                console.log(`📦 Deferred load: transactionHistory=${txHistory.length}`);
              }
            } catch (error) {
              console.info('ℹ️ Deferred hydration partial failure:', error);
            }
          };

          // 1. Cargar persistencia - PRIORITIZE currentConfig (which might be from Master)
          let finalConfig = (currentConfig && !Array.isArray(currentConfig) && Object.keys(currentConfig).length > 0) ? currentConfig : config;

          setConfig({
            ...config,
            ...finalConfig,
            campaigns: (data.campaigns && data.campaigns.length > 0) ? data.campaigns : (finalConfig.campaigns || config.campaigns || []),
            coupons: (data.coupons && data.coupons.length > 0) ? data.coupons : (finalConfig.coupons || config.coupons || [])
          });

          setUsers(visiblePosUsersForRuntime(data.users));
          setRoles(data.roles || DEFAULT_ROLES);
          // Android defers customers during db.init(); prefer the persisted
          // collection so the bootstrap fallback cannot overwrite a synced
          // customer list with an empty array.
          const persistedCustomers = await db.get('customers') as Customer[];
          // El ERP entrega loyalty_points/tier en snake_case; se normaliza en la ingesta (T3).
          setCustomers(mapCustomersFromErp(Array.isArray(persistedCustomers) ? persistedCustomers : (data.customers || [])));
          setTransactions(data.transactions || []);
          const startupProducts = Array.isArray(data.products) ? data.products : [];
          setProducts(startupProducts);
          setWarehouses(data.warehouses || []);
          const mirroredCashMovements = readArrayMirrorFromLocalStorage<CashMovement>(CASH_MOVEMENTS_STORAGE_KEY);
          const restoredCashMovements = mergeById(Array.isArray(data.cashMovements) ? data.cashMovements : [], mirroredCashMovements);
          setCashMovements(restoredCashMovements);
          if (restoredCashMovements.length > (Array.isArray(data.cashMovements) ? data.cashMovements.length : 0)) {
            void db.save('cashMovements', restoredCashMovements).catch((error) => console.warn('No se pudo restaurar movimientos de caja desde espejo local:', error));
          }
          setZReports(data.zReports || []);
          setXReports(Array.isArray(data.xReports) ? data.xReports : []);
          setPurchaseOrders(data.purchaseOrders || []);
          setSuppliers(data.suppliers || []);
          const canHydrateOperationalTicketsLocally = canUseLocalOperationalTableStore();
          const mirroredParkedTickets = canHydrateOperationalTicketsLocally
            ? readArrayMirrorFromLocalStorage<ParkedTicket>(PARKED_TICKETS_STORAGE_KEY)
            : [];
          const restoredParkedTickets = canHydrateOperationalTicketsLocally
            ? mergeById(Array.isArray(data.parkedTickets) ? data.parkedTickets : [], mirroredParkedTickets)
            : [];
          setParkedTickets(restoredParkedTickets);
          if (canHydrateOperationalTicketsLocally && restoredParkedTickets.length > (Array.isArray(data.parkedTickets) ? data.parkedTickets.length : 0)) {
            void db.save('parkedTickets', restoredParkedTickets).catch((error) => console.warn('No se pudo restaurar tickets en espera desde espejo local:', error));
          }
          setTransfers(data.transfers || []);
          setInternalSequences(data.internalSequences || []);
          setReceptions(data.receptions || []);
          setProductStocks(data.productStocks || []);
          const canHydrateTablesLocally = canUseLocalOperationalTableStore();
          const hydratedRooms = canHydrateTablesLocally
            ? (persistedFloorPlanMirror?.rooms?.length ? persistedFloorPlanMirror.rooms : (data.rooms || []))
            : [];
          const hydratedTables = canHydrateTablesLocally
            ? (persistedFloorPlanMirror?.tables?.length ? persistedFloorPlanMirror.tables : (data.tables || []))
            : [];
          setRooms(hydratedRooms);
          setTables(hydratedTables);
          setCollections(data.collections || []);
          if (hydratedRooms.length > 0) setActiveRoomId(hydratedRooms[0].id);
          setSupplierProductPrices(data.supplierProductPrices || []);

          // Transactions/history are intentionally deferred in db.init to avoid startup lockups.
          // Delay hydration a bit to reduce contention with startup writes/sync handshakes.
          window.setTimeout(() => {
            void hydrateDeferredCollections();
            void hydrateNativeCatalogFromDb(
              { setProducts, setWarehouses, setProductStocks },
              'post-boot',
            );
          }, 2000);

          // 1.5 Sequence repair is intentionally deferred; running it here can block startup
          // when transaction stores are large or locked.

          // 3. Verificación de Vinculación - USE finalConfig (Master prioritized)
          const terminals = finalConfig.terminals || [];
          let pairedTerminal = terminals.find(
            (t: any) => t.config?.currentDeviceId === storedDeviceId
          );
          if (!pairedTerminal && hasPersistedOperationalAuth && credentialTerminalId) {
            const matchedCredentialTerminal = terminals.find((terminal: any) => {
              const refs = [
                terminal?.id,
                terminal?.config?.erpTerminalId,
                terminal?.config?.erpBinding?.terminalId,
                terminal?.config?.terminalId,
                terminal?.config?.localTerminalId,
              ].map((value) => String(value || '').trim()).filter(Boolean);
              return refs.includes(credentialTerminalId);
            });
            if (matchedCredentialTerminal) {
              finalConfig = {
                ...finalConfig,
                terminals: terminals.map((terminal: any) => {
                  if (terminal !== matchedCredentialTerminal) return terminal;
                  return {
                    ...terminal,
                    config: {
                      ...(terminal.config || {}),
                      currentDeviceId: storedDeviceId,
                      erpBinding: {
                        ...(terminal.config?.erpBinding || {}),
                        terminalId: terminal.config?.erpBinding?.terminalId || credentialTerminalId,
                        deviceId: storedDeviceId,
                      },
                    },
                  };
                }),
              };
              await db.save('config', finalConfig);
              pairedTerminal = (finalConfig.terminals || []).find((terminal: any) => terminal.config?.currentDeviceId === storedDeviceId);
              setConfig((prev) => ({ ...prev, ...finalConfig }));
              console.info('terminal_binding_restored_from_persistent_credentials', {
                terminalId: pairedTerminal?.id || credentialTerminalId,
                deviceId: storedDeviceId,
              });
            }
          }
          const terminalBindingStatus = localStorage.getItem(TERMINAL_BINDING_STATUS_KEY);
          if (
            !pairedTerminal
            && !isVisorMode
            && isErpSetupMode
            && (terminalBindingStatus === 'TOKEN_INVALID' || terminalBindingStatus === 'BOUND_AUTH_MISMATCH')
          ) {
            console.log('[BOOT] ERP auth invalid. Resuming terminal pairing...', { terminalBindingStatus });
            localStorage.setItem(TERMINAL_SETUP_MODE_KEY, 'SERVER_ERP');
            localStorage.setItem(TERMINAL_SETUP_PENDING_KEY, '1');
            setCurrentView('TERMINAL_PAIRING');
            setIsDataLoaded(true);
            setIsSecurityLoaded(true);
            return;
          }

          if (!pairedTerminal && !isVisorMode && isErpSetupMode) {
            console.log('[BOOT] ERP terminal not paired on this device. Resuming terminal pairing...', {
              terminalBindingStatus,
              setupMode,
            });
            localStorage.setItem(TERMINAL_SETUP_MODE_KEY, 'SERVER_ERP');
            localStorage.setItem(TERMINAL_SETUP_PENDING_KEY, '1');
            setCurrentView('TERMINAL_PAIRING');
            setIsDataLoaded(true);
            setIsSecurityLoaded(true);
            return;
          }

          const shouldChooseTerminalModeBeforeInitialSetup =
            !setupWizardCompleted &&
            !masterIp &&
            !pairedTerminal &&
            !isVisorMode &&
            !setupMode;

          if (shouldChooseTerminalModeBeforeInitialSetup) {
            console.log('[BOOT] First installation detected. Waiting for connection mode selection...');
            localStorage.setItem(TERMINAL_SETUP_PENDING_KEY, '1');
            setCurrentView('TERMINAL_MODE_SELECTOR');
            setIsDataLoaded(true);
            setIsSecurityLoaded(true);
            return;
          }

          const shouldRunInitialSetupWizard =
            !setupWizardCompleted &&
            !masterIp &&
            !pairedTerminal &&
            !isVisorMode &&
            setupMode === 'SERVER_LOCAL';

          if (shouldRunInitialSetupWizard) {
            console.log('[BOOT] LOCAL mode selected. Launching local setup wizard...');
            setCurrentView('VERTICAL_SELECTOR');
            setIsDataLoaded(true);
            setIsSecurityLoaded(true);
            return;
          }

          if (!pairedTerminal && !isVisorMode && currentView !== 'VISOR') {
            console.warn('[ACTIVATION_REDIRECT_REASON]', 'PAIRED_TERMINAL_NOT_FOUND', { currentView, deviceId, isVisorMode });
            setCurrentView('DEVICE_UNAUTHORIZED');
          }

          // 4. Initialize Sync Manager
          if (pairedTerminal) {
            let effectivePairedTerminal = pairedTerminal;

            if (effectivePairedTerminal.config.isPrimaryNode === false && effectivePairedTerminal.config.governedByMaster) {
              console.log(`🛡️ Master Governance active for ${effectivePairedTerminal.id}. Enforcing Master config.`);
              // We already have finalConfig from Master if IP was set, but we re-enforce the terminals part
            }

            markBootStage('LOCAL_STATE_READY');
            await syncManager.initialize(finalConfig, effectivePairedTerminal.id);
            markBootStage('SYNC_INITIALIZED');

            // El login arranca desde SQLite; la verificación ERP ocurre después
            // de abrir la pantalla para no bloquear PIN/mesas con la red.
            let startupErpUsers: User[] | null = null;
            try {
              let refreshedTerminalConfig: BusinessConfig | null;
              if (isErpSetupMode) {
                const localStartupUsers = await db.get('users') as User[];
                startupErpUsers = Array.isArray(localStartupUsers) ? localStartupUsers : [];
                refreshedTerminalConfig = finalConfig;
              } else {
                refreshedTerminalConfig = await syncManager.refreshTerminalResolvedConfig(undefined, {
                  baseConfig: finalConfig,
                  dispatchEvent: false,
                  requestTimeoutMs: 8_000,
                  supplementalMode: 'background',
                });
              }

              if (refreshedTerminalConfig) {
                finalConfig = refreshedTerminalConfig;
                currentConfig = refreshedTerminalConfig;
                setConfig(refreshedTerminalConfig);
                effectivePairedTerminal =
                  (refreshedTerminalConfig.terminals || []).find(
                    (t: any) => t.id === pairedTerminal.id || t.config?.currentDeviceId === storedDeviceId
                  ) || effectivePairedTerminal;
              }
            } catch (refreshError) {
              console.warn('⚠️ Startup terminal snapshot refresh failed. Using last known local config.', refreshError);
            }

            markBootStage('TERMINAL_CONFIG_READY');

            // Auto-heal catalog/config drift on startup.
            // This catches the "2 categories / old products" mixed-state on both master and slaves.
            try {
              const normalizeCategory = (value: any) =>
                typeof value === 'string' ? value.trim().toLowerCase() : '';

              const localProducts = await db.get('products') as Product[];
              const localCount = Array.isArray(localProducts) ? localProducts.length : 0;
              const sellableCategories = new Set(
                (localProducts || [])
                  .filter((p: any) => p && p.is_sellable !== false)
                  .map((p: any) => normalizeCategory(p.category))
                  .filter(Boolean)
              );

              const terminalAllowedCategories = (effectivePairedTerminal.config?.catalog?.allowedCategories || [])
                .map((cat: any) => normalizeCategory(cat))
                .filter(Boolean);
              const matchedAllowedCategoriesCount = terminalAllowedCategories.filter(cat => sellableCategories.has(cat)).length;
              const allowedCoverageRatio = terminalAllowedCategories.length > 0
                ? matchedAllowedCategoriesCount / terminalAllowedCategories.length
                : 1;

              const hasEmptyCatalog = localCount === 0;
              const hasCategoryMismatch =
                terminalAllowedCategories.length >= 2 &&
                (matchedAllowedCategoriesCount === 0 || allowedCoverageRatio < 0.5);

              if (hasEmptyCatalog) {
                console.warn(
                  `⚠️ Empty catalog detected on ${effectivePairedTerminal.id}. ` +
                  `localProducts=${localCount}, sellableCategories=${sellableCategories.size}, allowedCategories=${terminalAllowedCategories.length}, matchedAllowed=${matchedAllowedCategoriesCount}. ` +
                  `Running forcePullAll...`
                );
                await syncManager.forcePullAll();
              } else if (hasCategoryMismatch) {
                console.warn(
                  `⚠️ Catalog category drift detected on ${effectivePairedTerminal.id}; keeping incremental sync. ` +
                  `localProducts=${localCount}, sellableCategories=${sellableCategories.size}, allowedCategories=${terminalAllowedCategories.length}, matchedAllowed=${matchedAllowedCategoriesCount}.`
                );
              }
            } catch (driftCheckError) {
              console.error('❌ Catalog auto-heal check failed:', driftCheckError);
            }

            markBootStage('CATALOG_READY');
            // Master Re-hydration Step: This ensures state is always up to date with DB 
            // after any async drift fixes or sync initializations.
            try {
              const [dbConfig, dbProducts, dbUsers, dbRoles, dbSequences] = await Promise.all([
                db.get('config') as Promise<any>,
                db.get('products') as Promise<Product[]>,
                db.get('users') as Promise<User[]>,
                db.get('roles') as Promise<RoleDefinition[]>,
                db.get('internalSequences') as Promise<any[]>
              ]);

              // CRITICAL: db.get returns an array from IndexedDB. We must unwrap config.
              let syncedConfig = dbConfig;
              if (Array.isArray(dbConfig)) {
                // CRITICAL: Seeking 'current' config and skipping meta-documents
                syncedConfig = dbConfig.find((c: any) => c.id === 'current') ||
                  dbConfig.find((c: any) => c.id !== '_db_initialized' && c.id !== 'config_metadata') ||
                  dbConfig[0];
              }

              if (syncedConfig && syncedConfig.terminals) {
                console.log('📦 App: Hydrating config from DB:', syncedConfig.id || 'main');
                setConfig(syncedConfig);
              }

              if (
                Array.isArray(dbProducts)
                && dbProducts.length > 0
                && JSON.stringify(dbProducts) !== JSON.stringify(startupProducts)
              ) {
                setProducts(dbProducts);
              }
              if (Array.isArray(dbUsers)) setUsers(visiblePosUsersForRuntime(dbUsers));
              if (Array.isArray(dbRoles)) setRoles(dbRoles);
              if (Array.isArray(dbSequences)) setInternalSequences(dbSequences);
            } catch (rehydrationError) {
              console.warn('⚠️ Post-init rehydration failed:', rehydrationError);
            }

            if (effectivePairedTerminal.config.isPrimaryNode === false) {
              syncManager.startAutoSync(30000);
              console.log('🔄 Auto-sync enabled for slave terminal');
            } else {
              syncManager.startAutoSync(45000);
              console.log('🔄 Auto-sync backup enabled for master terminal');
            }

            permissionService.initialize(finalConfig, effectivePairedTerminal.id);
            authLevelService.init(finalConfig, effectivePairedTerminal.id);
            terminalRouter.init(finalConfig, effectivePairedTerminal.id, effectivePairedTerminal.config.deviceRole || null);

            markBootStage('REHYDRATION_READY');
            markBootStage('SECURITY_STARTED');
            // --- CRITICAL SECURITY BOOTSTRAP ---
            try {
              // Prefer ERP users, but keep the default roster when ERP has no POS users yet.
              const localUsers = await db.get('users') as User[];
              let usableUsers = visiblePosUsersForRuntime(localUsers);

              if (isErpSetupMode) {
                console.log('🔒 Security Bootstrap: Refreshing authorized ERP POS users...');
                try {
                  // A background sync may have updated/revoked users since the early snapshot.
                  // Reuse the completed refresh, but read the current persisted roster.
                  const refreshedUsers = startupErpUsers !== null && usableUsers.length > 0
                    ? (Array.isArray(localUsers) ? localUsers : [])
                    : await syncManager.refreshErpPosUserRoster(finalConfig);
                  usableUsers = visiblePosUsersForRuntime(refreshedUsers);
                  const hasRefreshedErpUsers = hasErpSnapshotPosUsers(refreshedUsers);

                  if (!hasRefreshedErpUsers && usableUsers.length > 0) {
                    console.warn('[SYNC_USERS] ERP returned no POS users; preserving local operators and default roster.');
                  }
                } catch (error) {
                  console.warn('[SYNC_USERS] ERP roster refresh failed; preserving offline login roster.', error);
                }

                const persistedUsers = await db.get('users') as User[];
                const queuedLocalUsers = await queueUnsyncedLocalPosUsers(
                  Array.isArray(persistedUsers) ? persistedUsers : localUsers,
                );
                if (queuedLocalUsers > 0) {
                  console.log(`[SYNC_USERS] Queued ${queuedLocalUsers} local POS user(s) for ERP upsert.`);
                }
              } else if (!Array.isArray(localUsers) || localUsers.length === 0) {
                console.log('🔒 Security Bootstrap: No users found. Starting Fast Sync...');
                await syncManager.fastSyncCoreData();
                usableUsers = visiblePosUsersForRuntime(await db.get('users') as User[]);
              }

              if (usableUsers.length === 0) {
                throw new Error(
                  isErpSetupMode
                    ? 'El ERP no devolvió usuarios POS autorizados para esta terminal.'
                    : 'No users received from Master. Check terminal pairing.'
                );
              }

              setUsers(usableUsers);
              setIsSecurityLoaded(true);
            } catch (bootstrapErr: any) {
              console.error('❌ Security Bootstrap Failed:', bootstrapErr);
              setBootstrapError(bootstrapErr.message || 'Error loading security data.');
            }
            markBootStage('SECURITY_READY');
            // -----------------------------------

            if (!authLevelService.shouldRequireUserLogin()) {
              const authResult = await authLevelService.authenticateHeadless();
              if (authResult.success) {
                const defaultRoute = authLevelService.getDefaultRoute();
                const routeToViewMap: Record<string, ViewState> = {
                  '/pos': 'POS',
                  '/kiosk/welcome': 'KIOSK_WELCOME',
                  '/checker/scan': 'CHECKER_SCAN',
                  '/inventory/home': 'INVENTORY_HOME',
                  '/kitchen/orders': 'KITCHEN_ORDERS'
                };
                setCurrentView(routeToViewMap[defaultRoute] || 'POS');
              }
            }

            if (permissionService.isMasterTerminal()) {
              transactionSyncService.startTransactionPolling(15000, async (txns) => {
                if (txns.length === 0) return;
                const receipt = await persistInboundTransactionsIfOpen(txns, {
                  loadHistory: async () => ((await db.get('transactionHistory')) as Transaction[]) || [],
                  loadReports: async () => ((await db.get('zReports')) as ZReport[]) || [],
                  saveActive: async (transaction) => {
                    await transactionSyncService.processReceivedTransaction(transaction, async (received) => {
                      await db.saveDocument('transactions', received);
                    });
                  },
                  deleteActive: async (transactionId) => {
                    await db.deleteDocument('transactions', transactionId);
                  },
                });
                await apiSyncAdapter.ackPendingTransactions(txns.map(t => t.id));
                if (receipt.skippedClosed.length > 0) {
                  console.warn(`Z_MEMBERSHIP_SYNC_REPLAY_IGNORED count=${receipt.skippedClosed.length}`);
                }
                setTransactions(prev => {
                  const merged = new Map<string, Transaction>();
                  (prev || []).forEach(t => {
                    if (!receipt.closedIds.has(t.id) && !isTransactionReservedForClose(t.id)) merged.set(t.id, t);
                  });
                  receipt.accepted.forEach(t => {
                    if (!isTransactionReservedForClose(t.id)) merged.set(t.id, t);
                  });
                  return Array.from(merged.values())
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                });
              });

              inventorySyncService.startInventoryPolling(15000, async (movements) => {
                if (movements.length === 0) return;
                const affectedProducts = new Set<string>();
                const affectedWarehouses = new Set<string>();
                for (const move of movements) {
                  await db.saveDocument('inventoryLedger', move);
                  affectedProducts.add(move.productId);
                  affectedWarehouses.add(move.warehouseId);
                }
                await apiSyncAdapter.ackPendingInventoryMovements(movements.map(m => m.id));
                for (const productId of affectedProducts) {
                  for (const warehouseId of affectedWarehouses) {
                    await db.recalculateProductStock(productId, warehouseId);
                  }
                }
                const updatedProducts = await db.get('products') as Product[];
                setProducts(updatedProducts);
              });
            }

            // NOTE: NetworkSyncService deprecated. SyncManager/ApiSyncAdapter handles sync now.
            backgroundSyncManager.initialize().catch(console.error);
            currencyScheduleExecutor.initialize();

            markBootStage('READY');
            console.log('🎉 Setting isDataLoaded = true');
            setIsDataLoaded(true);

            if (isErpSetupMode) {
              window.setTimeout(() => {
                void syncManager.refreshErpStartupSecurity(finalConfig, { deferDuringSale: true })
                  .then(async (security) => {
                    if (security.config) setConfig(security.config);
                    const refreshedUsers = visiblePosUsersForRuntime(await db.get('users') as User[]);
                    setUsers(refreshedUsers);
                    if (refreshedUsers.length > 0) {
                      setBootstrapError(null);
                      setIsSecurityLoaded(true);
                    }
                  })
                  .catch((error) => {
                    console.warn('[SYNC_USERS] Background ERP security refresh failed; keeping offline roster.', error);
                  });
              }, 8000);
            }

          } else {
            console.warn('⚠️ No paired terminal found. Waiting for pairing...');
            // Still load to allow access to pairing/unauthorized screens.
            setIsDataLoaded(true);
            setIsSecurityLoaded(true);
          }
        } else {
          // First run or no data
          console.log('INFO: No data found, setting isDataLoaded = true for setup');
          setIsDataLoaded(true);
          setIsSecurityLoaded(true);
        }
      } catch (error: any) {
        console.error('CRITICAL: Failed to load initial data:', error);
        setInitialConnError(error.message || 'Error inicializando base de datos local');
        // We now handle the error display in the loading screen, so we can keep isDataLoaded = false
      }
    };
    loadData();
  }, []); // Dependencies for checking terminal role

  // CRITICAL: Listen for NetworkSyncService completion to refresh users for remote terminals
  useEffect(() => {
    const refreshDataAfterSync = async () => {
      // CRITICAL: Don't try to access DB before it's initialized
      if (!isDataLoaded) return;

      try {
        // Refresh users
        const syncedUsers = visiblePosUsersForRuntime(await db.get('users') as User[]);
        if (!posUserRostersMatch(syncedUsers, users) && (syncedUsers.length > 0 || isErpManagedPosUserRuntime())) {
          console.log(`🔄 Refreshing users list after sync: ${syncedUsers.length} users found`);
          setUsers(syncedUsers);
        }

        // Refresh products
        const syncedProducts = await db.get('products') as Product[];
        if (syncedProducts && syncedProducts.length > 0 && syncedProducts.length !== products.length) {
          console.log(`🔄 Refreshing products list after sync: ${syncedProducts.length} products found`);
          setProducts(syncedProducts);
        }

        // Refresh warehouses
        const syncedWarehouses = await db.get('warehouses') as Warehouse[];
        if (syncedWarehouses && syncedWarehouses.length > 0 && syncedWarehouses.length !== warehouses.length) {
          console.log(`🔄 Refreshing warehouses list after sync: ${syncedWarehouses.length} warehouses found`);
          setWarehouses(syncedWarehouses);
        }

        // Refresh internal sequences
        const syncedSequences = await db.get('internalSequences') as any[];
        if (syncedSequences && syncedSequences.length > 0 && syncedSequences.length !== internalSequences.length) {
          console.log(`🔄 Refreshing internal sequences after sync: ${syncedSequences.length} items found`);
          setInternalSequences(syncedSequences);
        }
      } catch (error: any) {
        // Silently ignore DB connection errors - they're expected during initialization
        if (!error?.message?.includes('DB not connected')) {
          console.error('Error refreshing data after sync:', error);
        }
      }
    };

    // Poll for data every 5 seconds if we don't have any yet (for remote terminals)
    // Increased from 3s to give NetworkSyncService more time to complete
    const interval = setInterval(() => {
      if (
        isDataLoaded
        && (
          users.length === 0
          || products.length === 0
          || warehouses.length === 0
          || internalSequences.length === 0
        )
      ) {
        refreshDataAfterSync();
        if (isNativeAndroidRuntime() && (products.length === 0 || warehouses.length === 0)) {
          void hydrateNativeCatalogFromDb(
            { setProducts, setWarehouses, setProductStocks },
            'poll',
          );
        }
      }
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, [users.length, products.length, warehouses.length, isDataLoaded]);

  useEffect(() => {
    // Poll tables if in restaurant mode OR retail with tables enabled
    const usesTables = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.config?.operational?.usa_mesas;

    // IMPORTANT: avoid overriding local edits while designing layout
    if ((config.vertical === 'RESTAURANT' || usesTables) && currentView !== 'TABLE_DESIGNER') {
      // La Master Android ya reconcilia el estado mediante el bridge nativo y
      // una revisión liviana. Evitar un segundo GET /api/mesas que reconstruye
      // arrays React y vuelve a publicar el catálogo completo sin cambios.
      if (isNativeAndroidRuntime() && isNativeStandaloneTerminalRuntime(getCurrentTerminal())) {
        return;
      }
      if (!isPosSaleActive()) void fetchTables();
      const interval = setInterval(() => {
        if (isPosSaleActive()) return;
        void fetchTables();
      }, isClientTerminalMode() ? CLIENT_TABLE_POLL_INTERVAL_MS : 10000);
      return () => clearInterval(interval);
    }
  }, [config.vertical, config.terminals, deviceId, currentView]);

  useEffect(() => {
    if (!isClientTerminalMode() || currentView === 'TABLE_DESIGNER') return;

    const refreshVisibleTables = () => {
      if (document.visibilityState !== 'visible' || isPosSaleActive()) return;
      void fetchTables();
    };

    window.addEventListener('focus', refreshVisibleTables);
    document.addEventListener('visibilitychange', refreshVisibleTables);
    return () => {
      window.removeEventListener('focus', refreshVisibleTables);
      document.removeEventListener('visibilitychange', refreshVisibleTables);
    };
  }, [currentView]);

  useEffect(() => {
    // --- SYNC EVENT LISTENERS (For Slave Terminals) ---
    let catalogRefreshTimer: any = null;
    const pendingCatalogRefresh = {
      products: false,
      productStocks: false,
    };

    const flushCatalogRefresh = async () => {
      const startedAt = posCatalogDebugNow();
      catalogRefreshTimer = null;

      if (pendingCatalogRefresh.productStocks) {
        const freshStocks = await db.get('productStocks') as ProductStock[];
        setProductStocks(Array.isArray(freshStocks) ? freshStocks : []);
      }

      if (pendingCatalogRefresh.products) {
        const freshProducts = await db.get('products') as Product[];
        if (Array.isArray(freshProducts) && freshProducts.length > 0) {
          setProducts(freshProducts);
        } else {
          console.warn('Catalog refresh skipped: products collection was empty or unavailable; preserving current POS catalog.');
        }

        const freshWarehouses = await db.get('warehouses') as Warehouse[];
        if (Array.isArray(freshWarehouses) && freshWarehouses.length > 0) {
          setWarehouses(freshWarehouses);
        }

        const freshStocks = await db.get('productStocks') as ProductStock[];
        if (Array.isArray(freshStocks) && freshStocks.length > 0) {
          setProductStocks(freshStocks);
        }

        const matching = Array.isArray(freshProducts)
          ? (freshProducts as unknown as Record<string, unknown>[])
              .filter((item) => posCatalogDebugMatchesRaw(item))
              .map((item) => posCatalogDebugSummarizeItem(item))
          : [];
        if (matching.length > 0) {
          posCatalogDebugLog('App: catalog refresh → setProducts', {
            count: Array.isArray(freshProducts) ? freshProducts.length : 0,
            elapsedMs: posCatalogDebugElapsedMs(startedAt),
            matching,
          });
          void posCatalogDebugLogDbRows('App catalog refresh after setProducts');
        }
      }

      if (pendingCatalogRefresh.products || pendingCatalogRefresh.productStocks) {
        const freshWarehouses = await db.get('warehouses') as Warehouse[];
        if (Array.isArray(freshWarehouses) && freshWarehouses.length > 0) {
          setWarehouses(freshWarehouses);
        }
      }

      pendingCatalogRefresh.products = false;
      pendingCatalogRefresh.productStocks = false;
    };

    const scheduleCatalogRefresh = (eventType: string) => {
      if (eventType === 'productsUpdated') pendingCatalogRefresh.products = true;
      if (eventType === 'productStocksUpdated') pendingCatalogRefresh.productStocks = true;

      if (catalogRefreshTimer) {
        clearTimeout(catalogRefreshTimer);
      }
      catalogRefreshTimer = setTimeout(() => {
        void flushCatalogRefresh().catch((error) => {
          console.error('Failed to refresh catalog after sync update:', error);
        });
      }, 300);
    };

    const handleSyncUpdate = async (event: Event) => {
      const startedAt = posCatalogDebugNow();
      const collection = event.type.replace('Updated', '');
      console.log(`🔔 App: Sync update received for ${collection}. Refreshing state...`);

      const freshData = await db.get(collection as any);
      if (!freshData) return;

      switch (collection) {
        case 'products':
          if (Array.isArray(freshData) && freshData.length > 0) {
            setProducts(freshData as Product[]);
          } else {
            console.warn('productsUpdated skipped: products collection was empty or unavailable; preserving current POS catalog.');
          }
          {
            const matching = Array.isArray(freshData)
              ? (freshData as Record<string, unknown>[])
                  .filter((item) => posCatalogDebugMatchesRaw(item))
                  .map((item) => posCatalogDebugSummarizeItem(item))
              : [];
            if (matching.length > 0) {
              posCatalogDebugLog('App: productsUpdated → setProducts', {
                count: Array.isArray(freshData) ? freshData.length : 0,
                elapsedMs: posCatalogDebugElapsedMs(startedAt),
                matching,
              });
              void posCatalogDebugLogDbRows('App handleSyncUpdate after setProducts');
            }
          }
          break;
        case 'customers': setCustomers(mapCustomersFromErp(freshData)); break;
        case 'suppliers': setSuppliers(freshData as Supplier[]); break;
        case 'users': setUsers(visiblePosUsersForRuntime(freshData)); break;
        case 'roles': setRoles(Array.isArray(freshData) ? freshData as RoleDefinition[] : DEFAULT_ROLES); break;
        case 'purchaseOrders': setPurchaseOrders(Array.isArray(freshData) ? freshData as PurchaseOrder[] : []); break;
        case 'transfers': setTransfers(Array.isArray(freshData) ? freshData as StockTransfer[] : []); break;
        case 'internalSequences': /* No state for this, used directly from DB */ break;
        case 'transactions': setTransactions(Array.isArray(freshData) ? freshData as Transaction[] : []); break;
        case 'cashMovements': {
          const freshCashMovements = Array.isArray(freshData) ? freshData as CashMovement[] : [];
          const mirroredCashMovements = readArrayMirrorFromLocalStorage<CashMovement>(CASH_MOVEMENTS_STORAGE_KEY);
          const restoredCashMovements = mergeById(freshCashMovements, mirroredCashMovements);
          setCashMovements(restoredCashMovements);
          if (restoredCashMovements.length > freshCashMovements.length) {
            void db.save('cashMovements', restoredCashMovements).catch((error) => console.warn('No se pudo rehidratar movimientos de caja tras sync event:', error));
          }
          break;
        }
        case 'zReports': setZReports(freshData as ZReport[]); break;
        case 'xReports': setXReports(Array.isArray(freshData) ? freshData as XReport[] : []); break;
        case 'warehouses': setWarehouses(Array.isArray(freshData) ? freshData as Warehouse[] : []); break;
        case 'promotions': {
          if (Array.isArray(freshData)) {
            setConfig((previous) => ({ ...previous, promotions: freshData as any[] }));
          }
          break;
        }
      }
    };

    const handleSyncEvent = (event: Event) => {
      if (event.type === 'productsUpdated' || event.type === 'productStocksUpdated') {
        scheduleCatalogRefresh(event.type);
        return;
      }
      void handleSyncUpdate(event).catch((error) => {
        console.error(`Failed to handle ${event.type}:`, error);
      });
    };

    const syncEvents = ['productsUpdated', 'customersUpdated', 'suppliersUpdated', 'usersUpdated', 'rolesUpdated', 'purchaseOrdersUpdated', 'transfersUpdated', 'internalSequencesUpdated', 'transactionsUpdated', 'cashMovementsUpdated', 'zReportsUpdated', 'warehousesUpdated', 'productStocksUpdated', 'tablesUpdated', 'productionAreasUpdated', 'promotionsUpdated'];
    syncEvents.forEach(e => window.addEventListener(e, handleSyncEvent));

    // Android defers heavy collections during db.init(). The customer sync can
    // therefore finish before this effect subscribes to customersUpdated.
    // Re-read the persisted collection once after subscribing to close that
    // startup race without querying SQLite on every render.
    void db.get('customers').then((freshCustomers) => {
      if (Array.isArray(freshCustomers)) {
        setCustomers(freshCustomers as Customer[]);
      }
    }).catch((error) => {
      console.warn('Failed to hydrate customers after sync listeners were registered:', error);
    });

    return () => {
      if (catalogRefreshTimer) clearTimeout(catalogRefreshTimer);
      syncEvents.forEach(e => window.removeEventListener(e, handleSyncEvent));
    };
  }, []);

  useEffect(() => {
    const handleConfigUpdated = async (event: Event) => {
      const incomingConfig = (event as CustomEvent<BusinessConfig>)?.detail;
      if (!incomingConfig || Array.isArray(incomingConfig) || !incomingConfig.terminals) return;

      // Detect if we actually need a full sync re-init
      const sanitize = (c: any) => {
        if (!c || typeof c !== 'object') return {};
        const { id, _db_initialized, config_metadata, _id, ...rest } = c;
        return {
          ...rest,
          integrations: Array.isArray(rest.integrations)
            ? rest.integrations.map((integration: any) => {
              if (!integration || typeof integration !== 'object') return integration;
              const { auditEvents, ...integrationRest } = integration;
              return integrationRest;
            })
            : rest.integrations,
        };
      };

      const oldConfigJson = JSON.stringify(sanitize(config));
      const newConfigJson = JSON.stringify(sanitize(incomingConfig));
      const hasSubstantialChanges = oldConfigJson !== newConfigJson;

      persistInitialTerminalConfig(incomingConfig);
      if (!hasSubstantialChanges) {
        console.log('🔔 App: configUpdated received but no structural changes detected. Skipping re-init.');
        setConfig(incomingConfig);
        return;
      }

      console.log('🔔 App: configUpdated received. Applying synchronized config...');
      setConfig(incomingConfig);

      // Startup owns initialization and the security bootstrap. Manifest/catalog
      // events may update React state, but must not restart sync recursively.
      if (!isDataLoaded) return;

      const activeTerminalId =
        localStorage.getItem('active_terminal_id')
        || localStorage.getItem('CLIC_POS_TERMINAL_ID')
        || '';
      const currentTerminal = (incomingConfig.terminals || []).find(t =>
        t.config?.currentDeviceId === deviceId
        || t.id === activeTerminalId
        || t.config?.erpTerminalId === activeTerminalId
      );
      if (!currentTerminal) return;

      if (
        currentUser
        && currentView === 'POS'
        && !isPosSaleActive()
        && !activeTableEditLockRef.current
        && resolvePosSalesStartView(incomingConfig, currentTerminal.config) === 'TABLE_MAP'
      ) {
        setCurrentView('TABLE_MAP');
        window.setTimeout(() => {
          void fetchTables().catch((error) => {
            console.warn('Failed to reconcile tables after applying the restaurant start view:', error);
          });
        }, 250);
      }

      try {
        permissionService.initialize(incomingConfig, currentTerminal.id);
        authLevelService.init(incomingConfig, currentTerminal.id);
        terminalRouter.init(incomingConfig, currentTerminal.id, currentTerminal.config.deviceRole || null);
        await syncManager.initialize(incomingConfig, currentTerminal.id);

        // If allowed categories changed but local catalog is stale/partial, force a products refresh.
        const normalizeCategory = (value: any) =>
          typeof value === 'string' ? value.trim().toLowerCase() : '';

        const terminalAllowedCategories = (currentTerminal.config?.catalog?.allowedCategories || [])
          .map((cat: any) => normalizeCategory(cat))
          .filter(Boolean);

        if (terminalAllowedCategories.length >= 2) {
          const localProducts = await db.get('products') as Product[];
          const localCount = Array.isArray(localProducts) ? localProducts.length : 0;
          const sellableCategories = new Set(
            (localProducts || [])
              .filter((p: any) => p && p.is_sellable !== false)
              .map((p: any) => normalizeCategory(p.category))
              .filter(Boolean)
          );

          const matchedAllowedCategoriesCount = terminalAllowedCategories
            .filter(cat => sellableCategories.has(cat))
            .length;
          const allowedCoverageRatio = matchedAllowedCategoriesCount / terminalAllowedCategories.length;
          const hasTinyCatalog = localCount > 0 && localCount <= 5;
          const hasCategoryMismatch = matchedAllowedCategoriesCount === 0 || allowedCoverageRatio < 0.5;

          if ((hasTinyCatalog || hasCategoryMismatch) && resolveSyncTarget().canPullMasters) {
            console.warn(
              `⚠️ App: Runtime config drift detected on ${currentTerminal.id}. ` +
              `localProducts=${localCount}, allowed=${terminalAllowedCategories.length}, matched=${matchedAllowedCategoriesCount}. ` +
              `Forcing products pull...`
            );
            await syncManager.pullCatalog('products', true);
            const refreshedProducts = await db.get('products') as Product[];
            if (Array.isArray(refreshedProducts)) {
              setProducts(refreshedProducts);
            }
          }
        }

        await syncConfigToLocalServer(incomingConfig, { surfaceErrors: false });
      } catch (error) {
        console.error('❌ Failed to apply synced config at runtime:', error);
      }
    };

    window.addEventListener('configUpdated', handleConfigUpdated as EventListener);
    return () => {
      window.removeEventListener('configUpdated', handleConfigUpdated as EventListener);
    };
  }, [config, currentUser, currentView, deviceId, isDataLoaded, syncConfigToLocalServer]);

  // --- GLOBAL KEYBOARD SHORTCUT FOR ADMIN ACCESS ---
  useEffect(() => {
   const handleGlobalKeyboard = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
      }

      // Ctrl+Alt+A for admin escape hatch (works in kiosk modes)
      if (e.ctrlKey && e.altKey && e.key?.toLowerCase() === 'a') {
        e.preventDefault();
        e.stopPropagation();

        console.log('🔓 GLOBAL Admin shortcut triggered (Ctrl+Alt+A)');

        // Check if we're in a kiosk mode

        const role = getCurrentDeviceRoleRaw();
        if (!role) return;
        if (role === DeviceRole.SELF_CHECKOUT ||
          role === DeviceRole.PRICE_CHECKER ||
          role === DeviceRole.KITCHEN_DISPLAY) {
          // Trigger escape hatch
          const pin = await clicPrompt('🔐 Ingrese PIN de Administrador:');
          if (pin && authLevelService.validateEscapeHatch(pin)) {
            console.log('✅ PIN correcto - Navegando a Settings');
            setIsAdminMode(true);  // Enable admin mode to prevent auto-redirect
            setCurrentView('SETTINGS');
          } else if (pin) {
            alert('❌ PIN incorrecto');
          }
        } else {
          // Not in kiosk mode, just go to settings directly
          setCurrentView('SETTINGS');
        }
      }
    };

    console.log('✅ Global keyboard shortcut registered (Ctrl+Alt+A)');
    document.addEventListener('keydown', handleGlobalKeyboard, { capture: true });

    return () => {
      console.log('🧹 Global keyboard shortcut removed');
      document.removeEventListener('keydown', handleGlobalKeyboard, { capture: true });
    };
  }, [config, deviceId]); // Dependencies for checking terminal role

  // --- CORE EVENT HANDLERS ---

  const handlePairTerminal = async (
    terminalId: string,
    pairingContext?: string | {
      tenantId?: string;
      erpTerminalId?: string;
      terminalCode?: string;
      erpBaseUrl?: string;
      terminalName?: string;
      companyId?: string;
      storeId?: string;
      boundConfig?: BusinessConfig;
      boundUsers?: User[];
      masterIp?: string;
      snapshotItems?: Product[];
      rooms?: Room[];
      tables?: Table[];
      deviceToken?: string;
      device_token?: string;
      terminalToken?: string;
      terminal_token?: string;
      activationToken?: string;
      activation_token?: string;
      syncToken?: string;
      sync_token?: string;
      syncAuthToken?: string;
      sync_auth_token?: string;
      tokenExpiresAt?: string;
      token_expires_at?: string;
      initialConfigVersion?: string | null;
      initialConfigEtag?: string | null;
      snapshotMeta?: {
        fullPullOnPairing?: boolean;
        resolutionError?: unknown;
      };
      syncProfile?: Partial<SyncProfile>;
      syncPermissions?: SyncPermissions;
      contractSource?: SyncProfileSource;
      incomingProfile?: Partial<SyncProfile>;
      profile?: Partial<SyncProfile>;
      progress?: (update: { stepId?: 'claim' | 'config' | 'apply' | 'sync' | 'cache' | 'finish'; message?: string }) => void;
      recoveryState?: RuntimeTerminalRecoveryState | null;
    },
    options?: { forceTakeover?: boolean }
  ) => {
    setRestoringHistory(true);
    setTerminalBindingDiagnosticStatus('BINDING');
    setCatalogDiagnosticStatus('IDLE');
    let preserveTerminalBindingAfterRegister = false;
    let syncProfilePersistence: SyncProfilePersistenceDiagnostic | null = null;
    let isErpDirectBinding = false;
    const previousConfig = config;
    const previousUsers = users;
    const previousActiveTerminalId = localStorage.getItem('active_terminal_id');
    const previousTerminalStorageId = localStorage.getItem('CLIC_POS_TERMINAL_ID');
    const previousInitialTerminalConfig = localStorage.getItem('initial_terminal_config');
    const previousCatalogDiagnosticStatus = localStorage.getItem(CATALOG_SYNC_STATUS_KEY);
    try {
      const setupResult = typeof pairingContext === 'object' && pairingContext !== null ? pairingContext : undefined;
      const storedSetupMode = getStoredTerminalSetupMode();
      const resolvedMasterIp = typeof pairingContext === 'string' ? pairingContext : setupResult?.masterIp;
      const isLocalClientBinding = Boolean(resolvedMasterIp)
        || storedSetupMode === 'CLIENT'
        || storedSetupMode === 'ORDER_TAKER';
      const resolvedOperationalTerminalId =
        resolveRegisterTerminalCode(
          { terminalCode: setupResult?.terminalCode },
          setupResult,
          setupResult?.syncProfile,
          setupResult?.incomingProfile,
          setupResult?.profile,
        )
        || terminalId;
      const requiresCanonicalErpIdentity = !isLocalClientBinding && Boolean(
        setupResult?.erpBaseUrl
        || setupResult?.syncProfile?.contractedProduct === 'POS_ERP'
        || setupResult?.syncProfile?.cloudChannel === 'ERP_ACTIVE'
        || setupResult?.syncProfile?.dataMaster === 'ERP'
        || setupResult?.contractSource === 'ERP_REGISTER'
      );
      const canonicalSetupErpTerminalId = resolveRegisterErpTerminalId(
        setupResult,
        setupResult?.syncProfile,
        setupResult?.incomingProfile,
        setupResult?.profile,
      );
      if (requiresCanonicalErpIdentity && !canonicalSetupErpTerminalId) {
        requireCanonicalErpTerminalId(setupResult);
      }
      const previouslyAssignedTerminal = (config.terminals || []).find(t => t.id === terminalId);
      const normalizedResolvedMasterIp = normalizeMasterHost(resolvedMasterIp || '');
      const reachableMasterBinding = normalizedResolvedMasterIp
        ? await resolveReachableMasterBinding(normalizedResolvedMasterIp)
        : null;
      if (normalizedResolvedMasterIp && !reachableMasterBinding) {
        throw new Error(
          `MASTER_UNREACHABLE: No se pudo conectar por HTTP a ${normalizedResolvedMasterIp}:3001. `
          + 'Confirme que la caja Master esté abierta y que ambos equipos estén en la misma red.'
        );
      }
      const finalResolvedMasterIp = reachableMasterBinding?.host || normalizedResolvedMasterIp;
      const finalResolvedMasterUrl = reachableMasterBinding?.baseUrl || (finalResolvedMasterIp ? buildMasterUrlFromHost(finalResolvedMasterIp) : '');
      const resolvedErpBaseUrl =
        normalizeSetupBaseUrl(setupResult?.erpBaseUrl || null)
        || resolveSetupErpBaseUrl();
      if (!setupResult?.boundConfig) {
        throw new Error('La vinculación debe provenir del backend central de setup. No se recibió configuración enlazada.');
      }
      preserveTerminalBindingAfterRegister = true;
      setupResult.progress?.({
        stepId: 'apply',
        message: 'Guardando configuración de terminal y permisos locales...',
      });
      const setupRegisterAuth = extractErpRegisterAuth(
        setupResult,
        (setupResult as any)?.initialConfigData,
        (setupResult as any)?.terminal_config,
        setupResult.boundConfig?.metadata,
        setupResult.boundConfig?.metadata?.syncAuth,
        setupResult?.syncProfile,
        setupResult?.incomingProfile,
        setupResult?.profile,
      );
      logRegisterResponseAuth(setupRegisterAuth);
      const normalizedDeviceToken = resolveNormalizedRegisterDeviceToken(
        setupResult,
        (setupResult as any)?.initialConfigData,
        setupRegisterAuth,
      );
      const effectiveDeviceToken =
        normalizedDeviceToken
        || setupRegisterAuth.deviceToken
        || setupRegisterAuth.syncToken
        || setupRegisterAuth.terminalToken
        || setupRegisterAuth.activationToken
        || '';
      if (setupRegisterAuth.syncToken) {
        localStorage.setItem('clic_erp_sync_token', setupRegisterAuth.syncToken);
        localStorage.setItem('clic_erp_sync_token_updated_at', new Date().toISOString());
        if (setupRegisterAuth.tokenExpiresAt) {
          localStorage.setItem('clic_erp_sync_token_expires_at', setupRegisterAuth.tokenExpiresAt);
        }
      }
      if (effectiveDeviceToken) {
        persistSyncDeviceToken(effectiveDeviceToken, normalizedDeviceToken ? 'ERP_REGISTER' : 'ERP_REGISTER_FALLBACK', setupRegisterAuth.tokenExpiresAt);
        saveTerminalCredentialsSync({
          terminalId: canonicalSetupErpTerminalId,
          erpTerminalId: canonicalSetupErpTerminalId,
          terminalCode: resolvedOperationalTerminalId,
          stationNumber: resolvedOperationalTerminalId,
          terminalName: setupResult?.terminalName || resolvedOperationalTerminalId,
          deviceId,
          tenantId: localStorage.getItem('clic_tenant_id') || localStorage.getItem('active_tenant_id') || null,
          erpTenantId: localStorage.getItem('clic_tenant_id') || localStorage.getItem('active_tenant_id') || null,
          cloudAdminTenantId:
            localStorage.getItem('cloud_admin_tenant_id')
            || localStorage.getItem('clic_cloud_admin_tenant_id')
            || localStorage.getItem('clic_cloud_tenant_id')
            || null,
          deviceToken: effectiveDeviceToken,
          deviceTokenSource: normalizedDeviceToken ? 'ERP_REGISTER' : 'ERP_REGISTER_FALLBACK',
          deviceTokenUpdatedAt: new Date().toISOString(),
          deviceTokenExpiresAt: setupRegisterAuth.tokenExpiresAt || null,
          ...(setupRegisterAuth.syncToken ? {
            syncToken: setupRegisterAuth.syncToken,
            syncTokenUpdatedAt: new Date().toISOString(),
            syncTokenExpiresAt: setupRegisterAuth.tokenExpiresAt || null,
          } : {}),
        });
        if (!normalizedDeviceToken) {
          setSyncAuthDiagnosticStatus('RECOVERED_WITH_REGISTER_FALLBACK');
          clearSyncErrorDiagnostic();
          setSyncDiagnostic(null);
        }
      }
      if (!effectiveDeviceToken && !isLocalClientBinding) {
        const missingTokenError = new Error('DEVICE_TOKEN_MISSING_FROM_REGISTER: El ERP vinculó la terminal pero no devolvió deviceToken.');
        setTerminalBindingDiagnosticStatus('BOUND');
        setCatalogDiagnosticStatus('AUTH_ERROR');
        setSalesPushDiagnosticStatus('LOCKED_AUTH_REQUIRED');
        setSyncAuthDiagnosticStatus('DEVICE_TOKEN_MISSING_FROM_REGISTER');
        reportSyncErrorDiagnostic({
          operation: 'REGISTER_TERMINAL',
          endpoint: `${resolvedErpBaseUrl || 'ERP'}/api/sync/terminals/register`,
          httpStatus: null,
          error: missingTokenError,
          authStatus: 'DEVICE_TOKEN_MISSING_FROM_REGISTER',
          backendCode: 'DEVICE_TOKEN_MISSING_FROM_REGISTER',
          nextAction: 'REPAIR_TERMINAL_CREDENTIALS',
          requestAuth: {
            authorizationPresent: false,
            syncTokenPresent: Boolean(setupRegisterAuth.syncToken),
            syncTokenPreview: null,
            terminalIdHeaderPresent: Boolean(setupResult?.erpTerminalId || terminalId),
            deviceIdHeaderPresent: Boolean(deviceId),
          },
          userVisibleSeverity: 'critical',
        });
        throw missingTokenError;
      }
      const authMetadata = effectiveDeviceToken
        ? {
            ...(setupResult.boundConfig?.metadata?.syncAuth || {}),
            deviceToken: effectiveDeviceToken,
            terminalToken: setupRegisterAuth.terminalToken,
            activationToken: setupRegisterAuth.activationToken,
            syncToken: setupRegisterAuth.syncToken,
            tokenExpiresAt: setupRegisterAuth.tokenExpiresAt,
            tokenSource: 'ERP_REGISTER',
            tokenUpdatedAt: new Date().toISOString(),
          }
        : setupResult.boundConfig?.metadata?.syncAuth;
      const configWithAuthMetadata: BusinessConfig = {
        ...setupResult.boundConfig,
        metadata: {
          ...(setupResult.boundConfig.metadata || {}),
          ...(authMetadata ? { syncAuth: authMetadata } : {}),
          ...(effectiveDeviceToken ? { deviceToken: effectiveDeviceToken } : {}),
          ...(setupRegisterAuth.syncToken ? { syncToken: setupRegisterAuth.syncToken } : {}),
          ...(setupRegisterAuth.tokenExpiresAt ? { tokenExpiresAt: setupRegisterAuth.tokenExpiresAt } : {}),
        },
      };
      const updatedConfig = clearDuplicateDeviceAssignments(configWithAuthMetadata, deviceId, {
        activeTerminalId: terminalId,
        bindingTerminalId: setupResult?.erpTerminalId || terminalId,
        bindingLocalTerminalId: resolvedOperationalTerminalId,
      }).config;
      const selectedTerminal = (updatedConfig.terminals || []).find(t =>
        configuredTerminalReferenceMatches(t, terminalId)
        || configuredTerminalReferenceMatches(t, canonicalSetupErpTerminalId)
      ) || resolvePreferredTerminalForDevice(updatedConfig.terminals || [], deviceId, {
        activeTerminalId: terminalId,
        bindingTerminalId: canonicalSetupErpTerminalId,
        bindingLocalTerminalId: resolvedOperationalTerminalId,
      });
      const resolvedTerminalName =
        setupResult?.terminalName
        || selectedTerminal?.config?.terminalName
        || selectedTerminal?.config?.stationNumber
        || selectedTerminal?.id
        || terminalId;
      const resolvedErpTerminalId =
        canonicalSetupErpTerminalId
        || normalizeCanonicalErpTerminalId(selectedTerminal?.config?.erpTerminalId)
        || null;
      if (requiresCanonicalErpIdentity && !resolvedErpTerminalId) {
        requireCanonicalErpTerminalId(setupResult);
      }
      const isClientSetupMode = storedSetupMode === 'CLIENT' || storedSetupMode === 'ORDER_TAKER';
      const isSlave = isClientSetupMode || selectedTerminal?.config?.isPrimaryNode === false;
      const wasOccupiedByAnotherDevice =
        !!previouslyAssignedTerminal?.config?.currentDeviceId &&
        previouslyAssignedTerminal.config.currentDeviceId !== deviceId;
      const shouldTakeover = options?.forceTakeover || wasOccupiedByAnotherDevice;
      const configSyncUrl = finalResolvedMasterUrl
        ? `${finalResolvedMasterUrl}/api/config`
        : buildConfigSyncUrl();

      setConfig(updatedConfig);
      await db.save('config', updatedConfig);
      if (setupResult?.erpTerminalId && (setupResult.initialConfigVersion || setupResult.initialConfigEtag)) {
        terminalConfigRequestCoordinator.commitApplied(setupResult.erpTerminalId, {
          configVersion: setupResult.initialConfigVersion,
          etag: setupResult.initialConfigEtag,
        });
      }
      const hasAuthoritativeRoomSnapshot = Array.isArray(setupResult?.rooms);
      const hasAuthoritativeTableSnapshot = Array.isArray(setupResult?.tables);
      const setupRooms = hasAuthoritativeRoomSnapshot
        ? setupResult.rooms!
        : Array.isArray((updatedConfig as any).rooms)
          ? (updatedConfig as any).rooms
          : Array.isArray((updatedConfig as any).initialRooms)
            ? (updatedConfig as any).initialRooms
            : [];
      const setupTables = hasAuthoritativeTableSnapshot
        ? setupResult.tables!
        : Array.isArray((updatedConfig as any).tables)
          ? (updatedConfig as any).tables
          : Array.isArray((updatedConfig as any).initialTables)
            ? (updatedConfig as any).initialTables
            : [];
      const [persistedRoomsRaw, persistedTablesRaw] = await Promise.all([
        db.get('rooms') as Promise<Room[]>,
        db.get('tables') as Promise<Table[]>,
      ]);
      const persistedRooms = Array.isArray(persistedRoomsRaw) ? persistedRoomsRaw : [];
      const persistedTables = Array.isArray(persistedTablesRaw) ? persistedTablesRaw : [];
      const selectedSetupFloorPlan = selectAuthoritativeFloorPlan({
        local: { rooms: persistedRooms, tables: persistedTables },
        incoming: { rooms: setupRooms, tables: setupTables },
        isClientTerminal: isSlave,
      });
      if (selectedSetupFloorPlan.reason === 'PRESERVE_MASTER_DESIGN') {
        console.warn('[FLOOR_PLAN] Ignored setup/bootstrap tables because the Master has a designed layout', {
          localTables: persistedTables.length,
          incomingTables: setupTables.length,
        });
      }
      const effectiveSetupRooms = selectedSetupFloorPlan.rooms;
      const effectiveSetupTables = selectedSetupFloorPlan.tables;
      if (hasAuthoritativeRoomSnapshot || effectiveSetupRooms.length > 0) {
        await db.save('rooms', effectiveSetupRooms);
        setRooms(effectiveSetupRooms);
        setActiveRoomId(
          effectiveSetupRooms[0]?.id
          || (effectiveSetupRooms[0] as any)?.room_id
          || (effectiveSetupRooms[0] as any)?.code
          || ''
        );
      }
      if (hasAuthoritativeTableSnapshot || effectiveSetupTables.length > 0) {
        await db.save('tables', effectiveSetupTables);
        setTables(effectiveSetupTables);
      }
      if (hasAuthoritativeRoomSnapshot || hasAuthoritativeTableSnapshot) {
        locallySavedFloorPlanRef.current = {
          roomIds: new Set(effectiveSetupRooms.map(room => String(room.id))),
          tableIds: new Set(effectiveSetupTables.map(table => String(table.id))),
        };
        localStorage.removeItem(FLOOR_PLAN_STORAGE_KEY);
        writeFloorPlanMirror(effectiveSetupRooms, effectiveSetupTables, {
          layoutSource: isSlave ? 'MASTER_SNAPSHOT' : 'MASTER_RUNTIME',
          isDefaultSeed: false,
        });
      }
      setupResult.progress?.({
        stepId: 'apply',
        message: 'Rehidratando series fiscales y documentos operativos...',
      });
      const operationalDocumentState = extractTerminalOperationalDocumentState(updatedConfig, terminalId);
      await db.rehydrateOperationalDocumentState(
        operationalDocumentState.documentSeries,
        operationalDocumentState.fiscalRanges,
        operationalDocumentState.fiscalAllocations,
        operationalDocumentState.terminalId,
      );
      const nextSetupMode: TerminalSetupMode = isSlave
        ? storedSetupMode === 'ORDER_TAKER' ? 'ORDER_TAKER' : 'CLIENT'
        : storedSetupMode === 'SERVER_ERP'
          ? 'SERVER_ERP'
          : 'SERVER_LOCAL';
      localStorage.setItem(TERMINAL_SETUP_MODE_KEY, nextSetupMode);
      const existingSyncProfile = (() => {
        try {
          return loadSyncProfile();
        } catch {
          return null;
        }
      })();
      const resolvedTenantId =
        setupResult?.tenantId
        || setupResult?.syncProfile?.localTenantId
        || setupResult?.syncProfile?.erpTenantId
        || setupResult?.incomingProfile?.localTenantId
        || setupResult?.profile?.localTenantId
        || existingSyncProfile?.localTenantId
        || existingSyncProfile?.erpTenantId
        || localStorage.getItem('clic_tenant_id')
        || localStorage.getItem('active_tenant_id')
        || 'default-tenant';
      localStorage.setItem('active_tenant_id', resolvedTenantId);
      if (resolvedTenantId && resolvedTenantId !== 'default-tenant') {
        localStorage.setItem('clic_tenant_id', resolvedTenantId);
      }

      isErpDirectBinding =
        !isSlave &&
        (
          nextSetupMode === 'SERVER_ERP' ||
          setupResult?.syncProfile?.contractedProduct === 'POS_ERP' ||
          setupResult?.syncProfile?.cloudChannel === 'ERP_ACTIVE' ||
          setupResult?.syncProfile?.dataMaster === 'ERP' ||
          setupResult?.syncProfile?.customerErpAccess === true ||
          setupResult?.syncProfile?.erpUiEnabled === true
        );
      const resolvedSyncPermissions = setupResult?.syncPermissions || setupResult?.syncProfile?.syncPermissions;
      const resolvedErpReadyForSales = coerceOptionalBoolean(
        setupResult?.syncProfile?.erpReadyForSales,
        (setupResult as any)?.erpReadyForSales,
        (setupResult as any)?.erp_ready_for_sales,
        resolvedSyncPermissions?.canPushOperations,
        resolvedSyncPermissions?.pushOperations
      ) ?? (
        isErpDirectBinding && Boolean(effectiveDeviceToken)
          ? true
          : false
      );
      const contractSource: SyncProfileSource =
        setupResult?.contractSource || (isErpDirectBinding ? 'ERP_REGISTER' : 'CLOUD_ADMIN');
      const incomingSyncProfile: Partial<SyncProfile> = resolveIncomingSyncProfileFromRegister(
        setupResult,
        {
          ...(setupResult?.syncProfile || {}),
          syncPermissions: resolvedSyncPermissions,
          contractedProduct: isErpDirectBinding ? 'POS_ERP' : 'POS_ONLY',
          posRuntime: isSlave ? 'SLAVE' : 'MASTER',
          cloudChannel: isSlave ? 'POS_MASTER' : isErpDirectBinding ? 'ERP_ACTIVE' : 'POS_CLOUD_STAGING',
          dataMaster: isSlave ? 'POS_MASTER' : isErpDirectBinding ? 'ERP' : 'POS',
          cloudSyncEnabled: !isSlave,
          customerErpAccess: isErpDirectBinding,
          erpUiEnabled: isErpDirectBinding,
          localTenantId: resolvedTenantId,
          localStoreId: setupResult?.storeId || setupResult?.syncProfile?.localStoreId,
          localTerminalId: resolvedOperationalTerminalId,
          cloudBaseUrl: resolvedErpBaseUrl || setupResult?.syncProfile?.cloudBaseUrl,
          erpBaseUrl: resolvedErpBaseUrl || setupResult?.syncProfile?.erpBaseUrl,
          cloudTenantId: setupResult?.syncProfile?.cloudTenantId || localStorage.getItem('clic_cloud_tenant_id') || localStorage.getItem('active_tenant_id') || resolvedTenantId,
          erpTenantId: setupResult?.syncProfile?.erpTenantId || resolvedTenantId,
          erpTerminalId: resolvedErpTerminalId,
          masterUrl: isSlave ? finalResolvedMasterUrl : undefined,
          masterTerminalId: isSlave ? terminalId : undefined,
          masterReady: Boolean(isSlave && finalResolvedMasterUrl),
          cloudStagingReady: !isErpDirectBinding && !isSlave,
          erpReadyForSales: resolvedErpReadyForSales,
        },
        contractSource,
      );
      syncProfilePersistence = saveSyncProfileFromContract(incomingSyncProfile, contractSource, {
        erpTerminalId: resolvedErpTerminalId,
        localTerminalId: resolvedOperationalTerminalId,
        terminalName:
          setupResult?.terminalName
          || incomingSyncProfile.localTerminalId
          || resolvedTerminalName,
      });
      localStorage.setItem('clic_sync_mode', isSlave ? 'POS_SLAVE' : isErpDirectBinding ? 'POS_ERP' : 'POS_LOCAL');
      localStorage.setItem('clic_customer_erp_access', String(isErpDirectBinding));
      localStorage.setItem('clic_erp_ui_enabled', String(isErpDirectBinding));
      localStorage.setItem('CLIC_ERP_ACTIVE', String(isErpDirectBinding));
      localStorage.setItem('clic_erp_ready_for_sales', String(resolvedErpReadyForSales));

      if (Array.isArray(setupResult?.boundUsers)) {
        setupResult.progress?.({
          stepId: 'apply',
          message: 'Actualizando usuarios autorizados para esta terminal...',
        });
        const persistedUsers = await db.get('users') as User[];
        const incomingBoundUsers = setupResult.boundUsers.map((user: User) => (
          isErpDirectBinding
            ? { ...user, syncSource: 'ERP_SNAPSHOT' as const }
            : user
        ));
        const reconciledUsers = reconcilePosUsers({
          existingUsers: Array.isArray(persistedUsers) ? persistedUsers : [],
          incomingUsers: incomingBoundUsers,
          removeDefaultSeedUsers: isErpDirectBinding,
        });
        console.info('[SYNC_USERS] pairing_roster_reconciled', {
          incoming: incomingBoundUsers.length,
          preserved: Math.max(0, reconciledUsers.length - incomingBoundUsers.length),
          total: reconciledUsers.length,
        });
        setUsers(visiblePosUsersForRuntime(reconciledUsers));
        await db.save('users', reconciledUsers);
      }

      if (isSlave && finalResolvedMasterIp) {
        localStorage.setItem('pos_master_ip', finalResolvedMasterIp);
        localStorage.setItem('CLIC_POS_MASTER_URL', finalResolvedMasterUrl);
      }

      // If user takes control of a MASTER terminal, clear stale slave pointers.
      if (!isSlave) {
        localStorage.removeItem('pos_master_ip');
        const runtimeMasterUrl = buildRuntimeMasterUrl();
        localStorage.setItem('CLIC_POS_MASTER_URL', runtimeMasterUrl);
      }

      // Always persist binding to backend before re-initializing sync.
      // This prevents pulling old config right after takeover.
      if (configSyncUrl) {
        try {
          setupResult.progress?.({
            stepId: 'sync',
            message: 'Enviando identidad de la terminal al backend local...',
          });
          const res = await fetch(configSyncUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Active-Terminal-Id': terminalId,
              'X-Device-Id': deviceId,
            },
            body: JSON.stringify(updatedConfig)
          });
          if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status} ${detail}`.trim());
          }
          console.log(`✅ Binding synced to backend at ${configSyncUrl}`);
        } catch (e) {
          console.error("❌ Failed to sync binding to backend:", e);
          // We continue; local binding is already saved.
        }
      } else {
        console.log('ℹ️ Native standalone runtime detected. Skipping backend binding sync.');
      }

      void publishMasterEndpointToCloud({
        deviceId,
        terminalId: resolvedOperationalTerminalId,
        terminalName: resolvedTerminalName,
        isPrimary: !isSlave,
      });

      persistStoredErpSyncBinding({
        tenantId: setupResult?.tenantId || localStorage.getItem('active_tenant_id') || null,
        terminalId: resolvedErpTerminalId,
        localTerminalId: resolvedOperationalTerminalId,
        terminalName: resolvedTerminalName,
        companyId: setupResult?.companyId || null,
        storeId: setupResult?.storeId || null,
      });
      setTerminalBindingDiagnosticStatus('BOUND');

      const shouldRestoreRemoteData = !!finalResolvedMasterIp && isSlave;

      // Only slave terminals restore from a LAN master. ERP/master takeovers use the ERP snapshot instead.
      if (shouldRestoreRemoteData) {
        try {
          setupResult.progress?.({
            stepId: 'sync',
            message: 'Restaurando historial y catálogos desde la caja maestra...',
          });
          const remoteRestoreConfig: BusinessConfig = {
            ...updatedConfig,
            terminals: (updatedConfig.terminals || []).map((terminal) => {
              if (terminal.id !== terminalId) return terminal;
              return {
                ...terminal,
                config: {
                  ...terminal.config,
                  isPrimaryNode: false
                }
              };
            })
          };

          localStorage.setItem('pos_master_ip', finalResolvedMasterIp);
          localStorage.setItem('CLIC_POS_MASTER_URL', finalResolvedMasterUrl);

          // Re-initialize sync manager with a temporary slave profile to pull history/catalogs
          await syncManager.initialize(remoteRestoreConfig, terminalId);
          setupResult.progress?.({
            stepId: 'sync',
            message: 'Restaurando historial operativo de la terminal anterior...',
          });
          await syncManager.restoreHistory(terminalId);

          console.log('🔄 Forcing full catalog sync to restore sequences...');
          setupResult.progress?.({
            stepId: 'sync',
            message: 'Sincronizando productos, clientes, tarifas y secuencias...',
          });
          await syncManager.syncAllCatalogs();

          // Reload data from DB after restoration
          setupResult.progress?.({
            stepId: 'cache',
            message: 'Cargando datos restaurados desde SQLite...',
          });
          const freshData = await db.init();
          setTransactions(freshData.transactions);
          setProducts(freshData.products);
          const mirroredCashMovements = readArrayMirrorFromLocalStorage<CashMovement>(CASH_MOVEMENTS_STORAGE_KEY);
          const restoredCashMovements = mergeById(Array.isArray(freshData.cashMovements) ? freshData.cashMovements : [], mirroredCashMovements);
          setCashMovements(restoredCashMovements);
          if (restoredCashMovements.length > (Array.isArray(freshData.cashMovements) ? freshData.cashMovements.length : 0)) {
            await db.save('cashMovements', restoredCashMovements);
          }
          setZReports(freshData.zReports || []);
          setXReports(Array.isArray(freshData.xReports) ? freshData.xReports : []);
        } catch (error) {
          console.error('Failed to restore history:', error);
          alert(shouldTakeover
            ? 'Se tomó control de la terminal, pero no se pudo restaurar la información del equipo anterior. Revisa conectividad cloud/red local.'
            : 'No se pudo restaurar el historial desde la Maestra. El equipo funcionará, pero sin datos previos.');
        }
      }

      // CRITICAL: Re-initialize services with the final terminal role after any restore.
      console.log(`🛠️ Re-initializing services for ${isSlave ? 'Slave' : 'Master'} terminal...`);
      if (!isSlave) {
        localStorage.removeItem('pos_master_ip');
        localStorage.setItem('CLIC_POS_MASTER_URL', buildRuntimeMasterUrl());
      }
      setupResult.progress?.({
        stepId: 'sync',
        message: 'Inicializando servicios del POS con la nueva terminal...',
      });
      permissionService.initialize(updatedConfig, terminalId);
      await syncManager.initialize(updatedConfig, terminalId);
      if (isErpDirectBinding) {
        try {
          setupResult.progress?.({
            stepId: 'sync',
            message: 'Actualizando usuarios autorizados para esta terminal...',
          });
          const refreshedPairingUsers = await syncManager.refreshErpPosUserRoster(updatedConfig);
          setUsers(visiblePosUsersForRuntime(refreshedPairingUsers));
          console.info('[SYNC_USERS] pairing_remote_roster_refreshed', {
            total: visiblePosUsersForRuntime(refreshedPairingUsers).length,
          });
        } catch (rosterError) {
          console.warn('[SYNC_USERS] ERP roster refresh failed after pairing; preserving offline login roster.', rosterError);
        }
      }
      if (isErpDirectBinding && navigator.onLine) {
        try {
          setupResult.progress?.({
            stepId: 'sync',
            message: 'Confirmando terminal online y aplicando configuración pendiente...',
          });
          const lifecycleResult = await ensureErpSyncLifecycle({
            deviceId,
            terminalId: resolvedErpTerminalId,
            localTerminalId: resolvedOperationalTerminalId,
            terminalName: resolvedTerminalName,
            companyId: setupResult?.companyId || null,
            storeId: setupResult?.storeId || null,
            isPrimary: !isSlave,
            pendingEvents: 0,
          });
          console.info('[ERP SYNC] initial terminal lifecycle completed.', {
            terminalId: resolvedErpTerminalId,
            localTerminalId: resolvedOperationalTerminalId,
            heartbeatStatus: lifecycleResult?.heartbeat?.terminal?.status || null,
            outboxApplied: lifecycleResult?.outbox?.applied || 0,
          });
        } catch (lifecycleError) {
          console.warn('[ERP SYNC] initial heartbeat/outbox failed; background lifecycle will retry.', lifecycleError);
        }
      }
      const shouldFullPullOnPairing = setupResult?.snapshotMeta?.fullPullOnPairing ?? true;
      // The pairing snapshot is the first complete catalog the operator can use.
      // Persist it before the background pull so a newly linked client never opens
      // an empty ticket while the LAN catalog refresh is still in flight.
      const shouldPersistSetupSnapshotItems = Array.isArray(setupResult?.snapshotItems)
        && setupResult.snapshotItems.length > 0;
      if (shouldFullPullOnPairing) {
        setupResult.progress?.({
          stepId: 'sync',
          message: 'Preparando maestros locales recibidos...',
        });
        try {
          setCatalogDiagnosticStatus('SYNCING');
          if (shouldPersistSetupSnapshotItems && Array.isArray(setupResult?.snapshotItems) && setupResult.snapshotItems.length > 0) {
            setupResult.progress?.({
              stepId: 'sync',
              message: 'Guardando productos recibidos en el snapshot inicial...',
            });
            const normalizedSnapshotItems = await productImageCacheService.normalizeIncomingProducts(setupResult.snapshotItems);
            await db.save('products', normalizedSnapshotItems);
            void productImageCacheService.syncSnapshotItems(normalizedSnapshotItems).catch((error) => {
              console.warn('⚠️ Snapshot product image sync failed after pairing fallback:', error);
            });
          }
          void syncManager.fullPull().catch((pullError) => {
            console.warn('⚠️ Background master sync failed after terminal pairing; continuing with local snapshot/config.', pullError);
          });
        } catch (pullError) {
          console.warn('⚠️ Initial snapshot persistence failed after terminal pairing; continuing with local config.', pullError);
          reportSyncErrorDiagnostic({
            operation: 'PULL_MASTERS',
            collection: 'products',
            error: pullError,
          });
        }
      } else {
        if (shouldPersistSetupSnapshotItems && Array.isArray(setupResult?.snapshotItems) && setupResult.snapshotItems.length > 0) {
          setupResult.progress?.({
            stepId: 'sync',
            message: 'Guardando productos recibidos en el snapshot inicial...',
          });
          const normalizedSnapshotItems = await productImageCacheService.normalizeIncomingProducts(setupResult.snapshotItems);
          await db.save('products', normalizedSnapshotItems);
          void productImageCacheService.syncSnapshotItems(normalizedSnapshotItems).catch((error) => {
            console.warn('⚠️ Snapshot product image sync failed after pairing:', error);
          });
        }
        setupResult.progress?.({
          stepId: 'sync',
          message: 'Actualizando configuración resuelta de la terminal...',
        });
        await syncManager.refreshTerminalResolvedConfig();
      }

      setupResult.progress?.({
        stepId: 'cache',
        message: 'Actualizando caches locales y estado visual del POS...',
      });
      const persistedConfigAfterSync = resolvePersistedBusinessConfig(await db.get('config') as unknown);
      const postSyncConfig = persistedConfigAfterSync || updatedConfig;

      const refreshedOperationalDocumentState = extractTerminalOperationalDocumentState(postSyncConfig, terminalId);
      await db.rehydrateOperationalDocumentState(
        refreshedOperationalDocumentState.documentSeries,
        refreshedOperationalDocumentState.fiscalRanges,
        refreshedOperationalDocumentState.fiscalAllocations,
        refreshedOperationalDocumentState.terminalId,
      );

      const freshData = await db.init();
      const hydratedConfigFromDb = resolvePersistedBusinessConfig(await db.get('config') as unknown) || postSyncConfig;
      const preservedSyncAuth = hydratedConfigFromDb.metadata?.syncAuth || updatedConfig.metadata?.syncAuth;
      const hydratedConfig: BusinessConfig = {
        ...hydratedConfigFromDb,
        metadata: {
          ...(hydratedConfigFromDb.metadata || {}),
          ...(preservedSyncAuth ? { syncAuth: preservedSyncAuth } : {}),
          ...(hydratedConfigFromDb.metadata?.deviceToken || updatedConfig.metadata?.deviceToken
            ? { deviceToken: hydratedConfigFromDb.metadata?.deviceToken || updatedConfig.metadata?.deviceToken }
            : {}),
          ...(hydratedConfigFromDb.metadata?.syncToken || updatedConfig.metadata?.syncToken
            ? { syncToken: hydratedConfigFromDb.metadata?.syncToken || updatedConfig.metadata?.syncToken }
            : {}),
          ...(hydratedConfigFromDb.metadata?.tokenExpiresAt || updatedConfig.metadata?.tokenExpiresAt
            ? { tokenExpiresAt: hydratedConfigFromDb.metadata?.tokenExpiresAt || updatedConfig.metadata?.tokenExpiresAt }
            : {}),
        },
      };
      const tenantCompanyHydratedConfig = normalizeCompanyInfoFromTenantIdentity(hydratedConfig);
      const resolvedHydratedConfig = tenantCompanyHydratedConfig.config as BusinessConfig;
      if (
        tenantCompanyHydratedConfig.changed
        || preservedSyncAuth
        || updatedConfig.metadata?.deviceToken
        || updatedConfig.metadata?.syncToken
      ) {
        await db.save('config', resolvedHydratedConfig);
      }
      setConfig(resolvedHydratedConfig);
      if (Array.isArray(freshData.users)) setUsers(visiblePosUsersForRuntime(freshData.users));
      if (Array.isArray(freshData.roles)) setRoles(freshData.roles);
      if (Array.isArray(freshData.customers)) setCustomers(freshData.customers);
      if (Array.isArray(freshData.transactions)) setTransactions(freshData.transactions);
      if (Array.isArray(freshData.products)) setProducts(freshData.products);
      if (Array.isArray(freshData.warehouses)) setWarehouses(freshData.warehouses);
      await hydrateNativeCatalogFromDb(
        { setProducts, setWarehouses, setProductStocks },
        'terminal-binding',
      );
      if (Array.isArray(freshData.cashMovements)) {
        const mirroredCashMovements = readArrayMirrorFromLocalStorage<CashMovement>(CASH_MOVEMENTS_STORAGE_KEY);
        const restoredCashMovements = mergeById(freshData.cashMovements, mirroredCashMovements);
        setCashMovements(restoredCashMovements);
        if (restoredCashMovements.length > freshData.cashMovements.length) {
          await db.save('cashMovements', restoredCashMovements);
        }
      }
      if (Array.isArray(freshData.zReports)) setZReports(freshData.zReports);
      if (Array.isArray(freshData.xReports)) setXReports(freshData.xReports);
      if (Array.isArray(freshData.purchaseOrders)) setPurchaseOrders(freshData.purchaseOrders);
      if (Array.isArray(freshData.suppliers)) setSuppliers(freshData.suppliers);
      if (Array.isArray(freshData.parkedTickets)) {
        const canHydrateOperationalTicketsLocally = canUseLocalOperationalTableStore();
        const mirroredParkedTickets = canHydrateOperationalTicketsLocally
          ? readArrayMirrorFromLocalStorage<ParkedTicket>(PARKED_TICKETS_STORAGE_KEY)
          : [];
        const restoredParkedTickets = canHydrateOperationalTicketsLocally
          ? mergeById(freshData.parkedTickets, mirroredParkedTickets)
          : [];
        setParkedTickets(restoredParkedTickets);
        if (canHydrateOperationalTicketsLocally && restoredParkedTickets.length > freshData.parkedTickets.length) {
          await db.save('parkedTickets', restoredParkedTickets);
        }
      }
      if (Array.isArray(freshData.transfers)) setTransfers(freshData.transfers);
      if (Array.isArray(freshData.internalSequences)) setInternalSequences(freshData.internalSequences);
      if (Array.isArray(freshData.receptions)) setReceptions(freshData.receptions);
      if (Array.isArray(freshData.productStocks)) setProductStocks(freshData.productStocks);
      if (canUseLocalOperationalTableStore() && Array.isArray(freshData.rooms) && freshData.rooms.length > 0 && !locallySavedFloorPlanRef.current) {
        setRooms(freshData.rooms);
      }
      if (canUseLocalOperationalTableStore() && Array.isArray(freshData.tables) && freshData.tables.length > 0 && !locallySavedFloorPlanRef.current) {
        setTables(freshData.tables);
      }
      if (Array.isArray(freshData.collections)) setCollections(freshData.collections);
      if (Array.isArray(freshData.supplierProductPrices)) setSupplierProductPrices(freshData.supplierProductPrices);

      localStorage.removeItem(TERMINAL_SETUP_PENDING_KEY);
      localStorage.setItem('active_terminal_id', terminalId);
      localStorage.setItem('CLIC_POS_TERMINAL_ID', terminalId);
      localStorage.setItem('clic_last_authorized_erp_terminal_id', resolvedErpTerminalId);
      persistInitialTerminalConfig(hydratedConfig);
      if (resolvedErpBaseUrl) {
        persistSetupErpBaseUrls(resolvedErpBaseUrl);
      }
      setupResult.progress?.({
        stepId: 'finish',
        message: 'Terminal lista. Finalizando activación...',
      });
      persistStoredErpSyncBinding({
        tenantId: setupResult?.tenantId || localStorage.getItem('active_tenant_id') || null,
        terminalId: resolvedErpTerminalId,
        localTerminalId: resolvedOperationalTerminalId,
        terminalName: resolvedTerminalName,
        companyId: setupResult?.companyId || null,
        storeId: setupResult?.storeId || null,
      });
      setTerminalBindingDiagnosticStatus('BOUND');
      setCatalogDiagnosticStatus('SYNCED');
      setSalesPushDiagnosticStatus(
        isErpDirectBinding
          ? (resolvedErpReadyForSales ? 'ENABLED' : 'LOCKED_UNTIL_ERP_READY')
          : (isSlave ? 'DISABLED' : 'ENABLED')
      );
      clearSyncErrorDiagnostic();
      setSyncDiagnostic(null);
      clearPersistedTerminalAuthorizationBlock();
      markDeviceReauthorized(deviceId);
      if (isErpDirectBinding) {
        console.log('[SYNC_ROUTER] POS_ERP binding complete: skipping POS_CLOUD_STAGING snapshot and PUSH_MASTERS.');
      } else {
        void posCloudStagingService.sendSnapshot('TERMINAL_BINDING_COMPLETE').catch((error) => {
          console.warn('⚠️ POS cloud staging snapshot failed after terminal binding:', error);
        });
      }

      const recoveryState = setupResult?.recoveryState;
      if (shouldTakeover && recoveryState) {
        const cloudLastSequence = Number(recoveryState.last_global_sequence || 0);
        setRecoverySequenceInput(String(Math.max(0, cloudLastSequence)));
        setRecoverySequencePrompt({
          ...recoveryState,
          terminalId,
          terminalName: resolvedTerminalName,
        });
      }

      setCurrentView('LOGIN');
    } catch (error) {
      console.error('❌ Failed to take terminal control:', error);
      const errorMessage = error instanceof Error ? error.message : String(error || '');
      const canResumeExistingTerminalOffline = Boolean(
        preserveTerminalBindingAfterRegister
        && previousActiveTerminalId
        && isDataLoaded
        && isRecoverableNetworkConnectivityMessage(errorMessage)
      );

      if (canResumeExistingTerminalOffline) {
        console.warn('[TERMINAL_RESUME_OFFLINE] ERP unavailable after network change; keeping the existing local binding.');
        setTerminalBindingDiagnosticStatus('BOUND');
        setCatalogDiagnosticStatus(
          previousCatalogDiagnosticStatus === 'SYNCED' ? 'SYNCED' : 'IDLE'
        );
        clearSyncErrorDiagnostic();
        setSyncDiagnostic(null);
        setCurrentView('LOGIN');
        return;
      }

      if (preserveTerminalBindingAfterRegister) {
        setTerminalBindingDiagnosticStatus('BOUND');
        setCatalogDiagnosticStatus('ERROR');
        reportSyncErrorDiagnostic({
          operation: 'REGISTER_TERMINAL',
          collection: 'products',
          error,
          contractSource: syncProfilePersistence?.contractSource,
          existingProfile: syncProfilePersistence?.existingProfile,
          incomingProfile: syncProfilePersistence?.incomingProfile,
          mismatchDetected: syncProfilePersistence?.mismatchDetected,
          mismatchFixed: syncProfilePersistence?.mismatchFixed,
        });
      } else {
        setTerminalBindingDiagnosticStatus('BINDING_ERROR');
        clearStoredErpSyncBinding();
        localStorage.setItem(TERMINAL_SETUP_PENDING_KEY, '1');
        if (previousActiveTerminalId) {
          localStorage.setItem('active_terminal_id', previousActiveTerminalId);
        } else {
          localStorage.removeItem('active_terminal_id');
        }
        if (previousTerminalStorageId) {
          localStorage.setItem('CLIC_POS_TERMINAL_ID', previousTerminalStorageId);
        } else {
          localStorage.removeItem('CLIC_POS_TERMINAL_ID');
        }
        if (previousInitialTerminalConfig) {
          localStorage.setItem('initial_terminal_config', previousInitialTerminalConfig);
        } else {
          localStorage.removeItem('initial_terminal_config');
        }
        setConfig(previousConfig);
        await db.save('config', previousConfig);
        setUsers(previousUsers);
        await db.save('users', previousUsers);
      }
      throw error instanceof Error ? error : new Error('No se pudo tomar control de la terminal. Revisa conexión y vuelve a intentar.');
    } finally {
      setRestoringHistory(false);
    }
  };

  const handleSetupWizardComplete = async (finalConfig: BusinessConfig) => {
    try {
      const nextConfig = {
        ...config,
        ...finalConfig
      };
      const effectiveDeviceId = deviceId || await restorePersistentDeviceIdAfterDbReset();
      const seedMode = nextConfig.metadata?.seedMode;
      const productSeedPackId = nextConfig.metadata?.productSeedPackId;
      if (seedMode === 'BLANK') {
        setCustomers([]);
        setTransactions([]);
        setProductStocks([]);
        const starterProducts = await db.get('products') as Product[];
        setProducts(Array.isArray(starterProducts) ? starterProducts : []);
      } else if (productSeedPackId) {
        const starterProducts = await db.get('products') as Product[];
        setProducts(Array.isArray(starterProducts) ? starterProducts : []);
      }

      localStorage.removeItem(TERMINAL_SETUP_PENDING_KEY);
      localStorage.setItem(TERMINAL_SETUP_MODE_KEY, 'SERVER_LOCAL');
      localStorage.setItem(SETUP_WIZARD_COMPLETED_KEY, '1');
      localStorage.setItem(SETUP_FLOW_STAGE_KEY, 'COMPLETE');
      localStorage.setItem(SETUP_FLOW_VERSION_KEY, SETUP_FLOW_VERSION);

      const setupMode = getStoredTerminalSetupMode();
      if (setupMode === 'SERVER_LOCAL') {
        const binding = await activateLocalPrimaryTerminal(nextConfig, effectiveDeviceId);
	        if (binding) {
	          localStorage.setItem('active_terminal_id', binding.terminalId);
	          localStorage.setItem('CLIC_POS_TERMINAL_ID', binding.terminalId);
	          persistInitialTerminalConfig(binding.nextConfig || nextConfig);
	          void posCloudStagingService.sendSnapshot('SETUP_WIZARD_COMPLETE').catch((error) => {
	            console.warn('⚠️ POS cloud staging snapshot failed after setup wizard:', error);
	          });
	          setCurrentView('LOGIN');
	          return;
	        }
      }

      setConfig(nextConfig);
      await db.save('config', nextConfig);

      const hasPairedTerminal = (nextConfig.terminals || []).some(
        terminal => terminal.config?.currentDeviceId === effectiveDeviceId
      );

      setCurrentView(hasPairedTerminal ? 'LOGIN' : 'TERMINAL_PAIRING');
    } catch (error) {
      console.error('❌ Failed to complete setup wizard:', error);
      alert('No se pudo guardar la configuración inicial. Intenta nuevamente.');
    }
  };

  const handleConfirmRecoverySequence = async () => {
    if (!recoverySequencePrompt) return;

    const cloudLastSequence = Number(recoverySequencePrompt.last_global_sequence || 0);
    const enteredSequence = Number(recoverySequenceInput);

    if (!Number.isFinite(enteredSequence) || enteredSequence < 0 || !Number.isInteger(enteredSequence)) {
      alert('Digite un número de secuencia válido.');
      return;
    }

    if (enteredSequence < cloudLastSequence) {
      alert(`El número ingresado debe ser mayor o igual al último número en la nube (${cloudLastSequence}).`);
      return;
    }

    await dbAdapter.saveCollection('globalSequenceCounter', enteredSequence as any);
    setRecoverySequencePrompt(null);
    setRecoverySequenceInput('');
    alert('Secuencia fiscal local alineada correctamente.');
  };

  const handleConfigUpdate = async (newConfig: BusinessConfig) => {
    console.log("handleConfigUpdate called", newConfig); // Debug log
    const tenantCompanyConfig = normalizeCompanyInfoFromTenantIdentity(newConfig);
    const configToSave = tenantCompanyConfig.config as BusinessConfig;
    setConfig(configToSave);
    await db.save('config', configToSave);

    // Initial Startup Logic for Floor Plan
    const activeTerminal = (configToSave.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
    const tableBehavior = activeTerminal?.config?.tables?.behavior;
    if (tableBehavior === 'SIEMPRE_MOSTRAR' && currentView === 'LOGIN') {
      // Only valid if we are transitioning from login, but handled in renderView or logic
    }

    // Re-initialize services with new config
    const currentTerminal = (configToSave.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
    if (currentTerminal) {
      console.log(`🔄 Re-initializing services for terminal ${currentTerminal.id} after config update...`);
      permissionService.initialize(newConfig, currentTerminal.id);
      authLevelService.init(newConfig, currentTerminal.id);
      terminalRouter.init(newConfig, currentTerminal.id, currentTerminal.config.deviceRole || null);

      // CRITICAL: Re-initialize SyncManager to avoid "Sync configuration missing"
      try {
        await syncManager.initialize(newConfig, currentTerminal.id);
        await backgroundSyncManager.initialize();
      } catch (e) {
        console.error("❌ Failed to re-initialize sync services:", e);
      }
    }

    await syncConfigToLocalServer(newConfig);
  };

  const handleUsersUpdate = async (newUsers: User[]) => {
    console.log(`handleUsersUpdate: Saving ${newUsers.length} POS users.`);
    const previousUsers = await db.get('users') as User[];
    setUsers(newUsers);
    await db.save('users', newUsers);

    if (isErpManagedPosUserRuntime()) {
      const queued = await queuePosUserRosterChanges(
        Array.isArray(previousUsers) ? previousUsers : [],
        newUsers,
      );
      if (queued > 0) {
        console.log(`[SYNC_USERS] Queued ${queued} POS user mutation(s) for ERP.`);
        backgroundSyncManager.triggerSync().catch(console.error);
      }
    }
  };

  const handleTeamUsersUpdate = async (newUsers: User[]) => {
    if (isErpManagedPosUserRuntime()) {
      console.warn('[ERP_ROLE_AUTHORITY] Local POS user changes are disabled.');
      return;
    }
    await handleUsersUpdate(newUsers);
  };

  const handleTeamRolesUpdate = async (newRoles: RoleDefinition[]) => {
    if (isErpManagedPosUserRuntime()) {
      console.warn('[ERP_ROLE_AUTHORITY] Local role and permission changes are disabled.');
      return;
    }
    setRoles(newRoles);
    await db.save('roles', newRoles);
  };

  // --- PERSISTENCE HANDLER FOR PARKED TICKETS ---
  const waitForTableInteractionIdle = async (): Promise<void> => {
    while (true) {
      const remaining = TABLE_PERSISTENCE_IDLE_MS - (performance.now() - lastTableInteractionAtRef.current);
      if (remaining <= 0) return;
      await new Promise<void>(resolve => window.setTimeout(resolve, Math.ceil(remaining)));
    }
  };

  const handleUpdateParkedTickets = async (
    tickets: ParkedTicket[],
    options: ParkedTicketSyncOptions = { reason: 'explicit' },
  ) => {
    const validTickets = (Array.isArray(tickets) ? tickets : []).filter(ticket => {
      const ticketId = String(ticket?.id || '').trim();
      return !ticketId || !closedRestaurantOrderIdsRef.current.has(ticketId);
    });
    const changedTicketId = String(options.changedTicketId || '').trim();
    const persistTicketsLocally = async () => {
      if (!changedTicketId) {
        await db.save('parkedTickets', validTickets);
        return;
      }

      const changedTicket = validTickets.find(ticket => String(ticket.id) === changedTicketId);
      if (changedTicket) {
        await db.saveDocument('parkedTickets', changedTicket);
      } else {
        await db.deleteDocument('parkedTickets', changedTicketId);
      }
    };
    if (isClientTerminalMode()) {
      const editLock = activeTableEditLockRef.current;
      const tableSyncTickets = scopeTicketsForTableSync(validTickets, editLock?.tableId);
      const pendingSync: PendingClientTableSync = {
        id: 'current',
        status: 'PENDING',
        tableId: editLock?.tableId,
        queuedAt: new Date().toISOString(),
        reason: options.reason || 'explicit',
        parkedTickets: tableSyncTickets,
      };
      pendingClientTableSyncRef.current = pendingSync;
      writePendingTableSyncMirror(pendingSync);
      if (!changedTicketId) writeCriticalCollectionsMirror(validTickets, cashMovements);
      setParkedTickets(validTickets);
      const persistLocal = () => Promise.allSettled([
        persistTicketsLocally(),
        persistPendingClientTableSync(pendingSync),
      ]);

      if (options.deferRemote) {
        window.setTimeout(() => void persistLocal(), 0);
        return;
      }

      const syncOperation = async () => {
        await persistLocal();
        const response = await fetch(resolveOperationalApiUrl('/api/mesas/parked-tickets'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parkedTickets: tableSyncTickets,
            tableId: editLock?.tableId,
            ownerId: editLock?.ownerId,
            lockToken: editLock?.token,
            baseRevision: masterRestaurantRevisionRef.current,
          })
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || result?.success === false) {
          throw new Error(result?.message || `Master respondió HTTP ${response.status}`);
        }
        const sharedTickets = Array.isArray(result?.parkedTickets) ? result.parkedTickets : validTickets;
        const responseRevision = Number(result?.revision || 0);
        if (Number.isFinite(responseRevision) && responseRevision > masterRestaurantRevisionRef.current) {
          masterRestaurantRevisionRef.current = responseRevision;
        }
        const newerPendingSync = pendingClientTableSyncRef.current;
        const effectiveSharedTickets = newerPendingSync && newerPendingSync !== pendingSync
          ? mergePendingClientTableTickets(sharedTickets, newerPendingSync)
          : sharedTickets;
        const canApplyAcknowledgedSnapshot =
          pendingClientTableSyncRef.current === pendingSync
          && currentViewRef.current === 'TABLE_MAP'
          && !activeTableEditLockRef.current;
        if (canApplyAcknowledgedSnapshot) {
          setParkedTickets(effectiveSharedTickets);
          if (Array.isArray(result?.tables)) setTables(result.tables);
        }
        if (pendingClientTableSyncRef.current === pendingSync) {
          pendingClientTableSyncRef.current = null;
          await clearPendingClientTableSync();
        }
        void fetchTables().catch(error => {
          console.warn('[TABLE_SYNC] No se pudo refrescar el mapa después de guardar:', error);
        });
      };
      const queuedSync = parkedTicketSyncQueueRef.current
        .catch(() => undefined)
        .then(() => new Promise<void>(resolve => window.requestAnimationFrame(() => window.setTimeout(resolve, 0))))
        .then(waitForTableInteractionIdle)
        .then(syncOperation);
      parkedTicketSyncQueueRef.current = queuedSync.catch(() => undefined);
      void queuedSync.catch(error => console.warn('[TABLE_SYNC] Reconciliación cliente diferida:', error));
      return;
    }
    const servesAsNativeMaster =
      isNativeAndroidRuntime() &&
      isNativeStandaloneTerminalRuntime(getCurrentTerminal());
    const masterEditLock = servesAsNativeMaster ? activeTableEditLockRef.current : null;
    const masterTableSyncTickets = scopeTicketsForTableSync(validTickets, masterEditLock?.tableId);
    const masterPendingSync: PendingClientTableSync | null = masterEditLock?.tableId
      ? {
          id: 'current',
          status: 'PENDING',
          tableId: String(masterEditLock.tableId),
          queuedAt: new Date().toISOString(),
          reason: options.reason || 'explicit',
          parkedTickets: masterTableSyncTickets,
        }
      : null;
    // Debe registrarse antes de cualquier await de persistencia: el poll nativo
    // corre cada segundo y podría aplicar una revisión Cliente en ese intervalo.
    if (masterPendingSync) {
      pendingMasterTableSyncRef.current = masterPendingSync;
      writePendingTableSyncMirror(masterPendingSync);
    }
    if (!changedTicketId) writeCriticalCollectionsMirror(validTickets, cashMovements);
    setParkedTickets(validTickets);
    const persistMasterTickets = async () => {
      await persistTicketsLocally();
    };

    // La caja maestra Android también debe confirmar el cambio en el servidor
    // nativo antes de que el poll de estado pueda devolver el snapshot previo.
    // Sin esta escritura atómica, la primera digitación de una mesa recién
    // abierta podía ser reemplazada por la revisión creada al abrir la mesa.
    if (servesAsNativeMaster) {
      // El autoguardado y el cobro pueden coincidir. Serializar también en
      // Master evita que un snapshot anterior vuelva a insertar una orden ya cobrada.
      const syncOperation = async () => {
        await persistMasterTickets();
        const response = await fetch(resolveOperationalApiUrl('/api/mesas/parked-tickets'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          // Con lock activo, actualizar únicamente esta mesa. Una Terminal Cliente
          // puede estar guardando otra al mismo tiempo y su estado no debe ser
          // reemplazado por el snapshot completo de la Master.
          body: JSON.stringify({
            parkedTickets: masterTableSyncTickets,
            ...(masterEditLock?.tableId ? {
              tableId: masterEditLock.tableId,
              ownerId: masterEditLock.ownerId,
              lockToken: masterEditLock.token,
              baseRevision: masterRestaurantRevisionRef.current,
            } : {}),
          }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || result?.success === false) {
          throw new Error(result?.message || `No se pudo confirmar la orden local (HTTP ${response.status})`);
        }
        const sharedTickets = Array.isArray(result?.parkedTickets) ? result.parkedTickets : validTickets;
        const newerPendingSync = pendingMasterTableSyncRef.current;
        const effectiveSharedTickets = newerPendingSync && newerPendingSync !== masterPendingSync
          ? mergePendingClientTableTickets(sharedTickets, newerPendingSync)
          : sharedTickets;
        const canApplyAcknowledgedSnapshot =
          pendingMasterTableSyncRef.current === masterPendingSync
          && currentViewRef.current === 'TABLE_MAP'
          && !activeTableEditLockRef.current;
        if (canApplyAcknowledgedSnapshot) {
          setParkedTickets(effectiveSharedTickets);
          if (Array.isArray(result?.tables)) {
            setTables(reconcileTablesWithParkedTickets(result.tables, effectiveSharedTickets));
          }
        }
        const responseRevision = Number(result?.revision || 0);
        if (Number.isFinite(responseRevision) && responseRevision > masterRestaurantRevisionRef.current) {
          masterRestaurantRevisionRef.current = responseRevision;
        }
        if (pendingMasterTableSyncRef.current === masterPendingSync) {
          pendingMasterTableSyncRef.current = null;
          writePendingTableSyncMirror({
            id: 'current',
            status: 'EMPTY',
            queuedAt: new Date().toISOString(),
            parkedTickets: [],
          });
        }
      };
      const queuedSync = parkedTicketSyncQueueRef.current
        .catch(() => undefined)
        .then(() => new Promise<void>(resolve => window.requestAnimationFrame(() => window.setTimeout(resolve, 0))))
        .then(waitForTableInteractionIdle)
        .then(syncOperation);
      parkedTicketSyncQueueRef.current = queuedSync.catch(() => undefined);
      void queuedSync.catch(error => console.warn('[TABLE_SYNC] Reconciliación Master diferida:', error));
      return;
    }
    window.setTimeout(() => {
      void waitForTableInteractionIdle()
        .then(persistMasterTickets)
        .catch(error => console.warn('[TABLE_SYNC] Persistencia local diferida:', error));
    }, 0);
  };

  const handleParkedOrderSplitFromMap = useCallback(
    async (orderId: string, remainingItems: CartItem[], newTicketItems: CartItem[], extraNewTickets: CartItem[][] = [], splitCount = 2) => {
      const sumItems = (items: CartItem[]) =>
        items.reduce((acc, item) => acc + Number(item.price || 0) * Number(item.quantity || 0), 0);
      const source = parkedTickets.find(p => p.id === orderId);
      if (!source) {
        alert('No se encontró la orden en espera.');
        return;
      }
      const others = parkedTickets.filter(t => t.id !== orderId);
      const kept =
        remainingItems.length > 0
          ? [{ ...source, items: remainingItems, total: sumItems(remainingItems) }]
          : [];
      const tableLinked = tables.find(t => t.currentOrderId === orderId);
      const labelBase = tableLinked?.nombre || tableLinked?.name || source.name || 'Mesa';
      const now = Date.now();
      const splitGroups = [newTicketItems, ...extraNewTickets].filter(items => items.length > 0);
      const newTickets: ParkedTicket[] = splitGroups.map((items, index) => ({
        ...source,
        id: `split-${now}-${index + 2}`,
        name: `${labelBase} - Cuenta ${index + 2}/${splitCount}`,
        alias: `${labelBase} - Cuenta ${index + 2}/${splitCount}`,
        items,
        total: sumItems(items),
        timestamp: new Date().toISOString(),
        tableId: tableLinked?.id
      }));
      await handleUpdateParkedTickets([...others, ...kept, ...newTickets]);
      await fetchTables();
    },
    [parkedTickets, tables, fetchTables]
  );

  const handleUpdateActiveTableGuests = async (guests: number) => {
    if (!activeTable) return;
    try {
      const updatedTable = { ...activeTable, guests };
      setActiveTable(updatedTable);
      setTables(prev => prev.map(t => t.id === activeTable.id ? updatedTable : t));

      const editLock = activeTableEditLockRef.current;
      const response = await fetch(resolveOperationalApiUrl(`/api/tables/${encodeURIComponent(String(activeTable.id))}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guests,
          ownerId: editLock?.ownerId,
          lockToken: editLock?.token,
        })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success === false) {
        throw new Error(result?.message || `Master respondió HTTP ${response.status}`);
      }
      if (Array.isArray(result?.tables)) setTables(result.tables);
      if (Array.isArray(result?.parkedTickets)) setParkedTickets(result.parkedTickets);
      const revision = Number(result?.revision || 0);
      if (Number.isFinite(revision) && revision > masterRestaurantRevisionRef.current) {
        masterRestaurantRevisionRef.current = revision;
      }
      await db.save('tables', Array.isArray(result?.tables) ? result.tables : tables.map(
        table => table.id === activeTable.id ? updatedTable : table
      ));
    } catch (e) {
      console.error("Failed to update guest count:", e);
      alert('No se pudo guardar la cantidad de comensales en la Caja Master.');
    }
  };

  const handleAddCustomer = async (customer: Customer) => {
    const numberedCustomer = await createNumberedMaster('CUSTOMER', 'customers', customer);
    customer = numberedCustomer;
    const mergeCustomer = (source: Customer[]) => [
      ...source.filter(existing => String(existing.id) !== String(customer.id)),
      customer,
    ];
    const localCustomers = mergeCustomer(customers);
    setCustomers(localCustomers);
    await db.save('customers', localCustomers);

    if (isClientTerminalMode()) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(resolveOperationalApiUrl('/api/customers'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customer }),
          signal: controller.signal,
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || result?.success === false) {
          throw new Error(result?.message || `Master respondió HTTP ${response.status}`);
        }
        const sharedCustomers = Array.isArray(result?.customers) ? result.customers : localCustomers;
        setCustomers(sharedCustomers);
        await db.save('customers', sharedCustomers);
        const revision = Number(result?.revision || 0);
        if (Number.isFinite(revision) && revision > masterRestaurantRevisionRef.current) {
          masterRestaurantRevisionRef.current = revision;
        }
        return;
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    if (!customer.master_number_range_id) await queueCustomerMutation('UPSERT', customer);
    backgroundSyncManager.triggerSync().catch(console.error);
  };

  const handleRepairLegacyReceivables = useCallback(async (): Promise<ReceivableRepairSummary> => {
    const now = new Date().toISOString();
    const [persistedTransactions, persistedTransactionHistory, persistedCustomers, persistedWallets, persistedWalletTransactions] = await Promise.all([
      db.get('transactions') as Promise<Transaction[] | null>,
      db.get('transactionHistory') as Promise<Transaction[] | null>,
      db.get('customers') as Promise<Customer[] | null>,
      db.get('wallets' as any) as Promise<any[] | null>,
      db.get('wallet_transactions' as any) as Promise<any[] | null>
    ]);

    const activeTransactions = Array.isArray(persistedTransactions) ? persistedTransactions : transactions;
    const historyTransactions = Array.isArray(persistedTransactionHistory) ? persistedTransactionHistory : [];
    const sourceCustomers = Array.isArray(persistedCustomers) ? persistedCustomers : customers;
    const wallets = Array.isArray(persistedWallets) ? persistedWallets : [];
    const walletMovements = Array.isArray(persistedWalletTransactions) ? persistedWalletTransactions : [];

    const inferPendingBalance = (tx: Transaction): number => {
      const paymentEntries = Array.isArray(tx.payments) ? tx.payments : [];
      const creditFromPayments = paymentEntries.reduce((sum: number, payment: any) => {
        const candidates = [
          normalizePaymentMethod(payment?.method),
          normalizePaymentMethod(payment?.methodLabel),
          normalizePaymentMethod(payment?.methodId),
          normalizePaymentMethod(payment?.type)
        ];
        const hasCreditMarker = candidates.some(marker => CREDIT_PAYMENT_METHODS.has(marker));
        if (!hasCreditMarker) return sum;
        return sum + toPositiveNumber(payment?.amount);
      }, 0);

      if (creditFromPayments > 0) return parseFloat(creditFromPayments.toFixed(2));

      const balanceDue = toPositiveNumber(tx.balanceDueAtSale);
      if (balanceDue > 0) return parseFloat(balanceDue.toFixed(2));

      return 0;
    };

    const repairTransactions = (items: Transaction[]) => {
      const repairedIds: string[] = [];
      const updatedItems = items.map((tx) => {
        if (tx.status === 'REFUNDED') return tx;

        const currentPending = toPositiveNumber(tx.pendingBalance);
        if (currentPending > 0) return tx;

        const inferredPending = inferPendingBalance(tx);
        if (inferredPending <= 0) return tx;

        repairedIds.push(tx.id);
        return {
          ...tx,
          pendingBalance: inferredPending,
          balanceDueAtSale: toPositiveNumber(tx.balanceDueAtSale) > 0 ? tx.balanceDueAtSale : inferredPending,
          dueDate: tx.dueDate || new Date(new Date(tx.date).getTime() + (30 * 24 * 60 * 60 * 1000)).toISOString(),
          syncStatus: 'PENDING' as const
        };
      });

      return { repairedIds, updatedItems };
    };

    const activeRepair = repairTransactions(activeTransactions);
    const historyRepair = repairTransactions(historyTransactions);

    const repairedTransactions = [...activeRepair.updatedItems];
    const repairedHistoryTransactions = [...historyRepair.updatedItems];
    const repairedIdSet = new Set([...activeRepair.repairedIds, ...historyRepair.repairedIds]);
    const repairedIds = Array.from(repairedIdSet);

    const normalizeDocId = (value: unknown): string => {
      if (typeof value !== 'string') return '';
      return value.trim().toUpperCase();
    };

    const seenDisplayIds = new Set<string>();
    for (const tx of [...repairedTransactions, ...repairedHistoryTransactions]) {
      const displayId = normalizeDocId(tx.displayId);
      if (displayId) seenDisplayIds.add(displayId);
    }

    const walletById = new Map<string, any>();
    for (const wallet of wallets) {
      if (!wallet?.id) continue;
      walletById.set(String(wallet.id), wallet);
    }

    const customerById = new Map<string, Customer>();
    for (const customer of sourceCustomers) {
      if (!customer?.id) continue;
      customerById.set(customer.id, customer);
    }

    const isRefundDocument = (tx: Transaction): boolean => {
      const docType = typeof tx.documentType === 'string' ? tx.documentType.trim().toUpperCase() : '';
      const ncfType = typeof tx.ncfType === 'string' ? tx.ncfType.trim().toUpperCase() : '';
      const displayId = typeof tx.displayId === 'string' ? tx.displayId.trim().toUpperCase() : '';
      return docType === 'REFUND' || ncfType === 'B04' || displayId.startsWith('NC');
    };

    const toMillis = (value?: string): number => {
      const ts = value ? new Date(value).getTime() : NaN;
      return Number.isFinite(ts) ? ts : 0;
    };

    const salesCandidatesByCustomer = new Map<string, Transaction[]>();
    for (const tx of [...repairedTransactions, ...repairedHistoryTransactions]) {
      const customerId = typeof tx.customerId === 'string' ? tx.customerId.trim() : '';
      if (!customerId) continue;
      if (isRefundDocument(tx)) continue;
      const list = salesCandidatesByCustomer.get(customerId) || [];
      list.push(tx);
      salesCandidatesByCustomer.set(customerId, list);
    }

    const pickAffectedInvoice = (customerId: string, creditNoteAmount: number, movementDate: string): Transaction | null => {
      const candidates = salesCandidatesByCustomer.get(customerId) || [];
      if (candidates.length === 0) return null;

      const movementMs = toMillis(movementDate);
      let best: Transaction | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const candidate of candidates) {
        let score = 0;
        if (candidate.status === 'PARTIAL_REFUND' || candidate.status === 'REFUNDED') score += 40;
        if (toPositiveNumber(candidate.total) + 0.01 >= creditNoteAmount) score += 12;

        const candidateMs = toMillis(candidate.date);
        const diffMs = movementMs > 0 && candidateMs > 0
          ? Math.abs(candidateMs - movementMs)
          : Number.POSITIVE_INFINITY;
        if (diffMs <= 24 * 60 * 60 * 1000) score += 20;
        else if (diffMs <= 7 * 24 * 60 * 60 * 1000) score += 10;
        else if (diffMs <= 30 * 24 * 60 * 60 * 1000) score += 4;

        if (typeof candidate.ncf === 'string' && candidate.ncf.trim()) score += 5;
        if (typeof candidate.displayId === 'string' && candidate.displayId.trim()) score += 3;

        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
      return best;
    };

    const extractB04NcfFromMovement = (movement: any): string | undefined => {
      const rawCandidates = [
        movement?.ncf,
        movement?.ncfB04,
        movement?.fiscalNcf,
        movement?.b04,
        movement?.metadata?.ncf,
        movement?.meta?.ncf
      ];
      for (const raw of rawCandidates) {
        if (typeof raw !== 'string') continue;
        const candidate = raw.trim().toUpperCase();
        if (candidate.startsWith('B04')) return candidate;
      }
      return undefined;
    };

    const synthesizedCreditNotes: Transaction[] = [];
    const synthesizedIdSet = new Set<string>();
    const enrichedCreditNoteIds = new Set<string>();

    const upsertTxById = (nextTx: Transaction) => {
      const activeIdx = repairedTransactions.findIndex(tx => tx.id === nextTx.id);
      if (activeIdx >= 0) repairedTransactions[activeIdx] = nextTx;
      const historyIdx = repairedHistoryTransactions.findIndex(tx => tx.id === nextTx.id);
      if (historyIdx >= 0) repairedHistoryTransactions[historyIdx] = nextTx;
    };

    const txIdsByDisplayId = new Map<string, string[]>();
    for (const tx of [...repairedTransactions, ...repairedHistoryTransactions]) {
      const key = normalizeDocId(tx.displayId);
      if (!key) continue;
      const list = txIdsByDisplayId.get(key) || [];
      if (!list.includes(tx.id)) list.push(tx.id);
      txIdsByDisplayId.set(key, list);
    }

    let scannedWalletMovements = 0;
    for (const movement of walletMovements) {
      scannedWalletMovements++;

      const refRaw = typeof movement?.referenceId === 'string' ? movement.referenceId.trim() : '';
      const ref = normalizeDocId(refRaw);
      if (!ref.startsWith('NC')) continue;

      const movementAmount = toPositiveNumber(movement?.amount);
      if (movementAmount <= 0) continue;

      const wallet = walletById.get(String(movement?.walletId || ''));
      const customerId = wallet?.customerId ? String(wallet.customerId) : '';
      if (!customerId) continue;

      const parsedMovementDate = typeof movement?.createdAt === 'string' ? new Date(movement.createdAt).getTime() : NaN;
      const movementDate = Number.isFinite(parsedMovementDate) ? String(movement.createdAt) : now;
      const roundedAmount = parseFloat(movementAmount.toFixed(2));
      const displayId = refRaw || ref;
      const inferredB04Ncf = extractB04NcfFromMovement(movement);
      const affectedSale = pickAffectedInvoice(customerId, roundedAmount, movementDate);
      const inferredAffectedInvoice = (affectedSale?.displayId || affectedSale?.id || '').toString().trim();
      const inferredAffectedNCF = (affectedSale?.ncf || '').toString().trim();

      if (seenDisplayIds.has(ref)) {
        const existingIds = txIdsByDisplayId.get(ref) || [];
        for (const existingId of existingIds) {
          const existing = repairedTransactions.find(tx => tx.id === existingId)
            || repairedHistoryTransactions.find(tx => tx.id === existingId);
          if (!existing) continue;
          if (!isRefundDocument(existing)) continue;

          const patch: Partial<Transaction> = {};
          if ((!existing.ncf || !existing.ncf.trim()) && inferredB04Ncf) patch.ncf = inferredB04Ncf;
          if ((!existing.affectedInvoiceNumber || !existing.affectedInvoiceNumber.trim()) && inferredAffectedInvoice) {
            patch.affectedInvoiceNumber = inferredAffectedInvoice;
          }
          if ((!existing.affectedNCF || !existing.affectedNCF.trim()) && inferredAffectedNCF) {
            patch.affectedNCF = inferredAffectedNCF;
          }
          if (!existing.originalTransactionId && affectedSale?.id) patch.originalTransactionId = affectedSale.id;

          if (Object.keys(patch).length <= 0) continue;

          const patchedTx: Transaction = {
            ...existing,
            ...patch,
            syncStatus: 'PENDING'
          };
          upsertTxById(patchedTx);
          await db.saveDocument('transactions', patchedTx);
          await db.saveDocument('transactionHistory', patchedTx);
          enrichedCreditNoteIds.add(patchedTx.displayId || patchedTx.id);
        }
        continue;
      }

      const owner = customerById.get(customerId);
      const rawMovementId = movement?.id !== undefined && movement?.id !== null
        ? String(movement.id).trim()
        : `${customerId}-${ref}`;
      const synthesizedId = `WLT-NC-${rawMovementId}-${customerId}`.replace(/[^a-zA-Z0-9_.:-]/g, '_');
      if (synthesizedIdSet.has(synthesizedId)) continue;

      const syntheticCreditNote: Transaction = {
        id: synthesizedId,
        displayId,
        documentType: 'REFUND',
        date: movementDate,
        items: [],
        total: roundedAmount,
        payments: [{ method: 'STORE_CREDIT', amount: roundedAmount }],
        userId: 'SYSTEM',
        userName: 'Sistema',
        terminalId: 'N/A',
        status: 'REFUNDED',
        customerId,
        customerName: owner?.name,
        ncf: inferredB04Ncf,
        ncfType: 'B04',
        affectedInvoiceNumber: inferredAffectedInvoice || undefined,
        affectedNCF: inferredAffectedNCF || undefined,
        originalTransactionId: affectedSale?.id,
        refundReason: 'NC recuperada desde wallet',
        syncStatus: 'PENDING'
      };

      synthesizedCreditNotes.push(syntheticCreditNote);
      synthesizedIdSet.add(synthesizedId);
      seenDisplayIds.add(ref);
      txIdsByDisplayId.set(ref, [...(txIdsByDisplayId.get(ref) || []), synthesizedId]);
      repairedTransactions.push(syntheticCreditNote);
      repairedHistoryTransactions.push(syntheticCreditNote);
    }

    const combinedBefore = [...activeTransactions, ...historyTransactions];
    const combinedAfter = [...repairedTransactions, ...repairedHistoryTransactions];

    const totalPendingBefore = parseFloat(combinedBefore
      .reduce((sum, tx) => sum + toPositiveNumber(tx.pendingBalance), 0)
      .toFixed(2));
    const totalPendingAfter = parseFloat(combinedAfter
      .reduce((sum, tx) => sum + toPositiveNumber(tx.pendingBalance), 0)
      .toFixed(2));

    if (activeRepair.repairedIds.length > 0) {
      const activeSet = new Set(activeRepair.repairedIds);
      for (const tx of repairedTransactions) {
        if (!activeSet.has(tx.id)) continue;
        await db.saveDocument('transactions', tx);
      }
    }

    if (historyRepair.repairedIds.length > 0) {
      const historySet = new Set(historyRepair.repairedIds);
      for (const tx of repairedHistoryTransactions) {
        if (!historySet.has(tx.id)) continue;
        await db.saveDocument('transactionHistory', tx);
      }
    }

    if (synthesizedCreditNotes.length > 0) {
      for (const note of synthesizedCreditNotes) {
        await db.saveDocument('transactions', note);
        await db.saveDocument('transactionHistory', note);
      }
    }

    const dedupedForDebt = new Map<string, Transaction>();
    for (const tx of combinedAfter) {
      if (!tx?.id) continue;
      const existing = dedupedForDebt.get(tx.id);
      if (!existing) {
        dedupedForDebt.set(tx.id, tx);
        continue;
      }

      const existingPending = toPositiveNumber(existing.pendingBalance);
      const nextPending = toPositiveNumber(tx.pendingBalance);
      if (nextPending > existingPending) {
        dedupedForDebt.set(tx.id, tx);
      }
    }

    const effectiveReceivables = Array.from(dedupedForDebt.values());

    const debtByCustomer = new Map<string, number>();
    for (const tx of effectiveReceivables) {
      if (tx.status === 'REFUNDED') continue;
      if (!tx.customerId) continue;
      const pending = toPositiveNumber(tx.pendingBalance);
      if (pending <= 0) continue;
      const previous = debtByCustomer.get(tx.customerId) || 0;
      debtByCustomer.set(tx.customerId, parseFloat((previous + pending).toFixed(2)));
    }

    let changedCustomers = 0;
    const recalculatedCustomers = sourceCustomers.map((customer) => {
      const recalculatedDebt = parseFloat(((debtByCustomer.get(customer.id) || 0)).toFixed(2));
      const currentDebt = parseFloat((toPositiveNumber(customer.currentDebt)).toFixed(2));
      if (Math.abs(currentDebt - recalculatedDebt) < 0.01) return customer;

      changedCustomers++;
      return {
        ...customer,
        currentDebt: recalculatedDebt,
        updatedAt: now
      };
    });

    if (changedCustomers > 0) {
      for (const customer of recalculatedCustomers) {
        const persistedDebt = parseFloat((toPositiveNumber((sourceCustomers.find(c => c.id === customer.id)?.currentDebt))).toFixed(2));
        const nextDebt = parseFloat((toPositiveNumber(customer.currentDebt)).toFixed(2));
        if (Math.abs(persistedDebt - nextDebt) < 0.01) continue;
        await db.saveDocument('customers', customer);
      }
    }

    setTransactions(repairedTransactions);
    if (changedCustomers > 0) {
      setCustomers(recalculatedCustomers);
    }

    backgroundSyncManager.triggerSync().catch(console.error);

    const scannedTransactions = dedupedForDebt.size;
    const repairedCreditNoteIdSet = new Set<string>([
      ...synthesizedCreditNotes.map(note => note.displayId || note.id),
      ...Array.from(enrichedCreditNoteIds)
    ]);
    return {
      scannedTransactions,
      scannedWalletMovements,
      repairedTransactions: repairedIds.length,
      repairedCreditNotes: repairedCreditNoteIdSet.size,
      recalculatedCustomers: recalculatedCustomers.length,
      customersWithDebtChanges: changedCustomers,
      totalPendingBefore,
      totalPendingAfter,
      transactionIds: repairedIds,
      creditNoteIds: Array.from(repairedCreditNoteIdSet)
    };
  }, [customers, transactions]);

  const upsertFiscalTransaction = useCallback(async (nextTransaction: Transaction) => {
    setTransactions(prev => {
      const exists = prev.some(tx => tx.id === nextTransaction.id);
      if (exists) return prev.map(tx => tx.id === nextTransaction.id ? nextTransaction : tx);
      return [nextTransaction, ...prev];
    });
    await db.saveDocument('transactions', nextTransaction);
    try {
      await db.saveDocument('transactionHistory', nextTransaction);
    } catch (historyMirrorError) {
      console.warn('⚠️ Fiscal history mirror update skipped:', historyMirrorError);
    }
  }, []);

  const correctFiscalDocument = useCallback(async (
    transaction: Transaction,
    correction: FiscalDocumentCorrectionInput
  ): Promise<Transaction> => {
    if (!canRetryFiscalTransaction(transaction)) {
      throw new Error('Solo se pueden corregir e-CF pendientes o con error.');
    }
    if (correction.fiscalCode !== 'E31' && correction.fiscalCode !== 'E32') {
      throw new Error('Por ahora la corrección fiscal permite E31 o E32.');
    }

    const reason = (correction.reason || '').trim();
    if (!reason) {
      throw new Error('Indica el motivo de la corrección fiscal.');
    }

    const selectedCustomer = correction.customerId
      ? customers.find(customer => customer.id === correction.customerId)
      : undefined;
    const selectedTaxDigits = (selectedCustomer?.taxId || '').replace(/\D/g, '');
    if (correction.fiscalCode === 'E31' && (!selectedCustomer || (selectedTaxDigits.length !== 9 && selectedTaxDigits.length !== 11))) {
      throw new Error('Para E31 selecciona un cliente con RNC/Cédula válido.');
    }

    const currentFiscalCode = getFiscalDisplayCode(transaction);
    const currentNcf = transaction.electronicNcf || transaction.ncf || '';
    const terminalId = transaction.terminalId || (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.id || 'T1';
    const fiscalCodeChanged = currentFiscalCode !== correction.fiscalCode || !currentNcf.startsWith(correction.fiscalCode);
    const nextNcf = fiscalCodeChanged
      ? await db.getNextNCF(correction.fiscalCode, terminalId, 50)
      : currentNcf || undefined;

    if (!nextNcf) {
      throw new Error(`No hay secuencia local disponible para ${correction.fiscalCode}.`);
    }

    const correctedAt = new Date().toISOString();
    const customerSnapshot = selectedCustomer ? {
      name: selectedCustomer.name,
      taxId: selectedCustomer.taxId,
      address: selectedCustomer.address,
      phone: selectedCustomer.phone,
      email: selectedCustomer.email
    } : undefined;

    let correctedTransaction: Transaction = {
      ...transaction,
      terminalId,
      ncfType: correction.fiscalCode,
      ncf: nextNcf,
      electronicNcf: nextNcf,
      legacyNcf: undefined,
      customerId: selectedCustomer?.id,
      customerName: selectedCustomer?.name || (correction.fiscalCode === 'E32' ? 'Consumidor final' : transaction.customerName),
      customerSnapshot,
      fiscalSyncStatus: 'PENDING',
      fiscalSyncError: undefined,
      fiscalReferenceId: undefined,
      fiscalResponseMessage: `Corrección e-CF aplicada por ${currentUser?.name || 'usuario POS'}. Pendiente de reenvío fiscal.`,
      fiscalSyncedAt: undefined,
      syncStatus: transaction.syncStatus === 'COMPLETED' ? transaction.syncStatus : 'PENDING',
      updatedAt: correctedAt,
      fiscalCorrectionAudit: [
        ...(transaction.fiscalCorrectionAudit || []),
        {
          id: `FISCAL-CORR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          correctedAt,
          correctedById: currentUser?.id,
          correctedByName: currentUser?.name,
          reason,
          old: {
            fiscalCode: currentFiscalCode,
            ncf: currentNcf || transaction.legacyNcf,
            customerId: transaction.customerId,
            customerName: transaction.customerName,
            customerTaxId: transaction.customerSnapshot?.taxId,
            netAmount: transaction.netAmount,
            taxAmount: transaction.taxAmount,
            total: transaction.total,
            fiscalSyncStatus: transaction.fiscalSyncStatus,
            fiscalSyncError: transaction.fiscalSyncError
          },
          next: {
            fiscalCode: correction.fiscalCode,
            ncf: nextNcf,
            customerId: selectedCustomer?.id,
            customerName: selectedCustomer?.name || (correction.fiscalCode === 'E32' ? 'Consumidor final' : transaction.customerName),
            customerTaxId: selectedCustomer?.taxId,
            fiscalSyncStatus: 'PENDING'
          }
        }
      ]
    };

    if (correction.recalculateTaxes) {
      const terminalConfig = config.terminals?.find(terminal => terminal.id === terminalId)?.config;
      const fiscalSummary = calculateTransactionFiscalSummary(correctedTransaction, config, { terminalConfig });
      correctedTransaction = {
        ...correctedTransaction,
        netAmount: fiscalSummary.subtotal,
        taxAmount: fiscalSummary.taxTotal,
        taxBreakdown: fiscalSummary.taxBreakdown,
        total: fiscalSummary.total
      };

      const audit = correctedTransaction.fiscalCorrectionAudit?.[correctedTransaction.fiscalCorrectionAudit.length - 1];
      if (audit) {
        audit.next.netAmount = correctedTransaction.netAmount;
        audit.next.taxAmount = correctedTransaction.taxAmount;
        audit.next.total = correctedTransaction.total;
      }
    }

    await upsertFiscalTransaction(correctedTransaction);
    return correctedTransaction;
  }, [config, currentUser, customers, deviceId, upsertFiscalTransaction]);

  const pollFiscalDocumentStatus = useCallback(async (
    transaction: Transaction,
    providerId: Exclude<Transaction['fiscalProvider'], undefined | 'NONE'>,
    environment: number,
    providerTransactionId: string,
    credentialKey?: string,
    deliveryMode?: 'LOCAL_DIRECT' | 'DELEGATED_ERP',
    attempt = 1
  ) => {
    try {
      const result = await getFiscalDocumentStatus(
        providerId,
        environment,
        providerTransactionId,
        config.companyInfo,
        credentialKey,
        deliveryMode
      );

      const finalStatus = result.pending ? 'PENDING' : result.success ? 'SYNCED' : 'ERROR';
      const refreshedTransaction: Transaction = {
        ...transaction,
        fiscalSyncStatus: finalStatus,
        fiscalSyncError: result.success ? undefined : result.message,
        fiscalReferenceId: providerTransactionId,
        fiscalResponseMessage: result.message,
        fiscalSyncedAt: result.success && !result.pending ? new Date().toISOString() : transaction.fiscalSyncedAt
      };

      await upsertFiscalTransaction(refreshedTransaction);

      if (result.pending && attempt < 8) {
        window.setTimeout(() => {
          pollFiscalDocumentStatus(
            refreshedTransaction,
            providerId,
            environment,
            providerTransactionId,
            credentialKey,
            deliveryMode,
            attempt + 1
          ).catch(console.error);
        }, attempt < 3 ? 3000 : 5000);
      }
    } catch (error: any) {
      if (attempt >= 8) {
        const failedTransaction: Transaction = {
          ...transaction,
          fiscalSyncStatus: 'ERROR',
          fiscalSyncError: error?.message || 'No se pudo consultar el estado del e-CF.',
          fiscalReferenceId: providerTransactionId,
          fiscalResponseMessage: error?.message || 'No se pudo consultar el estado del e-CF.'
        };
        await upsertFiscalTransaction(failedTransaction);
        return;
      }

      window.setTimeout(() => {
        pollFiscalDocumentStatus(
          transaction,
          providerId,
          environment,
          providerTransactionId,
          credentialKey,
          deliveryMode,
          attempt + 1
        ).catch(console.error);
      }, 5000);
    }
  }, [config.companyInfo, upsertFiscalTransaction]);

  const syncFiscalDocument = useCallback(async (transaction: Transaction) => {
    const providerId = transaction.fiscalProvider;
    const documentCode = transaction.ncfType;
    const electronicNcf = transaction.electronicNcf || transaction.ncf;

    if (!providerId || providerId === 'NONE') return;
    if (!documentCode || !documentCode.startsWith('E')) return;
    if (!electronicNcf) return;

    try {
      const terminalConfig = config.terminals?.find((terminal) => terminal.id === transaction.terminalId)?.config;
      const fiscalCompliance = getEffectiveFiscalComplianceConfig(config, terminalConfig);
      const environment = getProviderEnvironment(fiscalCompliance, providerId);
      const providerConfig = getFiscalProviderConfig(fiscalCompliance, providerId);
      const establishmentCode = resolveFiscalProviderEstablishmentCode(providerConfig, fiscalCompliance, terminalConfig, config);
      const cashierCode = resolveFiscalProviderCashierCode(providerConfig, fiscalCompliance, terminalConfig, config);
      const fiscalSummary = calculateTransactionFiscalSummary(transaction, config, { terminalConfig });
      const baseTransaction: Transaction = {
        ...transaction,
        taxAmount: fiscalSummary.taxTotal,
        netAmount: fiscalSummary.subtotal,
        taxBreakdown: fiscalSummary.taxBreakdown,
        fiscalSyncStatus: 'PENDING',
        fiscalSyncError: undefined
      };

      await upsertFiscalTransaction(baseTransaction);

      const result = await issueFiscalDocument({
        providerId,
        environment,
        companyInfo: config.companyInfo,
        transaction: baseTransaction,
        taxRate: config.taxRate,
        sequenceExpiryDate: new Date(new Date(baseTransaction.date).getFullYear(), 11, 31).toISOString(),
        credentialKey: providerConfig.credentialKey,
        tipoIngreso: providerConfig.tipoIngreso,
        modificationCode: providerConfig.modificationCode,
        unitCodeGoods: providerConfig.unitCodeGoods,
        unitCodeServices: providerConfig.unitCodeServices,
        deliveryMode: providerConfig.deliveryMode,
        apiBaseUrl: providerConfig.apiBaseUrl,
        testUrl: providerConfig.testUrl,
        issueUrl: providerConfig.issueUrl,
        statusUrl: providerConfig.statusUrl,
        establishmentCode,
        branchCode: providerConfig.branchCode || establishmentCode,
        branchName: providerConfig.branchName,
        cashierCode
      });

      const finalStatus = result.pending ? 'PENDING' : result.success ? 'SYNCED' : 'ERROR';
      const finalizedTransaction: Transaction = {
        ...baseTransaction,
        fiscalSyncStatus: finalStatus,
        fiscalSyncError: result.success ? undefined : result.message,
        fiscalReferenceId: result.providerTransactionId || baseTransaction.fiscalReferenceId,
        fiscalResponseMessage: result.message,
        fiscalSyncedAt: result.success && !result.pending ? new Date().toISOString() : baseTransaction.fiscalSyncedAt
      };

      await upsertFiscalTransaction(finalizedTransaction);

      if (result.pending && result.providerTransactionId) {
        window.setTimeout(() => {
          pollFiscalDocumentStatus(
            finalizedTransaction,
            providerId,
            environment,
            result.providerTransactionId!,
            providerConfig.credentialKey,
            providerConfig.deliveryMode
          ).catch(console.error);
        }, 3000);
      }
    } catch (error: any) {
      console.error('Error during syncFiscalDocument:', error);
      const failedTransaction: Transaction = {
        ...transaction,
        fiscalSyncStatus: 'ERROR',
        fiscalSyncError: error?.message || 'No se pudo inicializar la emisión del comprobante.',
        fiscalResponseMessage: error?.message || 'Error en configuración fiscal.'
      };
      await upsertFiscalTransaction(failedTransaction);
    }
  }, [config, pollFiscalDocumentStatus, upsertFiscalTransaction]);

  const retryFiscalDocument = useCallback(async (transaction: Transaction): Promise<string> => {
    const providerId = transaction.fiscalProvider;
    if (!canRetryFiscalTransaction(transaction) || !providerId || providerId === 'NONE') {
      throw new Error('Solo se pueden reintentar documentos electrónicos pendientes o con error.');
    }

    const terminalConfig = config.terminals?.find((terminal) => terminal.id === transaction.terminalId)?.config;
    const fiscalCompliance = getEffectiveFiscalComplianceConfig(config, terminalConfig);
    const environment = getProviderEnvironment(fiscalCompliance, providerId);
    const providerConfig = getFiscalProviderConfig(fiscalCompliance, providerId);
    const shouldPollExistingAttempt = transaction.fiscalSyncStatus === 'PENDING' && Boolean(transaction.fiscalReferenceId);
    const providerLabel = providerId === 'DIGIFACT' ? 'DigiFact' : providerId === 'POLARIS' ? 'Polaris' : 'proveedor fiscal';
    const retryingTransaction: Transaction = {
      ...transaction,
      fiscalSyncStatus: 'PENDING',
      fiscalSyncError: undefined,
      fiscalReferenceId: shouldPollExistingAttempt ? transaction.fiscalReferenceId : undefined,
      fiscalResponseMessage: shouldPollExistingAttempt
        ? `Consultando estado actualizado del e-CF en ${providerLabel}...`
        : `Reintentando envío del e-CF a ${providerLabel}...`
    };

    await upsertFiscalTransaction(retryingTransaction);

    if (shouldPollExistingAttempt && transaction.fiscalReferenceId) {
      await pollFiscalDocumentStatus(
        retryingTransaction,
        providerId,
        environment,
        transaction.fiscalReferenceId,
        providerConfig.credentialKey,
        providerConfig.deliveryMode,
        1
      );
      return 'Consulta de estado fiscal iniciada.';
    }

    await syncFiscalDocument(retryingTransaction);
    return 'Reintento de envío fiscal iniciado.';
  }, [config, pollFiscalDocumentStatus, syncFiscalDocument, upsertFiscalTransaction]);

  const handleTransactionComplete = async (txn: Transaction) => {
    // Cover checkout paths that construct a transaction without transactionService.
    if (txn.customerId) {
      const customer = await db.getDocument('customers', txn.customerId) as Customer | null;
      txn.customerSnapshot = withCustomerNumberSnapshot(txn, customer).customerSnapshot;
    }
    // Get current terminal ID before persisting.
    const currentTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
    const terminalId = currentTerminal?.id || 'T1';
    txn.terminalId = terminalId;
    txn.terminalName = currentTerminal?.config?.terminalName
      || currentTerminal?.config?.erpBinding?.terminalName
      || currentTerminal?.config?.stationNumber
      || terminalId;

    // Add sync status
    txn.syncStatus = 'PENDING';

    // Update inventory locally (simple stock tracking) AND Record Ledger
    const defaultWarehouseId =
      currentTerminal?.config?.inventoryScope?.defaultSalesWarehouseId ||
      config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId ||
      'wh_central';

    const durableEnabled = isSyncFeatureEnabled('sqlite_outbox_v2');
    if (durableEnabled && !durableOutboxRepository.isSupported()) {
      throw new Error('POS-2A está activo, pero el runtime no soporta commit financiero SQLite atómico.');
    }

    const ledgerEntriesForCommit: any[] = [];
    const trackingUpdatesById = new Map<string, any>();
    const allTracking = txn.items.some(item => item.trackingData && item.trackingData.length > 0)
      ? ((await db.get('inventoryTracking')) as any[] || [])
      : [];
    let durableCustomerUpdate: Customer | null = null;
    if (durableEnabled && txn.pendingBalance && txn.pendingBalance > 0 && txn.customerId) {
      const customer = customers.find(candidate => candidate.id === txn.customerId);
      if (customer) {
        durableCustomerUpdate = {
          ...customer,
          currentDebt: parseFloat(((customer.currentDebt || 0) + txn.pendingBalance).toFixed(2)),
          updatedAt: new Date().toISOString(),
        };
      }
    }

    // Calculate and Record Inventory Deductions (Recursive & UOM Aware)
    for (const item of txn.items) {
      // 1. Traceability Status Update (Mark as SOLD)
      if (item.trackingData && item.trackingData.length > 0) {
        allTracking.forEach((t: any) => {
          if (item.trackingData?.some((sel: any) => sel.id === t.id)) {
            trackingUpdatesById.set(t.id, { ...t, status: 'SOLD', saleId: txn.id });
          }
        });
      }

      // 2. Process Deduction (Handles Recipes, Yields, and Simple Items)
      const ledgerEntries = await processInventoryDeduction(
        txn.displayId || txn.id,
        item,
        defaultWarehouseId,
        terminalId,
        products // Pass current products list for recipe lookups
      );
      ledgerEntriesForCommit.push(...ledgerEntries);
    }

    if (durableEnabled) {
      const createdAt = new Date().toISOString();
      const paymentIntentIds = (txn.payments || [])
        .map(payment => String((payment as PaymentEntry).paymentIntentId || '').trim())
        .filter(Boolean);
      const paymentPostedPayload = buildPaymentPostedPayload(txn, { paymentIntentIds });
      await durableOutboxRepository.commitFinancialTransaction({
        documents: [
          { collectionName: 'transactions', document: txn as any },
          {
            collectionName: 'transactionHistory',
            document: { ...txn, syncStatus: txn.syncStatus || 'PENDING' } as any,
          },
          ...ledgerEntriesForCommit.map(entry => ({ collectionName: 'inventoryLedger', document: entry })),
          ...Array.from(trackingUpdatesById.values()).map(document => ({ collectionName: 'inventoryTracking', document })),
          ...(durableCustomerUpdate ? [{ collectionName: 'customers', document: durableCustomerUpdate }] : []),
        ],
        outboxEvent: {
          // ERP-2B validates eventId as UUID. Keep transactionId in aggregateId;
          // eventId is the stable idempotency key for every retry of this row.
          eventId: uuidv4(),
          eventType: 'SALE_POSTED',
          aggregateType: 'TRANSACTION',
          aggregateId: txn.id,
          schemaVersion: 1,
          payload: buildSalePostedPayload(txn, {
            inventoryMovementIds: ledgerEntriesForCommit.map(entry => entry.id),
            paymentIntentIds,
          }),
          createdAt,
        },
        additionalOutboxEvents: paymentPostedPayload ? [{
          eventId: uuidv4(),
          eventType: 'PAYMENT_POSTED',
          aggregateType: 'TRANSACTION',
          aggregateId: txn.id,
          schemaVersion: 1,
          payload: paymentPostedPayload,
          createdAt,
        }] : [],
        paymentIntentIds,
      });
    } else {
      await db.saveDocument('transactions', txn);
      for (const entry of ledgerEntriesForCommit) {
        await db.saveDocument('inventoryLedger', entry);
      }
      if (trackingUpdatesById.size > 0) {
        const updatedTracking = allTracking.map((tracking: any) => trackingUpdatesById.get(tracking.id) || tracking);
        await db.save('inventoryTracking', updatedTracking);
      }
    }

    // Publish UI state only after the durable commit succeeds.
    setTransactions([...transactions, txn]);
    syncFiscalDocument(txn).catch(console.error);
    backgroundSyncManager.triggerSync().catch(console.error);

    const affectedPairs = new Set<string>();
    ledgerEntriesForCommit.forEach(entry => affectedPairs.add(`${entry.productId}|${entry.warehouseId}`));

    // Recalculation reads the complete ledger and can grow with the history.
    // The financial documents and ledger entries are already durable at this
    // point, so refresh stock after releasing the checkout UI.
    window.setTimeout(() => {
      void (async () => {
        for (const pair of affectedPairs) {
          const [pId, wId] = pair.split('|');
          await db.recalculateProductStock(pId, wId);
        }

        const refreshedProducts = await db.get('products') as Product[];
        if (Array.isArray(refreshedProducts) && refreshedProducts.length > 0) {
          setProducts(refreshedProducts);
        } else {
          console.warn("Transaction completion refresh skipped empty products; preserving current POS catalog.");
        }
      })().catch(error => {
        console.error('Post-sale inventory refresh failed:', error);
      });
    }, 50);

    // transactionService.generateTransactionId owns the durable sequence
    // increment. Reconcile React state without incrementing or saving it again.
    const seriesId = txn.seriesId;
    const reservedNextNumber = Number(txn.seriesNumber || 0) + 1;
    if (seriesId && reservedNextNumber > 1) {
      setInternalSequences(current => current.map(sequence =>
        sequence.id === seriesId
          ? { ...sequence, nextNumber: Math.max(Number(sequence.nextNumber || 1), reservedNextNumber) }
          : sequence
      ));
    }

    // --- CRITICAL: Update Customer Debt for Credit Transactions (CxC) ---
    if (txn.pendingBalance && txn.pendingBalance > 0 && txn.customerId) {
      console.log(`💰 Increasing debt for customer ${txn.customerId} by ${txn.pendingBalance}`);
      const customerIndex = customers.findIndex(c => c.id === txn.customerId);
      if (durableEnabled && durableCustomerUpdate) {
        const updatedCustomers = customers.map(customer => customer.id === durableCustomerUpdate!.id ? durableCustomerUpdate! : customer);
        setCustomers(updatedCustomers);
        console.log(`✅ Customer debt committed atomically: ${durableCustomerUpdate.name} -> ${durableCustomerUpdate.currentDebt}`);
      } else if (customerIndex !== -1) {
        const updatedCustomers = [...customers];
        const customer = updatedCustomers[customerIndex];
        const newDebt = (customer.currentDebt || 0) + txn.pendingBalance;

        updatedCustomers[customerIndex] = {
          ...customer,
          currentDebt: parseFloat(newDebt.toFixed(2)),
          updatedAt: new Date().toISOString()
        };

        setCustomers(updatedCustomers);
        await db.saveDocument('customers', updatedCustomers[customerIndex]);
        console.log(`✅ Customer debt updated: ${customer.name} -> ${updatedCustomers[customerIndex].currentDebt}`);
      }
    }
  };

  const handleRegisterMovement = async (type: 'IN' | 'OUT', amount: number, reason: string) => {
    const terminalId = getCurrentTerminal()?.id || 'T1';
    const baseCurrencyCode = (config.currencies || []).find(c => c.isBase)?.code || (config.currencies || [])[0]?.code || 'DOP';
    const normalizedAmount = Number(amount || 0);

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      alert('El monto debe ser mayor que cero.');
      return;
    }

    if (type === 'OUT') {
      const terminalTransactions = getPendingTransactionsForTerminal(terminalId).filter(belongsToCurrentCashier);
      const terminalCashMovements = getPendingCashMovementsForTerminal(terminalId).filter(belongsToCurrentCashier);
      const cashSales = terminalTransactions
        .flatMap(t => t?.payments || [])
        .filter((payment: any) => String(payment?.method || '').toUpperCase() === 'CASH')
        .reduce((sum, payment: any) => sum + Number(payment?.amount || 0), 0);
      const cashIn = terminalCashMovements
        .filter(movement => movement.type === 'IN')
        .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
      const cashOut = terminalCashMovements
        .filter(movement => movement.type === 'OUT')
        .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
      const availableCash = Math.max(0, cashSales + cashIn - cashOut);

      if (normalizedAmount > availableCash + 0.009) {
        alert(`No hay efectivo suficiente en caja para esta salida.\n\nDisponible: ${baseCurrencyCode} ${availableCash.toFixed(2)}\nSolicitado: ${baseCurrencyCode} ${normalizedAmount.toFixed(2)}`);
        return;
      }
    }

    const move: CashMovement = {
      id: `CM-${Date.now()}`,
      type,
      amount: normalizedAmount,
      reason,
      timestamp: new Date().toISOString(),
      userId: currentUser?.id || 'sys',
      userName: currentUser?.name || 'System',
      terminalId,
      source_terminal_id: terminalId,
      currencyCode: baseCurrencyCode,
      syncStatus: 'PENDING' as const
    };
    const updated = [...cashMovements, move];
    writeCriticalCollectionsMirror(parkedTickets, updated);
    setCashMovements(updated);
    await db.saveDocument('cashMovements', move);
    await db.save('cashMovements', updated);

    // Trigger background sync
    backgroundSyncManager.triggerSync().catch(console.error);
    return move;
  };

  const resolveRoomLabel = (room: Pick<Room, 'name' | 'nombre'>): string => {
    const fromName = typeof room.name === 'string' ? room.name.trim() : '';
    const fromNombre = typeof room.nombre === 'string' ? room.nombre.trim() : '';
    return fromName || fromNombre || 'Sala';
  };

  const normalizeRoomForLayout = (room: Room): Room => {
    const label = resolveRoomLabel(room);
    return {
      ...room,
      name: label,
      nombre: label
    };
  };

  const resolveTableLabel = (table: Pick<Table, 'name' | 'nombre' | 'shape'>): string => {
    const fromName = typeof table.name === 'string' ? table.name.trim() : '';
    const fromNombre = typeof table.nombre === 'string' ? table.nombre.trim() : '';
    const fallbackByShape: Record<Table['shape'], string> = {
      SQUARE: 'Mesa',
      CIRCLE: 'Mesa',
      OBSTACLE: 'Muro',
      BAR: 'Barra',
      BOOTH: 'Sofa',
      CHAISE_LONGUE: 'Chaise longue'
    };
    const fallback = fallbackByShape[table.shape] || 'Mesa';
    return fromName || fromNombre || fallback;
  };

  const normalizeTableForLayout = (table: Table): Table => {
    const label = resolveTableLabel(table);
    const isObstacle = table.shape === 'OBSTACLE';
    const defaultWidthByShape: Record<Table['shape'], number> = {
      SQUARE: 100,
      CIRCLE: 100,
      OBSTACLE: 120,
      BAR: 180,
      BOOTH: 160,
      CHAISE_LONGUE: 180
    };
    const defaultHeightByShape: Record<Table['shape'], number> = {
      SQUARE: 100,
      CIRCLE: 100,
      OBSTACLE: 20,
      BAR: 60,
      BOOTH: 90,
      CHAISE_LONGUE: 70
    };
    return {
      ...table,
      nombre: label,
      name: label,
      width: table.width || defaultWidthByShape[table.shape] || 100,
      height: table.height || defaultHeightByShape[table.shape] || 100,
      capacity: isObstacle ? (table.capacity || 0) : Math.max(1, table.capacity || 1),
      consumo_minimo_mesa: isObstacle ? 0 : Math.max(0, Number(table.consumo_minimo_mesa || 0)),
      comensales_minimos: isObstacle ? 0 : Math.max(1, Number(table.comensales_minimos || 1))
    };
  };

  const syncFloorPlanToServer = async (
    roomsPayload: Room[],
    tablesPayload: Table[]
  ): Promise<{ rooms: Room[]; tables: Table[] } | null> => {
    const headers = { 'Content-Type': 'application/json' };
    const normalizedRoomsPayload = roomsPayload.map(normalizeRoomForLayout);
    const normalizedTablesPayload = tablesPayload.map(normalizeTableForLayout);
    const parseJsonOrSkipServerSync = async (res: Response, label: string): Promise<any | null> => {
      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();
      if (!contentType.toLowerCase().includes('application/json')) {
        if (text.trim().startsWith('<')) {
          console.warn(`⚠️ Floor Plan server sync skipped: ${label} returned HTML instead of JSON.`);
          return null;
        }
        throw new Error(`${label} no devolvió JSON válido.`);
      }
      try {
        return text ? JSON.parse(text) : null;
      } catch (error: any) {
        throw new Error(`${label} no devolvió JSON válido: ${error?.message || 'parse error'}`);
      }
    };

    // Android Master replaces the complete layout in one persisted mutation.
    // This avoids partial saves (rooms succeeded but tables failed, or vice versa)
    // and makes an intentionally empty table list authoritative.
    const atomicRes = await fetch(resolveOperationalApiUrl('/api/mesas/layout'), {
      method: 'PUT',
      headers,
      body: JSON.stringify({ rooms: normalizedRoomsPayload, tables: normalizedTablesPayload })
    });
    if (atomicRes.status !== 404) {
      const atomicResult = await parseJsonOrSkipServerSync(atomicRes, 'Layout de mesas');
      if (!atomicRes.ok || atomicResult?.success === false) {
        throw new Error(atomicResult?.message || `Error guardando layout (HTTP ${atomicRes.status})`);
      }
      if (atomicResult) {
        const responseRevision = Number(atomicResult.revision || 0);
        if (Number.isFinite(responseRevision) && responseRevision > masterRestaurantRevisionRef.current) {
          masterRestaurantRevisionRef.current = responseRevision;
        }
        const confirmedRooms = Array.isArray(atomicResult.rooms) ? atomicResult.rooms : normalizedRoomsPayload;
        const confirmedTables = Array.isArray(atomicResult.tables) ? atomicResult.tables : normalizedTablesPayload;
        const confirmedTableIds = new Set(confirmedTables.map((table: Table) => String(table.id)));
        const missingTableIds = normalizedTablesPayload
          .map(table => String(table.id))
          .filter(tableId => !confirmedTableIds.has(tableId));
        if (missingTableIds.length > 0) {
          throw new Error(`La Master devolvió un plano incompleto (${missingTableIds.length} mesas faltantes).`);
        }
        return { rooms: confirmedRooms, tables: confirmedTables };
      }
    }

    // Compatibility fallback for servers that predate the atomic endpoint.
    const snapshotRes = await fetch(resolveOperationalApiUrl('/api/mesas'));
    if (!snapshotRes.ok) {
      throw new Error(`No se pudo leer estado actual de mesas (HTTP ${snapshotRes.status})`);
    }
    const snapshot = await parseJsonOrSkipServerSync(snapshotRes, 'Estado actual de mesas');
    if (!snapshot) return;
    const serverRooms: Room[] = Array.isArray(snapshot?.rooms) ? snapshot.rooms : [];
    const serverTables: Table[] = Array.isArray(snapshot?.tables) ? snapshot.tables : [];

    const nextRoomIds = new Set(normalizedRoomsPayload.map(r => r.id));
    const nextTableIds = new Set(normalizedTablesPayload.map(t => t.id));

    // Upsert rooms first
    for (const roomPayload of normalizedRoomsPayload) {
      const res = await fetch(resolveOperationalApiUrl(`/api/rooms/${encodeURIComponent(roomPayload.id)}`), {
        method: 'PUT',
        headers,
        body: JSON.stringify(roomPayload)
      });
      if (!res.ok) {
        throw new Error(`Error guardando sala ${roomPayload.id} (HTTP ${res.status})`);
      }
    }

    // Upsert tables with normalized designer defaults
    for (const tablePayload of normalizedTablesPayload) {
      const res = await fetch(resolveOperationalApiUrl(`/api/tables/${encodeURIComponent(tablePayload.id)}`), {
        method: 'PUT',
        headers,
        body: JSON.stringify(tablePayload)
      });
      if (!res.ok) {
        throw new Error(`Error guardando mesa ${tablePayload.id} (HTTP ${res.status})`);
      }
    }

    // Delete removed tables, then rooms
    const removedTables = serverTables.filter(t => !nextTableIds.has(t.id));
    for (const table of removedTables) {
      const res = await fetch(resolveOperationalApiUrl(`/api/tables/${encodeURIComponent(table.id)}`), { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`Error eliminando mesa ${table.id} (HTTP ${res.status})`);
      }
    }

    const removedRooms = serverRooms.filter(r => !nextRoomIds.has(r.id));
    for (const room of removedRooms) {
      const res = await fetch(resolveOperationalApiUrl(`/api/rooms/${encodeURIComponent(room.id)}`), { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`Error eliminando sala ${room.id} (HTTP ${res.status})`);
      }
    }
    return null;
  };

  const handleSaveFloorPlan = async (newRooms: Room[], newTables: Table[]): Promise<boolean> => {
    if (isClientTerminalMode()) {
      alert('El layout solo puede modificarse desde la caja Master.');
      return false;
    }
    console.log('💾 Saving Floor Plan:', { rooms: newRooms.length, tables: newTables.length });
    const normalizedRooms = newRooms.map(normalizeRoomForLayout);
    const normalizedTablesInput = newTables.map(normalizeTableForLayout);
    const [existingDbRoomsRaw, existingDbTablesRaw] = await Promise.all([
      db.get('rooms') as Promise<Room[]>,
      db.get('tables') as Promise<Table[]>
    ]);
    const existingDbRooms = Array.isArray(existingDbRoomsRaw) ? existingDbRoomsRaw : [];
    const existingDbTables = Array.isArray(existingDbTablesRaw) ? existingDbTablesRaw : [];

    if (normalizedRooms.length === 0) {
      alert('El layout no se guardó porque debe existir al menos una sala.');
      if (existingDbRooms.length > 0) setRooms(existingDbRooms);
      if (existingDbTables.length > 0) setTables(existingDbTables);
      return false;
    }

    locallySavedFloorPlanRef.current = {
      roomIds: new Set(normalizedRooms.map(room => String(room.id))),
      tableIds: new Set(normalizedTablesInput.map(table => String(table.id)))
    };

    // 1. Save Rooms (Overwrite is fine for config)
    await db.save('rooms', normalizedRooms);
    setRooms(normalizedRooms);

    // 2. Save Tables (Merge operational state AND Delete removed tables)
    // First, fetch all existing tables from DB to identify deletions
    const newTableIds = new Set(normalizedTablesInput.map(t => t.id));

    // Identify tables to delete (present in DB but not in new layout)
    const tablesToDelete = existingDbTables.filter(t => !newTableIds.has(t.id));

    if (tablesToDelete.length > 0) {
      console.log(`🗑️ Pruning ${tablesToDelete.length} removed tables from DB...`);
      for (const t of tablesToDelete) {
        await db.deleteDocument('tables', t.id);
      }
    }

    // Save Tables (Merge operational state)
    const mergedTables = normalizedTablesInput.map(newT => {
      const existing = existingDbTables.find(t => t.id === newT.id) || tables.find(t => t.id === newT.id);
      return {
        ...newT,
        // Operational fields usually not present in newT if it came from Designer state only,
        // but Designer state initialized from 'tables' prop which has them.
        // However, if 'setTables' updates local state in Designer and loses keys, we restore them here.
        status: existing?.status || newT.status || 'FREE',
        currentOrderId: existing?.currentOrderId ?? newT.currentOrderId,
        currentOrderTotal: existing?.currentOrderTotal ?? newT.currentOrderTotal,
        timeSeated: existing?.timeSeated ?? newT.timeSeated,
        waiterName: existing?.waiterName ?? newT.waiterName
      };
    });

    await db.save('tables', mergedTables);
    setTables(mergedTables);
    window.localStorage.removeItem(FLOOR_PLAN_STORAGE_KEY);
    writeFloorPlanMirror(normalizedRooms, mergedTables, {
      layoutSource: 'MASTER_DESIGNER',
      layoutRevision: masterRestaurantRevisionRef.current,
      isDefaultSeed: false,
    });
    try {
      const syncedLayout = await syncFloorPlanToServer(normalizedRooms, mergedTables);
      if (syncedLayout) {
        setRooms(syncedLayout.rooms);
        setTables(syncedLayout.tables);
        locallySavedFloorPlanRef.current = {
          roomIds: new Set(syncedLayout.rooms.map(room => String(room.id))),
          tableIds: new Set(syncedLayout.tables.map(table => String(table.id)))
        };
      }
      console.log('✅ Floor Plan synced to API server.');
    } catch (error: any) {
      console.error('❌ Floor Plan API sync failed:', error);
      console.warn(`Layout guardado localmente; sync remoto de plano omitido: ${error?.message || 'Error desconocido'}`);
      alert(`El plano se conservó en esta caja, pero la Master no confirmó todas las mesas. Reintente Guardar y Volver.\n\n${error?.message || ''}`);
      return false;
    }
    console.log('✅ Floor Plan saved to DB with robustness.');
    // Optional: Sync Trigger
    if (syncManager) {
      // syncManager.broadcastChange('tables', null, 'UPDATE').catch(console.error);
    }
    return true;
  };

  const handleXReport = async (cashCounted: number, notes = 'Arqueo parcial', reportData?: any) => {
    const currentTerminal = getCurrentTerminal() || (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
    const terminalId = currentTerminal?.id || 'T1';

    try {
      const terminalKey = normalizeTerminalId(terminalId);
      const terminalAliases = getTerminalReferenceKeys(terminalId);
      const isDefaultTerminal = terminalAliases.has('t1') || terminalKey === 't1';
      const belongsToCurrentTerminal = (...values: Array<string | null | undefined>) =>
        terminalReferenceMatches(terminalAliases, isDefaultTerminal, ...values);

      const terminalTransactions = getPendingTransactionsForTerminal(terminalId).filter(belongsToCurrentCashier);
      const terminalCashMovements = getPendingCashMovementsForTerminal(terminalId).filter(belongsToCurrentCashier);
      const terminalCollections = collections.filter(c =>
        belongsToCurrentTerminal(c.terminalId) &&
        belongsToCurrentCashier(c) &&
        !c.zReportId
      );

      if (terminalTransactions.length === 0 && terminalCashMovements.length === 0 && terminalCollections.length === 0) {
        throw new Error('Este cajero no tiene movimientos abiertos para generar Cierre X.');
      }

      const paymentMethodSummary = buildZReportPaymentMethodSummary(terminalTransactions, config);
      const totalsByMethod = paymentMethodSummary.reduce((acc: Record<string, number>, line) => {
        acc[line.methodType] = (acc[line.methodType] || 0) + Number(line.amount || 0);
        return acc;
      }, {});

      const baseCurrency = (config.currencies || []).find(c => c.isBase) || (config.currencies || [])[0];
      const baseCurrencyCode = baseCurrency?.code || 'DOP';
      const cashSales = totalsByMethod.CASH || 0;
      const cardTotal = totalsByMethod.CARD || 0;
      const otherTotal = Object.entries(totalsByMethod)
        .filter(([method]) => method !== 'CASH' && method !== 'CARD')
        .reduce((sum, [, amount]) => sum + Number(amount || 0), 0);
      const cashIn = terminalCashMovements
        .filter(m => m.type === 'IN' && (!m.currencyCode || m.currencyCode === baseCurrencyCode))
        .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
      const cashOut = terminalCashMovements
        .filter(m => m.type === 'OUT' && (!m.currencyCode || m.currencyCode === baseCurrencyCode))
        .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
      const expectedCash = cashSales + cashIn - cashOut;
      const discrepancy = Number(cashCounted || 0) - expectedCash;
      const stats = calculateZReportStats(terminalTransactions, terminalCollections);
      const serviceTypeReport = buildServiceTypeReport(terminalTransactions);

      const orderedTicketRefs = terminalTransactions
        .map((transaction) => transaction.displayId || transaction.id)
        .filter(Boolean);
      const openedAtCandidates = [
        ...terminalTransactions.map(t => new Date(t.date).getTime()),
        ...terminalCashMovements.map(m => new Date(m.timestamp).getTime())
      ].filter((value) => Number.isFinite(value)) as number[];
      const openedAt = openedAtCandidates.length > 0
        ? new Date(Math.min(...openedAtCandidates)).toISOString()
        : new Date().toISOString();

      let sequenceNumber = '';
      let xReportSeriesId: string | undefined;
      let xReportSeriesNumber: number | undefined;

      const rawInternalSequences = ((await db.get('internalSequences')) as DocumentSeries[]) || [];
      const terminalSeriesList = currentTerminal?.config?.documentSeries || [];
      const availableSeries = mergeDocumentSeriesCollection([
        ...rawInternalSequences,
        ...terminalSeriesList
      ]);
      const assignedSeriesId = currentTerminal?.config?.documentAssignments?.['X_REPORT'];
      const resolvedSeriesId = resolveDocumentAssignmentId('X_REPORT', availableSeries, assignedSeriesId)
        || resolveDocumentAssignmentId('X_REPORT', availableSeries, 'X_REPORT');
      const xReportSeries = resolvedSeriesId
        ? availableSeries.find(s => s.id === resolvedSeriesId)
        : undefined;

      if (xReportSeries) {
        const prefix = xReportSeries.prefix || 'X';
        const num = Math.max(1, Number(xReportSeries.nextNumber) || 1);
        const padding = xReportSeries.padding || 6;
        sequenceNumber = `${prefix}${num.toString().padStart(padding, '0')}`;
        xReportSeriesId = xReportSeries.id;
        xReportSeriesNumber = num;

        const updatedSeries = {
          ...xReportSeries,
          nextNumber: num + 1
        };
        const updatedSequences = mergeDocumentSeriesCollection([
          ...rawInternalSequences,
          updatedSeries
        ]);
        setInternalSequences(updatedSequences);
        await db.save('internalSequences', updatedSequences);

        const hasTerminalSeries = terminalSeriesList.some(s => s.id === xReportSeries.id);
        const updatedTerminalSeries = hasTerminalSeries
          ? terminalSeriesList.map(s => s.id === xReportSeries.id ? updatedSeries : s)
          : [...terminalSeriesList, updatedSeries];
        const updatedTerminals = (config.terminals || []).map(t => {
          if (t.id !== terminalId) return t;
          return {
            ...t,
            config: {
              ...t.config,
              documentSeries: updatedTerminalSeries,
              documentAssignments: {
                ...(t.config.documentAssignments || {}),
                X_REPORT: xReportSeries.id
              }
            }
          };
        });
        const updatedConfig = { ...config, terminals: updatedTerminals };
        setConfig(updatedConfig);
        await db.save('config', updatedConfig);

        if (permissionService.isMasterTerminal()) {
          try {
            await syncManager.pushCatalog('internalSequences');
          } catch (sequenceSyncError) {
            console.warn('⚠️ [App.tsx] X-Report sequence push failed; local counter is already advanced:', sequenceSyncError);
          }
        }
      } else {
        const existingXReports = await db.get('xReports') as XReport[];
        const nextSeqNum = ((Array.isArray(existingXReports) ? existingXReports.length : 0) + 1).toString().padStart(6, '0');
        sequenceNumber = `X-${nextSeqNum}`;
      }

      const enabledSections = resolveCloseReportSections(config, terminalId, currentUser?.id, 'X');
      // Persist every calculable annex so options enabled after the close are
      // also available on a later reprint. enabledSections still controls output.
      const reportDetails = buildCloseReportDetails(terminalTransactions, config, currentTerminal?.config, ALL_CLOSE_REPORT_SECTIONS);
      const newXReport: XReport = {
        id: `XR-${Date.now()}`,
        reportType: 'X',
        terminalId,
        sequenceNumber,
        seriesId: xReportSeriesId,
        seriesNumber: xReportSeriesNumber,
        source_terminal_id: terminalId,
        openedAt,
        closedAt: new Date().toISOString(),
        closedByUserId: currentUser?.id || 'sys',
        closedByUserName: currentUser?.name || 'System',
        baseCurrency: baseCurrencyCode,
        totalsByMethod,
        paymentMethodSummary,
        cashExpected: { [baseCurrencyCode]: expectedCash },
        cashCounted: { [baseCurrencyCode]: Number(cashCounted || 0) },
        cashDiscrepancy: { [baseCurrencyCode]: discrepancy },
        denominationBreakdown: reportData?.denominationBreakdown,
        denomination_breakdown: reportData?.denominationBreakdown,
        cashSales,
        cashIn,
        cashOut,
        transactionCount: terminalTransactions.length,
        notes,
        declared_totals: {
          cash: Number(cashCounted || 0),
          card: cardTotal,
          other: otherTotal,
          total_declared: Number(cashCounted || 0) + cardTotal + otherTotal,
        },
        system_totals: {
          expected_cash: expectedCash,
          expected_card: cardTotal,
          expected_other: otherTotal,
          total_expected: Object.values(totalsByMethod).reduce<number>((sum, amount) => sum + Number(amount || 0), 0),
          cash_difference: discrepancy,
          total_difference: discrepancy,
        },
        sync_audit: {
          total_tickets_issued: terminalTransactions.length,
          first_ticket_id: orderedTicketRefs[0] || null,
          last_ticket_id: orderedTicketRefs[orderedTicketRefs.length - 1] || null,
        },
        stats,
        serviceTypeSummary: serviceTypeReport.summary,
        closeTaxSummary: buildCloseTaxSummary(terminalTransactions),
        serviceTypeTransactions: serviceTypeReport.transactions,
        enabledSections,
        reportDetails,
        syncStatus: 'PENDING' as const
      };

      await db.saveDocument('xReports', newXReport);
      setXReports(prev => [newXReport, ...prev].sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime()));

      const userRole = roles.find(r => r.id === (currentUser?.roleId || currentUser?.role));
      const hiddenModules = userRole?.zReportConfig?.hiddenModules || [];
      const printed = await ThermalPrinterService.printZReport(newXReport, hiddenModules, config);
      alert(`Cierre X ${sequenceNumber} generado${printed ? ' y enviado a impresión' : ', pero no se pudo imprimir automáticamente'}.`);
    } catch (error: any) {
      console.error('❌ X-Report failed:', error);
      alert(`No se pudo generar el Cierre X: ${error?.message || 'Error desconocido'}`);
    }
  };

  const handlePrintXReport = async (report: XReport) => {
    try {
      const userRole = roles.find(r => r.id === (currentUser?.roleId || currentUser?.role));
      const hiddenModules = userRole?.zReportConfig?.hiddenModules || [];
      const printTerminal = getCurrentTerminal() || (config.terminals || []).find(t => t.id === report.terminalId);
      const enabledSections = resolveCloseReportSections(config, printTerminal?.id || report.terminalId, currentUser?.id, 'X');
      const terminalAliases = getTerminalReferenceKeys(report.terminalId);
      const reportTransactions = getPendingTransactionsForTerminal(report.terminalId)
        .filter(tx => terminalReferenceMatches(terminalAliases, terminalAliases.has('t1'), tx.terminalId, tx.source_terminal_id))
        .filter(belongsToCurrentCashier);
      const printReport: XReport = {
        ...report,
        enabledSections,
        reportDetails: {
          ...buildCloseReportDetails(reportTransactions, config, printTerminal?.config, ALL_CLOSE_REPORT_SECTIONS),
          ...(report.reportDetails || {}),
        },
      };
      const printed = await ThermalPrinterService.printZReport(printReport, hiddenModules, config);
      alert(printed
        ? `Cierre X ${report.sequenceNumber} enviado a impresión.`
        : `No se pudo imprimir el Cierre X ${report.sequenceNumber}. Verifica la impresora configurada.`
      );
    } catch (error: any) {
      console.error('❌ X-Report print failed:', error);
      alert(`No se pudo imprimir el Cierre X: ${error?.message || 'Error desconocido'}`);
    }
  };

  const handleZReport = async (cashCounted: number, notes: string, reportData?: any) => {
    // 1. Robust Terminal ID Discovery.
    // The Z modal already knows the active terminal; prefer it over rediscovering by deviceId
    // because stale bindings can otherwise route Caja 2 closures through T1.
    const requestedTerminalId = typeof reportData?.terminalId === 'string' ? reportData.terminalId.trim() : '';
    const findTerminalById = (id?: string) => {
      const normalized = (id || '').trim();
      if (!normalized) return undefined;
      return (config.terminals || []).find((terminal) =>
        terminal.id === normalized ||
        terminal.config?.erpTerminalId === normalized ||
        terminal.config?.erpBinding?.terminalId === normalized
      );
    };
    const currentTerminal =
      findTerminalById(requestedTerminalId)
      || getCurrentTerminal()
      || (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
    const terminalId = currentTerminal?.id || requestedTerminalId || 'T1';

    // Route the whole recovered jornada before the legacy closure's effects/finally block.
    const recoveryAliases = originalProvenance().terminalIds;
    const hasRecovered = [...transactions, ...cashMovements, ...collections].some(operation =>
      !(operation as any).zReportId && isRecoveredOperation(operation) &&
      (operation.terminalId === terminalId || recoveryAliases.includes(operation.terminalId || ''))
    );
    if (hasRecovered) {
      if (!isSyncFeatureEnabled('pending_operations_recovery') || !currentUser || reportData?.replaceReportId) {
        alert('El cierre de movimientos recuperados no está disponible para esta operación.');
        return;
      }
      setRecoveryCloseScreen({input: {terminalId, user:{id:currentUser.id,name:currentUser.name}, notes, declaration:reportData || {cashCounted}}});
      return;
    }

    let reservedCloseTransactionIds: string[] = [];
    let closeMembershipPersisted = false;

    try {
      console.log(`📊 Z-Report: Starting closure for terminal ${terminalId} (Device: ${deviceId})`);

      // 2. Identify pending operational data since the last Z of this terminal.
      const terminalKey = normalizeTerminalId(terminalId);
      const terminalAliases = getTerminalReferenceKeys(terminalId);
      const isDefaultTerminal = terminalAliases.has('t1') || terminalKey === 't1';
      const belongsToCurrentTerminal = (...values: Array<string | null | undefined>) =>
        terminalReferenceMatches(terminalAliases, isDefaultTerminal, ...values);

      const pendingTransactions = getPendingTransactionsForTerminal(terminalId);
      const pendingCashMovements = getPendingCashMovementsForTerminal(terminalId);

      const reportTransactionIds = Array.isArray(reportData?.transactionIds)
        ? new Set<string>(reportData.transactionIds.map((id: string) => String(id)))
        : null;
      const reportMovementIds = Array.isArray(reportData?.cashMovementIds)
        ? new Set<string>(reportData.cashMovementIds.map((id: string) => String(id)))
        : null;
      const reportCollectionIds = Array.isArray(reportData?.collectionIds)
        ? new Set<string>(reportData.collectionIds.map((id: string) => String(id)))
        : null;

      const replacementReportId = typeof reportData?.replaceReportId === 'string' ? reportData.replaceReportId.trim() : '';
      const replacementArchivedTransactions = replacementReportId
        ? (((await db.get('transactionHistory')) as Transaction[]) || []).filter(tx =>
          tx.zReportId === replacementReportId ||
          (tx as any).zReportSequence === reportData?.replaceSequenceNumber
        )
        : [];
      const transactionSource = replacementArchivedTransactions.length > 0
        ? [
          ...transactions,
          ...replacementArchivedTransactions.filter(archivedTx => !transactions.some(tx => tx.id === archivedTx.id))
        ]
        : transactions;

      const terminalTransactions = reportTransactionIds
        ? transactionSource
          .filter(t => reportTransactionIds.has(t.id))
          .filter(t => belongsToCurrentTerminal(t.terminalId, t.source_terminal_id))
          .filter(t => !t.zReportId || t.zReportId === replacementReportId)
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        : pendingTransactions;

      const terminalCashMovements = reportMovementIds
        ? cashMovements
          .filter(m => reportMovementIds.has(m.id))
          .filter(m => belongsToCurrentTerminal(m.terminalId, (m as any).source_terminal_id))
        : pendingCashMovements;

      const terminalCollections = reportCollectionIds
        ? collections
          .filter(c => reportCollectionIds.has(c.id))
          .filter(c => belongsToCurrentTerminal(c.terminalId, (c as any).source_terminal_id))
        : collections.filter(c => belongsToCurrentTerminal(c.terminalId, (c as any).source_terminal_id) && !c.zReportId);

      // Final fail-safe: the modal may have opened while a delayed sync was
      // re-delivering a transaction. Never silently remove rows from a close
      // that the cashier already reviewed; block it, clean the UI projection,
      // and require a fresh review with the legitimate pending members only.
      if (!replacementReportId) {
        const [persistedHistory, persistedReports] = await Promise.all([
          db.get('transactionHistory') as Promise<Transaction[]>,
          db.get('zReports') as Promise<ZReport[]>,
        ]);
        const closedMembership = collectClosedTransactionIds(
          Array.isArray(persistedHistory) ? persistedHistory : [],
          Array.isArray(persistedReports) ? persistedReports : [],
        );
        const membershipCheck = partitionTransactionsByClosedMembership(
          terminalTransactions,
          closedMembership,
        );
        if (membershipCheck.closed.length > 0) {
          setTransactions(prev => (prev || []).filter(transaction => !closedMembership.has(transaction.id)));
          console.error(`Z_MEMBERSHIP_CLOSE_BLOCKED count=${membershipCheck.closed.length}`);
          alert(
            'El cierre fue actualizado porque contenía ventas que ya pertenecen a un Z anterior. '
            + 'No se generó ningún cierre. Abra Cierre Z nuevamente para revisar solo los movimientos pendientes.'
          );
          return;
        }
      }

      if ([...terminalTransactions, ...terminalCashMovements, ...terminalCollections].some(isRecoveredOperation)) {
        alert('La jornada contiene movimientos recuperados cuya cobertura todavía no ha sido confirmada por ERP. No se puede autorizar un cierre exacto.');
        return;
      }

      if (!replacementReportId) {
        reservedCloseTransactionIds = terminalTransactions.map(transaction => transaction.id);
        reserveClosingTransactionIds(reservedCloseTransactionIds);
      }

      console.log(`🔒 Shift Segregation: Found ${terminalTransactions.length} txns and ${terminalCashMovements.length} cash movements for ${terminalId}`);

      // Build native content before any sequence/persistence effect.
      const nativeZContent = buildNativeZReportContent({
        terminalTransactions, terminalCashMovements, terminalCollections,
        terminalId, config, currentTerminal, currentUser, reportData, notes,
        fallbackOpenedAt: new Date().toISOString(),
      });

      // 4. Create and Save Z-Report
      let sequenceNumber = '';
      let zReportId = replacementReportId || `ZR-${Date.now()}`;

      let zReportSeriesId: string | undefined;
      let zReportSeriesNumber: number | undefined;
      let zSequenceContinuity: ReturnType<typeof resolveZSequenceContinuity> | undefined;

      // DOCUMENT SERIES LOGIC
      // internalSequences is the persistent source of truth. Terminal config keeps a mirror
      // for UI/offline lookup, but must not be the only place where nextNumber advances.
      const rawInternalSequences = ((await db.get('internalSequences')) as DocumentSeries[]) || [];
      const terminalSeriesList = currentTerminal?.config?.documentSeries || [];
      const availableSeries = mergeDocumentSeriesCollection([
        ...rawInternalSequences,
        ...terminalSeriesList
      ]);
      const assignedSeriesId = currentTerminal?.config?.documentAssignments?.['Z_REPORT'];
      const resolvedSeriesId = resolveDocumentAssignmentId('Z_REPORT', availableSeries, assignedSeriesId);
      const zReportSeries = resolvedSeriesId
        ? availableSeries.find(s => s.id === resolvedSeriesId)
        : undefined;

      if (replacementReportId && reportData?.replaceSequenceNumber) {
        sequenceNumber = String(reportData.replaceSequenceNumber);
      } else if (zReportSeries) {
        // Use the Series
        const prefix = zReportSeries.prefix || '';
        const persistedReports = ((await db.get('zReports')) as ZReport[]) || [];
        zSequenceContinuity = resolveZSequenceContinuity({
          series: zReportSeries,
          reports: persistedReports,
          terminalIds: Array.from(terminalAliases),
        });
        requireErpZSequenceAuthority(zReportSeries as DocumentSeries & Record<string, unknown>, zSequenceContinuity);
        const num = zSequenceContinuity.selectedNumber;
        const padding = zReportSeries.padding || 8;
        sequenceNumber = `${prefix}${num.toString().padStart(padding, '0')}`;
        zReportSeriesId = zReportSeries.id;
        zReportSeriesNumber = num;

        console.log(`🎫 Generating Z-Report using Series ${zReportSeries.name}: ${sequenceNumber}`);

        // Increment Series locally in the persistent collection.
        const updatedSeries = {
          ...zReportSeries,
          nextNumber: num + 1
        };

        const updatedSequences = mergeDocumentSeriesCollection([
          ...rawInternalSequences,
          updatedSeries
        ]);
        setInternalSequences(updatedSequences);
        await db.save('internalSequences', updatedSequences);

        // Update the terminal mirror so settings screens show the same next number immediately.
        const hasTerminalSeries = terminalSeriesList.some(s => s.id === zReportSeries.id);
        const updatedTerminalSeries = hasTerminalSeries
          ? terminalSeriesList.map(s => s.id === zReportSeries.id ? updatedSeries : s)
          : [...terminalSeriesList, updatedSeries];
        const updatedTerminals = (config.terminals || []).map(t => {
          if (t.id === terminalId) {
            return {
              ...t,
              config: {
                ...t.config,
                documentSeries: updatedTerminalSeries
              }
            };
          }
          return t;
        });

        const updatedConfig = { ...config, terminals: updatedTerminals };

        // Update local state (optimistic)
        setConfig(updatedConfig);

        // Persist to DB
        await db.save('config', updatedConfig);

        // ERP advances its durable Z authority when it accepts the Z document.
        // A catalog push must never act as a competing counter writer.
        if (permissionService.isMasterTerminal() && String((zReportSeries as any).source || '').toUpperCase() !== 'ERP_TERMINAL_CONFIG') {
          try {
            await syncManager.pushCatalog('internalSequences');
          } catch (sequenceSyncError) {
            console.warn('⚠️ [App.tsx] Z-Report sequence push failed; local counter is already advanced:', sequenceSyncError);
          }
        }

      } else {
        // Fallback to legacy Logic
        const existingReports = await db.get('zReports') as ZReport[];
        const nextSeqNum = (existingReports.length + 1).toString().padStart(6, '0');
        sequenceNumber = `Z-${nextSeqNum}`;
      }

      const newZReport: ZReport & Record<string, any> = {
        ...nativeZContent,
        recoveryMemberIds: {
          transactions: terminalTransactions.map(t => t.id),
          cashMovements: terminalCashMovements.map(m => m.id),
          collections: terminalCollections.map(c => c.id),
        },
        id: zReportId,
        sequenceNumber,
        seriesId: zReportSeriesId,
        seriesNumber: zReportSeriesNumber,
        sequenceContinuity: zSequenceContinuity,
        closedAt: new Date().toISOString(),
        syncStatus: 'PENDING' as const,
        ...(replacementReportId ? {
          repeatedAt: new Date().toISOString(),
          repeatReason: 'USER_REPEAT_Z_REPLACED',
          replacementOf: replacementReportId
        } : {})
      };

      console.log("💾 Saving Z-Report:", newZReport);
      await db.saveDocument('zReports', newZReport);
      closeMembershipPersisted = true;
      setZReports(prev => {
        const withoutReplaced = prev.filter(report => report.id !== newZReport.id);
        return [...withoutReplaced, newZReport].sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
      });

      const sessionConfig = currentTerminal?.config?.workflow?.session;
      const shouldAutoPrintZReport = reportData?.autoPrintZReport === true
        || sessionConfig?.autoPrintZReport === true;
      if (shouldAutoPrintZReport) {
        const userRole = roles.find(r => r.id === (currentUser?.roleId || currentUser?.role));
        const hiddenModules = userRole?.zReportConfig?.hiddenModules || [];
        const preferredPrinterId =
          reportData?.preferredPrinterId ||
          currentTerminal?.config?.hardware?.printerAssignments?.TICKET ||
          currentTerminal?.config?.hardware?.receiptPrinterId;
        console.log(`🖨️ Cierre Z ${newZReport.sequenceNumber}: enviando impresión automática a la impresora de tickets.`);
        try {
          const printed = await ThermalPrinterService.printZReport(newZReport, hiddenModules, config, {
            terminalId,
            preferredPrinterId,
            jobType: 'TICKET',
          });
          if (!printed) {
            console.warn(`⚠️ El cierre Z ${newZReport.sequenceNumber} se guardó, pero la impresión automática no fue confirmada.`);
          }
        } catch (printError) {
          console.error(`❌ No se pudo imprimir automáticamente el Cierre Z ${newZReport.sequenceNumber}:`, printError);
        }
      }

      const shouldEmailZReport = Boolean(sessionConfig?.emailZReport);
      const zReportRecipients = (sessionConfig?.zReportEmails || config.emailConfig?.defaultRecipient || '').trim();
      if (shouldEmailZReport && zReportRecipients) {
        const emailResult = await sendZReportEmailViaErp({
          recipients: zReportRecipients,
          report: newZReport,
          config,
        });
        if (emailResult.success) {
          console.log(`[EMAIL] Cierre Z ${newZReport.sequenceNumber} enviado a: ${zReportRecipients}`);
        } else {
          const message = emailResult.message || 'No se pudo enviar el cierre Z por correo.';
          console.error(`❌ No se pudo enviar el Cierre Z ${newZReport.sequenceNumber} por email: ${message}`);
          window.alert(`El cierre Z se completó, pero no pudo enviarse por correo.\n\n${message}\n\nPuede reenviarlo desde el historial de cierres Z.`);
        }
      }

      if (syncManager.isInitialized) {
        try {
          await syncManager.pushZReport(newZReport);
          newZReport.syncStatus = syncManager.isUsingErpOperationalTarget()
            ? 'APPLIED_ERP'
            : 'COMPLETED';
          newZReport.syncError = undefined;
          await db.saveDocument('zReports', newZReport);
          setZReports(prev => prev.map(report => report.id === newZReport.id ? { ...newZReport } : report));
        } catch (e) {
          newZReport.syncStatus = 'RETRY_WAIT';
          newZReport.syncError = e instanceof Error ? e.message : String(e || 'No se pudo enviar el cierre Z');
          await db.saveDocument('zReports', newZReport);
          setZReports(prev => prev.map(report => report.id === newZReport.id ? { ...newZReport } : report));
          console.warn('⚠️ [App.tsx] Z-Report push failed (queued):', e);
        }
      } else {
        console.warn('⏳ [App.tsx] SyncManager not ready. Z-Report queued locally.');
      }

      // 5. Build lookup set for IDs that were actually closed to prevent data loss
      const closedTxnIds = new Set(terminalTransactions.map(t => t.id));
      const closedMoveIds = new Set(terminalCashMovements.map(m => m.id));

      // 6. Archive locally
      console.log(`🗄️ Archiving ${terminalTransactions.length} transactions to history...`);
      for (const tx of terminalTransactions) {
        // NEW: Save sequence number for easy display
        await db.saveDocument('transactionHistory', {
          ...tx,
          zReportId: newZReport.id,
          zReportSequence: newZReport.sequenceNumber
        });
        // NEW: Explicitly delete from active table to avoid orphans
        await db.deleteDocument('transactions', tx.id);
      }

      // 7. Update states by removing ONLY what was closed
      const remainingTransactions = transactions.filter(t => !closedTxnIds.has(t.id));
      const remainingCashMovements = cashMovements.filter(m => !closedMoveIds.has(m.id));

      setTransactions(remainingTransactions);
      setCashMovements(remainingCashMovements);
      writeCriticalCollectionsMirror(parkedTickets, remainingCashMovements);
      const remainingCollections = collections.filter(c => !terminalCollections.some(tc => tc.id === c.id));
      setCollections(remainingCollections);

      // Note: We don't strictly need db.save('transactions', ...) anymore because we deleted them one by one, 
      // but we keep it for other non-terminal-specific items if they existed (unlikely here).
      // Actually, save() as "Replace" is now robust via NetworkAdapter fix.
      await db.save('transactions', remainingTransactions);
      await db.save('cashMovements', remainingCashMovements);
      await db.save('collections', remainingCollections);

      // 8. Global Reset (bounded wait to avoid UI freeze)
      console.log(`⚙️ Sending Global Reset for Terminal ${terminalId} to Master...`);
      await Promise.race([
        syncManager.resetTerminalData(terminalId),
        new Promise(resolve => setTimeout(resolve, 8000))
      ]);
    } catch (error) {
      if (!closeMembershipPersisted && reservedCloseTransactionIds.length > 0) {
        releaseClosingTransactionIds(reservedCloseTransactionIds);
      }
      console.error('❌ Z-Report closure failed:', error);
      const errorCode = error instanceof Error ? error.message : '';
      if (errorCode === 'Z_SEQUENCE_AUTHORITY_REQUIRED' || errorCode === 'Z_SEQUENCE_AUTHORITY_STALE') {
        alert('No se realizó el cierre Z porque ERP no confirmó la continuidad de la numeración. Las operaciones siguen pendientes y no se consumió ningún número. Sincroniza la terminal y vuelve a intentarlo.');
      } else {
        alert('El cierre terminó con incidencias de sincronización. Se volverá al POS y el reporte quedará en cola para sincronizar.');
      }
    } finally {
      setCurrentView('POS');
      backgroundSyncManager.triggerSync().catch(console.error);
    }
  };

  // --- VIEW RENDERING LOGIC ---
  // The dedicated Presentation surface must render before every main-POS
  // blocker. Its only input is the shared visor state, so terminal licensing,
  // database hydration and security bootstrap belong exclusively to MainActivity.
  if (isCustomerDisplaySurface()) {
    return <CustomerVisor />;
  }

  if (terminalAuthorizationBlock) {
    return (
      <div className="fixed inset-0 z-[200000] flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-md">
        <section
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="terminal-occupied-title"
          className="w-full max-w-xl overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-[0_32px_100px_rgba(15,23,42,0.45)]"
        >
          <div className="border-b border-amber-100 bg-amber-50 px-6 py-6 sm:px-8">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-lg shadow-amber-200">
                <LockKeyhole size={28} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-amber-700">Acceso protegido</p>
                <h1 id="terminal-occupied-title" className="mt-1 text-2xl font-black text-slate-950 sm:text-3xl">
                  Terminal ocupada en otro equipo
                </h1>
              </div>
            </div>
          </div>

          <div className="space-y-5 px-6 py-6 sm:px-8 sm:py-7">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <Monitor size={22} className="shrink-0 text-blue-600" />
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Caja vinculada</p>
                <p className="truncate text-xl font-black text-slate-900">{terminalAuthorizationBlock.terminalLabel}</p>
              </div>
            </div>

            <p className="text-base font-semibold leading-relaxed text-slate-600">
              {terminalAuthorizationBlock.message}
            </p>

            {terminalAuthorizationBlock.requestDeviceId && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Dispositivo solicitante</p>
                <p className="mt-1 break-all font-mono text-sm font-black text-slate-900">
                  {terminalAuthorizationBlock.requestDeviceId}
                </p>
              </div>
            )}

            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4 text-sm font-semibold leading-relaxed text-blue-900">
              Use el equipo que ya tiene esta caja, seleccione otra terminal disponible o reautorice este dispositivo desde Cloud-Admin. Esta pantalla no permitirá entrar al POS mientras la caja continúe ocupada.
            </div>

            <button
              type="button"
              onClick={() => void retryTerminalAuthorization()}
              disabled={terminalAuthorizationCheckState === 'checking'}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-4 text-sm font-black uppercase tracking-[0.12em] text-white shadow-xl transition active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
            >
              <RefreshCw size={18} className={terminalAuthorizationCheckState === 'checking' ? 'animate-spin' : ''} />
              {terminalAuthorizationCheckState === 'checking' ? 'Validando autorización...' : 'Comprobar autorización de Cloud Admin'}
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (licenseError) {
    return (
      <div className="h-screen w-screen bg-red-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-white p-10 rounded-3xl shadow-2xl border border-red-100 max-w-lg z-50">
          <div className="w-24 h-24 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-3xl font-black text-slate-800 mb-4 tracking-tight">Acceso Bloqueado</h1>
          <p className="text-lg text-slate-600 font-medium mb-8 leading-relaxed">
            {licenseError}
          </p>
          <div className="p-4 bg-slate-50 rounded-xl text-sm font-mono text-slate-500 font-bold border border-slate-200">
            Terminal Token: {deviceId}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-8 w-full py-4 bg-slate-900 hover:bg-black text-white rounded-xl font-bold transition-transform active:scale-95"
          >
            Reintentar Conexión
          </button>
        </div>
      </div>
    );
  }

  if (!isDataLoaded || restoringHistory) {
    if (initialConnError && !restoringHistory) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-900 text-white p-8 text-center">
          <div className="bg-red-500/20 p-4 rounded-full mb-4">
            <Layout size={48} className="text-red-500" />
          </div>
          <h2 className="text-xl font-bold mb-2">Error de Inicialización</h2>
          <p className="text-slate-400 mb-6 max-w-md">{initialConnError}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg font-medium transition-colors"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-900 text-white">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-bold tracking-widest uppercase text-xs">
          {restoringHistory ? 'Restaurando Historial desde Maestra...' : 'Cargando CLIC POS OS...'}
        </p>
      </div>
    );
  }

  const handleProcessRefund = async (
    originalTx: Transaction,
    itemsToRefund: CartItem[],
    conditions: Map<string, 'SELLABLE' | 'DAMAGED'>,
    reason: string,
    options: RefundProcessingOptions = {}
  ): Promise<Transaction | null> => {
    console.log("🔄 Procesando Devolución Integral:", { originalTx, items: itemsToRefund.length, reason });

    const normalizedRefundItems = (itemsToRefund || [])
      .map(item => ({
        ...item,
        quantity: Math.abs(Number(item.quantity || 0))
      }))
      .filter(item => item.quantity > 0);

    if (normalizedRefundItems.length === 0) {
      alert('No hay artículos válidos para procesar la devolución.');
      return null;
    }

    const persistedTransactionsForValidation = await db.get('transactions') as Transaction[];
    const refundAvailability = originalTx.erpRefundSource
      ? validateErpRefundItems(originalTx, normalizedRefundItems)
      : validateRefundItems(
        originalTx,
        normalizedRefundItems,
        Array.isArray(persistedTransactionsForValidation)
          ? [...transactions, ...persistedTransactionsForValidation]
          : transactions
      );
    if ('message' in refundAvailability) {
      alert(refundAvailability.message);
      return null;
    }

    // 1. Calculations
    const refundSummary = calculateTransactionTaxSummary(
      itemsToRefund,
      config.taxes || [],
      Boolean(originalTx.isTaxIncluded),
      config.taxRate || 0
    );
    const refundTotal = refundSummary.total;

    // Check if full refund
    const totalOriginalQty = Array.from(refundAvailability.remaining.values()).reduce((acc, quantity) => acc + quantity, 0);
    const totalRefundedQty = normalizedRefundItems.reduce((acc, i) => acc + Math.abs(Number(i.quantity || 0)), 0);
    const isFullRefund = totalRefundedQty >= totalOriginalQty;
    const newStatus = isFullRefund ? 'REFUNDED' : 'PARTIAL_REFUND';

    const normalizeText = (value?: string | null) => (value || '').trim().toLowerCase();
    const matchedCustomer = originalTx.customerId
      ? customers.find(c => c.id === originalTx.customerId)
      : customers.find(c =>
        normalizeText(c.name) !== '' &&
        normalizeText(c.name) === normalizeText(originalTx.customerName)
      );
    const resolvedCustomerId = originalTx.customerId || matchedCustomer?.id;
    const resolvedCustomerName = originalTx.customerName || matchedCustomer?.name;

    // 2. Resolución fiscal para la nota de crédito
    const currentTerminal = getCurrentTerminal();
    const currentTerminalId = currentTerminal?.id || config.terminals?.[0]?.id || 't1';
    const fiscalCompliance = getEffectiveFiscalComplianceConfig(config, currentTerminal?.config);
    const preparedAuthority = options.erpRefundAuthority;
    const preparedFiscalAuthority = preparedAuthority?.fiscalAuthority || null;
    const creditNoteFiscalMode = originalTx.erpRefundSource
      ? (preparedFiscalAuthority ? 'LEGACY_B' : 'NONE')
      : fiscalCompliance.mode;
    const creditNoteFiscalType = preparedFiscalAuthority?.ncfType || resolveCreditNoteFiscalCode(creditNoteFiscalMode);
    let creditNoteNcf: string | undefined;
    if (preparedFiscalAuthority) {
      creditNoteNcf = preparedFiscalAuthority.ncf;
      await db.reconcilePreparedNCF(preparedFiscalAuthority.ncfType, currentTerminalId, preparedFiscalAuthority.ncf);
    } else if (!originalTx.erpRefundSource && creditNoteFiscalMode !== 'NONE') {
      try {
        creditNoteNcf = await db.getNextNCF(creditNoteFiscalType, currentTerminalId) || undefined;
      } catch (e) {
        console.warn(`No se pudo generar NCF ${creditNoteFiscalType}:`, e);
      }
    }

    // 3. Document Sequence (Internal Refund Series)
    const sequences = await db.get('internalSequences') as DocumentSeries[];
    const assignedRefundSeriesId = currentTerminal?.config?.documentAssignments?.['REFUND'];
    const resolvedRefundSeriesId = resolveDocumentAssignmentId('REFUND', sequences, assignedRefundSeriesId)
      || resolveDocumentAssignmentId('REFUND', sequences, 'REFUND');
    const refundSeries = resolvedRefundSeriesId
      ? sequences.find(s => s.id === resolvedRefundSeriesId)
      : undefined;
    let displayId = `NC-${Date.now().toString().slice(-6)}`;
    let refundSeriesId: string | undefined;
    let refundSeriesNumber: number | undefined;
    if (preparedAuthority) {
      refundSeriesId = preparedAuthority.documentAuthority.seriesId;
      refundSeriesNumber = preparedAuthority.documentAuthority.seriesNumber;
      displayId = preparedAuthority.documentAuthority.displayId;
      const updatedSequences = sequences.map(s => s.id === refundSeriesId
        ? { ...s, nextNumber: Math.max(Number(s.nextNumber) || 1, refundSeriesNumber! + 1) }
        : s);
      if (updatedSequences.some((series, index) => series.nextNumber !== sequences[index]?.nextNumber)) {
        await db.save('internalSequences', updatedSequences);
        setInternalSequences(updatedSequences);
      }
    } else if (refundSeries) {
      refundSeriesId = refundSeries.id;
      refundSeriesNumber = refundSeries.nextNumber;
      displayId = `${refundSeries.prefix}${refundSeriesNumber.toString().padStart(refundSeries.padding, '0')}`;
      const updatedSequences = sequences.map(s => s.id === refundSeries.id ? { ...s, nextNumber: s.nextNumber + 1 } : s);
      await db.save('internalSequences', updatedSequences);
      setInternalSequences(updatedSequences);
    }

    const refundPayments: PaymentEntry[] = options.refundPayments && options.refundPayments.length > 0
      ? options.refundPayments
      : [{
        id: `refund-${Date.now()}`,
        method: 'STORE_CREDIT',
        methodLabel: 'Nota de crédito',
        amount: refundTotal,
        timestamp: new Date(),
      }];

    // 4. Create Credit Note Record
    const creditNote: Transaction = {
      id: createRuntimeId('NC'),
      displayId: displayId,
      documentType: 'REFUND',
      seriesId: refundSeriesId,
      seriesNumber: refundSeriesNumber,
      date: new Date().toISOString(),
      items: normalizedRefundItems,
      total: refundTotal,
      payments: refundPayments,
      userId: currentUser?.id || 'sys',
      userName: currentUser?.name || 'System',
      terminalId: currentTerminalId,
      status: 'REFUNDED',
      customerId: resolvedCustomerId,
      customerName: resolvedCustomerName,
      ncf: creditNoteNcf || undefined,
      ncfType: creditNoteNcf ? creditNoteFiscalType : undefined,
      legacyNcf: creditNoteNcf && !creditNoteFiscalType.startsWith('E') ? creditNoteNcf : undefined,
      electronicNcf: creditNoteNcf && creditNoteFiscalType.startsWith('E') ? creditNoteNcf : undefined,
      fiscalMode: creditNoteFiscalMode,
      fiscalProvider: creditNoteFiscalType.startsWith('E') ? getDefaultFiscalProvider(config, currentTerminal?.config) : 'NONE',
      taxAmount: refundSummary.taxAmount,
      netAmount: refundSummary.netAmount,
      affectedNCF: originalTx.ncf,
      affectedInvoiceNumber: originalTx.displayId || originalTx.id,
      affectedInvoiceDate: originalTx.date,
      originalTransactionId: originalTx.id,
      original_transaction_id: originalTx.source_transaction_id || originalTx.id,
      original_display_id: originalTx.displayId || originalTx.id,
      erpRefundSource: originalTx.erpRefundSource,
      erpRefundPreparation: options.erpRefundPreparation,
      refundReason: reason,
      isTaxIncluded: originalTx.isTaxIncluded,
      syncStatus: 'PENDING'
    };

    // 5. Persist refund, history mirror and Kardex through the standalone helper
    const defaultWarehouseId =
      currentTerminal?.config?.inventoryScope?.defaultSalesWarehouseId ||
      (config.terminals || []).find(t => t.id === currentTerminalId)?.config?.inventoryScope?.defaultSalesWarehouseId ||
      config.terminals?.[0]?.config.inventoryScope?.defaultSalesWarehouseId ||
      'wh_central';

    const refundPersistenceResult = await persistStandaloneRefundTransaction(
      creditNote,
      {
        warehouseId: defaultWarehouseId,
        terminalId: currentTerminalId,
        originalTransaction: {
          ...originalTx,
          customerId: resolvedCustomerId,
          customerName: resolvedCustomerName,
          status: newStatus as any
        },
        persistOriginal: !originalTx.erpRefundSource,
        conditions
      }
    );

    // 6. Financial Update (Customer Account & Wallet)
    if (resolvedCustomerId) {
      const customer = customers.find(c => c.id === resolvedCustomerId);
      if (customer) {
        let remainingRefund = refundTotal;
        let newDebt = customer.currentDebt || 0;

        // Step A: Reduce Debt if original invoice had pending balance
        if (originalTx.pendingBalance && originalTx.pendingBalance > 0 && newDebt > 0) {
          const debtToReduce = Math.min(newDebt, remainingRefund);
          newDebt -= debtToReduce;
          remainingRefund -= debtToReduce;
        }

        // Step B: If there is still a refund amount (Scenario B - pure credit or surplus), add to Wallet
        if (!options.skipWalletDeposit && remainingRefund > 0.01) {
          try {
            await transactionService.applyRefundToWallet(
              resolvedCustomerId,
              remainingRefund,
              displayId
            );

            // Re-fetch wallets to get the updated balance for the customer nested object
            const wallets = await (await import('./utils/db')).db.get('wallets' as any) as any[] || [];
            const updatedWallet = wallets.find(w => w.customerId === resolvedCustomerId);
            if (updatedWallet) {
              customer.wallet = updatedWallet;
            }
          } catch (walletRefundError) {
            console.error('⚠️ Refund wallet update failed after persistence:', walletRefundError);
          }
        }

        const updatedCustomer = { ...customer, currentDebt: newDebt };
        await db.saveDocument('customers', updatedCustomer);
        setCustomers(prev => prev.map(c => c.id === updatedCustomer.id ? updatedCustomer : c));
      }
    }

    // 7. Refresh local state from storage so APK runtime never stays stale in-memory.
    try {
      const [persistedTransactions, freshProducts] = await Promise.all([
        db.get('transactions') as Promise<Transaction[]>,
        db.get('products') as Promise<Product[]>
      ]);

      if (Array.isArray(persistedTransactions)) {
        setTransactions(
          [...persistedTransactions].sort((a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
          )
        );
      } else {
        const updatedOriginalTx = refundPersistenceResult.updatedOriginal || (originalTx.erpRefundSource ? null : {
          ...originalTx,
          customerId: resolvedCustomerId,
          customerName: resolvedCustomerName,
          status: newStatus as any,
          relatedTransactions: [...(originalTx.relatedTransactions || []), creditNote.id],
          updatedAt: new Date().toISOString(),
          syncStatus: 'PENDING' as const
        });
        const persistedCreditNote = refundPersistenceResult.refund || creditNote;
        setTransactions(prev => {
          const filtered = prev.filter(t => t.id !== updatedOriginalTx?.id && t.id !== persistedCreditNote.id);
          return [...(updatedOriginalTx ? [updatedOriginalTx] : []), ...filtered, persistedCreditNote].sort((a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
          );
        });
      }

      if (Array.isArray(freshProducts) && freshProducts.length > 0) {
        setProducts(freshProducts);
      } else {
        console.warn('Refund state refresh skipped empty products; preserving current POS catalog.');
      }
    } catch (refreshError) {
      console.warn('⚠️ Refund state refresh fallback:', refreshError);
    }

    const finalizedCreditNote = refundPersistenceResult.refund || creditNote;
    syncFiscalDocument(finalizedCreditNote).catch(console.error);

    let autoPrintNotice = '';
    if (options.autoPrintIntegratedArtifacts) {
      try {
        const printResult = await printIntegratedPaymentArtifacts(finalizedCreditNote, config);
        if (printResult.voucherCopiesFailed.length > 0) {
          autoPrintNotice = `\nImpresión automática pendiente: ${printResult.voucherCopiesFailed.join(', ')}.`;
        }
      } catch (printError) {
        console.error('❌ Refund integrated auto print failed:', printError);
        autoPrintNotice = '\nOcurrió un problema al imprimir automáticamente el voucher y el ticket.';
      }
    }

    // Sync
    backgroundSyncManager.triggerSync().catch(console.error);

    alert(`Devolución procesada correctamente.\nDocumento: ${displayId}\n${creditNoteNcf ? 'NCF: ' + creditNoteNcf : ''}${autoPrintNotice}`);
    return finalizedCreditNote;
  };

  const renderView = () => {
    switch (currentView) {
      case 'ACTIVATION':
        return (
          <ActivationScreen
            onActivationComplete={(tenantData) => {
              void (async () => {
                console.log('✅ Sistema activado para:', tenantData?.name || tenantData?.email || 'tenant');

                const activatedTenantId = String(tenantData?.tenantId || '').trim();
                const activatedErpBaseUrl = resolveSetupErpBaseUrl();
                const resolvedDeviceId = deviceId || localStorage.getItem('pos_device_id') || '';
                const storedSetupMode = getStoredTerminalSetupMode();
                const setupWizardCompleted = localStorage.getItem(SETUP_WIZARD_COMPLETED_KEY) === '1';
                const localTerminals = (!Array.isArray(config) && config?.terminals) ? config.terminals : [];
                const localPairedTerminal = (localTerminals || []).find(
                  (t: any) => t.config?.currentDeviceId === resolvedDeviceId
                );
                const hasKnownTerminalContext = Boolean(
                  storedSetupMode ||
                  setupWizardCompleted ||
                  localPairedTerminal
                );

                // A full Android storage reset removes the ERP URL together with SQLite and WebView data.
                // Restore the tenant and canonical ERP endpoint before the first license request so activation
                // can reach the authoritative service and continue into terminal reauthorization.
                if (activatedTenantId) {
                  localStorage.setItem('active_tenant_id', activatedTenantId);
                }

                if (activatedErpBaseUrl) {
                  persistSetupErpBaseUrls(activatedErpBaseUrl);
                }

                // A fresh activation has no connection mode or terminal context yet. Do not run a
                // device-scoped ERP license request until the operator chooses LOCAL, MASTER + ERP
                // or CLIENT; otherwise a missing/unreachable ERP blocks the mode selector itself.
                if (hasKnownTerminalContext && activatedTenantId) {
                  try {
                    const license = await checkLicenseStatus(activatedTenantId, resolvedDeviceId);
                    if (!license.isValid) {
                      if (license.cloudReachable === false) {
                        console.warn('[ACTIVATION] License validation unavailable; keeping activation recoverable.', {
                          tenantId: activatedTenantId,
                          lastCloudError: license.lastCloudError || null,
                        });
                        alert(license.reason || 'No se pudo validar la licencia. Verifique la conexión y reintente.');
                        return;
                      }
                      triggerLockdown(license.reason || 'Servicio Suspendido.');
                      return;
                    }
                  } catch (error) {
                    console.warn('[ACTIVATION] License check failed after activation, keeping offline-safe tolerance:', error);
                  }
                }

                if (hasKnownTerminalContext) {
                  console.log('[ACTIVATION] Se detectó una configuración previa. Reanudando flujo operativo...');
                  window.location.reload();
                  return;
                }

                localStorage.removeItem(SETUP_WIZARD_COMPLETED_KEY);
                localStorage.removeItem(SETUP_FLOW_STAGE_KEY);
                localStorage.removeItem(SETUP_FLOW_VERSION_KEY);
                localStorage.removeItem(TERMINAL_SETUP_MODE_KEY);
                localStorage.setItem(TERMINAL_SETUP_PENDING_KEY, '1');
                clearStoredErpSyncBinding();
                setCurrentView('TERMINAL_MODE_SELECTOR');
              })();
            }}
          />
        );

      case 'TERMINAL_MODE_SELECTOR':
        return (
          <TerminalModeSelector
            onSelect={handleTerminalModeSelection}
          />
        );

      case 'VERTICAL_SELECTOR':
        return (
          <VerticalSelector
            onSelect={(selectedConfig) => {
              void handleVerticalSelection(selectedConfig);
            }}
          />
        );

      case 'SETUP':
      case 'WIZARD':
        return (
          <SetupWizard
            initialConfig={config}
            onComplete={handleSetupWizardComplete}
            onCancel={() => {
              localStorage.removeItem(SETUP_FLOW_STAGE_KEY);
              localStorage.removeItem(SETUP_FLOW_VERSION_KEY);
              localStorage.removeItem(TERMINAL_SETUP_MODE_KEY);
              localStorage.setItem(TERMINAL_SETUP_PENDING_KEY, '1');
              setCurrentView('TERMINAL_MODE_SELECTOR');
            }}
          />
        );

      case 'TERMINAL_PAIRING':
      case 'DEVICE_UNAUTHORIZED':
        if (!getStoredTerminalSetupMode()) {
          return <TerminalModeSelector onSelect={handleTerminalModeSelection} />;
        }
        return (
          <TerminalBindingScreen
            config={config}
            deviceId={deviceId}
            adminUsers={users}
            tenantId={resolveSetupTenantId()}
            erpBaseUrl={resolveSetupErpBaseUrl() || undefined}
            initialBindingMode={getTerminalBindingMode(getStoredTerminalSetupMode())}
            initialExpectedTerminalType={getExpectedSetupTerminalType(getStoredTerminalSetupMode())}
            integrationMode={getTerminalSetupIntegrationMode(getStoredTerminalSetupMode())}
            onPair={handlePairTerminal}
            onConfigUpdate={handleConfigUpdate}
            onUsersUpdate={async (newUsers) => {
              setUsers(newUsers);
              await db.save('users', newUsers);
            }}
            onBackToModeSelection={() => {
              localStorage.removeItem(TERMINAL_SETUP_MODE_KEY);
              localStorage.removeItem(SETUP_FLOW_STAGE_KEY);
              localStorage.removeItem(SETUP_FLOW_VERSION_KEY);
              setCurrentView('TERMINAL_MODE_SELECTOR');
            }}
            initialMasterIp={localStorage.getItem('pos_master_ip') || ''}
          />
        );

      case 'LOGIN':
        if (!getCurrentTerminal()) {
          const storedInitialConfig = localStorage.getItem('initial_terminal_config');
          const activeTerminalId =
            localStorage.getItem('active_terminal_id')
            || localStorage.getItem('CLIC_POS_TERMINAL_ID')
            || '';

          if (storedInitialConfig && activeTerminalId) {
            try {
              const parsedConfig = JSON.parse(storedInitialConfig) as BusinessConfig;
              const hydratedTerminal = (parsedConfig.terminals || []).find((terminal) =>
                terminal.id === activeTerminalId
                || terminal.config?.currentDeviceId === deviceId
                || terminal.config?.erpTerminalId === activeTerminalId
              );

              if (hydratedTerminal) {
                setConfig(parsedConfig);
                return null;
              }
            } catch (error) {
              console.warn('⚠️ No se pudo rehidratar la terminal desde initial_terminal_config:', error);
            }
          }

          // If we are in LOGIN state but have no terminal config, 
          // we must have failed to load key data. 
          // Redirect to Pairing to attempt recovery/re-pair.
          console.warn('[ACTIVATION_REDIRECT_REASON]', 'LOGIN_WITHOUT_CURRENT_TERMINAL', {
            currentView,
            deviceId,
            activeTerminalId,
            hasInitialTerminalConfig: Boolean(storedInitialConfig),
            lastSyncDiagnostic: localStorage.getItem(SYNC_DIAGNOSTIC_STORAGE_KEY) || null,
          });
          setCurrentView(getStoredTerminalSetupMode() ? 'TERMINAL_PAIRING' : 'TERMINAL_MODE_SELECTOR');
          return null;
        }
        const loginProps = {
          config: getCurrentTerminal()!.config as any,
          availableUsers: users,
          subVertical: config.subVertical,
          onLogin: async (u: User) => {
            const trace = beginPosInteraction('OPEN_SALE_SCREEN', { userId: u.id });
            expectInteractionRender(trace, 'APP_VIEW');
            markInteractionStateUpdate(trace, 2);
            setCurrentUser(u);
            const role = getCurrentDeviceRole();
            const terminal = getCurrentTerminal();

            if (role === DeviceRole.HANDHELD_INVENTORY) setCurrentView('INVENTORY_HOME');
            else if (role === DeviceRole.KITCHEN_DISPLAY) setCurrentView('KITCHEN_ORDERS');
            else if (role === DeviceRole.SELF_CHECKOUT) setCurrentView('KIOSK_WELCOME');
            else if (role === DeviceRole.PRICE_CHECKER) setCurrentView('CHECKER_SCAN');
            else {
              // Multi-Vertical Startup Flow
              const salesStartView = resolvePosSalesStartView(config, terminal?.config);
              setCurrentView(salesStartView);
              if (salesStartView === 'TABLE_MAP') {
                // Mostrar el mapa con el snapshot local ya hidratado. La red no
                // participa en el camino crítico del PIN; solo reconcilia después.
                window.setTimeout(() => {
                  void measureInteractionStage(trace, 'SYNC_START', 'SYNC_END', fetchTables).catch((error) => {
                    console.warn('Failed to reconcile tables after restaurant login:', error);
                  });
                }, 250);
              }
            }
            markInteractionStage(trace, 'HANDLER_END');
          }
        };

        return isLandscape ? (
          <ModernLoginScreen {...loginProps} />
        ) : (
          <LoginScreen {...loginProps} />
        );



      case 'TABLE_MAP': {
        const activeRoleId = currentUser?.roleId || currentUser?.role;
        const activeRole = roles.find(role => role.id === activeRoleId);
        const canViewBusinessMetrics = Boolean(
          activeRole &&
          (
            activeRole.permissions.includes('ALL') ||
            activeRole.permissions.includes('REPORTS_VIEW_FINANCIAL') ||
            /admin|gerente|super/i.test(activeRole.name)
          )
        );
        return (
          <div className="h-screen bg-slate-950 overflow-hidden relative">
            <button
              type="button"
              onClick={() => {
                if (tableMapExitPending) return;
                // Paint acknowledgement before mounting the heavier sales
                // catalog. The transition lets React yield to input on slower
                // restaurant terminals instead of presenting a frozen map.
                setTableMapExitPending(true);
                window.requestAnimationFrame(() => handleViewChange('POS'));
              }}
              disabled={tableMapExitPending}
              aria-busy={tableMapExitPending}
              className="absolute left-4 top-4 z-50 rounded-2xl border border-white/15 bg-slate-950/60 px-4 py-2.5 text-sm font-black text-slate-100 shadow-[0_16px_40px_rgba(2,6,23,0.55)] backdrop-blur-xl hover:bg-white/[0.14] active:scale-[0.98]"
            >
              {tableMapExitPending ? 'Abriendo venta…' : 'Cerrar'}
            </button>
            <div className="h-full overflow-hidden relative">
              <TableMap
                rooms={rooms}
                currentRoomId={activeRoomId}
                onChangeRoom={setActiveRoomId}
                tables={tables}
                parkedTickets={parkedTickets}
                onBeforeTableOpen={acquireTableEditLock}
                onTableOpenCancelled={async () => {
                  const released = await releaseActiveTableEditLock();
                  if (!released) {
                    alert('No se pudo liberar la mesa en la Caja Master. Reintente antes de abrirla nuevamente.');
                  }
                }}
                onTableClick={(table) => {
                  console.log('Mesa seleccionada:', table.name);
                  const pendingClientSync = isClientTerminalMode()
                    ? pendingClientTableSyncRef.current
                    : null;
                  const initialParkedTickets =
                    pendingClientSync?.tableId === String(table.id)
                      ? pendingClientSync.parkedTickets
                      : (parkedTickets || []);

                  // Cargar ítems solo de ESTA mesa: órdenes abiertas viven en parkedTickets (no heredar carrito previo).
                  let nextCart: CartItem[] = [];
                  let nextSelectedCustomer: Customer | null = null;
                  let selectedTable = table;
                  const isBarTableContext = table.shape === 'BAR';
                  const resolveParkedCustomer = (ticket?: ParkedTicket | null): Customer | null => {
                    if (!ticket) return null;
                    if (ticket.customerId) {
                      const customerById = customers.find(customer => String(customer.id) === String(ticket.customerId));
                      if (customerById) return customerById;
                    }
                    const snapshot = ticket.customerSnapshot;
                    if (snapshot?.name || ticket.customerName) {
                      return {
                        id: ticket.customerId || `parked-customer-${ticket.id}`,
                        name: snapshot?.name || ticket.customerName || 'Cliente',
                        taxId: snapshot?.taxId,
                        address: snapshot?.address,
                        phone: snapshot?.phone,
                        email: snapshot?.email,
                        isTemporary: true
                      } as Customer;
                    }
                    return null;
                  };
                  if (table.currentOrderId) {
                    let activeParkedTickets = initialParkedTickets;
                    let parked = activeParkedTickets.find(p => p.id === table.currentOrderId)
                      || (!isBarTableContext ? activeParkedTickets.find(p => String(p.tableId) === String(table.id)) : undefined);
                    const fromTx = (transactions || []).find(t => t.id === table.currentOrderId);
                    if (parked?.items?.length) {
                      const joinedSourceName = String((selectedTable as any).joinedSourceTableName || '').trim();
                      selectedTable = {
                        ...table,
                        ...(joinedSourceName ? { name: joinedSourceName, nombre: joinedSourceName } : {}),
                        status: 'OCCUPIED',
                        currentOrderId: parked.id,
                        currentOrderTotal: typeof parked.total === 'number'
                          ? parked.total
                          : parked.items.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0)
                      };
                      nextCart = markRestaurantLinesCommitted(parked.items, parked.timestamp);
                      nextSelectedCustomer = resolveParkedCustomer(parked);
                    } else if (fromTx?.items?.length) {
                      nextCart = markRestaurantLinesCommitted(fromTx.items);
                      if (fromTx.customerId) {
                        nextSelectedCustomer = customers.find(customer => String(customer.id) === String(fromTx.customerId)) || null;
                      }
                    }
                  } else if (table.id) {
                    let activeParkedTickets = initialParkedTickets;
                    let parked = !isBarTableContext
                      ? activeParkedTickets.find(p => String(p.tableId) === String(table.id))
                      : undefined;
                    if (parked?.items?.length) {
                      const joinedSourceName = String((selectedTable as any).joinedSourceTableName || '').trim();
                      selectedTable = {
                        ...table,
                        ...(joinedSourceName ? { name: joinedSourceName, nombre: joinedSourceName } : {}),
                        status: 'OCCUPIED',
                        currentOrderId: parked.id,
                        currentOrderTotal: typeof parked.total === 'number'
                          ? parked.total
                          : parked.items.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0)
                      };
                      nextCart = markRestaurantLinesCommitted(parked.items, parked.timestamp);
                      nextSelectedCustomer = resolveParkedCustomer(parked);
                    }
                  }

                  const openTrace = getLatestPosInteraction('OPEN_TABLE');
                  markInteractionStateUpdate(openTrace, nextCart.length + 3);
                  setCart(nextCart);
                  setSelectedCustomer(nextSelectedCustomer);
                  setActiveTable(selectedTable);
                  setCurrentView('POS');
                }}
                onRefreshTables={fetchTables}
                onUpdateTables={async (nextTables) => {
                  setTables(nextTables);
                  if (canUseLocalOperationalTableStore()) {
                    await db.save('tables', nextTables);
                  }
                }}
                onUpdateParkedTickets={handleUpdateParkedTickets}
                currencySymbol={config.currencySymbol}
                currentUser={currentUser!}
                localTableLockOwnerId={String(deviceId || getCurrentTerminal()?.config?.currentDeviceId || '')}
                isAdmin={currentUser?.role === 'ADMIN'}
                roles={roles}
                bloqueoMeseros={getCurrentTerminal()?.config?.operational?.bloqueo_meseros}
                isRestaurantMode={isRestaurantTerminal(getCurrentTerminal())}
                onOpenTable={openTableForService}
                canViewBusinessMetrics={canViewBusinessMetrics}
                onPrintPrecheck={async (table) => {
                  if (!table.currentOrderId) return;
                  let temporaryLockAcquired = false;
                  if (isClientTerminalMode() && activeTableEditLockRef.current?.tableId !== String(table.id)) {
                    temporaryLockAcquired = await acquireTableEditLock(table);
                    if (!temporaryLockAcquired) return;
                  }
                  try {
                    const order = (parkedTickets || []).find(p => p.id === table.currentOrderId);
                    if (!order) {
                      alert('No se encontró el pedido activo para esta mesa.');
                      return;
                    }
                    // Pre-calculate totals for printPrecuenta
                    const subtotal = order.items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
                    
                    const printed = await printPrecuenta(config, {
                      items: order.items,
                      subtotal: subtotal,
                      discountTotal: Number(order.discountAmount || 0),
                      discountType: order.discountType,
                      discountValue: order.discountValue,
                      taxTotal: 0,      // Simplified for now
                      finalTotal: order.total || subtotal,
                      table: table,
                      customerName: order.customerName,
                      orderNumber: order.orderNumber,
                      tableDisplayLabel: order.tableDisplayLabel,
                      terminalId: getCurrentTerminal()?.id || 'T1'
                    });
                    if (printed) {
                      const subtotalizedAt = new Date().toISOString();
                      const subtotalizedItems = order.items.map(item => ({
                        ...item,
                        subtotalizedAt: item.subtotalizedAt || subtotalizedAt,
                        subtotalizedBy: item.subtotalizedBy || currentUser?.name || currentUser?.id || 'POS'
                      }));
                      const nextTickets = parkedTickets.map(ticket =>
                        String(ticket.id) === String(order.id)
                          ? { ...ticket, items: subtotalizedItems }
                          : ticket
                      );
                      await handleUpdateParkedTickets(nextTickets, { reason: 'explicit' });
                    }
                  } finally {
                    if (temporaryLockAcquired) await releaseActiveTableEditLock({ waitForPersistence: false });
                  }
                }}
                onParkedOrderSplitResult={handleParkedOrderSplitFromMap}
                onOpenTableLayoutDesigner={isClientTerminalMode() ? undefined : () => {
                  tableDesignerReturnViewRef.current = 'TABLE_MAP';
                  handleViewChange('TABLE_DESIGNER');
                }}
              />
            </div>
          </div>
        );
      }

      case 'TABLE_DESIGNER':
        return (
          <div className="h-screen flex flex-col bg-slate-50">
            <div className="bg-white border-b p-4 flex justify-between items-center z-20 shrink-0 shadow-sm text-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600 text-white rounded-lg shadow-lg">
                  <Layout size={20} />
                </div>
                <h2 className="font-black tracking-tight uppercase text-sm">Diseñador de Planos</h2>
              </div>
              <button
                onClick={async () => {
                  // Auto-save on exit to prevent data loss
                  const floorPlanSaved = await handleSaveFloorPlan(rooms, tables);
                  if (!floorPlanSaved) return;
                  const returnView = tableDesignerReturnViewRef.current;
                  if (returnView === 'TABLE_MAP') {
                    setCurrentView('TABLE_MAP');
                  } else {
                    setSettingsInitialView('LAYOUT');
                    setCurrentView(returnView === 'SETTINGS_SYNC' ? 'SETTINGS_SYNC' : 'SETTINGS');
                  }
                }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition-all border border-slate-200"
              >
                Guardar y Volver
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <TableLayoutDesigner
                rooms={rooms}
                currentRoomId={activeRoomId || rooms[0]?.id || ''}
                tables={tables}
                parkedTickets={parkedTickets}
                onSave={(newTables) => handleSaveFloorPlan(rooms, newTables)}
                onUpdateTables={setTables}
                onChangeRoom={(roomId) => setActiveRoomId(roomId)}
                onCreateRoom={(name) => {
                  const newRoom: Room = { id: 'R-' + Date.now(), name, nombre: name }; // Ensure 'nombre' is set for types
                  const updatedRooms = [...rooms, newRoom];
                  setRooms(updatedRooms);
                  setActiveRoomId(newRoom.id);
                  void handleSaveFloorPlan(updatedRooms, tables);
                }}
                onUpdateRoom={(updatedRoom) => {
                  const rawName = String(updatedRoom.name ?? updatedRoom.nombre ?? '');
                  const normalizedRoom = { ...updatedRoom, name: rawName, nombre: rawName };
                  const newRooms = rooms.map(r => r.id === normalizedRoom.id ? normalizedRoom : r);
                  setRooms(newRooms);
                }}
              />

            </div>
          </div>
        );

      case 'POS':
        if (!getCurrentTerminal()) {
          console.warn('[ACTIVATION_REDIRECT_REASON]', 'POS_WITHOUT_CURRENT_TERMINAL', { currentView, deviceId });
          setCurrentView('DEVICE_UNAUTHORIZED');
          return null;
        }
        if (!currentUser) { setCurrentView('LOGIN'); return null; }
        return (
          <POSInterface
            config={config}
            currentUser={currentUser}
            roles={roles}
            users={users}
            customers={customers}
            products={products}
            onUpdateProducts={setProducts}
            warehouses={warehouses}
            cart={cart}
            transactions={transactions}
            zReports={zReports}
            onUpdateCart={setCart}
            selectedCustomer={selectedCustomer}
            onSelectCustomer={setSelectedCustomer}
            parkedTickets={parkedTickets}
            onUpdateParkedTickets={handleUpdateParkedTickets}
            onLogout={navigateToUserLogin}
            onExitApplication={handleExitApplication}
            onOpenSettings={(view, data) => {
              setSettingsInitialView(view);
              setSettingsInitialData(data);
              setCurrentView('SETTINGS');
            }}
            onOpenAttendance={() => setCurrentView('ATTENDANCE')}
            onOpenCustomers={() => setCurrentView('CUSTOMERS')}
            onOpenHistory={() => setCurrentView('HISTORY')}
            onOpenFinance={handleOpenFinanceFromPos}
            onRegisterCashMovement={handleRegisterMovement}
            onOpenZReport={() => { void handleOpenZReport(); }}
            onOpenInventoryTracking={(productId) => handleViewChange('TRACKING', { productId })}
            onOpenAudit={() => handleViewChange('INVENTORY_AUDIT')}
            onOpenTableMap={async () => {
              const changeTrace = getLatestPosInteraction('CHANGE_TABLE');
              markInteractionStateUpdate(changeTrace, 3);
              const releasingTableId = String(activeTableEditLockRef.current?.tableId || '');
              // El lock local se retira en esta misma tarea. La liberación remota
              // permanece detrás de la barrera durable y no bloquea el mapa.
              void releaseActiveTableEditLock({ deferRemote: true, trace: changeTrace });
              setActiveTable(null);
              setViewData(null);
              setCurrentView('TABLE_MAP');
              // Liberación y reconciliación ocurren después del cambio visual;
              // no bloquear la navegación por red, SQLite ni heartbeat.
              window.setTimeout(() => {
                void measureInteractionStage(changeTrace, 'SYNC_START', 'SYNC_END', async () => {
                  const pendingRelease = pendingTableLockReleasesRef.current.get(releasingTableId);
                  const released = pendingRelease ? await pendingRelease.promise : true;
                  if (!released) {
                    console.warn('No se pudo confirmar la liberación de la mesa; se reconciliará el snapshot autoritativo.');
                  }
                  if (currentViewRef.current !== 'TABLE_MAP' || activeTableEditLockRef.current) return;
                  await fetchTables();
                }).catch((error) => console.error('Failed to refresh tables on TABLE_MAP view:', error));
              }, 0);
            }}
            onTableOrderSaved={async (table, ticket) => {
              const total = typeof ticket.total === 'number'
                ? Number(ticket.total || 0)
                : (ticket.items || []).reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
              const updatedTable = {
                ...table,
                status: 'OCCUPIED',
                currentOrderId: ticket.id,
                currentOrderTotal: total,
                timeSeated: table.timeSeated || ticket.timestamp
              } as Table;

              setTables(prev => {
                const base = prev.some(t => t.id === updatedTable.id)
                  ? prev.map(t => t.id === updatedTable.id ? updatedTable : t)
                  : [...prev, updatedTable];
                const reconciled = reconcileTablesWithParkedTickets(base, [ticket, ...(parkedTickets || [])]);
                db.save('tables', reconciled).catch(error => console.error('Failed to persist table occupancy:', error));
                return reconciled;
              });

              if (!isClientTerminalMode()) {
                const editLock = activeTableEditLockRef.current;
                void fetch(resolveOperationalApiUrl(`/api/tables/${encodeURIComponent(String(table.id))}`), {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ...updatedTable,
                    ownerId: editLock?.ownerId,
                    lockToken: editLock?.token,
                  })
                }).catch(error => {
                  console.warn('No se pudo persistir estado ocupado de mesa en API:', error);
                });
              }
            }}
            onSelectTableAccount={(ticket) => {
              if (!activeTable || String(ticket.tableId || '') !== String(activeTable.id || '')) return;

              const accountTotal = typeof ticket.total === 'number'
                ? Number(ticket.total || 0)
                : (ticket.items || []).reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
              const accountCustomer = ticket.customerId
                ? customers.find(customer => String(customer.id) === String(ticket.customerId)) || null
                : null;
              const snapshotCustomer = !accountCustomer && (ticket.customerSnapshot?.name || ticket.customerName)
                ? {
                    id: ticket.customerId || `parked-customer-${ticket.id}`,
                    name: ticket.customerSnapshot?.name || ticket.customerName || 'Cliente',
                    taxId: ticket.customerSnapshot?.taxId,
                    address: ticket.customerSnapshot?.address,
                    phone: ticket.customerSnapshot?.phone,
                    email: ticket.customerSnapshot?.email,
                    isTemporary: true
                  } as Customer
                : null;

              setCart(markRestaurantLinesCommitted(ticket.items || [], ticket.timestamp));
              setSelectedCustomer(accountCustomer || snapshotCustomer);
              setActiveTable({
                ...activeTable,
                currentOrderId: ticket.id,
                currentOrderTotal: accountTotal,
                status: 'OCCUPIED'
              });
            }}
            onTableOrderClosed={(table, _closedOrderId, remainingTickets = []) => {
              const closedOrderId = _closedOrderId ? String(_closedOrderId) : '';
              if (closedOrderId) {
                closedRestaurantOrderIdsRef.current.add(closedOrderId);
                if (closedRestaurantOrderIdsRef.current.size > 200) {
                  const oldestOrderId = closedRestaurantOrderIdsRef.current.values().next().value;
                  if (oldestOrderId) closedRestaurantOrderIdsRef.current.delete(oldestOrderId);
                }
              }
              const tableId = String(table.id ?? '');
              const effectiveRemainingTickets = (remainingTickets || []).filter(ticket => {
                const isClosedOrder = closedOrderId && String(ticket.id) === closedOrderId;
                return !isClosedOrder;
              });
              const tableTickets = effectiveRemainingTickets.filter(ticket => String(ticket.tableId ?? '') === tableId);
              const nextTicket = tableTickets[0];
              const remainingTotal = tableTickets.reduce((sum, ticket) => {
                const itemsTotal = (ticket.items || []).reduce((itemSum, item) => itemSum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
                return sum + Number(ticket.total ?? itemsTotal ?? 0);
              }, 0);
              const nextTable = nextTicket
                ? ({
                    ...table,
                    status: 'OCCUPIED',
                    currentOrderId: nextTicket.id,
                    currentOrderTotal: remainingTotal,
                    timeSeated: table.timeSeated || nextTicket.timestamp,
                  } as Table)
                : ({
                    ...table,
                    status: 'FREE',
                    currentOrderId: undefined,
                    currentOrderTotal: undefined,
                    timeSeated: undefined,
                    waiterId: undefined,
                    waiterName: undefined,
                    guests: undefined,
                    barTabId: undefined,
                    barTabName: undefined,
                  } as Table);

              const base = tables.some(t => t.id === nextTable.id)
                ? tables.map(t => t.id === nextTable.id ? nextTable : t)
                : [...tables, nextTable];
              const reconciled = reconcileTablesWithParkedTickets(base, effectiveRemainingTickets);

              // La mesa vacía también sigue el contrato LOCAL_COMMITTED: la UI y
              // el lock local cambian en esta misma tarea. SQLite, HTTP y la
              // liberación remota conservan su orden, pero nunca bloquean volver
              // al mapa ni la siguiente interacción del operador.
              setTables(reconciled);
              if (closedOrderId) {
                void releaseActiveTableEditLock({ deferRemote: true });
              } else {
                void releaseActiveTableEditLock({ deferRemote: true, waitForPersistence: false });
              }
              window.setTimeout(() => {
                void (async () => {
                  await clearActiveCartDraftStorage().catch((error) => console.warn('No se pudo limpiar borrador activo tras cerrar mesa:', error));
                  await db.save('tables', reconciled).catch(error => console.error('Failed to persist table release:', error));
                  try {
                    await fetch(resolveOperationalApiUrl(`/api/tables/${encodeURIComponent(String(table.id))}`), {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(nextTable)
                    });
                  } catch (error) {
                    console.warn('No se pudo persistir estado libre de mesa en API:', error);
                  }
                })();
              }, 0);
            }}
            onOpenAgenda={() => setCurrentView('AGENDA')}
            onTransactionComplete={handleTransactionComplete}
            activeTable={activeTable}
            rooms={rooms}
            onClearActiveTable={() => setActiveTable(null)}
            onAddCustomer={handleAddCustomer}
            onUpdateConfig={handleConfigUpdate}
            onKioskPay={() => handleViewChange('KIOSK_PAYMENT' as any)}
            activeTerminalId={getCurrentTerminal()!.id}
            onUpdateActiveTableGuests={handleUpdateActiveTableGuests}
          />
        );

      case 'AGENDA':
        // Redirecting to Settings with Agenda as initial view
        setSettingsInitialView('AGENDA');
        setCurrentView('SETTINGS');
        return null;

      case 'ATTENDANCE': {
        const currentRoleId = currentUser?.roleId || currentUser?.role;
        const currentRole = roles.find(role => role.id === currentRoleId);
        const canManageAttendance = Boolean(
          currentRole?.permissions?.includes('ALL')
          || currentRole?.permissions?.includes('SETTINGS_USERS')
        );

        return (
          <TeamHub
            users={users}
            roles={roles}
            onUpdateUsers={handleTeamUsersUpdate}
            onUpdateRoles={handleTeamRolesUpdate}
            onClose={() => setCurrentView('POS')}
            mode="ATTENDANCE"
            canManageAttendance={canManageAttendance}
            erpManaged={isErpManagedPosUserRuntime()}
          />
        );
      }

      case 'SETTINGS':
        return (
          <Settings
            config={config}
            users={users}
            currentUser={currentUser}
            roles={roles}
            transactions={transactions}
            products={products}
            warehouses={warehouses}
            transfers={transfers}
            internalSequences={internalSequences}
            suppliers={suppliers}
            customers={customers}
            rooms={rooms}
            collections={collections}
            onUpdateCollections={setCollections}
            purchaseOrders={purchaseOrders}
            receptions={receptions}
            parkedTickets={parkedTickets}
            onUpdateTransfers={async (t) => { setTransfers(t); await db.save('transfers', t); }}
            onUpdateSequences={async (s) => { setInternalSequences(s); await db.save('internalSequences', s); }}
            onUpdateConfig={handleConfigUpdate}
            onUpdateUsers={handleTeamUsersUpdate}
            onUpdateRoles={handleTeamRolesUpdate}
            onUpdateProducts={async (p) => { setProducts(p); /* db.save('products', p) removed for efficiency */ syncManager.broadcastChange('products', null, 'UPDATE').catch(console.error); }}
            onUpdateWarehouses={async (w) => { setWarehouses(w); await db.save('warehouses', w); }}
            onUpdateCustomers={async (c) => { setCustomers(c); await db.save('customers', c); }}
            onAddCustomer={handleAddCustomer}
            onRepairLegacyReceivables={handleRepairLegacyReceivables}
            onAdjustStock={async (adjustments) => {
              const pairedTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
              const terminalId = pairedTerminal?.id || 'LOCAL';
              const whId = config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';
              for (const adj of adjustments) {
                if (adj.quantity !== 0) {
                  const type = adj.quantity > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA';
                  await db.recordInventoryMovement(whId, adj.productId, type, 'AUDITORIA', adj.quantity, undefined, terminalId);
                }
              }
              backgroundSyncManager.triggerSync();
              const freshData = await db.init();
              setProducts(freshData.products);
              const freshStocks = await db.get('productStocks') as ProductStock[] || [];
              setProductStocks(freshStocks);
            }}
            onOpenFinance={handleOpenFinanceFromPos}
            onOpenZReport={() => { void handleOpenZReport(); }}
            onOpenSupplyChain={() => setCurrentView('SUPPLY_CHAIN')}
            onOpenFranchise={() => setCurrentView('FRANCHISE_DASHBOARD')}
            onOpenTableDesigner={() => {
              tableDesignerReturnViewRef.current = 'SETTINGS';
              setCurrentView('TABLE_DESIGNER');
            }}
            initialView={settingsInitialView as any}
            initialData={settingsInitialData}
            isAdminMode={isAdminMode}
            terminalId={(config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.id || 'T1'}
            onClose={() => {
              setSettingsInitialView(undefined);
              setSettingsInitialData(undefined);
              setIsAdminMode(false); // Exit admin mode when closing settings

              // Return to appropriate view based on role
              const role = getCurrentDeviceRole();
              if (role === DeviceRole.SELF_CHECKOUT) setCurrentView('KIOSK_WELCOME');
              else if (role === DeviceRole.PRICE_CHECKER) setCurrentView('CHECKER_SCAN');
              else if (role === DeviceRole.KITCHEN_DISPLAY) setCurrentView('KITCHEN_ORDERS');
              else if (role === DeviceRole.HANDHELD_INVENTORY) setCurrentView('INVENTORY_HOME');
              else setCurrentView('POS');
            }}
            currentDeviceId={deviceId}
            erpRoleAuthority={isErpManagedPosUserRuntime()}
            onUpdateRooms={async (newRooms) => { setRooms(newRooms); await db.save('rooms', newRooms); }}
          />
        );

      case 'SETTINGS_SYNC':
        return (
          <Settings
            config={config}
            users={users}
            currentUser={currentUser}
            roles={roles}
            transactions={transactions}
            products={products}
            warehouses={warehouses}
            transfers={transfers}
            rooms={rooms}
            internalSequences={internalSequences}
            onUpdateTransfers={async (t) => { setTransfers(t); await db.save('transfers', t); }}
            onUpdateSequences={async (s) => { setInternalSequences(s); await db.save('internalSequences', s); }}
            onUpdateConfig={handleConfigUpdate}
            onUpdateUsers={handleTeamUsersUpdate}
            onUpdateRoles={handleTeamRolesUpdate}
            onUpdateProducts={async (p) => { setProducts(p); await db.save('products', p); }}
            onUpdateWarehouses={async (w) => { setWarehouses(w); await db.save('warehouses', w); }}
            onUpdateCustomers={async (c) => { setCustomers(c); await db.save('customers', c); }}
            onAddCustomer={handleAddCustomer}
            collections={collections}
            onUpdateCollections={setCollections}
            onRepairLegacyReceivables={handleRepairLegacyReceivables}
            onAdjustStock={async (adjustments) => {
              const pairedTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
              const terminalId = pairedTerminal?.id || 'LOCAL';
              const whId = config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';
              for (const adj of adjustments) {
                if (adj.quantity !== 0) {
                  const type = adj.quantity > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA';
                  await db.recordInventoryMovement(whId, adj.productId, type, 'AUDITORIA', adj.quantity, undefined, terminalId);
                }
              }
              backgroundSyncManager.triggerSync();
              const freshData = await db.init();
              setProducts(freshData.products);
              const freshStocks = await db.get('productStocks') as ProductStock[] || [];
              setProductStocks(freshStocks);
            }}
            onOpenFinance={handleOpenFinanceFromPos}
            onOpenZReport={() => { void handleOpenZReport(); }}
            onOpenSupplyChain={() => setCurrentView('SUPPLY_CHAIN')}
            onOpenFranchise={() => setCurrentView('FRANCHISE_DASHBOARD')}
            onOpenTableDesigner={() => {
              tableDesignerReturnViewRef.current = 'SETTINGS_SYNC';
              setCurrentView('TABLE_DESIGNER');
            }}
            isAdminMode={isAdminMode}
            initialView="SYNC"
            onClose={() => {
              setIsAdminMode(false);
              const role = getCurrentDeviceRole();
              if (role === DeviceRole.HANDHELD_INVENTORY) setCurrentView('INVENTORY_HOME');
              else setCurrentView('POS');
            }}
            currentDeviceId={deviceId}
            terminalId={(config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.id || 'T1'}
            erpRoleAuthority={isErpManagedPosUserRuntime()}
          />
        );

      case 'CUSTOMERS':
        return (
          <CustomerManagement
            customers={customers}
            config={config}
            rooms={rooms}
            users={users}
            collections={collections}
            currentUser={currentUser!}
            terminalId={(config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.id || 'T1'}
            onAddCustomer={handleAddCustomer}
            onUpdateCustomer={async (c) => {
              const updated = customers.map(cust => cust.id === c.id ? c : cust);
              setCustomers(updated);
              await db.save('customers', updated);
              await queueCustomerMutation('UPSERT', c);
              backgroundSyncManager.triggerSync().catch(console.error);
            }}
            onUpdateCollections={(cols) => {
              setCollections(cols);
            }}
            onDeleteCustomer={async (id) => {
              const updated = customers.filter(cust => cust.id !== id);
              setCustomers(updated);
              await db.save('customers', updated);
              await queueCustomerMutation('DELETE', id);
              backgroundSyncManager.triggerSync().catch(console.error);
            }}
            onSelect={(c) => {
              setSelectedCustomer(c);
              const orderId = String(activeTable?.currentOrderId || '').trim();
              const existingTicket = orderId
                ? parkedTickets.find(ticket => String(ticket.id) === orderId)
                : undefined;
              if (existingTicket) {
                const updatedTicket: ParkedTicket = {
                  ...existingTicket,
                  customerId: c.id,
                  customerName: c.name,
                  customerSnapshot: {
                    name: c.name,
                    taxId: c.taxId,
                    address: c.address,
                    phone: c.phone,
                    email: c.email
                  }
                };
                const updatedTickets = parkedTickets.map(ticket =>
                  String(ticket.id) === orderId ? updatedTicket : ticket
                );
                setParkedTickets(updatedTickets);
                void handleUpdateParkedTickets(updatedTickets, { reason: 'customer_assigned' })
                  .catch(error => console.error('No se pudo guardar el cliente del ticket:', error));
              }
              setCurrentView('POS');
            }}
            onClose={() => setCurrentView('POS')}
            onRetryFiscalDocument={retryFiscalDocument}
          />
        );

      case 'HISTORY':
        return (
          <TicketHistory
            transactions={transactions}
            config={config}
            currentUser={currentUser}
            users={users}
            roles={roles}
            customers={customers}
            initialSelectedId={scanTargetTicketId}
            activeTerminalId={getCurrentTerminal()?.id || 'T1'}
            onUpdateConfig={handleConfigUpdate}
            onClose={() => {
              setScanTargetTicketId(null); // Clear selection on close
              setCurrentView('POS');
            }}
            onRefundTransaction={async (tx, items, conditions, reason, options) => {
              // Direct call support
              // If conditions is string (legacy call from somewhere else?), handle it. 
              // But TicketHistory calls it with Map.
              // We just pass it through to handleProcessRefund.
              const validConditions = conditions instanceof Map ? conditions : new Map<string, 'SELLABLE' | 'DAMAGED'>();

              // If legacy call passed reason as 3rd arg (and conditions was undefined/string)
              const actualReason = typeof conditions === 'string' ? conditions : reason;

              try {
                return await handleProcessRefund(tx, items || [], validConditions, actualReason, options);
              } catch (refundError: any) {
                console.error('❌ Refund flow failed:', refundError);
                if (options?.settlementMode === 'CARD_VOID') {
                  alert(`AZUL anuló el pago, pero el POS no pudo completar la nota de crédito.\nDetalle: ${refundError?.message || 'Error desconocido'}`);
                } else {
                  alert(`Error procesando devolución: ${refundError?.message || 'Error desconocido'}`);
                }
                throw refundError;
              }
            }}
            onRetryFiscalDocument={retryFiscalDocument}
            onCorrectFiscalDocument={correctFiscalDocument}
          />
        );

      case 'FINANCE':
        {
          const financeTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
          const currentTerminalId = financeTerminal?.id || 'T1';
          const terminalTransactions = getPendingTransactionsForTerminal(currentTerminalId).filter(belongsToCurrentCashier);
          const terminalMovements = getPendingCashMovementsForTerminal(currentTerminalId).filter(belongsToCurrentCashier);
          const terminalXReports = xReports.filter(report =>
            normalizeTerminalId(report.terminalId) === normalizeTerminalId(currentTerminalId) &&
            belongsToCurrentCashier({ userId: report.closedByUserId, userName: report.closedByUserName })
          );
          const allowPartialXReport = financeTerminal?.config?.workflow?.session?.allowPartialXReport !== false;

          return (
            <FinanceDashboard
              transactions={terminalTransactions}
              cashMovements={terminalMovements}
              xReports={terminalXReports}
              config={config}
              currentUser={currentUser}
              roles={roles}
              allowPartialXReport={allowPartialXReport}
              terminalId={currentTerminalId}
              initialCashMovementType={viewData?.initialCashMovementType}
              onRegisterMovement={handleRegisterMovement}
              onCloseXReport={handleXReport}
              onPrintXReport={handlePrintXReport}
              onOpenZReport={() => { void handleOpenZReport(); }}
              onClose={() => setCurrentView(viewData?.returnView === 'TABLE_MAP' ? 'TABLE_MAP' : 'POS')}
            />
          );
        }

      case 'Z_REPORT':
        {
          const currentTerminalId = getCurrentTerminal()?.id || 'T1';
          const terminalTransactions = getPendingTransactionsForTerminal(currentTerminalId);
          const terminalMovements = getPendingCashMovementsForTerminal(currentTerminalId);

          return (
            <ZReportDashboard
              transactions={terminalTransactions}
              cashMovements={terminalMovements}
              collections={collections}
              config={config}
              userName={currentUser?.name || ''}
              currentUser={currentUser}
              roles={roles}
              onConfirmClose={handleZReport}
              terminalId={currentTerminalId}
              onClose={() => {
                const role = getCurrentDeviceRole();
                if (role === DeviceRole.SELF_CHECKOUT) setCurrentView('KIOSK_WELCOME');
                else if (role === DeviceRole.PRICE_CHECKER) setCurrentView('CHECKER_SCAN');
                else if (role === DeviceRole.KITCHEN_DISPLAY) setCurrentView('KITCHEN_ORDERS');
                else if (role === DeviceRole.HANDHELD_INVENTORY) setCurrentView('INVENTORY_HOME');
                else setCurrentView('POS');
              }}
            />
          );
        }

      case 'SUPPLY_CHAIN':
        return (
          <SupplyChainManager
            products={products}
            suppliers={suppliers}
            purchaseOrders={purchaseOrders}
            receptions={receptions}
            supplierProductPrices={supplierProductPrices}
            config={config}
            onClose={() => setCurrentView('POS')}
            onDeleteSupplier={async (id) => {
              try {
                // Delete from DB first to ensure persistence consistency
                await db.deleteDocument('suppliers', id);
                // Then update state
                setSuppliers(prev => prev.filter(s => s.id !== id));
                // Broadcast change
                syncManager.broadcastChange('suppliers', { id }, 'DELETE').catch(console.error);
              } catch (error) {
                console.error("Failed to delete supplier:", error);
                alert("Error al eliminar el proveedor. Por favor, intente de nuevo.");
              }
            }}
            onCreateOrder={async (o) => { const updated = [...purchaseOrders, o]; setPurchaseOrders(updated); await db.saveDocument('purchaseOrders', o); }}
            onUpdateOrder={async (o) => { const updated = purchaseOrders.map(p => p.id === o.id ? o : p); setPurchaseOrders(updated); await db.saveDocument('purchaseOrders', o); }}
            onReceiveStock={async (items, orderId) => {
              console.log("🚀 APP: onReceiveStock CALLED", { orderId, itemsCount: items.length });

              const pairedTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
              const terminalId = pairedTerminal?.id || 'LOCAL';
              const whId = config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';

              // 1. Record Inventory Movements (Batch)
              const movements: any[] = [];
              for (const item of items) {
                if (item.quantityReceived <= 0) continue;

                if (item.trackingData && item.trackingData.length > 0) {
                  // For tracked items, we record movements per tracking unit (Serial) or per Lot
                  // If there are multiple entries, it's likely serials (qty 1 each)
                  // If there's 1 entry and qty > 1, it's a lot.
                  if (item.trackingData.length === 1 && item.quantityReceived > 1) {
                    // LOT
                    movements.push({
                      warehouseId: whId,
                      productId: item.productId,
                      concept: 'COMPRA' as LedgerConcept,
                      documentRef: orderId || 'OC-REC',
                      qty: item.quantityReceived,
                      movementCost: item.cost,
                      terminalId,
                      variantId: item.variantSku,
                      variantName: item.variantInfo,
                      trackingId: item.trackingData[0].id,
                      trackingCode: item.trackingData[0].trackingCode
                    });
                  } else {
                    // SERIALS (or 1 item with tracing)
                    for (const track of item.trackingData) {
                      movements.push({
                        warehouseId: whId,
                        productId: item.productId,
                        concept: 'COMPRA' as LedgerConcept,
                        documentRef: orderId || 'OC-REC',
                        qty: 1, // Individual serial
                        movementCost: item.cost,
                        terminalId,
                        variantId: item.variantSku,
                        variantName: item.variantInfo,
                        trackingId: track.id,
                        trackingCode: track.trackingCode
                      });
                    }
                  }
                } else {
                  movements.push({
                    warehouseId: whId,
                    productId: item.productId,
                    concept: 'COMPRA' as LedgerConcept,
                    documentRef: orderId || 'OC-REC',
                    qty: item.quantityReceived,
                    movementCost: item.cost,
                    terminalId,
                    variantId: item.variantSku,
                    variantName: item.variantInfo
                  });
                }
              }

              console.log("📦 APP: Calculated movements:", movements.length, movements);

              if (movements.length > 0) {
                console.log("💾 APP: Calling db.recordInventoryMovements...");
                try {
                  await db.recordInventoryMovements(movements);
                  console.log("✅ APP: db.recordInventoryMovements success");
                } catch (e) {
                  console.error("❌ APP: db.recordInventoryMovements FAILED:", e);
                  throw e; // Propagate to UI
                }
              } else {
                console.warn("⚠️ APP: No movements to record (quantityReceived = 0?)");
              }

              // 2. Save Reception Document
              let receptionId = `REC-${Date.now()}`;
              try {
                // Try to get sequence for 'PURCHASE'
                const seriesId = pairedTerminal?.config?.documentAssignments?.['PURCHASE'];
                if (seriesId) {
                  const seqResult = await transactionService.generateTransactionId('PURCHASE' as any, seriesId);
                  receptionId = seqResult.displayId;
                }
              } catch (e) {
                console.warn("⚠️ APP: Failed to generate reception sequence, falling back to REC-Date", e);
              }

              const newReception: Reception = {
                id: receptionId,
                purchaseOrderId: orderId || 'MANUAL',
                date: new Date().toISOString(),
                receivedBy: currentUser?.id || 'sys',
                receivedByUserName: currentUser?.name || 'System',
                items: items.filter(i => i.quantityReceived > 0),
                terminalId,
                syncStatus: 'PENDING',
                updatedAt: new Date().toISOString()
              };

              console.log("📝 APP: Saving new reception document:", newReception.id);
              const updatedReceptions = [...receptions, newReception];
              setReceptions(updatedReceptions);
              await db.saveDocument('receptions', newReception);

              // 2.5 Update Supplier Price Catalog
              try {
                const po = purchaseOrders.find(p => p.id === orderId);
                if (po && po.supplierId && items.length > 0) {
                  console.log(`🏷️ APP: Updating price catalog for supplier ${po.supplierId}...`);
                  const priceUpdates = [];
                  for (const item of items) {
                    if (item.quantityReceived <= 0) continue;

                    const recordId = `${po.supplierId}_${item.productId}`;
                    let existingRecord = await db.getDocument('supplierProductPrices', recordId) as any;

                    if (!existingRecord) {
                      existingRecord = {
                        id: recordId,
                        supplierId: po.supplierId,
                        productId: item.productId,
                        history: []
                      };
                    }

                    const newCost = item.cost || 0;
                    const newHistoryEntry = {
                      date: new Date().toISOString(),
                      cost: newCost,
                      orderId: orderId || 'MANUAL'
                    };

                    const updatedRecord = {
                      ...existingRecord,
                      lastCost: newCost,
                      currency: config.currencySymbol,
                      updatedAt: new Date().toISOString(),
                      history: [...(existingRecord.history || []), newHistoryEntry]
                    };
                    priceUpdates.push(updatedRecord);
                    await db.saveDocument('supplierProductPrices', updatedRecord);
                  }

                  if (priceUpdates.length > 0) {
                    syncManager.broadcastChange('supplierProductPrices', priceUpdates, 'UPDATE').catch(console.error);
                  }
                }
              } catch (e) {
                console.warn("⚠️ APP: Failed to update supplier price catalog:", e);
              }

              // 3. Refresh Products State
              const refreshedProducts = await db.get('products') as Product[] || [];
              setProducts(refreshedProducts);

              if (permissionService.isMasterTerminal()) {
                syncManager.broadcastChange('products', null, 'UPDATE').catch(console.error);
                syncManager.broadcastChange('productStocks', null, 'UPDATE').catch(console.error);
              }

              // Refresh detailed stocks state
              const freshStocks = await db.get('productStocks') as ProductStock[] || [];
              setProductStocks(freshStocks);

              // NEW: Refresh Supplier Prices
              const freshSupplierPrices = await db.get('supplierProductPrices') as any[] || [];
              setSupplierProductPrices(freshSupplierPrices);

              console.log("🏁 APP: onReceiveStock FINISHED");
            }}
            onAdjustStock={async (adjustments) => {
              const pairedTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
              const terminalId = pairedTerminal?.id || 'LOCAL';
              const whId = config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';
              for (const adj of adjustments) {
                if (adj.quantity !== 0) {
                  const type = adj.quantity > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA';
                  // recordInventoryMovement handles adding/subtracting based on signed quantity
                  await db.recordInventoryMovement(whId, adj.productId, type, 'AUDITORIA', adj.quantity, undefined, terminalId);
                }
              }
              backgroundSyncManager.triggerSync();
              const freshData = await db.init();
              setProducts(freshData.products);

              if (permissionService.isMasterTerminal()) {
                syncManager.broadcastChange('products', null, 'UPDATE').catch(console.error);
                syncManager.broadcastChange('productStocks', null, 'UPDATE').catch(console.error);
              }

              // Refresh detailed stocks state
              const freshStocks = await db.get('productStocks') as ProductStock[] || [];
              setProductStocks(freshStocks);

              // backgroundSyncManager.triggerSync already called above
            }}
            onAddSupplier={async (s) => {
              const numberedSupplier = await createNumberedMaster('SUPPLIER', 'suppliers', s);
              setSuppliers(prev => [...prev, numberedSupplier]);
              syncManager.broadcastChange('suppliers', numberedSupplier, 'CREATE').catch(console.error);
            }}
            onUpdateSupplier={async (s) => {
              setSuppliers(prev => prev.map(sup => sup.id === s.id ? s : sup));
              await db.saveDocument('suppliers', s);
              syncManager.broadcastChange('suppliers', s, 'UPDATE').catch(console.error);
            }}
            onDeleteOrder={async (orderId) => {
              const updated = purchaseOrders.filter(o => o.id !== orderId);
              setPurchaseOrders(updated);
              await db.deleteDocument('purchaseOrders', orderId);
            }}
            onDeleteReception={async (receptionId) => {
              const reception = receptions.find(r => r.id === receptionId);
              if (!reception) return;

              // Validation: Check if stock is sufficient to reverse
              const insufficientStockItems = reception.items.filter(item => {
                const product = products.find(p => p.id === item.productId);
                return !product || (product.stock || 0) < item.quantityReceived;
              });

              if (insufficientStockItems.length > 0) {
                const names = insufficientStockItems.map(i => i.productName).join(', ');
                alert(`No se puede anular la recepción. El inventario de los siguientes productos ya ha sido utilizado o vendido: ${names}`);
                return;
              }

              // Reverse Stock
              let updatedProducts = [...products];
              for (const item of reception.items) {
                const productIndex = updatedProducts.findIndex(p => p.id === item.productId);
                if (productIndex >= 0) {
                  const currentStock = updatedProducts[productIndex].stock || 0;
                  const newStock = currentStock - item.quantityReceived;

                  const updatedProduct = { ...updatedProducts[productIndex], stock: newStock };
                  updatedProducts[productIndex] = updatedProduct;

                  await db.saveDocument('products', updatedProduct);

                  // Record Adjustment
                  await db.recordInventoryMovement(
                    config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central',
                    item.productId,
                    'AJUSTE_SALIDA', // Correction
                    `VOID-${receptionId}`,
                    -item.quantityReceived,
                    item.cost,
                    getCurrentTerminal()?.id || 'T1',
                    item.variantSku,
                    item.variantInfo
                  );
                }
              }
              setProducts(updatedProducts);

              // Remove Reception
              const updatedReceptions = receptions.filter(r => r.id !== receptionId);
              setReceptions(updatedReceptions);
              await db.deleteDocument('receptions', receptionId);
              alert("Recepción anulada y stock revertido correctamente.");
            }}
          />
        );

      // Inventory Tracking
      case 'TRACKING':
        return <InventoryTracking onClose={() => handleViewChange('POS')} initialProductId={viewData?.productId} />;
      case 'FRANCHISE_DASHBOARD':
        return <FranchiseDashboard onBack={() => setCurrentView('POS')} />;

      // Kiosk / Self-Checkout Views
      case 'KIOSK_WELCOME':
        return (
          <KioskWelcome
            onStartShopping={() => {
              clearSecurityState();
              setSelectedCustomer(null);
              clearKioskCoupon();
              handleViewChange('KIOSK_BROWSER');
            }}
            storeName={config.companyInfo?.name}
            onAdminAccess={async () => {
              const rawPin = await clicPrompt('Ingrese PIN de administrador:');
              if (!rawPin) return;

              const pin = rawPin.trim();
              if (authLevelService.validateEscapeHatch(pin)) {
                setIsAdminMode(true);
                setCurrentView('SETTINGS');
              } else {
                alert('PIN incorrecto');
              }
            }}
          />
        );

      case 'KIOSK_BROWSER':
        return (
          <KioskProductBrowser
            products={products}
            warehouses={warehouses}
            cart={cart}
            onAddToCart={(product, quantity = 1) => {
              const existing = cart.find(item => item.id === product.id);
              let newCart;
              if (existing) {
                newCart = cart.map(item =>
                  item.id === product.id
                    ? { ...item, quantity: item.quantity + quantity }
                    : item
                );
              } else {
                newCart = [...cart, { ...product, quantity }];
              }
              setCart(applyKioskCartPromotions(newCart));
            }}
            onRemoveFromCart={(productId) => {
              const newCart = cart.filter(item => item.id !== productId);
              setCart(applyKioskCartPromotions(newCart));
            }}
            onCheckout={() => handleViewChange('KIOSK_PAYMENT')}
            onCancel={() => {
              clearSecurityState();
              recordCheckoutDiagnostic('CART_CLEAR_REQUEST', { items: cart, tableId: activeTable?.id, orderId: activeTable?.currentOrderId, reason: 'APP_CLEAR_02' });
              setCart([]);
              setSelectedCustomer(null);
              clearKioskCoupon();
              handleViewChange('KIOSK_WELCOME');
            }}
            config={config}
            terminalId={getCurrentTerminal()?.id || 'T1'}
            customerConfidenceIndex={selectedCustomer ? 1 : 0.75}
            selectedCustomer={selectedCustomer}
            redeemedCoupon={kioskRedeemedCoupon}
          />
        );

      case 'INVENTORY_AUDIT':
        return (
          <div className="bg-gray-100 h-screen flex flex-col overflow-hidden">
            <div className="bg-white shadow-sm border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10 shrink-0">
              <button
                onClick={() => setCurrentView('INVENTORY_HOME')}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-gray-200"
              >
                ← Volver
              </button>
              <h1 className="text-base font-black text-gray-800">Auditoría de Inventarios</h1>
              <div className="w-20"></div>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              <InventoryAuditClosure
                warehouses={warehouses}
                products={products}
                config={config}
                currentUser={currentUser}
                roles={roles}
                terminalId={getCurrentTerminal()?.id}
              />
            </div>
          </div>
        );

      case 'KIOSK_PAYMENT':
        const kioskTerminal = getCurrentTerminal();
        const kioskActiveConfig = kioskTerminal?.config;
        const kioskCartGrossTotal = roundMoney(cart.reduce((sum, item) => {
          return sum + Math.abs((Number(item.price) || 0) * (Number(item.quantity) || 0));
        }, 0));
        const kioskCouponDiscountAmount = getKioskCouponDiscountAmount(kioskCartGrossTotal);
        const kioskPaymentMethods = resolveKioskPaymentMethods(config, selectedCustomer);
        const kioskTotals = buildKioskPaymentTotals(cart, config, kioskActiveConfig, kioskCouponDiscountAmount);
        return (
          <KioskPayment
            cart={cart}
            paymentMethods={kioskPaymentMethods}
            totals={kioskTotals}
            selectedCustomer={selectedCustomer}
            redeemedCoupon={kioskRedeemedCoupon}
            onLookupCustomerByCode={handleKioskCustomerLookup}
            onLookupCustomerByPhone={handleKioskCustomerLookup}
            onRedeemCoupon={handleKioskCouponRedeem}
            onClearCustomer={clearKioskCustomerSelection}
            onClearCoupon={clearKioskCoupon}
            onBack={() => handleViewChange('KIOSK_BROWSER')}
            onPaymentComplete={async (method) => {
              console.log(`Payment completed with ${method.label} (${method.type})`);

              // Get current terminal and config
              const currentTerminal = kioskTerminal || getCurrentTerminal();
              const activeConfig = currentTerminal?.config;
              const kioskOperator: Pick<User, 'id' | 'name'> = currentUser
                || users.find((user) => /self|kiosk|autoservicio/i.test(`${user.name} ${user.role} ${user.roleId || ''}`))
                || { id: 'self-checkout', name: 'Self Checkout' };

              if (!currentTerminal || !activeConfig) {
                console.error("Missing terminal config for kiosk transaction");
                throw new Error('Esta terminal no tiene configuración activa para completar el pago.');
              }

              // Calculate totals
              const subtotal = kioskTotals.subtotal;
              const tax = kioskTotals.tax;
              const total = kioskTotals.total;
              const isWalletPayment = method.type === 'WALLET';
              const walletBalance = Number(selectedCustomer?.wallet?.balance || 0);
              if (isWalletPayment) {
                if (!selectedCustomer?.id || selectedCustomer.wallet?.status !== 'ACTIVE') {
                  throw new Error('Seleccione un cliente con wallet activo para pagar con saldo.');
                }
                if (walletBalance + 0.01 < total) {
                  throw new Error(`Saldo insuficiente en wallet. Disponible: ${walletBalance.toFixed(2)}.`);
                }
              }
              const baseCurrency = config.currencies?.find(currency => currency.isBase)?.code || 'DOP';
              const configuredMethod = (config.paymentMethods || []).find(paymentMethod => paymentMethod.id === method.id)
                || (config.paymentMethods || []).find(paymentMethod => paymentMethod.type === method.type && paymentMethod.name === method.label)
                || (config.paymentMethods || []).find(paymentMethod => paymentMethod.type === method.type);
              const isIntegratedCard = configuredMethod?.type === 'CARD' && configuredMethod.integrationMode === 'INTEGRATED';
              const assignedIntegration = configuredMethod?.integrationId
                ? config.integrations?.find(integration => integration.id === configuredMethod.integrationId)
                : (configuredMethod?.integration && configuredMethod.integration !== 'NONE'
                    ? config.integrations?.find(integration => integration.provider === configuredMethod.integration)
                  : undefined);

              // Get assigned sequence
              const availableSeries = mergeDocumentSeriesCollection([
                ...internalSequences,
                ...(activeConfig.documentSeries || [])
              ]);
              const assignedSeriesId = activeConfig.documentAssignments?.['TICKET'];
              const seriesId = resolveDocumentAssignmentId('TICKET', availableSeries, assignedSeriesId)
                || assignedSeriesId;
              if (!seriesId) {
                throw new Error('No hay secuencia de TICKET asignada a esta terminal.');
              }

              try {
                let gatewayPaymentFields: Partial<PaymentEntry> = {};

                if (isIntegratedCard) {
                  if (!assignedIntegration) {
                    throw new Error(`El medio de pago ${method.label} no tiene una integración válida asignada.`);
                  }

                  const gatewayOrderNumber = createKioskGatewayOrderNumber();
                  const gatewayResult = assignedIntegration.provider === 'AZUL'
                    ? await azulMcmService.sale(assignedIntegration, {
                      amount: total,
                      itbis: tax,
                      orderNumber: gatewayOrderNumber,
                      installment: '0',
                    })
                    : assignedIntegration.provider === 'INGENICO_AZUL_WEBAPI'
                      ? await ingenicoAzulWebApiService.sale(assignedIntegration, {
                        amount: total,
                      })
                      : assignedIntegration.provider === 'CARDNET'
                        ? await cardNetEcrService.sale(assignedIntegration, {
                          amount: total,
                          itbis: tax,
                          invoiceTicket: generateCardNetInvoiceTicket(),
                        })
                        : (() => {
                          throw new Error(`La integración ${assignedIntegration.provider} todavía no está soportada en self checkout.`);
                        })();
                  const gatewayReference = 'referenceNumber' in gatewayResult
                    ? gatewayResult.referenceNumber
                    : ('transactionReference' in gatewayResult ? gatewayResult.transactionReference : undefined);

                  gatewayPaymentFields = {
                    gatewayProvider: assignedIntegration.provider,
                    gatewayIntegrationId: assignedIntegration.id,
                    gatewayTransactionType: 'SALE',
                    gatewayStatus: gatewayResult.approved ? 'APPROVED' : 'DECLINED',
                    gatewayResponseCode: gatewayResult.responseCode,
                    gatewayResponseMessage: gatewayResult.responseMessage,
                    gatewayOrderNumber: 'orderNumber' in gatewayResult ? (gatewayResult.orderNumber || gatewayOrderNumber) : gatewayOrderNumber,
                    gatewayProcessedAmount: total,
                    gatewayProcessedTaxAmount: assignedIntegration.provider === 'AZUL' || assignedIntegration.provider === 'CARDNET' ? tax : 0,
                    gatewayAuthorizationCode: gatewayResult.authorizationCode,
                    gatewayReference,
                    gatewaySequenceNumber: 'sequenceNumber' in gatewayResult ? gatewayResult.sequenceNumber : undefined,
                    gatewayInvoiceNumber: gatewayResult.invoiceNumber,
                    gatewayBatchNumber: gatewayResult.batchNumber,
                    gatewayMerchantId: gatewayResult.merchantId,
                    gatewayTerminalId: gatewayResult.terminalId,
                    gatewayMaskedPan: gatewayResult.maskedPan,
                    gatewayCardBrand: gatewayResult.cardBrand,
                    gatewayEntryMode: gatewayResult.entryMode,
                    gatewayHost: assignedIntegration.provider === 'CARDNET' && 'host' in gatewayResult
                      ? gatewayResult.host
                      : undefined,
                    gatewayCardProduct: assignedIntegration.provider === 'CARDNET' && 'productType' in gatewayResult
                      ? String(gatewayResult.productType || '')
                      : undefined,
                    gatewayReceiptMerchant: gatewayResult.receiptMerchant,
                    gatewayReceiptClient: gatewayResult.receiptClient,
                    gatewaySignatureData: 'signatureData' in gatewayResult ? gatewayResult.signatureData : undefined,
                    gatewayRequireSignature: 'requireSignature' in gatewayResult ? gatewayResult.requireSignature : false,
                    gatewayRawResponse: gatewayResult.rawResponse,
                  };
                }

                // Create Transaction
                const txn = await transactionService.createTransaction({
                  documentType: 'TICKET',
                  seriesId: seriesId,
                  date: new Date().toISOString(),
                  items: cart,
                  total: total,
                  payments: [{
                    id: `PAY-${Date.now()}`,
                    method: method.type,
                    methodId: method.id,
                    methodLabel: method.label,
                    methodIcon: method.iconName,
                    amount: total,
                    timestamp: new Date(),
                    currencyCode: baseCurrency,
                    currency: config.currencySymbol,
                    ...gatewayPaymentFields,
                  }],
                  userId: kioskOperator.id,
                  userName: kioskOperator.name,
                  terminalId: currentTerminal.id,
                  status: 'COMPLETED',
                  customerId: selectedCustomer?.id,
                  customerName: selectedCustomer?.name || 'Cliente General',
                  customerSnapshot: selectedCustomer ? {
                    name: selectedCustomer.name,
                    taxId: selectedCustomer.taxId,
                    address: selectedCustomer.address,
                    phone: selectedCustomer.phone,
                    email: selectedCustomer.email,
                  } : undefined,
                  taxAmount: tax,
                  netAmount: subtotal,
                  discountAmount: kioskTotals.discountAmount,
                  isTaxIncluded: kioskTotals.taxIncluded,
                  couponCode: kioskRedeemedCoupon?.code,
                  coupons: kioskRedeemedCoupon ? [{
                    id: kioskRedeemedCoupon.id,
                    code: kioskRedeemedCoupon.code,
                    campaignId: kioskRedeemedCoupon.campaignId,
                  }] : undefined,
                  walletPaymentAmount: isWalletPayment ? total : undefined,
                });

                if (kioskRedeemedCoupon) {
                  const finalTicketRef = txn.displayId || txn.id;
                  const configWithFinalCouponRef: BusinessConfig = {
                    ...config,
                    coupons: (config.coupons || []).map((coupon) =>
                      coupon.id === kioskRedeemedCoupon.id
                        ? {
                          ...coupon,
                          status: 'REDEEMED',
                          ticketRef: finalTicketRef,
                          terminalId: currentTerminal.id,
                          redeemedAt: coupon.redeemedAt || new Date().toISOString(),
                        }
                        : coupon
                    ),
                  };
                  setConfig(configWithFinalCouponRef);
                  await db.save('config', configWithFinalCouponRef);
                }

                if (isWalletPayment && selectedCustomer?.id) {
                  await transactionService.updateWalletBalance(
                    selectedCustomer.id,
                    -total,
                    'PAYMENT',
                    txn.displayId || txn.id
                  );
                  const nextWalletBalance = roundMoney(walletBalance - total);
                  const updatedCustomer: Customer = {
                    ...selectedCustomer,
                    wallet: selectedCustomer.wallet ? {
                      ...selectedCustomer.wallet,
                      balance: nextWalletBalance,
                      lastActivity: new Date().toISOString(),
                    } : selectedCustomer.wallet,
                    updatedAt: new Date().toISOString(),
                  };
                  setSelectedCustomer(updatedCustomer);
                  setCustomers(prev => prev.map(customer => customer.id === updatedCustomer.id ? updatedCustomer : customer));
                  await db.saveDocument('customers', updatedCustomer);
                }

                // Save and Sync
                await handleTransactionComplete(txn);
                return txn;
              } catch (error) {
                console.error("Error creating kiosk transaction:", error);
                throw new Error(error instanceof Error ? error.message : "Error al guardar la transacción. Por favor intente de nuevo.");
              }
            }}
            onPrintReceipt={async (transaction) => {
              if (!config) {
                throw new Error('No hay configuración disponible para imprimir.');
              }

              const printed = await printTicket(transaction, config);
              if (!printed) {
                throw new Error('La impresora no respondió. Verifica el módulo de hardware.');
              }
              return printed;
            }}
            onCancel={() => {
              clearSecurityState();
              recordCheckoutDiagnostic('CART_CLEAR_REQUEST', { items: cart, tableId: activeTable?.id, orderId: activeTable?.currentOrderId, reason: 'APP_CLEAR_03' });
              setCart([]);
              setSelectedCustomer(null);
              clearKioskCoupon();
              handleViewChange('KIOSK_WELCOME');
            }}
          />
        );

      // Price Checker View
      case 'CHECKER_SCAN':
        return <PriceCheckerDisplay products={products} />;

      // Handheld Inventory Views
      case 'INVENTORY_HOME':
        return (
          <InventoryHome
            onNavigate={handleViewChange}
            onSyncNow={async () => {
              await syncTriggerCoordinator.request({ reason: 'MANUAL' });
              await syncManager.syncTerminalManifestInBackground(undefined, { reason: 'manual_sync' });
              await syncManager.refreshTerminalResolvedConfig(undefined, {
                forceRemoteFetch: true,
                forceFullCatalog: false,
                masterScopes: ['suppliers', 'purchase_orders', 'transfers'],
                resolvedScopes: ['identity', 'terminal', 'device_role', 'role', 'inventory', 'documents'],
                supplementalMode: 'skip',
                dispatchEvent: true,
              });

              const [freshProducts, freshSuppliers, freshOrders, freshTransfers, freshWarehouses] = await Promise.all([
                db.get('products') as Promise<Product[]>,
                db.get('suppliers') as Promise<Supplier[]>,
                db.get('purchaseOrders') as Promise<PurchaseOrder[]>,
                db.get('transfers') as Promise<StockTransfer[]>,
                db.get('warehouses') as Promise<Warehouse[]>,
              ]);

              if (Array.isArray(freshProducts) && freshProducts.length > 0) setProducts(freshProducts);
              if (Array.isArray(freshSuppliers) && freshSuppliers.length > 0) setSuppliers(freshSuppliers);
              setPurchaseOrders(Array.isArray(freshOrders) ? freshOrders : []);
              setTransfers(Array.isArray(freshTransfers) ? freshTransfers : []);
              if (Array.isArray(freshWarehouses) && freshWarehouses.length > 0) setWarehouses(freshWarehouses);

              return {
                purchaseOrders: Array.isArray(freshOrders)
                  ? freshOrders.filter(order => order.status === 'ORDERED' || order.status === 'PARTIAL').length
                  : 0,
                transfers: Array.isArray(freshTransfers)
                  ? freshTransfers.filter(transfer => transfer.status === 'IN_TRANSIT').length
                  : 0,
              };
            }}
            userName={currentUser?.name}
            warehouses={warehouses}
          />
        );

      case 'INVENTORY_COUNT':
        return (
          <InventoryCount
            products={products}
            warehouseId={viewData?.warehouseId}
            warehouseName={viewData?.warehouseName}
            onCancel={() => handleViewChange('INVENTORY_HOME')}
            terminalId={getCurrentTerminal()?.id || 'T1'}
            userId={currentUser?.id || 'sys'}
            userName={currentUser?.name || 'System'}
          />
        );

      case 'INVENTORY_RECEPTION':
        return (
          <MobileReception
            products={products}
            suppliers={suppliers}
            purchaseOrders={purchaseOrders}
            transfers={transfers}
            warehouses={warehouses}
            config={config}
            currentUser={currentUser}
            terminalId={getCurrentTerminal()?.id || 'LOCAL'}
            onProcessed={async () => {
              const [freshProducts, freshOrders, freshTransfers, freshReceptions, freshStocks] = await Promise.all([
                db.get('products') as Promise<Product[]>,
                db.get('purchaseOrders') as Promise<PurchaseOrder[]>,
                db.get('transfers') as Promise<StockTransfer[]>,
                db.get('receptions') as Promise<Reception[]>,
                db.get('productStocks') as Promise<ProductStock[]>
              ]);

              if (Array.isArray(freshProducts) && freshProducts.length > 0) {
                setProducts(freshProducts);
              } else {
                console.warn('Inventory processed refresh skipped empty products; preserving current POS catalog.');
              }
              setPurchaseOrders(freshOrders || []);
              setTransfers(freshTransfers || []);
              setReceptions(freshReceptions || []);
              setProductStocks(freshStocks || []);

              backgroundSyncManager.triggerSync().catch(console.error);
            }}
            onCancel={() => handleViewChange('INVENTORY_HOME')}
          />
        );

      case 'INVENTORY_LABELS':
        return (
          <InventoryLabelsMobile
            products={products}
            config={config}
            terminalId={getCurrentTerminal()?.id || 'LOCAL'}
            onCancel={() => handleViewChange('INVENTORY_HOME')}
          />
        );

      case 'VISOR':
        return <CustomerVisor />;

      case 'KITCHEN_ORDERS':
        return <KitchenDisplay />;

      default:
        return <div className="h-screen flex items-center justify-center">Vista no implementada.</div>;
    }
  };


  // Render with appropriate layout based on device role
  const renderWithLayout = () => {
    // Escape hatch for activation flow
    if (currentView === 'ACTIVATION') {
      return renderView();
    }

    const role = getCurrentDeviceRole();
    const content = renderView();

    // Handle escape hatch for kiosk modes
    const handleEscapeHatch = async () => {
      const rawPin = await clicPrompt('Ingrese PIN de administrador:');
      if (!rawPin) return;

      const pin = rawPin.trim();
      if (authLevelService.validateEscapeHatch(pin)) {
        setIsAdminMode(true);
        setCurrentView('SETTINGS');
      } else {
        alert('PIN incorrecto');
      }
    };

    // Handle navigation for handheld
    const handleHandheldNavigate = (view: string, data?: any) => {
      const decision = terminalRouter.beforeNavigate(view, currentView);
      if (decision.allowed) {
        handleViewChange(view as ViewState, data);
      } else {
        alert(decision.message || 'Navegación no permitida');
      }
    };

    switch (role) {
      case DeviceRole.SELF_CHECKOUT:
        return (
          <SelfCheckoutLayout
            onEscapeHatch={handleEscapeHatch}
            onTimeout={() => {
              if (currentView !== 'KIOSK_WELCOME') {
                clearSecurityState();
                recordCheckoutDiagnostic('CART_CLEAR_REQUEST', { items: cart, tableId: activeTable?.id, orderId: activeTable?.currentOrderId, reason: 'APP_CLEAR_04' });
                setCart([]);
                setSelectedCustomer(null);
                clearKioskCoupon();
                setCurrentView('KIOSK_WELCOME');
              }
            }}
            timeoutMs={60000} // 60 seconds timeout
          >
            {content}
          </SelfCheckoutLayout>
        );

      case DeviceRole.PRICE_CHECKER:
        return (
          <PriceCheckerLayout onEscapeHatch={handleEscapeHatch}>
            {content}
          </PriceCheckerLayout>
        );

      case DeviceRole.HANDHELD_INVENTORY:
        return (
          <HandheldLayout
            onNavigate={handleHandheldNavigate}
            currentModule={currentView}
          >
            {content}
          </HandheldLayout>
        );

      case DeviceRole.KITCHEN_DISPLAY:
        return (
          <KitchenDisplayLayout onEscapeHatch={handleEscapeHatch}>
            {content}
          </KitchenDisplayLayout>
        );

      case DeviceRole.ORDER_TAKER:
      case DeviceRole.STANDARD_POS:
      default:
        return (
          <StandardPOSLayout>
            {content}
          </StandardPOSLayout>
        );
    }
  };

  if (!isDataLoaded) {
    if (initialConnError) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-red-50 text-red-900 p-8">
          <div className="text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold mb-2">Error de Inicialización</h1>
          <p className="text-lg bg-white p-4 rounded shadow border border-red-200">{initialConnError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-6 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 text-slate-900">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
          <p className="font-bold animate-pulse">Cargando CLIC POS...</p>
        </div>
      </div>
    );
  }

  // --- SECURITY BLOCKER ---
  if (!isSecurityLoaded) {
    if (bootstrapError) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-red-50 text-red-900 p-8">
          <div className="text-6xl mb-4">🔐</div>
          <h1 className="text-2xl font-bold mb-2">Error de Seguridad</h1>
          <p className="text-lg bg-white p-4 rounded shadow border border-red-200">{bootstrapError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-6 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 text-slate-900">
        <div className="w-16 h-16 border-4 border-slate-900 border-t-transparent rounded-full animate-spin mb-4"></div>
        <h2 className="text-xl font-bold animate-pulse">Cargando Seguridad...</h2>
        <p className="text-gray-500 mt-2">Sincronizando usuarios y permisos</p>
      </div>
    );
  }

  const allowsViewportScroll = currentView === 'SETTINGS' || currentView === 'TERMINAL_PAIRING' || currentView === 'LOGIN';
  const handleDownloadPosApkUpdate = () => {
    if (!posApkUpdate) return;
    void openPosApkDownloadUrl(posApkUpdate.release);
  };
  const handleRetryProductSyncDiagnostic = async () => {
    setCatalogDiagnosticStatus('SYNCING');
    try {
      const syncTarget = resolveSyncTarget();
      if (syncTarget.kind === 'POS_CLOUD_STAGING' && syncTarget.canPushMasters) {
        await syncManager.pushCatalog('products');
      } else if (syncTarget.canPullMasters) {
        await syncManager.pullCatalog('products', true);
      }
      const freshProducts = await db.get('products') as Product[];
      if (Array.isArray(freshProducts) && freshProducts.length > 0) {
        setProducts(freshProducts);
      } else {
        console.warn('Manual products sync returned empty catalog; preserving current POS catalog.');
      }
      setCatalogDiagnosticStatus('SYNCED');
      clearSyncErrorDiagnostic();
      setSyncDiagnostic(null);
    } catch (error) {
      setCatalogDiagnosticStatus('ERROR');
      reportSyncErrorDiagnostic({
        operation: 'PULL_MASTERS',
        collection: 'products',
        error,
      });
    }
  };

  const blockClientRestaurantOperations = (
    isClientTerminalMode()
    && clientMasterTablesStatus !== 'ONLINE'
    && (currentView === 'TABLE_MAP' || currentView === 'POS')
    && (config.vertical === 'RESTAURANT' || isRestaurantTerminal(getCurrentTerminal()))
  );

  return (
    <ErrorBoundary componentName="App Root">
      <>
        <AutomaticRecoveryDialog />
        {recoveryCloseScreen && currentUser && isSyncFeatureEnabled('pending_operations_recovery') && <RecoveryCloseDialog input={recoveryCloseScreen.input} onClose={() => setRecoveryCloseScreen(null)} onPublished={() => window.location.reload()} />}
        {recoverySequencePrompt && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/70 p-6">
            <div className="w-full max-w-xl rounded-3xl bg-white p-7 shadow-2xl">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">Recuperación de terminal</p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">Alinear secuencia fiscal</h2>
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
                Nuestra última factura en la nube fue {recoverySequencePrompt.last_display_id || recoverySequencePrompt.last_ncf || `#${recoverySequencePrompt.last_global_sequence || 0}`}.
                Revise el último recibo físico impreso e ingrese el último número usado en esta caja.
              </p>
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-700">
                <div>Terminal: {recoverySequencePrompt.terminalName || recoverySequencePrompt.terminalId}</div>
                <div>Última secuencia cloud: {recoverySequencePrompt.last_global_sequence ?? 0}</div>
                {recoverySequencePrompt.last_transaction_date && (
                  <div>Última fecha cloud: {recoverySequencePrompt.last_transaction_date}</div>
                )}
              </div>
              <label className="mt-5 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                Último número usado
              </label>
              <input
                type="number"
                min={recoverySequencePrompt.last_global_sequence ?? 0}
                value={recoverySequenceInput}
                onChange={(event) => setRecoverySequenceInput(event.target.value)}
                className="mt-2 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-4 text-2xl font-black text-slate-950 outline-none focus:border-blue-500"
              />
              <button
                onClick={handleConfirmRecoverySequence}
                className="mt-6 w-full rounded-2xl bg-blue-600 py-4 text-base font-black text-white shadow-xl shadow-blue-200 active:scale-[0.98]"
              >
                Confirmar y continuar
              </button>
            </div>
          </div>
        )}
        {renderReconnectionBanner()}
        {renderTerminalConfigRestartBanner()}
        {posApkUpdate && (
          <PosApkUpdateBanner
            update={posApkUpdate}
            onDownload={handleDownloadPosApkUpdate}
            onDismiss={() => setPosApkUpdate(null)}
          />
        )}
        {activeCartDraftRestorePrompt && cart.length === 0 && (
          <div className="fixed left-1/2 top-4 z-[100002] w-[min(92vw,560px)] -translate-x-1/2 rounded-3xl border border-amber-200 bg-white p-4 shadow-2xl shadow-slate-950/20">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                <Layout size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500">Recuperación automática</p>
                <h3 className="mt-1 text-base font-black text-slate-900">Hay una venta sin cerrar guardada localmente</h3>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {activeCartDraftRestorePrompt.items.length} artículo(s) · {new Date(activeCartDraftRestorePrompt.savedAt).toLocaleString()}
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const draft = activeCartDraftRestorePrompt;
                      setCart(draft.items);
                      if (draft.selectedCustomer?.id) {
                        setSelectedCustomer(customers.find(customer => customer.id === draft.selectedCustomer?.id) || null);
                      }
                      if (draft.activeTable) {
                        const restoredOrderId = draft.activeTable.currentOrderId || `AUTO-${Date.now()}`;
                        const restoredTable = {
                          ...draft.activeTable,
                          status: 'OCCUPIED' as const,
                          currentOrderId: restoredOrderId,
                          currentOrderTotal: draft.total,
                        };
                        const restoredTicket: ParkedTicket = {
                          id: restoredOrderId,
                          name: `Mesa: ${draft.activeTable.nombre || draft.activeTable.name || 'sin nombre'}`,
                          items: draft.items,
                          total: draft.total,
                          customerId: draft.selectedCustomer?.id,
                          customerName: draft.selectedCustomer?.name,
                          timestamp: draft.savedAt,
                          tableId: draft.activeTable.id,
                        };
                        const nextParkedTickets = [
                          ...parkedTickets.filter(ticket => ticket.id !== restoredTicket.id),
                          restoredTicket,
                        ];
                        writeCriticalCollectionsMirror(nextParkedTickets, cashMovements);
                        setParkedTickets(nextParkedTickets);
                        void db.save('parkedTickets', nextParkedTickets).catch(console.error);
                        setActiveTable(restoredTable);
                      }
                      setActiveCartDraftRestorePrompt(null);
                      setCurrentView('POS');
                    }}
                    className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-white shadow-lg active:scale-95"
                  >
                    Restaurar venta
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCartDraftRestorePrompt(null);
                      void clearActiveCartDraftStorage().catch(console.error);
                    }}
                    className="rounded-2xl border border-slate-200 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-slate-500 active:scale-95"
                  >
                    Descartar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        <SyncErrorDiagnosticModal
          diagnostic={
            isTerminalAuthorizationLossDiagnostic(syncDiagnostic)
              && terminalAuthorizationCheckState !== 'authorized'
              ? null
              : syncDiagnostic
          }
          onClose={() => {
            clearSyncErrorDiagnostic();
            setSyncDiagnostic(null);
          }}
          onRetryProducts={handleRetryProductSyncDiagnostic}
        />
        <div
          className={`fixed inset-0 w-full h-full bg-gray-50 flex flex-col font-sans select-none text-gray-900 ${allowsViewportScroll ? '' : 'overflow-hidden'}`}
          style={{
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
            overflowX: 'hidden',
            ...(allowsViewportScroll
              ? {
                  overflowY: 'scroll',
                  WebkitOverflowScrolling: 'touch'
                }
              : {})
          }}
        >
          <React.Suspense fallback={<RouteLoadingFallback />}>
            {renderWithLayout()}
          </React.Suspense>
        </div>
        {blockClientRestaurantOperations && (
          <div className="fixed inset-0 z-[100100] flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-2xl border border-amber-300/30 bg-slate-900 p-6 text-center text-white shadow-2xl">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
                <RefreshCw size={28} className={clientMasterTablesStatus === 'CHECKING' ? 'animate-spin' : ''} />
              </div>
              <h2 className="mt-4 text-xl font-black">
                {clientMasterTablesStatus === 'CHECKING' ? 'Conectando con la caja Master' : 'Caja Master no disponible'}
              </h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
                Las operaciones del restaurante están bloqueadas para evitar trabajar con salas, mesas o cuentas desactualizadas.
              </p>
              <button
                type="button"
                onClick={() => void retryClientMasterConnection()}
                disabled={clientMasterTablesStatus === 'CHECKING'}
                className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-amber-400 px-5 py-3 text-sm font-black text-slate-950 disabled:cursor-wait disabled:opacity-60"
              >
                <RefreshCw size={18} />
                Reintentar conexión
              </button>
            </div>
          </div>
        )}
        <GlobalVirtualKeyboard />
      </>
    </ErrorBoundary>
  );
};

export default App;
