import { useMemo } from 'react';
import { Customer, Transaction } from '../types';

export interface DelinquentInvoice extends Transaction {
    daysLate: number;
    isExpired: boolean;
}

/**
 * Hook to manage credit control and delinquency detection.
 * Alfa POS Policy: Delinquent if any invoice is > 15 days past due.
 */
export const useCreditControl = (customer: Customer | null, transactions: Transaction[]) => {
    const delinquencyInfo = useMemo(() => {
        if (!customer) return { isDelinquent: false, totalPastDue: 0, unpaidInvoices: [] as DelinquentInvoice[] };

        const DELINQUENCY_THRESHOLD_DAYS = 15;
        const now = new Date();

        const unpaidInvoices = transactions
            .filter(tx => tx.customerId === customer.id && (tx.pendingBalance || 0) > 0)
            .map(tx => {
                const dueDate = tx.dueDate ? new Date(tx.dueDate) : new Date(tx.date);
                const diffTime = now.getTime() - dueDate.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                return {
                    ...tx,
                    daysLate: diffDays > 0 ? diffDays : 0,
                    isExpired: diffDays > DELINQUENCY_THRESHOLD_DAYS
                } as DelinquentInvoice;
            })
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const totalPastDue = unpaidInvoices.reduce((acc, inv) => acc + (inv.pendingBalance || 0), 0);
        const isDelinquent = unpaidInvoices.some(inv => inv.isExpired);

        return {
            isDelinquent,
            totalPastDue,
            unpaidInvoices
        };
    }, [customer, transactions]);

    return delinquencyInfo;
};

/**
 * Suggests how to distribute a global payment amount across unpaid invoices using FIFO.
 */
export const suggestFIFOAllocation = (amount: number, unpaidInvoices: DelinquentInvoice[]) => {
    let remaining = amount;
    const allocations = [];

    for (const inv of unpaidInvoices) {
        if (remaining <= 0) break;

        const pending = inv.pendingBalance || 0;
        const toPay = Math.min(remaining, pending);

        if (toPay > 0) {
            allocations.push({
                transactionId: inv.id,
                displayId: inv.displayId,
                amount: parseFloat(toPay.toFixed(2))
            });
            remaining -= toPay;
        }
    }

    return {
        allocations,
        remaining: parseFloat(remaining.toFixed(2))
    };
};
