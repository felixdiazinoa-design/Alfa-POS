import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import {
   Search, ShoppingCart, Trash2, MoreVertical,
   CreditCard, User, Tag, Grid, Save,
   Settings, Users, History, Wallet,
   UserPlus, PlusCircle, X, Percent, ArrowLeft, ChevronRight,
   Scale as ScaleIcon, PauseCircle, LogOut, Minus, Plus, Edit3,
   ArrowRightLeft, Globe, DollarSign,
   ChevronDown, Check, AlertCircle, Layers,
   ShoppingBag, ScanBarcode, ArrowRight, Clock, Camera, AlertTriangle,
   MessageSquare, PlayCircle, Download, Lock, ArrowUpRight, Landmark,
   UserCheck, StickyNote, Inbox, Printer, QrCode, Box, Package,
   Cloud, RefreshCw, CloudOff, Layout, ChefHat, Building2, ClipboardCheck


} from 'lucide-react';
import { Html5Qrcode } from "html5-qrcode";
import {
   BusinessConfig, User as UserType, RoleDefinition,
   Customer, Product, CartItem, Transaction, ParkedTicket, Warehouse, NCFType,
   PaymentEntry, Table, Reservation, ZReport, Room
} from '../types';
import { hasProductPromotion } from '../utils/promotionEngine';
import UnifiedPaymentModal from './PaymentModal';
import TicketOptionsModal from './TicketOptionsModal';
import CartItemOptionsModal from './CartItemOptionsModal';
import ProductVariantSelector from './ProductVariantSelector';
import ScaleModal from './ScaleModal';
import GlobalDiscountModal from './GlobalDiscountModal';
import LoyaltyScanModal from './LoyaltyScanModal';
import TrackingSelectionModal from './TrackingSelectionModal';
import { db } from '../utils/db';
import { validateTerminalDocument, validateWarehouseAccess } from '../utils/validation';
import { isSessionExpired } from '../utils/session';
import { FiscalRangeDGII } from '../types';
import { parseScaleBarcode } from '../utils/barcodeParser';
import { transactionService } from '../services/transactionService';
import { validateTerminalSeries } from '../utils/seriesValidation';
import { applyPromotions } from '../utils/promotionEngine';
import { calculatePointsEarned, getPrimaryLoyaltyCard } from '../utils/loyaltyEngine';
import { couponService } from '../utils/couponService';
import { transferStockToCommitted } from '../utils/inventoryEngine';
import { useSupervisorAuth } from '../hooks/useSupervisorAuth';
import SupervisorModal from './SupervisorModal';
import { useIsMobile } from '../hooks/useIsMobile';
import { useBottomSafeOffset } from '../hooks/useBottomSafeOffset';
import MobileConfigModal from './MobileConfigModal';
import ReturnModal from './ReturnModal';
import PromoBottomSheet from './PromoBottomSheet';
import { backgroundSyncManager, SyncState } from '../services/sync/BackgroundSyncManager';
import ProductTableSupermarket from './ProductTableSupermarket';
import BarcodeScannerModal from './BarcodeScannerModal';
import { visorSync } from '../utils/visorSync';
import ProductQuickActions from './ProductQuickActions';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import ActionGrid from './ActionGrid';
import SupervisorAuthModal from './SupervisorAuthModal';
import VirtualKeyboard from './VirtualKeyboard';
import SafetyGateModal from './SafetyGateModal';
import { printReservation } from '../utils/printer';
import MobileCartButton from './MobileCartButton';
import { persistStandaloneRefundTransaction, persistStandaloneSaleHistory } from '../services/localRefundPersistence';

// ... existing imports

interface POSInterfaceProps {
   config: BusinessConfig;
   currentUser: UserType;
   roles: RoleDefinition[];
   users: UserType[];
   customers: Customer[];
   products: Product[];
   warehouses: Warehouse[];
   cart: CartItem[];
   transactions: Transaction[];
   zReports: ZReport[];
   onUpdateCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
   selectedCustomer: Customer | null;
   onSelectCustomer: (customer: Customer | null) => void;
   parkedTickets: ParkedTicket[];
   onUpdateParkedTickets: (tickets: ParkedTicket[]) => void;
   onLogout: () => void;
   onOpenSettings: (initialView?: string, initialData?: any) => void;
   onOpenCustomers: () => void;
   onOpenHistory: () => void;
   onOpenFinance: () => void;
   onOpenInventoryTracking: (productId?: string) => void;
   onOpenAudit?: () => void;
   onOpenTableMap?: () => void;
   onOpenAgenda?: () => void;
   onTransactionComplete: (txn: Transaction) => void;
   onAddCustomer: (customer: Customer) => void;
   onUpdateConfig: (newConfig: BusinessConfig) => void;
   activeTerminalId: string;
   activeTable?: Table | null;
   onClearActiveTable?: () => void;
   onKioskPay?: () => void;
   internalSequences?: any[];
   rooms?: Room[];
}

const buildCartDigest = (items: CartItem[] = []): string =>
   items
      .map((item) =>
         [
            item.cartId || item.id || '',
            Number(item.quantity || 0),
            Number(item.price || 0),
            (item.modifiers || []).join('|')
         ].join(':')
      )
      .join('||');

const POSInterface: React.FC<POSInterfaceProps> = ({
   config,
   currentUser,
   products,
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
   onOpenSettings,
   onOpenCustomers,
   onOpenHistory,
   onOpenFinance,
   onOpenInventoryTracking,
   onOpenAudit,
   onOpenTableMap,
   onOpenAgenda,
   onTransactionComplete,
   onAddCustomer,
   onUpdateConfig,
   activeTerminalId,
   activeTable,
   onClearActiveTable,
   onKioskPay,
   internalSequences,
   rooms = []
}) => {
   const cartEndRef = useRef<HTMLDivElement>(null);
   const posRootRef = useRef<HTMLDivElement>(null);
   const mobileFooterRef = useRef<HTMLDivElement>(null);
   const mobileCartButtonRef = useRef<HTMLButtonElement>(null);
   const ticketAutoSyncTimeoutRef = useRef<number | null>(null);
   const isMaster = useMemo(() => {
      const terminal = config.terminals?.find(t => t.id === activeTerminalId);
      return terminal?.config?.isPrimaryNode === true;
   }, [config.terminals, activeTerminalId]);
   const [quickActionData, setQuickActionData] = useState<{ product: Product; x: number; y: number } | null>(null);
   const [successToast, setSuccessToast] = useState<string | null>(null);

   // --- SAFETY GATE STATE ---
   const [showSafetyGate, setShowSafetyGate] = useState(false);
   const [safetyAction, setSafetyAction] = useState<{ name: string, callback: () => void, isCritical: boolean } | null>(null);

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

   useEffect(() => () => {
      if (ticketAutoSyncTimeoutRef.current) {
         window.clearTimeout(ticketAutoSyncTimeoutRef.current);
         ticketAutoSyncTimeoutRef.current = null;
      }
   }, []);

   const activeTerminal = (config.terminals || []).find(t => t.id === activeTerminalId) || (config.terminals || [])[0];
   const activeTerminalConfig = activeTerminal?.config;
   const terminalId = activeTerminal?.id || 'T1';
   const defaultSalesWarehouseId = activeTerminalConfig?.inventoryScope?.defaultSalesWarehouseId;
   const uxConfig = activeTerminalConfig?.ux || { showProductImages: true, gridDensity: 'COMFORTABLE', theme: 'LIGHT', quickKeysLayout: 'A' };

   const isRetailMode = activeTerminalConfig?.ux?.viewMode === 'RETAIL';
   const reservationPolicy = activeTerminalConfig?.operational?.reservationPolicy || {
      validityDays: 7,
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
   const isKioskMode = activeTerminalConfig?.deviceRole?.role === 'SELF_CHECKOUT';

   // --- KIOSK MODE & GLOBAL SCANNER ---
   // Managed globally in App.tsx (if currentView !== 'POS').
   // However, when in POS view, we need local scanning for Returns/etc.
   useBarcodeScanner({
      onScan: (code) => {
         // 1. Try JSON/Smart QR first
         const trimmed = code.trim();
         try {
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
               const data = JSON.parse(trimmed);
               if (data.type === 'RESERVATION_NOTE' && (data.id || data.code)) {
                  const found = (reservations || []).find(r => r.id === data.id || r.code === data.code);
                  if (found) {
                     handleRecoverReservation(found);
                     setSuccessToast('Reserva Recuperada');
                     return;
                  }
               }
               if (data.type === 'INVOICE_RETURN' && data.id) {
                  setReturnInvoiceId(data.id);
                  setShowReturnModal(true);
                  setSuccessToast('Factura Identificada');
                  return;
               }
            }
         } catch (e) { }

         // 2. Try Transaction Search via ID
         const txnFound = (transactions || []).find(t => t.displayId === trimmed || t.id === trimmed);
         if (txnFound) {
            setReturnInvoiceId(txnFound.id);
            setShowReturnModal(true);
            setSuccessToast('Factura Identificada');
            return;
         }

         // 3. Try Product Search (Barcode or ID)
         const product = (products || []).find(p => p.barcode === trimmed || p.id === trimmed);

         if (product) {
            // Check availability
            const isWeighted = product.type === 'SERVICE' || product.name.toLowerCase().includes('(peso)');
            const hasVariants = product.attributes && product.attributes.length > 0;

            if (isWeighted) {
               setProductForScale(product);
            } else if (hasVariants) {
               setSelectedProductForVariants(product);
            } else {
               // Direct add
               addToCart(product);
               setSuccessToast(`${product.name} Agregado`);
            }
            return;
         }

         // 4. Try Scale Parser (Weight barcodes)
         if (config.scaleLabelConfig?.isEnabled) {
            const scaleItem = parseScaleBarcode(trimmed, config.scaleLabelConfig);
            if (scaleItem) {
               const prodScale = (products || []).find(p => p.barcode === scaleItem.plu || p.id === scaleItem.plu);
               if (prodScale) {
                  if (scaleItem.type === 'WEIGHT') {
                     addToCart(prodScale, scaleItem.value);
                     setSuccessToast(`${prodScale.name} (${scaleItem.value.toFixed(3)}kg)`);
                  } else {
                     const unitPrice = getProductPrice(prodScale);
                     const weight = unitPrice > 0 ? scaleItem.value / unitPrice : 1;
                     addToCart(prodScale, weight);
                     setSuccessToast(`${prodScale.name} ($${scaleItem.value})`);
                  }
                  return;
               }
            }
         }

         // If nothing found
         setSuccessToast(`Código no encontrado: ${code}`);
      }
   });

   // --- AUTO-HYDRATION FOR TABLES ---
   // --- SMART TABLE HYDRATION ---
   // Automatically load order when entering via Table Map
   useEffect(() => {
      if (activeTable) {
         if (activeTable.currentOrderId) {
            console.log(`🤖 Smart Access: Hydrating table ${activeTable.nombre} (Order ${activeTable.currentOrderId})`);
            const ticket = parkedTickets.find(t => t.id === activeTable.currentOrderId);
            if (ticket) {
               // 1. Load Cart
               onUpdateCart(ticket.items || []);
               // 2. Load Customer
               if (ticket.customerId) {
                  const customer = customers.find(c => c.id === ticket.customerId);
                  if (customer) onSelectCustomer(customer);
               } else {
                  onSelectCustomer(null);
               }
               console.log(`✅ Loaded ${ticket.items.length} items from active table.`);
            } else {
               console.warn(`⚠️ Ticket ${activeTable.currentOrderId} not found in parked tickets. Falling back to empty.`);
               // Ideally trigger a fetch here if missing?
               // For now, allow manual recovery logic or leave as is to avoid overwriting with empty
            }
         } else {
            // Free table opened directly? Should be empty.
            // Only clear if cart has items to avoid unnecessary updates
            if (cart.length > 0) {
               console.log('🧹 Clearing cart for new table.');
               onUpdateCart([]);
               onSelectCustomer(null);
            }
         }
      }
   }, [activeTable, parkedTickets]); // Re-run if table changes or tickets sync

   const gridClass = useMemo(() => {
      if (uxConfig.gridDensity === 'COMPACT') {
         return "grid [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))] gap-4 content-start";
      }
      return "grid [grid-template-columns:repeat(auto-fill,minmax(170px,1fr))] gap-4 md:gap-6 content-start";
   }, [uxConfig.gridDensity]);

   const categoryContainerClass = useMemo(() => {
      if (uxConfig.quickKeysLayout === 'B') {
         return "bg-white border-b border-gray-200 px-4 md:px-8 py-3 flex flex-wrap gap-2 shrink-0 max-h-32 overflow-y-auto custom-scrollbar";
      }
      return "bg-white border-b border-gray-200 px-4 md:px-8 py-3 flex gap-2 overflow-x-auto no-scrollbar shrink-0";
   }, [uxConfig.quickKeysLayout]);

   const allowedTariffs = useMemo(() => {
      const allowedIds = activeTerminalConfig?.pricing?.allowedTariffIds || [];
      return config.tariffs.filter(t => allowedIds.includes(t.id));
   }, [config.tariffs, activeTerminalConfig]);

   const [activeTariffId, setActiveTariffId] = useState<string>(() => {
      return activeTerminalConfig?.pricing?.defaultTariffId || allowedTariffs[0]?.id || config.tariffs[0]?.id || '';
   });

   // FILTER: Only pending transactions (after latest Z close for this terminal)
   const terminalTransactions = useMemo(() => {
      const normalize = (value?: string | null) => (value || '').trim().toLowerCase();
      const terminalKey = normalize(terminalId);
      const isDefaultTerminal = terminalKey === 't1';

      const latestCloseTs = (zReports || [])
         .filter(r => normalize(r.terminalId) === terminalKey || (!r.terminalId && isDefaultTerminal))
         .map(r => new Date(r.closedAt).getTime())
         .filter((value) => Number.isFinite(value))
         .reduce((max, value) => value > max ? value : max, 0);

      return transactions
         .filter(t => {
            const belongsToTerminal = normalize(t.terminalId) === terminalKey || (!t.terminalId && isDefaultTerminal);
            if (!belongsToTerminal) return false;
            if (t.zReportId) return false;

            const txTime = new Date(t.date).getTime();
            if (!Number.isFinite(txTime)) return latestCloseTs <= 0;
            return latestCloseTs <= 0 || txTime > latestCloseTs;
         })
         .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
   }, [transactions, terminalId, zReports]);

   const canProceedWithOperationalSession = useCallback((): boolean => {
      if (!activeTerminalConfig || terminalTransactions.length === 0) return true;

      const sessionStartDate = terminalTransactions[0]?.date;
      if (!sessionStartDate) return true;

      if (!isSessionExpired(sessionStartDate, activeTerminalConfig)) return true;

      return confirm(
         "⚠️ ADVERTENCIA DE JORNADA\n\n" +
         "El sistema detecta que la jornada operativa ha cambiado (hay transacciones pendientes de jornadas anteriores).\n\n" +
         "¿Desea continuar facturando de todos modos?\n" +
         "(Seleccione 'Aceptar' para continuar, 'Cancelar' para ir a Cierre Z)"
      );
   }, [activeTerminalConfig, terminalTransactions]);

   const [showTariffSelector, setShowTariffSelector] = useState(false);
   const [isReturnMode, setIsReturnMode] = useState(false);
   const [errorToast, setErrorToast] = useState<string | null>(null);

   const activeTariff = useMemo(() => (config.tariffs || []).find(t => t.id === activeTariffId), [config.tariffs, activeTariffId]);

   const [searchTerm, setSearchTerm] = useState('');
   const [categoryFilter, setCategoryFilter] = useState('ALL');
   const [mobileView, setMobileView] = useState<'PRODUCTS' | 'TICKET'>('PRODUCTS');

   const [showPaymentModal, setShowPaymentModal] = useState(false);
   const [showTicketOptions, setShowTicketOptions] = useState(false);
   const [showParkedList, setShowParkedList] = useState(false);
   const [showParkAliasModal, setShowParkAliasModal] = useState(false);
   const [parkTicketAlias, setParkTicketAlias] = useState('');
   const [showGlobalDiscount, setShowGlobalDiscount] = useState(false);
   const [showCouponModal, setShowCouponModal] = useState(false);
   const [couponCode, setCouponCode] = useState('');

   const [syncState, setSyncState] = useState<SyncState>(backgroundSyncManager.getState());

   useEffect(() => {
      return backgroundSyncManager.subscribe(setSyncState);
   }, []);
   const [globalDiscount, setGlobalDiscount] = useState<{ type: 'PERCENT' | 'FIXED', value: number }>({ type: 'PERCENT', value: 0 });

   useEffect(() => {
      if (activeTable?.currentOrderId && cart.length === 0) {
         const ord = (transactions || []).find(t => t.id === activeTable.currentOrderId);
         if (ord && ord.items) {
            onUpdateCart(ord.items);
         }
      }
   }, [activeTable, transactions, onUpdateCart, cart.length]);

   const [editingItem, setEditingItem] = useState<CartItem | null>(null);
   const [selectedProductForVariants, setSelectedProductForVariants] = useState<Product | null>(null);
   const [productForScale, setProductForScale] = useState<Product | null>(null);
   const [showLoyaltyModal, setShowLoyaltyModal] = useState(false);

   const [isScannerOpen, setIsScannerOpen] = useState(false);
   const scannerRef = useRef<Html5Qrcode | null>(null);
   const searchInputRef = useRef<HTMLInputElement>(null);
   const parkAliasInputRef = useRef<HTMLInputElement>(null);
   const [showVirtualKeyboard, setShowVirtualKeyboard] = useState(false);

   const [fiscalStatus, setFiscalStatus] = useState<{
      type: NCFType;
      number?: string;
      rangeExpiry?: string;
      hasNCF: boolean;
      localBuffer: any;
      isUsingPool: boolean;
   }>({
      type: 'B02', hasNCF: false, localBuffer: null, isUsingPool: false
   });

   const [showSupervisorAuth, setShowSupervisorAuth] = useState(false);
   const [refundAuthorizedBy, setRefundAuthorizedBy] = useState<{ id: string, name: string } | null>(null);
   const [status, setStatus] = useState<{ isConnected: boolean, currentNCF: string, remaining: number, expiryDate: string, batteryLevel: number } | null>(null);

   // --- MOBILE ADAPTATION ---
   const isMobile = useIsMobile();
   const bottomOverlayRefs = useMemo(
      () => [mobileFooterRef, mobileCartButtonRef],
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
            paddingBottom: 'calc(var(--bottom-safe-offset, 12px) + env(safe-area-inset-bottom))',
         }) as React.CSSProperties,
      []
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
         return `Mesa: ${activeTable.nombre || activeTable.name}`;
      }

      if (selectedCustomer?.name) {
         return selectedCustomer.name;
      }

      return `Ticket #${(Array.isArray(parkedTickets) ? parkedTickets : []).length + 1}`;
   }, [activeTable, selectedCustomer, parkedTickets]);

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
   const [committedByProduct, setCommittedByProduct] = useState<Record<string, number>>({});

   useBottomSafeOffset({
      rootRef: posRootRef,
      overlayRefs: bottomOverlayRefs,
      dependencyKey: `${isMobile}-${mobileView}`,
   });

   // --- SUPERVISOR AUTH ---
   const { requestApproval, supervisorModalProps } = useSupervisorAuth({
      config,
      currentUser,
      roles,
      onUpdateConfig
   });

   // Credit Control (CxC) - Simple Check
   const isDelinquent = useMemo(() => {
      if (!selectedCustomer) return false;
      const debt = selectedCustomer.currentDebt || 0;
      const limit = selectedCustomer.creditLimit || 0;
      // If limit is 0, meaningful credit check might be disabled or unlimited depending on business logic. 
      // Assuming strict: debt > limit and limit > 0
      if (limit > 0 && debt >= limit) return true;
      return false;
   }, [selectedCustomer]);

   const reloadCommitments = useCallback(async () => {
      const commitments = await db.get('inventoryCommitments') as any[] || [];
      const map: Record<string, number> = {};
      (commitments || []).forEach(row => {
         if (defaultSalesWarehouseId && row.warehouseId && row.warehouseId !== defaultSalesWarehouseId) return;
         map[row.productId] = (map[row.productId] || 0) + Math.max(0, Number(row.qtyCommitted || 0));
      });
      setCommittedByProduct(map);
   }, [defaultSalesWarehouseId]);

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

   const handleRecoverReservation = useCallback((reservation: Reservation) => {
      const hydratedItems = (reservation.items || []).map((item, idx) => ({
         ...item,
         cartId: `RSV-${reservation.id}-${idx}-${Date.now()}`
      }));

      onUpdateCart(hydratedItems);
      const customer = customers.find(c => c.id === reservation.customerId) || null;
      onSelectCustomer(customer);
      setActiveRecoveredReservation(reservation);
      closeRecoverReservationModal();
      setSuccessToast(`Reserva ${reservation.code} cargada`);
   }, [customers, onSelectCustomer, onUpdateCart, closeRecoverReservationModal]);

   const activeReservations = useMemo(() => {
      return (reservations || []).filter(r => r.status === 'ACTIVE');
   }, [reservations]);

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

   const handleRedeemCoupon = () => {
      if (!couponCode) return;

      const cartSubtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const result = couponService.redeemCoupon(couponCode, `TICKET-${Date.now()}`, terminalId, config, cartSubtotal);

      if (result.success) {
         if (result.updatedConfig) {
            onUpdateConfig(result.updatedConfig);
         }

         if (result.benefit) {
            if (result.benefit.type === 'PERCENT') {
               setGlobalDiscount({ type: 'PERCENT', value: result.benefit.value });
            } else if (result.benefit.type === 'FIXED_AMOUNT') {
               setGlobalDiscount({ type: 'FIXED', value: result.benefit.value });
            }
            alert(`¡Cupón Canjeado!\n${result.benefit.description}`);
            setShowCouponModal(false);
            setCouponCode('');
         }
      } else {
         alert(`Error: ${result.error}`);
      }
   };

   const getProductPrice = useCallback((p: Product) => (p.tariffs || []).find(t => t.tariffId === activeTariffId)?.price || p.price || 0, [activeTariffId]);

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

   const canAddItemToCart = useCallback((product: Product, quantityToAdd: number = 1): boolean => {
      // 0. Sellable check
      if (product.is_sellable === false) {
         setErrorToast(`Artículo no disponible para la venta (Insumo)`);
         setTimeout(() => setErrorToast(null), 3500);
         return false;
      }

      // 1. Warehouse enablement check
      if (defaultSalesWarehouseId) {
         const validation = validateWarehouseAccess(product, defaultSalesWarehouseId);
         if (!validation.isValid) {
            const whName = (warehouses || []).find(w => w.id === defaultSalesWarehouseId)?.name || 'Almacén Actual';
            setErrorToast(`${validation.error} (${whName})`);
            setTimeout(() => setErrorToast(null), 3500);
            return false;
         }
      }

      // 2. Stock validation
      const trackInventory = product.operationalFlags?.trackInventory ?? config.features.stockTracking;
      if (trackInventory) {
         const productAllowsNegative = product.operationalFlags?.allowNegativeStock ?? false;
         const terminalAllowsNegative = activeTerminalConfig?.workflow?.inventory?.allowNegativeStock ?? false;

         // If negative stock is NOT allowed (at either level), check availability
         if (!productAllowsNegative || !terminalAllowsNegative) {
            const currentStock = product.stockBalances?.[defaultSalesWarehouseId] ?? product.stock ?? 0;
            const committedQty = committedByProduct[product.id] || 0;
            const availableStock = Math.max(0, currentStock - committedQty);
            const inCartQty = cart.filter(item => item.id === product.id).reduce((sum, item) => sum + item.quantity, 0);
            const totalRequested = inCartQty + quantityToAdd;

            if (totalRequested > availableStock) {
               setErrorToast(`Stock insuficiente. Disponible: ${availableStock}. En carrito: ${inCartQty}`);
               setTimeout(() => setErrorToast(null), 3500);
               return false;
            }
         }
      }

      return true;
   }, [defaultSalesWarehouseId, warehouses, config.features.stockTracking, activeTerminalConfig, cart, committedByProduct]);

   const [lastAddedCartId, setLastAddedCartId] = useState<string | null>(null);

   const addToCart = useCallback((product: Product, quantity: number = 1, priceOverride?: number, modifiers?: string[], trackingData?: any[]) => {
      if (!canAddItemToCart(product, quantity)) return;

      // TRACEABILITY INTERCEPTION
      const usesLots = product.operationalFlags?.usesLots;
      const usesSerial = product.operationalFlags?.usesSerial;
      if ((usesLots || usesSerial) && !trackingData) {
         setPendingTrackingProduct({ product, quantity, price: priceOverride, modifiers });
         return;
      }

      const finalPrice = priceOverride || getProductPrice(product);
      const modifiersString = modifiers ? modifiers.sort().join('|') : '';

      // We look for existing item in the stable 'cart' prop/state instead of inside the setter
      // to avoid using setter for logic that triggers side effects.
      const existing = (cart || []).find(i => {
         const iMods = i.modifiers ? i.modifiers.sort().join('|') : '';
         return i.id === product.id && iMods === modifiersString && i.price === finalPrice;
      });

      let targetCartId: string;

      if (existing && !usesSerial) {
         targetCartId = existing.cartId!;
         onUpdateCart(prev => {
            const updatedItem = { ...existing, quantity: existing.quantity + quantity };
            return [updatedItem, ...prev.filter(i => i.cartId !== existing.cartId)];
         });
      } else {
         const newCartId = Math.random().toString(36).substr(2, 9);
         targetCartId = newCartId;
         const newItem = {
            ...product,
            cartId: newCartId,
            quantity,
            price: finalPrice,
            modifiers,
            originalPrice: getProductPrice(product),
            trackingData
         };
         onUpdateCart(prev => [newItem, ...prev]);
      }

      // SIDE EFFECT: Move outside the state update sequence to avoid React "rendering update" warning
      setLastAddedCartId(targetCartId);
   }, [canAddItemToCart, getProductPrice, onUpdateCart, cart]); // Added cart to dependencies

   const handleProductClick = useCallback((product: Product) => {
      // MOBILE INTERCEPTION
      if (isMobile && !defaultSalesWarehouseId) {
         setPendingProductToAdd(product);
         setShowMobileConfigModal(true);
         return;
      }

      if (!canAddItemToCart(product)) return;
      const productName = product.name || '';
      const isWeighted = product.type === 'SERVICE' || productName.toLowerCase().includes('(peso)');
      const hasVariants = product.attributes && product.attributes.length > 0;
      if (isWeighted) setProductForScale(product);
      else if (hasVariants) setSelectedProductForVariants(product);
      else addToCart(product, isReturnMode ? -1 : 1);
   }, [isMobile, defaultSalesWarehouseId, canAddItemToCart, addToCart, isReturnMode]);

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

      for (const p of products) {
         // A. Check Variants (SKU or Barcode)
         if (p.variants && p.variants.length > 0) {
            for (const v of p.variants) {
               if (v.sku === searchCode || (v.barcode && v.barcode.includes(searchCode))) {
                  // Map attribute values to a simple list of modifiers
                  const modifiersList = Object.entries(v.attributeValues || {}).map(([_, val]) => val);
                  return { product: p, quantity, price: v.price || getProductPrice(p), modifiers: modifiersList };
               }
            }
         }

         // B. Check Parent (ID, SKU, or Barcode)
         if (p.id === searchCode || p.barcode === searchCode) {
            return { product: p, quantity, price: getProductPrice(p), modifiers: [] };
         }
      }
      return null;
   }, [products, getProductPrice]);

   const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
         const match = findProductByAnyCode(searchTerm || '');
         if (match) {
            addToCart(match.product, (isReturnMode ? -1 : 1) * match.quantity, match.price, match.modifiers);
            setSearchTerm('');
            setErrorToast(null);
            // Ensure focus stays on search bar
            searchInputRef.current?.focus();
         } else if (searchTerm && searchTerm.trim()) {
            setErrorToast("Código no encontrado");
            setTimeout(() => setErrorToast(null), 2000);
         }
      }
   }, [searchTerm, findProductByAnyCode, addToCart, isReturnMode]);

   // --- BARCODE SCANNER LOGIC ---
   const processBarcode = useCallback((code: string) => {
      const trimmed = code.trim();

      // 0. Try Smart QR (JSON)
      try {
         if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            const data = JSON.parse(trimmed);
            if (data.type === 'RESERVATION_NOTE' && (data.id || data.code)) {
               const found = (reservations || []).find(r => r.id === data.id || r.code === data.code);
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

      // 0.1 Try Transaction Search (Direct bypass for TCK... barcodes)
      const txnFound = (transactions || []).find(t => t.displayId === trimmed || t.id === trimmed);
      if (txnFound) {
         setReturnInvoiceId(txnFound.id);
         setShowReturnModal(true);
         return;
      }

      // 1. Try Scale Parser
      if (config.scaleLabelConfig?.isEnabled) {
         const scaleItem = parseScaleBarcode(trimmed, config.scaleLabelConfig);
         if (scaleItem) {
            const product = (products || []).find(p => p.barcode === scaleItem.plu || p.id === scaleItem.plu);

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

      // 2. Normal Barcode Search
      const product = (products || []).find(p => p.barcode === trimmed);
      if (product) {
         handleProductClick(product);
         setErrorToast(`Producto agregado: ${product.name}`);
         setTimeout(() => setErrorToast(null), 1500);
      }
   }, [config, products, handleProductClick, getProductPrice, canAddItemToCart, transactions, reservations, handleRecoverReservation]);

   const isAnyModalOpen = !!(
      showPaymentModal ||
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

   useBarcodeScanner({
      onScan: processBarcode,
      enabled: !isAnyModalOpen
   });


   useEffect(() => {
      const checkFiscalStatus = async () => {
         const threshold = activeTerminalConfig?.operational?.fiscalThreshold || 0;
         const isOverThreshold = threshold > 0 && cartTotal > threshold;

         const type: NCFType = isOverThreshold
            ? 'B01'
            : (selectedCustomer?.defaultNcfType || (selectedCustomer?.requiresFiscalInvoice ? 'B01' : 'B02'));
         const buffers = await db.get('localFiscalBuffer') || [];
         const localBuffer = (buffers || []).find((b: any) => b.type === type && b.isActive) as FiscalRangeDGII | undefined;

         if (localBuffer) {
            const current = localBuffer.currentGlobal || localBuffer.startNumber;
            const total = localBuffer.endNumber - localBuffer.startNumber + 1;
            const used = current - localBuffer.startNumber;
            const remaining = localBuffer.endNumber - current;

            setStatus({
               isConnected: true,
               currentNCF: `${localBuffer.prefix}${current.toString().padStart(8, '0')}`,
               remaining,
               expiryDate: localBuffer.expiryDate,
               batteryLevel: 100
            });
         }
         const hasLocal = localBuffer && localBuffer.currentGlobal <= localBuffer.endNumber;
         const canRequest = await db.canRequestMoreNCF(type);
         const hasNCF = hasLocal || canRequest;
         setFiscalStatus({ type, hasNCF, localBuffer, isUsingPool: !hasLocal && canRequest });
      };
      checkFiscalStatus();
   }, [selectedCustomer, cart]);


   const filteredProducts = useMemo(() => {
      const allowedCats = activeTerminalConfig?.catalog?.allowedCategories || [];
      const allowedCategorySet = new Set(
         allowedCats
            .map(cat => (typeof cat === 'string' ? cat.trim().toLowerCase() : ''))
            .filter(Boolean)
      );
      const normalizedCategoryFilter = categoryFilter === 'ALL'
         ? 'ALL'
         : (typeof categoryFilter === 'string' ? categoryFilter.trim().toLowerCase() : '');

      const filtered = products.filter(p => {
         if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
         const isAvailableInWarehouse = defaultSalesWarehouseId ? p.activeInWarehouses?.includes(defaultSalesWarehouseId) ?? true : true;
         const productName = p.name || '';
         const matchSearch = productName.toLowerCase().includes(searchTerm.toLowerCase()) || p.barcode?.includes(searchTerm);

         // Category Scope Check
         const normalizedProductCategory = typeof p.category === 'string' ? p.category.trim().toLowerCase() : '';
         const matchCat = normalizedCategoryFilter === 'ALL' || normalizedProductCategory === normalizedCategoryFilter;
         const matchAllowedCat = allowedCategorySet.size === 0 || allowedCategorySet.has(normalizedProductCategory);

         const isSellable = p.is_sellable !== false;

         return matchSearch && matchCat && isAvailableInWarehouse && matchAllowedCat && isSellable;
      });

      // Defensive: Ensure unique IDs to prevent React key warnings
      const seenIds = new Set();
      return filtered.filter(p => {
         if (seenIds.has(p.id)) return false;
         seenIds.add(p.id);
         return true;
      });
   }, [products, searchTerm, categoryFilter, defaultSalesWarehouseId, activeTerminalConfig]);

   const categories = useMemo(() => {
      const allowedCats = activeTerminalConfig?.catalog?.allowedCategories || [];
      const allowedDisplayCategories = Array.from(
         new Set(
            allowedCats
               .map(cat => (typeof cat === 'string' ? cat.trim() : ''))
               .filter(Boolean)
         )
      );
      const allowedCategorySet = new Set(
         allowedCats
            .map(cat => (typeof cat === 'string' ? cat.trim().toLowerCase() : ''))
            .filter(Boolean)
      );
      const availableProducts = products.filter(p => {
         if (!p || p.is_sellable === false) return false;
         if (allowedCategorySet.size > 0) {
            const normalizedCategory = typeof p.category === 'string' ? p.category.trim().toLowerCase() : '';
            if (!allowedCategorySet.has(normalizedCategory)) return false;
         }
         return true;
      });

      const availableCategoryMap = new Map<string, string>();
      for (const product of availableProducts) {
         const rawCategory = typeof product?.category === 'string' ? product.category.trim() : '';
         const normalizedCategory = rawCategory.toLowerCase();
         if (!rawCategory || availableCategoryMap.has(normalizedCategory)) continue;
         availableCategoryMap.set(normalizedCategory, rawCategory);
      }

      const productCategories = Array.from(availableCategoryMap.values())
         .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

      const scopedCategories = allowedDisplayCategories.length > 0
         ? allowedDisplayCategories
         : productCategories;

      const cats = ['ALL', ...scopedCategories];
      console.log('[POS] Categories:', cats);
      return cats;
   }, [products, activeTerminalConfig]);

   useEffect(() => {
      if (categoryFilter !== 'ALL' && !categories.includes(categoryFilter)) {
         setCategoryFilter('ALL');
      }
   }, [categories, categoryFilter]);




   // --- PROMOTION ENGINE INTEGRATION ---
   const processedCart = useMemo(() => {
      return applyPromotions(cart, config, activeTerminalId, selectedCustomer || undefined);
   }, [cart, config, activeTerminalId, selectedCustomer]);

   const isTaxIncluded = activeTariff?.taxIncluded || false;
   const grossLineTotal = processedCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

   const discountAmount = globalDiscount.type === 'PERCENT' ? grossLineTotal * (globalDiscount.value / 100) : Math.min(globalDiscount.value, grossLineTotal);

   const taxBreakdown = useMemo(() => {
      const breakdown: Record<string, { name: string, amount: number }> = {};

      processedCart.forEach(item => {
         const lineGross = item.price * item.quantity;
         const itemRatio = lineGross / (grossLineTotal || 1);
         const lineDiscount = discountAmount * itemRatio;
         const lineBaseAfterDiscount = lineGross - lineDiscount;

         let itemTaxRate = 0;
         const itemTaxes = (item.appliedTaxIds || []).map(id => (config.taxes || []).find(t => t.id === id)).filter(Boolean);
         itemTaxes.forEach(t => itemTaxRate += t!.rate);

         let lineNet = 0;
         if (isTaxIncluded) {
            lineNet = lineBaseAfterDiscount / (1 + itemTaxRate);
         } else {
            lineNet = lineBaseAfterDiscount;
         }

         itemTaxes.forEach(t => {
            if (!breakdown[t!.id]) breakdown[t!.id] = { name: t!.name, amount: 0 };
            breakdown[t!.id].amount += lineNet * t!.rate;
         });
      });
      return Object.values(breakdown);
   }, [processedCart, grossLineTotal, config.taxes, discountAmount, isTaxIncluded]);

   const cartTax = taxBreakdown.reduce((sum, t) => sum + t.amount, 0);

   let cartTotal = 0;
   let netSubtotal = 0;

   if (isTaxIncluded) {
      cartTotal = grossLineTotal - discountAmount;
      netSubtotal = cartTotal - cartTax;
   } else {
      netSubtotal = grossLineTotal - discountAmount;
      cartTotal = netSubtotal + cartTax;
   }

   // Alias for compatibility if needed, though netSubtotal is what we usually display as "Subtotal"
   const cartSubtotal = grossLineTotal; // This represents the sum of list prices
   const baseCurrency = (config.currencies || []).find(c => c.isBase) || (config.currencies || [])[0];
   const reservationAdvanceApplied = activeRecoveredReservation ? Math.min(activeRecoveredReservation.balancePaid || 0, cartTotal) : 0;
   const reservationBalanceDue = Math.max(0, cartTotal - reservationAdvanceApplied);
   const amountDueNow = activeRecoveredReservation ? reservationBalanceDue : cartTotal;
   const isEditingRecoveredReservation = !!activeRecoveredReservation;

   useEffect(() => {
      const orderId = activeTable?.currentOrderId;
      if (!orderId) return;
      if (cart.length === 0) return;

      const existing = parkedTickets.find(ticket => ticket.id === orderId);
      const nextDigest = buildCartDigest(cart);
      const existingDigest = buildCartDigest(existing?.items || []);
      const sameCustomer = (existing?.customerId || '') === (selectedCustomer?.id || '');
      const sameCustomerName = (existing?.customerName || '') === (selectedCustomer?.name || '');
      const existingTotal = Number(existing?.total || 0);
      const sameFinalTotal = Math.abs(existingTotal - cartTotal) < 0.01;

      if (existingDigest === nextDigest && sameCustomer && sameCustomerName && sameFinalTotal) {
         return;
      }

      const syncedTicket: ParkedTicket = {
         id: orderId,
         name: existing?.name || `Mesa: ${activeTable.nombre || activeTable.name || orderId}`,
         alias: existing?.alias,
         items: [...cart],
         total: cartTotal,
         customerId: selectedCustomer?.id,
         customerName: selectedCustomer?.name,
         timestamp: existing?.timestamp || new Date().toISOString()
      };

      const nextTickets = [...parkedTickets.filter(ticket => ticket.id !== orderId), syncedTicket];

      if (ticketAutoSyncTimeoutRef.current) {
         window.clearTimeout(ticketAutoSyncTimeoutRef.current);
      }

      ticketAutoSyncTimeoutRef.current = window.setTimeout(() => {
         onUpdateParkedTickets(nextTickets);
         ticketAutoSyncTimeoutRef.current = null;
      }, 120);

      return () => {
         if (ticketAutoSyncTimeoutRef.current) {
            window.clearTimeout(ticketAutoSyncTimeoutRef.current);
            ticketAutoSyncTimeoutRef.current = null;
         }
      };
   }, [
      activeTable?.currentOrderId,
      activeTable?.nombre,
      activeTable?.name,
      cart,
      cartTotal,
      parkedTickets,
      selectedCustomer?.id,
      selectedCustomer?.name,
      onUpdateParkedTickets
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

      const reservationId = activeRecoveredReservation?.id || `RSV-${Date.now()}`;
      const reservationCode = activeRecoveredReservation?.code || `RSV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const qrPayload = activeRecoveredReservation?.qrPayload || JSON.stringify({ type: 'RESERVATION_NOTE', id: reservationId, code: reservationCode });
      const warehouseId = activeRecoveredReservation?.warehouseId || defaultSalesWarehouseId || 'wh_central';
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
         expiryDate: activeRecoveredReservation?.expiryDate || expiryDate.toISOString(),
         status: 'ACTIVE',
         items: reservationItems,
         warehouseId,
         deliveryDate: reservationDeliveryDate ? new Date(`${reservationDeliveryDate}T00:00:00`).toISOString() : undefined,
         terminalId,
         createdById: activeRecoveredReservation?.createdById || currentUser.id,
         createdByName: activeRecoveredReservation?.createdByName || currentUser.name,
         createdAt: activeRecoveredReservation?.createdAt || now.toISOString(),
         updatedAt: now.toISOString()
      };

      await db.saveDocument('reservations', reservation);
      if (activeRecoveredReservation) {
         const previousWarehouseId = activeRecoveredReservation.warehouseId || defaultSalesWarehouseId || 'wh_central';
         await transferStockToCommitted(activeRecoveredReservation.items || [], previousWarehouseId, products, 'RELEASE');
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
      onUpdateCart([]);
      onSelectCustomer(null);
      setActiveRecoveredReservation(null);
      setSuccessToast(`Reserva ${reservation.code} ${isEditingRecoveredReservation ? 'actualizada' : 'creada'}`);
   };

   const pointsEarned = useMemo(() => calculatePointsEarned(processedCart, config), [processedCart, config]);
   const primaryLoyaltyCard = selectedCustomer ? getPrimaryLoyaltyCard(selectedCustomer) : undefined;
   const currentPoints = primaryLoyaltyCard?.pointsBalance || 0;

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
      if (cart.length > 0) {
         cartEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
   }, [cart.length]);

   useEffect(() => {
      if (cart.length === 0 && activeRecoveredReservation) {
         setActiveRecoveredReservation(null);
      }
   }, [cart.length, activeRecoveredReservation]);



   const updateCartItem = async (updatedItem: CartItem | null, cartIdToDelete?: string) => {
      let newCart: CartItem[] = [];

      if (cartIdToDelete || updatedItem === null) {
         // Void Line Check
         const authorized = await requestApproval({
            permission: 'POS_VOID_ITEM',
            actionDescription: 'Eliminar artículo del carrito',
            context: { itemId: cartIdToDelete || editingItem?.cartId }
         });
         if (!authorized) return;

         newCart = cart.filter(i => i.cartId !== (cartIdToDelete || editingItem?.cartId));
      } else {
         // Update Check (Price Override / Discount)
         const originalItem = (cart || []).find(i => i.cartId === updatedItem.cartId);

         // Stock Check (Quantity Increase)
         if (originalItem && updatedItem.quantity > originalItem.quantity) {
            const diff = updatedItem.quantity - originalItem.quantity;
            if (!canAddItemToCart(updatedItem, diff)) return;
         }
         newCart = cart.map(item => item.cartId === updatedItem.cartId ? updatedItem : item);
      }

      onUpdateCart(newCart);

      // KDS Sync (if active table)
      if (activeTable) {
         const ticketId = activeTable.currentOrderId;
         const total = newCart.reduce((sum, i) => sum + (i.price * i.quantity), 0);

         // Update Local Persistence
         if (onUpdateParkedTickets) {
            const updatedTickets = parkedTickets.map(p => p.id === ticketId ? { ...p, items: newCart } : p);
            onUpdateParkedTickets(updatedTickets);
         }

         // Update KDS
         try {
            fetch(`http://localhost:8001/api/ordenes/${ticketId}`, {
               method: 'PUT',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ items: newCart, total, status: 'OCCUPIED' })
            });
         } catch (e) {
            console.error("Auto-sync delete failed:", e);
         }
      }
   };


   const handlePaymentConfirm = async (payments: PaymentEntry[]): Promise<Transaction | null> => {
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
         const terminalId = activeTerminalId || 't1';
         const hasReturns = processedCart.some(i => i.quantity < 0);
         const hasSales = processedCart.some(i => i.quantity > 0);
         const isRefundOnly = hasReturns && !hasSales;
         const refundSeriesId = activeTerminalConfig?.documentAssignments?.['REFUND'] || 'REFUND';
         const assignedSequenceId = activeTerminalConfig?.documentAssignments?.['TICKET'];
         const normalizedRefundItems = processedCart
            .filter(i => i.quantity < 0)
            .map(item => ({ ...item, quantity: Math.abs(item.quantity) }));
         const sellableConditions = new Map<string, 'SELLABLE' | 'DAMAGED'>();
         normalizedRefundItems.forEach(item => sellableConditions.set(item.cartId, 'SELLABLE'));

         // --- FISCAL COMPLIANCE CHECK (DGII RNC VALIDATION) ---
         if (!isRefundOnly && fiscalStatus && fiscalStatus.type === 'B01' && selectedCustomer) {
            if (selectedCustomer.fiscalStatus && selectedCustomer.fiscalStatus !== 'ACTIVO') {
               alert(
                  `⛔ COMPROBANTE BLOQUEADO\n\n` +
                  `El contribuyente ${selectedCustomer.name} tiene estatus: ${selectedCustomer.fiscalStatus || 'DESCONOCIDO'}.\n` +
                  `No se puede emitir Crédito Fiscal (B01) según normas de la DGII.\n\n` +
                  `Acción requerida: Cambie el tipo de comprobante a Consumo (B02) o seleccione otro cliente.`
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

         let finalNcf: string | undefined;
         let finalNcfType: NCFType | undefined;

         if (isRefundOnly) {
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
               alert(`CRÍTICO: No hay NCF de ${fiscalStatus.type === 'B01' ? 'Crédito Fiscal' : 'Consumo'} disponible. Pool DGII agotado.`);
               return null;
            }

            finalNcfType = fiscalStatus.type;
         }

         const reservationAdvance = activeRecoveredReservation ? Math.min(activeRecoveredReservation.balancePaid || 0, cartTotal) : 0;
         const paymentsForTransaction = reservationAdvance > 0
            ? [...payments, { id: `ADV-${Date.now()}`, method: 'ADVANCE', amount: reservationAdvance, timestamp: new Date() }]
            : payments;

         if (activeRecoveredReservation && hasReturns) {
            alert('La recuperación de reserva no admite líneas de devolución. Finalice la reserva y procese devoluciones por separado.');
            return null;
         }

         try {
            // If it's a mixed transaction, use the split endpoint
            if (hasReturns && hasSales) {
               const saleItems = processedCart.filter(i => i.quantity > 0);
               const returnItems = processedCart.filter(i => i.quantity < 0);

               // Calculate totals for each part
               const saleTotal = saleItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
               const normalizedSplitRefundItems = returnItems.map(item => ({ ...item, quantity: Math.abs(item.quantity) }));
               const returnTotal = normalizedSplitRefundItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);

               // Prepare wallet operations
               const walletDepositAmount = payments.filter(p => p.method === 'ADVANCE').reduce((acc, p) => acc + p.amount, 0);
               const walletPaymentAmount = payments.filter(p => p.method === 'WALLET').reduce((acc, p) => acc + p.amount, 0);
               let refundNcf: string | undefined;

               if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
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
                        payments: payments.filter(p => !['WALLET', 'ADVANCE'].includes(p.method)),
                        userId: currentUser.id,
                        userName: currentUser.name,
                        terminalId: terminalId,
                        customerId: selectedCustomer?.id,
                        customerName: selectedCustomer?.name,
                        ncf: finalNcf,
                        ncfType: fiscalStatus.type,
                        taxAmount: isTaxIncluded ? saleTotal * 0.18 : 0,
                        netAmount: isTaxIncluded ? saleTotal / 1.18 : saleTotal,
                        pendingBalance: payments.filter(p => p.method === 'CREDIT').reduce((acc, p) => acc + p.amount, 0) || undefined,
                        dueDate: payments.some(p => p.method === 'CREDIT') ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : undefined,
                        customerSnapshot: selectedCustomer ? {
                           name: selectedCustomer.name,
                           taxId: selectedCustomer.taxId
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
                        customerId: selectedCustomer?.id,
                        customerName: selectedCustomer?.name,
                        status: 'COMPLETED',
                        ncf: refundNcf,
                        ncfType: refundNcf ? 'B04' : undefined,
                        walletDepositAmount: walletDepositAmount > 0 ? walletDepositAmount : undefined,
                        authorizedById: refundAuthorizedBy?.id,
                        authorizedByName: refundAuthorizedBy?.name
                     },
                     walletDeposit: selectedCustomer?.id && walletDepositAmount > 0 ? { customerId: selectedCustomer.id, amount: walletDepositAmount } : undefined,
                     walletPayment: selectedCustomer?.id && walletPaymentAmount > 0 ? { customerId: selectedCustomer.id, amount: walletPaymentAmount } : undefined
                  };

               if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
                  const result = await withTimeout(
                     transactionService.createSplitTransaction(splitPayload),
                     25000,
                     'TIMEOUT_SPLIT_LOCAL'
                  );

                  if (result.sale) {
                     await persistStandaloneSaleHistory({
                        ...result.sale,
                        syncStatus: 'PENDING'
                     });
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

                  onUpdateCart([]);
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
                  onUpdateCart([]);
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
               const taxAmount = cartTax;
               const netAmount = isTaxIncluded
                  ? (grossLineTotal - discountAmount - taxAmount)
                  : (grossLineTotal - discountAmount);

               const walletDepositAmount = payments.filter(p => p.method === 'ADVANCE').reduce((acc, p) => acc + p.amount, 0);
               const walletPaymentAmount = payments.filter(p => p.method === 'WALLET').reduce((acc, p) => acc + p.amount, 0);
               const creditAmount = payments.filter(p => p.method === 'CREDIT').reduce((acc, p) => acc + p.amount, 0);
               const refundDocumentTotal = normalizedRefundItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
               const documentItems = isRefundOnly ? normalizedRefundItems : processedCart;

               const txn = await withTimeout(transactionService.createTransaction({
                  documentType: hasReturns ? 'REFUND' : 'TICKET',
                  seriesId: hasReturns
                     ? (activeTerminalConfig?.documentAssignments?.['REFUND'] || 'REFUND-GENERIC')
                     : assignedSequenceId,
                  date: new Date().toISOString(),
                  items: documentItems,
                  total: isRefundOnly ? refundDocumentTotal : cartTotal,
                  payments: paymentsForTransaction,
                  userId: currentUser.id,
                  userName: currentUser.name,
                  terminalId: terminalId,
                  status: 'COMPLETED',
                  customerId: selectedCustomer?.id,
                  customerName: selectedCustomer?.name,
                  pendingBalance: creditAmount > 0 ? creditAmount : undefined,
                  dueDate: creditAmount > 0 ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : undefined, // Default 30 days
                  ncf: finalNcf,
                  ncfType: finalNcfType,
                  taxAmount: taxAmount,
                  netAmount: netAmount,
                  discountAmount: discountAmount,
                  customerSnapshot: selectedCustomer ? {
                     name: selectedCustomer.name,
                     taxId: selectedCustomer.taxId,
                     address: selectedCustomer.address,
                     phone: selectedCustomer.phone,
                     email: selectedCustomer.email
                  } : undefined,
                  isTaxIncluded: isTaxIncluded,
                  authorizedById: hasReturns ? refundAuthorizedBy?.id : undefined,
                  authorizedByName: hasReturns ? refundAuthorizedBy?.name : undefined,
                  reservationId: activeRecoveredReservation?.id,
                  reservationCode: activeRecoveredReservation?.code,
                  priorAdvancePaid: reservationAdvance > 0 ? reservationAdvance : undefined,
                  balanceDueAtSale: activeRecoveredReservation ? reservationBalanceDue : undefined,
                  walletDepositAmount: walletDepositAmount > 0 ? walletDepositAmount : undefined,
                  walletPaymentAmount: walletPaymentAmount > 0 ? walletPaymentAmount : undefined
               }), 25000, 'TIMEOUT_CREATE_TRANSACTION');

               // Ensure seriesId is preserved (Backend might not return it in the root object)
               const finalTxn = {
                  ...txn,
                  seriesId: txn.seriesId || (isRefundOnly ? refundSeriesId : assignedSequenceId)
               };

               if (isRefundOnly) {
                  await persistStandaloneRefundTransaction(
                     {
                        ...finalTxn,
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
                  onTransactionComplete(finalTxn);
               }

               if (activeRecoveredReservation) {
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

               // --- CRITICAL: Ticket Closing Logic ---
               if (activeTable) {
                  try {
                     // 1. Free table in the main API so status/currentOrderId are reset.
                     const controller = new AbortController();
                     const timeoutId = window.setTimeout(() => controller.abort(), 4000);
                     try {
                        const releaseRes = await fetch('/api/mesas/liberar', {
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

                     // 2. Remove from Parked Tickets (Local Persistence)
                     if (activeTable.currentOrderId) {
                        const remaining = parkedTickets.filter(p => p.id !== activeTable.currentOrderId);
                        onUpdateParkedTickets(remaining);
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

               onUpdateCart([]);
               onSelectCustomer(null);
               setIsReturnMode(false);
               setRefundAuthorizedBy(null);
               setActiveRecoveredReservation(null);
               return txn;
            }
         } catch (error: any) {
            console.error('Split Transaction Error:', error);
            alert(`Error de red: ${error.message}`);
            return null;
         }
      } catch (error: any) {
         console.error('Payment confirm error:', error);
         alert(`Error al finalizar venta: ${error?.message || 'Error desconocido'}`);
         return null;
      }
   };

   const proceedToCheckout = () => {
      const threshold = activeTerminalConfig?.operational?.fiscalThreshold || 0;
      if (threshold > 0 && cartTotal > threshold && !selectedCustomer) {
         alert(`ATENCIÓN: El monto de la venta (${baseCurrency.symbol}${cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) excede el umbral fiscal permitido para facturas de consumo (${baseCurrency.symbol}${threshold.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).\n\nEs obligatorio identificar al cliente y emitir una Factura de Crédito Fiscal (B01).`);
         onOpenCustomers();
         return;
      }

      if (activeRecoveredReservation && amountDueNow <= 0.0001) {
         handlePaymentConfirm([]).catch(console.error);
         return;
      }
      setShowPaymentModal(true);
   };

   const handleDispatchCommand = async () => {
      if (cart.length === 0) return;

      const orderId = activeTable?.currentOrderId || `P-${Date.now()}`;

      try {
         // 1. We must ensure the items are "parked" (saved to DB) before marchar
         // in traditional POS systems, 'Marchar' implies saving the order state.
         if (activeTable) {
            await handleParkCurrentTicket();
         } else {
            // Non-table direct order: Simplified park or just proceed if server can handle it
            // from the items in memory (but our server reads from transactions table usually)
            // For now, only support dispatching for saved orders (Active Table).
            if (!activeTable) {
               alert("Para marchar a cocina, inicie un pedido en una mesa.");
               return;
            }
         }

         const response = await fetch(`http://localhost:8001/api/ordenes/enviar-comanda/${orderId}`, {
            method: 'POST'
         });
         const result = await response.json();

         if (result.status === 'success') {
            setSuccessToast(`Comanda enviada (${result.dispatched} ítems)`);
         } else if (result.status === 'ignored') {
            // Already sent or module disabled
         }
      } catch (e) {
         console.error("Dispatch error:", e);
         alert("Error de comunicación con el servicio de cocina");
      }
   };

   const openReservationModal = () => {
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
      if (activeRecoveredReservation) {
         setReservationCustomerId(activeRecoveredReservation.customerId || selectedCustomer?.id || '');
         setReservationAdvanceInput(String(activeRecoveredReservation.balancePaid || 0));
         setReservationDeliveryDate(formatDateForInput(activeRecoveredReservation.deliveryDate) || today);
      } else {
         setReservationCustomerId(selectedCustomer?.id || '');
         setReservationAdvanceInput('0');
         setReservationDeliveryDate(today);
      }
      setShowReservationModal(true);
   };

   const releaseActiveEmptyTable = async (): Promise<boolean> => {
      if (!activeTable || cart.length > 0) return false;

      try {
         const releaseRes = await fetch('/api/mesas/liberar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableId: activeTable.id })
         });
         const releaseData = await releaseRes.json().catch(() => null);

         if (!releaseRes.ok || (releaseData && releaseData.success === false)) {
            throw new Error(releaseData?.message || `HTTP ${releaseRes.status}`);
         }

         if (activeTable.currentOrderId) {
            const remaining = parkedTickets.filter(p => p.id !== activeTable.currentOrderId);
            onUpdateParkedTickets(remaining);
         }

         onUpdateCart([]);
         onSelectCustomer(null);
         setActiveRecoveredReservation(null);
         if (onClearActiveTable) onClearActiveTable();
         setSuccessToast('Mesa liberada (sin productos)');
         return true;
      } catch (error) {
         console.error('Failed to auto-release empty table:', error);
         return false;
      }
   };

   const handleParkCurrentTicket = async (aliasInput?: string) => {
      if (cart.length === 0) return;
      const parkedTicketId = activeTable?.currentOrderId || `P-${Date.now()}`;
      const existingParked = (Array.isArray(parkedTickets) ? parkedTickets : []).find((ticket) => ticket.id === parkedTicketId);
      const normalizedAlias = aliasInput === undefined
         ? existingParked?.alias
         : (aliasInput.trim() || undefined);
      const newParked: ParkedTicket = {
         id: parkedTicketId,
         name: buildParkedTicketName(),
         alias: normalizedAlias,
         items: [...cart],
         total: cartTotal,
         customerId: selectedCustomer?.id,
         customerName: selectedCustomer?.name,
         timestamp: existingParked?.timestamp || new Date().toISOString()
      };

      // Remove existing if updating same ID
      const updatedTickets = [...(Array.isArray(parkedTickets) ? parkedTickets : []).filter(p => p.id !== newParked.id), newParked];
      onUpdateParkedTickets(updatedTickets);
      closeParkAliasModal();

      if (activeTable) {
         try {
            const total = cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);

            // Sync with KDS backend
            await fetch(`http://localhost:8001/api/ordenes/${newParked.id}`, {
               method: 'PUT',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({
                  items: cart,
                  total: total,
                  status: 'OCCUPIED'
               })
            });

            if (onClearActiveTable) onClearActiveTable();

            // Redirect Logic
            if (activeTerminalConfig?.tables?.autoRedirectToMap && onOpenTableMap) {
               onOpenTableMap();
            } else if (onOpenTableMap) {
               onOpenTableMap();
            }
         } catch (e) {
            console.error("Failed to sync table status with KDS:", e);
         }
      }

      onUpdateCart([]); onSelectCustomer(null);
      setActiveRecoveredReservation(null);
      setErrorToast(activeTable ? "Mesa Guardada" : "Ticket Guardado");
      setTimeout(() => setErrorToast(null), 2000);
   };

   const handleSendAndExit = async () => {
      // 1. If table is empty, auto-release to avoid ghost occupied tables.
      const releasedEmptyTable = await releaseActiveEmptyTable();

      // 2. Otherwise park/save the ticket.
      if (!releasedEmptyTable) {
         await handleParkCurrentTicket();
      }

      // 3. Dispatch to kitchen if applicable
      if (!releasedEmptyTable && activeTerminalConfig?.operational?.usa_modulos_cocina && cart.length > 0) {
         try {
            await handleDispatchCommand();
         } catch (e) {
            console.error("Failed to dispatch on exit:", e);
         }
      }

      // 4. Navigate back to map
      if (onOpenTableMap) onOpenTableMap();
   };

   const handleBackToMap = async () => {
      const releasedEmptyTable = await releaseActiveEmptyTable();

      // Ensure we park if there's something to park and no auto-release happened
      if (!releasedEmptyTable && cart.length > 0) {
         await handleParkCurrentTicket();
      }
      // Always navigate, even if empty (handleParkCurrentTicket might skip nav if empty/no-table)
      if (onOpenTableMap) onOpenTableMap();
   };

   const handleRestoreTicket = (parked: ParkedTicket) => {
      onUpdateCart([...parked.items]);
      if (parked.customerId) {
         const found = (customers || []).find(c => c.id === parked.customerId);
         if (found) onSelectCustomer(found);
      }
      onUpdateParkedTickets(parkedTickets.filter(p => p.id !== parked.id));
      setActiveRecoveredReservation(null);
      setShowParkedList(false);
      setMobileView('TICKET');
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
      let refundTotal = 0;
      const returnItems: CartItem[] = [];

      itemsToReturn.forEach(returnItem => {
         const originalItem = (originalTransaction.items || []).find(i => i.cartId === returnItem.itemId);
         if (originalItem) {
            const itemTotal = originalItem.price * returnItem.quantity;
            refundTotal += itemTotal;

            returnItems.push({
               ...originalItem,
               quantity: Math.abs(returnItem.quantity),
               cartId: `RET-${Date.now()}-${returnItem.itemId}`
            });
         }
      });

      let refundNcf: string | undefined;
      try {
         refundNcf = await db.getNextNCF('B04', terminalId, activeTerminalConfig?.fiscal?.typeConfigs?.['B04']?.batchSize || 50);
      } catch (refundNcfError) {
         console.warn('No se pudo generar NCF B04 para devolución QR:', refundNcfError);
      }

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
         affectedInvoiceNumber: originalTransaction.displayId || originalTransaction.id,
         affectedNCF: originalTransaction.ncf,
         ncf: refundNcf,
         ncfType: refundNcf ? 'B04' : undefined,
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
         case 'DISCOUNT': setShowGlobalDiscount(true); break;
         case 'COUPON': setShowCouponModal(true); break;
         case 'PARK_LIST': setShowParkedList((prev: any) => !prev); break;
         case 'RESERVATION': openReservationModal(); break;
         case 'RECOVER_RESERVATION': openRecoverReservationModal(); break;
         case 'RETURN':
            if (!isReturnMode) {
               const hasPermission = (currentUser as any).permissions?.includes('CAN_REFUND') ||
                  ['ADMIN', 'MANAGER'].includes(currentUser.role);
               if (!hasPermission) {
                  setShowSupervisorAuth(true);
                  return;
               }
            }
            if (isReturnMode) setRefundAuthorizedBy(null);
            setIsReturnMode(!isReturnMode);
            break;
         case 'Z_REPORT':
            triggerSafetyGate('Cierre Z', onOpenFinance);
            break;
         case 'LOGOUT':
            triggerSafetyGate('Cerrar Sesión', onLogout);
            break;
         case 'SETTINGS': if (onOpenSettings) onOpenSettings(); break;
         case 'TRACKING': if (onOpenInventoryTracking) onOpenInventoryTracking(); break;
         case 'DRAWER': handleOpenDrawer(); break;
         case 'SAVE': openParkAliasModal(); break;
         case 'TABLES':
            if ((config.vertical === 'RESTAURANT' || config.vertical === 'RETAIL') && cart.length > 0) {
               handleSendAndExit();
            } else {
               if (onOpenTableMap) onOpenTableMap();
            }
            break;
         case 'loyalty_card': setShowLoyaltyModal(true); break;
         case 'AGENDA': if (onOpenAgenda) onOpenAgenda(); break;
      }
   };

   return (
      <div
         ref={posRootRef}
         className="fixed inset-0 w-full overflow-hidden bg-gray-50 flex font-sans select-none text-gray-900"
         style={posShellStyle}
      >
         {errorToast && (
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300">
               <div className="bg-red-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-bold border-2 border-red-400">
                  <AlertTriangle size={24} className="animate-pulse" />
                  <span>{errorToast}</span>
               </div>
            </div>
         )}

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
                  setCategoryFilter(mobileConfig.categoryId);
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

         {mobileView === 'PRODUCTS' && (
            <MobileCartButton
               buttonRef={mobileCartButtonRef}
               itemCount={cart.length}
               onClick={() => setMobileView('TICKET')}
               style={mobileCartButtonStyle}
            />
         )}

         {/* LEFT AREA: PRODUCTS */}
         <div className={`flex-1 min-h-0 flex flex-col min-w-0 bg-gray-50 transition-all duration-300 ${mobileView === 'TICKET' ? 'hidden md:flex' : 'flex'} ${isRetailMode ? '!hidden' : ''}`}>
            <header className="bg-white px-4 md:px-8 py-3 md:py-4 border-b border-gray-200 flex items-center gap-3 md:gap-6 shadow-sm z-10 shrink-0">
               <div className="flex items-center gap-3 pr-4 border-r border-gray-100">
                  <div className="w-10 h-10 rounded-full bg-gray-50 overflow-hidden border border-gray-200 shadow-inner shrink-0">
                     {currentUser.photo ? <img src={currentUser.photo} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-blue-50 text-blue-600 font-bold">{currentUser.name.charAt(0)}</div>}
                  </div>
                  <div className="hidden lg:block leading-tight">
                     <p className="text-sm font-black text-gray-800 truncate max-w-[120px]">{currentUser.name}</p>
                     <div className="flex items-center gap-2">
                        <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Cajero</p>
                        <span className="text-gray-300">•</span>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">T-{terminalId}</p>
                     </div>
                  </div>
               </div>

               <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-gray-50 border border-gray-100 shadow-inner">
                  {syncState.isSyncing ? (
                     <RefreshCw size={18} className="text-amber-500 animate-spin" />
                  ) : syncState.hasError || !navigator.onLine ? (
                     <CloudOff size={18} className="text-red-500" />
                  ) : (
                     <Cloud size={18} className="text-emerald-500" />
                  )}
                  <div className="flex flex-col leading-none">
                     <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest hidden md:block">Sincronización</span>
                     <span className={`text-[10px] font-bold ${syncState.pendingCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {syncState.isSyncing ? '...' : syncState.pendingCount > 0 ? `${syncState.pendingCount}` : 'OK'}
                     </span>
                  </div>
               </div>


               <div className="flex-1 flex items-center gap-2 md:gap-4">

                  <div className="relative flex-1 group min-w-[150px] md:min-w-[300px]">
                     <Search className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                     <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Buscar..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        className="w-full pl-10 md:pl-12 pr-10 md:pr-4 py-2.5 md:py-3 bg-gray-100 rounded-2xl border-none outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                     />
                     <button onClick={() => setIsScannerOpen(true)} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 bg-white shadow-sm rounded-xl hover:text-blue-600 hover:bg-blue-50 border border-gray-100"><ScanBarcode size={18} /></button>
                  </div>
                  <div className="relative shrink-0">
                     <button onClick={() => setShowTariffSelector(!showTariffSelector)} className={`flex items-center gap-2 md:gap-3 px-3 md:px-5 py-2.5 md:py-3 rounded-2xl border-2 transition-all ${showTariffSelector ? 'border-purple-500 bg-purple-50' : 'bg-gray-100 border-transparent'}`}>
                        <Tag size={18} className="text-purple-600" />
                        <div className="text-left hidden sm:block">
                           <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest leading-none mb-1">Tarifa Activa</p>
                           <p className="text-xs font-bold text-purple-900 leading-none truncate max-w-[120px]">{activeTariff?.name || 'General'}</p>
                        </div>
                        <ChevronDown size={14} className={`text-purple-400 transition-transform ${showTariffSelector ? 'rotate-180' : ''}`} />
                     </button>
                  </div>


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

                  {/* MOBILE SETTINGS BUTTON */}
                  <button onClick={() => onOpenSettings()} className="md:hidden p-3 bg-gray-100 rounded-xl text-gray-600 hover:bg-gray-200">
                     <Settings size={20} />
                  </button>
               </div>
            </header>

            {/* --- CATEGORY SELECTOR BAR --- */}
            <div className={categoryContainerClass}>
               {categories.map((cat, idx) => (
                  <button
                     key={cat || `cat-${idx}`}
                     onClick={() => setCategoryFilter(cat)}
                     className={`px-6 py-2.5 rounded-full text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap shadow-sm border ${categoryFilter === cat
                        ? 'bg-blue-600 border-blue-500 text-white shadow-blue-200 scale-105'
                        : 'bg-white border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-600'
                        }`}
                  >
                     {cat === 'ALL' ? 'Todas' : cat}
                  </button>
               ))}
            </div>

            <div
               className={`flex-1 min-h-0 overflow-y-auto ${isMobile ? 'p-4' : 'p-8'} custom-scrollbar dark:bg-slate-900`}
               style={bottomAwareScrollStyle}
            >
               <div className={gridClass}>
                  {filteredProducts.map((product, idx) => {
                     const productName = product.name || '';
                     const isWeighted = product.type === 'SERVICE' || productName.toLowerCase().includes('(peso)');
                     const hasVariants = product.attributes && product.attributes.length > 0;

                     // Long Press Detection Logic
                     let touchTimer: any;
                     const handleTouchStart = (e: React.TouchEvent) => {
                        const touch = e.touches[0];
                        const { clientX, clientY } = touch;
                        touchTimer = setTimeout(() => {
                           setQuickActionData({ product, x: clientX, y: clientY });
                        }, 800);
                     };
                     const handleTouchEnd = () => {
                        clearTimeout(touchTimer);
                     };

                     return (

                        <div
                           key={product.id || `prod-${idx}`}
                           onClick={(e) => {
                              if (quickActionData) return;
                              handleProductClick(product);
                           }}
                           onContextMenu={(e) => {
                              e.preventDefault();
                              setQuickActionData({ product, x: e.clientX, y: e.clientY });
                           }}
                           onTouchStart={handleTouchStart}
                           onTouchEnd={handleTouchEnd}
                           className="bg-white dark:bg-slate-800 dark:border-slate-700 rounded-[2rem] p-4 shadow-sm border border-gray-100 cursor-pointer hover:shadow-xl hover:border-purple-300 hover:-translate-y-1 transition-all active:scale-95 group flex flex-col min-h-[250px] relative overflow-hidden"
                        >
                           {uxConfig.showProductImages && (
                              <div className="h-32 md:h-36 bg-gray-50 dark:bg-slate-800 rounded-[1.5rem] mb-4 overflow-hidden relative flex items-center justify-center">
                                 {product.image ? <img src={product.image} className="w-full h-full object-cover object-center" /> : <div className="w-full h-full flex items-center justify-center text-gray-200 dark:text-slate-700"><Grid size={48} strokeWidth={1} /></div>}

                                 {/* BADGES DE TIPO DE ARTÍCULO */}
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

                                 {/* PROMO BADGE */}
                                 {hasProductPromotion(product, config, activeTerminalId) && (
                                    <div
                                       className="absolute top-0 right-0 cursor-pointer z-20"
                                       onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedPromoProduct(product);
                                          setShowPromoSheet(true);
                                       }}
                                    >
                                       <div className="bg-red-500 text-white text-[10px] font-black px-2 py-1 rounded-bl-xl shadow-md flex items-center gap-1 animate-in slide-in-from-top-2 hover:bg-red-600 transition-colors">
                                          <Tag size={10} className="fill-white" />
                                          <span>OFERTA</span>
                                       </div>
                                    </div>
                                 )}
                              </div>
                           )}

                           {/* FALLBACK BADGES (NO IMAGE MODE) */}
                           {!uxConfig.showProductImages && hasProductPromotion(product, config, activeTerminalId) && (
                              <div
                                 className="absolute top-0 right-0 cursor-pointer z-20"
                                 onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedPromoProduct(product);
                                    setShowPromoSheet(true);
                                 }}
                              >
                                 <div className="bg-red-500 text-white text-[10px] font-black px-3 py-1.5 rounded-bl-2xl shadow-sm flex items-center gap-1 hover:bg-red-600 transition-colors">
                                    <Tag size={12} className="fill-white" />
                                    <span>OFERTA</span>
                                 </div>
                              </div>
                           )}
                           <div className="flex flex-col flex-1 justify-between gap-3">
                              <div className="space-y-1.5">
                                 <span className="block text-[9px] font-bold text-purple-500 uppercase opacity-60 line-clamp-1">{product.category}</span>
                                 <h3 className="font-bold text-gray-800 dark:text-white text-sm leading-tight line-clamp-2 min-h-[2.75rem]">{product.name}</h3>
                              </div>
                              <div className="pt-2 border-t border-gray-50 dark:border-slate-700"><span className="font-black text-lg text-gray-900 dark:text-white">{baseCurrency.symbol}{getProductPrice(product).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                           </div>
                        </div>
                     );
                  })}
               </div>
            </div>
            {/* VIRTUAL KEYBOARD SLOT */}
            {showVirtualKeyboard && (
               <div className="flex-none z-50">
                  <VirtualKeyboard
                     onKeyPress={(key) => setSearchTerm(prev => prev + key)}
                     onDelete={() => setSearchTerm(prev => prev.slice(0, -1))}
                     onClear={() => setSearchTerm('')}
                     onClose={() => {
                        setShowVirtualKeyboard(false);
                        // Optional: trigger search enter logic if needed
                     }}
                  />
               </div>
            )}

            {/* --- Novedad: ActionGrid (Rediseño Adaptativo) --- */}
            {activeTerminalConfig?.operational?.expandTicket && !isMobile && (
               <ActionGrid
                  orientation="horizontal"
                  onAction={handleGridAction}
                  parkedTicketsCount={parkedTickets.length}
                  isReturnMode={isReturnMode}
                  config={config}
                  hasCartItems={cart.length > 0}
                  globalDiscountValue={globalDiscount.value}
               />
            )}
         </div >

         {/* RIGHT SIDEBAR: CURRENT TICKET */}
         <div className={`w-full ${isRetailMode ? '' : 'md:w-96'} h-full min-h-0 bg-white border-l border-gray-200 shadow-2xl flex flex-col z-20 transition-all duration-300 ${mobileView === 'PRODUCTS' && !isRetailMode ? 'hidden md:flex' : 'flex'}`}>

            {/* MOBILE HEADER */}
            < div className="md:hidden p-4 border-b border-gray-100 bg-white flex flex-col gap-3 shrink-0" >
               <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                     <button onClick={() => setMobileView('PRODUCTS')} className="p-2 -ml-2 text-gray-400 hover:text-blue-600 transition-colors">
                        <ArrowLeft size={24} />
                     </button>
                     <h2 className="font-black text-gray-800 text-lg leading-tight">
                        {activeTable ? (
                           <div className="flex flex-col">
                              {(() => {
                                 const room = rooms?.find(r => r.id === activeTable.roomId);
                                 return room ? <span className="text-[10px] text-gray-400 -mb-1 font-bold uppercase">{room.name || room.nombre}</span> : null;
                              })()}
                              <span>Mesa {activeTable.nombre || activeTable.name}</span>
                           </div>
                        ) : 'Ticket Actual'}
                     </h2>
                  </div>
                  <div className="flex gap-1">
                     <button onClick={openParkAliasModal} className="p-2 text-gray-400 hover:text-blue-600" title="Guardar Ticket">
                        <Save size={20} />
                     </button>
                     <button onClick={() => setShowParkedList(!showParkedList)} className="p-2 text-gray-400 hover:text-orange-600 relative" title="Recuperar Ticket">
                        <Inbox size={20} />
                        {(Array.isArray(parkedTickets) ? parkedTickets : []).length > 0 && (
                           <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-orange-500 rounded-full border-2 border-white"></span>
                        )}
                     </button>
                     <div className="relative group">
                        <button className="p-2 text-gray-400 hover:text-gray-600"><MoreVertical size={20} /></button>
                        <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 hidden group-hover:block z-50">
                           <button onClick={onOpenHistory} className="w-full px-4 py-3 text-left text-sm font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-2"><History size={16} /> Historial</button>
                           <button onClick={onOpenFinance} className="w-full px-4 py-3 text-left text-sm font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-2"><Lock size={16} /> Cierre Z</button>
                           <button onClick={() => onOpenSettings()} className="w-full px-4 py-3 text-left text-sm font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-2"><Settings size={16} /> Ajustes</button>
                           <button onClick={onLogout} className="w-full px-4 py-3 text-left text-sm font-bold text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-gray-50"><LogOut size={16} /> Salir</button>
                        </div>
                     </div>
                  </div>
               </div>

               {/* CUSTOMER PILL (MOBILE) */}
               {
                  selectedCustomer ? (
                     <div className="flex items-center justify-between bg-blue-50 px-4 py-2 rounded-full border border-blue-100" onClick={onOpenCustomers}>
                        <div className="flex items-center gap-2">
                           <div className="w-6 h-6 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center font-bold text-[10px]">{selectedCustomer.name.charAt(0)}</div>
                           <span className="text-xs font-bold text-blue-900 truncate max-w-[150px]">{selectedCustomer.name}</span>
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

            {/* DESKTOP HEADER (HIDDEN ON MOBILE) */}
            <div className="hidden md:flex p-5 border-b border-gray-100 bg-gray-50/50 flex-col gap-3 shrink-0 flex-none" >
               <div className="flex justify-between items-center gap-4">
                  <div className="flex items-center gap-2 shrink-0">
                     <div className="flex flex-col">
                        <h2 className="font-black text-gray-800 uppercase text-xs tracking-widest whitespace-nowrap">
                           {activeTable ? (
                              <div className="flex flex-col">
                                 {(() => {
                                    const room = rooms?.find(r => r.id === activeTable.roomId);
                                    if (room) {
                                       return (
                                          <span className="text-[9px] text-gray-400 font-bold mb-0.5">
                                             {room.name || room.nombre}
                                          </span>
                                       );
                                    }
                                    return null;
                                 })()}
                                 <span className="flex items-center gap-1.5 text-blue-600">
                                    <Layout size={14} className="shrink-0" />
                                    Mesa {activeTable.nombre || activeTable.name}
                                 </span>
                              </div>
                           ) : (
                              'Ticket Actual'
                           )}
                        </h2>
                        {
                           (() => {
                              const ticketSeriesId = activeTerminalConfig?.documentAssignments?.['TICKET'];
                              const ticketSeries = activeTerminalConfig?.documentSeries?.find(s => s.id === ticketSeriesId);
                              if (ticketSeries) {
                                 return (
                                    <span className="text-[10px] text-gray-400 font-mono font-bold">
                                       {ticketSeries.prefix}{String(ticketSeries.nextNumber).padStart(ticketSeries.padding, '0')}
                                    </span>
                                 );
                              }
                              return null;
                           })()
                        }
                     </div>
                  </div>

                  {/* RETAIL MODE SEARCH BAR */}
                  {isRetailMode && (
                     <div className="flex-1 max-w-xl relative group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                           type="text"
                           readOnly={window.matchMedia('(pointer: coarse)').matches}
                           placeholder="Escanear o buscar..."
                           value={searchTerm}
                           onFocus={() => {
                              if (window.matchMedia('(pointer: coarse)').matches) {
                                 setShowVirtualKeyboard(true);
                              }
                           }}
                           onChange={(e) => setSearchTerm(e.target.value)}
                           onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                 const exactMatch = (products || []).find(p => p.barcode === searchTerm || p.id === searchTerm);
                                 if (exactMatch) {
                                    handleProductClick(exactMatch);
                                    setSearchTerm('');
                                    return;
                                 }
                                 if (filteredProducts.length === 1) {
                                    handleProductClick(filteredProducts[0]);
                                    setSearchTerm('');
                                    return;
                                 }
                              }
                           }}
                           autoFocus
                           className="w-full pl-10 pr-10 py-2.5 bg-gray-100 rounded-xl border-none outline-none focus:bg-white focus:ring-2 focus:ring-purple-500 text-sm font-bold transition-all"
                        />
                        <button onClick={() => setIsScannerOpen(true)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all"><ScanBarcode size={16} /></button>

                        {/* SEARCH RESULTS DROPDOWN */}
                        {searchTerm && filteredProducts.length > 0 && (
                           <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-100 max-h-[60vh] overflow-y-auto z-50">
                              {filteredProducts.map((product, idx) => (
                                 <div
                                    key={product.id || `search-prod-${idx}`}
                                    onClick={() => {
                                       handleProductClick(product);
                                       setSearchTerm('');
                                    }}
                                    className="p-3 hover:bg-purple-50 cursor-pointer border-b border-gray-50 last:border-0 flex justify-between items-center group"
                                 >
                                    <div>
                                       <p className="font-bold text-gray-800 text-sm group-hover:text-purple-700">{product.name}</p>
                                       <p className="text-[10px] text-gray-400 font-mono">{product.barcode || 'Sin Código'}</p>
                                    </div>
                                    <span className="font-black text-gray-900">{baseCurrency.symbol}{getProductPrice(product).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                 </div>
                              ))}
                           </div>
                        )}
                     </div>
                  )}

                  <div className="flex gap-1 shrink-0">
                     {!isRetailMode && (
                        <>
                           <button onClick={handleOpenDrawer} title="Abrir Cajón" className="p-2 hover:bg-emerald-50 rounded-lg text-gray-400 hover:text-emerald-600 transition-colors"><Box size={18} /></button>
                           <button onClick={openParkAliasModal} title="Guardar Ticket" className="p-2 hover:bg-blue-50 rounded-lg text-gray-400 hover:text-blue-600 transition-colors"><Save size={18} /></button>
                           <button onClick={() => setShowParkedList(!showParkedList)} title="Recuperar Ticket" className="p-2 hover:bg-orange-50 rounded-lg text-gray-400 hover:text-orange-600 transition-colors relative">
                              <Inbox size={18} />
                              {(Array.isArray(parkedTickets) ? parkedTickets : []).length > 0 && <span className="absolute top-0 right-0 w-3 h-3 bg-orange-500 rounded-full border-2 border-white"></span>}
                           </button>
                           <button onClick={onOpenHistory} title="Historial" className="p-2 hover:bg-gray-200 rounded-lg text-gray-400 hover:text-blue-600 transition-colors"><History size={18} /></button>
                        </>
                     )}
                     <button onClick={() => onOpenSettings()} title="Configuración" className="p-2 hover:bg-gray-200 rounded-lg text-gray-400 hover:text-blue-600 transition-colors"><Settings size={18} /></button>
                  </div>
               </div>

               {
                  selectedCustomer ? (
                     <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50/50 rounded-xl border border-blue-100 animate-in slide-in-from-top-2">
                        <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-black">
                           {selectedCustomer.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                           <div className="flex items-center gap-2">
                              <p className="font-bold text-gray-800 truncate">{selectedCustomer.name}</p>
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
                     <button onClick={onOpenCustomers} className="w-full flex items-center justify-between p-3 bg-white border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:text-blue-500 group"><div className="flex items-center gap-2"><UserPlus size={18} /><span className="text-xs font-bold uppercase">Asignar Cliente</span></div><ChevronRight size={16} /></button>
                  )
               }

               <div className={`mt-1 flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase ${fiscalStatus.hasNCF ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100 animate-pulse'}`}>
                  <Landmark size={12} />
                  <span>Status Fiscal: {fiscalStatus.type} {fiscalStatus.hasNCF ? (fiscalStatus.isUsingPool ? 'Reservado en Pool' : 'Lote Activo') : 'Agotado'}</span>
               </div>
            </div >

            {/* --- CART ITEMS LIST --- */}
            {isRetailMode ? (
               // SUPERMARKET MODE (DENSE TABLE)
               <ProductTableSupermarket
                  cart={processedCart}
                  config={config}
                  currencySymbol={baseCurrency.symbol}
                  lastAddedCartId={lastAddedCartId}
                  onRemoveItem={(cartId) => updateCartItem(null, cartId)}
                  containerStyle={isMobile ? bottomAwareScrollStyle : undefined}
               />
            ) : (
               // STANDARD RESTAURANT/RETAIL LIST
               <div
                  className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-gray-50/50"
                  style={isMobile ? bottomAwareScrollStyle : undefined}
               >
                  {
                     processedCart.map((item, idx) => {
                        const hasDiscount = item.originalPrice && item.price < item.originalPrice;
                        const discountPct = hasDiscount ? Math.round((1 - item.price / item.originalPrice!) * 100) : 0;
                        const lineNet = item.price * item.quantity;

                        // MOBILE CARD DESIGN
                        if (isMobile) {
                           return (
                              <div key={item.cartId || `cart-m-${idx}`} className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 flex gap-3 animate-in slide-in-from-right-2">
                                 <div className="w-16 h-16 rounded-xl bg-gray-50 overflow-hidden shrink-0 border border-gray-100">
                                    {item.image ? <img src={item.image} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-300"><Grid size={24} /></div>}
                                 </div>
                                 <div className="flex-1 min-w-0 flex flex-col justify-between">
                                    <div>
                                       <div className="flex justify-between items-start">
                                          <h4 className="font-bold text-gray-800 text-sm leading-tight line-clamp-1">{item.name}</h4>
                                          <button onClick={() => updateCartItem(null, item.cartId)} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={16} /></button>
                                       </div>
                                       <div className="flex flex-col mt-0.5">
                                          <div className="flex items-center gap-2">
                                             <span className="text-xs font-black text-blue-600">{baseCurrency.symbol}{(item.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                             {hasDiscount && <span className="text-[10px] text-red-500 font-bold line-through">{baseCurrency.symbol}{item.originalPrice?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                                          </div>
                                          <span className="text-[9px] font-bold text-gray-500 uppercase tracking-tighter">
                                             ITBIS: {(config.taxRate ? config.taxRate * 100 : 18)}% ({baseCurrency.symbol}{(item.price * item.quantity * (config.taxRate || 0.18)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                          </span>
                                       </div>
                                       {item.salespersonId && (
                                          <div className="mt-1 flex items-center gap-1 text-[9px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-md w-fit">
                                             <User size={10} />
                                             <span>{users?.find(u => u.id === item.salespersonId)?.name || 'Vendedor'}</span>
                                          </div>
                                       )}
                                    </div>
                                    <div className="flex items-center justify-between mt-2">
                                       <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-1">
                                          <button onClick={() => updateCartItem({ ...item, quantity: item.quantity - 1 })} className="w-6 h-6 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 hover:text-red-500 font-bold">-</button>
                                          <span className="text-xs font-black min-w-[20px] text-center">{item.quantity}</span>
                                          <button onClick={() => updateCartItem({ ...item, quantity: item.quantity + 1 })} className="w-6 h-6 flex items-center justify-center bg-blue-600 rounded shadow-sm text-white hover:bg-blue-700 font-bold">+</button>
                                       </div>
                                       <span className="font-black text-gray-900 text-sm">{baseCurrency.symbol}{lineNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </div>
                                 </div>
                              </div>
                           );
                        }

                        // DESKTOP CARD DESIGN (Restaurant/Retail)
                        return (
                           <div key={item.cartId || `cart-${idx}`} className={`bg-white rounded-xl p-3 shadow-sm border border-gray-100 group relative overflow-hidden transition-all hover:shadow-md ${editingItem?.cartId === item.cartId ? 'ring-2 ring-blue-500 bg-blue-50' : ''}`}>
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
                                       {item.image ? <img src={item.image} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-300"><Grid size={20} /></div>}
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
                                             <div className="flex items-center gap-1 text-[10px] text-gray-500">
                                                <span>{item.quantity} x {baseCurrency.symbol}{item.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                {item.modifiers && item.modifiers.length > 0 && <span className="text-blue-600 font-bold ml-1">+{item.modifiers.length} mod</span>}
                                             </div>
                                             <div className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">
                                                ITBIS: {(config.taxRate ? config.taxRate * 100 : 18)}% ({baseCurrency.symbol}{(item.price * item.quantity * (config.taxRate || 0.18)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                             </div>
                                          </div>
                                          {/* Salesperson Badge */}
                                          {item.salespersonId && (
                                             <div className="flex items-center gap-1 text-[9px] text-gray-400 mt-0.5">
                                                <User size={10} />
                                                <span className="truncate max-w-[80px]">{users?.find(u => u.id === item.salespersonId)?.name || '...'}</span>
                                             </div>
                                          )}
                                       </div>

                                       {/* Actions */}
                                       <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <button onClick={() => updateCartItem({ ...item, quantity: item.quantity - 1 }, item.cartId)} className="w-6 h-6 flex items-center justify-center rounded bg-white shadow-sm text-gray-600 hover:text-red-500 hover:bg-red-50 transition-colors"><Minus size={12} strokeWidth={3} /></button>
                                          <button onClick={() => updateCartItem({ ...item, quantity: item.quantity + 1 }, item.cartId)} className="w-6 h-6 flex items-center justify-center rounded bg-white shadow-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition-colors"><Plus size={12} strokeWidth={3} /></button>
                                          <div className="w-px h-3 bg-gray-300 mx-0.5" />
                                          <button
                                             onClick={() => {
                                                setEditingItem(item);
                                                // If needed, open modifier modal
                                             }}
                                             className="w-6 h-6 flex items-center justify-center rounded bg-white shadow-sm text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                          >
                                             <Edit3 size={12} />
                                          </button>
                                          <button onClick={() => updateCartItem(null, item.cartId)} className="w-6 h-6 flex items-center justify-center rounded bg-white shadow-sm text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"><Trash2 size={12} /></button>
                                       </div>
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
                  }
               </div >
            )}
            < div ref={cartEndRef} />

            {activeRecoveredReservation && (
               <div className="mx-4 mb-3 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800">
                  <p className="text-[10px] font-black uppercase tracking-widest">Reserva Recuperada</p>
                  <p className="text-xs font-bold mt-1">{activeRecoveredReservation.code} • {activeRecoveredReservation.customerName}</p>
                  <p className="text-[11px] mt-1">
                     Total: {baseCurrency.symbol}{cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Anticipo: {baseCurrency.symbol}{reservationAdvanceApplied.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Saldo: {baseCurrency.symbol}{reservationBalanceDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
               </div>
            )}

            {/* Sidebar Footer */}
            <div className={`flex-none bg-white border-t border-gray-200 p-4 shadow-inner ${isRetailMode ? 'flex flex-row-reverse items-center justify-between gap-6' : 'space-y-3'} ${isMobile ? 'hidden' : ''}`}>
               {/* DESKTOP FOOTER CONTENT (UNCHANGED) */}
               {
                  isRetailMode ? (
                     // --- RETAIL MODE FOOTER (HORIZONTAL) ---
                     <>
                        {/* RIGHT: PAY & TOTAL */}
                        <div className="flex items-center gap-6">
                           {/* TOTALS BREAKDOWN */}
                           <div className="hidden xl:flex items-center gap-6 mr-2">
                              <div className="text-right">
                                 <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Subtotal</p>
                                 <p className="text-lg font-bold text-gray-700">{baseCurrency.symbol}{cartSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                              </div>
                              {discountAmount > 0 && (
                                 <div className="text-right">
                                    <p className="text-[10px] text-red-400 font-bold uppercase tracking-wider">Descuento</p>
                                    <p className="text-lg font-bold text-red-500">-{baseCurrency.symbol}{discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                 </div>
                              )}
                              <div className="text-right">
                                 <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Impuestos</p>
                                 <p className="text-lg font-bold text-gray-700">{baseCurrency.symbol}{cartTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                              </div>
                              <div className="w-px h-10 bg-gray-200"></div>
                           </div>

                           <div className="text-right hidden sm:block">
                              <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Total a Pagar</p>
                              <div className="text-4xl font-black text-slate-900 leading-none tracking-tighter">
                                 {baseCurrency.symbol}{cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </div>
                              <p className="text-[10px] font-bold text-gray-400 mt-1">
                                 {cart.reduce((acc, i) => acc + i.quantity, 0)} Artículos
                                 {pointsEarned > 0 && <span className="text-purple-500 ml-2">• Ganarás +{pointsEarned} pts</span>}
                              </p>
                           </div>
                           <button
                              onClick={() => {
                                 if (cart.length > 0 && fiscalStatus.hasNCF) {
                                    const validation = validateTerminalDocument(config, terminalId, 'TICKET');
                                    if (!validation.isValid) {
                                       alert(validation.error);
                                       return;
                                    }
                                    if (!canProceedWithOperationalSession()) return;
                                    proceedToCheckout();
                                 } else if (!fiscalStatus.hasNCF) {
                                    alert("No hay secuencias fiscales disponibles.");
                                 }
                              }}
                              disabled={cart.length === 0 || !fiscalStatus.hasNCF}
                              className={`h-16 px-8 rounded-2xl font-black text-xl shadow-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3 ${!fiscalStatus.hasNCF ? 'bg-red-100 text-red-500 cursor-not-allowed border-2 border-red-200' : 'bg-slate-900 text-white hover:bg-black'}`}
                           >
                              <span>{!fiscalStatus.hasNCF ? 'Sin Secuencia' : (activeRecoveredReservation ? 'COBRAR SALDO' : 'COBRAR')}</span>
                              <ArrowRight size={24} />
                           </button>
                        </div>

                        <div className="flex-1 w-full min-w-0 pr-4">
                           <ActionGrid
                              orientation="horizontal"
                              onAction={handleGridAction}
                              config={config}
                              parkedTicketsCount={parkedTickets.length}
                              isReturnMode={isReturnMode}
                              hasCartItems={cart.length > 0}
                              globalDiscountValue={globalDiscount.value}
                           />
                        </div>

                     </>
                  ) : (
                     // --- VISUAL MODE FOOTER (VERTICAL) ---
                     <>




                        {/* --- CONDITIONAL FOOTER --- */}
                        {isKioskMode ? (
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
                              {/* --- BOTONES DE ACCIÓN (ActionGrid Adaptativo) --- */}
                              {!activeTerminalConfig?.operational?.expandTicket && (
                                 <div className="animate-in fade-in duration-300">
                                    <ActionGrid
                                       orientation="vertical"
                                       onAction={handleGridAction}
                                       config={config}
                                       parkedTicketsCount={parkedTickets.length}
                                       isReturnMode={isReturnMode}
                                       hasCartItems={cart.length > 0}
                                       globalDiscountValue={globalDiscount.value}
                                    />
                                 </div>
                              )}

                              {/* --- BLOQUE DE TOTALES --- */}
                              <div className="space-y-1.5 pt-1 border-t border-dashed border-gray-200 mt-2">
                                 <div className="flex justify-between items-center text-xs font-bold text-gray-500">
                                    <span>SUBTOTAL</span>
                                    <span>{baseCurrency.symbol}{cartSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                 </div>
                                 {discountAmount > 0 && (
                                    <div className="flex justify-between items-center text-xs font-black text-red-500">
                                       <span>DESCUENTO</span>
                                       <span>-{baseCurrency.symbol}{discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </div>
                                 )}
                                 <div className="flex justify-between items-center text-xs font-bold text-gray-500">
                                    <span>IMPUESTOS</span>
                                    <span>{baseCurrency.symbol}{cartTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                 </div>

                                 <div className="flex justify-between items-end pt-2">
                                    <div className="text-4xl font-black text-slate-900 leading-none tracking-tighter">
                                       {baseCurrency.symbol}{cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                    <div className="text-right">
                                       <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Total General</p>
                                       {pointsEarned > 0 && <p className="text-[10px] font-bold text-purple-500">+{pointsEarned} Puntos</p>}
                                    </div>
                                 </div>
                              </div>

                              <button
                                 onClick={() => {
                                    if (cart.length > 0 && fiscalStatus.hasNCF) {
                                       const validation = validateTerminalDocument(config, terminalId, 'TICKET');
                                       if (!validation.isValid) {
                                          alert(validation.error);
                                          return;
                                       }
                                       if (!canProceedWithOperationalSession()) return;
                                       proceedToCheckout();
                                    } else if (!fiscalStatus.hasNCF) {
                                       alert("No hay secuencias fiscales disponibles.");
                                    }
                                 }}
                                 disabled={cart.length === 0 || !fiscalStatus.hasNCF}
                                 className={`w-full py-4 rounded-2xl font-black text-xl shadow-xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 ${!fiscalStatus.hasNCF ? 'bg-red-100 text-red-500 cursor-not-allowed border-2 border-red-200' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                              >
                                 <span>{!fiscalStatus.hasNCF ? 'Sin Secuencia' : (activeRecoveredReservation ? 'COBRAR SALDO' : 'COBRAR')}</span>
                                 <ArrowRight size={24} />
                              </button>
                           </>
                        )}
                     </>
                  )
               }
            </div >
         </div>

         {/* MOBILE STICKY FOOTER */}
         {
            isMobile && mobileView === 'TICKET' && (
               <div
                  ref={mobileFooterRef}
                  className="md:hidden fixed left-0 right-0 bg-white border-t border-gray-100 p-4 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] z-50 animate-in slide-in-from-bottom-5"
                  style={mobileFooterStyle}
               >
                  <div className="flex justify-between items-center mb-4 px-2">
                     <div className="flex gap-4">
                        <button onClick={() => setShowGlobalDiscount(true)} className="flex flex-col items-center gap-1 text-gray-400 hover:text-pink-500">
                           <Percent size={18} />
                           <span className="text-[9px] font-bold uppercase">Desc.</span>
                        </button>
                        <button onClick={() => setShowCouponModal(true)} className="flex flex-col items-center gap-1 text-gray-400 hover:text-cyan-500">
                           <QrCode size={18} />
                           <span className="text-[9px] font-bold uppercase">Cupón</span>
                        </button>
                        <button onClick={openParkAliasModal} className="flex flex-col items-center gap-1 text-gray-400 hover:text-blue-500">
                           <Save size={18} />
                           <span className="text-[9px] font-bold uppercase">Grd.</span>
                        </button>
                        <button onClick={() => setShowParkedList(!showParkedList)} className="flex flex-col items-center gap-1 text-gray-400 hover:text-orange-500 relative">
                           <Inbox size={18} />
                           <span className="text-[9px] font-bold uppercase">Esp.</span>
                           {(Array.isArray(parkedTickets) ? parkedTickets : []).length > 0 && <span className="absolute -top-1 -right-1 w-2 h-2 bg-orange-500 rounded-full"></span>}
                        </button>
                        <button onClick={openReservationModal} className="flex flex-col items-center gap-1 text-gray-400 hover:text-amber-600">
                           <StickyNote size={18} />
                           <span className="text-[9px] font-bold uppercase">Res.</span>
                        </button>
                        <button onClick={openRecoverReservationModal} className="flex flex-col items-center gap-1 text-gray-400 hover:text-teal-600">
                           <QrCode size={18} />
                           <span className="text-[9px] font-bold uppercase">Rec.</span>
                        </button>
                        {activeTerminalConfig?.operational?.usa_modulos_cocina && (
                           <button onClick={handleDispatchCommand} className="flex flex-col items-center gap-1 text-gray-400 hover:text-orange-600">
                              <ChefHat size={18} />
                              <span className="text-[9px] font-bold uppercase">March.</span>
                           </button>
                        )}
                        <button onClick={() => onOpenInventoryTracking()} className="flex flex-col items-center gap-1 text-gray-400 hover:text-indigo-500">
                           <Package size={18} />
                           <span className="text-[9px] font-bold uppercase">Rast.</span>
                        </button>
                     </div>
                     <div className="text-right">
                        <span className="text-[10px] font-bold text-gray-400 uppercase block">Subtotal: {baseCurrency.symbol}{cartSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        {discountAmount > 0 && <span className="text-[10px] font-bold text-red-500 uppercase block">Desc: -{baseCurrency.symbol}{discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                     </div>
                  </div>
                  <div className="flex items-center gap-4">
                     <div className="flex-1">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block leading-none mb-1">Total</span>
                        <span className="text-3xl font-black text-gray-900 tracking-tighter leading-none">{baseCurrency.symbol}{cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                     </div>
                     <button
                        onClick={() => {
                           if (cart.length > 0 && fiscalStatus.hasNCF) {
                              if (!canProceedWithOperationalSession()) return;
                              proceedToCheckout();
                           }
                        }}
                        disabled={cart.length === 0 || !fiscalStatus.hasNCF}
                        className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black text-lg shadow-lg shadow-blue-200 active:scale-95 transition-all flex items-center gap-2"
                     >
                        <span>{activeRecoveredReservation ? 'COBRAR SALDO' : 'COBRAR'}</span>
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
         {showPaymentModal && <UnifiedPaymentModal total={amountDueNow} items={cart} currencySymbol={baseCurrency.symbol} config={config} onClose={() => setShowPaymentModal(false)} onConfirm={handlePaymentConfirm} themeColor={config.themeColor} customer={selectedCustomer} isDelinquent={isDelinquent} users={users} roles={roles} isMaster={isMaster} currentUser={currentUser} />}
         {showLoyaltyModal && <LoyaltyScanModal onClose={() => setShowLoyaltyModal(false)} onScan={handleLoyaltyScan} />}
         {editingItem && <CartItemOptionsModal item={editingItem} config={config} users={users} roles={roles} onClose={() => setEditingItem(null)} onUpdate={updateCartItem} canApplyDiscount={true} canVoidItem={true} />}
         {selectedProductForVariants && <ProductVariantSelector product={selectedProductForVariants} currencySymbol={baseCurrency.symbol} onClose={() => setSelectedProductForVariants(null)} onConfirm={(p, m, pr) => { addToCart(p, 1, pr, m); setSelectedProductForVariants(null); }} />}
         {productForScale && <ScaleModal product={productForScale} currencySymbol={baseCurrency.symbol} onClose={() => setProductForScale(null)} onConfirm={(w) => { addToCart(productForScale, w); setProductForScale(null); }} />}
         {
            showGlobalDiscount && <GlobalDiscountModal currentSubtotal={cartSubtotal} currencySymbol={baseCurrency.symbol} initialValue={globalDiscount.value.toString()} initialType={globalDiscount.type} themeColor={config.themeColor} onClose={() => setShowGlobalDiscount(false)} onConfirm={async (val, type) => {
               const numVal = parseFloat(val) || 0;
               const authorized = await requestApproval({
                  permission: 'POS_DISCOUNT',
                  actionDescription: 'Aplicar Descuento Global',
                  context: { newValue: type === 'PERCENT' ? numVal : undefined, originalValue: cartSubtotal }
               });
               if (!authorized) return;

               setGlobalDiscount({ value: numVal, type });
               setShowGlobalDiscount(false);
            }} />
         }

         <SupervisorModal {...supervisorModalProps} users={users} />

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
                           Recuperar Reserva
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
                                 placeholder="Buscar por cliente, código o ID..."
                                 className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-teal-100"
                              />
                           </div>
                           <button
                              onClick={() => {
                                 closeRecoverReservationModal();
                                 setIsScannerOpen(true);
                              }}
                              className="px-4 py-2.5 rounded-xl border border-teal-200 bg-teal-50 text-teal-700 font-bold hover:bg-teal-100"
                           >
                              Escanear QR
                           </button>
                        </div>

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

                        <div className="max-h-[45vh] overflow-y-auto space-y-2">
                           {filteredActiveReservations.map(reservation => (
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
                           ))}
                           {filteredActiveReservations.length === 0 && (
                              <div className="p-8 rounded-xl border border-dashed border-gray-200 text-center text-sm text-gray-400">
                                 No hay reservas activas para mostrar.
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
                                 const printed = await printReservation(showReservationReceipt, config);
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
                        <h3 className="font-black text-xl text-gray-800">Guardar En Espera</h3>
                        <p className="text-sm text-gray-500 mt-1">Agrega un alias para ubicar esta factura más rápido.</p>
                     </div>
                     <button onClick={closeParkAliasModal} className="p-2 hover:bg-gray-200 rounded-full">
                        <X size={20} />
                     </button>
                  </div>
                  <div className="p-6 space-y-4">
                     <div>
                        <label htmlFor="park-ticket-alias" className="block text-sm font-bold text-gray-700 mb-2">
                           Alias de la factura
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
                           placeholder="Ej. Cliente VIP, Pedido oficina, Recoger luego"
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
                        Guardar En Espera
                     </button>
                  </div>
               </div>
            </div>
         )}

         {/* List of Parked Tickets */}
         {
            showParkedList && (
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
                                 <span className="text-xs text-gray-500">{pt.items.length} productos</span>
                                 <ArrowRight size={16} className="text-orange-300 group-hover:text-orange-500 transition-colors" />
                              </div>
                           </div>
                        ))}
                        {(Array.isArray(parkedTickets) ? parkedTickets : []).length === 0 && <div className="py-10 text-center text-gray-400 italic">No hay tickets guardados</div>}
                     </div>
                  </div>
               </div>
            )
         }

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
               // 0. Try Smart QR (JSON)
               const trimmed = code.trim();
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
                     onOpenSettings('CATALOG', { productId: p.id });
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
      </div >
   );
};

export default POSInterface;
