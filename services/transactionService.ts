import { Transaction, DocumentType } from '../types';
import { db } from '../utils/db';

const EPSILON = 0.01;

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const toNumber = (value: unknown): number => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const resolveCurrentConfig = (configCollection: any): any => {
    if (Array.isArray(configCollection)) {
        return configCollection.find((entry: any) => entry?.id === 'current')
            || configCollection.find((entry: any) => entry?.id !== '_db_initialized' && entry?.id !== 'config_metadata')
            || configCollection[0]
            || null;
    }
    return configCollection || null;
};

const getItemTaxRate = (item: any, taxesById: Map<string, any>): number => {
    const taxIds = Array.isArray(item?.appliedTaxIds) ? item.appliedTaxIds : [];
    return taxIds.reduce((sum: number, taxId: string) => {
        const tax = taxesById.get(taxId);
        return sum + Math.max(0, toNumber(tax?.rate));
    }, 0);
};

const deriveFiscalAmountsFromItems = async (data: Partial<Transaction>): Promise<{ netAmount: number; taxAmount: number; total: number } | null> => {
    const items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) return null;

    const grossLineTotal = round2(items.reduce((sum, item: any) => {
        const price = Math.abs(toNumber(item?.price));
        const quantity = Math.abs(toNumber(item?.quantity));
        return sum + (price * quantity);
    }, 0));
    const discountAmount = round2(Math.abs(toNumber(data.discountAmount)));
    const totalAfterDiscount = round2(Math.max(0, grossLineTotal - discountAmount));
    if (totalAfterDiscount <= EPSILON) return null;

    const configCollection = await db.get('config' as any);
    const currentConfig = resolveCurrentConfig(configCollection);
    const taxesById = new Map<string, any>(
        (Array.isArray(currentConfig?.taxes) ? currentConfig.taxes : []).map((tax: any) => [tax.id, tax])
    );

    let netAmount = 0;
    let taxAmount = 0;

    items.forEach((item: any) => {
        const lineGross = Math.abs(toNumber(item?.price)) * Math.abs(toNumber(item?.quantity));
        if (lineGross <= EPSILON) return;

        const itemRatio = lineGross / (grossLineTotal || 1);
        const lineDiscount = discountAmount * itemRatio;
        const lineBaseAfterDiscount = round2(Math.max(0, lineGross - lineDiscount));
        const itemTaxRate = getItemTaxRate(item, taxesById);
        const lineNet = data.isTaxIncluded
            ? round2(lineBaseAfterDiscount / (1 + itemTaxRate))
            : lineBaseAfterDiscount;
        const lineTax = round2(Math.max(0, lineBaseAfterDiscount - lineNet));

        netAmount += lineNet;
        taxAmount += lineTax;
    });

    netAmount = round2(netAmount);
    taxAmount = round2(taxAmount);

    return {
        netAmount,
        taxAmount,
        total: round2(data.isTaxIncluded ? totalAfterDiscount : netAmount + taxAmount)
    };
};

const normalizeFiscalAmounts = async (data: Partial<Transaction>): Promise<{ netAmount?: number; taxAmount?: number }> => {
    const total = round2(Math.abs(toNumber(data.total)));
    if (total <= EPSILON) {
        return {
            netAmount: data.netAmount,
            taxAmount: data.taxAmount
        };
    }

    const providedNet = round2(Math.abs(toNumber(data.netAmount)));
    const providedTax = round2(Math.abs(toNumber(data.taxAmount)));
    if (Math.abs(round2(providedNet + providedTax) - total) <= 0.02) {
        return {
            netAmount: providedNet,
            taxAmount: providedTax
        };
    }

    const derived = await deriveFiscalAmountsFromItems(data);
    if (derived && derived.total > EPSILON) {
        return {
            netAmount: derived.netAmount,
            taxAmount: derived.taxAmount
        };
    }

    if (data.isTaxIncluded) {
        const taxAmount = round2(Math.max(0, total - (total / 1.18)));
        return {
            netAmount: round2(Math.max(0, total - taxAmount)),
            taxAmount
        };
    }

    if (providedTax > EPSILON && providedTax < total) {
        return {
            netAmount: round2(total - providedTax),
            taxAmount: providedTax
        };
    }

    if (providedNet > EPSILON && providedNet < total) {
        return {
            netAmount: providedNet,
            taxAmount: round2(total - providedNet)
        };
    }

    return {
        netAmount: total,
        taxAmount: 0
    };
};

/**
 * Transaction Service
 * Handles transaction ID generation with global sequence numbers
 */
class TransactionService {
    /**
     * Generate next transaction ID with global sequence
     * Uses internal series counters as single source of truth.
     */
    async generateTransactionId(
        documentType: DocumentType,
        seriesId: string
    ): Promise<{
        globalSequence: number;
        displayId: string;
        seriesNumber: number;
    }> {
        // Get the series configuration
        const series = await db.get('internalSequences') as any[] || [];
        const seriesConfig = (series || []).find(s => s.id === seriesId);

        if (!seriesConfig) {
            throw new Error(`Series ${seriesId} not found in internalSequences`);
        }

        // Get next global sequence
        const globalSequence = await db.getNextGlobalSequence();

        // Get and increment the series nextNumber
        const seriesNumber = seriesConfig.nextNumber || 1;

        // Format display ID using series prefix and padding
        const padding = seriesConfig.padding || 6;
        const paddedNumber = seriesNumber.toString().padStart(padding, '0');
        const displayId = `${seriesConfig.prefix}${paddedNumber}`;

        // Update series nextNumber in the original array
        seriesConfig.nextNumber = seriesNumber + 1;
        await db.save('internalSequences', series);

        // Broadcast change to Master (and other terminals)
        try {
            const { syncManager } = await import('./sync/SyncManager');
            await syncManager.broadcastChange('internalSequences', seriesConfig, 'UPDATE');
            console.log(`📡 Broadcasted sequence update for ${seriesId} (next: ${seriesConfig.nextNumber})`);
        } catch (e) {
            // Silently fail if syncManager is not yet initialized or fails
            console.warn(`⚠️ Failed to broadcast sequence update for ${seriesId}:`, e);
        }

        return {
            globalSequence,
            displayId,
            seriesNumber
        };
    }

    /**
     * Create a new transaction with auto-generated IDs
     */
    async createTransaction(
        data: Partial<Transaction>
    ): Promise<Transaction> {
        // Validate required fields
        if (!data.documentType) {
            throw new Error('documentType is required');
        }
        if (!data.seriesId) {
            throw new Error('seriesId is required');
        }

        // Generate IDs
        const { globalSequence, displayId, seriesNumber } =
            await this.generateTransactionId(data.documentType, data.seriesId);
        const normalizedFiscalAmounts = await normalizeFiscalAmounts(data);

        // Create transaction object
        const transaction: Transaction = {
            id: data.id || `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            globalSequence,
            displayId,
            documentType: data.documentType,
            seriesId: data.seriesId,
            seriesNumber,

            // Required fields
            date: data.date || new Date().toISOString(),
            items: data.items || [],
            total: data.total || 0,
            payments: data.payments || [],
            userId: data.userId || '',
            userName: data.userName || '',
            status: data.status || 'COMPLETED',

            // Optional fields
            terminalId: data.terminalId,
            customerId: data.customerId,
            customerName: data.customerName,
            customerSnapshot: data.customerSnapshot,
            taxAmount: normalizedFiscalAmounts.taxAmount,
            netAmount: normalizedFiscalAmounts.netAmount,
            discountAmount: data.discountAmount,
            isTaxIncluded: data.isTaxIncluded,
            ncf: data.ncf,
            ncfType: data.ncfType,
            relatedTransactions: data.relatedTransactions,
            originalTransactionId: data.originalTransactionId,
            refundReason: data.refundReason,
            reservationId: data.reservationId,
            reservationCode: data.reservationCode,
            priorAdvancePaid: data.priorAdvancePaid,
            balanceDueAtSale: data.balanceDueAtSale,
            pendingBalance: data.pendingBalance,
            dueDate: data.dueDate
        };

        // Save only the new document to avoid full-collection rewrites that can block checkout.
        await db.saveDocument('transactions', transaction);
        try {
            await db.saveDocument('transactionHistory', {
                ...transaction,
                syncStatus: transaction.syncStatus || 'PENDING'
            } as any);
        } catch (historyMirrorError) {
            console.warn('⚠️ Transaction history mirror skipped:', historyMirrorError);
        }

        return transaction;
    }

    /**
     * Repair sequence counters based on existing transactions
     * This ensures that nextNumber is always higher than any existing seriesNumber
     * Also performs a self-healing deduplication of data
     */
    async repairSequences(): Promise<{ fixed: string[], details: string[] }> {
        // 1. Self-heal: Deduplicate transactions and inventory
        const healingResults = await this.selfHeal();

        // 2. Repair internal sequences
        const internalRepair = await this.repairInternalSequences();

        // 3. Repair fiscal sequences
        const fiscalRepair = await this.repairFiscalSequences();

        return {
            fixed: [...healingResults.fixed, ...internalRepair.fixed, ...fiscalRepair.fixed],
            details: [...healingResults.details, ...internalRepair.details, ...fiscalRepair.details]
        };
    }

    /**
     * Self-healing: Deduplicate transactions and inventory ledger entries
     */
    async selfHeal(): Promise<{ fixed: string[], details: string[] }> {
        const fixed: string[] = [];
        const details: string[] = [];

        // 1. Deduplicate Transactions
        const transactions = await db.get('transactions') as Transaction[] || [];
        const seenDisplayIds = new Set<string>();
        const cleanedTransactions: Transaction[] = [];
        let duplicateTxnsCount = 0;

        for (const txn of transactions) {
            if (!seenDisplayIds.has(txn.displayId)) {
                seenDisplayIds.add(txn.displayId);
                cleanedTransactions.push(txn);
            } else {
                duplicateTxnsCount++;
            }
        }

        if (duplicateTxnsCount > 0) {
            await db.save('transactions', cleanedTransactions);
            fixed.push('transactions');
            details.push(`Deduplicated transactions: removed ${duplicateTxnsCount} duplicates.`);
            console.log(`🧹 Self-Heal: Removed ${duplicateTxnsCount} duplicate transactions.`);
        }

        // 2. Deduplicate Inventory Ledger
        const ledger = await db.get('inventoryLedger') as any[] || [];
        const seenLedgerKeys = new Set<string>();
        const cleanedLedger: any[] = [];
        let duplicateLedgerCount = 0;

        for (const entry of ledger) {
            // Create a composite key for deduplication
            // Only deduplicate if it has a documentRef that looks like a sequence
            if (entry.documentRef && (entry.documentRef.startsWith('TCK') || entry.documentRef.startsWith('NC') || entry.documentRef.startsWith('TR'))) {
                const key = `${entry.documentRef}-${entry.productId}-${entry.qtyIn}-${entry.qtyOut}`;
                if (!seenLedgerKeys.has(key)) {
                    seenLedgerKeys.add(key);
                    cleanedLedger.push(entry);
                } else {
                    duplicateLedgerCount++;
                }
            } else {
                cleanedLedger.push(entry);
            }
        }

        if (duplicateLedgerCount > 0) {
            await db.save('inventoryLedger', cleanedLedger);
            fixed.push('inventoryLedger');
            details.push(`Deduplicated inventory ledger: removed ${duplicateLedgerCount} duplicates.`);
            console.log(`🧹 Self-Heal: Removed ${duplicateLedgerCount} duplicate inventory entries.`);
        }

        return { fixed, details };
    }

    /**
     * Repair internal sequence counters
     */
    private async repairInternalSequences(): Promise<{ fixed: string[], details: string[] }> {
        const transactions = await db.get('transactions') as Transaction[] || [];
        const series = await db.get('internalSequences') as any[] || [];
        const fixed: string[] = [];
        const details: string[] = [];

        for (const seriesConfig of series) {
            const seriesTransactions = transactions.filter(t => t.seriesId === seriesConfig.id);
            if (seriesTransactions.length === 0) continue;

            // Find max seriesNumber used
            const maxUsed = Math.max(...seriesTransactions.map(t => t.seriesNumber || 0));

            if (seriesConfig.nextNumber <= maxUsed) {
                const oldNext = seriesConfig.nextNumber;
                seriesConfig.nextNumber = maxUsed + 1;
                fixed.push(seriesConfig.id);
                details.push(`Internal ${seriesConfig.id}: ${oldNext} -> ${seriesConfig.nextNumber} (Max used: ${maxUsed})`);
            }
        }

        if (fixed.length > 0) {
            await db.save('internalSequences', series);
            console.log('✅ Internal sequence counters repaired:', details);
        }

        return { fixed, details };
    }

    /**
     * Repair fiscal sequence counters (NCF)
     */
    async repairFiscalSequences(): Promise<{ fixed: string[], details: string[] }> {
        const transactions = await db.get('transactions') as Transaction[] || [];
        const fiscalRanges = await db.get('fiscalRanges') as any[] || [];
        const fixed: string[] = [];
        const details: string[] = [];

        for (const range of fiscalRanges) {
            const ncfTransactions = transactions.filter(t => t.ncfType === range.type && t.ncf?.startsWith(range.prefix));
            if (ncfTransactions.length === 0) continue;

            // Extract numbers from NCFs (e.g., B0100000001 -> 1)
            const usedNumbers = ncfTransactions.map(t => {
                const numPart = t.ncf?.substring(range.prefix.length);
                return parseInt(numPart || '0', 10);
            });

            const maxUsed = Math.max(...usedNumbers);

            if (range.currentGlobal < maxUsed) {
                const oldGlobal = range.currentGlobal;
                range.currentGlobal = maxUsed;
                fixed.push(range.type);
                details.push(`Fiscal ${range.type}: ${oldGlobal} -> ${range.currentGlobal} (Max used: ${maxUsed})`);
            }
        }

        if (fixed.length > 0) {
            await db.save('fiscalRanges', fiscalRanges);
            console.log('✅ Fiscal sequence counters repaired:', details);
        }

        return { fixed, details };
    }

    /**
     * Validate sequence integrity
     * Checks for gaps or duplicates in globalSequence
     */
    async validateSequenceIntegrity(): Promise<{
        isValid: boolean;
        gaps: number[];
        duplicates: number[];
    }> {
        const transactions = await db.get('transactions') as Transaction[] || [];

        // Filter transactions with globalSequence
        const sequenced = transactions
            .filter(t => t.globalSequence !== undefined)
            .sort((a, b) => (a.globalSequence || 0) - (b.globalSequence || 0));

        const gaps: number[] = [];
        const duplicates: number[] = [];
        const seen = new Set<number>();

        for (let i = 0; i < sequenced.length; i++) {
            const seq = sequenced[i].globalSequence!;

            // Check for duplicates
            if (seen.has(seq)) {
                duplicates.push(seq);
            }
            seen.add(seq);

            // Check for gaps
            if (i > 0) {
                const prevSeq = sequenced[i - 1].globalSequence!;
                const expectedSeq = prevSeq + 1;
                if (seq !== expectedSeq) {
                    for (let missing = expectedSeq; missing < seq; missing++) {
                        gaps.push(missing);
                    }
                }
            }
        }

        return {
            isValid: gaps.length === 0 && duplicates.length === 0,
            gaps,
            duplicates
        };
    }

    /**
     * Get transactions by document type
     */
    async getTransactionsByType(documentType: DocumentType): Promise<Transaction[]> {
        const transactions = await db.get('transactions') as Transaction[] || [];
        return transactions.filter(t => t.documentType === documentType);
    }

    /**
     * Get transactions by series
     */
    async getTransactionsBySeries(seriesId: string): Promise<Transaction[]> {
        const transactions = await db.get('transactions') as Transaction[] || [];
        return transactions.filter(t => t.seriesId === seriesId);
    }

    /**
     * Create a split transaction (Sales + Returns)
     */
    async createSplitTransaction(
        data: {
            saleTransaction?: Partial<Transaction>,
            refundTransaction?: Partial<Transaction>,
            walletDeposit?: { customerId: string, amount: number },
            walletPayment?: { customerId: string, amount: number }
        }
    ): Promise<{ sale?: Transaction, refund?: Transaction }> {
        const results: { sale?: Transaction, refund?: Transaction } = {};

        // 1. Process Refund (Credit Note B04) first to "free up" balance or apply to wallet
        if (data.refundTransaction) {
            results.refund = await this.createTransaction(data.refundTransaction);
        }

        // 2. Process Sale (Invoice B01/B02)
        if (data.saleTransaction) {
            // Link to the refund if it exists
            if (results.refund) {
                if (!data.saleTransaction.relatedTransactions) data.saleTransaction.relatedTransactions = [];
                data.saleTransaction.relatedTransactions.push(results.refund.id);
                data.saleTransaction.affectedNCF = results.refund.ncf;
                data.saleTransaction.affectedInvoiceNumber = results.refund.displayId;
            }
            results.sale = await this.createTransaction(data.saleTransaction);
        }

        // 3. Update Wallet if applicable
        if (data.walletDeposit) {
            await this.updateWalletBalance(data.walletDeposit.customerId, data.walletDeposit.amount, 'DEPOSIT', results.refund?.displayId);
        }

        if (data.walletPayment) {
            await this.updateWalletBalance(data.walletPayment.customerId, -data.walletPayment.amount, 'PAYMENT', results.sale?.displayId);
        }

        return results;
    }

    /**
     * applyRefundToWallet
     * Dispatched when a Credit Note (NC) has no associated sale in the same session.
     * Automatically adds the refund amount to the customer's wallet balance.
     */
    async applyRefundToWallet(
        customerId: string,
        amount: number,
        refundDisplayId: string
    ): Promise<void> {
        console.log(`💰 [Scenario B] Applying refund ${amount} to wallet for customer ${customerId}`);
        await this.updateWalletBalance(customerId, amount, 'DEPOSIT', refundDisplayId);
    }

    /**
     * Atomic Wallet Balance Update
     */
    async updateWalletBalance(
        customerId: string,
        amount: number,
        type: 'DEPOSIT' | 'PAYMENT' | 'REFUND',
        referenceId?: string
    ): Promise<void> {
        // In a real SQLite environment, this would be wrapped in a transaction
        // Since we are using an adapter, we rely on its internal handling or the server's lock

        const wallets = await db.get('wallets' as any) as any[] || [];
        let wallet = wallets.find(w => w.customerId === customerId);

        if (!wallet) {
            // Create wallet if not exists
            wallet = {
                id: `WLT-${customerId}`,
                customerId,
                balance: 0,
                currency: 'DOP',
                status: 'ACTIVE',
                updatedAt: new Date().toISOString()
            };
            wallets.push(wallet);
        }

        if (wallet.status !== 'ACTIVE') {
            throw new Error(`Wallet for customer ${customerId} is not active.`);
        }

        const newBalance = wallet.balance + amount;
        if (newBalance < -0.01) { // Allow tiny precision diff
            throw new Error('Insufficient wallet balance');
        }

        wallet.balance = parseFloat(newBalance.toFixed(2));
        wallet.updatedAt = new Date().toISOString();

        await db.save('wallets' as any, wallets);

        // Record wallet transaction
        const walletTxns = await db.get('wallet_transactions' as any) as any[] || [];
        walletTxns.push({
            id: `WLT-TXN-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            walletId: wallet.id,
            type,
            amount,
            referenceId,
            createdAt: new Date().toISOString()
        });
        await db.save('wallet_transactions' as any, walletTxns);
    }

    /**
     * Get transaction by display ID
     */
    async getTransactionByDisplayId(displayId: string): Promise<Transaction | null> {
        const transactions = await db.get('transactions') as Transaction[] || [];
        return transactions.find(t => t.displayId === displayId) || null;
    }
}

export const transactionService = new TransactionService();
