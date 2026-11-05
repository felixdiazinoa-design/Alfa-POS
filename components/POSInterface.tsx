import { recordCheckoutDiagnostic, setCheckoutCaptureContext } from '../services/CheckoutDiagnostics';
import { MobilePosNavigation } from './MobilePosNavigation';
import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import {
   Search, Trash2, MoreVertical,
   CreditCard, User, Tag, Grid, Save,
   Settings, Users, History, Wallet,
   UserPlus, PlusCircle, X, Percent, ArrowLeft, ChevronLeft, ChevronRight,
   Scale as ScaleIcon, PauseCircle, LogOut, Minus, Plus, Edit3,
   ArrowRightLeft, Globe, DollarSign, Split,
   ChevronDown, Check, AlertCircle, Layers,
   ShoppingBag, ScanBarcode, ArrowRight, Clock, Camera, AlertTriangle, BrushCleaning,
   MessageSquare, PlayCircle, Download, Lock, ArrowUpRight, Landmark,
   UserCheck, StickyNote, Inbox, Printer, QrCode, Box, Package, MapPin,
   Cloud, RefreshCw, CloudOff, Layout, ChefHat, Building2, ClipboardCheck, Undo2, Coins,
   CheckCircle2


} from 'lucide-react';
import { Html5Qrcode } from "html5-qrcode";
import {
   BusinessConfig, User as UserType, RoleDefinition,
   DeviceRole, DeviceFormFactor, DeviceOrientation,
   Customer, Product, CartItem, Transaction, ParkedTicket, Warehouse, NCFType, FiscalDocumentCode,
   PaymentEntry, Table, Reservation, ZReport, Room, Permission, ProductPrice, RedeemedCouponRef, ProductVariant,
   OrderServiceType, CashMovement, LoyaltyRedemption
} from '../types';
import { hasProductPromotion } from '../utils/promotionEngine';
import { getDefaultFiscalProvider, getEffectiveFiscalComplianceConfig, getFiscalReserveAlert, isTerminalFiscalReceiptRequired, mapElectronicFiscalCodeToLegacy, resolveCreditNoteFiscalCode, resolveSaleFiscalCode } from '../utils/fiscal/fiscalHelpers';
import { calculateTransactionTaxSummary } from '../utils/taxSummary';
import { getTierBadgeClass, getTierLabel, isEgoClubEnabled } from '../utils/egoClub';
import UnifiedPaymentModal from './PaymentModal';
import {
   evaluateCreditSupervisorGate,
   paymentEntryIsCxCCredit,
   sumCreditPaymentsBase
} from '../utils/creditRules';
import TicketOptionsModal from './TicketOptionsModal';
import CartItemOptionsModal from './CartItemOptionsModal';
import { preserveCartItemCommercialFields, resolveCartItemEditCapabilities } from '../utils/cartItemEditPermissions';
import ProductVariantSelector from './ProductVariantSelector';
import { resolveVariantSalesPrice } from '../utils/variantSalesPrice';
import ScaleModal from './ScaleModal';
import GlobalDiscountModal from './GlobalDiscountModal';
import LoyaltyScanModal from './LoyaltyScanModal';
import LoyaltyRedeemModal from './LoyaltyRedeemModal';
import { buildRedemptionId, getLoyaltyChannelStatus } from '../services/loyalty/LoyaltyService';
import TrackingSelectionModal from './TrackingSelectionModal';
import { db } from '../utils/db';
import { validateTerminalDocument } from '../utils/validation';
import { isSessionExpired } from '../utils/session';
import { FiscalRangeDGII } from '../types';
import { parseScaleBarcode } from '../utils/barcodeParser';
import { focusSalesScannerInput } from '../utils/globalBarcodeCapture';
import { transactionService } from '../services/transactionService';
import { resolveTerminalDocumentSeriesId, validateTerminalSeries } from '../utils/seriesValidation';
import { applyPromotions } from '../utils/promotionEngine';
import { calculatePointsEarned, getPrimaryLoyaltyCard } from '../utils/loyaltyEngine';
import { couponService } from '../utils/couponService';
import { resolveScannedCouponCode } from '../utils/couponScan';
import { calculateInventoryDeductions, resolveInventoryConsumptionMode, transferStockToCommitted } from '../utils/inventoryEngine';
import { useSupervisorAuth } from '../hooks/useSupervisorAuth';
import { calculateSalesCommission } from '../utils/userSalesPolicy';
import SupervisorModal from './SupervisorModal';
import { useIsMobile } from '../hooks/useIsMobile';
import { useBottomSafeOffset } from '../hooks/useBottomSafeOffset';
import MobileConfigModal from './MobileConfigModal';
import ReturnModal from './ReturnModal';
import PromoBottomSheet from './PromoBottomSheet';
import { backgroundSyncManager, SyncState } from '../services/sync/BackgroundSyncManager';
import { syncManager } from '../services/sync/SyncManager';
import { isSyncFeatureEnabled } from '../services/sync/SyncFeatureFlags';
import { requestJson } from '../services/network/httpClient';
import ProductTableSupermarket from './ProductTableSupermarket';
import SupermarketTicketSummary from './SupermarketTicketSummary';
import BarcodeScannerModal from './BarcodeScannerModal';
import { printCashMovementReceipt, printComanda, printPrecuenta } from '../utils/printer';
import { canStepCartQuantity, isValidCartQuantity, isValidCartQuantityTransition } from '../utils/cartQuantity';
import ModifierModal from './ModifierModal';
import { productHasRestaurantConfiguration, resolveRestaurantProductConfig } from '../utils/restaurantProductConfig';
import { shouldBlockTableMapForDirectSale } from '../utils/restaurantNavigation';
import { visorSync } from '../utils/visorSync';
import { isCustomerDisplaySurface, maybeAutoLaunchCustomerDisplay } from '../utils/customerDisplay';
import ProductQuickActions from './ProductQuickActions';
import ActionGrid from './ActionGrid';
import SupervisorAuthModal from './SupervisorAuthModal';
import VirtualKeyboard from './VirtualKeyboard';
import NumericKeypad from './NumericKeypad';
import SafetyGateModal from './SafetyGateModal';
import { printReservation } from '../utils/printer';
import MobileCartButton from './MobileCartButton';
import {
   beginPosInteraction,
   expectInteractionRender,
   getLatestPosInteraction,
   markInteractionStage,
   markInteractionStateUpdate,
   markRenderEnd,
   markRenderStart,
   measureInteractionStage,
   PosInteractionTrace,
} from '../utils/interactionPerformance';
import {
   calculateTaxBreakdownFromItems,
   consolidateTaxBreakdownForDisplay,
   formatTaxLineLabel,
   freezeAuthoritativeLineFiscalAmounts,
   resolveEffectiveTaxIds,
} from '../utils/fiscalBreakdown';
import { formatCurrency } from '../utils/format';
import { persistStandaloneRefundTransaction, persistStandaloneSaleHistory } from '../services/localRefundPersistence';
import { resolveCustomerImageSrc, resolveProductImageSrc } from '../utils/entityImage';
import { getWarehouseScopedNumber, resolveProductActiveWarehouseIds } from '../utils/masterIdentity';
import { buildTransactionSettlementFields } from '../utils/paymentSettlement';
import { isPaymentFractionPlanCurrent, retainCurrentPaymentFractionPlan } from '../utils/paymentFractions';
import SplitTicketModal from './SplitTicketModal';
import { getTerminalSnapshotSellers, resolveTerminalSellerName } from '../utils/terminalSnapshotSellers';
import { productIdentityCandidates, productReferenceCandidates, resolveOperationalProductId } from '../utils/productReferences';
import { resolveKdsBaseUrl } from '../utils/kdsRouting';
import {
   confirmUberEatsPosInvoice,
   fetchUberEatsOrderDraft,
   fetchUberEatsPendingOrders,
   resolveUberEatsPosContext,
   type UberEatsPendingOrder,
   type UberEatsPosDraft,
} from '../services/uberEatsPosService';
import {
   consignmentSyncService,
   type ErpConsignment,
   type ErpConsignmentLine,
} from '../services/sync/ConsignmentSyncService';
import { resolveDeviceRoleValue } from '../utils/deviceRoleHelpers';
import { resolveTerminalDeviceProfile } from '../utils/deviceProfile';
import { shouldApplyRestaurantServiceCharge } from '../utils/orderServiceType';
import OrderServiceTypeDialog from './OrderServiceTypeDialog';
import OrderServiceTypeButton from './OrderServiceTypeButton';
import { resolveAppliedServiceTaxPolicy } from '../utils/serviceTaxPolicy';
import { normalizeProductionOutputMode, resolveProductionOutputTargets } from '../utils/productionOutputMode';
import { isClientTerminalMode, resolveOperationalApiUrl } from '../utils/masterOperationalApi';
import ProductionRoutingAssignmentModal, {
   type ProductionRoutingPromptArea,
   type ProductionRoutingPromptItem,
} from './ProductionRoutingAssignmentModal';
import {
   applyProductionAreaAssignments,
   selectProductionRoutingStrategy,
   shouldRefreshClientProductionRouting,
} from '../utils/productionRoutingAssignment';
import {
   comparePosProducts,
   readableTextColor,
   resolveClassificationActive,
   resolveClassificationColor,
   resolveClassificationSortOrder,
} from '../utils/posCatalogPresentation';
import { resolvePosCategoryGridPosition } from '../utils/posCategoryGrid';
import { resolvePosTableHeaderLabel } from '../utils/posTableHeader';
import {
   detectCameraAvailability,
   shouldUseDesktopSearchClearAction,
   type CameraAvailability,
} from '../utils/cameraCapability';
import {
   canReverseRestaurantDraftWithoutApproval,
   hasKitchenDispatchEvidence,
   markRestaurantLinesCommitted,
   requiresRestaurantReductionApproval,
} from '../utils/restaurantHotReversal';

// ... existing imports

const clearCartSubtotalization = (items: CartItem[]): CartItem[] => items.map(item => {
   const nextItem = { ...item };
   delete nextItem.subtotalizedAt;
   delete nextItem.subtotalizedBy;
   return nextItem;
});

export interface POSInterfaceProps {
   config: BusinessConfig;
   currentUser: UserType;
   roles: RoleDefinition[];
   users: UserType[];
   customers: Customer[];
   products: Product[];
   onUpdateProducts: (products: Product[]) => void;
   /** Actualiza la colección de clientes (p. ej. saldo de puntos tras un canje). */
   onUpdateCustomers?: (updater: (customers: Customer[]) => Customer[]) => void;
   warehouses: Warehouse[];
   cart: CartItem[];
   transactions: Transaction[];
   zReports: ZReport[];
   onUpdateCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
   selectedCustomer: Customer | null;
   onSelectCustomer: (customer: Customer | null) => void;
   parkedTickets: ParkedTicket[];
   onUpdateParkedTickets: (
      tickets: ParkedTicket[],
      options?: {
         deferRemote?: boolean;
         reason?: 'cart_changed' | 'debounced' | 'explicit' | 'customer_assigned';
         changedTicketId?: string;
      },
   ) => void | Promise<void>;
   onTableOrderSaved?: (table: Table, ticket: ParkedTicket) => void | Promise<void>;
   onSelectTableAccount?: (ticket: ParkedTicket) => void | Promise<void>;
   onTableOrderClosed?: (table: Table, closedOrderId?: string, remainingTickets?: ParkedTicket[]) => void | Promise<void>;
   onLogout: () => void;
   onExitApplication?: () => void;
   onOpenSettings: (initialView?: string, initialData?: any) => void;
   onOpenAttendance: () => void;
   onOpenCustomers: () => void;
   onOpenHistory: () => void;
   onOpenFinance: (initialCashMovementType?: 'IN' | 'OUT' | 'X_REPORT') => void;
   onRegisterCashMovement?: (type: 'IN' | 'OUT', amount: number, reason: string) => CashMovement | void | Promise<CashMovement | void>;
   onOpenZReport?: () => void;
   onOpenInventoryTracking: (productId?: string) => void;
   onOpenAudit?: () => void;
   onOpenTableMap?: () => void | Promise<void>;
   onOpenAgenda?: () => void;
   onTransactionComplete: (txn: Transaction) => void | Promise<void>;
   onAddCustomer: (customer: Customer) => void;
   onUpdateConfig: (newConfig: BusinessConfig) => void;
   activeTerminalId: string;
   activeTable?: Table | null;
   onClearActiveTable?: () => void;
   onUpdateActiveTableGuests?: (guests: number) => void;
   onKioskPay?: () => void;
   internalSequences?: any[];
   rooms?: Room[];
   productPrices?: ProductPrice[];
}

type ProductionAreaConfig = {
   id: string;
   name?: string;
   nombre?: string;
   modo_salida?: 'KDS' | 'PRINTER' | 'AMBOS' | string;
   target_terminal_id?: string;
   target_terminal_name?: string;
   kds_host?: string;
   kds_port?: string | number;
   kds_warning_minutes?: number | string;
   kds_critical_minutes?: number | string;
   printer_id?: string;
   printerId?: string;
   printer_ip?: string;
};

type KdsDispatchMeta = {
   areaId: string;
   orderId: string;
   itemIds: string[];
};

type ProductionRoutingPromptDecision =
   | { kind: 'ASSIGN'; assignments: Record<string, string> }
   | { kind: 'SKIP' }
   | { kind: 'CANCEL' };

type ProductionRoutingPromptState = {
   items: ProductionRoutingPromptItem[];
   areas: ProductionRoutingPromptArea[];
};

type ProductionDispatchOutcome = 'DISPATCHED' | 'CONTINUE_WITHOUT_DISPATCH' | 'CANCELLED';

const buildModifierSignature = (modifiers?: unknown[]): string => {
   if (!Array.isArray(modifiers) || modifiers.length === 0) return '';
   return modifiers.map((modifier) => String(modifier ?? '')).sort().join('|');
};

const looksLikeDocumentScan = (code: string): boolean =>
   /^(TCK|INV|B0[1-4]|E3[1245]|NC|ZS|ZR|REC|TXN-)/i.test(code.trim());

const normalizeBooleanSetting = (value: unknown): boolean | undefined => {
   if (typeof value === 'boolean') return value;
   if (typeof value === 'number') return value === 1;
   if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'si', 'sí', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false;
   }
   return undefined;
};

const resolveConsignmentDownloadEnabled = (config: Record<string, unknown> | null | undefined): boolean => {
   const operational = config || {};
   return Boolean(
      normalizeBooleanSetting(operational.recibir_consignaciones) ??
      normalizeBooleanSetting(operational.receiveConsignments) ??
      normalizeBooleanSetting(operational.receive_consignments) ??
      normalizeBooleanSetting(operational.descargar_consignaciones) ??
      normalizeBooleanSetting(operational.descargarConsignaciones) ??
      normalizeBooleanSetting(operational.downloadConsignments) ??
      normalizeBooleanSetting(operational.enableConsignments) ??
      false
   );
};

const normalizeViewMode = (value: unknown): string => {
   const normalized = String(value || '').trim().toUpperCase().replace(/[\s_-]+/g, '_');
   if (!normalized) return '';
   if (normalized === 'POS' || normalized === 'STANDARD') return 'RETAIL';
   if (normalized === 'RETAIL_MODE') return 'RETAIL';
   return normalized;
};

const isRetailViewMode = (value: unknown): boolean => normalizeViewMode(value) === 'RETAIL';

const postJsonWithTimeout = async (url: string, payload: unknown, timeoutMs = 5000) => {
   const response = await requestJson<any>({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs,
      diagnosticContext: { operation: 'KDS_POST' },
   });
   const data = response.data;
   if (!response.ok) {
      throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
   }
   return data;
};

const getConsignmentDocumentNo = (consignment: ErpConsignment): string =>
   String(consignment.documentNo || consignment.document_no || consignment.documentNumber || consignment.document_number || consignment.number || consignment.code || consignment.id || '').trim();

const getConsignmentCustomerName = (consignment: ErpConsignment): string => {
   const source = consignment as Record<string, any>;
   const customer = source.customer || source.client || source.account || source.third_party || source.thirdParty;
   return String(
      consignment.customerName
      || consignment.customer_name
      || source.clientName
      || source.client_name
      || source.customer_full_name
      || source.customerFullName
      || source.customer_display_name
      || source.customerDisplayName
      || source.partyName
      || source.party_name
      || customer?.name
      || customer?.fullName
      || customer?.full_name
      || customer?.displayName
      || customer?.display_name
      || ''
   ).trim();
};

const getConsignmentLines = (consignment: ErpConsignment): ErpConsignmentLine[] => {
   const source = consignment as Record<string, any>;
   const lines = Array.isArray(consignment.lines) ? consignment.lines
      : Array.isArray(consignment.items) ? consignment.items
      : Array.isArray(source.details) ? source.details
      : Array.isArray(source.lines_detail) ? source.lines_detail
      : Array.isArray(source.line_items) ? source.line_items
      : Array.isArray(source.lineItems) ? source.lineItems
      : Array.isArray(source.consignment_lines) ? source.consignment_lines
      : Array.isArray(source.consignmentLines) ? source.consignmentLines
      : Array.isArray(source.document_lines) ? source.document_lines
      : Array.isArray(source.documentLines) ? source.documentLines
      : Array.isArray(source.products) ? source.products
      : Array.isArray(source.articles) ? source.articles
      : [];
   return Array.isArray(lines) ? lines : [];
};

const getConsignmentLineProductName = (line: ErpConsignmentLine): string =>
   String(line.name || line.description || (line as any).productName || (line as any).product_name || (line as any).itemName || (line as any).item_name || (line as any).product?.name || (line as any).item?.name || line.sku || line.productId || line.product_id || line.id || 'Artículo').trim();

const getConsignmentLineQuantity = (line: ErpConsignmentLine): number => {
   const source = line as Record<string, unknown>;
   const candidates = [
      source.quantity_open,
      source.quantityOpen,
      source.availableQuantity,
      source.available_quantity,
      source.open_quantity,
      source.openQuantity,
      source.qty_open,
      source.qtyOpen,
      source.quantity_total,
      source.quantityTotal,
      line.quantity,
      line.qty,
   ];

   for (const candidate of candidates) {
      const quantity = Number(candidate);
      if (Number.isFinite(quantity) && quantity > 0) return quantity;
   }

   return 1;
};

const getConsignmentLinePrice = (line: ErpConsignmentLine, fallbackPrice: number): number => {
   const value = Number(line.unitPrice ?? line.unit_price ?? (line as any).salePrice ?? (line as any).sale_price ?? (line as any).price_unit ?? line.price ?? fallbackPrice);
   return Number.isFinite(value) && value >= 0 ? value : fallbackPrice;
};

const getConsignmentTicketFields = (items: CartItem[]): Pick<Transaction, 'consignmentId' | 'consignmentDocumentNo' | 'consignmentLineId'> => {
   const item = items.find(line => line.consignmentId && line.consignmentLineId);
   return {
      consignmentId: item?.consignmentId,
      consignmentDocumentNo: item?.consignmentDocumentNo,
      consignmentLineId: item?.consignmentLineId,
   };
};

const readConsignmentSyncKeys = (): Set<string> => {
   try {
      return new Set(JSON.parse(localStorage.getItem('clic_consignment_sync_keys_v1') || '[]'));
   } catch {
      return new Set();
   }
};

const saveConsignmentSyncKeys = (keys: Set<string>): void => {
   try {
      localStorage.setItem('clic_consignment_sync_keys_v1', JSON.stringify(Array.from(keys).slice(-500)));
   } catch {
      // Local idempotency cache is best-effort; ERP still receives idempotencyKey.
   }
};

const resolveProductionAreaId = (item: any): string => {
   const restaurantConfig = resolveRestaurantProductConfig(item);
   const direct =
      item?.production_area_id
      || item?.productionAreaId
      || item?.productionAreaID
      || item?.productionArea
      || item?.restaurantConfig?.production_area_id
      || restaurantConfig.production_area_id
      || item?.metadata?.production_area_id
      || item?.metadata?.productionAreaId;
   return String(direct || '').trim();
};

const normalizeKdsIdentity = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const collectKdsProductKeys = (item: any): string[] => {
   const keys = [
      item?.id,
      item?.productId,
      item?.product_id,
      item?.producto_id,
      item?.sourceProductId,
      item?.erpProductId,
      item?.operationalProductId,
      item?.sku,
      item?.code,
      item?.barcode,
      item?.variantSku,
      item?.metadata?.productId,
      item?.metadata?.sourceProductId,
      item?.metadata?.erpProductId,
   ];

   return Array.from(new Set(keys.map(normalizeKdsIdentity).filter(Boolean)));
};

const collectProductionAreaAssignedProductKeys = (area: ProductionAreaConfig): string[] => {
   const source = area as any;
   const rawLists = [
      source.productIds,
      source.product_ids,
      source.assignedProductIds,
      source.assigned_product_ids,
      source.products,
      source.items,
   ].filter(Boolean);
   const keys: string[] = [];

   rawLists.forEach((rawList) => {
      const list = Array.isArray(rawList) ? rawList : [rawList];
      list.forEach((entry) => {
         if (entry && typeof entry === 'object') {
            keys.push(...collectKdsProductKeys(entry));
            return;
         }
         const normalized = normalizeKdsIdentity(entry);
         if (normalized) keys.push(normalized);
      });
   });

   return Array.from(new Set(keys));
};

const buildProductionAreaResolver = (productionAreas: ProductionAreaConfig[], products: Product[]) => {
   const areaById = new Map(productionAreas.map(area => [String(area.id), area]));
   const productKeyToAreaId = new Map<string, string>();

   const assignKeysToArea = (keys: string[], areaId?: string) => {
      const normalizedAreaId = String(areaId || '').trim();
      if (!normalizedAreaId || !areaById.has(normalizedAreaId)) return;
      keys.forEach((key) => {
         if (!key || productKeyToAreaId.has(key)) return;
         productKeyToAreaId.set(key, normalizedAreaId);
      });
   };

   products.forEach((product) => {
      assignKeysToArea(collectKdsProductKeys(product), resolveProductionAreaId(product));
   });

   productionAreas.forEach((area) => {
      assignKeysToArea(collectProductionAreaAssignedProductKeys(area), area.id);
   });

   return (item: any): string => {
      const directAreaId = resolveProductionAreaId(item);
      if (directAreaId && areaById.has(directAreaId)) return directAreaId;

      const mappedAreaId = collectKdsProductKeys(item)
         .map((key) => productKeyToAreaId.get(key))
         .find((areaId): areaId is string => Boolean(areaId && areaById.has(areaId)));
      return mappedAreaId || directAreaId;
   };
};

const getCartDispatchKey = (item: CartItem): string => item.cartId || `${item.id}:${item.name}`;

const buildKdsItemIds = (orderId: string, areaId: string, item: CartItem, index: number): string[] => {
   const rawId = item.cartId || `${item.id}-${index}`;
   const nativeItemId = String(rawId).startsWith(orderId) ? String(rawId) : `${orderId}_${rawId}_${index}`;
   const serverItemId = `${orderId}_${areaId}_${rawId}_${index}`;
   return Array.from(new Set([serverItemId, nativeItemId]));
};

const isKdsReturnedCartItem = (item?: Partial<CartItem> | null): boolean => {
   const status = String((item as any)?.kdsStatus || '').trim().toUpperCase();
   return status === 'DEVUELTO' || Boolean((item as any)?.kdsReturnedAt);
};

const isKdsPendingCartItem = (item?: Partial<CartItem> | null): boolean => {
   const status = String((item as any)?.kdsStatus || '').trim().toUpperCase();
   return status === 'PENDIENTE' || status === 'PENDING' || status === 'RETRY_PENDING';
};

const isKitchenDispatchedCartItem = (item?: Partial<CartItem> | null): boolean => {
   return hasKitchenDispatchEvidence(item);
};

const buildKdsDispatchItems = (items: CartItem[], areaId?: string) => items.map((item, index) => ({
   id: item.cartId || `${item.id}-${index}`,
   producto_id: item.id,
   productId: item.id,
   sku: (item as any).sku || (item as any).code || '',
   name: item.name,
   nombre: item.name,
   quantity: Number(item.quantity || 0),
   cantidad: Number(item.quantity || 0),
   modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
   modificadores: Array.isArray(item.modifiers) ? item.modifiers : [],
   note: item.note || '',
   production_area_id: areaId || resolveProductionAreaId(item),
   estado_cocina: 'PENDIENTE',
   variantInfo: item.variantInfo || '',
}));

const normalizeKdsMinutes = (value: unknown, fallback: number): number => {
   const parsed = Number(value);
   if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
   return Math.max(1, Math.floor(parsed));
};

const queuePendingKdsDispatch = async (payload: Record<string, unknown>) => {
   try {
      const existing = await db.get('kdsDispatchQueue' as any).catch(() => []) as any;
      const queue = Array.isArray(existing) ? existing : [];
      const payloadRecord = (payload?.payload || {}) as Record<string, any>;
      const orderId = String(payloadRecord.orderId || payload.orderId || '').trim();
      const areaId = String(payload.areaId || payloadRecord.area?.id || '').trim();
      const cartIds = Array.isArray(payload.cartIds)
         ? payload.cartIds.map((id) => String(id)).filter(Boolean)
         : [];
      const duplicateIndex = queue.findIndex((entry: any) => {
         if (entry?.status === 'SENT') return false;
         const entryPayload = entry?.payload || {};
         const sameOrder = String(entryPayload.orderId || entry.orderId || '').trim() === orderId;
         const sameArea = String(entry.areaId || entryPayload.area?.id || '').trim() === areaId;
         const entryCartIds = Array.isArray(entry.cartIds) ? entry.cartIds.map((id: unknown) => String(id)).filter(Boolean) : [];
         const sameItems = cartIds.length > 0 && entryCartIds.length === cartIds.length && cartIds.every((id) => entryCartIds.includes(id));
         return sameOrder && sameArea && (sameItems || cartIds.length === 0);
      });
      const nextEntry = {
         id: duplicateIndex >= 0 ? queue[duplicateIndex].id : `kdsq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
         status: 'PENDING',
         attempts: duplicateIndex >= 0 ? Number(queue[duplicateIndex].attempts || 0) : 0,
         createdAt: duplicateIndex >= 0 ? queue[duplicateIndex].createdAt : new Date().toISOString(),
         updatedAt: new Date().toISOString(),
         ...payload,
      };
      const nextQueue = duplicateIndex >= 0
         ? queue.map((entry: any, index: number) => index === duplicateIndex ? nextEntry : entry)
         : [...queue, nextEntry];
      await db.save('kdsDispatchQueue' as any, [
         ...nextQueue,
      ]);
   } catch (error) {
      console.warn('No se pudo guardar la comanda KDS pendiente:', error);
   }
};

const productSalesIdentityKey = (product: Product): string => {
   const operationalId = resolveOperationalProductId(product);
   if (operationalId) return `op:${operationalId}`;

   const normalizedId = String(product.id || '').trim().toLowerCase();
   const identityCandidate = productIdentityCandidates(product)
      .map((value) => String(value || '').trim().toLowerCase())
      .find((value) => value && value !== normalizedId);
   if (identityCandidate) return `identity:${identityCandidate}`;

   const barcode = typeof product.barcode === 'string' ? product.barcode.trim().toLowerCase() : '';
   if (barcode) return `barcode:${barcode}`;

   const sku = typeof (product as any).sku === 'string' ? (product as any).sku.trim().toLowerCase() : '';
   if (sku) return `sku:${sku}`;

   const code = typeof (product as any).code === 'string' ? (product as any).code.trim().toLowerCase() : '';
   if (code) return `code:${code}`;

   const name = typeof product.name === 'string' ? product.name.trim().toLowerCase() : '';
   const category = typeof product.category === 'string' ? product.category.trim().toLowerCase() : '';
   if (name) return `namecat:${name}::${category}`;

   return `id:${String(product.id || '').trim().toLowerCase()}`;
};

const productLineIdentityKey = (product: Product, price: number): string =>
   `${productSalesIdentityKey(product)}::${Number(price || 0).toFixed(6)}`;

const isSeedCatalogProduct = (product: Product): boolean => {
   const id = String(product.id || '').trim().toLowerCase();
   return /^prod-\d+$/.test(id) || /^p\d+$/.test(id) || /^f\d+$/.test(id);
};

const productBusinessKeys = (product: Product): string[] => {
   const keys = new Set<string>();
   const addKey = (prefix: string, value: unknown) => {
      const normalized = normalizeSearchToken(value);
      if (normalized) keys.add(`${prefix}:${normalized}`);
   };

   addKey('barcode', product.barcode);
   addKey('barcode', (product as any).barcode_2);
   addKey('barcode', (product as any).barcode2);
   addKey('barcode', (product as any).barcode_3);
   addKey('barcode', (product as any).barcode3);

   if (Array.isArray((product as any).barcodes)) {
      for (const barcodeEntry of (product as any).barcodes) {
         if (barcodeEntry && typeof barcodeEntry === 'object' && !Array.isArray(barcodeEntry)) {
            addKey('barcode', (barcodeEntry as any).barcode);
            addKey('barcode', (barcodeEntry as any).code);
            addKey('barcode', (barcodeEntry as any).value);
         } else {
            addKey('barcode', barcodeEntry);
         }
      }
   }

   const sku = typeof (product as any).sku === 'string' ? (product as any).sku.trim().toLowerCase() : '';
   const code = typeof (product as any).code === 'string' ? (product as any).code.trim().toLowerCase() : '';
   const itemCode = typeof (product as any).item_code === 'string' ? (product as any).item_code.trim().toLowerCase() : '';
   const name = typeof product.name === 'string' ? product.name.trim().toLowerCase() : '';
   const category = typeof product.category === 'string' ? product.category.trim().toLowerCase() : '';

   if (sku) keys.add(`sku:${sku}`);
   if (code) keys.add(`code:${code}`);
   if (itemCode) keys.add(`item_code:${itemCode}`);
   if (name) keys.add(`namecat:${name}::${category}`);
   addKey('description', (product as any).description);
   addKey('description', (product as any).descripcion);
   addKey('reference', (product as any).reference);
   addKey('reference', (product as any).referencia);
   addKey('reference', (product as any).external_reference);

   return Array.from(keys);
};

const productSalesIdentityKeys = (product: Product): string[] => {
   const keys = new Set<string>();
   const addKey = (prefix: string, value: unknown) => {
      const normalized = normalizeSearchToken(value);
      if (normalized) keys.add(`${prefix}:${normalized}`);
   };

   productBusinessKeys(product).forEach((key) => keys.add(key));
   productReferenceCandidates(product).forEach((value) => addKey('reference', value));
   productIdentityCandidates(product).forEach((value) => addKey('identity', value));
   addKey('operational', resolveOperationalProductId(product));
   addKey('id', product.id);

   if (keys.size === 0) {
      keys.add(productSalesIdentityKey(product));
   }

   return Array.from(keys);
};

const scoreProductForSales = (product: Product, warehouses: Warehouse[]): number => {
   const activeWarehouses = resolveProductActiveWarehouseIds(product, warehouses).length;
   const stockBalanceCount = Object.keys(product.stockBalances || {}).length;
   const updatedAtScore = new Date((product as any).updatedAt || (product as any).createdAt || 0).getTime() || 0;
   const seedPenalty = isSeedCatalogProduct(product) ? -50_000 : 0;

   return (
      seedPenalty +
      activeWarehouses * 1000 +
      stockBalanceCount * 100 +
      (product.is_sellable !== false ? 10 : 0) +
      (Number.isFinite(Number(product.price)) ? 1 : 0) +
      updatedAtScore / 1_000_000_000_000
   );
};

const buildCartDigest = (items: CartItem[] = []): string =>
   items
      .map((item) =>
         [
            item.cartId || item.id || '',
            Number(item.quantity || 0),
            Number(item.price || 0),
            (item.modifiers || []).join('|'),
            item.orderNumber || '',
            item.tableDisplayLabel || ''
         ].join(':')
      )
      .join('||');

const extractFirstNumberToken = (value?: unknown): string => {
   const match = String(value || '').match(/\d+/);
   return match ? match[0] : '';
};

const formatCompactLocationNumber = (value: string): string =>
   value.replace(/^\d+$/, token => token.padStart(2, '0'));

const buildTableContextLabels = (table?: Partial<Table> | null, rooms: Room[] = []) => {
   const tableName = String(table?.nombre || table?.name || '').trim();
   if (!tableName) {
      return {
         tableLabel: '',
         roomLabel: '',
         compactLabel: ''
      };
   }

   const room = table?.roomId
      ? rooms.find(candidate => String(candidate.id) === String(table.roomId))
      : undefined;
   const roomLabel = String(room?.nombre || room?.name || '').trim();
   const roomNumber = extractFirstNumberToken(roomLabel);
   const tableNumber = extractFirstNumberToken(tableName);
   const compactLabel = roomNumber && tableNumber
      ? `${formatCompactLocationNumber(roomNumber)}-${formatCompactLocationNumber(tableNumber)}`
      : roomLabel
         ? `${roomLabel} - ${tableName}`
         : tableName;

   return {
      tableLabel: tableName,
      roomLabel,
      compactLabel
   };
};

const readCartOrderNumber = (items: CartItem[] = []): string | undefined =>
   items
      .map(item => String(item.orderNumber || '').trim())
      .find(Boolean);

const normalizeOrderNumberSettings = (settings: any) => {
   const nextNumber = Math.max(1, Math.floor(Number(settings?.nextNumber || 1)));
   const padding = Math.max(0, Math.min(10, Math.floor(Number(settings?.padding ?? 3))));
   return {
      enabled: Boolean(settings?.enabled),
      nextNumber,
      prefix: String(settings?.prefix || '').trim(),
      padding,
   };
};

const formatOrderNumber = (settings: ReturnType<typeof normalizeOrderNumberSettings>): string => {
   const numeric = String(settings.nextNumber).padStart(settings.padding, '0');
   return `${settings.prefix}${numeric}`;
};

const PRODUCT_GRAPHIC_TONES = [
   { backgroundColor: '#dbeafe', borderColor: '#bfdbfe', color: '#1e3a8a' },
   { backgroundColor: '#d1fae5', borderColor: '#a7f3d0', color: '#064e3b' },
   { backgroundColor: '#ffe4e6', borderColor: '#fecdd3', color: '#881337' },
   { backgroundColor: '#ffedd5', borderColor: '#fed7aa', color: '#7c2d12' },
   { backgroundColor: '#cffafe', borderColor: '#a5f3fc', color: '#164e63' },
   { backgroundColor: '#fef3c7', borderColor: '#fde68a', color: '#78350f' },
];

const resolveProductGraphicTone = (product: Product): React.CSSProperties => {
   const seed = String(product.category || product.name || product.id || '');
   const index = Array.from(seed).reduce((total, character) => total + character.charCodeAt(0), 0) % PRODUCT_GRAPHIC_TONES.length;
   return PRODUCT_GRAPHIC_TONES[index];
};

interface ProductGridCardProps {
   product: Product;
   usesSupermarketLayout: boolean;
   usesExpandedCatalog: boolean;
   isMobile: boolean;
   showProductImages: boolean;
   baseCurrencySymbol: string;
   isProductWarehouseBlockedForSale: (product: Product) => boolean;
   getTerminalWarehouseName: () => string;
   getProductPrice: (product: Product) => number;
   isProductOutOfStock: (product: Product) => boolean;
   hasPromotionForProduct: (product: Product) => boolean;
   onProductClick: (product: Product) => void;
   onOpenPromotion: (product: Product) => void;
   onProductTouchStart: (product: Product, clientX: number, clientY: number) => void;
   onProductTouchMove: (clientX: number, clientY: number) => void;
   onProductTouchEnd: () => void;
   onProductContextMenu: (product: Product, event: React.MouseEvent<HTMLDivElement>) => void;
}

const ProductGridCard = React.memo(({
   product,
   usesSupermarketLayout,
   usesExpandedCatalog,
   isMobile,
   showProductImages,
   baseCurrencySymbol,
   isProductWarehouseBlockedForSale,
   getTerminalWarehouseName,
   getProductPrice,
   isProductOutOfStock,
   hasPromotionForProduct,
   onProductClick,
   onOpenPromotion,
   onProductTouchStart,
   onProductTouchMove,
   onProductTouchEnd,
   onProductContextMenu,
}: ProductGridCardProps) => {
   const productName = product.name || '';
   const isWeighted = product.type === 'SERVICE' || productName.toLowerCase().includes('(peso)');
   const hasVariants = (product.variants || []).length > 0 || (product.attributes || []).length > 0;
   const isCompactMobileCard = isMobile && !usesExpandedCatalog;
   const warehouseSaleBlocked = isProductWarehouseBlockedForSale(product);
   const outOfStock = isProductOutOfStock(product);
   const imageSrc = showProductImages ? resolveProductImageSrc(product) : '';
   const hasPromotion = hasPromotionForProduct(product);
   const price = getProductPrice(product);
   const graphicTone = resolveProductGraphicTone(product);
   const graphicNameSize = productName.length > 34
      ? 'text-[1.05rem]'
      : productName.length > 20
         ? 'text-[1.2rem]'
         : 'text-[1.4rem]';

   const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
      const touch = e.touches[0];
      if (!touch) return;
      onProductTouchStart(product, touch.clientX, touch.clientY);
   }, [onProductTouchStart, product]);

   const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
      const touch = e.touches[0];
      if (!touch) return;
      onProductTouchMove(touch.clientX, touch.clientY);
   }, [onProductTouchMove]);

   const handlePromoClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      onOpenPromotion(product);
   }, [onOpenPromotion, product]);

   return (
      <div
         title={
            warehouseSaleBlocked
               ? `No vendible en ${getTerminalWarehouseName()}: habilite este artículo en el almacén de ventas de esta caja (ERP).`
               : undefined
         }
         onClick={() => onProductClick(product)}
         onContextMenu={(event) => onProductContextMenu(product, event)}
         onTouchStart={handleTouchStart}
         onTouchMove={handleTouchMove}
         onTouchEnd={onProductTouchEnd}
         onTouchCancel={onProductTouchEnd}
         style={{ touchAction: 'manipulation', contentVisibility: 'auto', containIntrinsicSize: '214px' }}
         className={`pos-product-card w-full min-w-0 bg-white dark:bg-slate-800 dark:border-slate-700 border border-gray-100 transition-all group relative overflow-hidden ${
            warehouseSaleBlocked
               ? 'cursor-not-allowed opacity-[0.82] saturate-[0.72] ring-1 ring-inset ring-amber-300/50 dark:ring-amber-800/45 border-amber-100/90 dark:border-amber-900/30'
               : 'cursor-pointer hover:border-purple-300 hover:-translate-y-1 active:scale-95'
         } ${showProductImages
            ? usesSupermarketLayout
               ? 'rounded-[1.75rem] p-3.5 shadow-[0_10px_26px_rgba(15,23,42,0.08)] min-h-[230px] grid grid-rows-[60%_40%]'
               : usesExpandedCatalog
                  ? 'h-full min-h-0 rounded-[1.4rem] p-2.5 shadow-[0_1px_6px_rgba(15,23,42,0.06)] grid grid-rows-[52%_48%]'
                  : isCompactMobileCard
                     ? `rounded-[1.5rem] p-2.5 min-h-[194px] shadow-sm flex flex-col ${warehouseSaleBlocked ? '' : 'hover:shadow-xl'}`
                     : `rounded-[2rem] p-3 min-h-[214px] shadow-sm flex flex-col ${warehouseSaleBlocked ? '' : 'hover:shadow-xl'}`
            : usesExpandedCatalog
               ? 'h-full min-h-0 rounded-[1.4rem] p-2.5 shadow-[0_1px_6px_rgba(15,23,42,0.06)] flex flex-col'
               : isCompactMobileCard
                  ? `rounded-[1.4rem] p-2.5 min-h-[148px] shadow-sm flex flex-col ${warehouseSaleBlocked ? '' : 'hover:shadow-xl'}`
                  : `rounded-[1.6rem] p-3 min-h-[166px] shadow-sm flex flex-col ${warehouseSaleBlocked ? '' : 'hover:shadow-xl'}`}`}
      >
         {showProductImages && (
            <div className={`w-full min-w-0 ${usesSupermarketLayout ? 'h-full rounded-[1.35rem] mb-0 p-2.5' : usesExpandedCatalog ? 'h-full rounded-[1.1rem] mb-0 p-1.5' : isCompactMobileCard ? 'h-[6.75rem] rounded-[1.15rem] mb-1.5 p-2' : 'h-28 md:h-32 rounded-[1.5rem] mb-2.5'} bg-gray-50 dark:bg-slate-800 overflow-hidden relative flex items-center justify-center`}>
               {imageSrc ? <img src={imageSrc} loading="lazy" decoding="async" className={`w-full h-full ${usesSupermarketLayout || usesExpandedCatalog || isCompactMobileCard ? 'object-contain' : 'object-cover object-center'}`} /> : <div className="w-full h-full flex items-center justify-center text-gray-200 dark:text-slate-700"><Grid size={usesSupermarketLayout ? 56 : 48} strokeWidth={1} /></div>}

               {isWeighted && (
                  <div className="absolute top-2 left-2 bg-emerald-500 text-white p-1.5 rounded-lg shadow-lg z-10 animate-in zoom-in-50" title="Requiere Balanza">
                     <ScaleIcon size={14} strokeWidth={3} />
                  </div>
               )}
               {!isWeighted && hasVariants && (
                  <div className="absolute top-2 left-2 bg-blue-600 text-white p-1.5 rounded-lg shadow-lg z-10 animate-in zoom-in-50" title="Tiene Variantes">
                     <Layers size={14} strokeWidth={3} />
                  </div>
               )}

               {hasPromotion && (
                  <div
                     className="absolute top-0 right-0 cursor-pointer z-20"
                     onClick={handlePromoClick}
                  >
                     <div className="whitespace-nowrap bg-red-500 text-white text-[10px] font-black px-2 py-1 rounded-bl-xl shadow-md flex items-center gap-1 animate-in slide-in-from-top-2 hover:bg-red-600 transition-colors">
                        <Tag size={10} className="fill-white" />
                        <span>OFERTA</span>
                     </div>
                  </div>
               )}
               {outOfStock && (
                  <div className="absolute top-0 right-0 z-20 pointer-events-none">
                     <div className="whitespace-nowrap bg-rose-600 text-white text-[10px] font-black px-2 py-1 rounded-bl-xl shadow-md flex items-center gap-1">
                        <AlertTriangle size={10} strokeWidth={3} />
                        <span>SIN STOCK</span>
                     </div>
                  </div>
               )}
            </div>
         )}

         {!showProductImages && (
            <div
               className={`relative flex shrink-0 items-center justify-center overflow-hidden border text-center ${isCompactMobileCard ? 'h-[74px] rounded-[1rem] px-3 py-2' : 'h-[92px] rounded-[1.15rem] px-4 py-3'}`}
               style={graphicTone}
            >
               <h3 className={`max-w-full break-words font-black uppercase leading-[1.05] line-clamp-3 ${graphicNameSize}`}>
                  {productName}
               </h3>
               {isWeighted && (
                  <div className="absolute left-2 top-2 rounded-lg bg-emerald-500 p-1.5 text-white shadow-md" title="Requiere Balanza">
                     <ScaleIcon size={14} strokeWidth={3} />
                  </div>
               )}
               {!isWeighted && hasVariants && (
                  <div className="absolute left-2 top-2 rounded-lg bg-blue-600 p-1.5 text-white shadow-md" title="Tiene Variantes">
                     <Layers size={14} strokeWidth={3} />
                  </div>
               )}
            </div>
         )}

         {!showProductImages && hasPromotion && (
            <div
               className="absolute top-0 right-0 cursor-pointer z-20"
               onClick={handlePromoClick}
            >
               <div className="whitespace-nowrap bg-red-500 text-white text-[10px] font-black px-3 py-1.5 rounded-bl-2xl shadow-sm flex items-center gap-1 hover:bg-red-600 transition-colors">
                  <Tag size={12} className="fill-white" />
                  <span>OFERTA</span>
               </div>
            </div>
         )}
         {!showProductImages && outOfStock && (
            <div className="absolute top-0 right-0 z-20 pointer-events-none">
               <div className="whitespace-nowrap bg-rose-600 text-white text-[10px] font-black px-3 py-1.5 rounded-bl-2xl shadow-sm flex items-center gap-1">
                  <AlertTriangle size={12} strokeWidth={3} />
                  <span>SIN STOCK</span>
               </div>
            </div>
         )}
         <div className={`w-full min-w-0 flex flex-col ${showProductImages
            ? usesExpandedCatalog
               ? 'min-h-0 h-full pt-1.5 justify-between'
               : usesSupermarketLayout
                  ? 'flex-1 gap-1 pt-1.5'
                  : isCompactMobileCard
                     ? 'flex-1 justify-between gap-1 pt-0.5'
                     : 'flex-1 justify-between gap-2 pt-1'
            : 'min-h-0 flex-1 justify-end gap-1 pt-2'}`}>
            <div className={usesSupermarketLayout ? 'space-y-1.5' : usesExpandedCatalog ? 'space-y-1' : isCompactMobileCard ? 'space-y-0.5' : 'space-y-1.5'}>
               <span className={`block font-black text-purple-500 uppercase opacity-70 line-clamp-1 ${usesSupermarketLayout ? 'text-[11px]' : usesExpandedCatalog ? 'text-[9px]' : isCompactMobileCard ? 'text-[10px]' : 'text-[9px]'}`}>{product.category}</span>
               {showProductImages && (
                  <h3 className={`pos-product-name font-black text-gray-800 dark:text-white leading-[1.08] truncate tracking-[-0.02em] ${usesSupermarketLayout ? 'text-[1.22rem] min-h-[1.35rem]' : usesExpandedCatalog ? 'text-[1.05rem] min-h-[1.15rem]' : isCompactMobileCard ? 'text-[1.16rem] min-h-[1.3rem]' : 'text-[1rem] min-h-[1.15rem]'}`}>{product.name}</h3>
               )}
            </div>
            <div className={`${showProductImages
               ? usesSupermarketLayout
                  ? 'mt-0 pt-0'
                  : usesExpandedCatalog
                     ? 'mt-0.5 pt-0.5 border-t border-gray-100 dark:border-slate-700'
                     : 'mt-auto pt-1.5 border-t border-gray-50 dark:border-slate-700'
               : 'pt-0'}`}>
               <span className={`font-black text-gray-900 dark:text-white leading-none ${showProductImages
                  ? usesSupermarketLayout
                     ? 'text-[1.78rem]'
                     : usesExpandedCatalog
                        ? 'text-[1.3rem]'
                        : isCompactMobileCard
                           ? 'text-[1.4rem]'
                           : 'text-lg'
                  : usesExpandedCatalog
                     ? 'text-[1.42rem]'
                     : isCompactMobileCard
                        ? 'text-[1.3rem]'
                        : 'text-[1.5rem]'}`}>{baseCurrencySymbol}{price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
         </div>
         {warehouseSaleBlocked && (
            <div
               className="pointer-events-none absolute inset-x-0 bottom-0 z-[25] flex justify-center px-2 pb-2 pt-10 bg-gradient-to-t from-slate-900/10 to-transparent dark:from-black/25 rounded-b-[1.5rem]"
               aria-hidden
            >
               <span className="inline-flex max-w-[calc(100%-0.5rem)] items-center gap-1 truncate rounded-lg bg-amber-600 px-2 py-1 text-center text-[9px] font-black uppercase tracking-wide text-white shadow-md">
                  <MapPin size={10} strokeWidth={3} className="shrink-0 opacity-95" />
                  Sin almacén en esta caja
               </span>
            </div>
         )}
      </div>
   );
});

ProductGridCard.displayName = 'ProductGridCard';

type RecoverableOrderEntry =
   | { kind: 'RESERVATION'; reservation: Reservation }
   | { kind: 'UBER_EATS'; order: UberEatsPendingOrder };

const normalizeSearchToken = (value: unknown): string =>
   typeof value === 'string' ? value.trim().toLowerCase() : value != null ? String(value).trim().toLowerCase() : '';

const resolveActiveTariffPrice = (
   product: Product,
   activeTokens: ReadonlySet<string>,
   productPriceIndex: Map<string, number>
): number | null => {
   const productTokens = new Set(
      [
         product.id,
         resolveOperationalProductId(product),
         ...productIdentityCandidates(product),
      ]
         .map(normalizeSearchToken)
         .filter(Boolean)
   );

   for (const productToken of productTokens) {
      for (const activeToken of activeTokens) {
         const indexedPrice = productPriceIndex.get(`${productToken}::${activeToken}`);
         if (typeof indexedPrice === 'number' && Number.isFinite(indexedPrice)) {
            return indexedPrice;
         }
      }
   }

   const matchedEntry = (product.tariffs || []).find((entry: any) => {
      const entryTokens = [
         entry?.tariffId,
         entry?.tariff_id,
         entry?.id,
         entry?.code,
         entry?.tariffCode,
         entry?.tariff_code,
      ]
         .map(normalizeSearchToken)
         .filter(Boolean);

      return entryTokens.some((token) => activeTokens.has(token));
   });

   const tariffPrice = matchedEntry?.price;
   return typeof tariffPrice === 'number' && Number.isFinite(tariffPrice) ? tariffPrice : null;
};

type SalesCatalogProductEntry = {
   product: Product;
   displayCategory: string;
   hasActiveTariff: boolean;
   hasErpWarehouse: boolean;
   isSellable: boolean;
   normalizedCategory: string;
   searchText: string;
};

const isUberRecoveredReservation = (reservation: Reservation | null | undefined): boolean =>
   reservation?.sourceChannel === 'UBER_EATS' && Boolean(reservation?.sourceOrderId);

const buildUberRecoveredPayment = (reservation: Reservation, amount: number): PaymentEntry | null => {
   const prepaidPayment = reservation.prepaidPayment;
   if (!prepaidPayment) return null;

   return {
      id: `UBER-${reservation.sourceOrderId || reservation.id}-${Date.now()}`,
      method: prepaidPayment.method,
      methodLabel: prepaidPayment.label,
      amount: Math.max(0, Number(amount || prepaidPayment.amount || 0)),
      timestamp: new Date(),
   };
};

const POSInterface: React.FC<POSInterfaceProps> = ({
   config,
   currentUser,
   products,
   onUpdateProducts,
   onUpdateCustomers,
   roles,
   users,
   customers,
   warehouses,
   cart,
   transactions,
   zReports,
   onUpdateCart,
   selectedCustomer,
   onSelectCustomer,
   parkedTickets,
   onUpdateParkedTickets,
   onLogout,
   onExitApplication,
   onOpenSettings,
   onOpenAttendance,
   onOpenCustomers,
   onOpenHistory,
   onOpenFinance,
   onRegisterCashMovement,
   onOpenZReport,
   onOpenInventoryTracking,
   onOpenAudit,
   onOpenTableMap,
   onTableOrderSaved,
   onSelectTableAccount,
   onTableOrderClosed,
   onOpenAgenda,
   onTransactionComplete,
   onAddCustomer,
   onUpdateConfig,
   activeTerminalId,
   activeTable,
   onClearActiveTable,
   onUpdateActiveTableGuests,
   onKioskPay,
   internalSequences,
   rooms = [],
   productPrices: externalProductPrices = []
}) => {
   markRenderStart('POS_INTERACTION_VIEW');
   const cartEndRef = useRef<HTMLDivElement>(null);
   const posRootRef = useRef<HTMLDivElement>(null);
   const mobileFooterRef = useRef<HTMLDivElement>(null);
   const mobileCartButtonRef = useRef<HTMLButtonElement>(null);
   const desktopActionGridRef = useRef<HTMLDivElement>(null);
   const ticketAutoSyncTimeoutRef = useRef<number | null>(null);
   const ticketAutoSyncFlushRef = useRef<(() => Promise<void>) | null>(null);
   // El guardado automático puede dispararse varias veces antes de que React
   // propague parkedTickets de vuelta como prop. Mantener el último snapshot
   // evita que una pulsación posterior reconstruya la orden con datos viejos.
   const parkedTicketsRef = useRef<ParkedTicket[]>(parkedTickets);
   const onUpdateParkedTicketsRef = useRef(onUpdateParkedTickets);
   const onTableOrderSavedRef = useRef(onTableOrderSaved);
   const closedTableOrderIdsRef = useRef<Set<string>>(new Set());
   const paymentFinalizationInFlightRef = useRef(false);
   const activeAddTraceRef = useRef<PosInteractionTrace | null>(null);
   const checkoutTraceRef = useRef<PosInteractionTrace | null>(null);
   const searchFilterTraceRef = useRef<PosInteractionTrace | null>(null);
   useLayoutEffect(() => markRenderEnd('POS_INTERACTION_VIEW'));
   const activeTableHydrationRef = useRef<{ key: string; missingTicket: boolean } | null>(null);
   const kdsRetryInFlightRef = useRef(false);
   const productionRoutingPromptResolverRef = useRef<((decision: ProductionRoutingPromptDecision) => void) | null>(null);
   const quickActionTouchTimerRef = useRef<number | null>(null);
   const quickActionTouchStartRef = useRef<{ x: number; y: number; at: number } | null>(null);
   const lastTouchContextMenuAtRef = useRef(0);
   const lastProductTouchAtRef = useRef(0);
   const quickActionOpenedAtRef = useRef(0);
   const [productPrices, setProductPrices] = useState<ProductPrice[]>(externalProductPrices);
   const catalogProducts = products;

   useEffect(() => {
      setProductPrices(Array.isArray(externalProductPrices) ? externalProductPrices : []);
   }, [externalProductPrices]);

   useEffect(() => {
      parkedTicketsRef.current = Array.isArray(parkedTickets) ? parkedTickets : [];
   }, [parkedTickets]);

   useEffect(() => {
      onUpdateParkedTicketsRef.current = onUpdateParkedTickets;
      onTableOrderSavedRef.current = onTableOrderSaved;
   }, [onUpdateParkedTickets, onTableOrderSaved]);

   useEffect(() => {
      let cancelled = false;

      const refreshProductPrices = async () => {
         try {
            const fresh = await db.get('productPrices') as ProductPrice[] | null;
            if (!cancelled && Array.isArray(fresh)) {
               setProductPrices(fresh);
            }
         } catch (error) {
            console.warn('⚠️ POSInterface: Could not load productPrices collection:', error);
         }
      };

      void refreshProductPrices();
      window.addEventListener('productPricesUpdated', refreshProductPrices);
      return () => {
         cancelled = true;
         window.removeEventListener('productPricesUpdated', refreshProductPrices);
      };
   }, []);

   const isMaster = useMemo(() => {
      const terminal = config.terminals?.find(t => t.id === activeTerminalId);
      return terminal?.config?.isPrimaryNode === true;
   }, [config.terminals, activeTerminalId]);
   const effectiveSelectedCustomer = useMemo(() => {
      if (!selectedCustomer?.id) return selectedCustomer;
      return customers.find(customer => customer.id === selectedCustomer.id) || selectedCustomer;
   }, [customers, selectedCustomer]);
   const isSelectedCustomerTaxExempt = effectiveSelectedCustomer?.isTaxExempt === true;
   const [quickActionData, setQuickActionData] = useState<{ product: Product; x: number; y: number } | null>(null);
   const [successToast, setSuccessToast] = useState<string | null>(null);
   const [cashMovementModalType, setCashMovementModalType] = useState<'IN' | 'OUT' | null>(null);
   const [cashMovementAmount, setCashMovementAmount] = useState('');
   const [cashMovementReason, setCashMovementReason] = useState('');
   const [isSavingCashMovement, setIsSavingCashMovement] = useState(false);
   const [incomingUberToast, setIncomingUberToast] = useState<{ count: number; displayIds: string[] } | null>(null);
   const knownUberOrderIdsRef = useRef<Set<string>>(new Set());
   const uberOrdersMonitorPrimedRef = useRef(false);

   // --- SAFETY GATE STATE ---
   const [showSafetyGate, setShowSafetyGate] = useState(false);
   const [safetyAction, setSafetyAction] = useState<{ name: string, callback: () => void, isCritical: boolean } | null>(null);

   // --- TICKET TABS STRATEGY STATE ---
   const [rightSidebarTab, setRightSidebarTab] = useState<'CART' | 'ACTIONS'>('CART');
   const [compactSearchOpen, setCompactSearchOpen] = useState(false);
   const [orderServiceType, setOrderServiceType] = useState<OrderServiceType>('DINE_IN');
   const [showServiceTypeDialog, setShowServiceTypeDialog] = useState(false);

   const cancelTicketAutoSync = () => {
      if (ticketAutoSyncTimeoutRef.current) {
         window.clearTimeout(ticketAutoSyncTimeoutRef.current);
         ticketAutoSyncTimeoutRef.current = null;
      }
      ticketAutoSyncFlushRef.current = null;
   };

   const triggerSafetyGate = (name: string, callback: () => void) => {
      const isCritical = cart.length > 0 || parkedTickets.length > 0 || (activeTable !== null && activeTable !== undefined);
      setSafetyAction({ name, callback, isCritical });
      setShowSafetyGate(true);
   };

   useEffect(() => {
      if (successToast) {
         const timer = setTimeout(() => setSuccessToast(null), 3000);
         return () => clearTimeout(timer);
      }
   }, [successToast]);

   useEffect(() => {
      if (!incomingUberToast) return;
      const timer = window.setTimeout(() => setIncomingUberToast(null), 6500);
      return () => window.clearTimeout(timer);
   }, [incomingUberToast]);

   useEffect(() => () => {
      if (ticketAutoSyncTimeoutRef.current) {
         window.clearTimeout(ticketAutoSyncTimeoutRef.current);
         ticketAutoSyncTimeoutRef.current = null;
      }
      if (ticketAutoSyncFlushRef.current) {
         void ticketAutoSyncFlushRef.current();
         ticketAutoSyncFlushRef.current = null;
      }
   }, []);

   const activeTerminal = (config.terminals || []).find(t => t.id === activeTerminalId) || (config.terminals || [])[0];
   const activeTerminalConfig = activeTerminal?.config;
   const terminalId = activeTerminal?.id || 'T1';
   const activeTerminalConfigRaw = useMemo<Record<string, unknown>>(
      () => activeTerminalConfig ? (activeTerminalConfig as unknown as Record<string, unknown>) : {},
      [activeTerminalConfig]
   );
   const activeTableContext = useMemo(
      () => buildTableContextLabels(activeTable, rooms),
      [activeTable, rooms]
   );
   const activeTableHeaderLabel = useMemo(
      () => resolvePosTableHeaderLabel({
         roomName: activeTableContext.roomLabel,
         tableName: activeTableContext.tableLabel,
      }) || activeTableContext.tableLabel,
      [activeTableContext.roomLabel, activeTableContext.tableLabel]
   );
   const activeTableAccounts = useMemo(() => {
      const tableId = String(activeTable?.id || '').trim();
      if (!tableId) return [];

      const readAccountNumber = (ticket: ParkedTicket) => {
         const label = `${ticket.name || ''} ${ticket.alias || ''}`;
         const match = label.match(/cuenta\s+(\d+)/i);
         return match ? Number(match[1]) : 1;
      };

      return (Array.isArray(parkedTickets) ? parkedTickets : [])
         .filter(ticket => String(ticket.tableId || '').trim() === tableId)
         .sort((left, right) => {
            const numberDelta = readAccountNumber(left) - readAccountNumber(right);
            if (numberDelta !== 0) return numberDelta;
            return String(left.timestamp || '').localeCompare(String(right.timestamp || ''));
         });
   }, [activeTable?.id, parkedTickets]);
   const activeTableAccountIndex = Math.max(
      0,
      activeTableAccounts.findIndex(ticket => String(ticket.id) === String(activeTable?.currentOrderId || ''))
   );
   const activeTableAccount = activeTableAccounts[activeTableAccountIndex];
   const isActiveTableAccountSubtotalized = Boolean(
      activeTableAccount?.items?.length
      && activeTableAccount.items.every(item => Boolean(item.subtotalizedAt))
   );
   const handleNavigateTableAccount = useCallback((direction: -1 | 1) => {
      if (activeTableAccounts.length < 2 || !onSelectTableAccount) return;
      const nextIndex = (activeTableAccountIndex + direction + activeTableAccounts.length) % activeTableAccounts.length;
      const nextTicket = activeTableAccounts[nextIndex];
      if (!nextTicket) return;

      void ticketAutoSyncFlushRef.current?.();
      activeTableHydrationRef.current = null;
      void Promise.resolve(onSelectTableAccount(nextTicket));
   }, [activeTableAccountIndex, activeTableAccounts, onSelectTableAccount]);
   const renderTableAccountNavigator = () => activeTableAccounts.length > 1 ? (
      <div className={`flex shrink-0 items-center gap-1 rounded-xl border p-1 shadow-sm ${isActiveTableAccountSubtotalized
         ? 'border-violet-300 bg-violet-50'
         : 'border-blue-200 bg-blue-50'
      }`}>
         <button
            type="button"
            onClick={() => handleNavigateTableAccount(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-blue-600 shadow-sm hover:bg-blue-100"
            title="Cuenta anterior"
            aria-label="Cuenta anterior"
         >
            <ChevronLeft size={16} strokeWidth={3} />
         </button>
         <span className={`min-w-[108px] text-center text-xs font-black ${isActiveTableAccountSubtotalized ? 'text-violet-800' : 'text-blue-800'}`}>
            <span className="block">Cuenta {activeTableAccountIndex + 1} de {activeTableAccounts.length}</span>
            {isActiveTableAccountSubtotalized && (
               <span className="mt-0.5 block text-[8px] uppercase tracking-[0.14em] text-violet-600">Subtotalizada</span>
            )}
         </span>
         <button
            type="button"
            onClick={() => handleNavigateTableAccount(1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-blue-600 shadow-sm hover:bg-blue-100"
            title="Cuenta siguiente"
            aria-label="Cuenta siguiente"
         >
            <ChevronRight size={16} strokeWidth={3} />
         </button>
      </div>
   ) : null;
   const activeBarTabId = String(activeTable?.barTabId || '').trim();
   const activeBarTabName = String(activeTable?.barTabName || '').trim();
   const markKdsQueueItemsSent = useCallback(async (entry: any) => {
      const payload = entry?.payload || {};
      const orderId = String(payload.orderId || entry?.orderId || '').trim();
      if (!orderId) return;

      const cartIds = new Set(
         (Array.isArray(entry?.cartIds) ? entry.cartIds : [])
            .map((id: unknown) => String(id))
            .filter(Boolean)
      );
      const areaId = String(entry?.areaId || payload?.area?.id || '').trim();
      const shouldMark = (item: CartItem) => {
         const cartKey = getCartDispatchKey(item);
         if (cartIds.size > 0) return cartIds.has(cartKey);
         const sameOrder = String(item.kdsOrderId || '') === orderId;
         const sameArea = !areaId || String(item.kdsAreaId || '') === areaId;
         return sameOrder && sameArea && isKdsPendingCartItem(item);
      };
      const markItems = (items: CartItem[]) => items.map(item => shouldMark(item)
         ? {
            ...item,
            dispatched: true,
            kdsStatus: 'ENVIADO',
            kdsLastError: undefined,
            kdsQueuedAt: undefined,
         } as CartItem
         : item
      );

      const nextTickets = (Array.isArray(parkedTickets) ? parkedTickets : []).map(ticket => {
         if (String(ticket.id) !== orderId) return ticket;
         return { ...ticket, items: markItems(ticket.items || []) };
      });
      await Promise.resolve(onUpdateParkedTickets(nextTickets));

      if (String(activeTable?.currentOrderId || '') === orderId) {
         onUpdateCart(prev => markItems(prev));
      }
   }, [activeTable?.currentOrderId, onUpdateCart, onUpdateParkedTickets, parkedTickets]);

   const retryPendingKdsDispatches = useCallback(async () => {
      if (kdsRetryInFlightRef.current) return;
      kdsRetryInFlightRef.current = true;
      try {
         const storedQueue = await db.get('kdsDispatchQueue' as any).catch(() => []) as any;
         const queue = Array.isArray(storedQueue) ? storedQueue : [];
         if (queue.length === 0) return;

         const nextQueue: any[] = [];
         let sentCount = 0;
         for (const entry of queue) {
            const status = String(entry?.status || 'PENDING').toUpperCase();
            if (status === 'SENT') continue;

            const payload = entry?.payload || {};
            const kdsBaseUrl = String(entry?.kdsBaseUrl || '').trim().replace(/\/+$/, '');
            const orderId = String(payload.orderId || entry?.orderId || '').trim();
            if (!kdsBaseUrl || !orderId) {
               nextQueue.push(entry);
               continue;
            }

            try {
               await postJsonWithTimeout(`${kdsBaseUrl}/api/ordenes/${encodeURIComponent(orderId)}`, {
                  items: payload.items || [],
                  total: payload.total || 0,
                  status: 'OCCUPIED',
                  displayId: payload.displayId,
                  orderNumber: payload.orderNumber,
                  terminalId: payload.terminalId,
                  userName: payload.userName,
                  customerName: payload.customerName,
                  table: payload.table,
                  area: payload.area,
                  sourceTerminal: payload.sourceTerminal,
                  kdsTiming: payload.kdsTiming,
               });
               await postJsonWithTimeout(`${kdsBaseUrl}/api/ordenes/enviar-comanda/${encodeURIComponent(orderId)}`, payload);
               await markKdsQueueItemsSent(entry);
               sentCount += 1;
            } catch (error: any) {
               nextQueue.push({
                  ...entry,
                  status: 'PENDING',
                  attempts: Number(entry?.attempts || 0) + 1,
                  lastError: error?.message || 'KDS_UNREACHABLE',
                  updatedAt: new Date().toISOString(),
               });
            }
         }

         await db.save('kdsDispatchQueue' as any, nextQueue);
         if (sentCount > 0) {
            setSuccessToast(`${sentCount} comanda(s) pendiente(s) enviada(s) a cocina`);
         }
      } finally {
         kdsRetryInFlightRef.current = false;
      }
   }, [markKdsQueueItemsSent]);

   useEffect(() => {
      const retry = () => {
         retryPendingKdsDispatches().catch(error => console.warn('[KDS] Reintento de cola falló:', error));
      };
      retry();
      const interval = window.setInterval(retry, 10000);
      window.addEventListener('online', retry);
      window.addEventListener('focus', retry);
      return () => {
         window.clearInterval(interval);
         window.removeEventListener('online', retry);
         window.removeEventListener('focus', retry);
      };
   }, [retryPendingKdsDispatches]);

   const reserveNextOrderNumber = useCallback((): string | undefined => {
      const settings = normalizeOrderNumberSettings(activeTerminalConfig?.operational?.orderNumbers);
      if (!settings.enabled || !activeTerminal?.id) return undefined;

      const orderNumber = formatOrderNumber(settings);
      const nextConfig: BusinessConfig = {
         ...config,
         terminals: (config.terminals || []).map((terminal) => {
            if (terminal.id !== activeTerminal.id) return terminal;

            const terminalConfig = terminal.config;
            const operational = terminalConfig.operational;
            const currentSettings = normalizeOrderNumberSettings(operational.orderNumbers || settings);

            return {
               ...terminal,
               config: {
                  ...terminalConfig,
                  operational: {
                     ...operational,
                     orderNumbers: {
                        ...(operational.orderNumbers || {}),
                        enabled: true,
                        prefix: settings.prefix,
                        padding: settings.padding,
                        nextNumber: Math.max(currentSettings.nextNumber, settings.nextNumber) + 1,
                     },
                  },
               },
            };
         }),
      };

      onUpdateConfig(nextConfig);
      return orderNumber;
   }, [activeTerminal?.id, activeTerminalConfig, config, onUpdateConfig]);

   const applyOrderContextToItems = useCallback((items: CartItem[], orderNumber?: string): CartItem[] => {
      const tableDisplayLabel = activeTableContext.compactLabel || undefined;
      const tableRoomLabel = activeTableContext.roomLabel || undefined;

      return items.map(item => ({
         ...item,
         ...(orderNumber ? { orderNumber: item.orderNumber || orderNumber } : {}),
         ...(tableDisplayLabel ? { tableDisplayLabel } : {}),
         ...(tableRoomLabel ? { tableRoomLabel } : {}),
      }));
   }, [activeTableContext.compactLabel, activeTableContext.roomLabel]);
   const terminalDeliveryAlerts = activeTerminalConfig?.operational?.deliveryAlerts;
   const shouldShowUberToastAlerts = terminalDeliveryAlerts?.showUberEatsToast !== false;
   const shouldAutoOpenUberModal = Boolean(
      terminalDeliveryAlerts?.isDeliveryTerminal && terminalDeliveryAlerts?.autoOpenUberEatsModal
   );
   const productById = useMemo(() => {
      const index = new Map<string, Product>();
      for (const product of catalogProducts || []) {
         if (product?.id) index.set(product.id, product);
      }
      return index;
   }, [catalogProducts]);
   const marketplaceProductLookup = useMemo(() => {
      const byReference = new Map<string, Product>();
      const byName = new Map<string, Product>();
      const rankedProducts = [...(catalogProducts || [])].sort(
         (left, right) => scoreProductForSales(right, warehouses) - scoreProductForSales(left, warehouses)
      );

      for (const product of rankedProducts) {
         const tokens = new Set<string>([
            ...productReferenceCandidates(product),
            ...productIdentityCandidates(product),
            resolveOperationalProductId(product),
            product.barcode || '',
            (product as any).sku || '',
            (product as any).code || '',
            (product as any).item_code || '',
         ].map(normalizeSearchToken).filter(Boolean));

         tokens.forEach((token) => {
            if (!byReference.has(token)) {
               byReference.set(token, product);
            }
         });

         const nameKey = normalizeSearchToken(product.name);
         if (nameKey && !byName.has(nameKey)) {
            byName.set(nameKey, product);
         }
      }

      return { byReference, byName };
   }, [catalogProducts, warehouses]);
   const salesUsers = useMemo(() => getTerminalSnapshotSellers(config, terminalId), [config, terminalId]);
   const resolveSalespersonLabel = useCallback((salespersonId?: string | null) => {
      return resolveTerminalSellerName(salespersonId, config, terminalId, users) || 'Vendedor';
   }, [config, terminalId, users]);
   const terminalDisplaySource = activeTerminalConfig?.terminalName || activeTerminalConfig?.stationNumber || terminalId;
   const terminalDisplayLabel = useMemo(() => {
      const normalized = String(terminalDisplaySource || terminalId).trim();
      if (!normalized) return `T-${terminalId}`;
      return /^t-/i.test(normalized) ? normalized.toUpperCase() : `T-${normalized.toUpperCase()}`;
   }, [terminalDisplaySource, terminalId]);
   const defaultSalesWarehouseId = activeTerminalConfig?.inventoryScope?.defaultSalesWarehouseId;
   const uxConfig = {
      showProductImages: true,
      gridDensity: 'COMFORTABLE' as const,
      theme: 'LIGHT' as const,
      quickKeysLayout: 'A' as const,
      viewMode: 'VISUAL' as const,
      ...(activeTerminalConfig?.ux || {}),
   };
   const normalizeScopeKey = useCallback((value: unknown) => {
      return typeof value === 'string' ? value.trim().toLowerCase() : '';
   }, []);
   const categoryLookup = useMemo(() => {
      const aliasToCanonical = new Map<string, string>();
      const canonicalToDisplay = new Map<string, string>();
      const presentationByCanonical = new Map<string, { color?: string; sortOrder: number; isActive: boolean }>();

      const categoryPresentationSources = [
         ...(config.families || []),
         ...(config.posCategories || []),
      ];
      for (const [index, category] of categoryPresentationSources.entries()) {
         const aliases = [category.id, category.code, category.name]
            .map((value) => normalizeScopeKey(value))
            .filter(Boolean);
         const canonical = normalizeScopeKey(category.name || category.code || category.id);
         const displayName = category.name || category.code || category.id;
         if (!canonical || !displayName) continue;

         canonicalToDisplay.set(canonical, displayName);
         presentationByCanonical.set(canonical, {
            color: resolveClassificationColor(category),
            sortOrder: resolveClassificationSortOrder(category, index),
            isActive: resolveClassificationActive(category),
         });
         aliases.forEach((alias) => aliasToCanonical.set(alias, canonical));
      }

      return { aliasToCanonical, canonicalToDisplay, presentationByCanonical };
   }, [config.families, config.posCategories, normalizeScopeKey]);
   const canonicalizeCategory = useCallback((value: unknown) => {
      const normalized = normalizeScopeKey(value);
      return categoryLookup.aliasToCanonical.get(normalized) || normalized;
   }, [categoryLookup.aliasToCanonical, normalizeScopeKey]);
   const displayCategory = useCallback((value: unknown) => {
      const canonical = canonicalizeCategory(value);
      if (!canonical) return '';
      return categoryLookup.canonicalToDisplay.get(canonical) || (typeof value === 'string' ? value.trim() : canonical);
   }, [canonicalizeCategory, categoryLookup.canonicalToDisplay]);
   const warehouseAliasMap = useMemo(() => {
      const aliasMap = new Map<string, Set<string>>();
      const displayMap = new Map<string, string>();

      const registerWarehouse = (warehouse?: Partial<Warehouse> | null) => {
         if (!warehouse) return;
         const aliases = [warehouse.id, warehouse.code, warehouse.name]
            .map((value) => normalizeScopeKey(value))
            .filter(Boolean);
         if (aliases.length === 0) return;

         const mergedAliases = new Set(aliases);
         aliases.forEach((alias) => {
            const existing = aliasMap.get(alias);
            if (existing) {
               existing.forEach((item) => mergedAliases.add(item));
            }
         });

         aliases.forEach((alias) => {
            aliasMap.set(alias, new Set(mergedAliases));
            if (warehouse.name) {
               displayMap.set(alias, warehouse.name);
            }
         });
      };

      (warehouses || []).forEach(registerWarehouse);
      (activeTerminalConfig?.inventoryScope?.warehouses || []).forEach(registerWarehouse);
      registerWarehouse(activeTerminalConfig?.inventoryScope?.defaultWarehouse as Warehouse | undefined);

      return { aliasMap, displayMap };
   }, [
      warehouses,
      activeTerminalConfig?.inventoryScope?.warehouses,
      activeTerminalConfig?.inventoryScope?.defaultWarehouse,
      normalizeScopeKey
   ]);
   const effectiveWarehouseKeys = useMemo(() => {
      const keys = new Set<string>();
      const addWarehouseValue = (value: unknown) => {
         const normalized = normalizeScopeKey(value);
         if (!normalized) return;
         keys.add(normalized);
         const aliases = warehouseAliasMap.aliasMap.get(normalized);
         aliases?.forEach((alias) => keys.add(alias));
      };

      addWarehouseValue(defaultSalesWarehouseId);
      addWarehouseValue(activeTerminalConfig?.inventoryScope?.defaultWarehouse?.id);
      addWarehouseValue(activeTerminalConfig?.inventoryScope?.defaultWarehouse?.code);
      addWarehouseValue(activeTerminalConfig?.inventoryScope?.defaultWarehouse?.name);
      (activeTerminalConfig?.inventoryScope?.visibleWarehouseIds || []).forEach(addWarehouseValue);

      return keys;
   }, [
      activeTerminalConfig?.inventoryScope?.defaultWarehouse?.code,
      activeTerminalConfig?.inventoryScope?.defaultWarehouse?.id,
      activeTerminalConfig?.inventoryScope?.defaultWarehouse?.name,
      activeTerminalConfig?.inventoryScope?.visibleWarehouseIds,
      defaultSalesWarehouseId,
      normalizeScopeKey,
      warehouseAliasMap.aliasMap
   ]);
   const getTerminalWarehouseName = useCallback(() => {
      for (const key of effectiveWarehouseKeys) {
         const display = warehouseAliasMap.displayMap.get(key);
         if (display) return display;
      }
      return 'Almacén Actual';
   }, [effectiveWarehouseKeys, warehouseAliasMap.displayMap]);
   const productMatchesTerminalWarehouse = useCallback((product: Product) => {
      const activeWarehouses = resolveProductActiveWarehouseIds(product, warehouses)
         .map((warehouseId) => normalizeScopeKey(warehouseId))
         .filter(Boolean);
      if (activeWarehouses.length === 0) return false;
      if (effectiveWarehouseKeys.size === 0) return true;
      return activeWarehouses.some((warehouseId) => effectiveWarehouseKeys.has(warehouseId));
   }, [effectiveWarehouseKeys, normalizeScopeKey, warehouses]);
   /** Tarifa OK en ERP pero almacenes activos no intersectan la caja: se muestra atenuado y no deja vender. */
   const productWarehouseBlockedById = useMemo(() => {
      const index = new Map<string, boolean>();
      for (const product of catalogProducts || []) {
         if (!product?.id) continue;
         index.set(product.id, !productMatchesTerminalWarehouse(product));
      }
      return index;
   }, [productMatchesTerminalWarehouse, catalogProducts]);

   const isProductWarehouseBlockedForSale = useCallback(
      (product: Product) => {
         if (product?.id && productWarehouseBlockedById.has(product.id)) {
            return productWarehouseBlockedById.get(product.id) ?? true;
         }
         return !productMatchesTerminalWarehouse(product);
      },
      [productMatchesTerminalWarehouse, productWarehouseBlockedById]
   );
   const getScopedProductStock = useCallback((product: Product) => {
      if (defaultSalesWarehouseId) {
         const directDefaultStock = getWarehouseScopedNumber(product.stockBalances || {}, defaultSalesWarehouseId, warehouses, Number.NaN);
         if (Number.isFinite(directDefaultStock)) return directDefaultStock;
      }
      const defaultWarehouse = activeTerminalConfig?.inventoryScope?.defaultWarehouse;
      for (const defaultWarehouseCandidate of [
         defaultWarehouse?.id,
         defaultWarehouse?.code,
         defaultWarehouse?.name,
         (defaultWarehouse as any)?.erpWarehouseId,
         (defaultWarehouse as any)?.inventoryLocalId,
         (defaultWarehouse as any)?.sourceWarehouseId,
      ]) {
         const directDefaultStock = getWarehouseScopedNumber(product.stockBalances || {}, defaultWarehouseCandidate, warehouses, Number.NaN);
         if (Number.isFinite(directDefaultStock)) return directDefaultStock;
      }
      const stockEntries = Object.entries(product.stockBalances || {});
      const matchedEntry = stockEntries.find(([warehouseId]) => effectiveWarehouseKeys.has(normalizeScopeKey(warehouseId)));
      if (matchedEntry) {
         return Number(matchedEntry[1] ?? 0);
      }
      for (const warehouseKey of effectiveWarehouseKeys) {
         const scopedValue = getWarehouseScopedNumber(product.stockBalances || {}, warehouseKey, warehouses, Number.NaN);
         if (Number.isFinite(scopedValue)) return scopedValue;
      }
      return Number(product.stock ?? 0);
   }, [
      activeTerminalConfig?.inventoryScope?.defaultWarehouse,
      defaultSalesWarehouseId,
      effectiveWarehouseKeys,
      normalizeScopeKey,
      warehouses,
   ]);
   const isProductOutOfStock = useCallback((product: Product) => {
      const trackInventory = product.operationalFlags?.trackInventory ?? config.features?.stockTracking ?? false;
      return Boolean(trackInventory && getScopedProductStock(product) <= 0);
   }, [config.features?.stockTracking, getScopedProductStock]);
   const effectiveAllowedCategorySet = useMemo(() => {
      const configuredCategories = new Set(
         (activeTerminalConfig?.catalog?.allowedCategories || [])
            .map((category) => canonicalizeCategory(category))
            .filter(Boolean)
      );
      if (configuredCategories.size === 0) return configuredCategories;

      const localSellableCategories = new Set(
         (catalogProducts || [])
            .filter((product) => product && product.is_sellable !== false)
            .map((product) => canonicalizeCategory(product.category))
            .filter(Boolean)
      );

      const matchedCategories = Array.from(configuredCategories).filter((category) => localSellableCategories.has(category));
      return matchedCategories.length > 0 ? configuredCategories : new Set<string>();
   }, [activeTerminalConfig?.catalog?.allowedCategories, canonicalizeCategory, catalogProducts]);

   const isRetailMode = isRetailViewMode(
      activeTerminalConfig?.ux?.viewMode ||
      (activeTerminalConfigRaw?.ux as Record<string, unknown> | undefined)?.viewMode ||
      (activeTerminalConfigRaw?.ux as Record<string, unknown> | undefined)?.mode ||
      (activeTerminalConfigRaw?.operational as Record<string, unknown> | undefined)?.viewMode
   );
   const operationalVertical = String(activeTerminalConfig?.operational?.vertical_negocio || '');
   const isRestaurantMode =
      operationalVertical === 'RESTAURANT' ||
      operationalVertical === 'RESTAURANTE' ||
      config.vertical === 'RESTAURANT';
   useEffect(() => { setCheckoutCaptureContext({mode:isRestaurantMode ? 'RESTAURANT' : 'RETAIL'}); }, [isRestaurantMode]);
   const isRestaurantOrderContext = Boolean(
      activeTable && (isRestaurantMode || activeTerminalConfig?.operational?.usa_mesas)
   );

   useEffect(() => {
      if (!isRestaurantMode || !(Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android')) return;
      const androidBridge = (window as Window & {
         ClicPOSAppBridge?: { setKeyboardOverlayMode?: (enabled: boolean) => void };
      }).ClicPOSAppBridge;
      if (typeof androidBridge?.setKeyboardOverlayMode !== 'function') return;

      androidBridge.setKeyboardOverlayMode(true);
      return () => androidBridge.setKeyboardOverlayMode?.(false);
   }, [isRestaurantMode]);

   const canReceiveConsignments = resolveConsignmentDownloadEnabled(activeTerminalConfig?.operational);
   const showTableMapButton = Boolean(activeTerminalConfig?.operational?.usa_mesas);
   const hideTableExtras = isRestaurantMode && !!activeTable;
   const restaurantActionGridClass = !isRestaurantMode
      ? 'grid-cols-[112px_minmax(0,1fr)]'
      : showTableMapButton
         ? (hideTableExtras ? 'grid-cols-4' : 'grid-cols-5')
         : (hideTableExtras ? 'grid-cols-3' : 'grid-cols-4');
   const reservationPolicy = activeTerminalConfig?.operational?.reservationPolicy || {
      validityDays: 7,
      printCopies: 1,
      requireAdvance: false,
      minimumAdvancePercent: 20
   };

   // --- UX EFFECTS ---
   useEffect(() => {
      if (uxConfig.theme === 'DARK') {
         document.documentElement.classList.add('dark');
      } else {
         document.documentElement.classList.remove('dark');
      }
   }, [uxConfig.theme]);



   // --- DETECT KIOSK / SELF CHECKOUT ---
   const isKioskMode = resolveDeviceRoleValue([
      activeTerminalConfigRaw?.deviceRole,
      activeTerminalConfigRaw?.role,
      activeTerminalConfigRaw?.roleCode,
      activeTerminalConfigRaw?.role_code,
      activeTerminalConfigRaw?.deviceRoleCode,
      activeTerminalConfigRaw?.device_role_code,
      (activeTerminalConfigRaw?.ux as Record<string, unknown> | undefined)?.mode,
      (activeTerminalConfigRaw?.deviceRole as Record<string, unknown> | undefined)?.role_code,
      (activeTerminalConfigRaw?.deviceRole as Record<string, unknown> | undefined)?.device_role_code,
   ], DeviceRole.STANDARD_POS) === DeviceRole.SELF_CHECKOUT;
   const isOrderTakerMode = resolveDeviceRoleValue([
      activeTerminalConfigRaw?.deviceRole,
      activeTerminalConfigRaw?.terminalType,
      activeTerminalConfigRaw?.terminal_type,
      activeTerminalConfigRaw?.role,
      activeTerminalConfigRaw?.roleCode,
      activeTerminalConfigRaw?.role_code,
   ], DeviceRole.STANDARD_POS) === DeviceRole.ORDER_TAKER;
   const activeDeviceProfile = useMemo(() => resolveTerminalDeviceProfile(
      activeTerminal,
      isOrderTakerMode ? DeviceRole.ORDER_TAKER : activeTerminalConfig?.deviceRole?.role,
   ), [activeTerminal, activeTerminalConfig?.deviceRole?.role, isOrderTakerMode]);
   const isTabletProfile = activeDeviceProfile.formFactor === DeviceFormFactor.TABLET;

   useEffect(() => {
      if (!(Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android')) return;
      const orientation = screen.orientation as ScreenOrientation & {
         lock?: (orientation: 'portrait' | 'landscape') => Promise<void>;
         unlock?: () => void;
      };
      if (activeDeviceProfile.orientation === DeviceOrientation.AUTO) {
         orientation.unlock?.();
         return;
      }
      const requestedOrientation = activeDeviceProfile.orientation === DeviceOrientation.PORTRAIT
         ? 'portrait'
         : 'landscape';
      void orientation.lock?.(requestedOrientation).catch(error => {
         console.warn('[DEVICE_PROFILE] No se pudo fijar la orientación:', error);
      });
   }, [activeDeviceProfile.orientation]);

   // --- AUTO-HYDRATION FOR TABLES ---
   // --- SMART TABLE HYDRATION ---
   // Automatically load order when entering via Table Map
   useEffect(() => {
      if (!activeTable) {
         activeTableHydrationRef.current = null;
         return;
      }

      const orderId = String(activeTable.currentOrderId || '').trim();
      const tableKey = `${activeTable.id || 'table'}:${orderId || 'empty'}`;
      const previousHydration = activeTableHydrationRef.current;
      const isNewTableContext = previousHydration?.key !== tableKey;

      if (!orderId) {
         if (isNewTableContext) {
            recordCheckoutDiagnostic('TABLE_CART_CLEAR', { items: cart, tableId: activeTable.id, orderId, reason: !orderId ? 'TABLE_WITHOUT_ORDER' : 'ORDER_NOT_FOUND' });
            onUpdateCart([]);
            setOrderServiceType('DINE_IN');
            if (!selectedCustomer) onSelectCustomer(null);
         }
         activeTableHydrationRef.current = { key: tableKey, missingTicket: false };
         return;
      }

      const ticket = parkedTickets.find(t => t.id === orderId);
      const shouldHydrate =
         isNewTableContext ||
         (previousHydration?.missingTicket && cart.length === 0);

      if (!ticket) {
         if (isNewTableContext) {
            console.warn(`Ticket ${orderId} no encontrado para la mesa activa. Se limpia el carrito para evitar heredar otra mesa.`);
            recordCheckoutDiagnostic('TABLE_CART_CLEAR', { items: cart, tableId: activeTable.id, orderId, reason: !orderId ? 'TABLE_WITHOUT_ORDER' : 'ORDER_NOT_FOUND' });
            onUpdateCart([]);
            if (!selectedCustomer) onSelectCustomer(null);
         }
         activeTableHydrationRef.current = { key: tableKey, missingTicket: true };
         return;
      }

      if (shouldHydrate) {
         const ticketItems = ticket.items || [];
         if (buildCartDigest(ticketItems) !== buildCartDigest(cart)) {
            recordCheckoutDiagnostic('TABLE_CART_REPLACE', { items: ticketItems, expectedItemCount: cart.length, tableId: activeTable.id, orderId, reason: 'TABLE_HYDRATION' });
            onUpdateCart(ticketItems);
         }
         if (ticket.customerId) {
            const customer = customers.find(c => c.id === ticket.customerId);
            if (customer) onSelectCustomer(customer);
         } else if (!selectedCustomer) {
            onSelectCustomer(null);
         }
         setOrderServiceType(ticket.serviceType || 'DINE_IN');
      }

      activeTableHydrationRef.current = { key: tableKey, missingTicket: false };
   }, [
      activeTable?.id,
      activeTable?.currentOrderId,
      parkedTickets,
      customers,
      selectedCustomer?.id,
      onUpdateCart,
      onSelectCustomer
   ]);

   const isMobile = useIsMobile(isTabletProfile ? 900 : 768);
   const tariffSelectorRef = useRef<HTMLDivElement>(null);

   const userPermissions = useMemo(() => {
      const rolesSource = roles || config.roles || [];
      const role = rolesSource.find(r => r.id === currentUser.roleId || r.id === currentUser.role);
      return role?.permissions || [];
   }, [config.roles, currentUser.role, currentUser.roleId, roles]);

   const hasPermission = useCallback(
      (perm: Permission) => userPermissions.includes('ALL') || userPermissions.includes(perm),
      [userPermissions]
   );

   const canChangeTariff = hasPermission('POS_CHANGE_TARIFF');
   const canCheckout = hasPermission('POS_CHECKOUT');
   const canSellWithOpenZ = hasPermission('POS_ALLOW_SALES_WITH_OPEN_Z');
   const canCloseXReport = !isOrderTakerMode && hasPermission('POS_CLOSE_X');
   const canCloseZReport = !isOrderTakerMode && hasPermission('POS_CLOSE_Z');
   const canRegisterCashMovement = hasPermission('CASH_IN_OUT' as Permission);
   const cartItemEditCapabilities = useMemo(
      () => resolveCartItemEditCapabilities(userPermissions),
      [userPermissions]
   );

   const usesSupermarketLayout = useMemo(
      () => Boolean(!isMobile && isRetailMode),
      [isMobile, isRetailMode]
   );

   const usesExpandedCatalog = useMemo(
      () => Boolean(!isMobile && (isRetailMode || isRestaurantMode || activeTerminalConfig?.operational?.expandTicket)),
      [activeTerminalConfig?.operational?.expandTicket, isMobile, isRestaurantMode, isRetailMode]
   );

   const gridClass = useMemo(() => {
      if (usesSupermarketLayout) {
        return "grid [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))] gap-4 md:gap-5 content-start auto-rows-fr";
      }
      if (usesExpandedCatalog) {
        return "absolute inset-0 grid min-h-0 grid-cols-4 gap-3 content-start overflow-y-auto px-4 py-3";
      }
      if (isMobile) {
         return "grid [grid-template-columns:repeat(auto-fill,minmax(138px,1fr))] gap-2.5 content-start";
      }
      if (uxConfig.gridDensity === 'COMPACT') {
         return "grid [grid-template-columns:repeat(auto-fill,minmax(145px,1fr))] gap-3 content-start";
      }
      return "grid [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))] gap-3 md:gap-4 content-start";
   }, [isMobile, usesExpandedCatalog, usesSupermarketLayout, uxConfig.gridDensity]);

   const expandedCatalogGridStyle = useMemo(
      () => usesExpandedCatalog
         ? {
            gridAutoRows: 'max(176px, calc((100% - 0.75rem) / 2))',
         } as React.CSSProperties
         : undefined,
      [usesExpandedCatalog]
   );

   const categoryContainerClass = useMemo(() => {
      if (usesSupermarketLayout) {
         return "hidden";
      }
      const scrollbarClass = uxConfig.quickKeysLayout === 'B' ? 'custom-scrollbar' : 'no-scrollbar';
      return `pos-category-strip bg-white border-b border-gray-200 px-3 md:px-8 py-2 md:py-3 grid grid-flow-col grid-rows-2 auto-cols-[112px] md:auto-cols-[132px] gap-x-3 gap-y-2 overflow-x-auto overflow-y-hidden shrink-0 ${scrollbarClass}`;
   }, [usesSupermarketLayout, uxConfig.quickKeysLayout]);

   const allowedTariffs = useMemo(() => {
      const allowedIds = activeTerminalConfig?.pricing?.allowedTariffIds || [];
      if (allowedIds.length === 0) return config.tariffs;
      const filteredTariffs = config.tariffs.filter(t => allowedIds.includes(t.id));
      return filteredTariffs.length > 0 ? filteredTariffs : config.tariffs;
   }, [config.tariffs, activeTerminalConfig]);

   const [activeTariffId, setActiveTariffId] = useState<string>(() => {
      return activeTerminalConfig?.pricing?.defaultTariffId || allowedTariffs[0]?.id || config.tariffs[0]?.id || '';
   });
   const desiredTariffId = useMemo(
      () => activeTerminalConfig?.pricing?.defaultTariffId || allowedTariffs[0]?.id || config.tariffs[0]?.id || '',
      [activeTerminalConfig?.pricing?.defaultTariffId, allowedTariffs, config.tariffs]
   );

   useEffect(() => {
      if (!desiredTariffId) return;

      const isCurrentAllowed = allowedTariffs.some((tariff) => tariff.id === activeTariffId);
      if (!activeTariffId || !isCurrentAllowed) {
         setActiveTariffId(desiredTariffId);
      }
   }, [activeTariffId, allowedTariffs, desiredTariffId]);

   const productPriceIndex = useMemo(() => {
      const index = new Map<string, number>();
      const normalizeToken = (value: unknown): string =>
         typeof value === 'string' ? value.trim().toLowerCase() : '';

      for (const record of productPrices) {
         if (!record || typeof record !== 'object') continue;
         const price = Number(record.price);
         if (!Number.isFinite(price)) continue;

         const productTokens = [
            record.productId,
            record.itemId,
            record.erpProductId,
            record.sourceProductId,
         ]
            .map(normalizeToken)
            .filter(Boolean);

         const tariffTokens = [
            record.tariffId,
            record.tariffCode,
         ]
            .map(normalizeToken)
            .filter(Boolean);

         for (const productToken of productTokens) {
            for (const tariffToken of tariffTokens) {
               index.set(`${productToken}::${tariffToken}`, price);
            }
         }
      }

      return index;
   }, [productPrices]);

   // FILTER: Only pending transactions (after latest Z close for this terminal)
   const terminalTransactions = useMemo(() => {
      const normalize = (value?: string | null) => (value || '').trim().toLowerCase();
      const terminalAliases = new Set(
         [
            terminalId,
            activeTerminalConfig?.erpTerminalId,
            activeTerminalConfig?.erpBinding?.terminalId,
            activeTerminalConfig?.erpBinding?.terminalName,
         ]
            .map(value => normalize(value))
            .filter(Boolean)
      );
      const isDefaultTerminal = terminalAliases.has('t1');
      const matchesTerminal = (...values: Array<string | null | undefined>) => {
         const normalizedValues = values.map(value => normalize(value)).filter(Boolean);
         return normalizedValues.some(value => terminalAliases.has(value)) || (isDefaultTerminal && normalizedValues.length === 0);
      };

      const latestCloseTs = (zReports || [])
         .filter(r => matchesTerminal(r.terminalId, (r as any).source_terminal_id))
         .map(r => new Date(r.closedAt).getTime())
         .filter((value) => Number.isFinite(value))
         .reduce((max, value) => value > max ? value : max, 0);

      return transactions
         .filter(t => {
            const belongsToTerminal = matchesTerminal(t.terminalId, (t as any).source_terminal_id);
            if (!belongsToTerminal) return false;
            if (t.zReportId) return false;

            const txTime = new Date(t.date).getTime();
            if (!Number.isFinite(txTime)) return latestCloseTs <= 0;
            return latestCloseTs <= 0 || txTime > latestCloseTs;
         })
         .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
   }, [activeTerminalConfig, transactions, terminalId, zReports]);

   const canProceedWithOperationalSession = useCallback(async (): Promise<boolean> => {
      // Una terminal de toma de pedidos no factura ni administra jornadas fiscales.
      // Guardar debe limitarse a enviar/aparcar el pedido en la Master.
      if (isOrderTakerMode) return true;
      if (!activeTerminalConfig || terminalTransactions.length === 0) return true;

      const sessionStartDate = terminalTransactions[0]?.date;
      if (!sessionStartDate) return true;

      if (!isSessionExpired(sessionStartDate, activeTerminalConfig)) return true;

      return await clicConfirm(
         "⚠️ ADVERTENCIA DE JORNADA\n\n" +
         "El sistema detecta que la jornada operativa ha cambiado (hay transacciones pendientes de jornadas anteriores).\n\n" +
         "¿Desea continuar facturando de todos modos?\n" +
         "(Seleccione 'Aceptar' para continuar, 'Cancelar' para ir a Cierre Z)"
      );
   }, [activeTerminalConfig, isOrderTakerMode, terminalTransactions]);

   const [showTariffSelector, setShowTariffSelector] = useState(false);
   const [productForModifiers, setProductForModifiers] = useState<Product | null>(null);
   const [isReturnMode, setIsReturnMode] = useState(false);
   const [errorToast, setErrorToast] = useState<string | null>(null);

   const ensureSalesWithOpenZPermission = useCallback((): boolean => {
      const sessionStartDate = terminalTransactions[0]?.date;
      const hasExpiredOperationalSession = Boolean(
         activeTerminalConfig &&
         sessionStartDate &&
         isSessionExpired(sessionStartDate, activeTerminalConfig)
      );
      if (!hasExpiredOperationalSession || canSellWithOpenZ) return true;
      setErrorToast('No puede facturar. Tiene una jornada anterior pendiente de cierre Z para esta caja.');
      window.setTimeout(() => setErrorToast(null), 3500);
      return false;
   }, [activeTerminalConfig, canSellWithOpenZ, terminalTransactions]);

   const activeTariff = useMemo(() => (config.tariffs || []).find(t => t.id === activeTariffId), [config.tariffs, activeTariffId]);

   const [searchTerm, setSearchTerm] = useState('');
   const [catalogSearchQuery, setCatalogSearchQuery] = useState('');
   useEffect(() => {
      const trace = searchFilterTraceRef.current;
      const timer = window.setTimeout(() => {
         markInteractionStage(trace, 'FILTER_START');
         if (trace) expectInteractionRender(trace, 'POS_INTERACTION_VIEW');
         setCatalogSearchQuery(searchTerm);
      }, 175);
      return () => window.clearTimeout(timer);
   }, [searchTerm]);

   const handleCatalogSearchInput = useCallback((value: string) => {
      const trace = beginPosInteraction('PRODUCT_SEARCH_INPUT', { inputLength: value.length });
      searchFilterTraceRef.current = trace;
      expectInteractionRender(trace, 'POS_INTERACTION_VIEW');
      setSearchTerm(value);
      markInteractionStateUpdate(trace, 1);
      markInteractionStage(trace, 'HANDLER_END');
   }, []);
   const [categoryFilter, setCategoryFilter] = useState('ALL');
   const [mobileView, setMobileView] = useState<'PRODUCTS' | 'TICKET'>('PRODUCTS');
   const returnToTicketView = useCallback(() => {
      setRightSidebarTab('CART');
      setMobileView('TICKET');
   }, []);

   const [showDiscountModal, setShowDiscountModal] = useState(false);
   // Acciones por línea del ticket denso (modo supermercado)
   const [lineDiscountCartId, setLineDiscountCartId] = useState<string | null>(null);
   const [sellerPickerCartId, setSellerPickerCartId] = useState<string | null>(null);
   const [showSplitModal, setShowSplitModal] = useState(false);
   const [showPaymentModal, setShowPaymentModal] = useState(false);

   // Canje EGO Club del ticket actual (ya autorizado por el ERP).
   const [loyaltyRedemption, setLoyaltyRedemption] = useState<LoyaltyRedemption | null>(null);
   const [showLoyaltyRedeemModal, setShowLoyaltyRedeemModal] = useState(false);
   const [productionRoutingPrompt, setProductionRoutingPrompt] = useState<ProductionRoutingPromptState | null>(null);
   const [returnToTableMapAfterPayment, setReturnToTableMapAfterPayment] = useState(false);

   // El canje sólo se ofrece si el ERP publica el canal de lealtad en esta caja.
   const loyaltyRedeemChannel = getLoyaltyChannelStatus('/loyalty/redeem');
   const [showTicketOptions, setShowTicketOptions] = useState(false);
   const [showParkedList, setShowParkedList] = useState(false);
   const [showParkAliasModal, setShowParkAliasModal] = useState(false);
   const [parkTicketAlias, setParkTicketAlias] = useState('');
   const [showGlobalDiscount, setShowGlobalDiscount] = useState(false);
   const [showCouponModal, setShowCouponModal] = useState(false);
   const [couponCode, setCouponCode] = useState('');
   const [redeemedCoupon, setRedeemedCoupon] = useState<RedeemedCouponRef | null>(null);

   const requestProductionRoutingDecision = useCallback((prompt: ProductionRoutingPromptState) => {
      productionRoutingPromptResolverRef.current?.({ kind: 'CANCEL' });
      setProductionRoutingPrompt(prompt);
      return new Promise<ProductionRoutingPromptDecision>((resolve) => {
         productionRoutingPromptResolverRef.current = resolve;
      });
   }, []);

   const resolveProductionRoutingPrompt = useCallback((decision: ProductionRoutingPromptDecision) => {
      const resolver = productionRoutingPromptResolverRef.current;
      productionRoutingPromptResolverRef.current = null;
      setProductionRoutingPrompt(null);
      resolver?.(decision);
   }, []);

   useEffect(() => () => {
      productionRoutingPromptResolverRef.current?.({ kind: 'CANCEL' });
      productionRoutingPromptResolverRef.current = null;
   }, []);
   const [showConsignmentModal, setShowConsignmentModal] = useState(false);
   const [consignmentSearchTerm, setConsignmentSearchTerm] = useState('');
   const [consignmentResults, setConsignmentResults] = useState<ErpConsignment[]>([]);
   const [selectedConsignment, setSelectedConsignment] = useState<ErpConsignment | null>(null);
   const [isSearchingConsignments, setIsSearchingConsignments] = useState(false);
   const [isLoadingConsignment, setIsLoadingConsignment] = useState(false);
   const [consignmentError, setConsignmentError] = useState<string | null>(null);

   const [syncState, setSyncState] = useState<SyncState>(backgroundSyncManager.getState());

   useEffect(() => {
      return backgroundSyncManager.subscribe(setSyncState);
   }, []);

   useEffect(() => {
      if (!canChangeTariff && showTariffSelector) {
         setShowTariffSelector(false);
      }
   }, [canChangeTariff, showTariffSelector]);

   useEffect(() => {
      if (!showTariffSelector) return;

      const handlePointerDown = (event: MouseEvent) => {
         if (!tariffSelectorRef.current?.contains(event.target as Node)) {
            setShowTariffSelector(false);
         }
      };

      document.addEventListener('mousedown', handlePointerDown);
      return () => document.removeEventListener('mousedown', handlePointerDown);
   }, [showTariffSelector]);
   const [globalDiscount, setGlobalDiscount] = useState<{ type: 'PERCENT' | 'FIXED', value: number }>({ type: 'PERCENT', value: 0 });
   const restoredParkedPricingRef = useRef<string | null>(null);

   useEffect(() => {
      if (!activeTable?.currentOrderId || cart.length > 0) return;
      const parked = parkedTickets.find(t => t.id === activeTable.currentOrderId);
      if (parked?.items?.length) {
         onUpdateCart(markRestaurantLinesCommitted(parked.items, parked.timestamp));
         return;
      }
      const ord = (transactions || []).find(t => t.id === activeTable.currentOrderId);
      if (ord?.items?.length) {
         onUpdateCart(markRestaurantLinesCommitted(ord.items));
      }
   }, [activeTable, parkedTickets, transactions, onUpdateCart, cart.length]);

   useEffect(() => {
      const orderId = String(activeTable?.currentOrderId || '').trim();
      if (!orderId) {
         restoredParkedPricingRef.current = null;
         setGlobalDiscount({ type: 'PERCENT', value: 0 });
         return;
      }

      const parked = parkedTickets.find(ticket => String(ticket.id) === orderId);
      if (!parked) return;
      const restoreKey = [
         orderId,
         parked.discountType || '',
         Number(parked.discountValue || 0),
         Number(parked.discountAmount || 0),
      ].join(':');
      if (restoredParkedPricingRef.current === restoreKey) return;

      const restoredType = parked.discountType === 'PERCENT' ? 'PERCENT' : 'FIXED';
      const restoredValue = Number(
         parked.discountValue ?? parked.discountAmount ?? 0
      );
      setGlobalDiscount({
         type: restoredType,
         value: Number.isFinite(restoredValue) ? Math.max(0, restoredValue) : 0,
      });
      setOrderServiceType(parked.serviceType || 'DINE_IN');
      restoredParkedPricingRef.current = restoreKey;
   }, [
      activeTable?.currentOrderId,
      parkedTickets,
   ]);

   const [editingItem, setEditingItem] = useState<CartItem | null>(null);
   const [activeCartItemId, setActiveCartItemId] = useState<string | null>(null);
   const [selectedProductForVariants, setSelectedProductForVariants] = useState<Product | null>(null);
   const [productForScale, setProductForScale] = useState<Product | null>(null);
   const [showLoyaltyModal, setShowLoyaltyModal] = useState(false);

   const [isScannerOpen, setIsScannerOpen] = useState(false);
   const [cameraAvailability, setCameraAvailability] = useState<CameraAvailability>('UNKNOWN');
   const scannerRef = useRef<Html5Qrcode | null>(null);
   const searchInputRef = useRef<HTMLInputElement>(null);
   const retailSearchInputRef = useRef<HTMLInputElement>(null);
   const parkAliasInputRef = useRef<HTMLInputElement>(null);
   const [showVirtualKeyboard, setShowVirtualKeyboard] = useState(false);

   useEffect(() => {
      if (activeDeviceProfile.formFactor !== DeviceFormFactor.DESKTOP_POS) {
         setCameraAvailability('UNKNOWN');
         return;
      }

      let cancelled = false;
      void detectCameraAvailability().then(result => {
         if (!cancelled) setCameraAvailability(result);
      });
      return () => {
         cancelled = true;
      };
   }, [activeDeviceProfile.formFactor]);

   const useDesktopSearchClearAction = shouldUseDesktopSearchClearAction(
      activeDeviceProfile.formFactor,
      cameraAvailability,
   );

   const clearCatalogSearch = useCallback(() => {
      searchFilterTraceRef.current = null;
      setSearchTerm('');
      setCatalogSearchQuery('');
      requestAnimationFrame(() => searchInputRef.current?.focus());
   }, []);

   const [fiscalStatus, setFiscalStatus] = useState<{
      type: FiscalDocumentCode;
      number?: string;
      rangeExpiry?: string;
      hasNCF: boolean;
      localBuffer: any;
      isUsingPool: boolean;
      isTerminalBlock?: boolean;
      remaining?: number;
      total?: number;
   }>({
      type: 'B02', hasNCF: false, localBuffer: null, isUsingPool: false
   });

   const [showSupervisorAuth, setShowSupervisorAuth] = useState(false);
   const [refundAuthorizedBy, setRefundAuthorizedBy] = useState<{ id: string, name: string } | null>(null);
   const [status, setStatus] = useState<{ isConnected: boolean, currentNCF: string, remaining: number, expiryDate: string, batteryLevel: number } | null>(null);

   // --- MOBILE ADAPTATION ---
   const bottomOverlayRefs = useMemo(
      () => [mobileFooterRef, mobileCartButtonRef, desktopActionGridRef],
      []
   );
   const posShellStyle = useMemo(
      () =>
         ({
            ['--bottom-bar-height' as string]: '0px',
            ['--bottom-safe-offset' as string]: '12px',
            ['--viewport-bottom-inset' as string]: '0px',
            ['--pos-viewport-height' as string]: '100dvh',
            height: 'var(--pos-viewport-height, 100dvh)',
            maxHeight: 'var(--pos-viewport-height, 100dvh)',
         }) as React.CSSProperties,
      []
   );
   const bottomAwareScrollStyle = useMemo(
      () =>
         ({
            paddingBottom: isMobile
               ? 'calc(var(--bottom-safe-offset, 12px) + env(safe-area-inset-bottom))'
               : usesExpandedCatalog
                  ? '0px'
                  : '1.25rem',
         }) as React.CSSProperties,
      [isMobile, usesExpandedCatalog]
   );
   const mobileFooterStyle = useMemo(
      () =>
         ({
            bottom: 'var(--viewport-bottom-inset, 0px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)',
         }) as React.CSSProperties,
      []
   );
   const mobileCartButtonStyle = useMemo(
      () =>
         ({
            bottom: 'calc(var(--viewport-bottom-inset, 0px) + env(safe-area-inset-bottom) + 1.5rem)',
         }) as React.CSSProperties,
      []
   );
   const [showMobileConfigModal, setShowMobileConfigModal] = useState(false);
   const [pendingProductToAdd, setPendingProductToAdd] = useState<Product | null>(null);
   const [pendingTrackingProduct, setPendingTrackingProduct] = useState<{ product: Product, quantity: number, price?: number, modifiers?: string[] } | null>(null);

   // --- SMART QR RETURNS ---
   const [showReturnModal, setShowReturnModal] = useState(false);
   const [returnInvoiceId, setReturnInvoiceId] = useState<string | null>(null);

   // --- PROMO BOTTOM SHEET ---
   const [showPromoSheet, setShowPromoSheet] = useState(false);
   const [selectedPromoProduct, setSelectedPromoProduct] = useState<Product | null>(null);

   const buildParkedTicketName = useCallback(() => {
      if (activeTable) {
         if (activeBarTabName) return activeBarTabName;
         return `Mesa: ${activeTableContext.compactLabel || activeTable.nombre || activeTable.name}`;
      }

      if (selectedCustomer?.name) {
         return selectedCustomer.name;
      }

      return `Ticket #${(Array.isArray(parkedTickets) ? parkedTickets : []).length + 1}`;
   }, [activeTable, activeBarTabName, activeTableContext.compactLabel, selectedCustomer, parkedTickets]);

   const closeParkAliasModal = useCallback(() => {
      setShowParkAliasModal(false);
      setParkTicketAlias('');
   }, []);

   const openParkAliasModal = useCallback(() => {
      if (cart.length === 0) return;

      const existingParked = activeTable?.currentOrderId
         ? parkedTickets.find((ticket) => ticket.id === activeTable.currentOrderId)
         : undefined;

      setParkTicketAlias(existingParked?.alias || '');
      setShowParkAliasModal(true);
   }, [activeTable, cart.length, parkedTickets]);

   useEffect(() => {
      if (!showParkAliasModal) return;

      const focusTimer = window.setTimeout(() => {
         parkAliasInputRef.current?.focus();
         parkAliasInputRef.current?.select();
      }, 40);

      return () => window.clearTimeout(focusTimer);
   }, [showParkAliasModal]);

   // --- RESERVAS / PRE-FACTURACION ---
   const [reservations, setReservations] = useState<Reservation[]>([]);
   const [showReservationModal, setShowReservationModal] = useState(false);
   const [showReservationReceipt, setShowReservationReceipt] = useState<Reservation | null>(null);
   const [isPrintingReservationReceipt, setIsPrintingReservationReceipt] = useState(false);
   const [showRecoverReservationModal, setShowRecoverReservationModal] = useState(false);
   const [reservationCustomerId, setReservationCustomerId] = useState<string>('');
   const [reservationAdvanceInput, setReservationAdvanceInput] = useState<string>('0');
   const [reservationDeliveryDate, setReservationDeliveryDate] = useState<string>('');
   const [reservationSearchTerm, setReservationSearchTerm] = useState<string>('');
   const [reservationCustomerFilterId, setReservationCustomerFilterId] = useState<string | null>(null);
   const [activeRecoveredReservation, setActiveRecoveredReservation] = useState<Reservation | null>(null);
   const [uberPendingOrders, setUberPendingOrders] = useState<UberEatsPendingOrder[]>([]);
   const [isLoadingUberPendingOrders, setIsLoadingUberPendingOrders] = useState(false);
   const [uberPendingOrdersError, setUberPendingOrdersError] = useState<string | null>(null);
   const [committedByProduct, setCommittedByProduct] = useState<Record<string, number>>({});

   useBottomSafeOffset({
      rootRef: posRootRef,
      overlayRefs: bottomOverlayRefs,
      dependencyKey: `${isMobile}-${mobileView}-${usesExpandedCatalog}`,
   });

   // --- SUPERVISOR AUTH ---
   const { requestApproval, supervisorModalProps } = useSupervisorAuth({
      config,
      currentUser,
      roles,
      onUpdateConfig
   });
   const hasSubtotalizedCart = useMemo(
      () => cart.some(item => Boolean(item.subtotalizedAt)),
      [cart]
   );

   const authorizeSubtotalizedEdit = useCallback(async (actionDescription: string): Promise<boolean> => {
      if (!hasSubtotalizedCart) return true;
      return requestApproval({
         permission: 'POS_EDIT_SUBTOTALIZED_TICKET',
         actionDescription,
         context: {
            ticketId: activeTable?.currentOrderId,
            reason: 'Modificación posterior a la impresión del subtotal'
         }
      });
   }, [activeTable?.currentOrderId, hasSubtotalizedCart, requestApproval]);

   // Credit Control (CxC) - Simple Check
   const isDelinquent = useMemo(() => {
      if (!effectiveSelectedCustomer) return false;
      const debt = effectiveSelectedCustomer.currentDebt || 0;
      const limit = effectiveSelectedCustomer.creditLimit || 0;
      // If limit is 0, meaningful credit check might be disabled or unlimited depending on business logic. 
      // Assuming strict: debt > limit and limit > 0
      if (limit > 0 && debt >= limit) return true;
      return false;
   }, [effectiveSelectedCustomer]);

   const reloadCommitments = useCallback(async () => {
      const commitments = await db.get('inventoryCommitments') as any[] || [];
      const map: Record<string, number> = {};
      (commitments || []).forEach(row => {
         const rowWarehouseKey = normalizeScopeKey(row.warehouseId);
         if (rowWarehouseKey && effectiveWarehouseKeys.size > 0 && !effectiveWarehouseKeys.has(rowWarehouseKey)) return;
         map[row.productId] = (map[row.productId] || 0) + Math.max(0, Number(row.qtyCommitted || 0));
      });
      setCommittedByProduct(map);
   }, [effectiveWarehouseKeys, normalizeScopeKey]);

   const reloadReservations = useCallback(async () => {
      const loaded = await db.get('reservations') as Reservation[] || [];
      setReservations((loaded || []).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      await reloadCommitments();
   }, [reloadCommitments]);

   const expireReservationsIfNeeded = useCallback(async () => {
      const loaded = await db.get('reservations') as Reservation[] || [];
      const now = Date.now();
      const expired = (loaded || []).filter(r => r.status === 'ACTIVE' && new Date(r.expiryDate).getTime() < now);
      if (expired.length === 0) {
         setReservations((loaded || []).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
         await reloadCommitments();
         return;
      }

      for (const reservation of expired) {
         const warehouseId = reservation.warehouseId || defaultSalesWarehouseId || 'wh_central';
         await transferStockToCommitted(reservation.items || [], warehouseId, products, 'RELEASE');
         await db.saveDocument('reservations', {
            ...reservation,
            status: 'EXPIRED',
            expiredAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
         });
      }

      const refreshed = await db.get('reservations') as Reservation[] || [];
      setReservations((refreshed || []).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      await reloadCommitments();
      setErrorToast(`${expired.length} reserva(s) vencida(s). Stock comprometido liberado.`);
      setTimeout(() => setErrorToast(null), 4000);
   }, [defaultSalesWarehouseId, products, reloadCommitments]);

   useEffect(() => {
      reloadReservations().catch(console.error);
      expireReservationsIfNeeded().catch(console.error);

      const timer = window.setInterval(() => {
         expireReservationsIfNeeded().catch(console.error);
      }, 60000);

      return () => window.clearInterval(timer);
   }, [reloadReservations, expireReservationsIfNeeded]);

   const closeRecoverReservationModal = useCallback(() => {
      setShowRecoverReservationModal(false);
      setReservationSearchTerm('');
      setReservationCustomerFilterId(null);
   }, []);

   const openRecoverReservationModal = useCallback(() => {
      setIncomingUberToast(null);
      setReservationSearchTerm('');
      setReservationCustomerFilterId(null);
      setShowRecoverReservationModal(true);
   }, []);

   const openRecoverReservationForSelectedCustomer = useCallback(() => {
      if (!selectedCustomer) {
         openRecoverReservationModal();
         return;
      }
      setReservationSearchTerm('');
      setReservationCustomerFilterId(selectedCustomer.id);
      setShowRecoverReservationModal(true);
   }, [selectedCustomer, openRecoverReservationModal]);

   const showShortErrorToast = useCallback((message: string) => {
      setErrorToast(message);
      window.setTimeout(() => setErrorToast(null), 4000);
   }, []);

   const blockRecoveredUberOrderMutation = useCallback((actionLabel: string) => {
      if (!isUberRecoveredReservation(activeRecoveredReservation)) return false;
      showShortErrorToast(`El pedido Uber Eats recuperado no permite ${actionLabel}. Factúralo directamente para mantener la trazabilidad.`);
      return true;
   }, [activeRecoveredReservation, showShortErrorToast]);

   const loadUberPendingOrders = useCallback(async (
      options?: { silent?: boolean }
   ): Promise<UberEatsPendingOrder[] | null> => {
      const silent = options?.silent === true;
      if (!silent) {
         setIsLoadingUberPendingOrders(true);
         setUberPendingOrdersError(null);
      }

      try {
         const context = resolveUberEatsPosContext(config, activeTerminalId);
         const orders = await fetchUberEatsPendingOrders(context, 25);
         setUberPendingOrders(orders);
         return orders;
      } catch (error: any) {
         console.warn('⚠️ POSInterface: No se pudieron cargar órdenes Uber Eats pendientes:', error);
         if (!silent) {
            setUberPendingOrders([]);
            setUberPendingOrdersError(error?.message || 'No se pudieron cargar los pedidos Uber Eats.');
         }
         return null;
      } finally {
         if (!silent) {
            setIsLoadingUberPendingOrders(false);
         }
      }
   }, [activeTerminalId, config]);

   const findUberTransactionByOrderId = useCallback((sourceOrderId: string): Transaction | undefined => {
      const normalizedOrderId = String(sourceOrderId || '').trim();
      if (!normalizedOrderId) return undefined;

      return (transactions || []).find((transaction) => {
         const orderId = String(transaction.marketplaceSourceOrderId || transaction.reservationId || '').trim();
         const channel = String(transaction.marketplaceSourceChannel || '').trim().toUpperCase();
         if (!orderId || orderId !== normalizedOrderId) return false;
         if (channel && channel !== 'UBER_EATS') return false;
         return true;
      });
   }, [transactions]);

   const resolveUberDraftProduct = useCallback((draftItem: UberEatsPosDraft['items'][number]): Product | null => {
      const rawItem = draftItem?.raw && typeof draftItem.raw === 'object' ? draftItem.raw : {};
      const externalDataRaw = typeof (rawItem as any).external_data === 'string'
         ? String((rawItem as any).external_data)
         : '';
      let externalData: Record<string, unknown> = {};

      if (externalDataRaw) {
         try {
            const parsed = JSON.parse(externalDataRaw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
               externalData = parsed as Record<string, unknown>;
            }
         } catch {
            // Ignore malformed external_data payloads.
         }
      }

      const candidateTokens = [
         draftItem.external_item_id,
         draftItem.erp_item_id,
         draftItem.sku,
         (rawItem as any).id,
         (rawItem as any).sku,
         (rawItem as any).code,
         (rawItem as any).item_code,
         externalData.item_id,
         externalData.erp_item_id,
         externalData.external_code,
         externalData.sku,
      ]
         .map(normalizeSearchToken)
         .filter(Boolean);

      for (const token of candidateTokens) {
         const matched = marketplaceProductLookup.byReference.get(token);
         if (matched) return matched;
      }

      return marketplaceProductLookup.byName.get(normalizeSearchToken(draftItem.name)) || null;
   }, [marketplaceProductLookup]);

   const persistUberConfirmationState = useCallback(async (
      transaction: Transaction,
      status: NonNullable<Transaction['erpConfirmationStatus']>,
      errorMessage?: string
   ) => {
      try {
         await db.saveDocument('transactions', {
            ...transaction,
            erpConfirmationStatus: status,
            erpConfirmationError: errorMessage,
            erpConfirmedAt: status === 'SYNCED' ? new Date().toISOString() : transaction.erpConfirmedAt,
         });
      } catch (error) {
         console.warn('⚠️ POSInterface: No se pudo persistir estado de confirmación Uber Eats:', error);
      }
   }, []);

   const confirmExistingUberTransaction = useCallback(async (
      sourceOrderId: string,
      transaction: Transaction
   ): Promise<boolean> => {
      try {
         const context = resolveUberEatsPosContext(config, activeTerminalId);
         await confirmUberEatsPosInvoice(context, sourceOrderId, {
            id: transaction.id,
            displayId: transaction.displayId,
         });
         await persistUberConfirmationState(transaction, 'SYNCED');
         setSuccessToast(`ERP confirmado para Uber Eats ${transaction.displayId || sourceOrderId}`);
         await loadUberPendingOrders();
         return true;
      } catch (error: any) {
         await persistUberConfirmationState(transaction, 'ERROR', error?.message || 'No se pudo confirmar la factura Uber Eats.');
         showShortErrorToast(error?.message || 'No se pudo confirmar la factura Uber Eats en ERP.');
         return false;
      }
   }, [activeTerminalId, config, loadUberPendingOrders, persistUberConfirmationState, showShortErrorToast]);

   const handleRecoverReservation = useCallback((reservation: Reservation) => {
      const hydratedItems = (reservation.items || []).map((item, idx) => ({
         ...item,
         cartId: `RSV-${reservation.id}-${idx}-${Date.now()}`
      }));

      onUpdateCart(hydratedItems);
      const customer = customers.find(c => c.id === reservation.customerId) || null;
      onSelectCustomer(customer);
      setActiveRecoveredReservation(reservation);
      setOrderServiceType('DINE_IN');
      closeRecoverReservationModal();
      setSuccessToast(`Reserva ${reservation.code} cargada`);
   }, [customers, onSelectCustomer, onUpdateCart, closeRecoverReservationModal]);

   const handleRecoverUberOrder = useCallback(async (order: UberEatsPendingOrder) => {
      const existingTransaction = findUberTransactionByOrderId(order.uberOrderId);
      if (existingTransaction) {
         const confirmed = await confirmExistingUberTransaction(order.uberOrderId, existingTransaction);
         if (confirmed) {
            closeRecoverReservationModal();
         }
         return;
      }

      setIsLoadingUberPendingOrders(true);
      try {
         const context = resolveUberEatsPosContext(config, activeTerminalId);
         const draft = await fetchUberEatsOrderDraft(context, order.uberOrderId);

         if (context.storeId && draft.store_id && context.storeId !== draft.store_id) {
            throw new Error('La orden Uber Eats pertenece a otra tienda ERP y no puede facturarse en esta caja.');
         }

         const unmatchedItems: string[] = [];
         const hydratedItems = draft.items.map((item, idx) => {
            const localProduct = resolveUberDraftProduct(item);
            if (!localProduct) {
               unmatchedItems.push(item.name || `Línea ${idx + 1}`);
               return null;
            }

            const modifierNames = Array.isArray(item.modifiers)
               ? item.modifiers.map((modifier) => String(modifier?.name || '').trim()).filter(Boolean)
               : [];

            return {
               ...localProduct,
               cartId: `UBER-${draft.source_order_id}-${idx}-${Date.now()}`,
               name: item.name || localProduct.name,
               price: Number(item.unit_price || localProduct.price || 0),
               originalPrice: Number(item.unit_price || localProduct.price || 0),
               quantity: Number(item.quantity || 0),
               note: `Uber Eats ${order.displayId || draft.source_order_id}`,
               modifiers: modifierNames,
            };
         }).filter(Boolean) as CartItem[];

         if (unmatchedItems.length > 0) {
            throw new Error(`Faltan artículos en POS para facturar Uber Eats: ${unmatchedItems.join(', ')}`);
         }

         const total = Number(draft.totals?.total || hydratedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0));
         const displayCode = order.displayId || draft.source_order_id.slice(-5).toUpperCase();
         const now = new Date().toISOString();
         const prepaidPayment = draft.payments?.[0];
         const recoveredOrder: Reservation = {
            id: `UBER-${draft.source_order_id}`,
            code: `UE-${displayCode}`,
            qrPayload: JSON.stringify({ type: 'UBER_EATS_ORDER', orderId: draft.source_order_id, displayId: displayCode }),
            customerId: draft.source_order_id,
            customerName: draft.customer?.name || 'Cliente Uber Eats',
            total,
            balancePaid: total,
            expiryDate: now,
            status: 'ACTIVE',
            items: hydratedItems,
            terminalId,
            createdById: currentUser.id,
            createdByName: currentUser.name,
            createdAt: now,
            updatedAt: now,
            sourceChannel: 'UBER_EATS',
            sourceOrderId: draft.source_order_id,
            sourceStoreId: draft.source_store_id,
            tenantId: draft.tenant_id,
            companyId: draft.company_id,
            storeId: draft.store_id,
            sourceStatus: draft.status,
            prepaidPayment: {
               method: 'UBER_EATS',
               label: prepaidPayment?.label || 'Uber Eats',
               amount: Number(prepaidPayment?.amount || total),
               externalReference: prepaidPayment?.external_reference || draft.source_order_id,
            },
         };

         onUpdateCart(hydratedItems);
         onSelectCustomer(null);
         setActiveRecoveredReservation(recoveredOrder);
         setOrderServiceType('DELIVERY');
         setRightSidebarTab('CART');
         closeRecoverReservationModal();
         setSuccessToast(`Pedido Uber Eats ${displayCode} cargado`);
      } catch (error: any) {
         showShortErrorToast(error?.message || 'No se pudo cargar la orden Uber Eats.');
      } finally {
         setIsLoadingUberPendingOrders(false);
      }
   }, [
      activeTerminalId,
      closeRecoverReservationModal,
      config,
      confirmExistingUberTransaction,
      currentUser.id,
      currentUser.name,
      onSelectCustomer,
      onUpdateCart,
      resolveUberDraftProduct,
      setRightSidebarTab,
      showShortErrorToast,
      terminalId,
      findUberTransactionByOrderId,
   ]);

   const activeReservations = useMemo(() => {
      return (reservations || []).filter(r => r.status === 'ACTIVE');
   }, [reservations]);

   useEffect(() => {
      if (!showRecoverReservationModal) return;
      loadUberPendingOrders().catch(console.error);
   }, [showRecoverReservationModal, loadUberPendingOrders]);

   useEffect(() => {
      knownUberOrderIdsRef.current = new Set();
      uberOrdersMonitorPrimedRef.current = false;
      setIncomingUberToast(null);
   }, [activeTerminalId]);

   useEffect(() => {
      let cancelled = false;
      let intervalId: number | null = null;

      const pollUberPendingOrders = async () => {
         const orders = await loadUberPendingOrders({ silent: true });
         if (cancelled || !orders) return;

         const currentIds = new Set(orders.map((order) => order.uberOrderId).filter(Boolean));
         if (!uberOrdersMonitorPrimedRef.current) {
            knownUberOrderIdsRef.current = currentIds;
            uberOrdersMonitorPrimedRef.current = true;
            return;
         }

         const newOrders = orders.filter((order) => !knownUberOrderIdsRef.current.has(order.uberOrderId));
         knownUberOrderIdsRef.current = currentIds;

         if (newOrders.length === 0) return;

         if (shouldShowUberToastAlerts) {
            setIncomingUberToast({
               count: newOrders.length,
               displayIds: newOrders.map((order) => order.displayId || order.uberOrderId).filter(Boolean).slice(0, 3),
            });
         }

         if (shouldAutoOpenUberModal && !showRecoverReservationModal) {
            openRecoverReservationModal();
         }
      };

      try {
         resolveUberEatsPosContext(config, activeTerminalId);
      } catch {
         return;
      }

      void pollUberPendingOrders();
      intervalId = window.setInterval(() => {
         void pollUberPendingOrders();
      }, 30000);

      return () => {
         cancelled = true;
         if (intervalId) window.clearInterval(intervalId);
      };
   }, [
      activeTerminalId,
      config,
      loadUberPendingOrders,
      openRecoverReservationModal,
      shouldAutoOpenUberModal,
      shouldShowUberToastAlerts,
      showRecoverReservationModal,
   ]);

   const activeReservationByScanCode = useMemo(() => {
      const index = new Map<string, Reservation>();
      for (const reservation of activeReservations || []) {
         if (reservation.id) index.set(String(reservation.id), reservation);
         if (reservation.code) index.set(String(reservation.code), reservation);
      }
      return index;
   }, [activeReservations]);

   const transactionByScanCode = useMemo(() => {
      const index = new Map<string, Transaction>();
      for (const transaction of transactions || []) {
         if (transaction.id) index.set(String(transaction.id), transaction);
         if (transaction.displayId) index.set(String(transaction.displayId), transaction);
         if ((transaction as any).ncf) index.set(String((transaction as any).ncf), transaction);
         if ((transaction as any).electronicNcf) index.set(String((transaction as any).electronicNcf), transaction);
      }
      return index;
   }, [transactions]);

   const selectedCustomerActiveReservationsCount = useMemo(() => {
      if (!selectedCustomer) return 0;
      return activeReservations.filter(r => r.customerId === selectedCustomer.id).length;
   }, [activeReservations, selectedCustomer]);

   const reservationFilterCustomerName = useMemo(() => {
      if (!reservationCustomerFilterId) return '';
      if (selectedCustomer?.id === reservationCustomerFilterId) return selectedCustomer.name;
      const fromCustomers = customers.find(c => c.id === reservationCustomerFilterId)?.name;
      if (fromCustomers) return fromCustomers;
      return activeReservations.find(r => r.customerId === reservationCustomerFilterId)?.customerName || 'Cliente';
   }, [reservationCustomerFilterId, selectedCustomer, customers, activeReservations]);

   const filteredActiveReservations = useMemo(() => {
      const scoped = reservationCustomerFilterId
         ? activeReservations.filter(r => r.customerId === reservationCustomerFilterId)
         : activeReservations;

      const term = reservationSearchTerm.trim().toLowerCase();
      if (!term) return scoped;
      return scoped.filter(r =>
         r.customerName.toLowerCase().includes(term) ||
         (r.customerId || '').toLowerCase().includes(term) ||
         r.code.toLowerCase().includes(term) ||
         r.id.toLowerCase().includes(term)
      );
   }, [activeReservations, reservationSearchTerm, reservationCustomerFilterId]);

   const filteredUberPendingOrders = useMemo(() => {
      if (reservationCustomerFilterId) return [];

      const term = reservationSearchTerm.trim().toLowerCase();
      if (!term) return uberPendingOrders;

      return uberPendingOrders.filter((order) => {
         return [
            order.customerName,
            order.displayId,
            order.uberOrderId,
            order.status,
         ].some((value) => normalizeSearchToken(value).includes(term));
      });
   }, [reservationCustomerFilterId, reservationSearchTerm, uberPendingOrders]);

   const recoverableOrders = useMemo<RecoverableOrderEntry[]>(() => {
      return [
         ...filteredUberPendingOrders.map((order) => ({ kind: 'UBER_EATS' as const, order })),
         ...filteredActiveReservations.map((reservation) => ({ kind: 'RESERVATION' as const, reservation })),
      ];
   }, [filteredActiveReservations, filteredUberPendingOrders]);

   const handleRedeemCoupon = () => {
      if (blockRecoveredUberOrderMutation('aplicar cupones')) return;

      const normalizedCouponCode = couponCode.trim().toUpperCase();
      if (!normalizedCouponCode) return;

      if (redeemedCoupon) {
         alert(`Ya hay un cupón aplicado en este ticket: ${redeemedCoupon.code}. Finalice o limpie el ticket antes de aplicar otro.`);
         return;
      }

      const cartSubtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      if (!Number.isFinite(cartSubtotal) || cartSubtotal <= 0) {
         alert('Agregue al menos un artículo antes de aplicar el cupón.');
         return;
      }

      const result = couponService.validateCoupon(
         normalizedCouponCode,
         config,
         cartSubtotal,
         effectiveSelectedCustomer?.id
      );

      if (result.success) {
         if (result.benefit) {
            if (result.benefit.type === 'PERCENT') {
               setGlobalDiscount({ type: 'PERCENT', value: result.benefit.value });
            } else if (result.benefit.type === 'FIXED_AMOUNT') {
               setGlobalDiscount({ type: 'FIXED', value: result.benefit.value });
            }
            if (result.coupon) {
               setRedeemedCoupon({
                  id: result.coupon.id,
                  code: result.coupon.code,
                  campaignId: result.coupon.campaignId,
                  assignedTo: result.coupon.assignedTo
               });
            }
            alert(`¡Cupón Aplicado!\n${result.benefit.description}`);
            setShowCouponModal(false);
            setCouponCode('');
            returnToTicketView();
         }
      } else {
         alert(`Error: ${result.error}`);
      }
   };

   const commitAppliedCoupon = useCallback((transaction?: Transaction | null) => {
      if (!redeemedCoupon || !transaction) return;

      onUpdateConfig(couponService.commitCouponRedemption(
         redeemedCoupon.id,
         transaction.displayId || transaction.id,
         terminalId,
         config
      ));
   }, [config, onUpdateConfig, redeemedCoupon, terminalId]);

   const activeTariffTokens = useMemo(
      () => new Set([activeTariffId, activeTariff?.id, (activeTariff as any)?.code].map(normalizeSearchToken).filter(Boolean)),
      [activeTariffId, activeTariff]
   );

   const productTariffPriceById = useMemo(() => {
      const index = new Map<string, number | null>();
      for (const product of products || []) {
         if (!product?.id) continue;
         index.set(product.id, resolveActiveTariffPrice(product, activeTariffTokens, productPriceIndex));
      }
      return index;
   }, [activeTariffTokens, productPriceIndex, products]);

   const getTariffPrice = useCallback((p: Product) => {
      if (p?.id && productTariffPriceById.has(p.id)) {
         return productTariffPriceById.get(p.id) ?? null;
      }
      return resolveActiveTariffPrice(p, activeTariffTokens, productPriceIndex);
   }, [activeTariffTokens, productPriceIndex, productTariffPriceById]);

   const productHasBasePrice = useCallback((p: Product) => {
      const price = Number(p?.price);
      return Number.isFinite(price) && price >= 0;
   }, []);

   const productHasActiveTariff = useCallback((p: Product) => getTariffPrice(p) !== null || productHasBasePrice(p), [getTariffPrice, productHasBasePrice]);

   const getProductPrice = useCallback((p: Product) => {
      const tariffPrice = getTariffPrice(p);
      if (tariffPrice !== null) return tariffPrice;
      const basePrice = Number(p?.price);
      return Number.isFinite(basePrice) && basePrice >= 0 ? basePrice : 0;
   }, [getTariffPrice]);

   const productCodeIndex = useMemo(() => {
      const index = new Map<string, { product: Product; price: number; modifiers: string[]; selectedVariant?: ProductVariant; variantInfo?: string }>();
      const addCode = (code: unknown, value: { product: Product; price: number; modifiers: string[]; selectedVariant?: ProductVariant; variantInfo?: string }) => {
         if (Array.isArray(code)) {
            code.forEach((entry) => addCode(entry, value));
            return;
         }
         const normalized = String(code || '').trim();
         if (!normalized || index.has(normalized)) return;
         index.set(normalized, value);
      };

      for (const product of products || []) {
         if (!product || !productHasActiveTariff(product)) continue;
         const baseMatch = { product, price: getProductPrice(product), modifiers: [] as string[] };
         addCode(product.id, baseMatch);
         addCode(product.barcode, baseMatch);
         addCode((product as any).sku, baseMatch);
         addCode((product as any).item_code, baseMatch);
         addCode((product as any).code, baseMatch);

         for (const variant of product.variants || []) {
            const modifiersList = Object.values(variant.attributeValues || {}).map((value) => String(value || ''));
            const variantInfo = Object.entries(variant.attributeValues || {})
               .map(([key, value]) => `${key}: ${value}`)
               .join(' · ');
            const variantMatch = {
               product,
               price: resolveVariantSalesPrice(variant, baseMatch.price),
               modifiers: modifiersList,
               selectedVariant: variant,
               variantInfo,
            };
            addCode(variant.sku, variantMatch);
            addCode(variant.barcode, variantMatch);
         }
      }

      return index;
   }, [getProductPrice, productHasActiveTariff, products]);

   const handleLoyaltyScan = useCallback((code: string) => {
      // Find customer by loyalty card or gift card
      const customer = (customers || []).find(c =>
         c.cards?.some(card => card.cardNumber === code && card.status === 'ACTIVE') ||
         c.loyalty?.cardNumber === code // Backward compatibility
      );

      if (customer) {
         onSelectCustomer(customer);
         setShowLoyaltyModal(false);
         // Optional: Show success toast/alert
         // alert(`Cliente asignado: ${customer.name}`);
      } else {
         alert("Tarjeta no encontrada o inactiva.");
      }
   }, [customers, onSelectCustomer]);

   const getCartInventoryDemandByProduct = useCallback((items: CartItem[]): Record<string, number> => {
      const demand: Record<string, number> = {};

      for (const cartItem of items || []) {
         const quantity = Number(cartItem.quantity || 0);
         if (quantity <= 0) continue;

         const deductions = calculateInventoryDeductions(cartItem, quantity, products);
         for (const deduction of deductions) {
            demand[deduction.productId] = (demand[deduction.productId] || 0) + Math.max(0, Number(deduction.quantityToDeduct || 0));
         }
      }

      return demand;
   }, [products]);

   const cartInventoryDemandByProduct = useMemo(
      () => getCartInventoryDemandByProduct(cart as CartItem[]),
      [cart, getCartInventoryDemandByProduct]
   );

   const cartQuantityByProduct = useMemo(() => {
      const quantities: Record<string, number> = {};
      for (const item of cart || []) {
         if (!item?.id) continue;
         quantities[item.id] = (quantities[item.id] || 0) + Number(item.quantity || 0);
      }
      return quantities;
   }, [cart]);

   const canAddItemToCart = useCallback((product: Product, quantityToAdd: number = 1, options?: { skipStockValidation?: boolean }): boolean => {
      // 0. Sellable check
      if (product.is_sellable === false) {
         setErrorToast(`Artículo no disponible para la venta (Insumo)`);
         setTimeout(() => setErrorToast(null), 3500);
         return false;
      }

      if (!productHasActiveTariff(product)) {
         setErrorToast('Artículo no disponible en la tarifa activa.');
         setTimeout(() => setErrorToast(null), 3500);
         return false;
      }

      const activeWarehouses = resolveProductActiveWarehouseIds(product, warehouses);
      if (activeWarehouses.length === 0) {
         setErrorToast('Artículo sin almacén asignado. Configure el producto antes de venderlo.');
         setTimeout(() => setErrorToast(null), 3500);
         return false;
      }

      // 1. Warehouse enablement check
      if (!productMatchesTerminalWarehouse(product)) {
         setErrorToast(`Artículo no habilitado en este almacén. (${getTerminalWarehouseName()})`);
         setTimeout(() => setErrorToast(null), 3500);
         return false;
      }

      // 2. Stock validation
      const trackInventory = product.operationalFlags?.trackInventory ?? config.features?.stockTracking ?? false;
      if (trackInventory && !options?.skipStockValidation) {
         const consumptionMode = resolveInventoryConsumptionMode(product);
         if (consumptionMode === 'COMPONENTS' && quantityToAdd > 0) {
            const componentDeductions = calculateInventoryDeductions(product, quantityToAdd, products);
            const consolidatedDemand = componentDeductions.reduce<Record<string, number>>((acc, row) => {
               acc[row.productId] = (acc[row.productId] || 0) + Math.max(0, Number(row.quantityToDeduct || 0));
               return acc;
            }, {});

            for (const [componentId, qtyNeeded] of Object.entries(consolidatedDemand)) {
               const component = productById.get(componentId);
               if (!component) {
                  setErrorToast(`El kit ${product.name} no tiene completos sus componentes en POS.`);
                  setTimeout(() => setErrorToast(null), 3500);
                  return false;
               }

               const currentStock = getScopedProductStock(component);
               const componentAllowsNegative = component.operationalFlags?.allowNegativeStock ?? false;
               const terminalAllowsNegative = activeTerminalConfig?.workflow?.inventory?.allowNegativeStock ?? false;
               if (componentAllowsNegative || terminalAllowsNegative) continue;
               const committedQty = committedByProduct[componentId] || 0;
               const inCartQty = cartInventoryDemandByProduct[componentId] || 0;
               const availableStock = Math.max(0, currentStock - committedQty);
               const totalRequested = inCartQty + qtyNeeded;

               if (totalRequested > availableStock) {
                  setErrorToast(`Stock insuficiente en componente ${component.name}. Disponible: ${availableStock}. Requerido: ${totalRequested}`);
                  setTimeout(() => setErrorToast(null), 3500);
                  return false;
               }
            }

            return true;
         }

         const productAllowsNegative = product.operationalFlags?.allowNegativeStock ?? false;
         const terminalAllowsNegative = activeTerminalConfig?.workflow?.inventory?.allowNegativeStock ?? false;

         // If negative stock is not allowed by the product nor the terminal, check availability.
         if (!productAllowsNegative && !terminalAllowsNegative) {
            const currentStock = getScopedProductStock(product);
            const committedQty = committedByProduct[product.id] || 0;
            const availableStock = Math.max(0, currentStock - committedQty);
            const inCartQty = cartQuantityByProduct[product.id] || 0;
            const totalRequested = inCartQty + quantityToAdd;

            if (totalRequested > availableStock) {
               setErrorToast(`Stock insuficiente. Disponible: ${availableStock}. En carrito: ${inCartQty}`);
               setTimeout(() => setErrorToast(null), 3500);
               return false;
            }
         }
      }

      return true;
   }, [activeTerminalConfig, cartInventoryDemandByProduct, cartQuantityByProduct, committedByProduct, config.features?.stockTracking, getScopedProductStock, getTerminalWarehouseName, productById, productHasActiveTariff, productMatchesTerminalWarehouse, products, warehouses]);

   const [lastAddedCartId, setLastAddedCartId] = useState<string | null>(null);

   const addToCart = useCallback(async (product: Product, quantity: number = 1, priceOverride?: number, modifiers?: string[], trackingData?: any[], selectedVariant?: ProductVariant, variantInfo?: string, note?: string, restaurantConfig?: CartItem['restaurantConfig'], consignmentPatch?: Pick<CartItem, 'consignmentId' | 'consignmentDocumentNo' | 'consignmentLineId'>) => {
      const trace = activeAddTraceRef.current || beginPosInteraction('ADD_TICKET_ITEM', { source: 'programmatic', productId: product.id });
      activeAddTraceRef.current = trace;
      expectInteractionRender(trace, 'POS_INTERACTION_VIEW');
      try {
      if (blockRecoveredUberOrderMutation('agregar artículos adicionales')) return;
      if (!(await authorizeSubtotalizedEdit('Agregar artículo a ticket subtotalizado'))) return;
      if (quantity > 0 && !ensureSalesWithOpenZPermission()) return;
      if (!canAddItemToCart(product, quantity, { skipStockValidation: Boolean(consignmentPatch?.consignmentLineId) })) return;

      // TRACEABILITY INTERCEPTION
      const usesLots = product.operationalFlags?.usesLots;
      const usesSerial = product.operationalFlags?.usesSerial;
      if ((usesLots || usesSerial) && !trackingData) {
         setPendingTrackingProduct({ product, quantity, price: priceOverride, modifiers });
         return;
      }

      const finalPrice = priceOverride ?? resolveVariantSalesPrice(selectedVariant, getProductPrice(product));
      const lineIdentityKey = productLineIdentityKey(product, finalPrice);
      const consignmentIdentityKey = consignmentPatch?.consignmentLineId || '';
      const modifiersString = buildModifierSignature(modifiers);
      const variantSku = selectedVariant?.sku;
      const variantId = selectedVariant?.id || selectedVariant?.variantId;
      const variantBarcodes = Array.isArray(selectedVariant?.barcode)
         ? selectedVariant.barcode.map((value) => String(value || '').trim()).filter(Boolean)
         : [];
      const effectiveTaxIds = resolveEffectiveTaxIds(product.appliedTaxIds, activeTerminalConfig);
      const taxSignature = effectiveTaxIds.slice().sort().join('|');
      const productRestaurantConfig = resolveRestaurantProductConfig(product);
      const productionAreaId = resolveProductionAreaId(product);
      const lineRestaurantConfig = restaurantConfig
         ? {
            ...restaurantConfig,
            product_type: restaurantConfig.product_type || productRestaurantConfig.product_type,
            production_area_id: restaurantConfig.production_area_id || productionAreaId || undefined,
         }
         : undefined;

      // We look for existing item in the stable 'cart' prop/state instead of inside the setter
      // to avoid using setter for logic that triggers side effects.
      const existing = (cart || []).find(i => {
         const iMods = buildModifierSignature(i.modifiers);
         const existingTaxSignature = resolveEffectiveTaxIds(i.appliedTaxIds, activeTerminalConfig).slice().sort().join('|');
         const existingIdentityKey = String((i as any).cartIdentityKey || productLineIdentityKey(i, i.price));
         const existingConsignmentKey = i.consignmentLineId || '';
         return existingIdentityKey === lineIdentityKey
            && Math.sign(Number(i.quantity || 0)) === Math.sign(quantity)
            && existingConsignmentKey === consignmentIdentityKey
            && (i.variantSku || '') === (variantSku || '')
            && iMods === modifiersString
            && i.price === finalPrice
            && existingTaxSignature === taxSignature;
      });

      let targetCartId: string;

      if (existing && !usesSerial && !existing.dispatched) {
         targetCartId = existing.cartId!;
         markInteractionStateUpdate(trace, (cart || []).length + 2);
         onUpdateCart(prev => {
            const editableCart = hasSubtotalizedCart ? clearCartSubtotalization(prev) : prev;
            const updatedItem = {
               ...existing,
               subtotalizedAt: undefined,
               subtotalizedBy: undefined,
               quantity: existing.quantity + quantity,
               isReturnLine: existing.isReturnLine || quantity < 0,
               appliedTaxIds: effectiveTaxIds,
               createdAt: existing.createdAt || new Date().toISOString(),
               production_area_id: resolveProductionAreaId(existing) || productionAreaId || undefined,
               ...consignmentPatch,
            };
            return [updatedItem, ...editableCart.filter(i => i.cartId !== existing.cartId)];
         });
      } else {
         const newCartId = Math.random().toString(36).substr(2, 9);
         targetCartId = newCartId;
         const newItem = {
            ...product,
            cartId: newCartId,
            createdAt: new Date().toISOString(),
            quantity,
            isReturnLine: quantity < 0,
            price: finalPrice,
            modifiers,
            note,
            restaurantConfig: lineRestaurantConfig,
            selected_modifiers: lineRestaurantConfig?.selected_modifiers,
            selected_fraction_parts: lineRestaurantConfig?.selected_fraction_parts || lineRestaurantConfig?.fractions,
            selected_combo_items: lineRestaurantConfig?.selected_combo_items,
            product_type: productRestaurantConfig.product_type || product.product_type,
            variantSku,
            variantId,
            variantBarcodes,
            variantInfo,
            appliedTaxIds: effectiveTaxIds,
            production_area_id: productionAreaId || undefined,
            originalPrice: getProductPrice(product),
            trackingData,
            ...consignmentPatch,
         };
         markInteractionStateUpdate(trace, (cart || []).length + 2);
         onUpdateCart(prev => [newItem, ...(hasSubtotalizedCart ? clearCartSubtotalization(prev) : prev)]);
      }

      // SIDE EFFECT: Move outside the state update sequence to avoid React "rendering update" warning
      setLastAddedCartId(targetCartId);
      markInteractionStage(trace, 'HANDLER_END');
      } finally {
         if (trace.stages.HANDLER_END === undefined) markInteractionStage(trace, 'HANDLER_END');
         if (activeAddTraceRef.current === trace) activeAddTraceRef.current = null;
      }
   }, [activeTerminalConfig, authorizeSubtotalizedEdit, blockRecoveredUberOrderMutation, canAddItemToCart, cart, ensureSalesWithOpenZPermission, getProductPrice, hasSubtotalizedCart, onUpdateCart]);

   const handleProductClick = useCallback((product: Product) => {
      // MOBILE INTERCEPTION
      if (isMobile && !defaultSalesWarehouseId) {
         setPendingProductToAdd(product);
         setShowMobileConfigModal(true);
         return;
      }

      const productName = product.name || '';
      const isWeighted = product.type === 'SERVICE' || productName.toLowerCase().includes('(peso)');
      const hasVariants = (product.variants || []).length > 0 || (product.attributes || []).length > 0;
      const hasRestaurantConfig = productHasRestaurantConfiguration(product) || Boolean(
         (product.availableModifiers || []).length > 0
         || (product.modifier_groups || product.modifierGroups || []).length > 0
         || (product.combo_groups || product.comboGroups || []).length > 0
         || (product.fraction_rule || product.fractionRule)
         || (product.note_presets || product.notePresets || []).length > 0
      );
      const requiresConfigurationBeforeAdd = isWeighted || hasVariants || hasRestaurantConfig;

      if (!isReturnMode && !ensureSalesWithOpenZPermission()) return;
      if (requiresConfigurationBeforeAdd && !canAddItemToCart(product)) return;

      if (isWeighted) setProductForScale(product);
      else if (hasVariants) setSelectedProductForVariants(product);
      else if (hasRestaurantConfig) setProductForModifiers(product);
      else addToCart(product, isReturnMode ? -1 : 1);
   }, [isMobile, defaultSalesWarehouseId, ensureSalesWithOpenZPermission, canAddItemToCart, addToCart, isReturnMode]);

   const handleSearchConsignments = useCallback(async () => {
      setIsSearchingConsignments(true);
      setConsignmentError(null);
      try {
         const results = await consignmentSyncService.searchConsignments(consignmentSearchTerm);
         setConsignmentResults(results);
         if (results.length === 0) {
            setConsignmentError('No se encontraron consignaciones disponibles.');
         }
      } catch (error) {
         const message = error instanceof Error ? error.message : 'No se pudo consultar consignaciones.';
         setConsignmentError(message);
      } finally {
         setIsSearchingConsignments(false);
      }
   }, [consignmentSearchTerm]);

   const handleOpenConsignment = useCallback(async (consignment: ErpConsignment) => {
      setIsLoadingConsignment(true);
      setConsignmentError(null);
      try {
         const detail = await consignmentSyncService.getConsignment(String(consignment.id));
         const detailLines = getConsignmentLines(detail);
         const summaryLines = getConsignmentLines(consignment);
         setSelectedConsignment({
            ...consignment,
            ...detail,
            customerName: getConsignmentCustomerName(detail) || getConsignmentCustomerName(consignment),
            customer_name: getConsignmentCustomerName(detail) || getConsignmentCustomerName(consignment),
            lines: detailLines.length > 0 ? detailLines : summaryLines,
            items: detailLines.length > 0 ? detailLines : summaryLines,
         });
      } catch (error) {
         const message = error instanceof Error ? error.message : 'No se pudo cargar la consignación.';
         setConsignmentError(message);
      } finally {
         setIsLoadingConsignment(false);
      }
   }, []);

   const refreshProductsForConsignmentMatch = useCallback(async (): Promise<Product[]> => {
      setConsignmentError('PENDING_CATALOG_SYNC: Actualizando catálogo POS para vincular artículos ERP...');
      try {
         await syncManager.pullCatalog('products', true, { ignoreThrottle: true });
      } catch (error) {
         throw new Error(error instanceof Error ? error.message : 'No se pudo actualizar el catálogo de productos.');
      }
      const freshProducts = await db.get('products');
      return Array.isArray(freshProducts) ? freshProducts as Product[] : products;
   }, [products]);

   const handleAddConsignmentLine = useCallback(async (consignment: ErpConsignment, line: ErpConsignmentLine) => {
      let productIndexes = consignmentSyncService.buildProductIndexes(products);
      let product = consignmentSyncService.findMatchingProduct(line, productIndexes);
      if (!product) {
         try {
            const freshProducts = await refreshProductsForConsignmentMatch();
            productIndexes = consignmentSyncService.buildProductIndexes(freshProducts);
            product = consignmentSyncService.findMatchingProduct(line, productIndexes);
         } catch (error) {
            const message = error instanceof Error ? error.message : 'No se pudo actualizar el catálogo POS.';
            setConsignmentError(message);
            return;
         }
      }

      if (!product) {
         setConsignmentError(consignmentSyncService.describeProductNotFound(line, productIndexes));
         return;
      }

      const quantity = getConsignmentLineQuantity(line);
      const price = getConsignmentLinePrice(line, getProductPrice(product));
      addToCart(
         product,
         quantity,
         price,
         undefined,
         undefined,
         undefined,
         undefined,
         `Consignación ${getConsignmentDocumentNo(consignment)}`,
         undefined,
         consignmentSyncService.buildCartItemPatch(consignment, line)
      );
      setSuccessToast(`Consignación ${getConsignmentDocumentNo(consignment)} agregada al ticket.`);
      setTimeout(() => setSuccessToast(null), 2500);
   }, [addToCart, getProductPrice, products, refreshProductsForConsignmentMatch]);

   const handleAddAllConsignmentLines = useCallback(async (consignment: ErpConsignment) => {
      const lines = getConsignmentLines(consignment);
      let added = 0;
      let productSource = products;
      let productIndexes = consignmentSyncService.buildProductIndexes(productSource);
      const missingBeforeRefresh = lines.some(line => !consignmentSyncService.findMatchingProduct(line, productIndexes));
      if (missingBeforeRefresh) {
         try {
            productSource = await refreshProductsForConsignmentMatch();
            productIndexes = consignmentSyncService.buildProductIndexes(productSource);
         } catch (error) {
            const message = error instanceof Error ? error.message : 'No se pudo actualizar el catálogo POS.';
            setConsignmentError(message);
            return;
         }
      }

      const missingNames: string[] = [];
      lines.forEach((line) => {
         const product = consignmentSyncService.findMatchingProduct(line, productIndexes);
         if (!product) {
            missingNames.push(consignmentSyncService.describeProductNotFound(line, productIndexes));
            return;
         }
         addToCart(
            product,
            getConsignmentLineQuantity(line),
            getConsignmentLinePrice(line, getProductPrice(product)),
            undefined,
            undefined,
            undefined,
            undefined,
            `Consignación ${getConsignmentDocumentNo(consignment)}`,
            undefined,
            consignmentSyncService.buildCartItemPatch(consignment, line)
         );
         added += 1;
      });

      if (missingNames.length > 0) {
         setConsignmentError(`${missingNames.length} línea(s) bloqueada(s). ${missingNames.slice(0, 3).join(' || ')}`);
      }
      if (added > 0) {
         setSuccessToast(`${added} línea(s) de consignación agregada(s).`);
         setTimeout(() => setSuccessToast(null), 2500);
         setShowConsignmentModal(false);
      }
      if (added > 0 && missingNames.length === 0) {
         setConsignmentError(null);
      }
   }, [addToCart, getProductPrice, products, refreshProductsForConsignmentMatch]);

   const handleProductClickRef = useRef(handleProductClick);
   const quickActionDataRef = useRef(quickActionData);

   handleProductClickRef.current = handleProductClick;
   quickActionDataRef.current = quickActionData;

   const clearQuickActionTouchTimer = useCallback(() => {
      if (quickActionTouchTimerRef.current) {
         window.clearTimeout(quickActionTouchTimerRef.current);
         quickActionTouchTimerRef.current = null;
      }
      quickActionTouchStartRef.current = null;
      lastProductTouchAtRef.current = Date.now();
   }, []);

   const handleProductCardTouchStart = useCallback((product: Product, clientX: number, clientY: number) => {
      lastProductTouchAtRef.current = Date.now();
      quickActionTouchStartRef.current = { x: clientX, y: clientY, at: Date.now() };
      if (quickActionTouchTimerRef.current) {
         window.clearTimeout(quickActionTouchTimerRef.current);
      }
      quickActionTouchTimerRef.current = window.setTimeout(() => {
         quickActionOpenedAtRef.current = Date.now();
         lastTouchContextMenuAtRef.current = Date.now();
         setQuickActionData({ product, x: clientX, y: clientY });
         quickActionTouchTimerRef.current = null;
      }, 1200);
   }, []);

   const handleProductCardTouchMove = useCallback((clientX: number, clientY: number) => {
      const start = quickActionTouchStartRef.current;
      if (!start) return;
      const distance = Math.hypot(clientX - start.x, clientY - start.y);
      if (distance > 14) {
         clearQuickActionTouchTimer();
      }
   }, [clearQuickActionTouchTimer]);

   const handleProductCardClick = useCallback((product: Product) => {
      if (Date.now() - quickActionOpenedAtRef.current < 900) return;
      if (quickActionDataRef.current) return;
      activeAddTraceRef.current = beginPosInteraction('ADD_TICKET_ITEM', { source: 'product_card', productId: product.id });
      handleProductClickRef.current(product);
   }, []);

   const handleProductCardContextMenu = useCallback((product: Product, event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const now = Date.now();
      // Android emits contextmenu during a long touch before touchend. Open
      // the quick actions here instead of discarding that gesture.
      if (now - lastProductTouchAtRef.current < 900) {
         if (quickActionTouchTimerRef.current) {
            window.clearTimeout(quickActionTouchTimerRef.current);
            quickActionTouchTimerRef.current = null;
         }
         quickActionOpenedAtRef.current = now;
         lastTouchContextMenuAtRef.current = now;
         setQuickActionData({ product, x: event.clientX, y: event.clientY });
         return;
      }
      if (now - lastTouchContextMenuAtRef.current < 900) return;
      quickActionOpenedAtRef.current = now;
      setQuickActionData({ product, x: event.clientX, y: event.clientY });
   }, []);

   const hasPromotionForProduct = useCallback(
      (product: Product) => hasProductPromotion(product, config, activeTerminalId, selectedCustomer || undefined),
      [config, activeTerminalId, selectedCustomer]
   );

   const openProductPromotionSheet = useCallback((product: Product) => {
      setSelectedPromoProduct(product);
      setShowPromoSheet(true);
   }, []);

   // --- SEARCH LOGIC (Auto-Add Variantes) ---
   const findProductByAnyCode = useCallback((code: string) => {
      let quantity = 1;
      let searchCode = code.trim();

      // Multiplier Support: [Qty]*[SKU]
      if (searchCode.includes('*')) {
         const parts = searchCode.split('*');
         if (parts.length === 2 && !isNaN(Number(parts[0]))) {
            quantity = Number(parts[0]);
            searchCode = parts[1].trim();
         }
      }

      if (!searchCode) return null;

      const indexedMatch = productCodeIndex.get(searchCode);
      if (indexedMatch) {
         return {
            product: indexedMatch.product,
            quantity,
            price: indexedMatch.price,
            modifiers: indexedMatch.modifiers,
            selectedVariant: indexedMatch.selectedVariant,
            variantInfo: indexedMatch.variantInfo,
         };
      }

      for (const p of products) {
         // A. Check Variants (SKU or Barcode)
         if (p.variants && p.variants.length > 0) {
            for (const v of p.variants) {
               if ((v.sku === searchCode || (v.barcode && v.barcode.includes(searchCode))) && productHasActiveTariff(p)) {
                  // Map attribute values to a simple list of modifiers
                  const modifiersList = Object.entries(v.attributeValues || {}).map(([_, val]) => val);
                  const variantInfo = Object.entries(v.attributeValues || {})
                     .map(([key, value]) => `${key}: ${value}`)
                     .join(' · ');
                  return { product: p, quantity, price: resolveVariantSalesPrice(v, getProductPrice(p)), modifiers: modifiersList, selectedVariant: v, variantInfo };
               }
            }
         }

         const rootCodeCandidates = [
            typeof p.id === 'string' ? p.id.trim() : String(p.id || '').trim(),
            typeof p.barcode === 'string' ? p.barcode.trim() : String(p.barcode || '').trim(),
            typeof (p as any).sku === 'string' ? (p as any).sku.trim() : String((p as any).sku || '').trim(),
            typeof (p as any).item_code === 'string' ? (p as any).item_code.trim() : String((p as any).item_code || '').trim(),
            typeof (p as any).code === 'string' ? (p as any).code.trim() : String((p as any).code || '').trim(),
            typeof (p as any).reference === 'string' ? (p as any).reference.trim() : String((p as any).reference || '').trim(),
            typeof (p as any).referencia === 'string' ? (p as any).referencia.trim() : String((p as any).referencia || '').trim(),
            typeof (p as any).external_reference === 'string' ? (p as any).external_reference.trim() : String((p as any).external_reference || '').trim(),
         ].filter(Boolean);

         // B. Check Parent (ID, SKU, Barcode, item_code, code)
         if (rootCodeCandidates.includes(searchCode) && productHasActiveTariff(p)) {
            return { product: p, quantity, price: getProductPrice(p), modifiers: [] };
         }
      }

      return null;
   }, [getProductPrice, productCodeIndex, productHasActiveTariff, products]);

   const submitProductTextSearchRef = useRef<((rawValue: string, focusTarget?: React.RefObject<HTMLInputElement>) => boolean) | null>(null);

   const routeScannedCoupon = useCallback((rawCode: string): boolean => {
      const scannedCouponCode = resolveScannedCouponCode(rawCode, config.coupons);
      if (!scannedCouponCode) return false;

      setCouponCode(scannedCouponCode);
      setSearchTerm('');
      setShowCouponModal(true);
      setIsScannerOpen(false);
      setErrorToast(null);
      return true;
   }, [config.coupons]);

   const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
         const rawValue = e.currentTarget.value || searchTerm || '';
         if (routeScannedCoupon(rawValue)) return;

         const match = findProductByAnyCode(rawValue);
         if (match) {
            addToCart(match.product, (isReturnMode ? -1 : 1) * match.quantity, match.price, match.modifiers, undefined, match.selectedVariant, match.variantInfo);
            setSearchTerm('');
            setErrorToast(null);
            // Ensure focus stays on search bar
            searchInputRef.current?.focus();
         } else {
            if (submitProductTextSearchRef.current?.(rawValue, searchInputRef)) {
               return;
            }

            if (rawValue.trim()) {
               setErrorToast("Código no encontrado");
               setTimeout(() => setErrorToast(null), 2000);
            }
         }
      }
   }, [searchTerm, routeScannedCoupon, findProductByAnyCode, addToCart, isReturnMode]);

   // --- BARCODE SCANNER LOGIC ---
   const processBarcode = useCallback((code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      const trace = beginPosInteraction('BARCODE_SCAN', { codeLength: trimmed.length });
      activeAddTraceRef.current = trace;
      expectInteractionRender(trace, 'POS_INTERACTION_VIEW');
      try {
      // A hardware scan is consumed even when routing/lookup finds no match.
      setSearchTerm('');

      if (routeScannedCoupon(trimmed)) return;

      // 0. Try Smart QR (JSON)
      try {
         if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            const data = JSON.parse(trimmed);
            if (data.type === 'RESERVATION_NOTE' && (data.id || data.code)) {
               const found = activeReservationByScanCode.get(String(data.id || ''))
                  || activeReservationByScanCode.get(String(data.code || ''));
               if (found) {
                  handleRecoverReservation(found);
                  return;
               }
            }
            if (data.type === 'INVOICE_RETURN' && data.id) {
               setReturnInvoiceId(data.id);
               setShowReturnModal(true);
               return;
            }
         }
      } catch (e) {
         // Not a JSON or invalid
      }

      // 1. Try Scale Parser
      if (config.scaleLabelConfig?.isEnabled) {
         const scaleItem = parseScaleBarcode(trimmed, config.scaleLabelConfig);
         if (scaleItem) {
            const product = productCodeIndex.get(scaleItem.plu)?.product;

            if (product) {
               if (scaleItem.type === 'WEIGHT') {
                  addToCart(product, scaleItem.value);
                  setErrorToast(`⚖️ Peso: ${scaleItem.value.toFixed(3)}kg`);
               } else {
                  const unitPrice = getProductPrice(product);
                  if (unitPrice > 0) {
                     const weight = scaleItem.value / unitPrice;
                     addToCart(product, weight);
                     setErrorToast(`💲 Precio: $${scaleItem.value} (${weight.toFixed(3)}kg)`);
                  } else {
                     addToCart(product, 1, scaleItem.value);
                  }
               }
               setTimeout(() => setErrorToast(null), 3000);
               return;
            } else {
               setErrorToast(`Producto PLU ${scaleItem.plu} no encontrado`);
               setTimeout(() => setErrorToast(null), 3000);
               return;
            }
         }
      }

      // 2. Normal Barcode Search. Use the memoized code index instead of scanning
      // the whole catalog on every hardware scan.
      const match = findProductByAnyCode(trimmed);
      if (match) {
         setSearchTerm('');
         const hasConfiguredVariant = Boolean(match.selectedVariant || match.modifiers?.length);
         if (!hasConfiguredVariant && ((match.product.variants || []).length > 0 || (match.product.attributes || []).length > 0)) {
            handleProductClick(match.product);
         } else {
            addToCart(match.product, (isReturnMode ? -1 : 1) * match.quantity, match.price, match.modifiers, undefined, match.selectedVariant, match.variantInfo);
         }
         setErrorToast(`Producto agregado: ${match.product.name}`);
         setTimeout(() => setErrorToast(null), 1500);
         return;
      }

      // 3. Try Transaction Search only for document-looking scans. Product
      // barcodes should not pay the cost of scanning large ticket histories.
      if (looksLikeDocumentScan(trimmed)) {
         const txnFound = transactionByScanCode.get(trimmed);
         if (txnFound) {
            setReturnInvoiceId(txnFound.id);
            setShowReturnModal(true);
            return;
         }
      }
      setErrorToast('Código no encontrado');
      setTimeout(() => setErrorToast(null), 2000);
      } finally {
         markInteractionStateUpdate(trace, 1);
         if (trace.stages.HANDLER_END === undefined) markInteractionStage(trace, 'HANDLER_END');
         if (activeAddTraceRef.current === trace) activeAddTraceRef.current = null;
      }
   }, [activeReservationByScanCode, addToCart, config.scaleLabelConfig, handleProductClick, getProductPrice, handleRecoverReservation, findProductByAnyCode, productCodeIndex, routeScannedCoupon, transactionByScanCode, isReturnMode]);

   const isAnyModalOpen = !!(
      showSafetyGate ||
      showDiscountModal ||
      showParkAliasModal ||
      showConsignmentModal ||
      showSupervisorAuth ||
      productionRoutingPrompt ||
      showServiceTypeDialog ||
      showPaymentModal ||
      showSplitModal ||
      showTicketOptions ||
      showParkedList ||
      showGlobalDiscount ||
      showCouponModal ||
      editingItem ||
      selectedProductForVariants ||
      productForScale ||
      showLoyaltyModal ||
      isScannerOpen ||
      showReturnModal ||
      showPromoSheet ||
      showMobileConfigModal ||
      showReservationModal ||
      !!showReservationReceipt ||
      showRecoverReservationModal ||
      supervisorModalProps.isOpen
   );

   useEffect(() => {
      if (isAnyModalOpen) return;
      let timer: ReturnType<typeof setTimeout>;
      const restoreScannerFocus = () => {
         clearTimeout(timer);
         // Wait for the click handler to open any modal before checking guards.
         timer = setTimeout(() => focusSalesScannerInput(document), 0);
      };
      restoreScannerFocus();
      window.addEventListener('pointerup', restoreScannerFocus);
      return () => {
         clearTimeout(timer);
         window.removeEventListener('pointerup', restoreScannerFocus);
      };
   }, [isAnyModalOpen, isRetailMode]);

   useEffect(() => {
      if (isAnyModalOpen) return;

      const handleCentralBarcodeScan = (event: Event) => {
         const barcode = (event as CustomEvent<{ barcode?: string }>).detail?.barcode;
         if (!barcode) return;
         processBarcode(barcode);
      };

      window.addEventListener('barcodeScanned', handleCentralBarcodeScan as EventListener);
      return () => window.removeEventListener('barcodeScanned', handleCentralBarcodeScan as EventListener);
   }, [isAnyModalOpen, processBarcode]);

   const fiscalCompliance = useMemo(
      () => getEffectiveFiscalComplianceConfig(config, activeTerminalConfig),
      [config, activeTerminalConfig]
   );
   const isFiscalModeDisabled = fiscalCompliance.mode === 'NONE';
   const fiscalCartGrossTotal = useMemo(
      () => (cart || []).reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0),
      [cart]
   );
   const fiscalThresholdBucket = useMemo(() => {
      const threshold = Number(activeTerminalConfig?.operational?.fiscalThreshold || 0);
      return threshold > 0 && fiscalCartGrossTotal > threshold ? 'OVER_THRESHOLD' : 'BASE';
   }, [activeTerminalConfig?.operational?.fiscalThreshold, fiscalCartGrossTotal]);
   const requiredSaleFiscalType = useMemo<FiscalDocumentCode>(() => {
      const customerFiscalType = selectedCustomer?.defaultNcfType;
      const baseLegacyType: NCFType = fiscalThresholdBucket === 'OVER_THRESHOLD'
         ? 'B01'
         : (
            customerFiscalType?.startsWith('E')
               ? mapElectronicFiscalCodeToLegacy(customerFiscalType as any) as NCFType
               : (customerFiscalType || (selectedCustomer?.requiresFiscalInvoice ? 'B01' : 'B02')) as NCFType
         );
      return resolveSaleFiscalCode(fiscalCompliance.mode, baseLegacyType);
   }, [
      fiscalCompliance.mode,
      fiscalThresholdBucket,
      selectedCustomer?.defaultNcfType,
      selectedCustomer?.requiresFiscalInvoice
   ]);

   useEffect(() => {
      let cancelled = false;

      const checkFiscalStatus = async () => {
         const type = requiredSaleFiscalType;
         if (isOrderTakerMode || isFiscalModeDisabled) {
            setStatus(null);
            setFiscalStatus({
               type,
               hasNCF: true,
               localBuffer: null,
               isUsingPool: false,
               isTerminalBlock: false,
               remaining: 0,
               total: 0
            });
            return;
         }

         const [buffers, allocations, ranges] = await Promise.all([
            db.get('localFiscalBuffer'),
            db.get('fiscalAllocations'),
            db.get('fiscalRanges'),
         ]);
         if (cancelled) return;

         const localBuffer: any = (Array.isArray(buffers) ? buffers : []).find((buffer: any) =>
            buffer?.type === type &&
            (!buffer?.terminalId || buffer?.terminalId === terminalId)
         );
         const activeAllocation: any = (Array.isArray(allocations) ? allocations : []).find((allocation: any) =>
            allocation?.ncfType === type &&
            allocation?.terminalId === terminalId &&
            (
               allocation?.status === 'ACTIVE' ||
               (
                  allocation?.status === 'EXHAUSTED' &&
                  Number(allocation?.nextNumber) <= Number(allocation?.reservedEnd)
               )
            )
         );
         const allocationRange: any = (Array.isArray(ranges) ? ranges : []).find((range: any) =>
            (activeAllocation?.fiscalRangeId && range?.id === activeAllocation.fiscalRangeId)
            || (!activeAllocation?.fiscalRangeId && range?.type === type && range?.isActive)
         );
         let fiscalRemaining = 0;
         let fiscalTotal = 0;

         const allocationNextNumber = activeAllocation
            ? Math.max(
               Number(activeAllocation.reservedStart || 0),
               Number(activeAllocation.nextNumber || activeAllocation.reservedStart || 0)
            )
            : 0;
         const localBufferCurrent = Number(localBuffer?.currentNumber || 0);
         const localBufferIsAligned =
            Boolean(localBuffer) &&
            (
               !activeAllocation ||
               (
                  localBufferCurrent >= allocationNextNumber &&
                  Number(localBuffer?.endNumber || 0) <= Number(activeAllocation.reservedEnd || 0)
               )
            );

         if (localBufferIsAligned && localBuffer && Number(localBuffer.currentNumber) <= Number(localBuffer.endNumber)) {
            const current = Number(localBuffer.currentNumber);
            const blockStart = Number(activeAllocation?.reservedStart || localBuffer.startNumber || current);
            const blockEnd = Number(activeAllocation?.reservedEnd || localBuffer.endNumber || current);
            const remaining = Math.max(0, blockEnd - current + 1);
            const total = Math.max(0, blockEnd - blockStart + 1);
            fiscalRemaining = remaining;
            fiscalTotal = total;

            setStatus({
               isConnected: true,
               currentNCF: `${localBuffer.prefix}${current.toString().padStart(8, '0')}`,
               remaining,
               expiryDate: localBuffer.expiryDate,
               batteryLevel: 100
            });
         } else if (activeAllocation && Number(activeAllocation.nextNumber) <= Number(activeAllocation.reservedEnd)) {
            const current = Number(activeAllocation.nextNumber);
            const remaining = Math.max(0, Number(activeAllocation.reservedEnd) - current + 1);
            const total = Math.max(0, Number(activeAllocation.reservedEnd) - Number(activeAllocation.reservedStart) + 1);
            const prefix = String(allocationRange?.prefix || type);
            fiscalRemaining = remaining;
            fiscalTotal = total;

            setStatus({
               isConnected: true,
               currentNCF: `${prefix}${current.toString().padStart(8, '0')}`,
               remaining,
               expiryDate: String(allocationRange?.expiryDate || ''),
               batteryLevel: 100
            });
         }

         const hasLocal = Boolean(localBuffer && Number(localBuffer.currentNumber) <= Number(localBuffer.endNumber));
         const allocationCanIssue = Boolean(activeAllocation && Number(activeAllocation.nextNumber) <= Number(activeAllocation.reservedEnd));
         const rangeCanIssue = Boolean(
            !activeAllocation &&
            (Array.isArray(ranges) ? ranges : []).some((range: any) =>
               range?.type === type &&
               range?.isActive &&
               Number(range?.currentGlobal || 0) < Number(range?.endNumber || 0)
            )
         );
         const canRequest = allocationCanIssue || rangeCanIssue;
         const hasNCF = hasLocal || canRequest;
         const isTerminalBlock = Boolean(activeAllocation || localBuffer?.allocationId);
         setFiscalStatus({ type, hasNCF, localBuffer: localBuffer || activeAllocation || null, isUsingPool: !hasLocal && canRequest, isTerminalBlock, remaining: fiscalRemaining, total: fiscalTotal });
      };
      checkFiscalStatus();
      return () => {
         cancelled = true;
      };
   }, [isFiscalModeDisabled, isOrderTakerMode, requiredSaleFiscalType, terminalId]);

   const fiscalReserveAlert = useMemo(() => {
      if (isOrderTakerMode || isFiscalModeDisabled) return null;
      if (!fiscalStatus.hasNCF) return null;
      return getFiscalReserveAlert(fiscalStatus.remaining || 0, fiscalStatus.total || 0, fiscalCompliance);
   }, [fiscalCompliance, fiscalStatus.hasNCF, fiscalStatus.remaining, fiscalStatus.total, isFiscalModeDisabled, isOrderTakerMode]);

   const shouldShowFiscalReserveAlert = Boolean(
      fiscalReserveAlert &&
      cart.length === 0 &&
      searchTerm.trim().length === 0
   );

   const salesCatalogProducts = useMemo(() => {
      const nonSeedBusinessKeys = new Set<string>();

      for (const product of catalogProducts) {
         if (!product || typeof product !== 'object' || Array.isArray(product)) continue;
         if (isSeedCatalogProduct(product)) continue;
         productBusinessKeys(product).forEach((key) => nonSeedBusinessKeys.add(key));
      }

      return catalogProducts.filter((product) => {
         if (!product || typeof product !== 'object' || Array.isArray(product)) return false;
         if (!isSeedCatalogProduct(product)) return true;

         const businessKeys = productBusinessKeys(product);
         return !businessKeys.some((key) => nonSeedBusinessKeys.has(key));
      });
   }, [catalogProducts]);

   const dedupedSalesCatalogProducts = useMemo(() => {
      type RankedProductEntry = { product: Product; score: number; keys: Set<string> };
      const rankedByIdentity = new Map<string, RankedProductEntry>();

      for (const product of salesCatalogProducts) {
         if (!product || typeof product !== 'object' || Array.isArray(product)) continue;

         const keys = productSalesIdentityKeys(product);
         const score = scoreProductForSales(product, warehouses);
         const matchedEntries = Array.from(
            new Set(keys.map((key) => rankedByIdentity.get(key)).filter(Boolean) as RankedProductEntry[])
         );
         const bestExisting = matchedEntries
            .sort((left, right) => right.score - left.score)[0];
         const incomingEntry: RankedProductEntry = { product, score, keys: new Set(keys) };
         const winner = !bestExisting || score > bestExisting.score ? incomingEntry : bestExisting;
         const mergedKeys = new Set<string>(keys);

         for (const entry of matchedEntries) {
            entry.keys.forEach((key) => mergedKeys.add(key));
         }

         winner.keys = mergedKeys;
         for (const key of mergedKeys) {
            rankedByIdentity.set(key, winner);
         }
      }

      const uniqueEntries = Array.from(new Set(rankedByIdentity.values()));
      return uniqueEntries.map((entry) => entry.product);
   }, [salesCatalogProducts, warehouses]);

   const salesCatalogProductEntries = useMemo<SalesCatalogProductEntry[]>(() => {
      return dedupedSalesCatalogProducts.map((product) => {
         const searchableCodes = [
            product.barcode,
            (product as any).sku,
            (product as any).item_code,
            (product as any).code,
            (product as any).description,
            (product as any).descripcion,
            (product as any).reference,
            (product as any).referencia,
            (product as any).external_reference,
            ...productReferenceCandidates(product),
         ];
         const variantCodes = Array.isArray((product as any).variants)
            ? (product as any).variants.flatMap((variant: any) => [variant?.sku, variant?.barcode])
            : [];

         return {
            product,
            displayCategory: displayCategory(product.category),
            hasActiveTariff: productHasActiveTariff(product),
            hasErpWarehouse: resolveProductActiveWarehouseIds(product, warehouses).length > 0,
            isSellable: product.is_sellable !== false,
            normalizedCategory: canonicalizeCategory(product.category),
            searchText: [product.name, ...searchableCodes, ...variantCodes]
               .map(normalizeSearchToken)
               .filter(Boolean)
               .join(' '),
         };
      });
   }, [canonicalizeCategory, dedupedSalesCatalogProducts, displayCategory, productHasActiveTariff, warehouses]);

   const sortedSalesCatalogProductEntries = useMemo(() => {
      return [...salesCatalogProductEntries].sort((left, right) => {
         const leftCategoryOrder = categoryLookup.presentationByCanonical.get(left.normalizedCategory)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
         const rightCategoryOrder = categoryLookup.presentationByCanonical.get(right.normalizedCategory)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
         if (leftCategoryOrder !== rightCategoryOrder) return leftCategoryOrder - rightCategoryOrder;
         if (left.normalizedCategory !== right.normalizedCategory) {
            return left.displayCategory.localeCompare(right.displayCategory, 'es', { sensitivity: 'base' });
         }
         return comparePosProducts(left.product, right.product);
      });
   }, [categoryLookup.presentationByCanonical, salesCatalogProductEntries]);

   const filteredProducts = useMemo(() => {
      const normalizedCategoryFilter = categoryFilter === 'ALL'
         ? 'ALL'
         : canonicalizeCategory(categoryFilter);
      const normalizedSearch = normalizeSearchToken(catalogSearchQuery);

      const filtered = sortedSalesCatalogProductEntries.filter((entry) => {
         const matchSearch = !normalizedSearch
            || entry.searchText.includes(normalizedSearch);

         const matchCat = Boolean(normalizedSearch) || normalizedCategoryFilter === 'ALL' || entry.normalizedCategory === normalizedCategoryFilter;
         const matchAllowedCat = effectiveAllowedCategorySet.size === 0 || effectiveAllowedCategorySet.has(entry.normalizedCategory);
         const categoryIsVisible = categoryLookup.presentationByCanonical.get(entry.normalizedCategory)?.isActive !== false;

         // La grilla no debe quedar vacía mientras llegan bloques de stock/precios; el bloqueo duro ocurre al agregar al carrito.
         return matchSearch && matchCat && matchAllowedCat && categoryIsVisible && entry.isSellable && entry.hasActiveTariff;
      });

      // Defensive: Ensure unique IDs to prevent React key warnings
      const seenIds = new Set();
      const result = filtered.map((entry) => entry.product).filter(p => {
            if (seenIds.has(p.id)) return false;
            seenIds.add(p.id);
            return true;
         });
      const trace = searchFilterTraceRef.current;
      if (trace?.stages.FILTER_START !== undefined && trace.stages.FILTER_END === undefined) {
         trace.allocationsApprox += filtered.length + result.length + 1;
         markInteractionStage(trace, 'FILTER_END');
      }
      return result;
   }, [sortedSalesCatalogProductEntries, categoryFilter, catalogSearchQuery, canonicalizeCategory, effectiveAllowedCategorySet, categoryLookup.presentationByCanonical]);

   const submitProductTextSearch = useCallback((rawValue: string, focusTarget?: React.RefObject<HTMLInputElement>): boolean => {
      const normalizedTextSearch = normalizeSearchToken(rawValue);
      if (normalizedTextSearch) {
         setSearchTerm(rawValue.trim());
      }
      const textMatch = normalizedTextSearch
         ? salesCatalogProductEntries.find((entry) => {
            const allowedCategory = effectiveAllowedCategorySet.size === 0 || effectiveAllowedCategorySet.has(entry.normalizedCategory);
            const categoryIsVisible = categoryLookup.presentationByCanonical.get(entry.normalizedCategory)?.isActive !== false;
            return entry.searchText.includes(normalizedTextSearch) && allowedCategory && categoryIsVisible && entry.isSellable && entry.hasActiveTariff;
         })
         : null;

      if (textMatch?.product || filteredProducts.length > 0) {
         setErrorToast(null);
         focusTarget?.current?.focus();
         return true;
      }

      return Boolean(normalizedTextSearch);
   }, [salesCatalogProductEntries, effectiveAllowedCategorySet, filteredProducts, handleProductClick, categoryLookup.presentationByCanonical]);

   submitProductTextSearchRef.current = submitProductTextSearch;

   const handleRetailSearchSubmit = useCallback((rawTerm?: string) => {
      const trimmed = (rawTerm ?? searchTerm ?? '').trim();
      if (!trimmed) {
         retailSearchInputRef.current?.focus();
         return;
      }

      const match = findProductByAnyCode(trimmed);
      if (match) {
         addToCart(match.product, (isReturnMode ? -1 : 1) * match.quantity, match.price, match.modifiers, undefined, match.selectedVariant, match.variantInfo);
         setSearchTerm('');
         setErrorToast(null);
         retailSearchInputRef.current?.focus();
         return;
      }

      if (submitProductTextSearch(trimmed, retailSearchInputRef)) {
         return;
      }

      if (filteredProducts.length === 0) {
         setErrorToast("Código no encontrado");
         setTimeout(() => setErrorToast(null), 2000);
      }

      retailSearchInputRef.current?.focus();
   }, [searchTerm, findProductByAnyCode, addToCart, isReturnMode, filteredProducts, submitProductTextSearch]);

   const categoryOptions = useMemo(() => {
      const allowedCategoryOptions = Array.from(effectiveAllowedCategorySet)
         .map((category) => {
            const id = canonicalizeCategory(category);
            const presentation = categoryLookup.presentationByCanonical.get(id);
            return {
               id,
               label: displayCategory(category),
               color: presentation?.color,
               sortOrder: presentation?.sortOrder ?? Number.MAX_SAFE_INTEGER,
               isActive: presentation?.isActive !== false,
            };
         })
         .filter((category) => category.id && category.label && category.isActive);
      const availableProducts = salesCatalogProductEntries.filter((entry) => {
         if (!entry.isSellable || !entry.hasActiveTariff) return false;
         if (categoryLookup.presentationByCanonical.get(entry.normalizedCategory)?.isActive === false) return false;
         if (effectiveAllowedCategorySet.size > 0) {
            if (!effectiveAllowedCategorySet.has(entry.normalizedCategory)) return false;
         }
         return true;
      });

      const availableCategoryMap = new Map<string, string>();
      for (const entry of availableProducts) {
         const normalizedCategory = entry.normalizedCategory;
         const rawCategory = entry.displayCategory;
         if (!rawCategory || availableCategoryMap.has(normalizedCategory)) continue;
         availableCategoryMap.set(normalizedCategory, rawCategory);
      }

      const productCategories = Array.from(availableCategoryMap.entries())
         .map(([id, label]) => {
            const presentation = categoryLookup.presentationByCanonical.get(id);
            return {
               id,
               label,
               color: presentation?.color,
               sortOrder: presentation?.sortOrder ?? Number.MAX_SAFE_INTEGER,
               isActive: presentation?.isActive !== false,
            };
         })
         .filter(category => category.isActive)
         .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));

      const scopedCategories = productCategories.length > 0
         ? productCategories
         : allowedCategoryOptions;

      const dedupedCategoryOptions = new Map<string, { id: string; label: string; color?: string; sortOrder: number; isActive: boolean }>();
      for (const category of scopedCategories) {
         if (!category.id || dedupedCategoryOptions.has(category.id)) continue;
         dedupedCategoryOptions.set(category.id, category);
      }

      return [{ id: 'ALL', label: 'Todas', sortOrder: -1, isActive: true }, ...Array.from(dedupedCategoryOptions.values())];
   }, [canonicalizeCategory, displayCategory, effectiveAllowedCategorySet, salesCatalogProductEntries, categoryLookup.presentationByCanonical]);

   const categoryOptionIds = useMemo(() => categoryOptions.map((option) => option.id), [categoryOptions]);

   useEffect(() => {
      const selectedCategoryKey = categoryFilter === 'ALL' ? 'ALL' : canonicalizeCategory(categoryFilter);
      if (selectedCategoryKey !== 'ALL' && !categoryOptionIds.includes(selectedCategoryKey)) {
         setCategoryFilter('ALL');
      }
   }, [canonicalizeCategory, categoryFilter, categoryOptionIds]);

   // --- PROMOTION ENGINE INTEGRATION ---
   const processedCart = useMemo(() => {
      return applyPromotions(cart, config, activeTerminalId, selectedCustomer || undefined);
   }, [cart, config, activeTerminalId, selectedCustomer]);

   useEffect(() => {
      if (!activeCartItemId) return;
      const stillExists = processedCart.some((item) => item.cartId === activeCartItemId);
      if (!stillExists) {
         setActiveCartItemId(null);
      }
   }, [processedCart, activeCartItemId]);

   const toggleCartItemFocus = useCallback((cartId?: string | null) => {
      if (!cartId) return;
      setActiveCartItemId((current) => (current === cartId ? null : cartId));
   }, []);

   const renderTicketBrand = useCallback((compact = false) => (
      <div className={`inline-flex items-center ${compact ? 'gap-2' : 'gap-2.5'}`}>
         <svg
            className={compact ? 'h-6 w-6 shrink-0' : 'h-8 w-8 shrink-0'}
            viewBox="0 0 64 64"
            aria-hidden="true"
         >
            <path fill="#132124" d="M7 52 26.5 12 35 29.2 23.8 52Z" />
            <path fill="#00A7A0" d="M29.8 8H43l14 29.3-16.4-5.8Z" />
            <path fill="#B8E336" d="m38.8 35 16.8 6L61 52H46.7Z" />
            <path fill="#F4F7F6" d="m28.4 33.4 6.2 12.7L31.7 52h-8Z" />
         </svg>
         <span className={`whitespace-nowrap font-black tracking-[-0.02em] ${compact ? 'text-[0.95rem]' : 'text-[1.15rem]'}`}>
            <span className="text-[#132124]">ALFA</span>
            <span className="text-[#00A7A0]">-POS</span>
         </span>
      </div>
   ), []);
   const cartQuantity = useMemo(
      () => processedCart.reduce((sum, item) => sum + Math.abs(Number(item.quantity || 0)), 0),
      [processedCart]
   );
   const hasClearableFreshItems = useMemo(
      () => cart.some(item => !isKitchenDispatchedCartItem(item)),
      [cart]
   );
   const isTaxIncluded = activeTariff?.taxIncluded || false;
   const grossLineTotal = useMemo(
      () => processedCart.reduce((sum, item) => sum + (item.price * item.quantity), 0),
      [processedCart]
   );

   const discountAmount = useMemo(
      () => globalDiscount.type === 'PERCENT'
         ? grossLineTotal * (globalDiscount.value / 100)
         : Math.min(globalDiscount.value, grossLineTotal),
      [globalDiscount.type, globalDiscount.value, grossLineTotal]
   );

   const tipsConfig = config.tipsConfig;
   const serviceCharge = tipsConfig?.serviceCharge;
   const isRecoveredUberOrder = isUberRecoveredReservation(activeRecoveredReservation);
   const effectiveOrderServiceType: OrderServiceType = isRecoveredUberOrder ? 'DELIVERY' : orderServiceType;
   const appliedServiceTaxPolicy = useMemo(
      () => resolveAppliedServiceTaxPolicy(config, activeTerminalConfig, effectiveOrderServiceType),
      [config.serviceTaxPolicies, config.service_tax_policies, config.tipsConfig, activeTerminalConfig, effectiveOrderServiceType],
   );

   const taxBreakdown = useMemo(() => {
      if (isSelectedCustomerTaxExempt) return [];
      return calculateTaxBreakdownFromItems(processedCart, config, {
         discountAmount,
         isTaxIncluded,
         terminalConfig: activeTerminalConfig,
         taxExempt: isSelectedCustomerTaxExempt,
         allowedTaxIds: appliedServiceTaxPolicy.taxIds,
      });
   }, [processedCart, config, discountAmount, isTaxIncluded, activeTerminalConfig, isSelectedCustomerTaxExempt, appliedServiceTaxPolicy.taxIds]);

   const displayTaxBreakdown = useMemo(
      () => consolidateTaxBreakdownForDisplay(taxBreakdown, config.taxes),
      [taxBreakdown, config.taxes]
   );

   const cartTax = displayTaxBreakdown.reduce((sum, t) => sum + t.amount, 0);
   const primaryTaxLabel = useMemo(() => {
      if (displayTaxBreakdown.length === 1) {
         return formatTaxLineLabel(displayTaxBreakdown[0]);
      }
      return null;
   }, [displayTaxBreakdown]);
   const combinedTaxBreakdown = useMemo(() => {
      if (displayTaxBreakdown.length <= 1) return [];
      return displayTaxBreakdown.map((tax) => ({
         id: tax.id,
         label: formatTaxLineLabel(tax),
         amount: tax.amount,
      }));
   }, [displayTaxBreakdown]);

   const shouldApplyServiceCharge = useMemo(() => {
      return shouldApplyRestaurantServiceCharge({
         isRestaurantMode,
         serviceType: effectiveOrderServiceType,
         serviceCharge,
         grossAfterDiscount: grossLineTotal - discountAmount,
         guests: activeTable?.guests || 0,
         legalTipPolicy: appliedServiceTaxPolicy.legalTip,
      });
   }, [isRestaurantMode, serviceCharge, grossLineTotal, discountAmount, activeTable, effectiveOrderServiceType, appliedServiceTaxPolicy.legalTip]);

   const {
      legalTipRate,
      cartTip,
      cartTotalWithoutTip,
      netSubtotal,
      cartTotal,
   } = useMemo(() => {
      const nextLegalTipRate = shouldApplyServiceCharge
         ? Number(appliedServiceTaxPolicy.legalTip?.percentage ?? serviceCharge?.percentage ?? 0) / 100
         : 0;
      const nextCartTip = (grossLineTotal - discountAmount) * nextLegalTipRate;

      let nextCartTotalWithoutTip = 0;
      let nextNetSubtotal = 0;

      if (isTaxIncluded) {
         nextCartTotalWithoutTip = grossLineTotal - discountAmount;
         nextNetSubtotal = nextCartTotalWithoutTip - cartTax;
      } else {
         nextNetSubtotal = grossLineTotal - discountAmount;
         nextCartTotalWithoutTip = nextNetSubtotal + cartTax;
      }

      return {
         legalTipRate: nextLegalTipRate,
         cartTip: nextCartTip,
         cartTotalWithoutTip: nextCartTotalWithoutTip,
         netSubtotal: nextNetSubtotal,
         cartTotal: nextCartTotalWithoutTip + nextCartTip,
      };
   }, [cartTax, discountAmount, grossLineTotal, isTaxIncluded, serviceCharge?.percentage, shouldApplyServiceCharge, appliedServiceTaxPolicy.legalTip?.percentage]);

   // Alias for compatibility if needed, though netSubtotal is what we usually display as "Subtotal"
   const cartSubtotal = grossLineTotal; // This represents the sum of list prices
   const baseCurrency = (config.currencies || []).find(c => c.isBase) || (config.currencies || [])[0];
   const getCartItemTaxSummary = useCallback((item: CartItem) => {
      if (isSelectedCustomerTaxExempt) return 'Cliente exento';
      const lineTaxBreakdown = calculateTaxBreakdownFromItems([item], config, {
         isTaxIncluded,
         terminalConfig: activeTerminalConfig,
         absoluteLineValues: true,
         taxExempt: isSelectedCustomerTaxExempt,
         allowedTaxIds: appliedServiceTaxPolicy.taxIds,
      });
      if (lineTaxBreakdown.length === 0) {
         return 'Sin impuestos';
      }
      const lineTaxAmount = Math.abs(lineTaxBreakdown.reduce((sum, tax) => sum + Number(tax.amount || 0), 0));
      return `${lineTaxBreakdown.map((tax) => formatTaxLineLabel(tax)).join(' + ')} (${baseCurrency.symbol}${lineTaxAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
   }, [config, isTaxIncluded, activeTerminalConfig, baseCurrency.symbol, isSelectedCustomerTaxExempt, appliedServiceTaxPolicy.taxIds]);
   const reservationAdvanceApplied = activeRecoveredReservation
      ? (isRecoveredUberOrder
         ? Math.min(activeRecoveredReservation.prepaidPayment?.amount || activeRecoveredReservation.balancePaid || 0, cartTotal)
         : Math.min(activeRecoveredReservation.balancePaid || 0, cartTotal))
      : 0;
   const reservationBalanceDue = isRecoveredUberOrder
      ? 0
      : Math.max(0, cartTotal - reservationAdvanceApplied);
   const activeParkedTicket = activeTable?.currentOrderId
      ? parkedTickets.find(ticket => ticket.id === activeTable.currentOrderId)
      : undefined;
   const activePaymentFraction = activeParkedTicket?.paymentFraction;
   const isCurrentPaymentFraction = isPaymentFractionPlanCurrent(activePaymentFraction, cartTotal);
   const nextPaymentFractionPart = isCurrentPaymentFraction
      ? activePaymentFraction?.parts.find(part => part.status === 'PENDING')
      : undefined;
   const pendingPaymentFractionCount = isCurrentPaymentFraction
      ? activePaymentFraction?.parts.filter(part => part.status === 'PENDING').length || 0
      : 0;
   const isIntermediateFractionPayment = Boolean(nextPaymentFractionPart && pendingPaymentFractionCount > 1);
   const amountBeforeRedemption = activeRecoveredReservation
      ? (isRecoveredUberOrder ? 0 : reservationBalanceDue)
      : nextPaymentFractionPart?.amount ?? cartTotal;
   // Canje EGO Club: cubre parte del ticket y se registra como forma de pago propia.
   // Sólo aplica si el cliente del canje sigue siendo el cliente del ticket.
   const loyaltyRedemptionApplied = loyaltyRedemption
      && selectedCustomer
      && loyaltyRedemption.customerId === selectedCustomer.id
      ? Math.min(loyaltyRedemption.value, amountBeforeRedemption)
      : 0;
   const amountDueNow = Math.max(0, amountBeforeRedemption - loyaltyRedemptionApplied);
   useEffect(() => {
      recordCheckoutDiagnostic('CART_RENDER', { items: processedCart, expectedItemCount: cart.length, total: cartTotal,
         tableId: activeTable?.id, orderId: activeTable?.currentOrderId, terminalId: activeTerminalId });
   }, [processedCart, cartTotal, activeTable?.id, activeTable?.currentOrderId]);

   const canCheckoutWithFiscalPolicy = isOrderTakerMode || isFiscalModeDisabled || fiscalStatus.hasNCF;
   const checkoutActionLabel = isOrderTakerMode
      ? 'GUARDAR PEDIDO'
      : !canCheckoutWithFiscalPolicy
      ? 'Sin Secuencia'
      : isRecoveredUberOrder
         ? 'FACTURAR UBER'
         : activeRecoveredReservation
            ? 'COBRAR SALDO'
            : nextPaymentFractionPart
               ? `COBRAR CUOTA ${nextPaymentFractionPart.index} DE ${activePaymentFraction?.count}`
               : 'COBRAR';
   const editableRecoveredReservation = isRecoveredUberOrder ? null : activeRecoveredReservation;
   const isEditingRecoveredReservation = !!editableRecoveredReservation;

   useEffect(() => {
      const orderId = activeTable?.currentOrderId;
      if (!orderId) return;
      if (closedTableOrderIdsRef.current.has(String(orderId))) return;
      if (cart.length === 0) return;

      const existing = parkedTicketsRef.current.find(ticket => ticket.id === orderId);
      const nextDigest = buildCartDigest(cart);
      const existingDigest = buildCartDigest(existing?.items || []);
      const sameCustomer = (existing?.customerId || '') === (selectedCustomer?.id || '');
      const sameCustomerName = (existing?.customerName || '') === (selectedCustomer?.name || '');
      const existingTotal = Number(existing?.total || 0);
      const sameFinalTotal = Math.abs(existingTotal - cartTotal) < 0.01;
      const sameDiscount =
         Math.abs(Number(existing?.discountAmount || 0) - discountAmount) < 0.01 &&
         (existing?.discountType || 'PERCENT') === globalDiscount.type &&
         Math.abs(Number(existing?.discountValue || 0) - globalDiscount.value) < 0.01;
      const sameGuests = Number(existing?.guests || 0) === Number(activeTable?.guests || 0);
      const sameServiceType = (existing?.serviceType || 'DINE_IN') === effectiveOrderServiceType;

      if (existingDigest === nextDigest && sameCustomer && sameCustomerName && sameFinalTotal && sameDiscount && sameGuests && sameServiceType) {
         return;
      }

      const syncedTicket: ParkedTicket = {
         id: orderId,
         name: existing?.name || activeBarTabName || `Mesa: ${activeTableContext.compactLabel || activeTable.nombre || activeTable.name || orderId}`,
         alias: existing?.alias,
         items: [...cart],
         total: cartTotal,
         discountAmount,
         discountType: globalDiscount.type,
         discountValue: globalDiscount.value,
         guests: activeTable.guests,
         customerId: selectedCustomer?.id,
         customerName: selectedCustomer?.name,
         customerSnapshot: selectedCustomer ? {
            name: selectedCustomer.name,
            taxId: selectedCustomer.taxId,
            address: selectedCustomer.address,
            phone: selectedCustomer.phone,
            email: selectedCustomer.email,
            isTaxExempt: selectedCustomer.isTaxExempt
         } : undefined,
         timestamp: existing?.timestamp || new Date().toISOString(),
         // Editing from any member must retain the shared account's owner and membership.
         tableId: existing?.primaryTableId || activeTable.id,
         primaryTableId: existing?.primaryTableId,
         joinedTableIds: existing?.joinedTableIds,
         orderNumber: readCartOrderNumber(cart) || existing?.orderNumber,
         tableDisplayLabel: activeTableContext.compactLabel || existing?.tableDisplayLabel,
         tableRoomLabel: activeTableContext.roomLabel || existing?.tableRoomLabel,
         barTabId: existing?.barTabId || activeBarTabId || undefined,
         barTabName: existing?.barTabName || activeBarTabName || undefined,
         serviceType: effectiveOrderServiceType,
         paymentFraction: retainCurrentPaymentFractionPlan(existing?.paymentFraction, cartTotal),
      };

      const nextTickets = [
         ...parkedTicketsRef.current.filter(ticket => ticket.id !== orderId),
         syncedTicket
      ];
      // Actualizar la referencia antes de persistir: el siguiente cambio de
      // carrito puede ocurrir antes de que el padre entregue las nuevas props.
      parkedTicketsRef.current = nextTickets;
      const batchClientSync = isClientTerminalMode();

      if (ticketAutoSyncTimeoutRef.current) {
         window.clearTimeout(ticketAutoSyncTimeoutRef.current);
      }

      if (batchClientSync) {
         void Promise.resolve(onUpdateParkedTicketsRef.current(nextTickets, {
            deferRemote: true,
            reason: 'cart_changed',
            changedTicketId: orderId,
         })).catch((error) => {
            console.error('[TABLE_SYNC] No se pudo persistir la cola local de la mesa:', error);
         });
      }

      const flushTicketSync = async () => {
         if (closedTableOrderIdsRef.current.has(String(orderId))) {
            ticketAutoSyncFlushRef.current = null;
            ticketAutoSyncTimeoutRef.current = null;
            return;
         }
         try {
            await Promise.resolve(onUpdateParkedTicketsRef.current(nextTickets, {
               reason: batchClientSync ? 'debounced' : 'explicit',
               changedTicketId: orderId,
            }));
            if (closedTableOrderIdsRef.current.has(String(orderId))) {
               return;
            }
            await Promise.resolve(onTableOrderSavedRef.current?.(activeTable, syncedTicket));
         } catch (error) {
            console.error('[TABLE_SYNC] No se pudo sincronizar automáticamente la mesa:', error);
            if (batchClientSync) {
               setErrorToast('Cambios guardados localmente. Pendiente de sincronizar.');
               window.setTimeout(() => setErrorToast(null), 3000);
            }
         } finally {
            if (ticketAutoSyncFlushRef.current === flushTicketSync) {
               ticketAutoSyncFlushRef.current = null;
               ticketAutoSyncTimeoutRef.current = null;
            }
         }
      };

      ticketAutoSyncFlushRef.current = flushTicketSync;
      const timeoutId = window.setTimeout(
         () => void flushTicketSync(),
         batchClientSync ? 2_000 : 120,
      );
      ticketAutoSyncTimeoutRef.current = timeoutId;

      return () => {
         if (ticketAutoSyncTimeoutRef.current === timeoutId) {
            window.clearTimeout(timeoutId);
            ticketAutoSyncTimeoutRef.current = null;
         }
         if (ticketAutoSyncFlushRef.current === flushTicketSync) {
            ticketAutoSyncFlushRef.current = null;
         }
      };
   }, [
      activeTable?.id,
      activeTable?.currentOrderId,
      activeTableContext.compactLabel,
      activeTableContext.roomLabel,
      activeTable?.nombre,
      activeTable?.name,
      activeBarTabId,
      activeBarTabName,
      cart,
      cartTotal,
      discountAmount,
      globalDiscount.type,
      globalDiscount.value,
      selectedCustomer?.id,
      selectedCustomer?.name,
   ]);

   const handleCreateReservation = async () => {
      if (cart.length === 0) {
         alert('No hay artículos en el ticket para reservar.');
         return;
      }

      const customer = customers.find(c => c.id === reservationCustomerId) || selectedCustomer;
      if (!customer) {
         alert(`Debe seleccionar un cliente para ${isEditingRecoveredReservation ? 'actualizar' : 'crear'} la reserva.`);
         return;
      }

      if (!reservationDeliveryDate) {
         alert('Debe indicar la fecha de entrega de la reserva.');
         return;
      }

      const advance = Math.max(0, parseFloat(reservationAdvanceInput || '0') || 0);
      const minAdvance = reservationPolicy.requireAdvance
         ? (cartTotal * (Math.max(0, reservationPolicy.minimumAdvancePercent || 0) / 100))
         : 0;

      if (reservationPolicy.requireAdvance && advance < minAdvance) {
         alert(`Anticipo insuficiente. Mínimo requerido: ${baseCurrency.symbol}${minAdvance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${reservationPolicy.minimumAdvancePercent}%).`);
         return;
      }

      if (advance > cartTotal) {
         alert('El abono no puede exceder el total de la reserva.');
         return;
      }

      const now = new Date();
      const expiryDate = new Date(now);
      expiryDate.setDate(expiryDate.getDate() + Math.max(1, reservationPolicy.validityDays || 7));

      const reservationId = editableRecoveredReservation?.id || `RSV-${Date.now()}`;
      const reservationCode = editableRecoveredReservation?.code || `RSV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const qrPayload = editableRecoveredReservation?.qrPayload || JSON.stringify({ type: 'RESERVATION_NOTE', id: reservationId, code: reservationCode });
      const warehouseId = editableRecoveredReservation?.warehouseId || defaultSalesWarehouseId || 'wh_central';
      const reservationItems = processedCart.filter(i => (i.quantity || 0) > 0).map(item => ({ ...item }));

      if (reservationItems.length === 0) {
         alert('La reserva requiere al menos una línea de venta positiva.');
         return;
      }

      const reservation: Reservation = {
         id: reservationId,
         code: reservationCode,
         qrPayload,
         customerId: customer.id,
         customerName: customer.name,
         total: cartTotal,
         balancePaid: advance,
         expiryDate: editableRecoveredReservation?.expiryDate || expiryDate.toISOString(),
         status: 'ACTIVE',
         items: reservationItems,
         warehouseId,
         deliveryDate: reservationDeliveryDate ? new Date(`${reservationDeliveryDate}T00:00:00`).toISOString() : undefined,
         terminalId,
         createdById: editableRecoveredReservation?.createdById || currentUser.id,
         createdByName: editableRecoveredReservation?.createdByName || currentUser.name,
         createdAt: editableRecoveredReservation?.createdAt || now.toISOString(),
         updatedAt: now.toISOString()
      };

      await db.saveDocument('reservations', reservation);
      if (editableRecoveredReservation) {
         const previousWarehouseId = editableRecoveredReservation.warehouseId || defaultSalesWarehouseId || 'wh_central';
         await transferStockToCommitted(editableRecoveredReservation.items || [], previousWarehouseId, products, 'RELEASE');
         await transferStockToCommitted(reservation.items, warehouseId, products, 'COMMIT');
      } else {
         await transferStockToCommitted(reservation.items, warehouseId, products, 'COMMIT');
      }
      await reloadReservations();

      setShowReservationModal(false);
      setShowReservationReceipt(reservation);
      setReservationAdvanceInput('0');
      setReservationDeliveryDate('');
      setReservationCustomerId('');
      recordCheckoutDiagnostic('CART_CLEAR_REQUEST', { items: cart, tableId: activeTable?.id, orderId: activeTable?.currentOrderId, reason: 'POS_CLEAR_03' });
      onUpdateCart([]);
      onSelectCustomer(null);
      setActiveRecoveredReservation(null);
      setSuccessToast(`Reserva ${reservation.code} ${isEditingRecoveredReservation ? 'actualizada' : 'creada'}`);
   };

   const pointsEarned = useMemo(() => calculatePointsEarned(processedCart, config), [processedCart, config]);
   const primaryLoyaltyCard = selectedCustomer ? getPrimaryLoyaltyCard(selectedCustomer) : undefined;
   const currentPoints = primaryLoyaltyCard?.pointsBalance || 0;

   // Nivel EGO Club del cliente del ticket (lo resuelve el ERP; aquí sólo se muestra).
   const egoClubTierLabel = selectedCustomer && isEgoClubEnabled(config)
      ? getTierLabel(config, selectedCustomer.tier)
      : '';

   // El canje pertenece al cliente y al ticket: si cambia el cliente o se vacía el
   // ticket, se descarta para no arrastrar un descuento de otra venta.
   useEffect(() => {
      setLoyaltyRedemption(current => {
         if (!current) return current;
         if (!selectedCustomer || current.customerId !== selectedCustomer.id) return null;
         if (cart.length === 0) return null;
         return current;
      });
   }, [selectedCustomer, cart.length]);

   // --- VISOR SYNC ---
   useEffect(() => {
      const displayConfig = activeTerminalConfig?.hardware?.customerDisplay;
      // Always push state to visor if it's listening - the visor will only display if opened
      visorSync.pushState({
         cart: processedCart,
         subtotal: cartSubtotal,
         tax: cartTax,
         discountAmount: discountAmount,
         total: cartTotal,
         welcomeMessage: displayConfig?.welcomeMessage || '¡Bienvenidos!',
         ads: (displayConfig?.ads || []).filter(ad => ad.active),
         currencySymbol: baseCurrency.symbol
      });
   }, [processedCart, cartSubtotal, cartTax, discountAmount, cartTotal, activeTerminalConfig, baseCurrency]);

   useEffect(() => {
      const isVisorMode = isCustomerDisplaySurface();
      if (isVisorMode) return;
      void maybeAutoLaunchCustomerDisplay(
         activeTerminalConfig?.hardware?.customerDisplay,
         { contextKey: terminalId || activeTerminal?.id || 'default' },
      );
   }, [activeTerminal?.id, activeTerminalConfig?.hardware?.customerDisplay, terminalId]);

   useEffect(() => {
      if (cart.length > 0) {
         cartEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
   }, [cart.length]);

   useEffect(() => {
      if (cart.length === 0 && activeRecoveredReservation) {
         setActiveRecoveredReservation(null);
      }
   }, [cart.length, activeRecoveredReservation]);

   useEffect(() => {
      if (cart.length > 0 || !redeemedCoupon) return;
      setRedeemedCoupon(null);
      setCouponCode('');
      setGlobalDiscount({ type: 'PERCENT', value: 0 });
   }, [cart.length, redeemedCoupon]);
   /**
    * Acciones por línea (ticket denso del modo supermercado).
    *
    * Duplicar clona la línea tal cual, sin volver a consultar catálogo ni stock:
    * el stock se descuenta al cobrar, con el ticket ya cerrado.
    */
   const duplicateCartLine = useCallback((cartId: string) => {
      onUpdateCart(prev => {
         const index = prev.findIndex(item => item.cartId === cartId);
         if (index < 0) return prev;
         const source = prev[index];
         const clone: CartItem = {
            ...source,
            cartId: `${source.cartId}-DUP-${Date.now().toString(36)}`,
            createdAt: new Date().toISOString(),
            dispatched: false,
            restaurantCommittedAt: undefined,
            ncf: undefined,
         };
         const next = [...prev];
         next.splice(index + 1, 0, clone);
         return next;
      });
   }, [onUpdateCart]);

   const assignSellerToCartLine = useCallback((cartId: string, sellerId: string | null) => {
      onUpdateCart(prev => prev.map(item => (
         item.cartId === cartId
            ? { ...item, salespersonId: sellerId || undefined }
            : item
      )));
      setSellerPickerCartId(null);
   }, [onUpdateCart]);

   const updateCartItem = async (updatedItem: CartItem | null, cartIdToDelete?: string) => {
      if (blockRecoveredUberOrderMutation('editar el pedido')) return;
      const isSubtotalizedMutation = hasSubtotalizedCart;
      if (!(await authorizeSubtotalizedEdit('Modificar artículo o cantidad de ticket subtotalizado'))) return;

      let newCart: CartItem[] = [];

      if (cartIdToDelete || updatedItem === null) {
         const targetCartId = cartIdToDelete || editingItem?.cartId;
         const originalItem = (cart || []).find(i => i.cartId === targetCartId);
         const isHotRestaurantReversal = canReverseRestaurantDraftWithoutApproval(isRestaurantOrderContext, originalItem);
         if (isKitchenDispatchedCartItem(originalItem)) {
            alert(isKdsReturnedCartItem(originalItem)
               ? 'Este artículo ya fue devuelto en cocina y queda bloqueado para auditoría.'
               : 'Este artículo ya fue enviado al KDS. Usa Devolver para marcarlo en cocina; no se puede borrar directamente.'
            );
            return;
         }

         // Void Line Check
         if (!isSubtotalizedMutation && !isHotRestaurantReversal) {
            const authorized = await requestApproval({
               permission: 'POS_VOID_ITEM',
               actionDescription: 'Eliminar artículo del carrito',
               context: { itemId: targetCartId }
            });
            if (!authorized) return;
         }

         newCart = cart.filter(i => i.cartId !== targetCartId);
      } else {
         // Update Check (Price Override / Discount)
         const originalItem = (cart || []).find(i => i.cartId === updatedItem.cartId);

         if (!originalItem || !isValidCartQuantityTransition(originalItem.quantity, updatedItem.quantity)) {
            setErrorToast('La cantidad no puede llegar a cero ni cambiar una venta en devolución. Use Eliminar o el modo Devolución.');
            window.setTimeout(() => setErrorToast(null), 4000);
            return;
         }

         if (isKitchenDispatchedCartItem(originalItem)) {
            const originalQty = Number(originalItem.quantity || 0);
            const nextQty = Number(updatedItem.quantity || 0);
            if (Math.abs(nextQty - originalQty) > 0.0001) {
               alert(isKdsReturnedCartItem(originalItem)
                  ? 'Este artículo ya fue devuelto en cocina y queda bloqueado para auditoría.'
                  : 'Este artículo ya fue enviado al KDS. Para cancelar la preparación usa Devolver; para agregar más cantidad, agrega una línea nueva.'
               );
               return;
            }
         }

         if (
            !isSubtotalizedMutation
            && requiresRestaurantReductionApproval(isRestaurantOrderContext, originalItem, Number(updatedItem.quantity))
         ) {
            const authorized = await requestApproval({
               permission: 'POS_VOID_ITEM',
               actionDescription: 'Rebajar cantidad de artículo guardado en mesa',
               context: {
                  itemId: updatedItem.cartId,
                  ticketId: activeTable?.currentOrderId,
                  originalValue: originalItem.quantity,
                  newValue: updatedItem.quantity,
               }
            });
            if (!authorized) return;
         }

         // Stock Check (Quantity Increase)
         if (originalItem && updatedItem.quantity > originalItem.quantity) {
            const diff = updatedItem.quantity - originalItem.quantity;
            if (!canAddItemToCart(updatedItem, diff)) return;
         }
         const requestedLineDiscountPercent = updatedItem.adjustmentSource === 'MANUAL_DISCOUNT'
            ? Math.max(0, Number(updatedItem.discountRate || 0) * 100)
            : 0;
         const previousLineDiscountPercent = originalItem.adjustmentSource === 'MANUAL_DISCOUNT'
            ? Math.max(0, Number(originalItem.discountRate || 0) * 100)
            : 0;
         if (requestedLineDiscountPercent > previousLineDiscountPercent + 0.0001) {
            const authorized = await requestApproval({
               permission: 'POS_DISCOUNT',
               actionDescription: `Aplicar ${requestedLineDiscountPercent.toFixed(2)}% de descuento a ${updatedItem.name}`,
               context: {
                  itemId: updatedItem.cartId,
                  originalValue: previousLineDiscountPercent,
                  newValue: requestedLineDiscountPercent,
               },
            });
            if (!authorized) return;
         }
         newCart = cart.map(item => item.cartId === updatedItem.cartId ? updatedItem : item);
      }

      if (isSubtotalizedMutation) newCart = clearCartSubtotalization(newCart);
      onUpdateCart(newCart);

      // KDS Sync (if active table)
      if (activeTable) {
         const ticketId = activeTable.currentOrderId;

         // Update Local Persistence
         if (onUpdateParkedTickets) {
            const updatedTickets = parkedTickets.map(p => p.id === ticketId ? { ...p, items: newCart } : p);
            onUpdateParkedTickets(updatedTickets);
         }
      }
   };

   const handleClearFreshCartItems = async () => {
      if (blockRecoveredUberOrderMutation('limpiar los artículos nuevos del ticket')) return;
      if (hasSubtotalizedCart) {
         if (!await clicConfirm('¿Eliminar por completo este ticket subtotalizado? Esta acción liberará la mesa.')) return;
         const authorized = await requestApproval({
            permission: 'POS_VOID_SUBTOTALIZED_TICKET',
            actionDescription: 'Eliminar ticket subtotalizado',
            context: {
               ticketId: activeTable?.currentOrderId,
               reason: 'Eliminación completa posterior a la impresión del subtotal'
            }
         });
         if (!authorized) return;
         setGlobalDiscount({ type: 'PERCENT', value: 0 });
         setRedeemedCoupon(null);
         setCouponCode('');
         if (activeTable) {
            await releaseActiveEmptyTable({ force: true });
         } else {
            recordCheckoutDiagnostic('CART_CLEAR_REQUEST', { items: cart, tableId: activeTable?.id, orderId: activeTable?.currentOrderId, reason: 'POS_CLEAR_04' });
            onUpdateCart([]);
         }
         return;
      }
      if (cart.length === 0) return;

      const freshItems = cart.filter(item => !isKitchenDispatchedCartItem(item));
      const dispatchedItems = cart.filter(item => isKitchenDispatchedCartItem(item));
      const allFreshItemsAreHotRestaurantDrafts = freshItems.every(item =>
         canReverseRestaurantDraftWithoutApproval(isRestaurantOrderContext, item)
      );

      if (freshItems.length === 0) {
         alert('No hay artículos nuevos para borrar. Los artículos enviados a cocina deben devolverse.');
         return;
      }

      const confirmMessage = dispatchedItems.length > 0
         ? `Se borrarán ${freshItems.length} artículo(s) nuevo(s). ${dispatchedItems.length} artículo(s) ya enviados a cocina se mantendrán en el ticket.`
         : `Se borrarán todos los artículos nuevos del ticket (${freshItems.length}).`;

      if (!await clicConfirm(`${confirmMessage}\n\n¿Continuar?`)) return;

      if (!allFreshItemsAreHotRestaurantDrafts) {
         const authorized = await requestApproval({
            permission: 'POS_VOID_ITEM',
            actionDescription: 'Limpiar artículos nuevos del ticket',
            context: {
               ticketId: activeTable?.currentOrderId,
               reason: `Limpiar ${freshItems.length} artículo(s) nuevo(s); mantener ${dispatchedItems.length} enviado(s) a cocina`,
            }
         });
         if (!authorized) return;
      }

      onUpdateCart(dispatchedItems);
      setActiveCartItemId(null);
      setEditingItem(null);

      if (activeTable) {
         const ticketId = activeTable.currentOrderId;
         if (dispatchedItems.length === 0) {
            await releaseActiveEmptyTable({ silent: true, force: true });
         } else if (ticketId) {
            const total = dispatchedItems.reduce((sum, i) => sum + (Number(i.price || 0) * Number(i.quantity || 0)), 0);
            const updatedTickets = (Array.isArray(parkedTickets) ? parkedTickets : []).map(p =>
               p.id === ticketId ? { ...p, items: dispatchedItems, total } : p
            );
            await Promise.resolve(onUpdateParkedTickets(updatedTickets));

         }
      }

      const keptMessage = dispatchedItems.length > 0
         ? ` ${dispatchedItems.length} enviado(s) a cocina se mantienen.`
         : '';
      setSuccessToast(`${freshItems.length} artículo(s) nuevo(s) borrado(s).${keptMessage}`);
   };

   const syncConsignmentSettlement = useCallback(async (transaction: Transaction): Promise<Transaction> => {
      const consignmentItems = (transaction.items || []).filter(item => item.consignmentId && item.consignmentLineId);
      if (consignmentItems.length === 0) return transaction;

      const alreadySyncedKeys = readConsignmentSyncKeys();
      const grouped = new Map<string, CartItem[]>();
      consignmentItems.forEach(item => {
         const consignmentId = String(item.consignmentId || '').trim();
         if (!consignmentId) return;
         grouped.set(consignmentId, [...(grouped.get(consignmentId) || []), item]);
      });

      const responses: unknown[] = [];
      try {
         for (const [consignmentId, items] of grouped.entries()) {
            const payload = {
               transaction: {
                  id: transaction.id,
                  displayId: transaction.displayId,
                  date: transaction.date,
                  terminalId: transaction.terminalId,
                  userId: transaction.userId,
                  userName: transaction.userName,
               },
               lines: items
                  .map(item => {
                     const idempotencyKey = `${consignmentId}:${item.consignmentLineId}:${transaction.id}`;
                     if (alreadySyncedKeys.has(idempotencyKey)) return null;
                     return {
                        consignmentLineId: String(item.consignmentLineId),
                        productId: item.id,
                        quantity: Math.abs(Number(item.quantity || 0)),
                        unitPrice: Number(item.price || 0),
                        total: Math.abs(Number(item.quantity || 0)) * Number(item.price || 0),
                        localCartId: item.cartId,
                        idempotencyKey,
                     };
                  })
                  .filter(Boolean) as Array<{
                     consignmentLineId: string;
                     productId: string;
                     quantity: number;
                     unitPrice: number;
                     total: number;
                     localCartId?: string;
                     idempotencyKey: string;
                  }>,
            };

            if (payload.lines.length === 0) continue;

            const response = transaction.documentType === 'REFUND'
               ? await consignmentSyncService.returnConsignment(consignmentId, payload)
               : await consignmentSyncService.liquidateConsignment(consignmentId, payload);
            responses.push(response);
            payload.lines.forEach(line => alreadySyncedKeys.add(line.idempotencyKey));
            saveConsignmentSyncKeys(alreadySyncedKeys);
         }

         const updated: Transaction = {
            ...transaction,
            consignmentSyncStatus: 'SYNCED',
            consignmentSyncedAt: new Date().toISOString(),
            consignmentSyncError: undefined,
            consignmentSyncResponse: responses,
         };
         await db.saveDocument('transactions', updated);
         await db.saveDocument('transactionHistory', { ...updated, syncStatus: updated.syncStatus || 'PENDING' } as any).catch(() => undefined);
         return updated;
      } catch (error) {
         const updated: Transaction = {
            ...transaction,
            consignmentSyncStatus: 'ERROR',
            consignmentSyncError: error instanceof Error ? error.message : 'No se pudo sincronizar la consignación.',
         };
         await db.saveDocument('transactions', updated).catch(() => undefined);
         await db.saveDocument('transactionHistory', { ...updated, syncStatus: updated.syncStatus || 'PENDING' } as any).catch(() => undefined);
         setErrorToast('Ticket guardado, pero la liquidación de consignación quedó pendiente.');
         setTimeout(() => setErrorToast(null), 4000);
         return updated;
      }
   }, []);


   const handlePaymentConfirm = async (payments: PaymentEntry[], voluntaryTip?: number): Promise<Transaction | null> => {
      recordCheckoutDiagnostic('CHECKOUT_CONFIRM', { items: processedCart, expectedItemCount: cart.length, total: cartTotal, payments, tableId: activeTable?.id, orderId: activeTable?.currentOrderId, terminalId: activeTerminalId });
      if (paymentFinalizationInFlightRef.current) {
         console.warn('[PAYMENT] Se ignoró un segundo intento de finalizar la misma venta.');
         return null;
      }
      const paymentTrace = getLatestPosInteraction('PAYMENT_CONFIRM');
      paymentFinalizationInFlightRef.current = true;
         const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutLabel: string): Promise<T> => {
         let timeoutHandle: number | undefined;
         try {
            return await Promise.race([
               promise,
               new Promise<T>((_, reject) => {
                  timeoutHandle = window.setTimeout(() => reject(new Error(timeoutLabel)), timeoutMs);
               })
            ]);
         } finally {
            if (timeoutHandle) window.clearTimeout(timeoutHandle);
         }
      };

      try {
         const invalidQuantityItem = processedCart.find(item => !isValidCartQuantity(item.quantity));
         if (invalidQuantityItem) {
            alert(`La cantidad de "${invalidQuantityItem.name}" no es válida. Elimine la línea y agréguela nuevamente.`);
            return null;
         }
         const unclassifiedReturnItem = processedCart.find(item => Number(item.quantity) < 0 && item.isReturnLine !== true);
         if (unclassifiedReturnItem && !refundAuthorizedBy) {
            alert(`La línea negativa "${unclassifiedReturnItem.name}" no fue creada desde el modo Devolución. Corrija el ticket antes de cobrar.`);
            return null;
         }

         const fractionPlan = activeParkedTicket?.paymentFraction;
         const currentFractionPart = isPaymentFractionPlanCurrent(fractionPlan, cartTotal)
            ? fractionPlan?.parts.find(part => part.status === 'PENDING')
            : undefined;
         const pendingFractionParts = fractionPlan?.parts.filter(part => part.status === 'PENDING') || [];

         if (currentFractionPart && pendingFractionParts.length > 1) {
            const paidAt = new Date().toISOString();
            const nextPlan = {
               ...fractionPlan!,
               parts: fractionPlan!.parts.map(part => part.index === currentFractionPart.index ? {
                  ...part,
                  status: 'PAID' as const,
                  payments,
                  voluntaryTip: voluntaryTip || 0,
                  paidAt
               } : part)
            };
            const nextTickets = parkedTickets.map(ticket => ticket.id === activeParkedTicket?.id ? {
               ...ticket,
               paymentFraction: nextPlan
            } : ticket);
            await Promise.resolve(onUpdateParkedTickets(nextTickets));

            return {
               id: `fraction-${activeParkedTicket?.id}-${currentFractionPart.index}-${Date.now()}`,
               documentType: 'TICKET',
               date: paidAt,
               items: [],
               total: currentFractionPart.amount,
               payments,
               userId: currentUser.id,
               userName: currentUser.name,
               terminalId: activeTerminalId,
               status: 'PENDING',
               customerId: effectiveSelectedCustomer?.id,
               customerName: effectiveSelectedCustomer?.name,
               observations: `Cuota ${currentFractionPart.index} de ${fractionPlan?.count}`
            };
         }

         if (currentFractionPart && pendingFractionParts.length === 1) {
            const priorParts = fractionPlan?.parts.filter(part => part.status === 'PAID') || [];
            payments = [
               ...priorParts.flatMap(part => part.payments || []),
               ...payments
            ];
            voluntaryTip = priorParts.reduce((sum, part) => sum + Number(part.voluntaryTip || 0), 0) + Number(voluntaryTip || 0);
         }

         const terminalId = activeTerminalId || 't1';
         const fiscalCompliance = getEffectiveFiscalComplianceConfig(config, activeTerminalConfig);
         const isFiscalModeDisabledForCheckout = fiscalCompliance.mode === 'NONE';
         const uberRecoveredOrder = isUberRecoveredReservation(activeRecoveredReservation) ? activeRecoveredReservation : null;
         const customerForCheckout = uberRecoveredOrder ? null : effectiveSelectedCustomer;
         const couponAssignedTo = redeemedCoupon?.assignedTo?.trim();
         if (couponAssignedTo && couponAssignedTo !== customerForCheckout?.id) {
            alert('El cupón aplicado está asignado a un cliente específico. Seleccione ese cliente antes de finalizar la venta.');
            return null;
         }
         const couponSyncFields = redeemedCoupon
            ? {
               couponCode: redeemedCoupon.code,
               coupons: [{
                  id: redeemedCoupon.id,
                  code: redeemedCoupon.code,
                  campaignId: redeemedCoupon.campaignId
               }]
            }
            : {};
         const hasReturns = processedCart.some(i => i.quantity < 0);
         const hasSales = processedCart.some(i => i.quantity > 0);
         if (hasSales && !ensureSalesWithOpenZPermission()) return null;
         const productsById = new Map(products.map(product => [product.id, product] as const));
         const isRefundOnly = hasReturns && !hasSales;
         const refundSeriesId = resolveTerminalDocumentSeriesId(activeTerminalConfig, 'REFUND') || 'REFUND';
         const assignedSequenceId = resolveTerminalDocumentSeriesId(activeTerminalConfig, 'TICKET')!;
         const normalizedRefundItems = processedCart
            .filter(i => i.quantity < 0)
            .map(item => ({ ...item, quantity: Math.abs(item.quantity) }));
         const sellableConditions = new Map<string, 'SELLABLE' | 'DAMAGED'>();
         normalizedRefundItems.forEach(item => sellableConditions.set(item.cartId, 'SELLABLE'));

         // --- FISCAL COMPLIANCE CHECK (DGII RNC VALIDATION) ---
         const isCreditFiscalDocument = !isFiscalModeDisabledForCheckout && !isRefundOnly && fiscalStatus && (fiscalStatus.type === 'B01' || fiscalStatus.type === 'E31');
         if (isCreditFiscalDocument) {
            const buyerTaxDigits = String(customerForCheckout?.taxId || '').replace(/\D/g, '');
            const hasValidBuyerTaxId = buyerTaxDigits.length === 9 || buyerTaxDigits.length === 11;
            if (!customerForCheckout || !hasValidBuyerTaxId) {
               alert(
                  `⛔ COMPROBANTE BLOQUEADO\n\n` +
                  `Para emitir Crédito Fiscal (${fiscalStatus.type}) debe seleccionar un cliente con RNC/Cédula válido.\n\n` +
                  `Acción requerida: complete el RNC/Cédula del cliente o cambie el tipo de comprobante a Consumo (${fiscalStatus.type === 'E31' ? 'E32' : 'B02'}).`
               );
               return null;
            }

            if (customerForCheckout.fiscalStatus && customerForCheckout.fiscalStatus !== 'ACTIVO') {
               alert(
                  `⛔ COMPROBANTE BLOQUEADO\n\n` +
                  `El contribuyente ${customerForCheckout.name} tiene estatus: ${customerForCheckout.fiscalStatus || 'DESCONOCIDO'}.\n` +
                  `No se puede emitir Crédito Fiscal (${fiscalStatus.type}) según normas de la DGII.\n\n` +
                  `Acción requerida: Cambie el tipo de comprobante a Consumo (${fiscalStatus.type === 'E31' ? 'E32' : 'B02'}) o seleccione otro cliente.`
               );
               return null;
            }
         }

         const validation = validateTerminalSeries(activeTerminalConfig, isRefundOnly ? 'REFUND' : 'TICKET');
         if (!validation.isValid) {
            alert(validation.message);
            return null;
         }

         if (hasReturns && hasSales) {
            const refundValidation = validateTerminalSeries(activeTerminalConfig, 'REFUND');
            if (!refundValidation.isValid) {
               alert(refundValidation.message);
               return null;
            }
         }

         for (const item of processedCart) {
            const sourceProduct = productsById.get(item.id);
            if (!sourceProduct) {
               alert(`No se pudo validar el artículo ${item.name}. Refresque la lista e intente nuevamente.`);
               return null;
            }
            if (!canAddItemToCart(sourceProduct, 0)) {
               alert(`El artículo "${sourceProduct.name}" no tiene un almacén válido para esta terminal. Corrija la ficha del producto antes de continuar.`);
               return null;
            }
         }

         let finalNcf: string | undefined;
         let finalNcfType: FiscalDocumentCode | undefined;
         markInteractionStage(paymentTrace, 'SQL_START');

         if (
            !isOrderTakerMode
            && isFiscalModeDisabledForCheckout
            && isTerminalFiscalReceiptRequired(activeTerminalConfig)
         ) {
            alert(
               'CRÍTICO: La terminal está configurada para emitir comprobantes fiscales, pero el modo fiscal efectivo está deshabilitado.\n\n' +
               'La venta fue bloqueada para evitar una factura sin NCF. Sincronice la configuración o contacte a soporte.'
            );
            return null;
         }

         if (isFiscalModeDisabledForCheckout) {
            finalNcf = undefined;
            finalNcfType = undefined;
         } else if (isRefundOnly) {
            try {
               finalNcf = await withTimeout(
                  db.getNextNCF('B04', terminalId, activeTerminalConfig?.fiscal?.typeConfigs?.['B04']?.batchSize || 50),
                  8000,
                  'TIMEOUT_GET_REFUND_ONLY_NCF'
               );
               finalNcfType = finalNcf ? 'B04' : undefined;
            } catch (refundNcfError) {
               console.warn('No se pudo generar NCF B04 para devolución:', refundNcfError);
            }
         } else {
            finalNcf = await withTimeout(
               db.getNextNCF(fiscalStatus.type, terminalId, activeTerminalConfig?.fiscal?.typeConfigs?.[fiscalStatus.type]?.batchSize || 100),
               8000,
               'TIMEOUT_GET_NCF'
            );

            if (!finalNcf) {
               alert(`CRÍTICO: No hay NCF de ${fiscalStatus.type === 'B01' || fiscalStatus.type === 'E31' ? 'Crédito Fiscal' : 'Consumo'} disponible. Pool DGII agotado.`);
               return null;
            }

            finalNcfType = fiscalStatus.type;
         }

         const reservationAdvance = activeRecoveredReservation && !uberRecoveredOrder
            ? Math.min(activeRecoveredReservation.balancePaid || 0, cartTotal)
            : 0;
         const reservationAdvancePayment: PaymentEntry = {
            id: `ADV-${Date.now()}`,
            method: 'ADVANCE',
            amount: reservationAdvance,
            timestamp: new Date()
         };
         // Canje EGO Club como forma de pago no monetaria, con su propia línea y motivo,
         // para que el cierre de caja cuadre contra el total del ticket.
         const redemptionPayment: PaymentEntry[] = loyaltyRedemptionApplied > 0 && loyaltyRedemption
            ? [{
               id: `LOY-${loyaltyRedemption.id.slice(0, 8)}`,
               method: 'LOYALTY',
               methodId: 'LOYALTY',
               methodLabel: `CANJE EGO CLUB (${loyaltyRedemption.points.toLocaleString('es-DO')} pts)`,
               amount: loyaltyRedemptionApplied,
               timestamp: new Date(),
            }]
            : [];
         const paymentsForTransaction = [
            ...payments,
            ...(reservationAdvance > 0 ? [reservationAdvancePayment] : []),
            ...redemptionPayment,
         ];
         const creditAmount = sumCreditPaymentsBase(paymentsForTransaction);
         const hasCreditOverrideApproval = paymentsForTransaction.some(
            (payment) => paymentEntryIsCxCCredit(payment) && payment.creditOverrideApproved
         );

         if (activeRecoveredReservation && hasReturns) {
            alert('La recuperación de reserva no admite líneas de devolución. Finalice la reserva y procese devoluciones por separado.');
            return null;
         }

         if (creditAmount > 0) {
            const creditGate = evaluateCreditSupervisorGate(customerForCheckout, 0, creditAmount);
            if (creditGate?.reason === 'NO_CUSTOMER') {
               alert('No se puede guardar un ticket con pago pendiente a crédito sin un cliente asociado.');
               onOpenCustomers();
               return null;
            }

            if (creditGate && !hasCreditOverrideApproval) {
               if (creditGate.reason === 'NO_LIMIT') {
                  alert('El cliente no tiene un límite de crédito configurado. Solicite autorización para guardar este ticket.');
               } else {
                  alert(`El cliente excede su límite de crédito (${baseCurrency.symbol}${creditGate.limit.toFixed(2)}). No se guardó el ticket.`);
               }
               return null;
            }
         }

         try {
            // If it's a mixed transaction, use the split endpoint
            if (hasReturns && hasSales) {
               const rawSaleItems = processedCart.filter(i => i.quantity > 0);
               const returnItems = processedCart.filter(i => i.quantity < 0);

               // Calculate totals for each part
               const saleTotal = rawSaleItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
               const normalizedSplitRefundItems = returnItems.map(item => ({ ...item, quantity: Math.abs(item.quantity) }));
               const returnTotal = normalizedSplitRefundItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
               const saleTaxBreakdown = calculateTaxBreakdownFromItems(rawSaleItems, config, {
                  isTaxIncluded,
                  terminalConfig: activeTerminalConfig,
                  taxExempt: isSelectedCustomerTaxExempt,
                  allowedTaxIds: appliedServiceTaxPolicy.taxIds,
               });
               const saleTaxAmount = Math.round((
                  saleTaxBreakdown.reduce((sum, tax) => sum + Number(tax.amount || 0), 0)
                  + Number.EPSILON
               ) * 100) / 100;
               const saleNetAmount = isTaxIncluded
                  ? Math.round(((saleTotal - saleTaxAmount) + Number.EPSILON) * 100) / 100
                  : saleTotal;
               const saleItems = freezeAuthoritativeLineFiscalAmounts(rawSaleItems, config, {
                  isTaxIncluded,
                  terminalConfig: activeTerminalConfig,
                  transactionNetAmount: saleNetAmount,
                  transactionTaxAmount: saleTaxAmount,
                  transactionTotal: saleTotal,
                  allowedTaxIds: appliedServiceTaxPolicy.taxIds,
               });
               const salePayments = payments.filter(p => !['WALLET', 'ADVANCE'].includes(p.method));
               const salePayableTotal = saleTotal + (voluntaryTip || 0);
               const saleSettlement = buildTransactionSettlementFields(salePayments, salePayableTotal, baseCurrency.code);

               // Prepare wallet operations
               const walletDepositAmount = payments.filter(p => p.method === 'ADVANCE').reduce((acc, p) => acc + p.amount, 0);
               const walletPaymentAmount = payments.filter(p => p.method === 'WALLET').reduce((acc, p) => acc + p.amount, 0);
               let refundNcf: string | undefined;

               if (!isFiscalModeDisabledForCheckout && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
                  try {
                     refundNcf = await withTimeout(
                        db.getNextNCF('B04', terminalId, activeTerminalConfig?.fiscal?.typeConfigs?.['B04']?.batchSize || 50),
                        8000,
                        'TIMEOUT_GET_REFUND_NCF'
                     );
                  } catch (refundNcfError) {
                     console.warn('No se pudo generar NCF B04 para devolución mixta:', refundNcfError);
                  }
               }

               const splitPayload: Parameters<typeof transactionService.createSplitTransaction>[0] = {
                     saleTransaction: {
                        documentType: 'TICKET' as const,
                        seriesId: assignedSequenceId,
                        items: saleItems,
                        total: saleTotal,
                        payments: salePayments,
                        ...getConsignmentTicketFields(saleItems),
                        consignmentSyncStatus: saleItems.some(item => item.consignmentId) ? 'PENDING' : undefined,
                        serviceChargeAmount: cartTip,
                        serviceType: effectiveOrderServiceType,
                        serviceTaxPolicySnapshot: appliedServiceTaxPolicy,
                        voluntaryTipAmount: voluntaryTip,
                        ...saleSettlement,
                        ...couponSyncFields,
                        userId: currentUser.id,
                        userName: currentUser.name,
                        terminalId: terminalId,
                        status: creditAmount > 0 ? 'PENDING' : 'COMPLETED',
                        customerId: customerForCheckout?.id,
                        customerName: customerForCheckout?.name,
                        ncf: finalNcf,
                        ncfType: finalNcfType,
                        legacyNcf: finalNcfType?.startsWith('E') ? undefined : finalNcf,
                        electronicNcf: finalNcfType?.startsWith('E') ? finalNcf : undefined,
                        fiscalMode: fiscalCompliance.mode,
                        fiscalProvider: finalNcfType?.startsWith('E') ? getDefaultFiscalProvider(config, activeTerminalConfig) : 'NONE',
                        taxAmount: saleTaxAmount,
                        netAmount: saleNetAmount,
                        taxBreakdown: saleTaxBreakdown,
                        pendingBalance: creditAmount || undefined,
                        dueDate: creditAmount > 0 ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : undefined,
                        balanceDueAtSale: creditAmount > 0 ? creditAmount : undefined,
                        customerSnapshot: customerForCheckout ? {
                           name: customerForCheckout.name,
                           taxId: customerForCheckout.taxId
                        } : undefined,
                        walletPaymentAmount: walletPaymentAmount > 0 ? walletPaymentAmount : undefined
                     },
                     refundTransaction: {
                        documentType: 'REFUND' as const,
                        seriesId: refundSeriesId,
                        items: normalizedSplitRefundItems,
                        total: returnTotal,
                        userId: currentUser.id,
                        userName: currentUser.name,
                        terminalId: terminalId,
                        customerId: customerForCheckout?.id,
                        customerName: customerForCheckout?.name,
                        status: 'COMPLETED',
                        ncf: refundNcf,
                        ncfType: refundNcf ? 'B04' : undefined,
                        walletDepositAmount: walletDepositAmount > 0 ? walletDepositAmount : undefined,
                        walletPaymentAmount: walletPaymentAmount > 0 ? walletPaymentAmount : undefined,
                        serviceChargeAmount: cartTip,
                        serviceType: effectiveOrderServiceType,
                        serviceTaxPolicySnapshot: appliedServiceTaxPolicy,
                        voluntaryTipAmount: voluntaryTip,
                        authorizedById: refundAuthorizedBy?.id,
                        authorizedByName: refundAuthorizedBy?.name
                     },
                     walletDeposit: customerForCheckout?.id && walletDepositAmount > 0 ? { customerId: customerForCheckout.id, amount: walletDepositAmount } : undefined,
                     walletPayment: customerForCheckout?.id && walletPaymentAmount > 0 ? { customerId: customerForCheckout.id, amount: walletPaymentAmount } : undefined
                  };

               if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
                  const durableSplitSaleCommit = isSyncFeatureEnabled('sqlite_outbox_v2');
                  const result = await withTimeout(
                     transactionService.createSplitTransaction(splitPayload, {
                        deferDurableSalePersistence: durableSplitSaleCommit,
                     }),
                     25000,
                     'TIMEOUT_SPLIT_LOCAL'
                  );

                  if (result.sale) {
                     if (durableSplitSaleCommit) {
                        await Promise.resolve(onTransactionComplete(result.sale));
                        if (result.sale.consignmentId) {
                           result.sale = await syncConsignmentSettlement(result.sale);
                        }
                     } else {
                        result.sale = await syncConsignmentSettlement(result.sale);
                        await persistStandaloneSaleHistory({
                           ...result.sale,
                           syncStatus: 'PENDING'
                        });
                     }
                  }

                  if (result.refund) {
                     await persistStandaloneRefundTransaction(
                        {
                           ...result.refund,
                           items: normalizedSplitRefundItems,
                           total: returnTotal,
                           ncf: refundNcf,
                           ncfType: refundNcf ? 'B04' : undefined,
                           status: 'REFUNDED',
                           refundReason: 'Devolución en transacción mixta',
                           authorizedById: refundAuthorizedBy?.id,
                           authorizedByName: refundAuthorizedBy?.name,
                           syncStatus: 'PENDING'
                        },
                        {
                           warehouseId: defaultSalesWarehouseId || 'wh_central',
                           terminalId
                        }
                     );
                  }

                  if (result.sale) commitAppliedCoupon(result.sale);

                  recordCheckoutDiagnostic('CART_CLEAR_REQUEST', { items: cart, tableId: activeTable?.id, orderId: activeTable?.currentOrderId, reason: 'POS_CLEAR_05' });
                  onUpdateCart([]);
                  if (redeemedCoupon) setGlobalDiscount({ type: 'PERCENT', value: 0 });
                  setRedeemedCoupon(null);
                  setCouponCode('');
                  onSelectCustomer(null);
                  setIsReturnMode(false);
                  setRefundAuthorizedBy(null);
                  return result.sale || result.refund || null;
               }

               const response = await withTimeout(fetch('/api/transactions/split', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(splitPayload)
               }), 25000, 'TIMEOUT_SPLIT_FETCH');

               const data = await withTimeout(response.json(), 4000, 'TIMEOUT_SPLIT_PARSE');
               if (data.success) {
                  if (data.result?.sale) {
                     data.result.sale = await syncConsignmentSettlement(data.result.sale);
                     commitAppliedCoupon(data.result.sale);
                  }
                  recordCheckoutDiagnostic('CART_CLEAR_REQUEST', { items: cart, tableId: activeTable?.id, orderId: activeTable?.currentOrderId, reason: 'POS_CLEAR_06' });
                  onUpdateCart([]);
                  if (redeemedCoupon) setGlobalDiscount({ type: 'PERCENT', value: 0 });
                  setRedeemedCoupon(null);
                  setCouponCode('');
                  onSelectCustomer(null);
                  setIsReturnMode(false);
                  setRefundAuthorizedBy(null);
                  return data.result.sale || data.result.refund;
               } else {
                  alert(`Error en transacción: ${data.message}`);
                  return null;
               }
            } else {
               // Standard single transaction logic
               const walletDepositAmount = payments.filter(p => p.method === 'ADVANCE').reduce((acc, p) => acc + p.amount, 0);
               const walletPaymentAmount = payments.filter(p => p.method === 'WALLET').reduce((acc, p) => acc + p.amount, 0);
               const refundDocumentTotal = normalizedRefundItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
               const rawDocumentItems = isRefundOnly ? normalizedRefundItems : processedCart;
               const saleOrderNumber = !isRefundOnly
                  ? (readCartOrderNumber(processedCart) || reserveNextOrderNumber())
                  : undefined;
               const contextualDocumentItems = !isRefundOnly
                  ? applyOrderContextToItems(rawDocumentItems, saleOrderNumber)
                  : rawDocumentItems;
               const documentTotal = isRefundOnly ? refundDocumentTotal : cartTotal;
               const taxAmount = cartTax;
               const netAmount = Math.round(((documentTotal - taxAmount) + Number.EPSILON) * 100) / 100;
               const documentItems = !isRefundOnly
                  ? freezeAuthoritativeLineFiscalAmounts(contextualDocumentItems, config, {
                     discountAmount,
                     isTaxIncluded,
                     terminalConfig: activeTerminalConfig,
                     transactionNetAmount: netAmount,
                     transactionTaxAmount: taxAmount,
                     transactionTotal: documentTotal,
                     taxExempt: isSelectedCustomerTaxExempt,
                     allowedTaxIds: appliedServiceTaxPolicy.taxIds,
                  })
                  : contextualDocumentItems;
               const documentConsignmentFields = getConsignmentTicketFields(documentItems);
               const payableTotal = documentTotal + (voluntaryTip || 0);
               const transactionSettlement = buildTransactionSettlementFields(paymentsForTransaction, payableTotal, baseCurrency.code);
               const salesCommission = !isRefundOnly
                  ? calculateSalesCommission(documentTotal, currentUser)
                  : {};

               const txn = await withTimeout(transactionService.createTransaction({
                  documentType: hasReturns ? 'REFUND' : 'TICKET',
                  seriesId: hasReturns
                     ? (activeTerminalConfig?.documentAssignments?.['REFUND'] || 'REFUND-GENERIC')
                     : assignedSequenceId,
                  date: new Date().toISOString(),
                  items: documentItems,
                  total: documentTotal,
                  payments: paymentsForTransaction,
                  ...documentConsignmentFields,
                  consignmentSyncStatus: documentConsignmentFields.consignmentId ? 'PENDING' : undefined,
                  ...transactionSettlement,
                  userId: currentUser.id,
                  userName: currentUser.name,
                  ...salesCommission,
                  terminalId: terminalId,
                  status: !isRefundOnly && creditAmount > 0 ? 'PENDING' : 'COMPLETED',
                  customerId: customerForCheckout?.id,
                  customerName: customerForCheckout?.name || activeRecoveredReservation?.customerName,
                  orderNumber: saleOrderNumber,
                  tableDisplayLabel: activeTableContext.compactLabel || undefined,
                  tableRoomLabel: activeTableContext.roomLabel || undefined,
                  pendingBalance: creditAmount > 0 ? creditAmount : undefined,
                  dueDate: creditAmount > 0 ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : undefined, // Default 30 days
                  ncf: finalNcf,
                  ncfType: finalNcfType,
                  legacyNcf: finalNcfType?.startsWith('E') ? undefined : finalNcf,
                  electronicNcf: finalNcfType?.startsWith('E') ? finalNcf : undefined,
                  fiscalMode: fiscalCompliance.mode,
                  fiscalProvider: finalNcfType?.startsWith('E') ? getDefaultFiscalProvider(config, activeTerminalConfig) : 'NONE',
                  taxAmount: taxAmount,
                  netAmount: netAmount,
                  taxBreakdown: isRefundOnly ? undefined : taxBreakdown,
                  discountAmount: discountAmount,
                  discountType: globalDiscount.type,
                  discountValue: globalDiscount.value,
                  ...(isRefundOnly ? {} : couponSyncFields),
                  customerSnapshot: customerForCheckout ? {
                     name: customerForCheckout.name,
                     taxId: customerForCheckout.taxId,
                     address: customerForCheckout.address,
                     phone: customerForCheckout.phone,
                     email: customerForCheckout.email
                  } : activeRecoveredReservation ? {
                     name: activeRecoveredReservation.customerName
                  } : undefined,
                  isTaxIncluded: isTaxIncluded,
                  authorizedById: hasReturns ? refundAuthorizedBy?.id : undefined,
                  authorizedByName: hasReturns ? refundAuthorizedBy?.name : undefined,
                  reservationId: uberRecoveredOrder?.sourceOrderId || activeRecoveredReservation?.id,
                  reservationCode: uberRecoveredOrder?.code || activeRecoveredReservation?.code,
                  priorAdvancePaid: reservationAdvance > 0 ? reservationAdvance : undefined,
                  balanceDueAtSale: creditAmount > 0
                     ? creditAmount
                     : activeRecoveredReservation ? reservationBalanceDue : undefined,
                  walletDepositAmount: walletDepositAmount > 0 ? walletDepositAmount : undefined,
                  walletPaymentAmount: walletPaymentAmount > 0 ? walletPaymentAmount : undefined,
                  loyaltyRedemption: loyaltyRedemptionApplied > 0 && loyaltyRedemption
                     ? { ...loyaltyRedemption, value: loyaltyRedemptionApplied }
                     : undefined,
                  serviceChargeAmount: cartTip,
                  serviceType: effectiveOrderServiceType,
                  serviceTaxPolicySnapshot: appliedServiceTaxPolicy,
                  voluntaryTipAmount: voluntaryTip,
                  marketplaceSourceChannel: uberRecoveredOrder ? 'UBER_EATS' : undefined,
                  marketplaceSourceOrderId: uberRecoveredOrder?.sourceOrderId,
                  marketplaceSourceStoreId: uberRecoveredOrder?.sourceStoreId,
                  marketplaceTenantId: uberRecoveredOrder?.tenantId,
                  marketplaceCompanyId: uberRecoveredOrder?.companyId,
                  marketplaceStoreId: uberRecoveredOrder?.storeId,
                  skipErpSaleSync: Boolean(uberRecoveredOrder),
                  erpConfirmationStatus: uberRecoveredOrder ? 'PENDING' : undefined,
                  observations: uberRecoveredOrder
                     ? `Uber Eats ${uberRecoveredOrder.code} / ${uberRecoveredOrder.sourceOrderId}`
                     : undefined
               }, { deferDurablePersistence: !isRefundOnly }), 25000, 'TIMEOUT_CREATE_TRANSACTION');

               // Ensure seriesId is preserved (Backend might not return it in the root object)
               const finalTxn = {
                  ...txn,
                  seriesId: txn.seriesId || (isRefundOnly ? refundSeriesId : assignedSequenceId)
               };
               const durableSaleCommit = !isRefundOnly && isSyncFeatureEnabled('sqlite_outbox_v2');
               let settledFinalTxn = durableSaleCommit
                  ? finalTxn
                  : await syncConsignmentSettlement(finalTxn);

               if (isRefundOnly) {
                  await persistStandaloneRefundTransaction(
                     {
                        ...settledFinalTxn,
                        items: normalizedRefundItems,
                        total: refundDocumentTotal,
                        status: 'REFUNDED',
                        ncf: finalNcf,
                        ncfType: finalNcfType,
                        refundReason: 'Devolución POS',
                        authorizedById: refundAuthorizedBy?.id,
                        authorizedByName: refundAuthorizedBy?.name,
                        syncStatus: 'PENDING'
                     },
                     {
                        warehouseId: defaultSalesWarehouseId || 'wh_central',
                        terminalId,
                        conditions: sellableConditions
                     }
                  );
               } else {
                  await Promise.resolve(onTransactionComplete(settledFinalTxn));
                  // El canje ya se consumió en el ERP: se limpia para el siguiente ticket.
                  setLoyaltyRedemption(null);
                  if (durableSaleCommit && settledFinalTxn.consignmentId) {
                     settledFinalTxn = await syncConsignmentSettlement(settledFinalTxn);
                  }
                  commitAppliedCoupon(settledFinalTxn);
               }

               if (activeRecoveredReservation && !uberRecoveredOrder) {
                  const warehouseId = activeRecoveredReservation.warehouseId || defaultSalesWarehouseId || 'wh_central';
                  await withTimeout(
                     transferStockToCommitted(activeRecoveredReservation.items || [], warehouseId, products, 'RELEASE'),
                     10000,
                     'TIMEOUT_RELEASE_COMMITTED'
                  );
                  await withTimeout(db.saveDocument('reservations', {
                     ...activeRecoveredReservation,
                     status: 'INVOICED',
                     invoicedAt: new Date().toISOString(),
                     invoicedTransactionId: txn.id,
                     updatedAt: new Date().toISOString()
                  }), 6000, 'TIMEOUT_SAVE_RESERVATION_INVOICE');
                  await withTimeout(reloadReservations(), 6000, 'TIMEOUT_RELOAD_RESERVATIONS');
               }

               if (uberRecoveredOrder?.sourceOrderId) {
                  await confirmExistingUberTransaction(uberRecoveredOrder.sourceOrderId, finalTxn);
                  await loadUberPendingOrders();
               }

               // --- CRITICAL: Ticket Closing Logic ---
               if (activeTable) {
                  try {
                     const closedOrderId = String(activeTable.currentOrderId || '').trim();
                     const activeTableId = String(activeTable.id ?? '').trim();
                     const activeBarTabId = String((activeTable as any).activeBarTabId || (activeTable as any).barTabId || '').trim();
                     [closedOrderId, activeBarTabId].filter(Boolean).forEach(id => closedTableOrderIdsRef.current.add(id));
                     if (ticketAutoSyncTimeoutRef.current) {
                        window.clearTimeout(ticketAutoSyncTimeoutRef.current);
                        ticketAutoSyncTimeoutRef.current = null;
                     }
                     ticketAutoSyncFlushRef.current = null;
                     const remaining = (Array.isArray(parkedTickets) ? parkedTickets : []).filter(p => {
                        const ticketId = String(p.id || '').trim();
                        const ticketBarTabId = String((p as any).barTabId || '').trim();
                        const isClosedOrder = closedOrderId && ticketId === closedOrderId;
                        const isClosedBarTab = activeBarTabId && (ticketId === activeBarTabId || ticketBarTabId === activeBarTabId);
                        return !isClosedOrder && !isClosedBarTab;
                     });
                     await Promise.resolve(onUpdateParkedTickets(remaining));

                     const hasOtherTableAccounts = remaining.some(ticket => (
                        String(ticket.tableId ?? '') === activeTableId
                     ));
                     await Promise.resolve(onTableOrderClosed?.(activeTable, activeTable.currentOrderId, remaining));
                     if (!hasOtherTableAccounts) {
                        // 1. Free table in the main API so status/currentOrderId are reset.
                        const controller = new AbortController();
                        const timeoutId = window.setTimeout(() => controller.abort(), 4000);
                        try {
                           const releaseRes = await fetch(resolveOperationalApiUrl('/api/mesas/liberar'), {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ tableId: activeTable.id }),
                              signal: controller.signal
                           });
                           if (!releaseRes.ok) {
                              throw new Error(`HTTP ${releaseRes.status}`);
                           }
                           const releaseData = await releaseRes.json().catch(() => null);
                           if (releaseData && releaseData.success === false) {
                              throw new Error(releaseData.message || 'No se pudo liberar la mesa');
                           }
                        } finally {
                           window.clearTimeout(timeoutId);
                        }
                     }
                  } catch (e) {
                     console.error("Failed to free table:", e);
                  }
                  // 3. Clear Active Table in UI
                  if (onClearActiveTable) onClearActiveTable();
               } else {
                  // If not a table (e.g. Counter Sale), check if it was a parked ticket we just recovered
                  // Heuristic: If we have a selected customer or just checking if the current cart matches a parked ID?
                  // For now, mostly relevant for Tables.
               }

               recordCheckoutDiagnostic('CART_CLEAR_REQUEST', { items: cart, tableId: activeTable?.id, orderId: activeTable?.currentOrderId, reason: 'POS_CLEAR_07' });
               onUpdateCart([]);
               if (redeemedCoupon) setGlobalDiscount({ type: 'PERCENT', value: 0 });
               setRedeemedCoupon(null);
               setCouponCode('');
               onSelectCustomer(null);
               setIsReturnMode(false);
               setRefundAuthorizedBy(null);
               setActiveRecoveredReservation(null);
               setOrderServiceType('DINE_IN');
               // Keep the payment modal mounted so it can show the completed-sale
               // actions. Returning to TABLE_MAP here unmounted it before
               // PaymentModal could render Ticket / Email / Nueva Venta.
               if (activeTable && onOpenTableMap) {
                  setReturnToTableMapAfterPayment(true);
               }
               return txn;
            }
         } catch (error: any) {
            console.error('Split Transaction Error:', error);
            alert(`No se pudo registrar la venta: ${error.message}`);
            return null;
         }
      } catch (error: any) {
         console.error('Payment confirm error:', error);
         alert(`Error al finalizar venta: ${error?.message || 'Error desconocido'}`);
         return null;
      } finally {
         if (paymentTrace?.stages.SQL_START !== undefined && paymentTrace.stages.SQL_END === undefined) {
            markInteractionStage(paymentTrace, 'SQL_END');
         }
         paymentFinalizationInFlightRef.current = false;
      }
   };

   const handleSplitConfirm = (remainingItems: CartItem[], newTicketItems: CartItem[], extraNewTickets: CartItem[][] = [], splitCount = 2) => {
      onUpdateCart(remainingItems);

      const baseName = activeTable?.name || activeTable?.nombre || 'Mesa';
      const now = Date.now();
      const splitGroups = [newTicketItems, ...extraNewTickets].filter(items => items.length > 0);
      const customerSnapshot = selectedCustomer ? {
         name: selectedCustomer.name,
         taxId: selectedCustomer.taxId,
         address: selectedCustomer.address,
         phone: selectedCustomer.phone,
         email: selectedCustomer.email,
         isTaxExempt: selectedCustomer.isTaxExempt
      } : undefined;
      const originalOrderId = activeTable?.currentOrderId;
      const existingOriginal = originalOrderId
         ? parkedTickets.find(ticket => ticket.id === originalOrderId)
         : undefined;
      const remainingTotal = remainingItems.reduce((acc, item) => acc + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
      const remainingTicket: ParkedTicket | null = originalOrderId && remainingItems.length > 0 ? {
         ...(existingOriginal || {}),
         id: originalOrderId,
         name: existingOriginal?.name || `${baseName} - Cuenta 1/${splitCount}`,
         alias: existingOriginal?.alias,
         tableId: activeTable?.id || existingOriginal?.tableId,
         items: remainingItems,
         total: remainingTotal,
         customerId: selectedCustomer?.id || existingOriginal?.customerId,
         customerName: selectedCustomer?.name || existingOriginal?.customerName,
         customerSnapshot: customerSnapshot || existingOriginal?.customerSnapshot,
         timestamp: existingOriginal?.timestamp || new Date().toISOString(),
         orderNumber: readCartOrderNumber(remainingItems) || existingOriginal?.orderNumber,
         tableDisplayLabel: activeTableContext.compactLabel || existingOriginal?.tableDisplayLabel,
         tableRoomLabel: activeTableContext.roomLabel || existingOriginal?.tableRoomLabel,
         barTabId: existingOriginal?.barTabId || activeBarTabId || undefined,
         barTabName: existingOriginal?.barTabName || activeBarTabName || undefined,
         serviceType: existingOriginal?.serviceType || effectiveOrderServiceType,
      } : null;
      const newTickets: ParkedTicket[] = splitGroups.map((items, index) => ({
         id: `split-${now}-${index + 2}`,
         tableId: activeTable?.id || 'manual',
         name: `${baseName} - Cuenta ${index + 2}/${splitCount}`,
         alias: `${baseName} - Cuenta ${index + 2}/${splitCount}`,
         items,
         total: items.reduce((acc, item) => acc + (Number(item.price || 0) * Number(item.quantity || 0)), 0),
         customerId: selectedCustomer?.id,
         customerName: selectedCustomer?.name,
         customerSnapshot,
         tableDisplayLabel: activeTableContext.compactLabel || undefined,
         tableRoomLabel: activeTableContext.roomLabel || undefined,
         barTabId: activeBarTabId || undefined,
         barTabName: activeBarTabName || undefined,
         serviceType: effectiveOrderServiceType,
         timestamp: new Date().toISOString()
      }));

      const nextTickets = [
         ...parkedTickets.filter(ticket => ticket.id !== originalOrderId),
         ...(remainingTicket ? [remainingTicket] : []),
         ...newTickets
      ];
      onUpdateParkedTickets(nextTickets);
      if (activeTable && remainingTicket) {
         void Promise.resolve(onTableOrderSaved?.(activeTable, remainingTicket));
      }
      setShowSplitModal(false);
      setSuccessToast(`Cuenta dividida en ${splitCount}: cuentas guardadas en Tickets en Espera`);
   };

   const proceedToCheckout = async () => {
      const trace = checkoutTraceRef.current || beginPosInteraction('CHECKOUT_OPEN', { source: 'checkout_action' });
      checkoutTraceRef.current = trace;
      expectInteractionRender(trace, 'POS_INTERACTION_VIEW');
      if (isOrderTakerMode) {
         try {
            await handleSendAndExit();
         } catch (error) {
            console.error('[ORDER_TAKER_SAVE_FAILED]', error);
            setErrorToast('No se pudo guardar el pedido en la terminal principal. La mesa permanece abierta.');
            window.setTimeout(() => setErrorToast(null), 3500);
         }
         return;
      }
      const invalidQuantityItem = cart.find(item => !isValidCartQuantity(item.quantity));
      if (invalidQuantityItem) {
         alert(`La cantidad de "${invalidQuantityItem.name}" no es válida. Elimine la línea y agréguela nuevamente.`);
         return;
      }
      const unclassifiedReturnItem = cart.find(item => Number(item.quantity) < 0 && item.isReturnLine !== true);
      if (unclassifiedReturnItem && !refundAuthorizedBy) {
         alert(`La línea negativa "${unclassifiedReturnItem.name}" no fue creada desde el modo Devolución. Corrija el ticket antes de cobrar.`);
         return;
      }
      const hasSaleLines = cart.some(item => Number(item.quantity || 0) > 0);
      if (hasSaleLines && !ensureSalesWithOpenZPermission()) return;
      if (activePaymentFraction && !isCurrentPaymentFraction) {
         alert('El total de la cuenta cambió después de fraccionarla. Vuelva a usar Fraccionar antes de cobrar.');
         return;
      }
      if (!canCheckout) {
         const authorized = await requestApproval({
            permission: 'POS_CHECKOUT',
            actionDescription: 'Autorizar Cobro / Finalizar Venta',
            context: { originalValue: amountDueNow }
         });
         if (!authorized) {
            setErrorToast('Tu rol no permite cobrar. Solicita intervención de supervisor.');
            window.setTimeout(() => setErrorToast(null), 3500);
            return;
         }
      }

      const threshold = activeTerminalConfig?.operational?.fiscalThreshold || 0;
      if (!isFiscalModeDisabled && threshold > 0 && cartTotal > threshold && !selectedCustomer) {
         alert(`ATENCIÓN: El monto de la venta (${baseCurrency.symbol}${cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) excede el umbral fiscal permitido para facturas de consumo (${baseCurrency.symbol}${threshold.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).\n\nEs obligatorio identificar al cliente y emitir una Factura de Crédito Fiscal (B01).`);
         onOpenCustomers();
         return;
      }

      if (activeRecoveredReservation && amountDueNow <= 0.0001) {
         const marketplacePayment = isRecoveredUberOrder
            ? buildUberRecoveredPayment(activeRecoveredReservation, cartTotal)
            : null;
         handlePaymentConfirm(marketplacePayment ? [marketplacePayment] : []).catch(console.error);
         return;
      }
      setReturnToTableMapAfterPayment(false);
      recordCheckoutDiagnostic('CHECKOUT_OPEN', { items: processedCart, expectedItemCount: cart.length, total: cartTotal, tableId: activeTable?.id, orderId: activeTable?.currentOrderId, terminalId: activeTerminalId });
      setShowPaymentModal(true);
      markInteractionStateUpdate(trace, 2);
      markInteractionStage(trace, 'HANDLER_END');
      checkoutTraceRef.current = null;
   };

   const startCheckoutInteraction = () => {
      const trace = beginPosInteraction('CHECKOUT_OPEN', { cartItems: cart.length });
      checkoutTraceRef.current = trace;
      expectInteractionRender(trace, 'POS_INTERACTION_VIEW');
   };

   const persistProductionRoutingAssignments = async (
      assignments: Record<string, string>,
      sourceProducts: Product[],
   ): Promise<Product[]> => {
      const { products: nextProducts, updatedProducts } = applyProductionAreaAssignments(sourceProducts, assignments);
      if (updatedProducts.length === 0) return nextProducts;

      await db.save('products' as any, nextProducts);
      onUpdateProducts(nextProducts);
      window.dispatchEvent(new CustomEvent('productsUpdated'));

      updatedProducts.forEach((product) => {
         void syncManager.broadcastProductRoutingChange(product).catch((error) => {
            console.warn('[PRODUCTION_ROUTING] La ruta quedó guardada localmente; no se pudo publicarla todavía', {
               productId: product.id,
               error: error instanceof Error ? error.message : String(error),
            });
         });
      });

      console.info('[PRODUCTION_ROUTING] Rutas guardadas', {
         productCount: updatedProducts.length,
         source: isClientTerminalMode() ? 'POS_CLIENT' : 'POS_LOCAL_OR_MASTER',
      });
      return nextProducts;
   };

   const handleDispatchCommand = async (
      origin: 'manual' | 'table_exit' = 'manual',
      options: { backgroundTableExit?: boolean } = {},
   ): Promise<ProductionDispatchOutcome> => {
      if (cart.length === 0) return 'CONTINUE_WITHOUT_DISPATCH';

      const newItems = cart.filter(item => !item.dispatched);
      if (newItems.length === 0) {
         if (origin === 'manual') alert("Todos los ítems ya han sido enviados.");
         return 'CONTINUE_WITHOUT_DISPATCH';
      }

      const orderId = activeTable?.currentOrderId || `P-${Date.now()}`;
      const orderNumber = readCartOrderNumber(cart) || reserveNextOrderNumber();
      const displayOrderRef = orderNumber || activeTableContext.compactLabel || orderId;

      try {
         const readProductionRoutingCatalogs = async () => {
            const [configuredAreas, configuredProducts] = await Promise.all([
               db.get('productionAreas' as any).catch(() => []),
               db.get('products' as any).catch(() => []),
            ]);
            const productionAreas: ProductionAreaConfig[] = Array.isArray(configuredAreas) ? configuredAreas : [];
            const productionProducts: Product[] = Array.isArray(configuredProducts) ? configuredProducts : [];
            return {
               productionAreas,
               productionProductCount: productionProducts.length,
               areaById: new Map(productionAreas.map(area => [String(area.id), area])),
               resolveAreaForDispatch: buildProductionAreaResolver(productionAreas, productionProducts),
            };
         };

         let routingCatalogs = await readProductionRoutingCatalogs();

         const groupItemsByProductionArea = () => {
            const grouped: Record<string, { area: ProductionAreaConfig, title: string, items: CartItem[] }> = {};
            newItems.forEach(item => {
               const areaId = routingCatalogs.resolveAreaForDispatch(item);
               if (!areaId) return;

               const configuredArea = routingCatalogs.areaById.get(areaId);
               if (!configuredArea) {
                  console.warn('[KDS] Producto con centro de producción no configurado en POS:', {
                     itemId: item.id,
                     itemName: item.name,
                     areaId,
                  });
                  return;
               }

               if (!grouped[areaId]) {
                  grouped[areaId] = {
                     area: configuredArea,
                     title: configuredArea.nombre || areaId,
                     items: []
                  };
               }
               grouped[areaId].items.push(item);
            });
            return grouped;
         };

         // 1. Group only routed items by production area for separate tickets/KDS screens.
         const dispatchMetaByCartId = new Map<string, KdsDispatchMeta>();
         let areas = groupItemsByProductionArea();
         let areaEntries = Object.entries(areas);

         const countUnresolvedProductionRoutes = () => newItems.reduce((count, item) => {
            const areaId = routingCatalogs.resolveAreaForDispatch(item);
            return count + (areaId && routingCatalogs.areaById.has(areaId) ? 0 : 1);
         }, 0);

         // The LAN Master owns production centers and product routing. A client may
         // already have a non-empty sales catalog while those routing fields are
         // stale, so product-count checks cannot be used to decide whether to heal.
         // Refresh only on an unresolved dispatch; the normal table flow remains
         // local and does not add periodic network work.
         const unresolvedRouteCount = countUnresolvedProductionRoutes();
         if (shouldRefreshClientProductionRouting({
            isClientTerminal: isClientTerminalMode(),
            pendingItemCount: newItems.length,
            unresolvedRouteCount,
         })) {
            try {
               console.info('[PRODUCTION_ROUTING] Recuperando rutas autoritativas desde la Master', {
                  origin,
                  pendingItemCount: newItems.length,
                  unresolvedRouteCount,
                  localProductionAreaCount: routingCatalogs.productionAreas.length,
                  localProductCount: routingCatalogs.productionProductCount,
               });
               await syncManager.pullProductionRoutingFromLinkedMaster();
               routingCatalogs = await readProductionRoutingCatalogs();
               areas = groupItemsByProductionArea();
               areaEntries = Object.entries(areas);
               console.info('[PRODUCTION_ROUTING] Rutas autoritativas recuperadas', {
                  productionAreaCount: routingCatalogs.productionAreas.length,
                  productCount: routingCatalogs.productionProductCount,
                  unresolvedRouteCount: countUnresolvedProductionRoutes(),
               });
            } catch (routingRefreshError) {
               console.warn('[KDS] No se pudo recuperar el enrutamiento de producción desde la Master:', routingRefreshError);
            }
         }

         const productByKey = new Map<string, Product>();
         const refreshedProducts = await db.get('products' as any).catch(() => []) as Product[];
         (Array.isArray(refreshedProducts) ? refreshedProducts : []).forEach((product) => {
            collectKdsProductKeys(product).forEach(key => {
               if (!productByKey.has(key)) productByKey.set(key, product);
            });
         });

         const unassignedByProductId = new Map<string, ProductionRoutingPromptItem>();
         newItems.forEach((item) => {
            const resolvedAreaId = routingCatalogs.resolveAreaForDispatch(item);
            if (resolvedAreaId && routingCatalogs.areaById.has(resolvedAreaId)) return;

            const catalogProduct = collectKdsProductKeys(item)
               .map(key => productByKey.get(key))
               .find(Boolean);
            const productId = String(catalogProduct?.id || item.id || '').trim();
            if (!productId) return;
            const current = unassignedByProductId.get(productId);
            unassignedByProductId.set(productId, {
               id: productId,
               name: String(catalogProduct?.name || item.name || 'Artículo'),
               quantity: Number(current?.quantity || 0) + Number(item.quantity || 0),
            });
         });

         const routingStrategy = selectProductionRoutingStrategy({
            productionAreaCount: routingCatalogs.productionAreas.length,
            pendingItemCount: newItems.length,
            unassignedItemCount: unassignedByProductId.size,
         });

         if (routingStrategy === 'NO_PRODUCTION_AREAS') {
            console.info('[PRODUCTION_ROUTING] Salida sin envío: POS sin centros de producción', { origin });
            return 'CONTINUE_WITHOUT_DISPATCH';
         }

         if (routingStrategy === 'PROMPT_ASSIGNMENT') {
            const decision = await requestProductionRoutingDecision({
               items: Array.from(unassignedByProductId.values()),
               areas: routingCatalogs.productionAreas.map(area => ({
                  id: String(area.id),
                  name: String(area.nombre || area.name || area.id),
               })),
            });

            if (decision.kind === 'CANCEL') return 'CANCELLED';
            if (decision.kind === 'ASSIGN') {
               const nextProducts = await persistProductionRoutingAssignments(
                  decision.assignments,
                  Array.isArray(refreshedProducts) ? refreshedProducts : [],
               );
               const assignedResolver = buildProductionAreaResolver(
                  routingCatalogs.productionAreas,
                  nextProducts,
               );
               routingCatalogs = {
                  ...routingCatalogs,
                  resolveAreaForDispatch: (item: any) => {
                     const productId = collectKdsProductKeys(item)
                        .map(key => productByKey.get(key)?.id)
                        .find(Boolean);
                     const assignedAreaId = productId ? decision.assignments[String(productId)] : undefined;
                     return assignedAreaId || assignedResolver(item);
                  },
               };
            }

            areas = groupItemsByProductionArea();
            areaEntries = Object.entries(areas);
         }

         if (areaEntries.length === 0) {
            return 'CONTINUE_WITHOUT_DISPATCH';
         }

         let printedCount = 0;
         let sentKdsCount = 0;
         let queuedKdsCount = 0;
         const dispatchedCartIds = new Set<string>();
         const queuedCartIds = new Set<string>();
         const sentCartIds = new Set<string>();
         const activeTableRoom = activeTable?.roomId ? rooms?.find(room => room.id === activeTable.roomId) : undefined;
         const kdsTablePayload = activeTable ? {
            id: activeTable.id,
            name: activeTable.name || activeTable.nombre,
            displayLabel: activeTableContext.compactLabel || null,
            roomId: activeTable.roomId || null,
            roomName: activeTableRoom?.name || activeTableRoom?.nombre || null,
            guests: activeTable.guests || activeTable.capacity || null,
         } : null;

         // 2. Print and/or send to KDS per configured area.
         for (const [areaId, areaData] of Object.entries(areas)) {
            const { mode, shouldPrint, shouldSendKds } = resolveProductionOutputTargets(areaData.area.modo_salida);

            if (shouldPrint) {
               try {
                  const printed = await printComanda(config, {
                     items: areaData.items,
                     table: activeTable
                        ? ({ ...activeTable, tableDisplayLabel: activeTableContext.compactLabel } as any)
                        : undefined,
                     orderNumber,
                     customerName: selectedCustomer?.name,
                     areaTitle: areaData.title,
                     productionAreaId: areaId,
                     printerId: areaData.area.printer_id || areaData.area.printerId
                  });
                  if (printed) {
                     printedCount += 1;
                  } else {
                     console.warn('[PRODUCTION] La impresora no confirmó la comanda; se continuará con las demás salidas.', {
                        areaId,
                        mode,
                     });
                  }
               } catch (printError) {
                  console.error('[PRODUCTION] Falló la impresión de comanda; se continuará con KDS.', {
                     areaId,
                     mode,
                     error: printError,
                  });
               }
            }

            if (shouldSendKds) {
               const kdsBaseUrl = resolveKdsBaseUrl(areaData.area, config);
               const kdsItems = buildKdsDispatchItems(areaData.items, areaId);
               const areaTotal = areaData.items.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
               const warningMinutes = normalizeKdsMinutes(areaData.area.kds_warning_minutes, 10);
               const criticalMinutes = Math.max(
                  warningMinutes + 1,
                  normalizeKdsMinutes(areaData.area.kds_critical_minutes, 20)
               );
               const kdsPayload = {
                  orderId,
                  displayId: displayOrderRef,
                  orderNumber,
                  date: new Date().toISOString(),
                  terminalId: activeTerminalId,
                  sourceTerminal: {
                     id: activeTerminalId,
                     code: activeTerminalConfig?.stationNumber || activeTerminalConfig?.erpBinding?.stationNumber || terminalDisplayLabel,
                     name: activeTerminalConfig?.terminalName || activeTerminalConfig?.erpBinding?.terminalName || terminalDisplayLabel,
                  },
                  userName: currentUser.name,
                  customerName: selectedCustomer?.name || 'Cliente General',
                  table: kdsTablePayload,
                  area: {
                     id: areaId,
                     name: areaData.title,
                     targetTerminalId: areaData.area.target_terminal_id || null,
                     targetTerminalName: areaData.area.target_terminal_name || areaData.title,
                     warningMinutes,
                     criticalMinutes,
                  },
                  kdsTiming: {
                     warningMinutes,
                     criticalMinutes,
                  },
                  items: kdsItems,
                  total: areaTotal,
               };

               if (!kdsBaseUrl) {
                  queuedKdsCount += 1;
                  areaData.items.forEach(item => queuedCartIds.add(getCartDispatchKey(item)));
                  await queuePendingKdsDispatch({
                     reason: 'KDS_HOST_NOT_CONFIGURED',
                     orderId,
                     areaId,
                     areaName: areaData.title,
                     cartIds: areaData.items.map(getCartDispatchKey),
                     payload: kdsPayload,
                  });
               } else {
                  try {
                     await postJsonWithTimeout(`${kdsBaseUrl}/api/ordenes/${encodeURIComponent(orderId)}`, {
                        items: kdsItems,
                        total: areaTotal,
                        status: 'OCCUPIED',
                        displayId: displayOrderRef,
                        orderNumber,
                        terminalId: activeTerminalId,
                        sourceTerminal: kdsPayload.sourceTerminal,
                        userName: currentUser.name,
                        customerName: selectedCustomer?.name || 'Cliente General',
                        table: kdsTablePayload,
                        area: kdsPayload.area,
                        kdsTiming: kdsPayload.kdsTiming,
                     });
                     const endpoint = `${kdsBaseUrl}/api/ordenes/enviar-comanda/${encodeURIComponent(orderId)}`;
                     await postJsonWithTimeout(endpoint, kdsPayload);
                     sentKdsCount += 1;
                     areaData.items.forEach(item => sentCartIds.add(getCartDispatchKey(item)));
                  } catch (kdsError: any) {
                     queuedKdsCount += 1;
                     areaData.items.forEach(item => queuedCartIds.add(getCartDispatchKey(item)));
                     console.warn('[KDS] No se pudo enviar comanda al KDS LAN:', kdsError);
                     await queuePendingKdsDispatch({
                        reason: kdsError?.message || 'KDS_UNREACHABLE',
                        kdsBaseUrl,
                        orderId,
                        areaId,
                        areaName: areaData.title,
                        cartIds: areaData.items.map(getCartDispatchKey),
                        payload: kdsPayload,
                     });
                  }
               }
            }

            areaData.items.forEach((item, index) => {
               const key = getCartDispatchKey(item);
               dispatchedCartIds.add(key);
               dispatchMetaByCartId.set(key, {
                  areaId,
                  orderId,
                  itemIds: buildKdsItemIds(orderId, areaId, item, index),
               });
            });
         }

         // 3. Mark items as dispatched in state
         const updatedCart = cart.map(item => {
            const key = getCartDispatchKey(item);
            const dispatchMeta = dispatchMetaByCartId.get(key);
            return dispatchedCartIds.has(key) ? {
               ...item,
               ...(dispatchMeta?.orderId ? { orderNumber: orderNumber || item.orderNumber } : {}),
               ...(activeTableContext.compactLabel ? { tableDisplayLabel: activeTableContext.compactLabel } : {}),
               ...(activeTableContext.roomLabel ? { tableRoomLabel: activeTableContext.roomLabel } : {}),
               dispatched: true,
               kdsStatus: queuedCartIds.has(key) && !sentCartIds.has(key) ? 'PENDIENTE' : 'ENVIADO',
               ...(queuedCartIds.has(key) && !sentCartIds.has(key) ? { kdsQueuedAt: new Date().toISOString() } : {}),
               kdsOrderId: dispatchMeta?.orderId,
               kdsAreaId: dispatchMeta?.areaId,
               kdsItemIds: dispatchMeta?.itemIds,
               production_area_id: dispatchMeta?.areaId || resolveProductionAreaId(item) || undefined,
               restaurantConfig: {
                  ...(item.restaurantConfig || {}),
                  production_area_id: dispatchMeta?.areaId || item.restaurantConfig?.production_area_id || undefined,
               },
            } : item;
         });
         if (!options.backgroundTableExit) onUpdateCart(updatedCart);

         // 4. Save state to DB (Parking)
         if (activeTable) {
            if (options.backgroundTableExit) {
               // The map may already be visible and another table may be opened
               // while production I/O completes. Update only the captured order;
               // never write this result back into the live cart.
               const liveTickets = parkedTicketsRef.current;
               const activeOrderId = String(activeTable.currentOrderId || orderId);
               const currentTicket = liveTickets.find(ticket => String(ticket.id) === activeOrderId);
               if (currentTicket) {
                  const dispatchedTicket = {
                     ...currentTicket,
                     items: updatedCart,
                     total: updatedCart.reduce(
                        (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
                        0,
                     ),
                  };
                  const nextTickets = liveTickets.map(ticket =>
                     String(ticket.id) === activeOrderId ? dispatchedTicket : ticket
                  );
                  parkedTicketsRef.current = nextTickets;
                  await Promise.resolve(onUpdateParkedTickets(nextTickets, { reason: 'explicit' }));
               }
            } else {
               await handleParkCurrentTicket(undefined, updatedCart);
            }
         }

         const parts = [
            printedCount > 0 ? `${printedCount} ticket(s)` : '',
            sentKdsCount > 0 ? `${sentKdsCount} KDS` : '',
            queuedKdsCount > 0 ? `${queuedKdsCount} KDS pendiente(s)` : '',
         ].filter(Boolean);
         setSuccessToast(parts.length > 0 ? `Comanda procesada: ${parts.join(' · ')}` : 'Comanda procesada');
         return 'DISPATCHED';

      } catch (e) {
         console.error("Dispatch error:", e);
         alert("Error al procesar el envío a cocina");
         return 'CANCELLED';
      }
   };

   const handleReturnDispatchedCartItem = async (item: CartItem) => {
      if (blockRecoveredUberOrderMutation('devolver el artículo enviado a cocina')) return;
      if (!item.dispatched) {
         await updateCartItem(null, item.cartId);
         return;
      }
      if (isKdsReturnedCartItem(item)) {
         alert('Este artículo ya fue marcado como devuelto en cocina.');
         return;
      }

      const authorized = await requestApproval({
         permission: 'POS_VOID_ITEM',
         actionDescription: 'Devolver artículo enviado al KDS',
         context: {
            itemId: item.cartId,
            ticketId: item.kdsOrderId || activeTable?.currentOrderId,
            reason: 'Devolución de artículo enviado al KDS'
         }
      });
      if (!authorized) return;

      const confirmed = await clicConfirm(`¿Marcar "${item.name}" como devuelto en cocina? El plato no debe prepararse y la línea quedará en el ticket como auditoría.`);
      if (!confirmed) return;

      try {
         const configuredAreas = await db.get('productionAreas' as any).catch(() => []) as any;
         const productionAreas: ProductionAreaConfig[] = Array.isArray(configuredAreas) ? configuredAreas : [];
         const configuredProducts = await db.get('products' as any).catch(() => []) as any;
         const productionProducts: Product[] = Array.isArray(configuredProducts) ? configuredProducts : [];
         const areaById = new Map(productionAreas.map(area => [String(area.id), area]));
         const resolveAreaForDispatch = buildProductionAreaResolver(productionAreas, productionProducts);
         const areaId = String(item.kdsAreaId || resolveAreaForDispatch(item) || '').trim();
         const area = areaById.get(areaId);
         const orderId = String(item.kdsOrderId || activeTable?.currentOrderId || '').trim();

         if (!orderId || !area) {
            alert('No se pudo ubicar la orden o el centro de producción para devolver este artículo en cocina.');
            return;
         }

         const kdsBaseUrl = resolveKdsBaseUrl(area, config);
         if (!kdsBaseUrl) {
            alert('El centro de producción no tiene ruta KDS disponible. Configura la IP/terminal antes de devolver en cocina.');
            return;
         }

         await postJsonWithTimeout(`${kdsBaseUrl}/api/cocina/cambiar-estado`, {
            orden_id: orderId,
            item_id: item.kdsItemIds?.[0],
            item_ids: item.kdsItemIds || [],
            cart_id: item.cartId,
            producto_id: item.id,
            nuevo_estado: 'DEVUELTO',
         });

         const returnedAt = new Date().toISOString();
         const newCart = cart.map((cartItem) => {
            if (cartItem.cartId !== item.cartId) return cartItem;
            return {
               ...cartItem,
               price: 0,
               kdsOriginalPrice: cartItem.kdsOriginalPrice ?? cartItem.price,
               kdsStatus: 'DEVUELTO',
               kdsReturnedAt: returnedAt,
               voidedByKdsReturn: true,
               returnReason: 'Devuelto en cocina',
            };
         });
         onUpdateCart(newCart);

         if (activeTable && onUpdateParkedTickets) {
            const ticketId = activeTable.currentOrderId;
            const total = newCart.reduce((sum, cartItem) => sum + (Number(cartItem.price || 0) * Number(cartItem.quantity || 0)), 0);
            onUpdateParkedTickets(parkedTickets.map(ticket => ticket.id === ticketId ? { ...ticket, items: newCart, total } : ticket));
         }

         setSuccessToast(`Artículo devuelto en cocina: ${item.name}`);
      } catch (error: any) {
         console.error('[KDS] No se pudo marcar artículo como devuelto:', error);
         alert(`No se pudo marcar el artículo como devuelto en cocina: ${error?.message || 'error desconocido'}`);
      }
   };

   const handlePrintPrecuenta = async () => {
      if (cart.length === 0) return;
      setSuccessToast('Generando subtotal...');
      try {
         const printed = await printPrecuenta(config, {
            items: processedCart.filter(item => Number(item.quantity || 0) > 0),
            subtotal: cartSubtotal,
            discountTotal: discountAmount,
            discountType: globalDiscount.type,
            discountValue: globalDiscount.value,
            taxTotal: cartTax,
            finalTotal: cartTotal,
            table: activeTable,
            customerName: effectiveSelectedCustomer?.name,
            terminalId,
            orderNumber: readCartOrderNumber(cart),
            tableDisplayLabel: activeTableContext.compactLabel || activeTableContext.tableLabel,
         });

         if (printed) {
            const subtotalizedAt = new Date().toISOString();
            const nextCart = cart.map(item => ({
               ...item,
               subtotalizedAt: item.subtotalizedAt || subtotalizedAt,
               subtotalizedBy: item.subtotalizedBy || currentUser?.name || currentUser?.id || 'POS'
            }));
            onUpdateCart(nextCart);
            const activeOrderId = String(activeTable?.currentOrderId || '').trim();
            if (activeOrderId) {
               const nextTickets = parkedTickets.map(ticket => String(ticket.id) === activeOrderId
                  ? { ...ticket, items: nextCart }
                  : ticket
               );
               parkedTicketsRef.current = nextTickets;
               await Promise.resolve(onUpdateParkedTickets(nextTickets));
            }
            setSuccessToast('Subtotal enviado a impresora. Esta cuenta requiere autorización para modificarse.');
            return;
         }

         setSuccessToast(null);
         setErrorToast('No se pudo imprimir la precuenta. Verifica la impresora de ticket.');
         window.setTimeout(() => setErrorToast(null), 3000);
      } catch (error) {
         console.error('Error imprimiendo precuenta:', error);
         setSuccessToast(null);
         setErrorToast('No se pudo imprimir la precuenta.');
         window.setTimeout(() => setErrorToast(null), 3000);
      }
   };

   const openReservationModal = () => {
      if (blockRecoveredUberOrderMutation('convertirlo en reserva')) return;

      const formatDateForInput = (value?: string) => {
         if (!value) return '';
         const d = new Date(value);
         if (Number.isNaN(d.getTime())) return '';
         const yyyy = d.getFullYear();
         const mm = String(d.getMonth() + 1).padStart(2, '0');
         const dd = String(d.getDate()).padStart(2, '0');
         return `${yyyy}-${mm}-${dd}`;
      };
      const today = new Date().toISOString().slice(0, 10);
      if (editableRecoveredReservation) {
         setReservationCustomerId(editableRecoveredReservation.customerId || selectedCustomer?.id || '');
         setReservationAdvanceInput(String(editableRecoveredReservation.balancePaid || 0));
         setReservationDeliveryDate(formatDateForInput(editableRecoveredReservation.deliveryDate) || today);
      } else {
         setReservationCustomerId(selectedCustomer?.id || '');
         setReservationAdvanceInput('0');
         setReservationDeliveryDate(today);
      }
      setShowReservationModal(true);
   };

   const releaseActiveEmptyTable = async (options: { silent?: boolean; force?: boolean } = {}): Promise<boolean> => {
      if (!activeTable || (!options.force && cart.length > 0)) return false;

      const tableToRelease = activeTable;

      if (tableToRelease.currentOrderId) {
         const releasedOrderId = String(tableToRelease.currentOrderId);
         const releasedTableId = String(tableToRelease.id ?? '');
         const remaining = parkedTickets.filter(p => {
            const isReleasedOrder = String(p.id) === releasedOrderId;
            return !isReleasedOrder;
         });
         // El journal local se escribe de forma síncrona dentro del callback;
         // SQLite/Outbox continúan en su cola sin bloquear el regreso al mapa.
         void Promise.resolve(onUpdateParkedTickets(remaining)).catch(() => {
            setErrorToast('No se pudo confirmar con la Master. La liberación quedó pendiente localmente.');
            window.setTimeout(() => setErrorToast(null), 3500);
         });
         void Promise.resolve(onTableOrderClosed?.(tableToRelease, tableToRelease.currentOrderId, remaining));
         if (remaining.some(ticket => String(ticket.tableId ?? '') === releasedTableId)) {
            recordCheckoutDiagnostic('CART_CLEAR_REQUEST', { items: cart, tableId: activeTable?.id, orderId: activeTable?.currentOrderId, reason: 'POS_CLEAR_08' });
            onUpdateCart([]);
            onSelectCustomer(null);
            setActiveRecoveredReservation(null);
            if (onClearActiveTable) onClearActiveTable();
            if (!options.silent) {
               setSuccessToast(tableToRelease.shape === 'BAR'
                  ? 'Minuta liberada. La barra sigue abierta.'
                  : 'Cuenta liberada. La mesa conserva cuentas pendientes.');
            }
            return true;
         }
      } else {
         void Promise.resolve(onTableOrderClosed?.(tableToRelease, undefined, parkedTickets));
      }

      recordCheckoutDiagnostic('CART_CLEAR_REQUEST', { items: cart, tableId: activeTable?.id, orderId: activeTable?.currentOrderId, reason: 'POS_CLEAR_09' });
      onUpdateCart([]);
      onSelectCustomer(null);
      setActiveRecoveredReservation(null);
      if (onClearActiveTable) onClearActiveTable();
      if (!options.silent) {
         setSuccessToast('Mesa liberada (sin productos)');
      }

      void (async () => {
         const controller = new AbortController();
         const timeoutId = window.setTimeout(() => controller.abort(), 2500);
         try {
            const releaseRes = await fetch(resolveOperationalApiUrl('/api/mesas/liberar'), {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ tableId: tableToRelease.id }),
               signal: controller.signal
            });
            const releaseData = await releaseRes.json().catch(() => null);

            if (!releaseRes.ok || (releaseData && releaseData.success === false)) {
               throw new Error(releaseData?.message || `HTTP ${releaseRes.status}`);
            }
         } catch (error) {
            console.warn('No se pudo confirmar la liberacion de mesa en servidor:', error);
         } finally {
            window.clearTimeout(timeoutId);
         }
      })();

      return true;
   };

   const handleParkCurrentTicket = async (aliasInput?: string, cartOverride?: CartItem[]) => {
      if (blockRecoveredUberOrderMutation('guardarlo como ticket en espera')) return;
      const ticketItems = cartOverride || cart;
      if (ticketItems.length === 0) return;
      const parkedTicketId = activeTable?.currentOrderId || `P-${Date.now()}`;
      const existingParked = (Array.isArray(parkedTickets) ? parkedTickets : []).find((ticket) => ticket.id === parkedTicketId);
      const normalizedAlias = aliasInput === undefined
         ? existingParked?.alias
         : (aliasInput.trim() || undefined);
      const ticketTotal = ticketItems.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
      const resolvedTicketTotal = cartOverride ? Math.max(0, ticketTotal - discountAmount) : cartTotal;
      const newParked: ParkedTicket = {
         id: parkedTicketId,
         name: buildParkedTicketName(),
         alias: normalizedAlias,
         items: [...ticketItems],
         total: resolvedTicketTotal,
         discountAmount,
         discountType: globalDiscount.type,
         discountValue: globalDiscount.value,
         guests: activeTable?.guests ?? existingParked?.guests,
         customerId: selectedCustomer?.id,
         customerName: selectedCustomer?.name,
         customerSnapshot: selectedCustomer ? {
            name: selectedCustomer.name,
            taxId: selectedCustomer.taxId,
            address: selectedCustomer.address,
            phone: selectedCustomer.phone,
            email: selectedCustomer.email,
            isTaxExempt: selectedCustomer.isTaxExempt
         } : undefined,
         timestamp: existingParked?.timestamp || new Date().toISOString(),
         tableId: existingParked?.primaryTableId || activeTable?.id || existingParked?.tableId,
         primaryTableId: existingParked?.primaryTableId,
         joinedTableIds: existingParked?.joinedTableIds,
         orderNumber: readCartOrderNumber(ticketItems) || existingParked?.orderNumber,
         tableDisplayLabel: activeTableContext.compactLabel || existingParked?.tableDisplayLabel,
         tableRoomLabel: activeTableContext.roomLabel || existingParked?.tableRoomLabel,
         barTabId: existingParked?.barTabId || activeBarTabId || undefined,
         barTabName: existingParked?.barTabName || activeBarTabName || undefined,
         serviceType: effectiveOrderServiceType,
         paymentFraction: retainCurrentPaymentFractionPlan(existingParked?.paymentFraction, resolvedTicketTotal),
      };

      // Remove existing if updating same ID
      const updatedTickets = [...(Array.isArray(parkedTickets) ? parkedTickets : []).filter(p => p.id !== newParked.id), newParked];
      cancelTicketAutoSync();
      try {
         await Promise.resolve(onUpdateParkedTickets(updatedTickets, { reason: 'explicit' }));
      } catch (error) {
         setErrorToast('No se pudo confirmar con la Master. Los cambios siguen guardados localmente.');
         window.setTimeout(() => setErrorToast(null), 3500);
         throw error;
      }
      closeParkAliasModal();

      if (activeTable) {
         await Promise.resolve(onTableOrderSaved?.(activeTable, newParked));

         if (onOpenTableMap) {
            await Promise.resolve(onOpenTableMap());
         } else if (onClearActiveTable) {
            onClearActiveTable();
         }
      }

      onUpdateCart([]); onSelectCustomer(null);
      setActiveRecoveredReservation(null);
      setErrorToast(activeTable ? "Mesa Guardada" : "Ticket Guardado");
      setTimeout(() => setErrorToast(null), 2000);
      if (!activeTable) returnToTicketView();
   };

   const saveActiveTableOrderForMap = async () => {
      if (!activeTable || cart.length === 0) return;

      const parkedTicketId = activeTable.currentOrderId || `ORD-${Date.now()}`;
      const existingParked = (Array.isArray(parkedTickets) ? parkedTickets : []).find((ticket) => ticket.id === parkedTicketId);
      const tableName = activeTable.nombre || activeTable.name || 'Mesa';
      const tableOrder: ParkedTicket = {
         id: parkedTicketId,
         name: existingParked?.name || activeBarTabName || `Mesa: ${activeTableContext.compactLabel || tableName}`,
         alias: existingParked?.alias,
         items: [...cart],
         total: cartTotal,
         discountAmount,
         discountType: globalDiscount.type,
         discountValue: globalDiscount.value,
         guests: activeTable.guests,
         customerId: selectedCustomer?.id,
         customerName: selectedCustomer?.name,
         customerSnapshot: selectedCustomer ? {
            name: selectedCustomer.name,
            taxId: selectedCustomer.taxId,
            address: selectedCustomer.address,
            phone: selectedCustomer.phone,
            email: selectedCustomer.email,
            isTaxExempt: selectedCustomer.isTaxExempt
         } : undefined,
         timestamp: existingParked?.timestamp || new Date().toISOString(),
         tableId: existingParked?.primaryTableId || activeTable.id,
         primaryTableId: existingParked?.primaryTableId,
         joinedTableIds: existingParked?.joinedTableIds,
         orderNumber: readCartOrderNumber(cart) || existingParked?.orderNumber,
         tableDisplayLabel: activeTableContext.compactLabel || existingParked?.tableDisplayLabel,
         tableRoomLabel: activeTableContext.roomLabel || existingParked?.tableRoomLabel,
         barTabId: existingParked?.barTabId || activeBarTabId || undefined,
         barTabName: existingParked?.barTabName || activeBarTabName || undefined,
         serviceType: effectiveOrderServiceType,
         paymentFraction: retainCurrentPaymentFractionPlan(existingParked?.paymentFraction, cartTotal),
      };

      const updatedTickets = [
         ...(Array.isArray(parkedTickets) ? parkedTickets : []).filter(ticket => ticket.id !== tableOrder.id),
         tableOrder
      ];
      parkedTicketsRef.current = updatedTickets;
      cancelTicketAutoSync();
      try {
         await Promise.resolve(onUpdateParkedTickets(updatedTickets, { reason: 'explicit' }));
      } catch (error) {
         setErrorToast('No se pudo confirmar con la Master. La mesa permanece abierta y pendiente.');
         window.setTimeout(() => setErrorToast(null), 3500);
         throw error;
      }
      await Promise.resolve(onTableOrderSaved?.(activeTable, tableOrder));

      recordCheckoutDiagnostic('CART_CLEAR_REQUEST', { items: cart, tableId: activeTable?.id, orderId: activeTable?.currentOrderId, reason: 'POS_CLEAR_10' });
      onUpdateCart([]);
      onSelectCustomer(null);
      setActiveRecoveredReservation(null);
      if (onClearActiveTable) onClearActiveTable();
   };

   const handleSendAndExit = async () => {
      if (blockRecoveredUberOrderMutation('enviarlo a espera')) return;

      // 1. If table is empty, auto-release to avoid ghost occupied tables.
      const releasedEmptyTable = await releaseActiveEmptyTable();

      // 2. Every table exit is also the production safety net. ORDER_TAKER uses
      // this path for "Guardar pedido", so parking first would synchronize the
      // ticket with Master without ever dispatching its fresh lines to kitchen.
      if (!releasedEmptyTable) {
         if (cart.some(item => !item.dispatched)) {
            const dispatchOutcome = await handleDispatchCommand('table_exit');
            // A successful dispatch already parks the updated ticket and exits.
            // Cancellation keeps the operator in the order so nothing is lost.
            if (dispatchOutcome === 'DISPATCHED' || dispatchOutcome === 'CANCELLED') return;
         }
         await handleParkCurrentTicket();
      } else if (onOpenTableMap) {
         await Promise.resolve(onOpenTableMap());
      }
   };

   const handleBackToMap = async () => {
      const trace = beginPosInteraction('CHANGE_TABLE', { tableId: activeTable?.id || null, cartItems: cart.length });
      expectInteractionRender(trace, 'APP_VIEW');
      if (blockRecoveredUberOrderMutation('volver al mapa de mesas')) return;

      if (shouldBlockTableMapForDirectSale(cart.length, Boolean(activeTable))) {
         setErrorToast('Debes cobrar o cancelar la venta directa antes de ir a Mesas.');
         window.setTimeout(() => setErrorToast(null), 3500);
         markInteractionStage(trace, 'HANDLER_END');
         return;
      }

      setShowParkedList(false);
      closeParkAliasModal();

      if (activeTable) {
         if (cart.length === 0) {
            await releaseActiveEmptyTable({ silent: true });
         } else {
            // Returning to the table map is the waiter safety net: dispatch only
            // fresh lines. The regular Cocina action already marks them dispatched,
            // so this path cannot send the same line twice.
            const requiresBackgroundDispatch = cart.some(item => !item.dispatched);
            await saveActiveTableOrderForMap();
            if (onOpenTableMap) await Promise.resolve(onOpenTableMap());
            markInteractionStage(trace, 'HANDLER_END');
            if (requiresBackgroundDispatch) {
               window.setTimeout(() => {
                  window.requestAnimationFrame(() => {
                     void measureInteractionStage(trace, 'SYNC_START', 'SYNC_END', () =>
                        handleDispatchCommand('table_exit', { backgroundTableExit: true })
                     );
                  });
               }, 0);
            }
            return;
         }
      }

      if (onOpenTableMap) await Promise.resolve(onOpenTableMap());
      markInteractionStage(trace, 'HANDLER_END');
   };

   const handleRestoreTicket = (parked: ParkedTicket) => {
      onUpdateCart(markRestaurantLinesCommitted(parked.items, parked.timestamp));
      setOrderServiceType(parked.serviceType || 'DINE_IN');
      if (parked.customerId) {
         const found = (customers || []).find(c => c.id === parked.customerId);
         if (found) onSelectCustomer(found);
      }
      onUpdateParkedTickets(parkedTickets.filter(p => p.id !== parked.id));
      setActiveRecoveredReservation(null);
      setShowParkedList(false);
      returnToTicketView();
   };

   const handleOpenDrawer = async () => {
      const authorized = await requestApproval({
         permission: 'POS_OPEN_DRAWER',
         actionDescription: 'Abrir Cajón de Dinero',
         context: {
            reason: 'Apertura Manual'
         }
      });
      if (authorized) {
         alert("Cajón Abierto Exitosamente");
         // In a real app, this would trigger the hardware command
      }
   };

   const handleProcessReturn = async (originalTransaction: Transaction, itemsToReturn: { itemId: string, quantity: number }[]) => {
      // 1. Calculate Refund Totals
      const returnItems: CartItem[] = [];

      itemsToReturn.forEach(returnItem => {
         const originalItem = (originalTransaction.items || []).find(i => i.cartId === returnItem.itemId);
         if (originalItem) {
            returnItems.push({
               ...originalItem,
               quantity: Math.abs(returnItem.quantity),
               cartId: `RET-${Date.now()}-${returnItem.itemId}`,
               price: originalItem.price
            });
         }
      });

      const refundSummary = calculateTransactionTaxSummary(
         returnItems,
         config.taxes || [],
         Boolean(originalTransaction.isTaxIncluded),
         config.taxRate || 0
      );
      const refundTotal = refundSummary.total;

      const fiscalCompliance = getEffectiveFiscalComplianceConfig(config, activeTerminalConfig);
      const creditNoteFiscalType = resolveCreditNoteFiscalCode(fiscalCompliance.mode);
      const creditNoteNcf = fiscalCompliance.mode === 'NONE'
         ? undefined
         : await db.getNextNCF(creditNoteFiscalType, terminalId, 50);

      // 2. Create Refund Transaction
      const refundTxn = await transactionService.createTransaction({
         documentType: 'REFUND',
         seriesId: activeTerminalConfig?.documentAssignments?.['REFUND'] || 'REFUND-GENERIC',
         date: new Date().toISOString(),
         items: returnItems,
         total: refundTotal,
         payments: [],
         userId: currentUser.id,
         userName: currentUser.name,
         terminalId: terminalId,
         status: 'REFUNDED',
         customerId: originalTransaction.customerId,
         customerName: originalTransaction.customerName,
         originalTransactionId: originalTransaction.id,
         electronicNcf: creditNoteFiscalType.startsWith('E') ? creditNoteNcf : undefined,
         fiscalMode: fiscalCompliance.mode,
         fiscalProvider: creditNoteFiscalType.startsWith('E') ? getDefaultFiscalProvider(config, activeTerminalConfig) : 'NONE',
         taxAmount: refundSummary.taxAmount,
         netAmount: refundSummary.netAmount,
         affectedNCF: originalTransaction.ncf,
         affectedInvoiceNumber: originalTransaction.displayId || originalTransaction.id,
         ncf: creditNoteNcf,
         ncfType: creditNoteNcf ? creditNoteFiscalType : undefined,
         refundReason: 'Smart QR Return',
         isTaxIncluded: originalTransaction.isTaxIncluded
      });

      const sellableConditions = new Map<string, 'SELLABLE' | 'DAMAGED'>();
      returnItems.forEach(item => sellableConditions.set(item.cartId, 'SELLABLE'));

      await persistStandaloneRefundTransaction(
         {
            ...refundTxn,
            items: returnItems,
            total: refundTotal,
            status: 'REFUNDED',
            refundReason: 'Smart QR Return',
            syncStatus: 'PENDING'
         },
         {
            warehouseId: defaultSalesWarehouseId || 'wh_central',
            terminalId,
            originalTransaction,
            conditions: sellableConditions
         }
      );

      if (!(Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android')) {
         try {
            await fetch(`/api/transactions/${originalTransaction.id}`, {
               method: 'PUT',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ status: 'REFUNDED' })
            });
         } catch (e) {
            console.error("Failed to update original transaction status:", e);
         }
      }

      alert(`Devolución registrada: ${config.currencySymbol}${refundTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\nTicket original (${originalTransaction.displayId}) marcado como REEMBOLSADO.`);
   };

   // --- ACTION GRID HANDLER ---
   const handleGridAction = (action: string) => {
      switch (action) {
         case 'DISCOUNT':
            if (blockRecoveredUberOrderMutation('aplicar descuentos')) return;
            setShowGlobalDiscount(true);
            break;
         case 'COUPON':
            if (blockRecoveredUberOrderMutation('aplicar cupones')) return;
            setShowCouponModal(true);
            break;
         case 'PARK_LIST':
            if (activeTable) {
               setShowParkedList(false);
               break;
            }
            setShowParkedList((prev: any) => !prev);
            break;
         case 'RESERVATION': openReservationModal(); break;
         case 'RECOVER_RESERVATION': openRecoverReservationModal(); break;
         case 'RETURN':
            if (blockRecoveredUberOrderMutation('mezclar devoluciones con este pedido')) return;
            if (!isReturnMode) {
               const hasPermission = (currentUser as any).permissions?.includes('CAN_REFUND') ||
                  ['ADMIN', 'MANAGER'].includes(currentUser.role);
               if (!hasPermission) {
                  setShowSupervisorAuth(true);
                  return;
               }
               setRefundAuthorizedBy({ id: currentUser.id, name: currentUser.name });
            }
            if (isReturnMode) setRefundAuthorizedBy(null);
            setIsReturnMode(!isReturnMode);
            break;
         case 'Z_REPORT':
            if (isOrderTakerMode) return;
            if (!canCloseZReport) {
               alert('No tienes permiso para realizar Cierre Z.');
               return;
            }
            triggerSafetyGate('Cierre Z', onOpenZReport || onOpenFinance);
            break;
         case 'LOGOUT':
            triggerSafetyGate('Cerrar Sesión', onLogout);
            break;
         case 'EXIT_APP':
            if (onExitApplication) {
               onExitApplication();
            } else {
               triggerSafetyGate('Cerrar Sesión', onLogout);
            }
            break;
         case 'SETTINGS': if (onOpenSettings) onOpenSettings(); break;
         case 'ATTENDANCE': onOpenAttendance(); break;
         case 'TRACKING':
            setShowParkedList(false);
            setRightSidebarTab('CART');
            onOpenInventoryTracking();
            break;
         case 'DRAWER': handleOpenDrawer(); break;
         case 'CASH_IN':
            if (!canRegisterCashMovement) {
               alert('No tienes permiso para registrar entradas de efectivo.');
               break;
            }
            setCashMovementModalType('IN');
            setCashMovementAmount('');
            setCashMovementReason('');
            break;
         case 'CASH_OUT':
            if (!canRegisterCashMovement) {
               alert('No tienes permiso para registrar salidas de efectivo.');
               break;
            }
            setCashMovementModalType('OUT');
            setCashMovementAmount('');
            setCashMovementReason('');
            break;
         case 'SAVE': openParkAliasModal(); break;
         case 'TAKEOUT':
            setShowServiceTypeDialog(true);
            break;
         case 'TABLES':
            if (!showTableMapButton) break;
            void handleBackToMap();
            break;
         case 'loyalty_card': setShowLoyaltyModal(true); break;
         case 'AGENDA': if (onOpenAgenda) onOpenAgenda(); break;
      }
   };

   const closeCashMovementModal = () => {
      setCashMovementModalType(null);
      setCashMovementAmount('');
      setCashMovementReason('');
      setIsSavingCashMovement(false);
   };

   const confirmCashMovement = async () => {
      if (!cashMovementModalType || !onRegisterCashMovement) return;
      const amount = Number(cashMovementAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
         alert('Ingresa un monto válido.');
         return;
      }
      setIsSavingCashMovement(true);
      try {
         const movement = await onRegisterCashMovement(cashMovementModalType, amount, cashMovementReason.trim() || 'Movimiento General');
         const movementLabel = cashMovementModalType === 'IN' ? 'Entrada' : 'Salida';
         setSuccessToast(`${movementLabel} de efectivo registrada`);
         closeCashMovementModal();
         if (movement && activeTerminalConfig?.workflow?.session?.autoPrintCashMovementReceipt) {
            void printCashMovementReceipt(movement, config);
         }
      } catch (error: any) {
         alert(`No se pudo registrar el movimiento: ${error?.message || 'Error desconocido'}`);
         setIsSavingCashMovement(false);
      }
   };

   const renderQuickActionsPanel = () => (
      <div className="animate-in fade-in zoom-in-95 duration-200 mt-2">
         <button
            onClick={onOpenHistory}
            className="mb-3 flex w-full items-center justify-between rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-left text-sm font-black text-blue-700 shadow-sm transition-all hover:bg-blue-100"
         >
            <div className="flex items-center gap-3">
               <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/90 text-blue-600 shadow-sm">
                  <History size={18} />
               </div>
               <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-[0.22em] text-blue-400">Acciones</span>
                  <span>Historial de Facturas</span>
               </div>
            </div>
            <ChevronRight size={18} />
         </button>
         <div className="pos-landscape-settings mb-3 hidden space-y-2">
            <p className="text-xs text-gray-500">{currentUser.name} · {terminalDisplayLabel}</p>
            <label className="block text-xs font-bold text-purple-700">
               Tarifa
               <select aria-label="Tarifa activa" value={activeTariffId} disabled={!canChangeTariff} onChange={(event) => setActiveTariffId(event.target.value)} className="mt-1 w-full rounded-xl border border-purple-100 bg-purple-50 px-3 text-sm text-purple-900 disabled:opacity-75">
                  {allowedTariffs.map(tariff => <option key={tariff.id} value={tariff.id}>{tariff.name}</option>)}
               </select>
            </label>
         </div>
         {isRestaurantMode && (
            <div className="pos-landscape-extra-actions mb-3 hidden grid-cols-2 gap-2">
               <button type="button" onClick={handlePrintPrecuenta} disabled={cart.length === 0} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orange-500 px-2 text-xs font-black text-white disabled:opacity-40">
                  <Printer size={16} /><span>Sub-total</span>
               </button>
               {canCloseXReport && (
                  <button type="button" onClick={() => onOpenFinance('X_REPORT')} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-2 text-xs font-black text-white">
                     <ClipboardCheck size={16} /><span>Cierre X</span>
                  </button>
               )}
            </div>
         )}
         <ActionGrid
            orientation="vertical"
            onAction={(action) => {
               handleGridAction(action);
            }}
            config={config}
            parkedTicketsCount={parkedTickets.length}
            isReturnMode={isReturnMode}
            hasCartItems={cart.length > 0}
            globalDiscountValue={globalDiscount.value}
            showLogout={false}
            allowWaitList={!activeTable}
            hideFinancialClosings={isOrderTakerMode}
         />
      </div>
   );

   return (
      <div
         ref={posRootRef}
         data-pos-scanner-enabled={!isAnyModalOpen ? 'true' : 'false'}
         className={`clic-pos-device-shell fixed inset-0 w-full overflow-hidden bg-gray-50 flex font-sans select-none text-gray-900 ${isTabletProfile ? 'clic-pos-tablet-shell' : ''}`}
         data-pos-layout={isRetailMode ? 'retail' : isRestaurantMode ? 'restaurant' : 'catalog'}
         data-device-form-factor={activeDeviceProfile.formFactor}
         data-device-orientation={activeDeviceProfile.orientation}
         data-touch-optimized={activeDeviceProfile.touchOptimized ? 'true' : 'false'}
         style={{
            ...posShellStyle,
            '--clic-touch-target-size': `${Math.max(
               Number(activeTerminalConfig?.deviceRole?.uiSettings?.touchTargetSize || 0),
               activeDeviceProfile.touchOptimized ? (isTabletProfile ? 52 : 48) : 44,
            )}px`,
         } as React.CSSProperties}
      >
         <SupervisorAuthModal
            isOpen={showSupervisorAuth}
            onClose={() => setShowSupervisorAuth(false)}
            users={users}
            requiredPermission="CAN_REFUND"
            onSuccess={(supervisor) => {
               console.log("Authorized by:", supervisor.name);
               setRefundAuthorizedBy({ id: supervisor.id, name: supervisor.name });
               setIsReturnMode(true);
            }}
         />
         {productionRoutingPrompt && (
            <ProductionRoutingAssignmentModal
               items={productionRoutingPrompt.items}
               areas={productionRoutingPrompt.areas}
               onAssign={(assignments) => resolveProductionRoutingPrompt({ kind: 'ASSIGN', assignments })}
               onSkip={() => resolveProductionRoutingPrompt({ kind: 'SKIP' })}
               onCancel={() => resolveProductionRoutingPrompt({ kind: 'CANCEL' })}
            />
         )}

         {errorToast && (
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300">
               <div className="bg-red-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-bold border-2 border-red-400">
                  <AlertTriangle size={24} className="animate-pulse" />
                  <span>{errorToast}</span>
               </div>
            </div>
         )}

         {cashMovementModalType && (
            <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/50 px-4 pb-8 pt-[7vh] backdrop-blur-sm sm:items-center sm:pt-4">
               <div className="w-full max-w-lg rounded-[2rem] bg-white p-6 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-6 duration-300">
                  <div className="mb-5 flex items-center justify-between">
                     <div>
                        <p className={`text-[10px] font-black uppercase tracking-[0.22em] ${cashMovementModalType === 'IN' ? 'text-emerald-500' : 'text-red-500'}`}>
                           Caja y efectivo
                        </p>
                        <h2 className="text-2xl font-black text-slate-900">
                           {cashMovementModalType === 'IN' ? 'Entrada de efectivo' : 'Salida de efectivo'}
                        </h2>
                     </div>
                     <button type="button" onClick={closeCashMovementModal} className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200">
                        <X size={20} />
                     </button>
                  </div>

                  <label className="mb-4 block">
                     <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Monto</span>
                     <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <span className="mr-2 text-xl font-black text-slate-400">{config.currencySymbol}</span>
                        <input
                           type="text"
                           readOnly
                           inputMode="none"
                           data-disable-native-soft-keyboard="true"
                           tabIndex={-1}
                           value={cashMovementAmount}
                           className="w-full bg-transparent text-4xl font-black text-slate-900 outline-none"
                           placeholder="0.00"
                           aria-label="Monto del movimiento"
                        />
                     </div>
                  </label>

                  <div className="mb-4 rounded-2xl bg-slate-50 p-3">
                     <NumericKeypad
                        value={cashMovementAmount}
                        onChange={setCashMovementAmount}
                        allowDecimal
                        maxDecimalPlaces={2}
                        disabled={isSavingCashMovement}
                     />
                     <button
                        type="button"
                        onClick={() => setCashMovementAmount('')}
                        disabled={isSavingCashMovement || cashMovementAmount.length === 0}
                        className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white text-xs font-black uppercase tracking-wider text-slate-500 active:bg-red-50 disabled:opacity-30"
                     >
                        Limpiar monto
                     </button>
                  </div>

                  <div className="mb-5 flex flex-wrap gap-2">
                     {(cashMovementModalType === 'IN'
                        ? ['Fondo inicial', 'Cambio', 'Aporte caja', 'Otro ingreso']
                        : ['Gasto', 'Pago proveedor', 'Retiro', 'Otro egreso']
                     ).map((reason) => (
                        <button
                           key={reason}
                           type="button"
                           onClick={() => setCashMovementReason(reason)}
                           className={`rounded-full border px-3 py-2 text-xs font-black transition-all ${cashMovementReason === reason
                              ? cashMovementModalType === 'IN'
                                 ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                 : 'border-red-500 bg-red-50 text-red-700'
                              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                              }`}
                        >
                           {reason}
                        </button>
                     ))}
                  </div>

                  <label className="mb-6 block">
                     <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Razón / nota</span>
                     <input
                        type="text"
                        value={cashMovementReason}
                        onChange={(event) => setCashMovementReason(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-400"
                        placeholder="Ej: compra de hielo, cambio inicial..."
                     />
                  </label>

                  <button
                     type="button"
                     disabled={isSavingCashMovement}
                     onClick={confirmCashMovement}
                     className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-lg font-black text-white shadow-lg transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${cashMovementModalType === 'IN' ? 'bg-emerald-600 shadow-emerald-100 hover:bg-emerald-700' : 'bg-red-600 shadow-red-100 hover:bg-red-700'}`}
                  >
                     {cashMovementModalType === 'IN' ? <Plus size={22} /> : <Minus size={22} />}
                     {isSavingCashMovement ? 'Guardando...' : `Confirmar ${cashMovementModalType === 'IN' ? 'entrada' : 'salida'}`}
                  </button>
               </div>
            </div>
         )}

         {showServiceTypeDialog && <OrderServiceTypeDialog
            value={effectiveOrderServiceType}
            locked={isRecoveredUberOrder}
            onClose={() => setShowServiceTypeDialog(false)}
            onSelect={serviceType => {
               if (isRecoveredUberOrder) return;
               setOrderServiceType(serviceType);
               setShowServiceTypeDialog(false);
               setRightSidebarTab('CART');
               setSuccessToast(`Ticket: ${serviceType === 'DINE_IN' ? 'En local' : serviceType === 'TAKEOUT' ? 'Para llevar' : 'Delivery'} · Política fiscal aplicada`);
            }}
         />}
         <MobileConfigModal
            isOpen={showMobileConfigModal}
            onClose={() => {
               setShowMobileConfigModal(false);
               setPendingProductToAdd(null);
            }}
            onSave={(mobileConfig) => {
               // Update global config with selected warehouse/tariff
               const newConfig = { ...config };
               const terminalIndex = newConfig.terminals.findIndex(t => t.id === activeTerminalId);

               if (terminalIndex >= 0) {
                  // Update Warehouse
                  if (!newConfig.terminals[terminalIndex].config.inventoryScope) {
                     newConfig.terminals[terminalIndex].config.inventoryScope = {
                        defaultSalesWarehouseId: mobileConfig.warehouseId,
                        visibleWarehouseIds: [mobileConfig.warehouseId]
                     };
                  } else {
                     newConfig.terminals[terminalIndex].config.inventoryScope!.defaultSalesWarehouseId = mobileConfig.warehouseId;
                  }

                  // Update Tariff
                  if (!newConfig.terminals[terminalIndex].config.pricing) {
                     newConfig.terminals[terminalIndex].config.pricing = {
                        allowedTariffIds: [mobileConfig.tariffId],
                        defaultTariffId: mobileConfig.tariffId
                     };
                  } else {
                     newConfig.terminals[terminalIndex].config.pricing.defaultTariffId = mobileConfig.tariffId;
                  }

                  // Update Document Series
                  if (!newConfig.terminals[terminalIndex].config.documentAssignments) {
                     newConfig.terminals[terminalIndex].config.documentAssignments = {};
                  }
                  newConfig.terminals[terminalIndex].config.documentAssignments!['TICKET'] = mobileConfig.seriesId;
                  newConfig.terminals[terminalIndex].config.documentAssignments!['REFUND'] =
                     newConfig.terminals[terminalIndex].config.documentAssignments!['REFUND'] || 'REFUND';
                  newConfig.terminals[terminalIndex].config.documentAssignments!['TRANSFER'] =
                     newConfig.terminals[terminalIndex].config.documentAssignments!['TRANSFER'] || 'TRANSFER';

                  onUpdateConfig(newConfig);
                  setActiveTariffId(mobileConfig.tariffId);
                  setCategoryFilter(mobileConfig.categoryId === 'ALL' ? 'ALL' : canonicalizeCategory(mobileConfig.categoryId));
               }

               // Proceed to add product
               if (pendingProductToAdd) {
                  // Small delay to allow config update to propagate
                  setTimeout(() => {
                     // Re-check add to cart logic with new config
                     const pendingName = pendingProductToAdd.name || '';
                     const isWeighted = pendingProductToAdd.type === 'SERVICE' || pendingName.toLowerCase().includes('(peso)');
                     const hasVariants = pendingProductToAdd.attributes && pendingProductToAdd.attributes.length > 0;

                     if (isWeighted) setProductForScale(pendingProductToAdd);
                     else if (hasVariants) setSelectedProductForVariants(pendingProductToAdd);
                     else addToCart(pendingProductToAdd);

                     setPendingProductToAdd(null);
                  }, 100);
               }
               setShowMobileConfigModal(false);
            }}
            config={config}
            warehouses={warehouses}
            terminalId={activeTerminalId}
            currentWarehouseId={defaultSalesWarehouseId}
            currentTariffId={activeTariffId}
            currentCategory={categoryFilter}
         />

         <ReturnModal
            isOpen={showReturnModal}
            onClose={() => setShowReturnModal(false)}
            invoiceId={returnInvoiceId}
            transactions={transactions}
            onProcessReturn={handleProcessReturn}
            config={config}
         />

         {isMobile && mobileView === 'PRODUCTS' && (
            <MobileCartButton
               buttonRef={mobileCartButtonRef}
               itemCount={cart.length}
               onClick={() => {
                  setRightSidebarTab('CART');
                  setMobileView('TICKET');
               }}
               style={mobileCartButtonStyle}
            />
         )}

         {/* LEFT AREA: PRODUCTS */}
         <div className={`flex-1 min-h-0 flex flex-col min-w-0 bg-gray-50 transition-all duration-300 ${isMobile && mobileView === 'TICKET' ? 'hidden' : 'flex'} ${isRetailMode ? '!hidden' : ''}`}>
            <header data-search-open={compactSearchOpen || Boolean(searchTerm) ? 'true' : 'false'} className="pos-catalog-header bg-white px-3 md:px-8 py-2 md:py-4 border-b border-gray-200 flex flex-wrap items-center gap-1.5 md:gap-6 shadow-sm z-10 shrink-0">
               <div className="pos-catalog-identity flex items-center gap-3 pr-0 md:pr-4 border-r-0 md:border-r border-gray-100 shrink-0">
                  <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-gray-50 overflow-hidden border border-gray-200 shadow-inner shrink-0">
                     {currentUser.photo ? <img src={currentUser.photo} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-blue-50 text-blue-600 font-bold">{currentUser.name.charAt(0)}</div>}
                  </div>
                  <div className="flex flex-col leading-tight md:hidden min-w-0">
                     <p className="text-[11px] font-black text-slate-800 truncate max-w-[96px]">{currentUser.name.split(' ')[0]}</p>
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.24em] mt-1">Cajero</p>
                     <p className="text-[0.66rem] font-extrabold text-red-500 uppercase tracking-[0.16em] mt-1 truncate max-w-[96px]">{terminalDisplayLabel}</p>
                  </div>
                  <div className="hidden lg:block leading-tight">
                     <p className="text-sm font-black text-gray-800 truncate max-w-[120px]">{currentUser.name}</p>
                     <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Cajero</p>
                     <p className="text-[0.84rem] font-extrabold text-red-500 uppercase tracking-[0.16em] mt-1 truncate max-w-[140px]">{terminalDisplayLabel}</p>
                  </div>
               </div>

               <div className="pos-catalog-sync flex h-9 md:h-auto items-center gap-2 px-2.5 md:px-4 py-1.5 md:py-2 rounded-xl md:rounded-2xl bg-gray-50 border border-gray-100 shadow-inner shrink-0">
                  {syncState.isSyncing ? (
                     <RefreshCw size={18} className="text-amber-500 animate-spin" />
                  ) : !navigator.onLine ? (
                     <CloudOff size={18} className="text-red-500" />
                  ) : (
                     <Cloud size={18} className={syncState.hasError || syncState.pendingCount > 0 || syncState.blockedCount > 0 ? 'text-amber-500' : 'text-emerald-500'} />
                  )}
                  <div className="flex flex-col leading-none">
                     <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest hidden md:block">Sincronización</span>
                     <span className={`text-[10px] font-bold ${
                        syncState.isSyncing
                           ? 'text-amber-600'
                           : !navigator.onLine
                              ? 'text-red-600'
                              : syncState.hasError || syncState.pendingCount > 0 || syncState.blockedCount > 0
                                 ? 'text-amber-600'
                                 : 'text-emerald-600'
                     }`}>
                        {syncState.isSyncing
                           ? 'Sincronizando'
                           : !navigator.onLine
                              ? 'Offline'
                              : syncState.blockedCount > 0
                                 ? `Bloqueado · ${syncState.blockedCount}`
                                 : syncState.pendingCount > 0
                                 ? `Online · ${syncState.pendingCount}`
                                 : 'Online'}
                     </span>
                  </div>
               </div>


               <div className="w-full md:flex-1 flex flex-nowrap items-center gap-2 md:gap-3 md:min-w-0">
                  <div className="pos-catalog-tariff relative shrink-0 ml-auto order-2 md:order-3" ref={tariffSelectorRef}>
                     <button
                        type="button"
                        onClick={() => {
                           if (!canChangeTariff) return;
                           setShowTariffSelector(!showTariffSelector);
                        }}
                        className={`flex h-11 md:h-12 items-center justify-between gap-2 md:gap-3 min-w-[138px] md:min-w-[180px] px-3 md:px-4 rounded-xl md:rounded-2xl border-2 transition-all ${showTariffSelector ? 'border-purple-500 bg-purple-50' : 'bg-purple-50/80 border-purple-100'} ${canChangeTariff ? 'hover:border-purple-300' : 'opacity-75 cursor-not-allowed'}`}
                        disabled={!canChangeTariff}
                        title={canChangeTariff ? 'Cambiar tarifa activa' : 'Tu rol no tiene permiso para cambiar la tarifa'}
                     >
                        <Tag size={18} className="text-purple-600 shrink-0" />
                        <div className="text-left min-w-0">
                           <p className="text-[8px] md:text-[9px] font-black text-purple-400 uppercase tracking-[0.22em] leading-none mb-1">Tarifa</p>
                           <p className="text-[11px] md:text-xs font-bold text-purple-900 leading-none truncate max-w-[86px] sm:max-w-[110px] md:max-w-[120px]">{activeTariff?.name || 'General'}</p>
                        </div>
                        {canChangeTariff ? (
                           <ChevronDown size={14} className={`text-purple-400 transition-transform shrink-0 ${showTariffSelector ? 'rotate-180' : ''}`} />
                        ) : (
                           <Lock size={14} className="text-purple-300 shrink-0" />
                        )}
                     </button>
                     {canChangeTariff && showTariffSelector && (
                        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 min-w-[220px] max-w-[min(88vw,280px)] rounded-2xl border border-purple-100 bg-white p-2 shadow-xl">
                           <div className="px-3 py-2">
                              <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Seleccionar tarifa</p>
                           </div>
                           <div className="space-y-1">
                              {allowedTariffs.map((tariff) => {
                                 const isSelected = tariff.id === activeTariffId;
                                 return (
                                    <button
                                       key={tariff.id}
                                       type="button"
                                       onClick={() => {
                                          setActiveTariffId(tariff.id);
                                          setShowTariffSelector(false);
                                       }}
                                       className={`w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-all ${isSelected ? 'bg-purple-50 text-purple-900 border border-purple-200' : 'bg-white text-gray-700 hover:bg-gray-50 border border-transparent'}`}
                                    >
                                       <div className="min-w-0">
                                          <p className="text-sm font-bold truncate">{tariff.name}</p>
                                          <p className="text-[10px] font-medium text-gray-400 uppercase tracking-widest">
                                             {tariff.taxIncluded ? 'Impuestos incluidos' : 'Impuestos separados'}
                                          </p>
                                       </div>
                                       {isSelected && <Check size={16} className="text-purple-600 shrink-0" />}
                                    </button>
                                 );
                              })}
                           </div>
                        </div>
                     )}
                  </div>

                  <div className="relative order-1 md:order-2 flex-1 group min-w-[140px] md:min-w-[220px] max-w-[620px]">
                     <Search className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                     <input
                        ref={searchInputRef}
                        data-barcode-scanner-target="true"
                        type="text"
                        inputMode="search"
                        enterKeyHint="search"
                        autoComplete="off"
                        placeholder="Buscar..."
                        value={searchTerm}
                        onChange={(e) => handleCatalogSearchInput(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        className="w-full h-11 md:h-12 pl-10 md:pl-12 pr-10 md:pr-12 py-0 bg-gray-100 rounded-xl md:rounded-2xl border-none outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                     />
                     <button
                        type="button"
                        onClick={useDesktopSearchClearAction ? clearCatalogSearch : () => setIsScannerOpen(true)}
                        disabled={useDesktopSearchClearAction && searchTerm.length === 0}
                        aria-label={useDesktopSearchClearAction ? 'Limpiar búsqueda' : 'Escanear con cámara'}
                        title={useDesktopSearchClearAction ? 'Limpiar búsqueda' : 'Escanear con cámara'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 bg-white shadow-sm rounded-lg md:rounded-xl hover:text-blue-600 hover:bg-blue-50 border border-gray-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-gray-500"
                     >
                        {useDesktopSearchClearAction ? <BrushCleaning size={18} /> : <ScanBarcode size={18} />}
                     </button>
                  </div>

                  {canReceiveConsignments && (
                     <button
                        type="button"
                        onClick={() => {
                           setShowConsignmentModal(true);
                           setConsignmentError(null);
                        }}
                        className="order-3 md:order-4 inline-flex h-11 w-11 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-xl md:rounded-2xl border border-cyan-100 bg-cyan-50 text-cyan-700 shadow-sm transition-all hover:border-cyan-200 hover:bg-cyan-100"
                        title="Buscar consignaciones ERP"
                     >
                        <Package size={19} />
                     </button>
                  )}




                  <button type="button" aria-label="Cerrar búsqueda" onClick={() => { setSearchTerm(''); setCompactSearchOpen(false); }} className="pos-landscape-search-close hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600 order-last">
                     <X size={20} />
                  </button>

                  {/* MOBILE SETTINGS BUTTON */}
                  <button onClick={() => onOpenSettings()} className="md:hidden order-4 h-11 w-11 bg-gray-100 rounded-xl text-gray-600 hover:bg-gray-200 shrink-0 flex items-center justify-center">
                     <Settings size={20} />
                  </button>
               </div>
            </header>

            {isMobile && !isKioskMode && (
               <MobilePosNavigation
                  onOpenTables={showTableMapButton && onOpenTableMap ? () => { void handleBackToMap(); } : undefined}
                  onOpenActions={() => {
                     setRightSidebarTab('ACTIONS');
                     setMobileView('TICKET');
                  }}
               />
            )}

            {/* --- CATEGORY SELECTOR BAR --- */}
            <div className={categoryContainerClass}>
               {categoryOptions.map((categoryOption, idx) => {
                  const selectedCategoryKey = categoryFilter === 'ALL' ? 'ALL' : canonicalizeCategory(categoryFilter);
                  const isActiveCategory = selectedCategoryKey === categoryOption.id;
                  const configuredColor = categoryOption.color;
                  const categoryTone = [
                     { idle: 'bg-indigo-100 border-indigo-200 text-indigo-800 hover:bg-indigo-200', active: 'bg-indigo-600 border-indigo-600 text-white shadow-indigo-200' },
                     { idle: 'bg-emerald-100 border-emerald-200 text-emerald-800 hover:bg-emerald-200', active: 'bg-emerald-600 border-emerald-600 text-white shadow-emerald-200' },
                     { idle: 'bg-rose-100 border-rose-200 text-rose-800 hover:bg-rose-200', active: 'bg-rose-600 border-rose-600 text-white shadow-rose-200' },
                     { idle: 'bg-orange-100 border-orange-200 text-orange-800 hover:bg-orange-200', active: 'bg-orange-600 border-orange-600 text-white shadow-orange-200' },
                     { idle: 'bg-sky-100 border-sky-200 text-sky-800 hover:bg-sky-200', active: 'bg-sky-600 border-sky-600 text-white shadow-sky-200' },
                     { idle: 'bg-amber-100 border-amber-200 text-amber-900 hover:bg-amber-200', active: 'bg-amber-500 border-amber-500 text-slate-950 shadow-amber-200' },
                  ][idx % 6];
                  const configuredStyle = configuredColor ? {
                     backgroundColor: isActiveCategory ? configuredColor : `${configuredColor}1F`,
                     borderColor: configuredColor,
                     color: isActiveCategory ? readableTextColor(configuredColor) : configuredColor,
                  } : undefined;
                  const categoryGridPosition = resolvePosCategoryGridPosition(idx);
                  return (
                  <button
                     key={categoryOption.id || `cat-${idx}`}
                     onClick={() => setCategoryFilter(categoryOption.id)}
                     style={{ ...configuredStyle, ...categoryGridPosition }}
                     className={`h-[42px] md:h-[48px] w-full min-w-0 px-2 md:px-3 rounded-xl text-[11px] md:text-[12px] leading-tight font-black uppercase tracking-[0.08em] transition-all whitespace-normal text-center border shadow-sm active:scale-95 ${isActiveCategory
                        ? `${configuredColor ? '' : categoryTone.active} shadow-lg -translate-y-0.5`
                        : `${configuredColor ? '' : categoryTone.idle} hover:-translate-y-0.5 hover:shadow-md`
                        }`}
                  >
                     <span className="line-clamp-2">{categoryOption.label}</span>
                  </button>
                  );
               })}
            </div>

            <div
               className={`flex-1 min-h-0 bg-[#eef2f6] ${usesExpandedCatalog ? 'relative overflow-hidden' : `overflow-y-auto ${isMobile ? 'p-3' : 'p-8'}`} custom-scrollbar scrollbar-thin dark:bg-slate-900`}
               style={bottomAwareScrollStyle}
            >
               <div className={gridClass} style={expandedCatalogGridStyle}>
                  {filteredProducts.map((product, idx) => (
                     <ProductGridCard
                        key={product.id || `prod-${idx}`}
                        product={product}
                        usesSupermarketLayout={usesSupermarketLayout}
                        usesExpandedCatalog={usesExpandedCatalog}
                        isMobile={isMobile}
                        showProductImages={uxConfig.showProductImages}
                        baseCurrencySymbol={baseCurrency.symbol}
                        isProductWarehouseBlockedForSale={isProductWarehouseBlockedForSale}
                        getTerminalWarehouseName={getTerminalWarehouseName}
                        getProductPrice={getProductPrice}
                        isProductOutOfStock={isProductOutOfStock}
                        hasPromotionForProduct={hasPromotionForProduct}
                        onProductClick={handleProductCardClick}
                        onOpenPromotion={openProductPromotionSheet}
                        onProductTouchStart={handleProductCardTouchStart}
                        onProductTouchMove={handleProductCardTouchMove}
                        onProductTouchEnd={clearQuickActionTouchTimer}
                        onProductContextMenu={handleProductCardContextMenu}
                     />
                  ))}
               </div>
            </div>
            {/* VIRTUAL KEYBOARD SLOT */}
            {showVirtualKeyboard && (
               <div className="flex-none z-50">
                  <VirtualKeyboard
                     onKeyPress={(key) => handleCatalogSearchInput(searchTerm + key)}
                     onDelete={() => handleCatalogSearchInput(searchTerm.slice(0, -1))}
                     onClear={() => handleCatalogSearchInput('')}
                     onClose={() => {
                        setShowVirtualKeyboard(false);
                        // Optional: trigger search enter logic if needed
                     }}
                  />
               </div>
            )}

            {!isMobile && isRestaurantMode && (
               <div
                  ref={desktopActionGridRef}
                  className="pos-restaurant-actions flex-none border-t border-slate-200 bg-white px-3 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.06)]"
               >
                  <nav aria-label="Acciones de tablet horizontal" className="pos-landscape-actions hidden gap-2">
                     <button type="button" aria-label="Buscar artículos" aria-expanded={compactSearchOpen || Boolean(searchTerm)} onClick={() => { setCompactSearchOpen(true); requestAnimationFrame(() => searchInputRef.current?.focus()); }} className="flex min-h-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                        <Search size={20} />
                     </button>
                     <button type="button" onClick={() => { void handleBackToMap(); }} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orange-500 px-2 text-xs font-black text-white">
                        <Layout size={18} /><span>Mesas</span>
                     </button>
                     <button type="button" onClick={() => handleGridAction('SAVE')} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-2 text-xs font-black text-white">
                        <Save size={18} /><span>Guardar</span>
                     </button>
                     <button type="button" onClick={() => { void handleDispatchCommand(); }} disabled={cart.length === 0} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-orange-500 px-2 text-xs font-black text-white disabled:opacity-40">
                        <ChefHat size={18} /><span>Cocina</span>
                     </button>
                     <button type="button" aria-pressed={rightSidebarTab === 'ACTIONS'} onClick={() => setRightSidebarTab(tab => tab === 'ACTIONS' ? 'CART' : 'ACTIONS')} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-800 px-2 text-xs font-black text-white">
                        <span role="status" aria-label={!navigator.onLine ? 'Sin conexión' : syncState.isSyncing ? 'Sincronizando' : syncState.hasError || syncState.pendingCount > 0 || syncState.blockedCount > 0 ? 'Sincronización pendiente' : 'Online'} className={`h-2 w-2 shrink-0 rounded-full ${!navigator.onLine ? 'bg-red-400' : syncState.isSyncing || syncState.hasError || syncState.pendingCount > 0 || syncState.blockedCount > 0 ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                        <span>{rightSidebarTab === 'ACTIONS' ? 'Ver pedido' : 'Opciones'}</span>
                     </button>
                  </nav>
                  <div className="pos-full-action-grid mx-auto grid max-w-[1180px] grid-cols-3 gap-3">
                     <div role="group" aria-label="Venta" className="rounded-2xl border border-blue-200 bg-blue-50/50 p-2 shadow-sm">
                        <div className="grid grid-cols-2 gap-2">
                        <button
                           type="button"
                           onClick={() => handleGridAction('DISCOUNT')}
                           className={`flex h-16 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-black uppercase tracking-wide shadow-sm transition-all active:scale-95 ${globalDiscount.value > 0 ? 'border-rose-500 bg-rose-600 text-white shadow-rose-600/25 hover:bg-rose-700' : 'border-blue-500 bg-blue-600 text-white shadow-blue-600/25 hover:bg-blue-700'}`}
                        >
                           <Percent size={20} />
                           <span>Desc %</span>
                        </button>
                        <button
                           type="button"
                           onClick={() => handleGridAction('COUPON')}
                           className="flex h-16 items-center justify-center gap-2 rounded-xl border border-blue-500 bg-blue-600 px-3 text-sm font-black uppercase tracking-wide text-white shadow-sm shadow-blue-600/25 transition-all hover:bg-blue-700 active:scale-95"
                        >
                           <Tag size={20} />
                           <span>Cupones</span>
                        </button>
                        <button
                           type="button"
                           onClick={() => handleGridAction('loyalty_card')}
                           className="flex h-16 items-center justify-center gap-2 rounded-xl border border-blue-500 bg-blue-600 px-3 text-sm font-black uppercase tracking-wide text-white shadow-sm shadow-blue-600/25 transition-all hover:bg-blue-700 active:scale-95"
                        >
                           <CreditCard size={20} />
                           <span>Tarjeta</span>
                        </button>
                        <button
                           type="button"
                           onClick={() => handleGridAction('SAVE')}
                           className="flex h-16 items-center justify-center gap-2 rounded-xl border border-orange-400 bg-orange-500 px-3 text-sm font-black uppercase tracking-wide text-white shadow-sm shadow-orange-500/25 transition-all hover:bg-orange-600 active:scale-95"
                        >
                           <Save size={20} />
                           <span>Guardar</span>
                        </button>
                        </div>
                     </div>

                     <div role="group" aria-label="Comanda" className="rounded-2xl border border-orange-200 bg-orange-50/60 p-2 shadow-sm">
                        <div className="grid grid-cols-2 gap-2">
                        <button
                           type="button"
                           onClick={() => { void handleBackToMap(); }}
                           className="flex h-16 items-center justify-center gap-2 rounded-xl border border-orange-400 bg-orange-500 px-3 text-sm font-black uppercase tracking-wide text-white shadow-sm shadow-orange-500/25 transition-all hover:bg-orange-600 active:scale-95"
                        >
                           <Layout size={20} />
                           <span>Mesas</span>
                        </button>
                        <button
                           type="button"
                           onClick={handlePrintPrecuenta}
                           disabled={cart.length === 0}
                           className="flex h-16 items-center justify-center gap-2 rounded-xl border border-orange-400 bg-orange-500 px-3 text-sm font-black uppercase tracking-wide text-white shadow-sm shadow-orange-500/25 transition-all hover:bg-orange-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                           <Printer size={20} />
                           <span>Sub-total</span>
                        </button>
                        <button
                           type="button"
                           onClick={() => { void handleDispatchCommand(); }}
                           disabled={cart.length === 0}
                           className="flex h-16 items-center justify-center gap-2 rounded-xl border border-orange-400 bg-orange-500 px-3 text-sm font-black uppercase tracking-wide text-white shadow-sm shadow-orange-500/25 transition-all hover:bg-orange-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                           <ChefHat size={20} />
                           <span>Cocina</span>
                        </button>
                        <button
                           type="button"
                           onClick={onOpenHistory}
                           className="flex h-16 items-center justify-center gap-2 rounded-xl border border-orange-400 bg-orange-500 px-3 text-sm font-black uppercase tracking-wide text-white shadow-sm shadow-orange-500/25 transition-all hover:bg-orange-600 active:scale-95"
                        >
                           <History size={20} />
                           <span>Tickets</span>
                        </button>
                        </div>
                     </div>

                     <div role="group" aria-label="Caja" className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-2 shadow-sm">
                        <div className="grid grid-cols-2 gap-2">
                        <button
                           type="button"
                           onClick={() => handleGridAction('DRAWER')}
                           className="flex h-16 items-center justify-center gap-2 rounded-xl border border-emerald-500 bg-emerald-600 px-3 text-sm font-black uppercase tracking-wide text-white shadow-sm shadow-emerald-600/25 transition-all hover:bg-emerald-700 active:scale-95"
                        >
                           <Box size={20} />
                           <span>Cajón</span>
                        </button>
                        {canCloseZReport && (
                           <button
                              type="button"
                              onClick={() => handleGridAction('Z_REPORT')}
                              className="flex h-16 items-center justify-center gap-2 rounded-xl border border-red-500 bg-red-600 px-3 text-sm font-black uppercase tracking-wide text-white shadow-sm shadow-red-600/25 transition-all hover:bg-red-700 active:scale-95"
                           >
                              <Lock size={20} />
                              <span>Cierre Z</span>
                           </button>
                        )}
                        <button
                           type="button"
                           onClick={() => onOpenSettings()}
                           className="flex h-16 items-center justify-center gap-2 rounded-xl border border-emerald-500 bg-emerald-600 px-3 text-sm font-black uppercase tracking-wide text-white shadow-sm shadow-emerald-600/25 transition-all hover:bg-emerald-700 active:scale-95"
                        >
                           <Settings size={20} />
                           <span>Ajustes</span>
                        </button>
                        {canCloseXReport && <button
                           type="button"
                           onClick={() => {
                              onOpenFinance('X_REPORT');
                           }}
                           className="flex h-16 items-center justify-center gap-2 rounded-xl border border-emerald-500 bg-emerald-600 px-3 text-sm font-black uppercase tracking-wide text-white shadow-sm shadow-emerald-600/25 transition-all hover:bg-emerald-700 active:scale-95"
                        >
                           <ClipboardCheck size={20} />
                           <span>Cierre X</span>
                        </button>}
                        </div>
                     </div>
                  </div>
               </div>
            )}
         </div >

         {/* RIGHT SIDEBAR: CURRENT TICKET */}
         <div className={`pos-ticket-sidebar ${!isMobile && !isRetailMode ? 'w-96 shrink-0' : 'w-full'} h-full min-h-0 bg-white border-l border-gray-200 shadow-2xl flex flex-col z-20 transition-all duration-300 ${isMobile && mobileView === 'PRODUCTS' && !isRetailMode ? 'hidden' : 'flex'}`}>

            {/* MOBILE HEADER */}
            < div className={`${isMobile ? 'flex' : 'hidden'} px-4 py-3 border-b border-gray-100 bg-white flex-col gap-3 shrink-0`} >
               <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                     {renderTicketBrand(true)}
                     <button onClick={() => setMobileView('PRODUCTS')} className="h-10 w-10 -ml-2 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors flex items-center justify-center">
                        <ArrowLeft size={24} />
                     </button>
                     <h2 className="min-w-0 max-w-[180px] truncate font-black text-gray-800 text-base leading-tight">
                        {activeTable ? (
                           <span title={activeTableContext.compactLabel || activeTableHeaderLabel}>
                              {activeBarTabName || activeTableHeaderLabel || activeTable.nombre || activeTable.name}
                           </span>
                        ) : 'Ticket Actual'}
                     </h2>
                  </div>
                  <div className="flex gap-1">
                     {cart.length > 0 && (
                        <button
                           onClick={handleClearFreshCartItems}
                           disabled={!hasClearableFreshItems}
                           className="h-10 w-10 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:hover:text-red-600 flex items-center justify-center"
                           title={hasClearableFreshItems ? 'Borrar artículos nuevos' : 'No hay artículos nuevos para borrar'}
                        >
                           <Trash2 size={20} />
                        </button>
                     )}
                     <button onClick={openParkAliasModal} className="h-10 w-10 rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-600/25 hover:bg-blue-700 flex items-center justify-center" title="Guardar Ticket">
                        <Save size={20} />
                     </button>
                     {!activeTable && (
                        <button onClick={() => setShowParkedList(!showParkedList)} className="h-10 w-10 rounded-xl bg-orange-500 text-white shadow-sm shadow-orange-500/25 hover:bg-orange-600 relative flex items-center justify-center" title="Recuperar Ticket">
                           <Inbox size={20} />
                           {(Array.isArray(parkedTickets) ? parkedTickets : []).length > 0 && (
                              <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-orange-500 rounded-full border-2 border-white"></span>
                           )}
                        </button>
                     )}
                     <div className="relative group">
                        <button className="h-10 w-10 rounded-xl bg-emerald-600 text-white shadow-sm shadow-emerald-600/25 hover:bg-emerald-700 flex items-center justify-center"><MoreVertical size={20} /></button>
                        <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 hidden group-hover:block z-50">
                           <button onClick={onOpenHistory} className="w-full px-4 py-3 text-left text-sm font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-2"><History size={16} /> Historial</button>
                           {canCloseXReport && <button onClick={() => onOpenFinance('X_REPORT')} className="w-full px-4 py-3 text-left text-sm font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-2"><ClipboardCheck size={16} /> Cierre X</button>}
                           {canCloseZReport && <button onClick={onOpenZReport || (() => onOpenFinance())} className="w-full px-4 py-3 text-left text-sm font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-2"><Lock size={16} /> Cierre Z</button>}
                           <button onClick={() => onOpenSettings()} className="w-full px-4 py-3 text-left text-sm font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-2"><Settings size={16} /> Ajustes</button>
                           <button onClick={onLogout} className="w-full px-4 py-3 text-left text-sm font-bold text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-gray-50"><LogOut size={16} /> Salir</button>
                        </div>
                     </div>
                  </div>
               </div>

               <div
                  data-testid="mobile-sidebar-tabs"
                  className="flex items-center justify-end gap-2"
                  aria-label="Vista del ticket"
               >
                  {showTableMapButton && onOpenTableMap && (
                     <button type="button" onClick={() => { void handleBackToMap(); }}
                        className="mr-auto flex h-12 items-center gap-2 rounded-xl bg-orange-500 px-3 text-sm font-bold text-white">
                        <Layout size={18} /> Mesas
                     </button>
                  )}
                  <button
                     type="button"
                     data-testid="mobile-cart-tab-button"
                     onClick={() => setRightSidebarTab('CART')}
                     aria-label={`Abrir carrito${cartQuantity > 0 ? ` con ${cartQuantity} artículos` : ''}`}
                     aria-pressed={rightSidebarTab === 'CART'}
                     className={`group relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.05rem] border transition-all duration-200 ${
                        rightSidebarTab === 'CART'
                           ? 'border-red-200 bg-gradient-to-br from-red-50 via-rose-50 to-red-100 text-red-700 shadow-[0_14px_30px_rgba(248,113,113,0.18)]'
                           : 'border-slate-200 bg-white text-slate-500'
                     }`}
                  >
                     <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-red-100 bg-white text-red-500 shadow-sm">
                        <ShoppingBag size={18} strokeWidth={2.3} />
                     </span>
                     {cartQuantity > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-7 items-center justify-center rounded-full border border-white bg-white px-2 py-1 text-[10px] font-black leading-none text-red-700 shadow-md">
                           {cartQuantity}
                        </span>
                     )}
                  </button>
                  <button
                     type="button"
                     data-testid="mobile-actions-tab-button"
                     onClick={() => setRightSidebarTab('ACTIONS')}
                     aria-label="Abrir acciones rápidas"
                     aria-pressed={rightSidebarTab === 'ACTIONS'}
                     className={`group flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.05rem] border transition-all duration-200 ${
                        rightSidebarTab === 'ACTIONS'
                           ? 'border-blue-200 bg-gradient-to-br from-blue-50 via-sky-50 to-blue-100 text-blue-700 shadow-[0_14px_30px_rgba(59,130,246,0.18)]'
                           : 'border-slate-200 bg-white text-slate-500'
                     }`}
                  >
                     <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-blue-100 bg-white text-blue-500 shadow-sm">
                        <Layers size={18} strokeWidth={2.3} />
                     </span>
                  </button>
                  {!isKioskMode && <OrderServiceTypeButton value={effectiveOrderServiceType} onClick={() => handleGridAction('TAKEOUT')} />}
               </div>

               {/* CUSTOMER PILL (MOBILE) */}
               {
                  selectedCustomer ? (
                     <div className="flex items-center justify-between bg-blue-50 px-4 py-2 rounded-full border border-blue-100" onClick={onOpenCustomers}>
                        <div className="flex items-center gap-2">
                           {resolveCustomerImageSrc(selectedCustomer) ? (
                              <img
                                 src={resolveCustomerImageSrc(selectedCustomer)}
                                 alt={selectedCustomer.name}
                                 className="w-6 h-6 rounded-full object-cover border border-blue-200 bg-white"
                              />
                           ) : (
                              <div className="w-6 h-6 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center font-bold text-[10px]">{selectedCustomer.name.charAt(0)}</div>
                           )}
                           <span className="text-xs font-bold text-blue-900 truncate max-w-[150px]">{selectedCustomer.name}</span>
                           {egoClubTierLabel && (
                              <span className={`text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded border ${getTierBadgeClass(selectedCustomer.tier)}`}>
                                 {egoClubTierLabel}
                              </span>
                           )}
                        </div>
                        <div className="flex items-center gap-1">
                           <button
                              onClick={(e) => { e.stopPropagation(); openRecoverReservationForSelectedCustomer(); }}
                              className="px-2 py-1 rounded-full bg-teal-100 text-teal-700 text-[10px] font-black hover:bg-teal-200 transition-colors"
                              title="Reservas del cliente"
                           >
                              Res. {selectedCustomerActiveReservationsCount}
                           </button>
                           <button onClick={(e) => { e.stopPropagation(); onSelectCustomer(null); }} className="p-1 text-blue-400"><X size={14} /></button>
                        </div>
                     </div>
                  ) : (
                     <button onClick={onOpenCustomers} className="flex items-center gap-2 px-4 py-2 bg-gray-50 border border-dashed border-gray-300 rounded-full text-gray-400 text-xs font-bold uppercase tracking-wider">
                        <UserPlus size={14} /> Asignar Cliente
                     </button>
                  )
               }
            </div >

            {/* DESKTOP: marca + mesa/comensales bajo el logo; retail: busqueda al centro; botones carrito/acciones alineados a la derecha (como APK 1.0.300) */}
            <div className={`pos-ticket-heading ${isMobile ? 'hidden' : 'flex'} px-5 py-3 border-b border-gray-100 bg-gray-50/50 flex-col gap-3 shrink-0 flex-none ${activeTable ? 'border-l-4 border-l-blue-500' : ''}`} >
               <div data-testid="desktop-ticket-toolbar" className="flex w-full items-center justify-between gap-1">
                  <div className="flex min-w-0 shrink-0 items-center justify-start">
                     {renderTicketBrand(!isRetailMode)}
                  </div>

                  {/* RETAIL MODE SEARCH BAR */}
                  {isRetailMode && (
                     <div className="relative min-w-0 max-w-xl flex-1 group">
                        <button
                           type="button"
                           onClick={() => handleRetailSearchSubmit()}
                           className="absolute left-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-purple-50 hover:text-purple-600"
                           title="Buscar"
                        >
                           <Search size={18} />
                        </button>
                        <input
                           ref={retailSearchInputRef}
                           data-barcode-scanner-target="true"
                           type="text"
                           inputMode="search"
                           enterKeyHint="search"
                           autoComplete="off"
                           placeholder="Escanear o buscar..."
                           value={searchTerm}
                           onChange={(e) => handleCatalogSearchInput(e.target.value)}
                           onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                 handleRetailSearchSubmit(e.currentTarget.value);
                              }
                           }}
                           autoFocus
                           className="w-full pl-12 pr-12 py-2.5 bg-gray-100 rounded-xl border-none outline-none focus:bg-white focus:ring-2 focus:ring-purple-500 text-sm font-bold transition-all"
                        />
                        <button
                           type="button"
                           onClick={() => setSearchTerm('')}
                           className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-slate-200 hover:text-slate-600"
                           title={searchTerm ? 'Limpiar búsqueda' : 'Lector silencioso activo'}
                        >
                           {searchTerm ? <X size={16} /> : <ScanBarcode size={16} />}
                        </button>

                        {/* SEARCH RESULTS DROPDOWN */}
                        {searchTerm && filteredProducts.length > 0 && (
                           <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-100 max-h-[60vh] overflow-y-auto z-50">
                              {filteredProducts.map((product, idx) => {
                                 const whBlocked = isProductWarehouseBlockedForSale(product);
                                 return (
                                    <div
                                       key={product.id || `search-prod-${idx}`}
                                       title={
                                          whBlocked
                                             ? `No vendible en ${getTerminalWarehouseName()}: ajuste almacenes en el ERP.`
                                             : undefined
                                       }
                                       onClick={() => {
                                          handleProductClick(product);
                                          setSearchTerm('');
                                       }}
                                       className={`p-3 border-b border-gray-50 last:border-0 flex justify-between items-center gap-2 group ${
                                          whBlocked
                                             ? 'cursor-not-allowed bg-amber-50/80 opacity-90'
                                             : 'cursor-pointer hover:bg-purple-50'
                                       }`}
                                    >
                                       <div className="min-w-0 flex-1">
                                          <p
                                             className={`font-bold text-sm truncate ${
                                                whBlocked ? 'text-gray-700' : 'text-gray-800 group-hover:text-purple-700'
                                             }`}
                                          >
                                             {product.name}
                                          </p>
                                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                             <p className="text-[10px] text-gray-400 font-mono">SKU: {(product as any).sku || product.id || '---'}</p>
                                             <p className="text-[10px] text-gray-400 font-mono">Barra: {product.barcode || '---'}</p>
                                             {whBlocked && (
                                                <span className="inline-flex items-center gap-0.5 rounded bg-amber-600 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-white">
                                                   <MapPin size={8} strokeWidth={3} />
                                                   Sin almacén
                                                </span>
                                             )}
                                          </div>
                                       </div>
                                       <span
                                          className={`shrink-0 font-black ${whBlocked ? 'text-gray-600' : 'text-gray-900'}`}
                                       >
                                          {baseCurrency.symbol}
                                          {getProductPrice(product).toLocaleString('en-US', {
                                             minimumFractionDigits: 2,
                                             maximumFractionDigits: 2
                                          })}
                                       </span>
                                    </div>
                                 );
                              })}
                           </div>
                        )}
                     </div>
                  )}

                  <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
                     {cart.length > 0 && (
                        <button
                           onClick={handleClearFreshCartItems}
                           disabled={!hasClearableFreshItems}
                           aria-label="Borrar artículos nuevos del ticket"
                           title={hasClearableFreshItems ? 'Borrar artículos nuevos' : 'No hay artículos nuevos para borrar'}
                           className={`group flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.05rem] border transition-all duration-200 ${
                              hasClearableFreshItems
                                 ? 'border-rose-200 bg-white text-rose-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700'
                                 : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300'
                           }`}
                        >
                           <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-all ${
                              hasClearableFreshItems
                                 ? 'border-rose-100 bg-rose-50 text-rose-500 group-hover:border-rose-200 group-hover:bg-white group-hover:text-rose-700'
                                 : 'border-slate-100 bg-white text-slate-300'
                           }`}>
                              <Trash2 size={18} strokeWidth={2.3} />
                           </span>
                        </button>
                     )}
                     {/* Cliente y comprobante compactos, arriba a la derecha */}
                     <div className="flex shrink-0 items-center gap-1.5">
                        {selectedCustomer ? (
                           <div className="flex items-center gap-1.5 rounded-xl border border-[#DEE7E6] bg-white px-2 py-1 shadow-sm">
                              <UserPlus size={14} className="text-[#00A7A0]" />
                              <span className="max-w-[140px] truncate text-[11px] font-black text-[#132124]">{selectedCustomer.name}</span>
                              {egoClubTierLabel && (
                                 <span className={`text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded border ${getTierBadgeClass(selectedCustomer.tier)}`}>
                                    {egoClubTierLabel}
                                 </span>
                              )}
                              <button
                                 type="button"
                                 onClick={() => onSelectCustomer(null)}
                                 title="Quitar cliente del ticket"
                                 className="rounded p-0.5 text-[#9DAEAD] transition-colors hover:text-[#C0392B]"
                              >
                                 <X size={12} />
                              </button>
                           </div>
                        ) : (
                           <button
                              type="button"
                              onClick={onOpenCustomers}
                              title="Asignar cliente al ticket"
                              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-[#C9D8D7] bg-white px-2.5 text-[10px] font-black uppercase tracking-wide text-[#6C7F80] transition-colors hover:border-[#00A7A0] hover:text-[#00877F]"
                           >
                              <UserPlus size={14} /> Cliente
                           </button>
                        )}
                        {!isOrderTakerMode && !isFiscalModeDisabled && (
                           <span
                              title={`Status fiscal: ${fiscalStatus.type} ${fiscalStatus.hasNCF ? 'activo' : 'agotado'}`}
                              className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-[10px] font-black uppercase tracking-wide ${
                                 canCheckoutWithFiscalPolicy
                                    ? 'border-[#DCEBD0] bg-[#F5FBEA] text-[#5B7A18]'
                                    : 'border-red-200 bg-red-50 text-red-600'
                              }`}
                           >
                              <Landmark size={12} />
                              {fiscalStatus.type}{fiscalStatus.hasNCF ? '' : ' · sin NCF'}
                           </span>
                        )}
                     </div>

                     <button
                        onClick={() => setRightSidebarTab('CART')}
                        aria-label={`Abrir carrito${cartQuantity > 0 ? ` con ${cartQuantity} artículos` : ''}`}
                        title={`Carrito${cartQuantity > 0 ? ` (${cartQuantity})` : ''}`}
                        className={`group relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.05rem] border transition-all duration-200 ${
                           rightSidebarTab === 'CART'
                              ? 'border-red-200 bg-gradient-to-br from-red-50 via-rose-50 to-red-100 text-red-700 shadow-[0_14px_30px_rgba(248,113,113,0.18)]'
                              : 'border-slate-200 bg-white text-slate-500 hover:border-red-200 hover:bg-red-50/70 hover:text-red-600'
                        }`}
                     >
                        <span
                           className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-all ${
                              rightSidebarTab === 'CART'
                                 ? 'border-red-200/80 bg-white/90 text-red-600 shadow-sm'
                                 : 'border-red-100 bg-red-50 text-red-500 group-hover:border-red-200 group-hover:bg-white group-hover:text-red-600'
                           }`}
                        >
                           <ShoppingBag size={18} strokeWidth={2.3} />
                        </span>
                        {cartQuantity > 0 && (
                           <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-7 items-center justify-center rounded-full border border-white bg-white px-2 py-1 text-[10px] font-black leading-none text-red-700 shadow-md">
                              {cartQuantity}
                           </span>
                        )}
                     </button>
                     <button
                        onClick={() => setRightSidebarTab('ACTIONS')}
                        aria-label="Abrir acciones rápidas"
                        title="Acciones"
                        className={`group flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.05rem] border transition-all duration-200 ${
                           rightSidebarTab === 'ACTIONS'
                              ? 'border-blue-200 bg-gradient-to-br from-blue-50 via-sky-50 to-blue-100 text-blue-700 shadow-[0_14px_30px_rgba(59,130,246,0.18)]'
                              : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:bg-blue-50/70 hover:text-blue-600'
                        }`}
                     >
                        <span
                           className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-all ${
                              rightSidebarTab === 'ACTIONS'
                                 ? 'border-blue-200/80 bg-white/90 text-blue-600 shadow-sm'
                                 : 'border-blue-100 bg-blue-50 text-blue-500 group-hover:border-blue-200 group-hover:bg-white group-hover:text-blue-600'
                           }`}
                        >
                           <Layers size={18} strokeWidth={2.3} />
                        </span>
                     </button>
                     {!isKioskMode && <OrderServiceTypeButton value={effectiveOrderServiceType} onClick={() => handleGridAction('TAKEOUT')} />}
                  </div>
               </div>

               {activeTable && (
                  <div className="flex w-full items-center justify-between gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
                     <div className="flex min-w-0 items-center gap-2">
                        <Layout size={18} className="shrink-0 text-blue-600" />
                        <span
                           className="max-w-[220px] truncate text-base font-black tracking-tight text-slate-900"
                           title={activeTableContext.compactLabel || activeTableHeaderLabel}
                        >
                           {activeBarTabName || activeTableHeaderLabel || activeTable.nombre || activeTable.name}
                        </span>
                     </div>

                     <div className="flex shrink-0 items-center gap-2">
                        <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 shadow-sm transition-all hover:shadow-md">
                           <button
                              onClick={() => onUpdateActiveTableGuests?.(Math.max(1, (activeTable.guests || 1) - 1))}
                              className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-50 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                              title="Reducir comensales"
                           >
                              <Minus size={10} strokeWidth={3} />
                           </button>

                           <div className="flex items-center gap-1 px-1">
                              <Users size={12} className="text-blue-500" />
                              <span className="min-w-[1rem] text-center text-xs font-black text-slate-700">{activeTable.guests || 1}</span>
                           </div>

                           <button
                              onClick={() => onUpdateActiveTableGuests?.((activeTable.guests || 1) + 1)}
                              className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-50 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-500"
                              title="Aumentar comensales"
                           >
                              <Plus size={10} strokeWidth={3} />
                           </button>
                        </div>
                     </div>
                  </div>
               )}

               {shouldApplyServiceCharge && (
                  <div className="flex items-center gap-1 rounded-lg border border-blue-100/50 bg-blue-50 px-2 py-1 text-[9px] font-black uppercase tracking-tighter text-blue-600 animate-in fade-in slide-in-from-top-1">
                     <Percent size={10} className="text-blue-500" />
                     <span>Propina legal {appliedServiceTaxPolicy.legalTip?.percentage ?? serviceCharge?.percentage ?? 0}% activa</span>
                  </div>
               )}

               {
                  selectedCustomer ? (
                     <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50/50 rounded-xl border border-blue-100 animate-in slide-in-from-top-2">
                        {resolveCustomerImageSrc(selectedCustomer) ? (
                           <img
                              src={resolveCustomerImageSrc(selectedCustomer)}
                              alt={selectedCustomer.name}
                              className="w-10 h-10 rounded-full object-cover border border-blue-200 bg-white"
                           />
                        ) : (
                           <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-black">
                              {selectedCustomer.name.substring(0, 2).toUpperCase()}
                           </div>
                        )}
                        <div className="flex-1 min-w-0">
                           <div className="flex items-center gap-2">
                              <p className="font-bold text-gray-800 truncate">{selectedCustomer.name}</p>
                              {egoClubTierLabel && (
                                 <span className={`text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded border ${getTierBadgeClass(selectedCustomer.tier)}`}>
                                    {egoClubTierLabel}
                                 </span>
                              )}
                              {/* Save to contact feature temporarily disabled due to missing prop plumbing */}
                           </div>
                           <div className="flex items-center gap-2 flex-wrap">
                              {selectedCustomer.taxId && (
                                 <span className="text-xs font-mono text-gray-500">{selectedCustomer.taxId}</span>
                              )}
                              {selectedCustomer.fiscalStatus === 'ACTIVO' && (
                                 <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">FISCAL</span>
                              )}
                              {selectedCustomer.isTemporary && (
                                 <span className="text-[9px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-bold">TEMP</span>
                              )}
                              {isDelinquent && (
                                 <span className="text-[9px] bg-red-600 text-white px-1.5 py-0.5 rounded font-black animate-pulse shadow-lg shadow-red-200">
                                    DEUDA VENCIDA / CRÉDITO BLOQUEADO
                                 </span>
                              )}
                           </div>
                        </div>
                        <div className="flex items-center gap-2">
                           {isEgoClubEnabled(config) && loyaltyRedeemChannel.enabled && (selectedCustomer.loyaltyPoints || 0) > 0 && (
                              <button
                                 onClick={() => setShowLoyaltyRedeemModal(true)}
                                 title="Canjear puntos EGO Club"
                                 className="px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-all flex items-center gap-1"
                              >
                                 <Coins size={14} />
                                 <span className="text-[10px] font-black uppercase">
                                    {(selectedCustomer.loyaltyPoints || 0).toLocaleString('es-DO')} pts
                                 </span>
                              </button>
                           )}
                           <button
                              onClick={openRecoverReservationForSelectedCustomer}
                              title="Ver reservas activas del cliente"
                              className="px-2.5 py-1.5 rounded-lg border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 transition-all flex items-center gap-1"
                           >
                              <QrCode size={14} />
                              <span className="text-[10px] font-black uppercase">Res. {selectedCustomerActiveReservationsCount}</span>
                           </button>
                           <button onClick={() => onSelectCustomer(null)} className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-lg transition-colors">
                              <X size={16} />
                           </button>
                        </div>
                     </div>
                  ) : (
                     isMobile && (
                     <button onClick={onOpenCustomers} className="w-full flex items-center justify-between p-3 bg-white border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:text-blue-500 group"><div className="flex items-center gap-2"><UserPlus size={18} /><span className="text-xs font-bold uppercase">Asignar Cliente</span></div><ChevronRight size={16} /></button>
                     )
                  )
               }

               {shouldShowFiscalReserveAlert && fiscalReserveAlert && (
                  <div
                     className={`mt-3 mb-2 rounded-2xl border px-3 py-2.5 shadow-sm animate-pulse ${
                        fiscalReserveAlert.tone === 'critical'
                           ? 'border-red-200 bg-red-50 text-red-800'
                           : 'border-amber-200 bg-amber-50 text-amber-800'
                     }`}
                  >
                     <div className="flex items-start gap-2.5">
                        <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                        <div className="min-w-0">
                           <p className="text-[10px] font-black uppercase tracking-[0.18em]">Reserva fiscal baja</p>
                           <p className="mt-1 text-xs font-black leading-snug">{fiscalReserveAlert.message}</p>
                        </div>
                     </div>
                  </div>
               )}

               {isMobile && !isOrderTakerMode && !isFiscalModeDisabled && (
                  <div className={`mt-1 flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase ${canCheckoutWithFiscalPolicy ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100 animate-pulse'}`}>
                     <Landmark size={12} />
                     <span>Status Fiscal: {`${fiscalStatus.type} ${fiscalStatus.hasNCF ? (fiscalStatus.isTerminalBlock ? 'Bloque Terminal' : (fiscalStatus.isUsingPool ? 'Reservado en Pool' : 'Lote Global Activo')) : 'Agotado'}`}</span>
                  </div>
               )}
            </div >

            {/* --- CART ITEMS LIST & TAB VIEWS --- */}
            {rightSidebarTab === 'ACTIONS' && isMobile ? (
               <div
                  data-testid="mobile-quick-actions-panel"
                  className="flex-1 min-h-0 overflow-y-auto px-4 py-3 custom-scrollbar bg-gray-100/70"
               >
                  {renderQuickActionsPanel()}
               </div>
            ) : isRetailMode ? (
               // SUPERMARKET MODE (DENSE TABLE)
               <ProductTableSupermarket
                  cart={processedCart}
                  config={config}
                  taxIncluded={isTaxIncluded}
                  currencySymbol={baseCurrency.symbol}
                  lastAddedCartId={lastAddedCartId}
                  onRemoveItem={(cartId) => updateCartItem(null, cartId)}
                  onDuplicateItem={duplicateCartLine}
                  onLineDiscount={(cartId) => setLineDiscountCartId(cartId)}
                  onAssignSeller={(cartId) => setSellerPickerCartId(cartId)}
                  resolveSellerName={resolveSalespersonLabel}
                  containerStyle={isMobile ? bottomAwareScrollStyle : undefined}
               />
            ) : (
               // STANDARD RESTAURANT/RETAIL LIST
               <>
                  <div
                     className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 custom-scrollbar bg-gray-100/70"
                     style={isMobile ? bottomAwareScrollStyle : undefined}
                  >
                     {rightSidebarTab === 'ACTIONS' ? (
                        renderQuickActionsPanel()
                     ) : processedCart.length === 0 ? (
                        <div className="pos-empty-cart flex h-full min-h-[320px] items-center justify-center">
                           <div className="flex flex-col items-center text-center select-none">
                              <div className="mb-4 flex h-28 w-28 items-center justify-center rounded-full bg-slate-50 text-slate-300 shadow-inner">
                                 <ShoppingBag size={46} strokeWidth={1.4} />
                              </div>
                              <p className="text-sm font-black text-slate-300">Carrito vacío</p>
                              <p className="mt-1 text-[11px] font-semibold text-slate-300">Selecciona productos para comenzar</p>
                           </div>
                        </div>
                     ) : (
                        processedCart.map((item, idx) => {
                        const hasDiscount = item.originalPrice && item.price < item.originalPrice;
                        const discountPct = hasDiscount ? Math.round((1 - item.price / item.originalPrice!) * 100) : 0;
                        const lineNet = item.price * item.quantity;
                        const lineTaxSummary = getCartItemTaxSummary(item);
                        const isActiveCartItem = activeCartItemId === item.cartId;
                        const isReturnedToKds = isKdsReturnedCartItem(item);
                        const isSubtotalizedItem = Boolean(item.subtotalizedAt);
                        const isDispatchedToKds = Boolean(item.dispatched);
                        const lockedMutationMessage = 'Este artículo ya fue enviado al KDS. Usa Devolver para cancelar la preparación.';
                        const lockedReturnTitle = isReturnedToKds ? 'Artículo ya devuelto en KDS' : 'Devolver en KDS';

                        // MOBILE CARD DESIGN
                        if (isMobile) {
                           return (
                              <div
                                 key={item.cartId || `cart-m-${idx}`}
                                 onClick={() => toggleCartItemFocus(item.cartId)}
                                 className={`bg-white rounded-2xl p-3 shadow-sm border flex gap-3 animate-in slide-in-from-right-2 transition-all cursor-pointer ${isActiveCartItem ? 'border-blue-200 ring-2 ring-blue-100 shadow-md' : 'border-gray-100 hover:border-slate-200'}`}
                              >
                                 <div className="w-16 h-16 rounded-xl bg-gray-50 overflow-hidden shrink-0 border border-gray-100">
                                    {resolveProductImageSrc(item) ? <img src={resolveProductImageSrc(item)} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-300"><Grid size={24} /></div>}
                                 </div>
                                 <div className="flex-1 min-w-0 flex flex-col justify-between">
                                    <div>
                                       <div className="flex justify-between items-start">
                                          <h4 className="font-bold text-gray-800 text-sm leading-tight line-clamp-1">{item.name}</h4>
                                       </div>
                                       <div className="flex flex-col mt-0.5">
                                          <div className="flex items-center gap-2">
                                             <span className="text-xs font-black text-blue-600">{baseCurrency.symbol}{(item.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                             {hasDiscount && <span className="text-[10px] text-red-500 font-bold line-through">{baseCurrency.symbol}{item.originalPrice?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                                          </div>
                                          <span className="text-[9px] font-bold text-gray-500 uppercase tracking-tighter">{lineTaxSummary}</span>
                                          {item.consignmentDocumentNo && (
                                             <span className="mt-1 inline-flex w-fit rounded-full bg-cyan-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-cyan-700">
                                                Cons. {item.consignmentDocumentNo}
                                             </span>
                                          )}
                                          {isDispatchedToKds && (
                                             <span className={`mt-1 inline-flex w-fit rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${isReturnedToKds ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                                                {isReturnedToKds ? 'KDS devuelto' : 'KDS enviado'}
                                             </span>
                                          )}
                                          {isSubtotalizedItem && (
                                             <span className="mt-1 inline-flex w-fit rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-violet-700">
                                                Subtotalizado
                                             </span>
                                          )}
                                       </div>
                                       {item.salespersonId && (
                                          <div className="mt-1 flex items-center gap-1 text-[9px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-md w-fit">
                                             <User size={10} />
                                             <span>{resolveSalespersonLabel(item.salespersonId)}</span>
                                          </div>
                                       )}
                                    </div>
                                    {!isActiveCartItem ? (
                                       <div className="mt-2 flex items-center justify-between">
                                          <div className="rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-600 shadow-sm">
                                             {item.quantity} ud
                                          </div>
                                          <span className="font-black text-gray-900 text-sm">{baseCurrency.symbol}{lineNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                       </div>
                                    ) : (
                                       <>
                                          <div className="flex items-center justify-between mt-2">
                                             <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1">
                                                <button
                                                   type="button"
                                                   onClick={(e) => {
                                                      e.stopPropagation();
                                                      if (isDispatchedToKds) {
                                                         alert(lockedMutationMessage);
                                                         return;
                                                      }
                                                      updateCartItem({ ...item, cartId: item.cartId, quantity: item.quantity - 1 });
                                                   }}
                                                   disabled={isDispatchedToKds || !canStepCartQuantity(item.quantity, -1)}
                                                   className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                   <Minus size={13} strokeWidth={3} />
                                                </button>
                                                <span className="min-w-[20px] text-center text-xs font-black text-slate-800">{item.quantity}</span>
                                                <button
                                                   type="button"
                                                   onClick={(e) => {
                                                      e.stopPropagation();
                                                      if (isDispatchedToKds) {
                                                         alert('Para agregar más cantidad a un artículo ya enviado al KDS, agrega una línea nueva desde el catálogo.');
                                                         return;
                                                      }
                                                      updateCartItem({ ...item, cartId: item.cartId, quantity: item.quantity + 1 });
                                                   }}
                                                   disabled={isDispatchedToKds || !canStepCartQuantity(item.quantity, 1)}
                                                   className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                   <Plus size={13} strokeWidth={3} />
                                                </button>
                                             </div>
                                             <span className="font-black text-gray-900 text-sm">{baseCurrency.symbol}{lineNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                          </div>
                                          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-gray-100 pt-3">
                                             <button
                                                  onClick={(e) => {
                                                     e.stopPropagation();
                                                     setEditingItem(item);
                                                  }}
                                                className="inline-flex items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-blue-700 shadow-sm transition-all hover:bg-blue-100"
                                                title="Editar artículo"
                                             >
                                                <Edit3 size={13} strokeWidth={2.4} />
                                             </button>
                                             {isDispatchedToKds ? (
                                                <button
                                                   onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleReturnDispatchedCartItem(item);
                                                   }}
                                                   disabled={isReturnedToKds}
                                                   className="inline-flex items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-700 shadow-sm transition-all hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                   title={lockedReturnTitle}
                                                >
                                                   <Undo2 size={13} strokeWidth={2.4} />
                                                </button>
                                             ) : (
                                                <button
                                                   onClick={(e) => {
                                                      e.stopPropagation();
                                                      updateCartItem(null, item.cartId);
                                                   }}
                                                   className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-red-700 shadow-sm transition-all hover:bg-red-100"
                                                   title="Eliminar artículo"
                                                >
                                                   <Trash2 size={13} strokeWidth={2.4} />
                                                </button>
                                             )}
                                          </div>
                                       </>
                                    )}
                                 </div>
                              </div>
                           );
                        }

                        // DESKTOP CARD DESIGN (Restaurant/Retail)
                        return (
                           <div
                              key={item.cartId || `cart-${idx}`}
                              onClick={() => toggleCartItemFocus(item.cartId)}
                              className={`bg-white rounded-xl p-3 shadow-sm border group relative overflow-hidden transition-all hover:shadow-md cursor-pointer ${editingItem?.cartId === item.cartId || isActiveCartItem ? 'ring-2 ring-blue-100 border-blue-200 bg-blue-50/40' : 'border-gray-100 hover:border-slate-200'}`}
                           >
                              {/* Discount Badge */}
                              {hasDiscount && (
                                 <div className="absolute top-0 right-0 bg-red-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-bl-lg">
                                    -{discountPct}%
                                 </div>
                              )}

                              <div className="flex gap-3">
                                 {/* Item Image */}
                                 {uxConfig.showProductImages && (
                                    <div className="w-12 h-12 rounded-lg bg-gray-50 shrink-0 overflow-hidden border border-gray-100">
                                       {resolveProductImageSrc(item) ? <img src={resolveProductImageSrc(item)} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-300"><Grid size={20} /></div>}
                                    </div>
                                 )}

                                 {/* Item Details */}
                                 <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start mb-1">
                                       <h4 className="font-bold text-gray-800 text-sm leading-tight line-clamp-2" title={item.name}>{item.name}</h4>
                                       <div className="text-right shrink-0 ml-2">
                                          <p className="font-black text-gray-900">{baseCurrency.symbol}{lineNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                          {hasDiscount && <p className="text-[10px] text-gray-400 line-through">{baseCurrency.symbol}{(item.originalPrice! * item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>}
                                       </div>
                                    </div>

                                    <div className="flex items-center justify-between">
                                       <div className="flex flex-col">
                                          <div className="flex flex-col">
                                             <div className="flex items-center gap-1 text-sm font-bold leading-snug text-slate-700">
                                                <span>{item.quantity} × {baseCurrency.symbol}{item.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                {item.modifiers && item.modifiers.length > 0 && <span className="text-blue-600 font-bold ml-1">+{item.modifiers.length} mod</span>}
                                             </div>
                                             <div className="mt-0.5 text-[11px] font-semibold leading-snug text-slate-500">
                                                {lineTaxSummary}
                                             </div>
                                             {item.consignmentDocumentNo && (
                                                <span className="mt-1 inline-flex w-fit rounded-full bg-cyan-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-cyan-700">
                                                   Cons. {item.consignmentDocumentNo}
                                                </span>
                                             )}
                                             {isDispatchedToKds && (
                                                <span className={`mt-1 inline-flex w-fit rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${isReturnedToKds ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                                                   {isReturnedToKds ? 'KDS devuelto' : 'KDS enviado'}
                                                </span>
                                             )}
                                          </div>
                                          {/* Salesperson Badge */}
                                          {item.salespersonId && (
                                             <div className="flex items-center gap-1 text-[9px] text-gray-400 mt-0.5">
                                                <User size={10} />
                                                <span className="truncate max-w-[80px]">{resolveSalespersonLabel(item.salespersonId) || '...'}</span>
                                             </div>
                                          )}
                                       </div>

                                       {isActiveCartItem && (
                                          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1">
                                             <button
                                                type="button"
                                                onClick={(e) => {
                                                   e.stopPropagation();
                                                   if (isDispatchedToKds) {
                                                      alert(lockedMutationMessage);
                                                      return;
                                                   }
                                                   updateCartItem({ ...item, quantity: item.quantity - 1 });
                                                }}
                                                disabled={isDispatchedToKds || !canStepCartQuantity(item.quantity, -1)}
                                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                                                title="Restar cantidad"
                                             >
                                                <Minus size={13} strokeWidth={3} />
                                             </button>
                                             <button
                                                type="button"
                                                onClick={(e) => {
                                                   e.stopPropagation();
                                                   if (isDispatchedToKds) {
                                                      alert('Para agregar más cantidad a un artículo ya enviado al KDS, agrega una línea nueva desde el catálogo.');
                                                      return;
                                                   }
                                                   updateCartItem({ ...item, quantity: item.quantity + 1 });
                                                }}
                                                disabled={isDispatchedToKds || !canStepCartQuantity(item.quantity, 1)}
                                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                                                title="Sumar cantidad"
                                             >
                                                <Plus size={13} strokeWidth={3} />
                                             </button>
                                             <button
                                               onClick={(e) => {
                                                  e.stopPropagation();
                                                  setEditingItem(item);
                                               }}
                                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 shadow-sm transition-colors hover:bg-blue-100"
                                                title="Editar artículo"
                                             >
                                                <Edit3 size={12} />
                                             </button>
                                             {isDispatchedToKds ? (
                                                <button
                                                   onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleReturnDispatchedCartItem(item);
                                                   }}
                                                   disabled={isReturnedToKds}
                                                   className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700 shadow-sm transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                   title={lockedReturnTitle}
                                                >
                                                   <Undo2 size={12} />
                                                </button>
                                             ) : (
                                                <button
                                                   onClick={(e) => {
                                                      e.stopPropagation();
                                                      updateCartItem(null, item.cartId);
                                                   }}
                                                   className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 shadow-sm transition-colors hover:bg-red-100"
                                                   title="Eliminar artículo"
                                                >
                                                   <Trash2 size={12} />
                                                </button>
                                             )}
                                          </div>
                                       )}
                                    </div>
                                 </div>
                              </div>

                              {/* Modifiers List */}
                              {item.modifiers && item.modifiers.length > 0 && (
                                 <div className="mt-2 pl-2 border-l-2 border-blue-100">
                                    <p className="text-[10px] text-gray-500 leading-relaxed">{item.modifiers.join(', ')}</p>
                                 </div>
                              )}
                           </div>
                        );
                     })
                  )}
                  </div >
               </>
            )}
            <div ref={cartEndRef} />

            {activeRecoveredReservation && (
               <div className="mx-4 mb-3 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800">
                  <div className="flex items-center gap-2">
                     <p className="text-[10px] font-black uppercase tracking-widest">
                        {isRecoveredUberOrder ? 'Pedido Recuperado' : 'Reserva Recuperada'}
                     </p>
                     {isRecoveredUberOrder && (
                        <span className="inline-flex items-center rounded-full bg-black px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-white">
                           Uber Eats
                        </span>
                     )}
                  </div>
                  <p className="text-xs font-bold mt-1">{activeRecoveredReservation.code} • {activeRecoveredReservation.customerName}</p>
                  <p className="text-[11px] mt-1">
                     Total: {baseCurrency.symbol}{cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Anticipo: {baseCurrency.symbol}{reservationAdvanceApplied.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Saldo: {baseCurrency.symbol}{reservationBalanceDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  {isRecoveredUberOrder && (
                     <p className="text-[11px] mt-1 font-semibold text-amber-700">
                        Pedido bloqueado para cambios manuales. Debe convertirse en venta POS para confirmar Uber Eats.
                     </p>
                  )}
               </div>
            )}

            {/* Sidebar Footer */}
            <div className={`pos-ticket-footer flex-none bg-white border-t border-gray-200 p-4 shadow-inner ${isRetailMode ? 'supermarket-footer' : 'space-y-3'} ${isMobile ? 'hidden' : ''}`}>
               {/* DESKTOP FOOTER CONTENT (UNCHANGED) */}
               {
                  isRetailMode ? (
                     // --- RETAIL MODE FOOTER (HORIZONTAL) ---
                     <>
                        <div className="supermarket-footer-secondary min-w-0">
                           <ActionGrid
                              actionRegion="other"
                              orientation="horizontal"
                              onAction={handleGridAction}
                              config={config}
                              parkedTicketsCount={parkedTickets.length}
                              isReturnMode={isReturnMode}
                              hasCartItems={cart.length > 0}
                              globalDiscountValue={globalDiscount.value}
                              showLogout={false}
                              allowWaitList={!activeTable}
                              hideFinancialClosings={isOrderTakerMode}
                           />
                        </div>
                        <SupermarketTicketSummary
                           symbol={baseCurrency.symbol}
                           subtotal={cartSubtotal}
                           discount={discountAmount}
                           tax={cartTax}
                           total={cartTotal}
                           units={cart.reduce((acc, item) => acc + item.quantity, 0)}
                           points={pointsEarned}
                        />
                        <div className="supermarket-checkout">
                           <ActionGrid
                              actionRegion="ticket"
                              orientation="horizontal"
                              onAction={handleGridAction}
                              config={config}
                              parkedTicketsCount={parkedTickets.length}
                              isReturnMode={isReturnMode}
                              hasCartItems={cart.length > 0}
                              globalDiscountValue={globalDiscount.value}
                              showLogout={false}
                              allowWaitList={!activeTable}
                              hideFinancialClosings={isOrderTakerMode}
                           />
                           <div className="supermarket-checkout-buttons">
                              <button
                                 onClick={() => triggerSafetyGate('Cerrar Sesión', onLogout)}
                                 className="h-14 min-w-0 px-3 rounded-2xl font-black text-base border-2 border-red-100 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-200 shadow-lg shadow-red-100/60 transition-all active:scale-95 flex items-center justify-center gap-2.5"
                              >
                                 <LogOut size={22} />
                                 <span>Salir</span>
                              </button>
                              <button
                                 onClick={async () => {
                                    if (cart.length > 0 && canCheckoutWithFiscalPolicy) {
                                       startCheckoutInteraction();
                                       if (!isOrderTakerMode) {
                                          const validation = validateTerminalDocument(config, terminalId, 'TICKET');
                                          if (!validation.isValid) {
                                             alert(validation.error);
                                             return;
                                          }
                                       }
                                       if (!await canProceedWithOperationalSession()) return;
                                       proceedToCheckout();
                                    } else if (!canCheckoutWithFiscalPolicy) {
                                       alert("No hay secuencias fiscales disponibles.");
                                    }
                                 }}
                                 disabled={cart.length === 0 || !canCheckoutWithFiscalPolicy}
                                 className={`h-14 min-w-0 px-3 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2.5 ${!canCheckoutWithFiscalPolicy ? 'bg-red-100 text-red-500 cursor-not-allowed border-2 border-red-200' : 'bg-slate-900 text-white hover:bg-black'}`}
                              >
                                 <span>{checkoutActionLabel}</span>
                                 <ArrowRight size={24} />
                              </button>
                           </div>
                        </div>

                     </>
                  ) : (
                     // --- VISUAL MODE FOOTER (VERTICAL) ---
                     <>




                        {/* --- CONDITIONAL FOOTER --- */}
                        {(rightSidebarTab === 'CART' || isMobile) && (isKioskMode ? (
                           <div className="mt-auto pt-6 space-y-6">
                              {/* Simple Kiosk Totals */}
                              <div className="flex justify-between items-end px-2">
                                 <span className="text-xl font-bold text-gray-400">Total a Pagar</span>
                                 <span className="text-6xl font-black text-slate-900 tracking-tighter">{baseCurrency.symbol}{cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </div>

                              <button
                                 onClick={() => {
                                    if (cart.length > 0) {
                                       if (onKioskPay) onKioskPay();
                                       else alert("Kiosk Pay Not Implemented");
                                    }
                                 }}
                                 disabled={cart.length === 0}
                                 className={`w-full py-8 rounded-3xl font-black text-4xl shadow-2xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-6 ${cart.length === 0 ? 'bg-gray-200 text-gray-400' : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-emerald-200'}`}
                              >
                                 <span>PAGAR AHORA</span>
                                 <ArrowRight size={48} />
                              </button>

                              <div className="text-center text-gray-400 text-sm font-medium">
                                 Toca para seleccionar método de pago
                              </div>
                           </div>
                        ) : (
                           <>
                              {activeTable && activeTableAccounts.length > 1 && (
                                 <div className="flex w-full justify-center pb-2">
                                    {renderTableAccountNavigator()}
                                 </div>
                              )}

                              {/* --- BLOQUE DE TOTALES --- */}
                              <div className="space-y-2 pt-3 border-t border-dashed border-gray-200">
                                 <div className="flex justify-between items-center text-sm font-extrabold text-slate-700">
                                    <span>SUBTOTAL</span>
                                    <span>{formatCurrency(cartSubtotal, baseCurrency.symbol)}</span>
                                 </div>
                                 {discountAmount > 0 && (
                                    <div className="flex justify-between items-center text-xs font-black text-red-500">
                                       <span>DESCUENTO</span>
                                       <span>-{formatCurrency(discountAmount, baseCurrency.symbol)}</span>
                                    </div>
                                 )}
                                 <div className="flex justify-between items-start text-sm font-extrabold text-slate-700">
                                    <div className="flex flex-col gap-1">
                                       <div className="flex items-center gap-2">
                                          <span>IMPUESTOS</span>
                                          {primaryTaxLabel && (
                                             <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
                                                {primaryTaxLabel}
                                             </span>
                                          )}
                                       </div>
                                       {combinedTaxBreakdown.length > 0 && (
                                          <div className="space-y-1 pt-0.5">
                                             {combinedTaxBreakdown.map((tax) => (
                                                <div key={tax.id} className="flex items-center justify-between gap-4 text-xs font-semibold text-slate-600">
                                                   <span>{tax.label}</span>
                                                   <span className="font-bold tabular-nums text-slate-700">{formatCurrency(tax.amount, baseCurrency.symbol)}</span>
                                                </div>
                                             ))}
                                          </div>
                                       )}
                                    </div>
                                    <span className="shrink-0 pt-0.5">{formatCurrency(cartTax, baseCurrency.symbol)}</span>
                                 </div>

                                 <div className="flex items-end justify-between gap-4 pt-3">
                                    <div className="space-y-1">
                                       <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.28em]">Total</p>
                                       {pointsEarned > 0 && <p className="text-[10px] font-bold text-purple-500">+{pointsEarned} Puntos</p>}
                                    </div>
                                    <div className="pos-ticket-total text-right text-[2.65rem] font-black text-slate-900 leading-none tracking-tighter">
                                       {formatCurrency(cartTotal, baseCurrency.symbol)}
                                    </div>
                                 </div>
                              </div>

                               <div className={`pos-ticket-checkout grid ${isRestaurantMode ? 'grid-cols-2' : 'grid-cols-2'} items-center gap-3 pt-5 px-1`}>
                                 {!isRestaurantMode ? (
                                    <>
                                       <button
                                          onClick={() => triggerSafetyGate('Cerrar Sesión', onLogout)}
                                          className="h-16 w-full px-3 rounded-2xl font-black text-[13px] uppercase tracking-[0.14em] border-2 border-red-100 bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-200 shadow-lg shadow-red-100/60 transition-all active:scale-95 flex items-center justify-center gap-2"
                                       >
                                          <LogOut size={20} />
                                          <span>Salir</span>
                                       </button>
                                       <button
                                          onClick={async () => {
                                             if (cart.length > 0 && canCheckoutWithFiscalPolicy) {
                                                startCheckoutInteraction();
                                                if (!isOrderTakerMode) {
                                                   const validation = validateTerminalDocument(config, terminalId, 'TICKET');
                                                   if (!validation.isValid) {
                                                      alert(validation.error);
                                                      return;
                                                   }
                                                }
                                                if (!await canProceedWithOperationalSession()) return;
                                                proceedToCheckout();
                                             } else if (!canCheckoutWithFiscalPolicy) {
                                                alert("No hay secuencias fiscales disponibles.");
                                             }
                                          }}
                                          disabled={cart.length === 0 || !canCheckoutWithFiscalPolicy}
                                          className={`h-16 w-full rounded-2xl font-black text-[13px] uppercase tracking-[0.14em] shadow-xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2.5 ${!canCheckoutWithFiscalPolicy ? 'bg-red-100 text-red-500 cursor-not-allowed border-2 border-red-200' : 'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-slate-100'}`}
                                       >
                                          <ArrowRight size={24} />
                                          <span>{checkoutActionLabel}</span>
                                       </button>
                                    </>
                                 ) : (
                                    <>
                                       <button
                                          onClick={() => triggerSafetyGate('Cerrar Sesión', onLogout)}
                                          className="h-16 w-full px-3 rounded-2xl font-black text-[13px] uppercase tracking-[0.14em] border-2 border-red-100 bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-200 shadow-lg shadow-red-100/60 transition-all active:scale-95 flex items-center justify-center gap-2"
                                       >
                                          <LogOut size={20} />
                                          <span>Salir</span>
                                       </button>
                                       <button
                                          onClick={async () => {
                                             if (cart.length > 0) {
                                                startCheckoutInteraction();
                                                if (!await canProceedWithOperationalSession()) return;
                                                proceedToCheckout();
                                             }
                                          }}
                                          disabled={cart.length === 0}
                                          className="h-16 w-full flex items-center justify-center gap-2.5 rounded-2xl font-black text-[13px] uppercase tracking-[0.14em] bg-slate-900 text-white hover:bg-black shadow-xl hover:shadow-md transition-all active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 disabled:opacity-100 disabled:cursor-not-allowed"
                                       >
                                          <ArrowRight size={24} />
                                          <span>{isOrderTakerMode ? 'Guardar pedido' : 'Cobrar'}</span>
                                       </button>
                                    </>
                                 )}
                              </div>
                           </>
                        ))}
                     </>
                  )
               }
            </div >
         </div>

         {/* MOBILE STICKY FOOTER */}
         {
            isMobile && mobileView === 'TICKET' && rightSidebarTab === 'CART' && (
               <div
                  ref={mobileFooterRef}
                  data-testid="portrait-ticket-actions"
                  className="pos-portrait-ticket-actions fixed left-0 right-0 bg-white border-t border-gray-100 p-4 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] z-50 animate-in slide-in-from-bottom-5"
                  style={mobileFooterStyle}
               >
                  {activeTable && activeTableAccounts.length > 1 && (
                     <div className="flex w-full justify-center pb-3">
                        {renderTableAccountNavigator()}
                     </div>
                  )}
                  <div className="flex justify-between items-center mb-4 px-2 gap-3">
                     <div className="flex gap-2 overflow-x-auto overflow-y-hidden no-scrollbar pr-1">
                        <button onClick={() => {
                           if (blockRecoveredUberOrderMutation('aplicar descuentos')) return;
                           setShowGlobalDiscount(true);
                        }} className="flex h-12 min-w-[58px] flex-col items-center justify-center gap-0.5 rounded-xl bg-blue-600 px-2 text-white shadow-sm shadow-blue-600/25 active:scale-95">
                           <Percent size={18} />
                           <span className="text-[9px] font-bold uppercase">Desc.</span>
                        </button>
                        <button onClick={() => {
                           if (blockRecoveredUberOrderMutation('aplicar cupones')) return;
                           setShowCouponModal(true);
                        }} className="flex h-12 min-w-[58px] flex-col items-center justify-center gap-0.5 rounded-xl bg-blue-600 px-2 text-white shadow-sm shadow-blue-600/25 active:scale-95">
                           <QrCode size={18} />
                           <span className="text-[9px] font-bold uppercase">Cupón</span>
                        </button>
                        {canReceiveConsignments && (
                           <button onClick={() => {
                              setShowConsignmentModal(true);
                              setConsignmentError(null);
                           }} className="flex h-12 min-w-[58px] flex-col items-center justify-center gap-0.5 rounded-xl bg-emerald-600 px-2 text-white shadow-sm shadow-emerald-600/25 active:scale-95">
                              <Package size={18} />
                              <span className="text-[9px] font-bold uppercase">Cons.</span>
                           </button>
                        )}
                        {!hideTableExtras && (
                           <>
                              <button onClick={openParkAliasModal} className="flex h-12 min-w-[58px] flex-col items-center justify-center gap-0.5 rounded-xl bg-orange-500 px-2 text-white shadow-sm shadow-orange-500/25 active:scale-95">
                                 <Save size={18} />
                                 <span className="text-[9px] font-bold uppercase">Grd.</span>
                              </button>
                              {!activeTable && (
                                 <button onClick={() => setShowParkedList(!showParkedList)} className="relative flex h-12 min-w-[58px] flex-col items-center justify-center gap-0.5 rounded-xl bg-orange-500 px-2 text-white shadow-sm shadow-orange-500/25 active:scale-95">
                                    <Inbox size={18} />
                                    <span className="text-[9px] font-bold uppercase">Esp.</span>
                                    {(Array.isArray(parkedTickets) ? parkedTickets : []).length > 0 && <span className="absolute -top-1 -right-1 w-2 h-2 bg-orange-500 rounded-full"></span>}
                                 </button>
                              )}
                              <button onClick={openReservationModal} className="flex h-12 min-w-[58px] flex-col items-center justify-center gap-0.5 rounded-xl bg-orange-500 px-2 text-white shadow-sm shadow-orange-500/25 active:scale-95">
                                 <StickyNote size={18} />
                                 <span className="text-[9px] font-bold uppercase">Res.</span>
                              </button>
                              <button onClick={openRecoverReservationModal} className="flex h-12 min-w-[58px] flex-col items-center justify-center gap-0.5 rounded-xl bg-blue-600 px-2 text-white shadow-sm shadow-blue-600/25 active:scale-95">
                                 <QrCode size={18} />
                                 <span className="text-[9px] font-bold uppercase">Rec.</span>
                              </button>
                           </>
                        )}
                        {activeTerminalConfig?.operational?.usa_modulos_cocina && (
                           <button onClick={() => { void handleDispatchCommand(); }} className="flex h-12 min-w-[58px] flex-col items-center justify-center gap-0.5 rounded-xl bg-orange-500 px-2 text-white shadow-sm shadow-orange-500/25 active:scale-95">
                              <ChefHat size={18} />
                              <span className="text-[9px] font-bold uppercase">March.</span>
                           </button>
                        )}
                        {!hideTableExtras && (
                           <button onClick={() => onOpenInventoryTracking()} className="flex h-12 min-w-[58px] flex-col items-center justify-center gap-0.5 rounded-xl bg-emerald-600 px-2 text-white shadow-sm shadow-emerald-600/25 active:scale-95">
                              <Package size={18} />
                              <span className="text-[9px] font-bold uppercase">Rast.</span>
                           </button>
                        )}
                     </div>
                     <div className="text-right">
                        <span className="text-[10px] font-bold text-gray-400 uppercase block">Subtotal: {baseCurrency.symbol}{cartSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        {discountAmount > 0 && <span className="text-[10px] font-bold text-red-500 uppercase block">Desc: -{baseCurrency.symbol}{discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                        {loyaltyRedemptionApplied > 0 && <span className="text-[10px] font-bold text-emerald-600 uppercase block">Canje EGO: -{baseCurrency.symbol}{loyaltyRedemptionApplied.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                     </div>
                  </div>
                  <div className="flex items-center gap-4">
                     <div className="flex-1">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block leading-none mb-1">Total</span>
                        <span className="text-3xl font-black text-gray-900 tracking-tighter leading-none">{baseCurrency.symbol}{cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                     </div>
                     <button
                        onClick={async () => {
                           if (cart.length > 0 && canCheckoutWithFiscalPolicy) {
                              startCheckoutInteraction();
                              if (!await canProceedWithOperationalSession()) return;
                              proceedToCheckout();
                           }
                        }}
                        disabled={cart.length === 0 || !canCheckoutWithFiscalPolicy}
                        className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black text-lg shadow-lg shadow-blue-200 active:scale-95 transition-all flex items-center gap-2"
                     >
                        <span>{isOrderTakerMode ? 'GUARDAR PEDIDO' : isRecoveredUberOrder ? 'FACTURAR UBER' : activeRecoveredReservation ? 'COBRAR SALDO' : 'COBRAR'}</span>
                        <ArrowRight size={20} />
                     </button>
                  </div>
               </div>
            )
         }

         {/* Modals & Overlays */}
         {
            showSafetyGate && safetyAction && (
               <SafetyGateModal
                  isOpen={showSafetyGate}
                  onClose={() => setShowSafetyGate(false)}
                  onConfirm={safetyAction.callback}
                  actionName={safetyAction.name}
                  isCritical={safetyAction.isCritical}
               />
            )
         }
         {showSplitModal && (
            <SplitTicketModal
               originalItems={cart}
               currencySymbol={baseCurrency.symbol}
               onClose={() => setShowSplitModal(false)}
               onConfirm={handleSplitConfirm}
            />
         )}
         {showPaymentModal && <UnifiedPaymentModal total={amountDueNow} items={cart} taxAmount={nextPaymentFractionPart && cartTotal > 0 ? cartTax * (amountDueNow / cartTotal) : cartTax} currencySymbol={baseCurrency.symbol} config={config} onClose={() => {
            recordCheckoutDiagnostic('PAYMENT_CLOSE');
            setShowPaymentModal(false);
            if (returnToTableMapAfterPayment && onOpenTableMap) {
               setReturnToTableMapAfterPayment(false);
               onOpenTableMap();
            }
         }} onConfirm={handlePaymentConfirm} themeColor={config.themeColor} customer={effectiveSelectedCustomer} isDelinquent={isDelinquent} users={users} roles={roles} isMaster={isMaster} currentUser={currentUser} isRestaurantMode={isRestaurantMode} isInstallmentPayment={isIntermediateFractionPayment} />}
         {showLoyaltyModal && <LoyaltyScanModal onClose={() => setShowLoyaltyModal(false)} onScan={handleLoyaltyScan} />}
         {showLoyaltyRedeemModal && selectedCustomer && (
            <LoyaltyRedeemModal
               config={config}
               customer={selectedCustomer}
               ticketTotal={cartTotal}
               currencySymbol={baseCurrency.symbol}
               availablePoints={selectedCustomer.loyaltyPoints ?? currentPoints}
               onClose={() => setShowLoyaltyRedeemModal(false)}
               onRedeemed={(result) => {
                  // El saldo mostrado pasa a ser el que devolvió el ERP: no se descuenta localmente.
                  setLoyaltyRedemption({
                     id: buildRedemptionId({ customerId: selectedCustomer.id, points: result.points }),
                     customerId: selectedCustomer.id,
                     points: result.points,
                     value: result.value,
                     redeemRate: config.loyalty?.redeemRate || 0,
                     reason: result.reason,
                     balanceAfter: result.balanceAfter,
                     redeemedAt: new Date().toISOString(),
                     terminalId: activeTerminalId,
                  });
                  // El ERP es la autoridad del saldo: se refleja en la colección de
                  // clientes para que la tarjeta y el próximo canje no muestren el
                  // saldo anterior hasta el próximo sync.
                  if (typeof result.balanceAfter === 'number' && onUpdateCustomers) {
                     const balance = Math.max(0, Math.floor(result.balanceAfter));
                     onUpdateCustomers((list) => list.map(customer => (
                        customer.id === selectedCustomer.id
                           ? { ...customer, loyaltyPoints: balance }
                           : customer
                     )));
                     onSelectCustomer({ ...selectedCustomer, loyaltyPoints: balance });
                  }
                  setSuccessToast(`Canje EGO Club: ${result.points.toLocaleString('es-DO')} pts`);
               }}
            />
         )}
         {editingItem && <CartItemOptionsModal
            item={editingItem}
            config={config}
            users={users}
            salesUsers={salesUsers}
            roles={roles}
            onClose={() => setEditingItem(null)}
            onUpdate={(updatedItem, cartIdToDelete) => {
               if (!cartItemEditCapabilities.annotationOnly) {
                  void updateCartItem(updatedItem, cartIdToDelete);
                  return;
               }
               if (!updatedItem || cartIdToDelete) return;
               void updateCartItem(preserveCartItemCommercialFields(editingItem, updatedItem));
            }}
            canApplyDiscount={cartItemEditCapabilities.canApplyDiscount && !isKdsReturnedCartItem(editingItem)}
            canOverridePrice={cartItemEditCapabilities.canOverridePrice && !isKdsReturnedCartItem(editingItem)}
            canEditQuantity={cartItemEditCapabilities.canEditQuantity && !editingItem.dispatched}
            canVoidItem={cartItemEditCapabilities.canVoidItem && !editingItem.dispatched}
         />}
         {selectedProductForVariants && <ProductVariantSelector product={selectedProductForVariants} productSalesPrice={getProductPrice(selectedProductForVariants)} currencySymbol={baseCurrency.symbol} onClose={() => setSelectedProductForVariants(null)} onConfirm={(p, m, pr, selectedVariant, variantInfo) => { addToCart(p, 1, pr, m, undefined, selectedVariant, variantInfo); setSelectedProductForVariants(null); }} />}
         {productForScale && <ScaleModal product={productForScale} currencySymbol={baseCurrency.symbol} onClose={() => setProductForScale(null)} onConfirm={(w) => { addToCart(productForScale, w); setProductForScale(null); }} />}
         {
            showGlobalDiscount && <GlobalDiscountModal currentSubtotal={cartSubtotal} currencySymbol={baseCurrency.symbol} initialValue={globalDiscount.value.toString()} initialType={globalDiscount.type} themeColor={config.themeColor} onClose={() => setShowGlobalDiscount(false)} onConfirm={async (val, type) => {
               const numVal = parseFloat(val) || 0;
               const isSubtotalizedMutation = hasSubtotalizedCart;
               if (!(await authorizeSubtotalizedEdit('Modificar descuento de ticket subtotalizado'))) return;
               const authorized = await requestApproval({
                  permission: 'POS_DISCOUNT',
                  actionDescription: 'Aplicar Descuento Global',
                  context: {
                     newValue: type === 'PERCENT'
                        ? numVal
                        : (cartSubtotal > 0 ? (numVal / cartSubtotal) * 100 : 0),
                     originalValue: cartSubtotal,
                  }
               });
               if (!authorized) return;

               if (isSubtotalizedMutation) onUpdateCart(current => clearCartSubtotalization(current));
               setGlobalDiscount({ value: numVal, type });
               setShowGlobalDiscount(false);
               returnToTicketView();
            }} />
         }

         {/* Descuento acotado a una línea del ticket denso */}
         {lineDiscountCartId && (() => {
            const line = processedCart.find(item => item.cartId === lineDiscountCartId);
            if (!line) return null;
            const lineSubtotal = line.price * line.quantity;
            return (
               <GlobalDiscountModal
                  currentSubtotal={lineSubtotal}
                  currencySymbol={baseCurrency.symbol}
                  initialValue={String(line.discountRate || '')}
                  initialType="PERCENT"
                  themeColor={config.themeColor}
                  onClose={() => setLineDiscountCartId(null)}
                  onConfirm={async (val, type) => {
                     const numVal = parseFloat(val) || 0;
                     const authorized = await requestApproval({
                        permission: 'POS_DISCOUNT',
                        actionDescription: `Aplicar descuento a ${line.name}`,
                        context: {
                           newValue: type === 'PERCENT'
                              ? numVal
                              : (lineSubtotal > 0 ? (numVal / lineSubtotal) * 100 : 0),
                           originalValue: lineSubtotal,
                        }
                     });
                     if (!authorized) return;

                     const target = processedCart.find(item => item.cartId === lineDiscountCartId);
                     if (!target) {
                        setLineDiscountCartId(null);
                        return;
                     }
                     const quantity = Math.abs(target.quantity) || 1;
                     const subtotal = target.price * quantity;
                     const discountTotal = type === 'PERCENT'
                        ? subtotal * (Math.min(100, Math.max(0, numVal)) / 100)
                        : Math.min(numVal, subtotal);
                     const nextUnitPrice = Math.max(0, (subtotal - discountTotal) / quantity);

                     await updateCartItem({
                        ...target,
                        originalPrice: target.originalPrice ?? target.price,
                        price: Number(nextUnitPrice.toFixed(2)),
                        discountRate: type === 'PERCENT' ? Math.min(100, Math.max(0, numVal)) : undefined,
                        discountAmount: Number(discountTotal.toFixed(2)),
                        adjustmentSource: 'MANUAL_DISCOUNT',
                     });
                     setLineDiscountCartId(null);
                  }}
               />
            );
         })()}

         {/* Vendedor por línea */}
         {sellerPickerCartId && (() => {
            const line = processedCart.find(item => item.cartId === sellerPickerCartId);
            if (!line) return null;
            return (
               <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                  <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
                     <div className="flex items-start justify-between border-b border-[#E1E9E8] px-5 py-4">
                        <div>
                           <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#9DAEAD]">Asignar vendedor</p>
                           <p className="mt-1 text-sm font-black text-[#132124]">{line.name}</p>
                        </div>
                        <button onClick={() => setSellerPickerCartId(null)} className="rounded-lg p-1.5 text-[#9DAEAD] hover:bg-[#F4F7F6]">
                           <X size={18} />
                        </button>
                     </div>
                     <div className="max-h-[52vh] overflow-y-auto p-3">
                        {salesUsers.length === 0 && (
                           <p className="px-2 py-6 text-center text-xs font-semibold text-[#6C7F80]">
                              El ERP no ha enviado vendedores para esta caja.
                           </p>
                        )}
                        {salesUsers.map(seller => {
                           const active = line.salespersonId === seller.id;
                           return (
                              <button
                                 key={seller.id}
                                 type="button"
                                 onClick={() => void assignSellerToCartLine(line.cartId!, seller.id)}
                                 className={`mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors ${active ? 'bg-[#E7F7F6] text-[#00877F]' : 'hover:bg-[#F4F7F6] text-[#1B3034]'}`}
                              >
                                 <span className="text-sm font-bold">{seller.name}</span>
                                 {active && <CheckCircle2 size={16} />}
                              </button>
                           );
                        })}
                     </div>
                     {line.salespersonId && (
                        <div className="border-t border-[#E1E9E8] p-3">
                           <button
                              type="button"
                              onClick={() => void assignSellerToCartLine(line.cartId!, null)}
                              className="w-full rounded-xl border border-[#F2DCD8] bg-[#FEF6F5] px-3 py-2 text-xs font-bold uppercase tracking-wide text-[#C0392B]"
                           >
                              Quitar vendedor
                           </button>
                        </div>
                     )}
                  </div>
               </div>
            );
         })()}

         <SupervisorModal {...supervisorModalProps} users={users} />

         {
            showConsignmentModal && (
               <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                  <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in-95 duration-200">
                     <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                        <div className="flex items-center gap-3">
                           <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                              <Package size={20} />
                           </div>
                           <div>
                              <h3 className="text-lg font-black text-gray-800">Consignaciones ERP</h3>
                              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">Búsqueda on-demand</p>
                           </div>
                        </div>
                        <button onClick={() => setShowConsignmentModal(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
                           <X size={20} />
                        </button>
                     </div>

                     <div className="border-b border-gray-100 p-4">
                        <div className="flex flex-col gap-2 sm:flex-row">
                           <div className="relative flex-1">
                              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                              <input
                                 value={consignmentSearchTerm}
                                 onChange={(e) => setConsignmentSearchTerm(e.target.value)}
                                 onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                       e.preventDefault();
                                       handleSearchConsignments();
                                    }
                                 }}
                                 placeholder="Documento, cliente, producto..."
                                 className="w-full rounded-xl bg-gray-100 py-3 pl-10 pr-3 text-sm font-bold outline-none transition-all focus:bg-white focus:ring-2 focus:ring-cyan-500"
                              />
                           </div>
                           <button
                              type="button"
                              onClick={handleSearchConsignments}
                              disabled={isSearchingConsignments}
                              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-700 px-5 py-3 text-sm font-black text-white shadow-sm transition-all hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-60"
                           >
                              {isSearchingConsignments ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                              Buscar
                           </button>
                        </div>
                        {consignmentError && (
                           <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                              {consignmentError}
                           </div>
                        )}
                     </div>

                     <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)]">
                        <div className="min-h-0 overflow-y-auto border-r border-gray-100 bg-gray-50 p-3">
                           {consignmentResults.length === 0 ? (
                              <div className="flex h-full min-h-[180px] items-center justify-center text-center text-xs font-bold uppercase tracking-widest text-gray-400">
                                 Busca una consignación
                              </div>
                           ) : (
                              <div className="space-y-2">
                                 {consignmentResults.map((consignment) => {
                                    const isSelected = selectedConsignment?.id === consignment.id;
                                    return (
                                       <button
                                          key={String(consignment.id)}
                                          type="button"
                                          onClick={() => handleOpenConsignment(consignment)}
                                          className={`w-full rounded-xl border p-3 text-left transition-all ${isSelected ? 'border-cyan-200 bg-white shadow-sm ring-2 ring-cyan-50' : 'border-gray-100 bg-white hover:border-cyan-100'}`}
                                       >
                                          <p className="truncate text-sm font-black text-gray-800">{getConsignmentDocumentNo(consignment) || consignment.id}</p>
                                          <p className="mt-1 truncate text-[11px] font-bold text-gray-500">{getConsignmentCustomerName(consignment) || 'Cliente no especificado'}</p>
                                          {consignment.status && (
                                             <span className="mt-2 inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-gray-500">
                                                {consignment.status}
                                             </span>
                                          )}
                                       </button>
                                    );
                                 })}
                              </div>
                           )}
                        </div>

                        <div className="min-h-0 overflow-y-auto p-4">
                           {isLoadingConsignment ? (
                              <div className="flex h-full min-h-[240px] items-center justify-center gap-2 text-sm font-black text-cyan-700">
                                 <RefreshCw size={18} className="animate-spin" />
                                 Cargando consignación
                              </div>
                           ) : selectedConsignment ? (
                              <div className="space-y-4">
                                 <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                       <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-600">Documento</p>
                                       <h4 className="text-xl font-black text-gray-900">{getConsignmentDocumentNo(selectedConsignment)}</h4>
                                       <p className="text-sm font-bold text-gray-500">{getConsignmentCustomerName(selectedConsignment) || 'Cliente no especificado'}</p>
                                    </div>
                                    <button
                                       type="button"
                                       onClick={() => handleAddAllConsignmentLines(selectedConsignment)}
                                       className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-black text-white transition-all hover:bg-gray-800"
                                    >
                                       <PlusCircle size={17} />
                                       Agregar todo
                                    </button>
                                 </div>

                                 <div className="overflow-hidden rounded-xl border border-gray-100">
                                    {getConsignmentLines(selectedConsignment).map((line) => {
                                       const product = consignmentSyncService.findMatchingProduct(line, products);
                                       const quantity = getConsignmentLineQuantity(line);
                                       const price = getConsignmentLinePrice(line, product ? getProductPrice(product) : 0);
                                       return (
                                          <div key={String(line.id)} className="flex flex-col gap-3 border-b border-gray-100 p-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                                             <div className="min-w-0">
                                                <p className="truncate text-sm font-black text-gray-800">{getConsignmentLineProductName(line)}</p>
                                                <p className="text-[11px] font-bold text-gray-500">
                                                   {quantity} x {baseCurrency.symbol}{price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </p>
                                                <p className={`mt-1 text-[10px] font-black uppercase tracking-wide ${product ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                   {product ? `Vinculado: ${product.name}` : 'Requiere actualización de catálogo'}
                                                </p>
                                             </div>
                                             <button
                                                type="button"
                                                onClick={() => handleAddConsignmentLine(selectedConsignment, line)}
                                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-100 bg-cyan-50 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-cyan-700 transition-all hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                                             >
                                                <Plus size={14} />
                                                Agregar
                                             </button>
                                          </div>
                                       );
                                    })}
                                 </div>
                              </div>
                           ) : (
                              <div className="flex h-full min-h-[240px] items-center justify-center text-center text-xs font-bold uppercase tracking-widest text-gray-400">
                                 Selecciona una consignación
                              </div>
                           )}
                        </div>
                     </div>
                  </div>
               </div>
            )
         }

         {
            showCouponModal && (
               <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                     <div className="p-6">
                        <div className="flex justify-between items-center mb-6">
                           <h3 className="text-xl font-black text-gray-800 flex items-center gap-2">
                              <QrCode className="text-blue-600" />
                              Canjear Cupón
                           </h3>
                           <button onClick={() => setShowCouponModal(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
                              <X size={20} />
                           </button>
                        </div>

                        <div className="space-y-4">
                           <div>
                              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Código del Cupón</label>
                              <input
                                 autoFocus
                                 type="text"
                                 value={couponCode}
                                 onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                                 className="w-full text-center text-2xl font-black tracking-widest p-4 bg-gray-50 border-2 border-gray-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition-all uppercase placeholder-gray-300"
                                 placeholder="XXXX-XXXX"
                                 onKeyDown={(e) => e.key === 'Enter' && handleRedeemCoupon()}
                              />
                           </div>

                           <button
                              onClick={handleRedeemCoupon}
                              className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold text-lg shadow-lg hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center gap-2"
                           >
                              <Check size={20} />
                              Validar y Aplicar
                           </button>

                           {isMobile && (
                              <button
                                 type="button"
                                 onClick={() => setIsScannerOpen(true)}
                                 className="w-full py-3.5 border-2 border-blue-100 bg-blue-50 text-blue-700 rounded-xl font-bold transition-all hover:bg-blue-100 active:scale-95 flex items-center justify-center gap-2"
                              >
                                 <ScanBarcode size={20} />
                                 Escanear QR
                              </button>
                           )}
                        </div>
                     </div>
                  </div>
               </div>
            )
         }

         {
            showReservationModal && (
               <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="bg-white rounded-[2rem] w-full max-w-lg shadow-2xl overflow-hidden">
                     <div className="p-6 border-b bg-amber-50 flex justify-between items-center">
                        <h3 className="font-black text-xl text-amber-900 flex items-center gap-2">
                           <StickyNote size={20} />
                           {isEditingRecoveredReservation ? 'Actualizar Reserva' : 'Reserva / Hold'}
                        </h3>
                        <button onClick={() => setShowReservationModal(false)} className="p-2 hover:bg-amber-100 rounded-full text-amber-700">
                           <X size={18} />
                        </button>
                     </div>
                     <div className="p-6 space-y-4">
                        {isEditingRecoveredReservation && activeRecoveredReservation && (
                           <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs font-bold">
                              Editando {activeRecoveredReservation.code}. Se guardará con la misma referencia y QR.
                           </div>
                        )}

                        <div>
                           <label className="block text-[11px] font-black text-gray-500 uppercase tracking-widest mb-2">Cliente (Obligatorio)</label>
                           <select
                              value={reservationCustomerId}
                              onChange={(e) => setReservationCustomerId(e.target.value)}
                              className="w-full p-3 rounded-xl border border-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-amber-100"
                           >
                              <option value="">Seleccionar Cliente</option>
                              {(customers || []).map(c => (
                                 <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                           </select>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                           <div>
                              <label className="block text-[11px] font-black text-gray-500 uppercase tracking-widest mb-2">Monto de Abono</label>
                              <input
                                 type="number"
                                 min={0}
                                 step="0.01"
                                 value={reservationAdvanceInput}
                                 onChange={(e) => setReservationAdvanceInput(e.target.value)}
                                 className="w-full p-3 rounded-xl border border-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-amber-100"
                              />
                           </div>
                           <div>
                              <label className="block text-[11px] font-black text-gray-500 uppercase tracking-widest mb-2">Fecha de Entrega</label>
                              <input
                                 type="date"
                                 value={reservationDeliveryDate}
                                 onChange={(e) => setReservationDeliveryDate(e.target.value)}
                                 className="w-full p-3 rounded-xl border border-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-amber-100"
                              />
                           </div>
                        </div>

                        <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs">
                           Vigencia: {reservationPolicy.validityDays} día(s)
                           {reservationPolicy.requireAdvance && (
                              <span> • Anticipo mínimo: {reservationPolicy.minimumAdvancePercent}%</span>
                           )}
                        </div>

                        <div className="p-4 rounded-xl border border-gray-100 bg-gray-50 text-sm">
                           <div className="flex justify-between font-bold text-gray-600">
                              <span>Total Reserva</span>
                              <span>{baseCurrency.symbol}{cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                           </div>
                           <div className="flex justify-between text-gray-500 mt-1">
                              <span>Saldo estimado</span>
                              <span>{baseCurrency.symbol}{Math.max(0, cartTotal - (parseFloat(reservationAdvanceInput || '0') || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                           </div>
                        </div>
                     </div>
                     <div className="px-6 pb-6 flex justify-end gap-3">
                        <button onClick={() => setShowReservationModal(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 font-bold hover:bg-gray-50">
                           Cancelar
                        </button>
                        <button onClick={handleCreateReservation} className="px-5 py-2.5 rounded-xl bg-amber-600 text-white font-black hover:bg-amber-700 transition-all">
                           {isEditingRecoveredReservation ? 'Actualizar Reserva' : 'Guardar Reserva'}
                        </button>
                     </div>
                  </div>
               </div>
            )
         }

         {
            showRecoverReservationModal && (
               <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="bg-white rounded-[2rem] w-full max-w-2xl shadow-2xl overflow-hidden">
                     <div className="p-6 border-b bg-teal-50 flex justify-between items-center">
                        <h3 className="font-black text-xl text-teal-900 flex items-center gap-2">
                           <QrCode size={20} />
                           Reservas y Pedidos
                        </h3>
                        <button onClick={closeRecoverReservationModal} className="p-2 hover:bg-teal-100 rounded-full text-teal-700">
                           <X size={18} />
                        </button>
                     </div>
                     <div className="p-6 space-y-4">
                        <div className="flex gap-2">
                           <div className="flex-1 relative">
                              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                              <input
                                 type="text"
                                 value={reservationSearchTerm}
                                 onChange={(e) => setReservationSearchTerm(e.target.value)}
                                 placeholder="Buscar por cliente, código, display o ID..."
                                 className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-teal-100"
                              />
                           </div>
                           <button
                              onClick={() => loadUberPendingOrders().catch(console.error)}
                              className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-bold hover:bg-slate-50"
                           >
                              Actualizar
                           </button>
                           <button
                              onClick={() => {
                                 if (isMobile) {
                                    closeRecoverReservationModal();
                                    setIsScannerOpen(true);
                                    return;
                                 }

                                 setSuccessToast('Escanee la reserva con el lector QR del equipo.');
                                 setTimeout(() => setSuccessToast(null), 2200);
                              }}
                              className="px-4 py-2.5 rounded-xl border border-teal-200 bg-teal-50 text-teal-700 font-bold hover:bg-teal-100"
                           >
                              {isMobile ? 'Escanear QR' : 'Leer con Lector'}
                           </button>
                        </div>

                        {!isMobile && (
                           <div className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2.5">
                              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-sky-600">
                                 Desktop
                              </p>
                              <p className="mt-1 text-xs font-semibold text-sky-900">
                                 El lector QR funciona como teclado. No hace falta abrir la cámara para recuperar reservas o pedidos Uber Eats.
                              </p>
                           </div>
                        )}

                        {reservationCustomerFilterId && (
                           <div className="flex items-center justify-between rounded-xl border border-teal-100 bg-teal-50 px-3 py-2">
                              <p className="text-xs font-bold text-teal-800">
                                 Mostrando reservas activas de {reservationFilterCustomerName}
                              </p>
                              <button
                                 onClick={openRecoverReservationModal}
                                 className="text-[11px] font-black uppercase text-teal-700 hover:text-teal-900"
                              >
                                 Ver todas
                              </button>
                           </div>
                        )}

                        {!reservationCustomerFilterId && (
                           <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                                 Uber Eats
                              </span>
                              <span className="rounded-full bg-black px-2 py-0.5 text-[10px] font-black text-white">
                                 {uberPendingOrders.length}
                              </span>
                              {isLoadingUberPendingOrders && (
                                 <span className="text-[11px] font-bold text-slate-500">Cargando pedidos...</span>
                              )}
                              {!isLoadingUberPendingOrders && uberPendingOrdersError && (
                                 <span className="text-[11px] font-bold text-red-500">{uberPendingOrdersError}</span>
                              )}
                           </div>
                        )}

                        <div className="max-h-[45vh] overflow-y-auto space-y-2">
                           {recoverableOrders.map((entry) => {
                              if (entry.kind === 'UBER_EATS') {
                                 const order = entry.order;
                                 const existingTransaction = findUberTransactionByOrderId(order.uberOrderId);

                                 return (
                                    <button
                                       key={order.id || order.uberOrderId}
                                       onClick={() => { void handleRecoverUberOrder(order); }}
                                       className="w-full text-left p-4 rounded-xl border border-gray-100 hover:border-slate-900 hover:bg-slate-50 transition-all"
                                    >
                                       <div className="flex justify-between items-start gap-2">
                                          <div>
                                             <div className="flex items-center gap-2">
                                                <span className="inline-flex items-center rounded-full bg-black px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                                                   Uber Eats
                                                </span>
                                                <span className="text-[11px] font-black text-slate-500">{order.displayId || order.uberOrderId}</span>
                                             </div>
                                             <p className="mt-2 font-black text-gray-800">{order.customerName || 'Cliente Uber Eats'}</p>
                                             <p className="text-[11px] font-bold text-gray-500 mt-0.5">
                                                Estado: {order.status} • POS: {order.posSyncStatus}
                                             </p>
                                          </div>
                                          <div className="text-right">
                                             <p className="text-xs font-black text-gray-800">{baseCurrency.symbol}{order.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                             <p className="text-[11px] text-gray-500">{order.itemCount} artículo(s)</p>
                                          </div>
                                       </div>
                                       <p className="text-[11px] text-gray-500 mt-2">
                                          {existingTransaction
                                             ? `Factura local detectada: ${existingTransaction.displayId || existingTransaction.id}. Toque para reconfirmar ERP.`
                                             : 'Toque para cargar el pedido y convertirlo en factura local POS.'}
                                       </p>
                                    </button>
                                 );
                              }

                              const reservation = entry.reservation;
                              return (
                                 <button
                                    key={reservation.id}
                                    onClick={() => handleRecoverReservation(reservation)}
                                    className="w-full text-left p-4 rounded-xl border border-gray-100 hover:border-teal-300 hover:bg-teal-50 transition-all"
                                 >
                                    <div className="flex justify-between items-start gap-2">
                                       <div>
                                          <p className="font-black text-gray-800">{reservation.customerName}</p>
                                          <p className="text-[11px] font-bold text-gray-500 mt-0.5">{reservation.code}</p>
                                       </div>
                                       <div className="text-right">
                                          <p className="text-xs font-black text-gray-800">{baseCurrency.symbol}{reservation.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                          <p className="text-[11px] text-gray-500">Abono: {baseCurrency.symbol}{(reservation.balancePaid || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                       </div>
                                    </div>
                                    <p className="text-[11px] text-gray-500 mt-2">
                                       Vence: {new Date(reservation.expiryDate).toLocaleDateString()} {reservation.deliveryDate ? `• Entrega: ${new Date(reservation.deliveryDate).toLocaleDateString()}` : ''}
                                    </p>
                                 </button>
                              );
                           })}
                           {recoverableOrders.length === 0 && (
                              <div className="p-8 rounded-xl border border-dashed border-gray-200 text-center text-sm text-gray-400">
                                 No hay reservas ni pedidos Uber Eats pendientes para mostrar.
                              </div>
                           )}
                        </div>
                     </div>
                  </div>
               </div>
            )
         }

         {
            showReservationReceipt && (
               <div className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden">
                     <div className="p-6 border-b bg-slate-50">
                        <h3 className="font-black text-xl text-slate-800">Nota de Reserva</h3>
                        <p className="text-xs text-slate-500 mt-1">Documento no fiscal generado correctamente.</p>
                     </div>
                     <div className="p-6 space-y-4">
                        <div className="text-center">
                           <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(showReservationReceipt.qrPayload)}`}
                              alt="QR Reserva"
                              className="mx-auto w-40 h-40 rounded-xl border border-gray-200"
                           />
                           <p className="text-[11px] text-gray-500 font-mono mt-2">{showReservationReceipt.code}</p>
                        </div>
                        <div className="p-4 rounded-xl border border-gray-100 bg-gray-50 text-sm">
                           <div className="flex justify-between"><span className="text-gray-500">Cliente</span><span className="font-bold text-gray-800">{showReservationReceipt.customerName}</span></div>
                           <div className="flex justify-between mt-1"><span className="text-gray-500">Total</span><span className="font-bold text-gray-800">{baseCurrency.symbol}{showReservationReceipt.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                           <div className="flex justify-between mt-1"><span className="text-gray-500">Abono</span><span className="font-bold text-gray-800">{baseCurrency.symbol}{(showReservationReceipt.balancePaid || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                           <div className="flex justify-between mt-1"><span className="text-gray-500">Vence</span><span className="font-bold text-gray-800">{new Date(showReservationReceipt.expiryDate).toLocaleDateString()}</span></div>
                        </div>
                     </div>
                     <div className="px-6 pb-6 flex justify-between items-center gap-3">
                        <button
                           onClick={async () => {
                              if (isPrintingReservationReceipt) return;
                              setIsPrintingReservationReceipt(true);
                              try {
                                 const printed = await printReservation(
                                    showReservationReceipt,
                                    config,
                                    Math.max(1, Math.floor(Number(reservationPolicy.printCopies || 1)))
                                 );
                                 if (printed) {
                                    setSuccessToast(`Reserva ${showReservationReceipt.code} enviada a impresión`);
                                 } else {
                                    setErrorToast('No se pudo imprimir la nota de reserva. Verifica la impresora configurada.');
                                    setTimeout(() => setErrorToast(null), 3500);
                                 }
                              } catch (error) {
                                 console.error('Reservation print failed:', error);
                                 setErrorToast('Error al imprimir la nota de reserva.');
                                 setTimeout(() => setErrorToast(null), 3500);
                              } finally {
                                 setIsPrintingReservationReceipt(false);
                              }
                           }}
                           disabled={isPrintingReservationReceipt}
                           className="flex-1 px-5 py-2.5 rounded-xl bg-blue-600 text-white font-black hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-100"
                        >
                           <Printer size={18} /> {isPrintingReservationReceipt ? 'Imprimiendo...' : 'Imprimir'}
                        </button>
                        <button
                           onClick={() => setShowReservationReceipt(null)}
                           className="flex-1 px-5 py-2.5 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition-all"
                        >
                           Cerrar
                        </button>
                     </div>
                  </div>
               </div>
            )
         }

         {/* Save Parked Ticket Alias */}
         {showParkAliasModal && (
            <div className="fixed inset-0 z-[101] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in zoom-in-95">
               <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95">
                  <div className="p-6 border-b bg-gray-50 flex justify-between items-center">
                     <div>
                        <h3 className="font-black text-xl text-gray-800">{activeTable ? 'Nombre temporal de mesa' : 'Guardar En Espera'}</h3>
                        <p className="text-sm text-gray-500 mt-1">{activeTable ? 'Agrega o modifica el nombre visible mientras esta mesa tenga una cuenta activa.' : 'Agrega un alias para ubicar esta factura más rápido.'}</p>
                     </div>
                     <button onClick={closeParkAliasModal} className="p-2 hover:bg-gray-200 rounded-full">
                        <X size={20} />
                     </button>
                  </div>
                  <div className="p-6 space-y-4">
                     <div>
                        <label htmlFor="park-ticket-alias" className="block text-sm font-bold text-gray-700 mb-2">
                           {activeTable ? 'Nombre temporal' : 'Alias de la factura'}
                        </label>
                        <input
                           id="park-ticket-alias"
                           ref={parkAliasInputRef}
                           value={parkTicketAlias}
                           onChange={(e) => setParkTicketAlias(e.target.value)}
                           onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                 void handleParkCurrentTicket(parkTicketAlias);
                              }
                           }}
                           placeholder={activeTable ? 'Ej. Cumpleaños Ana, Terraza VIP' : 'Ej. Cliente VIP, Pedido oficina, Recoger luego'}
                           maxLength={80}
                           className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-base font-medium text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                     </div>
                     <div className="rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-500 mb-1">Nombre Base</p>
                        <p className="text-sm font-semibold text-blue-900">{buildParkedTicketName()}</p>
                     </div>
                  </div>
                  <div className="p-6 pt-0 flex gap-3">
                     <button
                        onClick={closeParkAliasModal}
                        className="flex-1 rounded-2xl border border-gray-200 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-gray-500 hover:bg-gray-50 transition-colors"
                     >
                        Cancelar
                     </button>
                     <button
                        onClick={() => void handleParkCurrentTicket(parkTicketAlias)}
                        className="flex-1 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-white hover:bg-blue-700 transition-colors"
                     >
                        {activeTable ? 'Actualizar mesa' : 'Guardar En Espera'}
                     </button>
                  </div>
               </div>
            </div>
         )}

         {/* List of Parked Tickets */}
         {
            showParkedList && !activeTable && (
               <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in zoom-in-95">
                  <div className="bg-white rounded-[2.5rem] w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95">
                     <div className="p-6 border-b bg-gray-50 flex justify-between items-center">
                        <h3 className="font-black text-xl text-gray-800">Tickets en Espera</h3>
                        <button onClick={() => setShowParkedList(false)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} /></button>
                     </div>
                     <div className="p-4 overflow-y-auto max-h-[60vh] space-y-3">
                        {(Array.isArray(parkedTickets) ? parkedTickets : []).map((pt, idx) => (
                           <div key={pt.id || `parked-${idx}`} onClick={() => handleRestoreTicket(pt)} className="p-4 bg-white border border-gray-100 rounded-2xl hover:border-orange-400 hover:bg-orange-50 cursor-pointer group transition-all">
                              <div className="flex justify-between items-start mb-2">
                                 <div className="min-w-0 pr-3">
                                    <span className="block font-bold text-gray-800 truncate">{pt.alias || pt.name}</span>
                                    {pt.alias && (
                                       <span className="block text-[11px] font-semibold text-gray-400 truncate mt-1">
                                          {pt.name}
                                       </span>
                                    )}
                                 </div>
                                 <span className="text-[10px] font-bold text-gray-400 uppercase">{new Date(pt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              <div className="flex justify-between items-center">
                                 <div className="min-w-0 pr-3">
                                    <span className="text-xs text-gray-500 block">{pt.items.length} productos</span>
                                    <span className="text-sm font-black text-gray-900 block mt-1">
                                       {formatCurrency(Number(pt.total || 0), baseCurrency.symbol)}
                                    </span>
                                 </div>
                                 <ArrowRight size={16} className="text-orange-300 group-hover:text-orange-500 transition-colors shrink-0" />
                              </div>
                           </div>
                        ))}
                        {(Array.isArray(parkedTickets) ? parkedTickets : []).length === 0 && <div className="py-10 text-center text-gray-400 italic">No hay tickets guardados</div>}
                     </div>
                  </div>
               </div>
            )
         }
         {productForModifiers && (
            <ModifierModal
               product={productForModifiers}
               currencySymbol={baseCurrency.symbol}
               themeColor="blue"
               onClose={() => setProductForModifiers(null)}
               onConfirm={(selectedModifierNames, finalPrice, note, restaurantConfig) => {
                  addToCart(productForModifiers, isReturnMode ? -1 : 1, finalPrice, selectedModifierNames, undefined, undefined, undefined, note, restaurantConfig as CartItem['restaurantConfig']);
                  setProductForModifiers(null);
               }}
            />
         )}

         <PromoBottomSheet
            isOpen={showPromoSheet}
            onClose={() => setShowPromoSheet(false)}
            product={selectedPromoProduct}
            onAddToCart={(p) => handleProductClick(p)}
            config={config}
         />

         <BarcodeScannerModal
            isOpen={isScannerOpen}
            onClose={() => setIsScannerOpen(false)}
            onScan={async (code) => {
               const trace = beginPosInteraction('BARCODE_SCAN', { source: 'camera' });
               expectInteractionRender(trace, 'POS_INTERACTION_VIEW');
               try {
               // 0. Try Smart QR (JSON)
               const trimmed = code.trim();
               if (routeScannedCoupon(trimmed)) {
                  return { success: true, message: 'Cupón leído. Valide para aplicarlo.' };
               }

               try {
                  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                     const data = JSON.parse(trimmed);
                     if (data.type === 'RESERVATION_NOTE' && (data.id || data.code)) {
                        const found = (reservations || []).find(r => r.id === data.id || r.code === data.code);
                        if (found) {
                           handleRecoverReservation(found);
                           setIsScannerOpen(false);
                           return { success: true, message: 'Reserva Recuperada' };
                        }
                     }
                     if (data.type === 'INVOICE_RETURN' && data.id) {
                        setReturnInvoiceId(data.id);
                        setShowReturnModal(true);
                        setIsScannerOpen(false);
                        return { success: true, message: 'Factura Identificada' };
                     }
                  }
               } catch (e) {
                  // Not a JSON or invalid
               }

               // 0.1 Try Transaction Search (Direct bypass for TCK... barcodes)
               const txnFound = (transactions || []).find(t => t.displayId === trimmed || t.id === trimmed);
               if (txnFound) {
                  setReturnInvoiceId(txnFound.id);
                  setShowReturnModal(true);
                  setIsScannerOpen(false);
                  return { success: true, message: 'Factura Identificada' };
               }

               // 1. Try Scale Parser
               if (config.scaleLabelConfig?.isEnabled) {
                  const scaleItem = parseScaleBarcode(code, config.scaleLabelConfig);
                  if (scaleItem) {
                     const product = (products || []).find(p => p.barcode === scaleItem.plu || p.id === scaleItem.plu);
                     if (product) {
                        if (!canAddItemToCart(product)) return { success: false, message: 'No disponible en almacén' };

                        if (scaleItem.type === 'WEIGHT') {
                           addToCart(product, scaleItem.value);
                           return { success: true, message: `${product.name} (${scaleItem.value.toFixed(3)}kg)` };
                        } else {
                           const unitPrice = getProductPrice(product);
                           const weight = unitPrice > 0 ? scaleItem.value / unitPrice : 1;
                           addToCart(product, weight);
                           return { success: true, message: `${product.name} ($${scaleItem.value})` };
                        }
                     }
                  }
               }

               // 2. Normal Search
               const product = (products || []).find(p => p.barcode === code);
               if (product) {
                  if (!canAddItemToCart(product)) return { success: false, message: 'No disponible en almacén' };

                  // Direct add for speed
                  addToCart(product);
                  return { success: true, message: `${product.name} Agregado` };
               }

               return { success: false, message: 'Producto no encontrado' };
               } finally {
                  markInteractionStage(trace, 'HANDLER_END');
               }
            }}
         />
         {
            quickActionData && (
               <ProductQuickActions
                  product={quickActionData.product}
                  position={{ x: quickActionData.x, y: quickActionData.y }}
                  onClose={() => setQuickActionData(null)}
                  onUpdateProduct={(updatedProduct) => {
                     setSuccessToast(`Producto ${updatedProduct.name} actualizado`);
                  }}
                  onAdvancedEdit={(p) => {
                     setQuickActionData(null);
                     onOpenSettings('CATALOG', { productId: p.id, tab: 'OPERATIVE' });
                  }}
                  onViewHistory={(p) => {
                     setQuickActionData(null);
                     // Conditional Navigation logic:
                     // 1. If product is Serialized or Lotted -> Go to Specific Tracking View
                     // 2. If standard product -> Go to Kardex Tab in Catalog
                     if (p.operationalFlags?.usesSerial || p.operationalFlags?.usesLots) {
                        onOpenInventoryTracking(p.id);
                     } else {
                        onOpenSettings('CATALOG', { productId: p.id, tab: 'KARDEX' });
                     }
                  }}
                  warehouses={warehouses}
                  config={config}
                  currentUser={currentUser}
                  roles={roles}
               />
            )
         }

         {
            incomingUberToast && (
               <div className="fixed top-6 right-6 z-[210] animate-in slide-in-from-top-4">
                  <button
                     onClick={openRecoverReservationModal}
                     className="max-w-sm rounded-[1.6rem] border border-black bg-white px-5 py-4 text-left shadow-2xl transition-all hover:-translate-y-0.5 hover:shadow-black/20"
                  >
                     <div className="flex items-start gap-3">
                        <div className="rounded-2xl bg-black p-2 text-white">
                           <ShoppingBag size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                           <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Uber Eats</p>
                           <p className="mt-1 text-sm font-black text-slate-900">
                              {incomingUberToast.count === 1 ? 'Nuevo pedido listo para POS' : `${incomingUberToast.count} pedidos nuevos listos para POS`}
                           </p>
                           <p className="mt-1 text-xs font-semibold text-slate-500">
                              {incomingUberToast.displayIds.join(' • ')}
                           </p>
                           <p className="mt-2 text-[11px] font-black uppercase tracking-[0.18em] text-blue-600">
                              Tocar para abrir pedidos
                           </p>
                        </div>
                     </div>
                  </button>
               </div>
            )
         }

         {
            successToast && (
               <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-5">
                  <div className="bg-emerald-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 font-bold border border-emerald-500">
                     <Check size={20} />
                     <span>{successToast}</span>
                  </div>
               </div>
            )
         }

         {
            pendingTrackingProduct && (
               <TrackingSelectionModal
                  product={pendingTrackingProduct.product}
                  warehouseId={defaultSalesWarehouseId || 'wh_central'}
                  quantity={pendingTrackingProduct.quantity}
                  onClose={() => setPendingTrackingProduct(null)}
                  onSelect={(tracking) => {
                     addToCart(
                        pendingTrackingProduct.product,
                        pendingTrackingProduct.quantity,
                        pendingTrackingProduct.price,
                        pendingTrackingProduct.modifiers,
                        tracking
                     );
                     setPendingTrackingProduct(null);
                  }}
               />
            )
         }
      </div>
   );
};

export default POSInterface;
