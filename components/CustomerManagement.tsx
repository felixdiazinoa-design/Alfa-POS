
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
   ArrowLeft, Users, UserPlus, Search, Phone, Mail, MapPin,
   Edit2, Trash2, Save, X, FileText, Award, Wallet as WalletIcon,
   TrendingUp, TrendingDown, AlertCircle, CreditCard, History, Check,
   MessageCircle, Star, Tag, ChevronRight, ShoppingBag,
   Globe, Calendar, Map, Navigation, CheckSquare, Clock, Landmark, ShieldCheck, Zap, Gift,
   Loader2, AlertOctagon, Printer, DollarSign, Banknote, QrCode, ArrowRightLeft, BadgeCheck
} from 'lucide-react';
import { Customer, BusinessConfig, CustomerTransaction, CustomerAddress, NCFType, Wallet, LoyaltyCard, Transaction, User, Collection, Activity, WalletTransaction } from '../types';
import { dgiiService, DGIIResponse } from '../services/dgii/DGIIValidationService';
import { printTicket } from '../utils/printer';
import { getTierBadgeClass, getTierLabel, isEgoClubEnabled } from '../utils/egoClub';
import { listLoyaltyOutbox, type LoyaltyOutboxItem } from '../utils/loyaltyOutbox';
import { flushLoyaltyOutbox } from '../services/loyalty/LoyaltyService';
import EgoClubEnrollModal from './EgoClubEnrollModal';
import EgoClubCard from './EgoClubCard';
import AccountReceivableModal from './AccountReceivableModal';
import CreditAccountDashboard from './CreditAccountDashboard';
import { agendaService } from '../services/AgendaService';
import ActivityModal from './ActivityModal';
import LoyaltyDashboard from './LoyaltyDashboard';

interface CustomerManagementProps {
   customers: Customer[];
   config: BusinessConfig;
   onAddCustomer: (customer: Customer) => void;
   onUpdateCustomer: (customer: Customer) => void;
   onDeleteCustomer: (id: string) => void;
   onSelect?: (customer: Customer) => void; // Prop para modo selección
   onClose: () => void;
   currentUser: User;
   terminalId: string;
   collections: Collection[];
   onUpdateCollections: (collections: Collection[]) => void;
   rooms: any[];
   users: User[];
}

const CustomerManagement: React.FC<CustomerManagementProps> = ({
   customers,
   config,
   onAddCustomer,
   onUpdateCustomer,
   onDeleteCustomer,
   onSelect,
   onClose,
   currentUser,
   terminalId,
   collections,
   onUpdateCollections,
   rooms,
   users
}) => {
   const [searchTerm, setSearchTerm] = useState('');
   const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
   const [isEditModalOpen, setIsEditModalOpen] = useState(false);
   const [activeProfileTab, setActiveProfileTab] = useState<'HISTORY' | 'WALLET' | 'LOYALTY' | 'CREDIT' | 'AGENDA'>('HISTORY');
   const [editModalTab, setEditModalTab] = useState<'GENERAL' | 'ADDRESSES'>('GENERAL');
   const [isAbonoModalOpen, setIsAbonoModalOpen] = useState(false);
   const [abonoInitialAmount, setAbonoInitialAmount] = useState<number | undefined>(undefined);
   const [abonoInitialInvoices, setAbonoInitialInvoices] = useState<string[] | undefined>(undefined);

   // Agenda State
   const [customerActivities, setCustomerActivities] = useState<Activity[]>([]);
   const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
   const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
   const [prefilledDate, setPrefilledDate] = useState<Date | null>(null);

   // Filter State
   const [filterTag, setFilterTag] = useState<string>('ALL');

   // EGO Club: alta de socio y estado de la cola de envío al ERP
   const [isEgoEnrollOpen, setIsEgoEnrollOpen] = useState(false);
   const [isEgoCardOpen, setIsEgoCardOpen] = useState(false);
   const [loyaltyQueue, setLoyaltyQueue] = useState<LoyaltyOutboxItem[]>([]);
   const [isLoyaltyQueueOpen, setIsLoyaltyQueueOpen] = useState(false);

   // Form State
   const [formData, setFormData] = useState<Partial<Customer>>({});

   // Address Form State (for adding/editing inside modal)
   const [isAddressFormOpen, setIsAddressFormOpen] = useState(false);
   const [editingAddress, setEditingAddress] = useState<Partial<CustomerAddress>>({});

   // Card Linking State
   const [isLinkCardOpen, setIsLinkCardOpen] = useState(false);
   const [cardLinkInput, setCardLinkInput] = useState('');
   const [cardLinkType, setCardLinkType] = useState<'LOYALTY' | 'GIFT'>('LOYALTY');

   // DGII Validation State
   const [isValidatingRNC, setIsValidatingRNC] = useState(false);
   const [validationError, setValidationError] = useState<string | null>(null);

   // --- HYBRID SEARCH STATE ---
   const [searchingDGII, setSearchingDGII] = useState(false);
   const [remoteResult, setRemoteResult] = useState<Customer | null>(null);

   // --- TRANSACTION DETAIL STATE ---
   const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
   const [customerTransactions, setCustomerTransactions] = useState<Transaction[]>([]);
   const [walletMovements, setWalletMovements] = useState<WalletTransaction[]>([]);

   const CREDIT_METHOD_MARKERS = useMemo(() => new Set(['CREDIT', 'CREDITO', 'PENDIENTE']), []);

   const normalizeMethod = (value: unknown): string => {
      if (typeof value !== 'string') return '';
      return value
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

   const toSafeNumber = (value: unknown): number => {
      const num = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(num) ? num : 0;
   };

   const formatMoney = (value: unknown): string =>
      toSafeNumber(value).toLocaleString(undefined, {
         minimumFractionDigits: 2,
         maximumFractionDigits: 2
      });

   const isRNC = (term: string) => /^\d{9,11}$/.test(term);

   const selectedCustomer = useMemo(() =>
      customers.find(c => c.id === selectedCustomerId),
      [customers, selectedCustomerId]);

   const allocationsByTransactionId = useMemo(() => {
      const map = new globalThis.Map<string, number>();
      const selectedId = selectedCustomer?.id;
      if (!selectedId) return map;

      for (const collection of collections || []) {
         if (collection?.customerId !== selectedId) continue;
         const allocations = Array.isArray(collection.allocations) ? collection.allocations : [];
         for (const alloc of allocations) {
            const txId = alloc?.transactionId;
            if (!txId) continue;
            const current = map.get(txId) || 0;
            map.set(txId, parseFloat((current + toPositiveNumber(alloc.amount)).toFixed(2)));
         }
      }
      return map;
   }, [collections, selectedCustomer?.id]);

   const getEffectivePendingBalance = useCallback((tx: Transaction): number => {
      if (tx.status === 'REFUNDED') return 0;

      const explicitPendingRaw = tx.pendingBalance;
      const hasExplicitPending = typeof explicitPendingRaw === 'number' && Number.isFinite(explicitPendingRaw);
      const explicitPending = hasExplicitPending ? Math.max(0, explicitPendingRaw) : 0;

      const paymentEntries = Array.isArray(tx.payments) ? tx.payments : [];
      const creditFromPayments = paymentEntries.reduce((sum: number, payment: any) => {
         const markers = [
            normalizeMethod(payment?.method),
            normalizeMethod(payment?.methodLabel),
            normalizeMethod(payment?.methodId),
            normalizeMethod(payment?.type)
         ];
         const isCredit = markers.some(marker => CREDIT_METHOD_MARKERS.has(marker));
         if (!isCredit) return sum;
         return sum + toPositiveNumber(payment?.amount);
      }, 0);

      const creditIssued = Math.max(
         creditFromPayments,
         toPositiveNumber(tx.balanceDueAtSale)
      );

      const allocated = allocationsByTransactionId.get(tx.id) || 0;
      const inferredPending = Math.max(0, parseFloat((creditIssued - allocated).toFixed(2)));

      if (hasExplicitPending && explicitPending > 0) {
         return parseFloat(explicitPending.toFixed(2));
      }

      if (creditIssued > 0) {
         return inferredPending;
      }

      return hasExplicitPending ? parseFloat(explicitPending.toFixed(2)) : 0;
   }, [allocationsByTransactionId, CREDIT_METHOD_MARKERS]);

   const filteredCustomers = useMemo(() => {
      // If we have a remote result and search term matches its RNC, include it or prioritize it?
      // Actually we'll handle remote result separately in the UI
      return customers.filter(c => {
         const searchLower = searchTerm.toLowerCase();
         const matchesSearch =
            c.name.toLowerCase().includes(searchLower) ||
            c.phone?.includes(searchTerm) ||
            c.email?.toLowerCase().includes(searchLower) ||
            c.taxId?.includes(searchTerm);

         const matchesTag = filterTag === 'ALL' || (c.tags || []).includes(filterTag);

         return matchesSearch && matchesTag;
      });
   }, [customers, searchTerm, filterTag]);

   // --- HYBRID SEARCH HANDLER ---
   // Triggered on input change or debounced?
   // For now let's trigger DGII search if it looks like an RNC and no local results
   useEffect(() => {
      const performRemoteSearch = async () => {
         if (!isRNC(searchTerm)) {
            setRemoteResult(null);
            return;
         }

         // Check if we already have it locally
         const localExists = customers.some(c => c.taxId === searchTerm);
         if (localExists) {
            setRemoteResult(null);
            return;
         }

         setSearchingDGII(true);
         try {
            const data: DGIIResponse = await dgiiService.validateRNC(searchTerm);
            if (data.status === 'ACTIVO' || data.status === 'INACTIVO') { // Show result even if inactive? Implementation plan says validateRNC
               // Construct Temporary Customer
               const tempCustomer: Customer = {
                  id: `temp_${searchTerm}_${Date.now()}`,
                  name: data.name || 'CONTRIBUYENTE DESCONOCIDO',
                  taxId: data.rnc,
                  fiscalStatus: data.status,
                  isTemporary: true,
                  verifiedAt: new Date().toISOString(),
                  dgiiData: {
                     commercialName: data.commercialName,
                     economicActivity: data.economicActivity,
                     regimeType: data.regimeType
                  },
                  defaultNcfType: data.status === 'ACTIVO' ? 'B01' : 'B02', // Auto-NCF logic
                  // Defaults
                  totalSpent: 0,
                  currentDebt: 0,
                  loyaltyPoints: 0,
                  cards: [],
                  balance: 0,
                  currency: 'DOP',
                  status: 'ACTIVE',
                  lastActivity: new Date().toISOString(),
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
               } as Customer;
               setRemoteResult(tempCustomer);
            } else {
               setRemoteResult(null);
            }
         } catch (e) {
            console.error("DGII Search failed", e);
            setRemoteResult(null);
         } finally {
            setSearchingDGII(false);
         }
      };

      const timer = setTimeout(performRemoteSearch, 800); // 800ms debounce
      return () => clearTimeout(timer);
   }, [searchTerm, customers]);

   // --- HANDLERS ---

   const refreshLoyaltyQueue = useCallback(async () => {
      try {
         setLoyaltyQueue(await listLoyaltyOutbox());
      } catch (error) {
         console.warn('[EGO CLUB] no se pudo leer la cola local:', error);
      }
   }, []);

   useEffect(() => {
      void refreshLoyaltyQueue();
   }, [refreshLoyaltyQueue]);

   const handleCreateClick = () => {
      setSelectedCustomerId(null);
      setFormData({
         name: '',
         phone: '',
         email: '',
         taxId: '',
         address: '',
         notes: '',
         loyaltyPoints: 0,
         creditLimit: 0,
         currentDebt: 0,
         tags: [],
         tier: 'BRONZE',
         requiresFiscalInvoice: false,
         prefersEmail: false,
         isTaxExempt: false,
         applyChainedTax: false,
         addresses: [],
         defaultNcfType: 'B02'
      });
      setEditModalTab('GENERAL');
      setIsEditModalOpen(true);
   };

   const handleEditClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedCustomer) return;
      setFormData({
         ...selectedCustomer,
         addresses: selectedCustomer.addresses || [],
         defaultNcfType: selectedCustomer.defaultNcfType || (selectedCustomer.requiresFiscalInvoice ? 'B01' : 'B02')
      });
      setEditModalTab('GENERAL');
      setIsEditModalOpen(true);
   };

   const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!formData.name) return;

      if (formData.id) {
         onUpdateCustomer({ ...formData } as Customer);
      } else {
         const newCustomer: Customer = {
            ...formData as Customer,
            id: Math.random().toString(36).substr(2, 9),
            createdAt: new Date().toISOString(),
            totalSpent: 0,
            lastVisit: new Date().toISOString()
         };
         onAddCustomer(newCustomer);
         setSelectedCustomerId(newCustomer.id);
      }
      setIsEditModalOpen(false);
   };

   const handleDelete = (id: string) => {
      if (confirm('¿Eliminar cliente permanentemente?')) {
         onDeleteCustomer(id);
         if (selectedCustomerId === id) setSelectedCustomerId(null);
      }
   };

   // --- DGII VALIDATION LOGIC ---
   const handleValidateRNC = async () => {
      const rnc = formData.taxId;
      if (!rnc || rnc.length < 9) {
         setValidationError('RNC/Cédula debe tener al menos 9 dígitos');
         return;
      }

      setIsValidatingRNC(true);
      setValidationError(null);

      try {
         const dgiiData: DGIIResponse = await dgiiService.validateRNC(rnc);

         if (dgiiData.error) {
            setValidationError(dgiiData.error);
            setIsValidatingRNC(false);
            return;
         }

         // Show warning if not ACTIVO
         if (dgiiData.status !== 'ACTIVO') {
            const message = `⚠️ ATENCIÓN: Contribuyente ${dgiiData.status}\n\n` +
               `RNC: ${dgiiData.rnc}\n` +
               `Nombre: ${dgiiData.name}\n\n` +
               `Este contribuyente NO está vigente en DGII.\n` +
               `No se puede emitir crédito fiscal B01.`;
            alert(message);
         }

         // Auto-populate fields
         setFormData({
            ...formData,
            name: dgiiData.name || formData.name,
            fiscalStatus: dgiiData.status,
            verifiedAt: new Date().toISOString(),
            dgiiData: {
               commercialName: dgiiData.commercialName,
               economicActivity: dgiiData.economicActivity,
               regimeType: dgiiData.regimeType
            },
            // Auto-set NCF type based on status
            defaultNcfType: dgiiData.status === 'ACTIVO' ? 'B01' : 'B02'
         });

         setValidationError(null);
      } catch (error) {
         console.error('[CustomerManagement] DGII validation error:', error);
         setValidationError('Error al consultar DGII. Verifique la conexión.');
      } finally {
         setIsValidatingRNC(false);
      }
   };

   const loadCustomerTransactions = useCallback(async (customerId?: string | null) => {
      const effectiveCustomerId = customerId || selectedCustomer?.id;
      if (!effectiveCustomerId) {
         setCustomerTransactions([]);
         return;
      }

      try {
         const { db } = await import('../utils/db');
         const [activeTransactions, historyTransactions, wallets, walletTxns] = await Promise.all([
            db.get('transactions') as Promise<Transaction[]>,
            db.get('transactionHistory') as Promise<Transaction[]>,
            db.get('wallets' as any) as Promise<any[]>,
            db.get('wallet_transactions' as any) as Promise<any[]>
         ]);

         const mergedMap = new globalThis.Map<string, Transaction>();
         const merged = [
            ...(Array.isArray(activeTransactions) ? activeTransactions : []),
            ...(Array.isArray(historyTransactions) ? historyTransactions : [])
         ];

         const toPending = (value: unknown) => {
            const num = typeof value === 'number' ? value : Number(value);
            return Number.isFinite(num) && num > 0 ? num : 0;
         };

         const toTimestamp = (value?: string) => {
            const ts = value ? new Date(value).getTime() : NaN;
            return Number.isFinite(ts) ? ts : 0;
         };

         for (const tx of merged) {
            if (!tx?.id) continue;
            const existing = mergedMap.get(tx.id);
            if (!existing) {
               mergedMap.set(tx.id, tx);
               continue;
            }

            // Prioritize by most recent update regardless of balance changes
            const existingTs = Math.max(toTimestamp((existing as any).updatedAt), toTimestamp(existing.date));
            const nextTs = Math.max(toTimestamp((tx as any).updatedAt), toTimestamp(tx.date));

            if (nextTs >= existingTs) {
               mergedMap.set(tx.id, tx);
            }
         }

         // Fallback bridge: if a wallet refund movement exists (NC reference) but the
         // refund transaction row is missing, expose a synthetic refund transaction
         // so credit notes remain visible in customer history/statements.
         const displayIdSet = new globalThis.Set<string>();
         for (const tx of mergedMap.values()) {
            const key = typeof tx.displayId === 'string' ? tx.displayId.trim().toUpperCase() : '';
            if (key) displayIdSet.add(key);
         }

         const walletById = new globalThis.Map<string, any>();
         for (const wallet of (wallets || [])) {
            if (wallet?.id) walletById.set(wallet.id, wallet);
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

         const salesCandidatesByCustomer = new globalThis.Map<string, Transaction[]>();
         for (const tx of mergedMap.values()) {
            const customerId = typeof tx.customerId === 'string' ? tx.customerId.trim() : '';
            if (!customerId) continue;
            if (isRefundDocument(tx)) continue;
            const list = salesCandidatesByCustomer.get(customerId) || [];
            list.push(tx);
            salesCandidatesByCustomer.set(customerId, list);
         }

         const pickAffectedInvoice = (customerId: string, amount: number, movementDate: string): Transaction | null => {
            const candidates = salesCandidatesByCustomer.get(customerId) || [];
            if (candidates.length === 0) return null;

            const movementMs = toMillis(movementDate);
            let best: Transaction | null = null;
            let bestScore = Number.NEGATIVE_INFINITY;
            for (const candidate of candidates) {
               let score = 0;
               if (candidate.status === 'PARTIAL_REFUND' || candidate.status === 'REFUNDED') score += 40;
               if (toPositiveNumber(candidate.total) + 0.01 >= amount) score += 12;

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

         for (const movement of (walletTxns || [])) {
            const ref = typeof movement?.referenceId === 'string' ? movement.referenceId.trim() : '';
            const refUpper = ref.toUpperCase();
            if (!refUpper.startsWith('NC')) continue;

            const amount = toPositiveNumber(movement?.amount);
            if (amount <= 0) continue;

            const wallet = walletById.get(movement?.walletId);
            const walletCustomerId = wallet?.customerId;
            if (!walletCustomerId) continue;
            const parsedMovementDate = typeof movement?.createdAt === 'string' ? new Date(movement.createdAt).getTime() : NaN;
            const movementDate = Number.isFinite(parsedMovementDate) ? String(movement.createdAt) : new Date().toISOString();
            const affectedSale = pickAffectedInvoice(String(walletCustomerId), amount, movementDate);
            const inferredAffectedInvoice = (affectedSale?.displayId || affectedSale?.id || '').toString().trim();
            const inferredAffectedNCF = (affectedSale?.ncf || '').toString().trim();
            const inferredNcf = extractB04NcfFromMovement(movement);

            if (displayIdSet.has(refUpper)) {
               for (const [txId, currentTx] of mergedMap.entries()) {
                  const currentDisplay = typeof currentTx.displayId === 'string' ? currentTx.displayId.trim().toUpperCase() : '';
                  if (currentDisplay !== refUpper) continue;
                  if (!isRefundDocument(currentTx)) continue;

                  const patch: Partial<Transaction> = {};
                  if ((!currentTx.ncf || !currentTx.ncf.trim()) && inferredNcf) patch.ncf = inferredNcf;
                  if ((!currentTx.affectedInvoiceNumber || !currentTx.affectedInvoiceNumber.trim()) && inferredAffectedInvoice) {
                     patch.affectedInvoiceNumber = inferredAffectedInvoice;
                  }
                  if ((!currentTx.affectedNCF || !currentTx.affectedNCF.trim()) && inferredAffectedNCF) {
                     patch.affectedNCF = inferredAffectedNCF;
                  }
                  if (!currentTx.originalTransactionId && affectedSale?.id) patch.originalTransactionId = affectedSale.id;
                  if (Object.keys(patch).length === 0) continue;

                  mergedMap.set(txId, {
                     ...currentTx,
                     ...patch
                  });
               }
               continue;
            }

            const owner = customers.find(c => c.id === walletCustomerId);
            const syntheticId = `WLT-NC-${movement?.id || ref}-${walletCustomerId}`;

            mergedMap.set(syntheticId, {
               id: syntheticId,
               displayId: ref,
               documentType: 'REFUND',
               date: movementDate,
               items: [],
               total: amount,
               payments: [{ method: 'STORE_CREDIT', amount }],
               userId: 'SYSTEM',
               userName: 'Sistema',
               terminalId: 'N/A',
               status: 'REFUNDED',
               customerId: walletCustomerId,
               customerName: owner?.name,
               ncf: inferredNcf,
               ncfType: 'B04',
               refundReason: 'NC registrada vía wallet',
               affectedInvoiceNumber: inferredAffectedInvoice || undefined,
               affectedNCF: inferredAffectedNCF || undefined,
               originalTransactionId: affectedSale?.id,
               syncStatus: 'COMPLETED'
            } as Transaction);

            displayIdSet.add(refUpper);
         }

         const normalizeText = (value?: string | null) => (value || '').trim().toLowerCase();
         const selectedById = customers.find(c => c.id === effectiveCustomerId);
         const selectedName = normalizeText(selectedById?.name);

         const customerTxs = Array.from(mergedMap.values())
            .filter(tx => {
               if (tx.customerId === effectiveCustomerId) return true;
               if (!selectedName) return false;
               return normalizeText(tx.customerName) === selectedName;
            })
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

         setCustomerTransactions(customerTxs);
      } catch (e) {
         console.error("Failed to load customer transactions:", e);
         setCustomerTransactions([]);
      }
   }, [selectedCustomer?.id, customers]);

   const loadWalletMovements = useCallback(async (customerId?: string | null) => {
      const effectiveCustomerId = customerId || selectedCustomer?.id;
      if (!effectiveCustomerId) {
         setWalletMovements([]);
         return;
      }

      try {
         const { db } = await import('../utils/db');
         const [wallets, rawWalletTx] = await Promise.all([
            db.get('wallets' as any) as Promise<any[]>,
            db.get('wallet_transactions' as any) as Promise<any[]>
         ]);

         const wallet = (wallets || []).find((w: any) => w?.customerId === effectiveCustomerId);
         if (!wallet?.id) {
            setWalletMovements([]);
            return;
         }

         const txs = (rawWalletTx || [])
            .filter((tx: any) => tx?.walletId === wallet.id)
            .map((tx: any) => ({
               id: String(tx.id || `wallet_tx_${Math.random().toString(36).slice(2)}`),
               walletId: String(tx.walletId || wallet.id),
               type: tx.type as WalletTransaction['type'],
               amount: Number(tx.amount || 0),
               referenceId: tx.referenceId,
               timestamp: tx.timestamp || tx.createdAt || new Date().toISOString()
            }))
            .sort((a: WalletTransaction, b: WalletTransaction) =>
               new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            );

         setWalletMovements(txs);
      } catch (error) {
         console.error('Failed to load wallet movements:', error);
         setWalletMovements([]);
      }
   }, [selectedCustomer?.id]);

   // --- LOAD CUSTOMER ACTIVITIES ---
   const fetchActivities = useCallback(async () => {
      if (!selectedCustomer?.id) return;
      try {
         const acts = await agendaService.getCustomerActivities(selectedCustomer.id);
         setCustomerActivities(acts);
      } catch (e) {
         console.error("Failed to load customer activities:", e);
      }
   }, [selectedCustomer?.id]);

   // --- LOAD CUSTOMER DATA ---
   useEffect(() => {
      loadCustomerTransactions();
      fetchActivities();
      loadWalletMovements();
   }, [loadCustomerTransactions, fetchActivities, loadWalletMovements, customers]);


   // --- ADDRESS LOGIC ---
   const handleCreateWallet = () => {
      if (!selectedCustomer) return;
      onUpdateCustomer({
         ...selectedCustomer,
         wallet: {
            id: `w_${Date.now()}`,
            customerId: selectedCustomer.id,
            balance: 0,
            currency: config.currencies.find(c => c.isBase)?.code || 'DOP',
            status: 'ACTIVE',
            lastActivity: new Date().toISOString(),
            transactions: []
         }
      });
   };

   const handleSendWalletEmail = async () => {
      if (!selectedCustomer) return;
      try {
         const response = await fetch('/api/wallet/send-welcome-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customerId: selectedCustomer.id })
         });
         const data = await response.json();
         if (data.success) {
            alert('Email enviado correctamente');
         } else {
            alert('Error al enviar email: ' + data.message);
         }
      } catch (error) {
         console.error('Error sending wallet email:', error);
         alert('Error de conexión al enviar email');
      }
   };

   const handleAddAddress = () => {
      setEditingAddress({
         id: Math.random().toString(36).substr(2, 9),
         type: 'SHIPPING',
         isDefault: false,
         country: 'RD',
         state: '',
         city: '',
         street: '',
         number: '',
         zipCode: ''
      });
      setIsAddressFormOpen(true);
   };

   const handleEditAddress = (addr: CustomerAddress) => {
      setEditingAddress({ ...addr });
      setIsAddressFormOpen(true);
   };

   const handleSaveAddress = () => {
      if (!editingAddress.street || !editingAddress.city) return alert("Calle y Ciudad son obligatorios");

      let updatedAddresses = [...(formData.addresses || [])];

      // Logic: If setting as default, unset others of same type
      if (editingAddress.isDefault) {
         updatedAddresses = updatedAddresses.map(a =>
            a.type === editingAddress.type ? { ...a, isDefault: false } : a
         );
      }

      const existingIndex = updatedAddresses.findIndex(a => a.id === editingAddress.id);
      if (existingIndex >= 0) {
         updatedAddresses[existingIndex] = editingAddress as CustomerAddress;
      } else {
         updatedAddresses.push(editingAddress as CustomerAddress);
      }

      setFormData({ ...formData, addresses: updatedAddresses });
      setIsAddressFormOpen(false);
   };

   const handleDeleteAddress = (id: string) => {
      if (confirm("¿Eliminar dirección?")) {
         setFormData({
            ...formData,
            addresses: formData.addresses?.filter(a => a.id !== id)
         });
      }
   };

   const handleWhatsApp = () => {
      if (!selectedCustomer?.phone) return alert("Sin teléfono registrado");
      window.open(`https://wa.me/${selectedCustomer.phone.replace(/[^0-9]/g, '')}`, '_blank');
   };



   const handleLinkCard = () => {
      if (!selectedCustomer) return;
      setIsLinkCardOpen(true);
      setCardLinkInput('');
      setCardLinkType('LOYALTY');
   };

   const handleUnlinkCard = (cardId: string) => {
      if (!selectedCustomer) return;
      if (confirm('¿Estás seguro de desvincular esta tarjeta?')) {
         const updatedCards = (selectedCustomer.cards || []).filter(c => c.id !== cardId);
         onUpdateCustomer({ ...selectedCustomer, cards: updatedCards });
      }
   };

   const confirmLinkCard = (number: string) => {
      if (!selectedCustomer || !number) return;

      const newCard: LoyaltyCard = {
         id: `lc_${Math.random().toString(36).substr(2, 9)}`,
         customerId: selectedCustomer.id,
         type: cardLinkType,
         cardNumber: number,
         pointsBalance: cardLinkType === 'LOYALTY' ? (selectedCustomer.loyaltyPoints || 0) : 0,
         status: 'ACTIVE',
         issuedAt: new Date().toISOString(),
         history: []
      };

      const currentCards = selectedCustomer.cards || [];
      onUpdateCustomer({ ...selectedCustomer, cards: [...currentCards, newCard] });
      setIsLinkCardOpen(false);
   };

   const generateDigitalCard = () => {
      // Generate a 12-digit number starting with 888
      const randomNum = Math.floor(Math.random() * 1000000000).toString().padStart(9, '0');
      confirmLinkCard(`888${randomNum}`);
   };

   const themeText = {
      blue: 'text-blue-600',
      orange: 'text-orange-600',
      gray: 'text-gray-800',
   }[config.themeColor] || 'text-indigo-600';

   const themeBg = {
      blue: 'bg-blue-600',
      orange: 'bg-orange-600',
      gray: 'bg-gray-800',
   }[config.themeColor] || 'bg-indigo-600';

   // --- UI COMPONENTS ---

   const BooleanField = ({ label, checked, onChange }: { label: string, checked: boolean, onChange: (v: boolean) => void }) => (
      <div
         onClick={() => onChange(!checked)}
         className={`p-3 rounded-xl border-2 cursor-pointer flex items-center justify-between transition-all ${checked ? 'bg-blue-50 border-blue-500' : 'bg-white border-gray-200 hover:border-gray-300'
            }`}
      >
         <span className={`text-sm font-bold ${checked ? 'text-blue-700' : 'text-gray-600'}`}>{label}</span>
         <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${checked ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'}`}>
            {checked && <Check size={14} className="text-white" />}
         </div>
      </div>
   );

   return (
      <div className="h-screen w-full bg-slate-50 flex flex-col overflow-hidden">

         {/* HEADER */}
         <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0 z-20">
            <div className="flex items-center gap-4">
               <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
                  <ArrowLeft size={24} />
               </button>
               <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Users className={themeText} /> Directorio de Clientes
               </h1>
            </div>
            <div className="flex gap-2">
               {isEgoClubEnabled(config) && loyaltyQueue.some(item => item.status !== 'SYNCED') && (
                  <button
                     onClick={() => setIsLoyaltyQueueOpen(prev => !prev)}
                     className="px-3 py-2.5 rounded-xl font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-2 text-xs"
                     title="Altas de socio pendientes de enviar al ERP"
                  >
                     <Clock size={16} />
                     {loyaltyQueue.filter(item => item.status === 'PENDING').length} en cola
                  </button>
               )}
               {isEgoClubEnabled(config) && (
                  <button
                     onClick={() => setIsEgoEnrollOpen(true)}
                     className="px-4 py-2.5 rounded-xl font-bold bg-gray-900 text-white shadow-lg flex items-center gap-2 active:scale-95 transition-all"
                  >
                     <BadgeCheck size={18} /> Alta EGO Club
                  </button>
               )}
               {onSelect && selectedCustomer && (
                  <button
                     onClick={() => onSelect(selectedCustomer)}
                     className="px-6 py-2.5 rounded-xl font-black bg-emerald-600 text-white shadow-lg animate-in zoom-in"
                  >
                     Asignar al Ticket
                  </button>
               )}
               <button
                  onClick={handleCreateClick}
                  className={`px-4 py-2.5 rounded-xl font-bold text-white shadow-lg shadow-blue-100 flex items-center gap-2 active:scale-95 transition-all ${themeBg}`}
               >
                  <UserPlus size={18} /> Nuevo Cliente
               </button>
            </div>
         </header>

         {isLoyaltyQueueOpen && (
            <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 shrink-0 max-h-48 overflow-y-auto">
               <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-black uppercase tracking-wide text-amber-800">
                     Altas de socio en cola local (se envían al ERP al reconectar)
                  </p>
                  <button
                     onClick={async () => { await flushLoyaltyOutbox(); await refreshLoyaltyQueue(); }}
                     className="text-[11px] font-black text-amber-800 underline"
                  >
                     Reintentar ahora
                  </button>
               </div>
               <ul className="space-y-1">
                  {loyaltyQueue.map(item => (
                     <li key={item.id} className="flex items-center justify-between gap-3 text-[11px] font-bold text-gray-700">
                        <span className="truncate">{item.reference || item.id}</span>
                        <span className={`px-2 py-0.5 rounded-full uppercase tracking-wide ${
                           item.status === 'SYNCED' ? 'bg-emerald-100 text-emerald-700'
                              : item.status === 'FAILED' ? 'bg-red-100 text-red-700'
                                 : 'bg-amber-200 text-amber-900'
                        }`}>
                           {item.status === 'SYNCED' ? 'enviado' : item.status === 'FAILED' ? 'fallido' : 'pendiente'}
                        </span>
                     </li>
                  ))}
               </ul>
            </div>
         )}

         {/* MAIN CONTENT SPLIT */}
         <div className="flex-1 overflow-hidden flex">

            {/* LEFT: LIST & FILTERS */}
            <div className={`w-full md:w-[400px] bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ${selectedCustomerId ? 'hidden md:flex' : 'flex'}`}>

               {/* Search & Filters */}
               <div className="p-4 border-b border-gray-100 space-y-3">
                  <div className="relative">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                     <input
                        type="text"
                        placeholder="Buscar cliente..."
                        className="w-full pl-10 pr-4 py-2.5 bg-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 transition-all text-sm font-medium"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                     />
                  </div>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                     {['ALL', 'VIP', 'REGULAR', 'WHOLESALE'].map(tag => (
                        <button
                           key={tag}
                           onClick={() => setFilterTag(tag)}
                           className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-colors whitespace-nowrap ${filterTag === tag
                              ? 'bg-slate-800 text-white'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                              }`}
                        >
                           {tag === 'ALL' ? 'Todos' : tag}
                        </button>
                     ))}
                  </div>
               </div>

               {/* List */}
               <div className="flex-1 overflow-y-auto">
                  {/* --- REMOTE RESULT (DGII) --- */}
                  {remoteResult && (
                     <div className="mb-4 animate-in fade-in slide-in-from-top-4">
                        <div className="flex items-center gap-2 mb-2 px-1">
                           <Globe size={14} className="text-blue-500" />
                           <h4 className="text-xs font-black text-blue-500 uppercase tracking-widest">Directorio DGII (Nacional)</h4>
                        </div>
                        <div
                           onClick={() => {
                              setSelectedCustomerId(remoteResult.id);
                              // If in select mode, we might want to select immediately?
                              // But UI logic below shows details.
                              // Hack: Since it's not in 'customers' list, selectedCustomer memo won't find it.
                              // We need to handle this.
                              if (onSelect) onSelect(remoteResult);
                           }}
                           className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-4 cursor-pointer hover:bg-blue-100 transition-all group"
                        >
                           <div className="flex justify-between items-start">
                              <div className="flex items-center gap-3">
                                 <div className="w-10 h-10 rounded-full bg-blue-200 text-blue-700 flex items-center justify-center font-black text-md">
                                    DG
                                 </div>
                                 <div>
                                    <h3 className="font-bold text-gray-800 group-hover:text-blue-800">{remoteResult.name}</h3>
                                    <div className="flex items-center gap-2 mt-0.5">
                                       <span className="text-xs font-mono font-bold text-gray-500">{remoteResult.taxId}</span>
                                       <span className="px-1.5 py-0.5 bg-green-200 text-green-800 text-[9px] font-black rounded uppercase">
                                          {remoteResult.fiscalStatus}
                                       </span>
                                       <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 text-[9px] font-black rounded uppercase ml-1">
                                          TEMPORAL
                                       </span>
                                    </div>
                                 </div>
                              </div>
                              <div className="p-2 bg-white rounded-xl text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                 <ChevronRight size={18} />
                              </div>
                           </div>
                        </div>
                     </div>
                  )}

                  {/* LOADING STATE */}
                  {searchingDGII && (
                     <div className="p-4 flex items-center justify-center gap-3 text-gray-400 bg-gray-50 rounded-2xl border border-dashed border-gray-200 mb-4">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-xs font-bold">Consultando DGII...</span>
                     </div>
                  )}

                  <div className="space-y-2">
                     {filteredCustomers.map((customer, idx) => (
                        <div
                           key={customer.id || `cust-${idx}`}
                           onClick={() => setSelectedCustomerId(customer.id)}
                           className={`p-4 border-b border-gray-50 cursor-pointer transition-colors hover:bg-blue-50/50 flex items-center gap-3 ${selectedCustomerId === customer.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'
                              }`}
                        >
                           <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center font-bold text-slate-600 text-sm">
                              {customer.name.charAt(0)}
                           </div>
                           <div className="flex-1 min-w-0">
                              <h4 className={`font-bold text-sm truncate ${selectedCustomerId === customer.id ? 'text-blue-700' : 'text-gray-800'}`}>{customer.name}</h4>
                              <div className="flex items-center gap-2">
                                 <p className="text-xs text-gray-400 truncate">{customer.phone || 'Sin contacto'}</p>
                                 <span className="text-[9px] font-black text-blue-500 bg-blue-50 px-1 rounded">{customer.defaultNcfType || 'B02'}</span>
                              </div>
                           </div>
                           {(customer.currentDebt || 0) > 0 && (
                              <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                                 -${customer.currentDebt}
                              </span>
                           )}
                        </div>
                     ))}
                     {filteredCustomers.length === 0 && !remoteResult && (
                        <div className="p-8 text-center text-gray-400 text-sm">No se encontraron clientes.</div>
                     )}
                  </div>
               </div>
            </div>

            {/* RIGHT: PROFILE DETAILS */}
            <div className={`flex-1 bg-slate-50 overflow-hidden flex flex-col ${selectedCustomerId ? 'flex' : 'hidden md:flex'}`}>
               {selectedCustomer ? (
                  <div className="flex-1 flex flex-col h-full overflow-hidden">

                     {/* Mobile Back Button */}
                     <div className="md:hidden p-4 bg-white border-b border-gray-200 flex justify-between items-center">
                        <button onClick={() => setSelectedCustomerId(null)} className="flex items-center gap-2 text-sm font-bold text-gray-500">
                           <ArrowLeft size={16} /> Volver a la lista
                        </button>
                        {onSelect && (
                           <button onClick={() => onSelect(selectedCustomer)} className="bg-emerald-600 text-white px-4 py-1.5 rounded-lg text-xs font-black">Asignar</button>
                        )}
                     </div>

                     {/* Profile Header Card */}
                     <div className="p-6 md:p-8 overflow-y-auto">
                        <div className="bg-white rounded-3xl shadow-sm border border-gray-200 p-6 mb-6">
                           <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">

                              {/* Identity */}
                              <div className="flex items-center gap-5">
                                 <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-3xl font-black shadow-lg shadow-blue-200">
                                    {selectedCustomer.name.charAt(0)}
                                 </div>
                                 <div>
                                    <h2 className="text-2xl font-black text-gray-900 leading-tight">{selectedCustomer.name}</h2>
                                    <div className="flex items-center gap-2 mt-1">
                                       {/* Nivel EGO Club resuelto por el ERP. Si el cliente no tiene
                                           membresía no se muestra nada: antes se etiquetaba como
                                           "BRONZE MEMBER", que inventaba un nivel inexistente. */}
                                       {isEgoClubEnabled(config) && getTierLabel(config, selectedCustomer.tier) && (
                                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide border ${getTierBadgeClass(selectedCustomer.tier)}`}>
                                             {getTierLabel(config, selectedCustomer.tier)}
                                          </span>
                                       )}
                                       {selectedCustomer.tags?.map(tag => (
                                          <span key={tag} className="text-[10px] font-bold text-gray-400">#{tag}</span>
                                       ))}
                                    </div>
                                    <div className="flex flex-col gap-1 mt-2 text-sm text-gray-500">
                                       {selectedCustomer.phone && <span className="flex items-center gap-1"><Phone size={12} /> {selectedCustomer.phone}</span>}
                                       {selectedCustomer.email && <span className="flex items-center gap-1"><Mail size={12} /> {selectedCustomer.email}</span>}
                                    </div>
                                 </div>
                              </div>

                              {/* Actions */}
                              <div className="flex gap-2 w-full md:w-auto">
                                 {isEgoClubEnabled(config) && (
                                    <button
                                       onClick={() => setIsEgoCardOpen(true)}
                                       className="flex-1 md:flex-none py-2 px-4 bg-slate-900 text-white rounded-xl font-black text-sm shadow-lg hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
                                       title="Tarjeta digital del socio"
                                    >
                                       <BadgeCheck size={18} /> <span className="hidden lg:inline">Tarjeta EGO Club</span>
                                    </button>
                                 )}
                                 {onSelect && (
                                    <button
                                       onClick={() => onSelect(selectedCustomer)}
                                       className="flex-1 md:flex-none py-2 px-6 bg-emerald-600 text-white rounded-xl font-black text-sm shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center justify-center gap-2"
                                    >
                                       <Check size={18} /> Asignar al Ticket
                                    </button>
                                 )}
                                 <button onClick={handleWhatsApp} className="flex-1 md:flex-none py-2 px-4 bg-green-50 text-green-600 rounded-xl font-bold text-sm hover:bg-green-100 transition-colors flex items-center justify-center gap-2">
                                    <MessageCircle size={18} /> <span className="hidden lg:inline">WhatsApp</span>
                                 </button>
                                 <button onClick={handleEditClick} className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 transition-colors">
                                    <Edit2 size={18} />
                                 </button>
                                 <button onClick={() => handleDelete(selectedCustomer.id)} className="p-2 border border-red-100 rounded-xl hover:bg-red-50 text-red-500 transition-colors">
                                    <Trash2 size={18} />
                                 </button>
                              </div>
                           </div>

                           {/* FISCAL PREVIEW SECTION (Destacada en la ficha) */}
                           <div className="mt-8 p-4 bg-blue-50/50 rounded-2xl border border-blue-100 grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="flex items-center gap-3">
                                 <div className="p-2 bg-blue-600 text-white rounded-xl shadow-md">
                                    <Landmark size={20} />
                                 </div>
                                 <div>
                                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest leading-none mb-1">Comprobante Fiscal</p>
                                    <p className="text-sm font-black text-blue-900">{selectedCustomer.defaultNcfType || 'Consumo (B02)'}</p>
                                 </div>
                              </div>
                              <div className="flex items-center gap-3 border-l md:border-l border-blue-100 md:pl-6">
                                 <div className="p-2 bg-white text-blue-600 rounded-xl border border-blue-200">
                                    <FileText size={20} />
                                 </div>
                                 <div>
                                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest leading-none mb-1">RNC / Cédula</p>
                                    <p className="text-sm font-mono font-bold text-blue-900">{selectedCustomer.taxId || 'No registrado'}</p>
                                 </div>
                              </div>
                           </div>

                           {/* Mini Stats (Financial Summary Header) */}
                           <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-gray-100">
                              <div>
                                 <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">Total Gastado</p>
                                 <p className="text-xl font-black text-gray-800">{config.currencySymbol}{formatMoney(selectedCustomer.totalSpent)}</p>
                              </div>
                              <div>
                                 <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">Deuda Actual</p>
                                 <p className="text-xl font-black text-red-500">
                                    {config.currencySymbol}{formatMoney(selectedCustomer.currentDebt)}
                                 </p>
                              </div>
                              <div>
                                 <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">Saldo a Favor / Anticipos</p>
                                 <p className="text-xl font-black text-emerald-500">
                                    {config.currencySymbol}{formatMoney(selectedCustomer.wallet?.balance)}
                                 </p>
                              </div>
                              <div className="md:border-l md:pl-6">
                                 <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">Total Neto</p>
                                 <p className={`text-xl font-black ${(toSafeNumber(selectedCustomer.wallet?.balance) - toSafeNumber(selectedCustomer.currentDebt)) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {config.currencySymbol}{formatMoney(toSafeNumber(selectedCustomer.wallet?.balance) - toSafeNumber(selectedCustomer.currentDebt))}
                                 </p>
                              </div>
                           </div>
                        </div>

                        {/* TABS */}
                        <div className="mobile-tab-scroller no-scrollbar -mx-4 px-4 md:mx-0 md:px-0 border-b border-gray-200 mb-6">
                           {[
                              { id: 'HISTORY', label: 'Historial', icon: History },
                              { id: 'WALLET', label: 'Billetera', icon: WalletIcon },
                              { id: 'LOYALTY', label: 'Lealtad', icon: Star },
                              { id: 'CREDIT', label: 'Crédito', icon: CreditCard },
                              { id: 'AGENDA', label: 'Agenda', icon: Calendar },
                           ].map(tab => (
                              <button
                                 key={tab.id}
                                 onClick={() => setActiveProfileTab(tab.id as any)}
                                 className={`mobile-tab-item py-4 text-[11px] md:text-sm font-bold border-b-4 transition-all flex items-center gap-2 ${activeProfileTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
                                    }`}
                              >
                                 <tab.icon size={16} /> {tab.label}
                              </button>
                           ))}
                        </div>

                        {/* TAB CONTENT */}
                        <div className="animate-in fade-in">
                           {activeProfileTab === 'HISTORY' && (
                              <div className="space-y-3">
                                 {customerTransactions.length > 0 ? (
                                    customerTransactions.map((tx) => {
                                       const effectivePending = getEffectivePendingBalance(tx);
                                       const isRefund = tx.documentType === 'REFUND' || tx.ncfType === 'B04';

                                       // Dynamic Document Name Detection
                                       const getDocumentName = () => {
                                          if (tx.documentType === 'REFUND') return 'Nota de Crédito';
                                          if (tx.ncfType === 'B04') return 'Devolución (NC)';
                                          return 'Compra';
                                       };

                                       return (
                                          <div
                                             key={tx.id}
                                             onClick={() => setSelectedTransactionId(tx.id)}
                                             className={`p-4 rounded-xl border flex items-center justify-between transition-all cursor-pointer group shadow-sm hover:shadow-md ${isRefund
                                                ? 'bg-red-50/50 border-red-200'
                                                : 'bg-white border-gray-100 hover:border-gray-200'
                                                }`}
                                          >
                                             <div className="flex items-center gap-4">
                                                <div className={`p-2 rounded-lg transition-colors ${isRefund
                                                   ? 'bg-red-100 text-red-600'
                                                   : 'bg-gray-50 text-gray-400 group-hover:bg-blue-50 group-hover:text-blue-600'
                                                   }`}>
                                                   {isRefund ? <ArrowRightLeft size={20} /> : <ShoppingBag size={20} />}
                                                </div>
                                                <div>
                                                   <p className={`font-bold text-sm ${isRefund ? 'text-red-900' : 'text-gray-800'}`}>
                                                      {getDocumentName()} #{tx.displayId || tx.id.slice(-8).toUpperCase()}
                                                   </p>
                                                   <p className="text-[10px] font-medium text-gray-400 uppercase tracking-widest">
                                                      {new Date(tx.date).toLocaleDateString()} • {tx.items.length} items
                                                   </p>
                                                </div>
                                             </div>
                                             <div className="text-right">
                                                <p className={`font-black ${isRefund ? 'text-red-600' : 'text-gray-900'}`}>
                                                   {isRefund ? '-' : ''}{config.currencySymbol}{tx.total.toFixed(2)}
                                                </p>
                                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${tx.status === 'REFUNDED' ? 'bg-red-100 text-red-700' :
                                                   tx.status === 'PARTIAL_REFUND' ? 'bg-orange-100 text-orange-700' :
                                                      effectivePending > 0 ? 'bg-amber-100 text-amber-700' :
                                                         'bg-emerald-100 text-emerald-700'
                                                   }`}>
                                                   {isRefund ? 'NOTA CRÉDITO' :
                                                      tx.status === 'REFUNDED' ? 'ANULADO' :
                                                         tx.status === 'PARTIAL_REFUND' ? 'DEVUELTO' :
                                                            effectivePending > 0 ? 'PENDIENTE' :
                                                               'PAGADO'}
                                                </span>
                                             </div>
                                          </div>
                                       );
                                    })
                                 ) : (
                                    <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-100 rounded-xl">
                                       <ShoppingBag size={32} className="mx-auto mb-2 opacity-50" />
                                       <p className="text-sm font-medium">Sin historial de compras</p>
                                    </div>
                                 )}
                              </div>
                           )}

                           {activeProfileTab === 'WALLET' && (
                              <div className="space-y-6">
                                 {/* PREPAID WALLET SECTION */}
                                 <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-white relative overflow-hidden shadow-xl">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-10 -mt-10 blur-xl"></div>
                                    <div className="relative z-10 flex flex-col h-full justify-between min-h-[160px]">
                                       <div className="flex justify-between items-start">
                                          <div>
                                             <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Monedero Virtual</p>
                                             <h3 className="text-4xl font-mono mt-1 font-black tracking-tight">
                                                {config.currencySymbol}{formatMoney(selectedCustomer.wallet?.balance)}
                                             </h3>
                                          </div>
                                          <WalletIcon size={32} className="text-emerald-400" />
                                       </div>

                                       <div className="mt-6">
                                          {selectedCustomer.wallet ? (
                                             <div className="flex gap-3">
                                                <button className="flex-1 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-bold backdrop-blur-sm transition-colors">
                                                   Recargar
                                                </button>
                                                <button className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-bold shadow-lg shadow-emerald-900/20 transition-colors">
                                                   Pagar
                                                </button>
                                             </div>
                                          ) : (
                                             <button
                                                onClick={handleCreateWallet}
                                                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold shadow-lg shadow-emerald-900/20 transition-colors flex items-center justify-center gap-2"
                                             >
                                                <WalletIcon size={18} /> Activar Wallet
                                             </button>
                                          )}

                                          {selectedCustomer.wallet && (
                                             <button
                                                onClick={handleSendWalletEmail}
                                                className="w-full mt-3 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold shadow-lg transition-colors flex items-center justify-center gap-2"
                                             >
                                                <Mail size={18} /> Enviar Pase por Email
                                             </button>
                                          )}
                                       </div>
                                    </div>
                                 </div>

                                 <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
                                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                                       <h4 className="text-xs font-black uppercase tracking-widest text-gray-500">Movimientos de Wallet</h4>
                                       <span className="text-[10px] text-gray-400 font-bold">{walletMovements.length} registros</span>
                                    </div>
                                    <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
                                       {walletMovements.length === 0 ? (
                                          <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-100 rounded-xl">
                                             <WalletIcon size={28} className="mx-auto mb-2 opacity-40" />
                                             <p className="text-sm font-medium">Sin movimientos de wallet</p>
                                          </div>
                                       ) : (
                                          walletMovements.map((movement) => {
                                             const isCredit = Number(movement.amount || 0) >= 0;
                                             const movementType = (movement.type || '').toUpperCase();
                                             const label =
                                                movementType === 'DEPOSIT' ? 'Abono' :
                                                   movementType === 'PAYMENT' ? 'Consumo' :
                                                      movementType === 'REFUND' ? 'Reembolso' :
                                                         movementType === 'CASHBACK' ? 'Cashback' :
                                                            movement.type;

                                             return (
                                                <div key={movement.id} className="p-3 rounded-xl border border-gray-100 bg-gray-50/60 flex items-center justify-between">
                                                   <div>
                                                      <p className="text-sm font-bold text-gray-800">{label}</p>
                                                      <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                                                         {new Date(movement.timestamp).toLocaleString()}
                                                         {movement.referenceId ? ` • Ref: ${movement.referenceId}` : ''}
                                                      </p>
                                                   </div>
                                                   <p className={`font-black ${isCredit ? 'text-emerald-600' : 'text-red-600'}`}>
                                                      {isCredit ? '+' : ''}{config.currencySymbol}{Math.abs(Number(movement.amount || 0)).toFixed(2)}
                                                   </p>
                                                </div>
                                             );
                                          })
                                       )}
                                    </div>
                                 </div>

                              </div>
                           )}

                           {activeProfileTab === 'LOYALTY' && (
                              <LoyaltyDashboard
                                 customer={selectedCustomer}
                                 config={config}
                                 onLinkCard={handleLinkCard}
                                 onUnlinkCard={handleUnlinkCard}
                              />
                           )}

                           {activeProfileTab === 'CREDIT' && selectedCustomer && (
                              <div className="h-full p-6">
                                 <CreditAccountDashboard
                                    customer={selectedCustomer}
                                    transactions={customerTransactions}
                                    config={config}
                                    collections={collections}
                                    onRecordPayment={(amount, invoiceIds) => {
                                       setAbonoInitialAmount(amount);
                                       setAbonoInitialInvoices(invoiceIds);
                                       setIsAbonoModalOpen(true);
                                    }}
                                 />
                              </div>
                           )}

                           {activeProfileTab === 'AGENDA' && selectedCustomer && (
                              <div className="space-y-6">
                                 <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                    <div>
                                       <h3 className="text-lg font-black text-gray-800">Actividades & Citas</h3>
                                       <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Planificadas para este cliente</p>
                                    </div>
                                    <button
                                       onClick={() => {
                                          setSelectedActivity(null);
                                          setPrefilledDate(new Date());
                                          setIsActivityModalOpen(true);
                                       }}
                                       className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-blue-100 hover:scale-105 transition-all text-sm"
                                    >
                                       <Calendar size={18} /> Agendar
                                    </button>
                                 </div>

                                 <div className="space-y-3">
                                    {customerActivities.length > 0 ? (
                                       customerActivities.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()).map(act => (
                                          <div
                                             key={act.id}
                                             onClick={() => {
                                                setSelectedActivity(act);
                                                setIsActivityModalOpen(true);
                                             }}
                                             className="p-4 bg-white rounded-xl border border-gray-100 shadow-sm hover:border-blue-200 transition-all cursor-pointer group"
                                          >
                                             <div className="flex justify-between items-start">
                                                <div className="flex items-center gap-4">
                                                   <div className={`p-2 rounded-lg ${act.nature === 'BOOKING' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'}`}>
                                                      {act.nature === 'BOOKING' ? <Map size={20} /> : <MessageCircle size={20} />}
                                                   </div>
                                                   <div>
                                                      <p className="font-bold text-gray-800">{act.title}</p>
                                                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-tight mt-0.5">
                                                         {new Date(act.startDate).toLocaleDateString()} {new Date(act.startDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {act.type}
                                                      </p>
                                                      {act.spaceName && (
                                                         <p className="text-[10px] text-orange-600 font-black flex items-center gap-1 mt-1">
                                                            <MapPin size={10} /> {act.spaceName}
                                                         </p>
                                                      )}
                                                   </div>
                                                </div>
                                                <div className="text-right">
                                                   <span className={`text-[9px] px-2 py-0.5 rounded-full font-black ${act.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                                                      act.status === 'CANCELLED' ? 'bg-red-100 text-red-700' :
                                                         'bg-blue-100 text-blue-700'
                                                      }`}>
                                                      {act.status}
                                                   </span>
                                                   <p className="text-[10px] text-gray-400 font-bold mt-1">Ref: {act.displayId}</p>
                                                </div>
                                             </div>
                                          </div>
                                       ))
                                    ) : (
                                       <div className="text-center py-12 bg-white rounded-2xl border-2 border-dashed border-gray-100">
                                          <Calendar size={48} className="mx-auto text-gray-200 mb-3" />
                                          <p className="text-gray-400 font-bold">Sin actividades registradas</p>
                                          <p className="text-xs text-gray-300">Haz clic en Agendar para programar una cita o tarea.</p>
                                       </div>
                                    )}
                                 </div>
                              </div>
                           )}
                        </div>

                     </div>
                  </div>
               ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                     <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                        <Users size={40} className="opacity-50" />
                     </div>
                     <p className="text-lg font-medium text-gray-500">Selecciona un cliente</p>
                     <p className="text-sm">o crea uno nuevo para ver sus detalles.</p>
                  </div>
               )}
            </div>

         </div>

         {/* EDIT MODAL */}
         {
            isEditModalOpen && (
               <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                  <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                     <div className="p-5 border-b border-gray-100 bg-gray-50">
                        <div className="flex justify-between items-center mb-4">
                           <h3 className="font-bold text-lg text-gray-800">{formData.id ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
                           <button onClick={() => setIsEditModalOpen(false)} className="p-2 hover:bg-gray-200 rounded-full text-gray-500"><X size={20} /></button>
                        </div>

                        <div className="flex gap-4">
                           <button
                              onClick={() => setEditModalTab('GENERAL')}
                              className={`pb-2 text-sm font-bold border-b-2 transition-all ${editModalTab === 'GENERAL' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                           >
                              General & Fiscal
                           </button>
                           <button
                              onClick={() => setEditModalTab('ADDRESSES')}
                              className={`pb-2 text-sm font-bold border-b-2 transition-all ${editModalTab === 'ADDRESSES' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                           >
                              Direcciones ({formData.addresses?.length || 0})
                           </button>
                        </div>
                     </div>

                     <div className="flex-1 overflow-y-auto p-6">
                        {editModalTab === 'GENERAL' ? (
                           <form onSubmit={handleSubmit} className="space-y-6">
                              <div className="space-y-4">
                                 <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Información Básica</h4>
                                 <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre Completo *</label>
                                    <input required type="text" value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                                 </div>
                                 <div className="grid grid-cols-2 gap-4">
                                    <div>
                                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Teléfono</label>
                                       <input type="tel" value={formData.phone || ''} onChange={e => setFormData({ ...formData, phone: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                                    </div>
                                    <div>
                                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
                                       <input type="email" value={formData.email || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                                    </div>
                                 </div>

                                 {/* FISCAL SECTION (Edición destacada) */}
                                 <div className="p-6 bg-slate-50 rounded-[2rem] border-2 border-slate-200 space-y-4">
                                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                       <Landmark size={14} className="text-blue-500" /> Configuración de Facturación
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                       <div>
                                          <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 ml-1">RNC / Cédula / Identificación</label>
                                          <input
                                             type="text"
                                             value={formData.taxId || ''}
                                             onChange={e => setFormData({ ...formData, taxId: e.target.value })}
                                             placeholder="101555559"
                                             className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-mono font-bold"
                                          />
                                       </div>
                                       <div>
                                          <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 ml-1">Tipo de Comprobante (NCF)</label>
                                          <select
                                             value={formData.defaultNcfType || 'B02'}
                                             onChange={e => setFormData({ ...formData, defaultNcfType: e.target.value as NCFType })}
                                             className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-black text-sm text-blue-700"
                                          >
                                             <option value="B02">Factura de Consumo (B02)</option>
                                             <option value="B01">Crédito Fiscal (B01)</option>
                                             <option value="B14">Regímenes Especiales (B14)</option>
                                             <option value="B15">Gubernamental (B15)</option>
                                          </select>
                                       </div>
                                    </div>
                                 </div>
                              </div>

                              <div className="pt-4 border-t border-gray-100 space-y-4">
                                 <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Datos Financieros</h4>
                                 <div className="grid grid-cols-2 gap-4">
                                    <div>
                                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Límite Crédito</label>
                                       <input type="number" value={formData.creditLimit || 0} onChange={e => setFormData({ ...formData, creditLimit: parseFloat(e.target.value) })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
                                    </div>
                                    <div>
                                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Días de Crédito</label>
                                       <input type="number" value={formData.creditDays || 0} onChange={e => setFormData({ ...formData, creditDays: parseInt(e.target.value) })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                                    </div>
                                 </div>

                                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                                    <BooleanField label="Enviar Doc. por Email" checked={formData.prefersEmail || false} onChange={v => setFormData({ ...formData, prefersEmail: v })} />
                                    <BooleanField label="Exento de Impuestos" checked={formData.isTaxExempt || false} onChange={v => setFormData({ ...formData, isTaxExempt: v })} />
                                 </div>
                              </div>
                           </form>
                        ) : (
                           <div className="space-y-4">
                              <div className="flex justify-between items-center mb-4">
                                 <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Mis Direcciones</h4>
                                 <button onClick={handleAddAddress} className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1">
                                    <MapPin size={12} /> Agregar Dirección
                                 </button>
                              </div>

                              {formData.addresses && formData.addresses.length > 0 ? (
                                 <div className="grid grid-cols-1 gap-3">
                                    {formData.addresses.map(addr => (
                                       <div key={addr.id} className="p-4 rounded-xl border border-gray-200 hover:border-blue-300 transition-all bg-white relative group">
                                          <div className="flex justify-between items-start mb-2">
                                             <div className="flex gap-2 items-center">
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${addr.type === 'BILLING' ? 'bg-indigo-50 text-indigo-600' : 'bg-orange-50 text-orange-600'}`}>
                                                   {addr.type === 'BILLING' ? 'Facturación' : 'Envío'}
                                                </span>
                                                {addr.isDefault && (
                                                   <span className="text-[10px] font-bold bg-green-50 text-green-600 px-2 py-0.5 rounded border border-green-100">
                                                      Principal
                                                   </span>
                                                )}
                                             </div>
                                             <div className="flex gap-2">
                                                <button onClick={() => handleEditAddress(addr)} className="text-gray-400 hover:text-blue-500"><Edit2 size={16} /></button>
                                                <button onClick={() => handleDeleteAddress(addr.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={16} /></button>
                                             </div>
                                          </div>
                                          <p className="text-sm font-bold text-gray-800">{addr.street} #{addr.number}</p>
                                          <p className="text-xs text-gray-500">{addr.city}, {addr.state} ({addr.zipCode})</p>
                                          <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                                             <Globe size={10} /> {addr.country}
                                          </p>
                                       </div>
                                    ))}
                                 </div>
                              ) : (
                                 <div className="text-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-400">
                                    <MapPin size={32} className="mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">No hay direcciones registradas.</p>
                                 </div>
                              )}
                           </div>
                        )}
                     </div>

                     <div className="p-5 border-t border-gray-100 flex gap-3 bg-white">
                        <button onClick={() => setIsEditModalOpen(false)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl transition-colors">Cancelar</button>
                        <button onClick={handleSubmit} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-md hover:bg-blue-700 transition-colors">Guardar Cliente</button>
                     </div>
                  </div>
               </div>
            )
         }

         {/* ADDRESS FORM SUB-MODAL */}
         {
            isAddressFormOpen && (
               <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                  <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                     <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                        <h3 className="font-bold text-gray-800">Detalle de Dirección</h3>
                        <button onClick={() => setIsAddressFormOpen(false)} className="p-1 hover:bg-gray-200 rounded-full text-gray-500"><X size={18} /></button>
                     </div>
                     <div className="p-6 overflow-y-auto space-y-4">
                        <div>
                           <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo</label>
                           <div className="flex gap-2">
                              {['BILLING', 'SHIPPING'].map(t => (
                                 <button
                                    key={t}
                                    onClick={() => setEditingAddress({ ...editingAddress, type: t as any })}
                                    className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition-all ${editingAddress.type === t ? 'bg-blue-50 border-blue-500 text-blue-600' : 'bg-white border-gray-200 text-gray-400'}`}
                                 >
                                    {t === 'BILLING' ? 'Facturación' : 'Envío'}
                                 </button>
                              ))}
                           </div>
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Calle y Número</label>
                           <div className="flex gap-2">
                              <input type="text" placeholder="Calle Principal" value={editingAddress.street || ''} onChange={e => setEditingAddress({ ...editingAddress, street: e.target.value })} className="flex-[3] p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                              <input type="text" placeholder="#" value={editingAddress.number || ''} onChange={e => setEditingAddress({ ...editingAddress, number: e.target.value })} className="flex-1 p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                           </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                           <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Ciudad</label>
                              <input type="text" value={editingAddress.city || ''} onChange={e => setEditingAddress({ ...editingAddress, city: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                           </div>
                           <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Provincia</label>
                              <input type="text" value={editingAddress.state || ''} onChange={e => setEditingAddress({ ...editingAddress, state: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                           </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                           <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Código Postal</label>
                              <input type="text" value={editingAddress.zipCode || ''} onChange={e => setEditingAddress({ ...editingAddress, zipCode: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                           </div>
                           <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">País</label>
                              <input type="text" value={editingAddress.country || 'RD'} onChange={e => setEditingAddress({ ...editingAddress, country: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                           </div>
                        </div>
                        <BooleanField label="Dirección Principal" checked={editingAddress.isDefault || false} onChange={v => setEditingAddress({ ...editingAddress, isDefault: v })} />
                     </div>
                     <div className="p-4 bg-gray-50 border-t border-gray-100">
                        <button onClick={handleSaveAddress} className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold shadow-md hover:bg-blue-700 transition-colors">
                           Guardar Dirección
                        </button>
                     </div>
                  </div>
               </div>
            )
         }

         {/* LINK CARD MODAL */}
         {
            isLinkCardOpen && (
               <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                  <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
                     <div className="p-6 text-center">
                        <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
                           <CreditCard size={32} />
                        </div>
                        <h3 className="text-xl font-black text-gray-800 mb-2">Vincular Tarjeta</h3>
                        <p className="text-sm text-gray-500 mb-6">Escanea una tarjeta física o genera una digital.</p>

                        <div className="space-y-4">
                           <div className="flex bg-gray-100 p-1 rounded-xl mb-4">
                              <button
                                 onClick={() => setCardLinkType('LOYALTY')}
                                 className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${cardLinkType === 'LOYALTY' ? 'bg-white shadow text-purple-600' : 'text-gray-500'}`}
                              >
                                 Fidelización
                              </button>
                              <button
                                 onClick={() => setCardLinkType('GIFT')}
                                 className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${cardLinkType === 'GIFT' ? 'bg-white shadow text-pink-600' : 'text-gray-500'}`}
                              >
                                 Regalo
                              </button>
                           </div>

                           <div>
                              <label className="block text-xs font-bold text-gray-400 uppercase mb-1 text-left">Número de Tarjeta</label>
                              <div className="flex gap-2">
                                 <input
                                    type="text"
                                    autoFocus
                                    value={cardLinkInput}
                                    onChange={(e) => setCardLinkInput(e.target.value)}
                                    placeholder="Escanea o escribe..."
                                    className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono font-bold outline-none focus:ring-2 focus:ring-purple-500"
                                    onKeyDown={(e) => {
                                       if (e.key === 'Enter' && cardLinkInput) confirmLinkCard(cardLinkInput);
                                    }}
                                 />
                                 <button
                                    onClick={() => confirmLinkCard(cardLinkInput)}
                                    disabled={!cardLinkInput}
                                    className="p-3 bg-purple-600 text-white rounded-xl disabled:opacity-50"
                                 >
                                    <Check size={20} />
                                 </button>
                              </div>
                           </div>

                           <div className="relative flex py-2 items-center">
                              <div className="flex-grow border-t border-gray-100"></div>
                              <span className="flex-shrink-0 mx-4 text-xs text-gray-400 font-bold uppercase">O bien</span>
                              <div className="flex-grow border-t border-gray-100"></div>
                           </div>

                           <button
                              onClick={generateDigitalCard}
                              className="w-full py-3 bg-gray-50 text-gray-600 hover:bg-gray-100 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
                           >
                              <Zap size={18} className="text-yellow-500" /> Generar Tarjeta Digital
                           </button>
                        </div>
                     </div>
                     <div className="p-4 bg-gray-50 border-t border-gray-100 text-center">
                        <button onClick={() => setIsLinkCardOpen(false)} className="text-sm font-bold text-gray-400 hover:text-gray-600">Cancelar</button>
                     </div>
                  </div>
               </div>
            )
         }

         {/* TRANSACTION DETAIL DRAWER */}
         {selectedTransactionId && (() => {
            const tx = customerTransactions.find(t => t.id === selectedTransactionId);
            if (!tx) return null;

            const getPaymentMethodLabel = (payment: any): string => {
               const method = (payment?.method || '').toString().toUpperCase();
               if (payment?.methodLabel) return payment.methodLabel;
               switch (method) {
                  case 'CASH':
                  case 'EFECTIVO': return 'Efectivo';
                  case 'CARD':
                  case 'TARJETA': return 'Tarjeta';
                  case 'QR': return 'QR / Digital';
                  case 'TRANSFER':
                  case 'TRANSFERENCIA': return 'Transferencia';
                  case 'WALLET': return 'Wallet';
                  case 'CREDIT':
                  case 'CREDITO':
                  case 'CRÉDITO':
                  case 'PENDIENTE': return 'Crédito';
                  default: return payment?.method || 'Otro';
               }
            };

            const getPaymentMethodIcon = (method?: string) => {
               const normalized = (method || '').toUpperCase();
               switch (normalized) {
                  case 'CASH':
                  case 'EFECTIVO': return <Banknote size={14} className="text-green-600" />;
                  case 'CARD':
                  case 'TARJETA': return <CreditCard size={14} className="text-blue-600" />;
                  case 'QR': return <QrCode size={14} className="text-indigo-600" />;
                  case 'TRANSFER':
                  case 'TRANSFERENCIA': return <WalletIcon size={14} className="text-purple-600" />;
                  case 'CREDIT':
                  case 'CREDITO':
                  case 'CRÉDITO':
                  case 'PENDIENTE': return <CreditCard size={14} className="text-cyan-600" />;
                  default: return <DollarSign size={14} className="text-gray-400" />;
               }
            };

            const payments = Array.isArray(tx.payments) ? tx.payments : [];
            const paymentTotal = payments.reduce((acc, p: any) => acc + Number(p?.amount || 0), 0);
            const isRefundDoc = tx.documentType === 'REFUND' || tx.ncfType === 'B04';
            const affectedInvoice = (tx.affectedInvoiceNumber || '').toString().trim();
            const affectedNCF = (tx.affectedNCF || '').toString().trim();

            return (
               <div className="fixed inset-0 z-[100] overflow-hidden">
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedTransactionId(null)} />
                  <div className="absolute inset-y-0 right-0 max-w-md w-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                     <header className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                        <div>
                           <h3 className="text-lg font-black text-gray-900">Detalle de Factura</h3>
                           <p className="text-xs text-gray-400 font-medium tracking-wider">#{tx.displayId || tx.id}</p>
                        </div>
                        <button onClick={() => setSelectedTransactionId(null)} className="p-2 hover:bg-gray-200 rounded-full transition-all">
                           <X size={20} className="text-gray-500" />
                        </button>
                     </header>

                     <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        <section className="space-y-4">
                           <div className="flex justify-between items-start p-4 rounded-2xl bg-gray-50 border border-gray-100">
                              <div>
                                 <p className="text-[10px] font-bold text-gray-400 uppercase">Total Venta</p>
                                 <p className="text-3xl font-black text-gray-900">{config.currencySymbol}{tx.total.toFixed(2)}</p>
                              </div>
                              <div className="text-right">
                                 <p className="text-[10px] font-bold text-gray-400 uppercase">Estado</p>
                                 <div className="mt-1">
                                    {tx.status === 'REFUNDED' ? (
                                       <span className="bg-red-100 text-red-600 px-3 py-1 rounded-full text-xs font-black italic">ANULADO</span>
                                    ) : tx.status === 'PARTIAL_REFUND' ? (
                                       <span className="bg-orange-100 text-orange-600 px-3 py-1 rounded-full text-xs font-black">PARCIAL</span>
                                    ) : (
                                       <span className="bg-green-100 text-green-600 px-3 py-1 rounded-full text-xs font-black">PAGADO</span>
                                    )}
                                 </div>
                              </div>
                           </div>

                           <div className="grid grid-cols-2 gap-4">
                              <div className="p-3 bg-white border border-gray-100 rounded-xl">
                                 <p className="text-[10px] font-bold text-gray-400 uppercase">Fecha / Hora</p>
                                 <p className="text-xs font-bold text-gray-700">{new Date(tx.date).toLocaleString()}</p>
                              </div>
                              <div className="p-3 bg-white border border-gray-100 rounded-xl">
                                 <p className="text-[10px] font-bold text-gray-400 uppercase">Cajero</p>
                                 <p className="text-xs font-bold text-gray-700">{tx.userName || 'Sistema'}</p>
                              </div>
                           </div>
                        </section>

                        <section>
                           <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-3">Artículos del Ticket</h4>
                           <div className="space-y-2">
                              {tx.items.map((item, i) => (
                                 <div key={i} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                                    <div className="flex-1">
                                       <p className="text-sm font-bold text-gray-800">{item.name}</p>
                                       <p className="text-xs text-gray-400 font-medium">{item.quantity} x {config.currencySymbol}{item.price.toFixed(2)}</p>
                                    </div>
                                    <p className="text-sm font-black text-gray-900">{config.currencySymbol}{(item.price * item.quantity).toFixed(2)}</p>
                                 </div>
                              ))}
                           </div>
                        </section>

                        <section className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 space-y-2">
                           <div className="flex justify-between text-xs font-medium text-blue-600/60 uppercase tracking-wider">
                              <span>Subtotal</span>
                              <span>{config.currencySymbol}{(tx.total / (1 + config.taxRate)).toFixed(2)}</span>
                           </div>
                           <div className="flex justify-between text-xs font-medium text-blue-600/60 uppercase tracking-wider">
                              <span>Impuestos ({config.taxRate * 100}%)</span>
                              <span>{config.currencySymbol}{(tx.total - (tx.total / (1 + config.taxRate))).toFixed(2)}</span>
                           </div>
                           <div className="flex justify-between text-lg font-black text-blue-900 border-t border-blue-100 pt-2 mt-2">
                              <span>Total Final</span>
                              <span>{config.currencySymbol}{tx.total.toFixed(2)}</span>
                           </div>
                        </section>

                        <section className="bg-white p-4 rounded-2xl border border-gray-100 space-y-4">
                           <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Detalle de Pago</h4>

                           <div className="grid grid-cols-2 gap-3">
                              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                                 <p className="text-[10px] font-bold text-gray-400 uppercase">Terminal</p>
                                 <p className="text-xs font-bold text-gray-800">{tx.terminalId || 'N/D'}</p>
                              </div>
                              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                                 <p className="text-[10px] font-bold text-gray-400 uppercase">NCF</p>
                                 <p className="text-xs font-bold text-gray-800 truncate">{tx.ncf || 'Sin NCF'}</p>
                              </div>
                              {isRefundDoc && (
                                 <div className="p-3 bg-red-50/60 rounded-xl border border-red-100">
                                    <p className="text-[10px] font-bold text-red-400 uppercase">Factura afectada</p>
                                    <p className="text-xs font-bold text-red-800 truncate">{affectedInvoice || 'No disponible'}</p>
                                 </div>
                              )}
                              {isRefundDoc && (
                                 <div className="p-3 bg-red-50/60 rounded-xl border border-red-100">
                                    <p className="text-[10px] font-bold text-red-400 uppercase">NCF afectado</p>
                                    <p className="text-xs font-bold text-red-800 truncate">{affectedNCF || 'No disponible'}</p>
                                 </div>
                              )}
                           </div>

                           <div className="rounded-xl border border-gray-100 overflow-hidden">
                              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                                 <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Formas de Pago</p>
                              </div>
                              <div className="p-3 space-y-2">
                                 {payments.length === 0 ? (
                                    <p className="text-xs text-gray-400 italic">Sin información de pagos</p>
                                 ) : (
                                    payments.map((payment: any, index: number) => (
                                       <div key={`${tx.id}-payment-${index}`} className="flex items-center justify-between rounded-lg bg-white border border-gray-100 px-3 py-2">
                                          <div className="flex items-center gap-2">
                                             {getPaymentMethodIcon(payment?.method)}
                                             <span className="text-xs font-bold text-gray-700">{getPaymentMethodLabel(payment)}</span>
                                          </div>
                                          <span className="text-xs font-black text-gray-900">
                                             {config.currencySymbol}{Number(payment?.amount || 0).toFixed(2)}
                                          </span>
                                       </div>
                                    ))
                                 )}
                                 <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Total Recibido</span>
                                    <span className="text-sm font-black text-gray-900">{config.currencySymbol}{paymentTotal.toFixed(2)}</span>
                                 </div>
                              </div>
                           </div>
                        </section>
                     </div>

                     <footer className="p-6 border-t border-gray-100 bg-gray-50">
                        <button
                           onClick={() => {
                              printTicket(tx, config);
                           }}
                           className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg"
                        >
                           <Printer size={18} /> Reimprimir
                        </button>
                     </footer>
                  </div>
               </div>
            );
         })()}

         {selectedCustomer && isAbonoModalOpen && (
            <AccountReceivableModal
               isOpen={isAbonoModalOpen}
               onClose={() => setIsAbonoModalOpen(false)}
               customer={selectedCustomer}
               transactions={customerTransactions}
               collections={collections}
               currentUser={currentUser}
               terminalId={terminalId}
               config={config}
               initialAmount={abonoInitialAmount}
               initialInvoices={abonoInitialInvoices}
               onSuccess={async () => {
                  await loadCustomerTransactions(selectedCustomer.id);
                  try {
                     const { db } = await import('../utils/db');
                     const freshCustomers = await db.get('customers') as Customer[];
                     const refreshed = (freshCustomers || []).find(c => c.id === selectedCustomer.id);
                     if (refreshed) {
                        onUpdateCustomer(refreshed);
                     }

                     // Refresh Collections
                     const freshCollections = await db.get('collections') as Collection[];
                     onUpdateCollections(freshCollections || []);
                  } catch (error) {
                     console.error('Failed to refresh customer/collections after collection:', error);
                  } finally {
                     setIsAbonoModalOpen(false);
                  }
               }}
            />
         )}

         {/* ACTIVITY MODAL */}
         {selectedCustomer && (
            <ActivityModal
               isOpen={isActivityModalOpen}
               onClose={() => {
                  setIsActivityModalOpen(false);
                  setSelectedActivity(null);
                  setPrefilledDate(null);
                  fetchActivities();
               }}
               activity={selectedActivity}
               initialDate={prefilledDate || undefined}
               initialResourceId={undefined}
               serviceTypes={[]} // TODO: Fetch service types
               customers={[selectedCustomer]}
               rooms={rooms}
               users={users}
               onSave={async (activity) => {
                  if (selectedActivity) {
                     await agendaService.updateActivity(selectedActivity.id, activity);
                  } else {
                     await agendaService.createActivity({
                        ...activity,
                        customerId: selectedCustomer.id,
                        customerName: selectedCustomer.name
                     });
                  }
                  setIsActivityModalOpen(false);
                  setSelectedActivity(null);
                  setPrefilledDate(null);
                  fetchActivities();
               }}
               onDelete={async (id) => {
                  if (confirm('¿Eliminar actividad?')) {
                     await agendaService.deleteActivity(id);
                     setIsActivityModalOpen(false);
                     setSelectedActivity(null);
                     fetchActivities();
                  }
               }}
            />
         )}

         {isEgoEnrollOpen && (
            <EgoClubEnrollModal
               config={config}
               onClose={() => setIsEgoEnrollOpen(false)}
               onEnrolled={() => { void refreshLoyaltyQueue(); }}
            />
         )}

         {isEgoCardOpen && selectedCustomer && (
            <EgoClubCard
               config={config}
               customer={selectedCustomer}
               currencySymbol={config.currencySymbol || 'RD$'}
               onClose={() => setIsEgoCardOpen(false)}
            />
         )}
      </div>
   );
};

export default CustomerManagement;
