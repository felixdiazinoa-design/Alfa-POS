import { Transaction, BusinessConfig, CashMovement } from '../types';

interface ZReportEmailData {
    transactions: Transaction[];
    cashMovements: CashMovement[];
    config: BusinessConfig;
    userName: string;
    cashCounted: number;
    cashCountedByCurrency?: Record<string, number>;
    notes: string;
    expectedCash: number;
    expectedCashByCurrency?: Record<string, number>;
    discrepancy: number;
    cashDiscrepancyByCurrency?: Record<string, number>;
    cashSalesTotal: number;
    cashIn: number;
    cashOut: number;
}

export const sendZReportEmail = (recipient: string, data: ZReportEmailData) => {
    const {
        config,
        userName,
        cashCounted,
        cashCountedByCurrency,
        notes,
        expectedCash,
        expectedCashByCurrency,
        discrepancy,
        cashDiscrepancyByCurrency,
        cashSalesTotal,
        cashIn,
        cashOut
    } = data;

    const dateStr = new Date().toLocaleDateString();
    const timeStr = new Date().toLocaleTimeString();
    const currency = config.currencySymbol;

    const subject = `Reporte Z - ${config.companyInfo.name} - ${dateStr}`;

    // Build multi-currency section if available
    let multiCurrencySection = '';
    if (cashCountedByCurrency && expectedCashByCurrency && cashDiscrepancyByCurrency) {
        const currencies = Object.keys(expectedCashByCurrency);
        if (currencies.length > 1 || (currencies.length === 1 && currencies[0] !== (config.currencies?.find(c => c.isBase)?.code || 'DOP'))) {
            multiCurrencySection = '\n\nDETALLE POR MONEDA\n================================\n';
            currencies.forEach(currCode => {
                const currInfo = config.currencies?.find(c => c.code === currCode);
                const sym = currInfo?.symbol || currCode;
                const expected = expectedCashByCurrency[currCode] || 0;
                const counted = cashCountedByCurrency[currCode] || 0;
                const disc = cashDiscrepancyByCurrency[currCode] || 0;

                multiCurrencySection += `\n${currCode}:\n`;
                multiCurrencySection += `  Esperado:  ${sym}${expected.toFixed(2)}\n`;
                multiCurrencySection += `  Contado:   ${sym}${counted.toFixed(2)}\n`;
                multiCurrencySection += `  Diferencia: ${sym}${disc > 0 ? '+' : ''}${disc.toFixed(2)}\n`;
            });
        }
    }

    const body = `
REPORTE DE CIERRE DE CAJA (Z)
================================
Empresa: ${config.companyInfo.name}
Fecha: ${dateStr} ${timeStr}
Responsable: ${userName}
================================

RESUMEN DE EFECTIVO
--------------------------------
Ventas en Efectivo: ${currency}${cashSalesTotal.toFixed(2)}
(+) Entradas:       ${currency}${cashIn.toFixed(2)}
(-) Salidas:        ${currency}${cashOut.toFixed(2)}
--------------------------------
Total Esperado:     ${currency}${expectedCash.toFixed(2)}
Conteo Físico:      ${currency}${cashCounted.toFixed(2)}
--------------------------------
DIFERENCIA:         ${currency}${discrepancy > 0 ? '+' : ''}${discrepancy.toFixed(2)}
${discrepancy === 0 ? '(Cuadre Perfecto)' : '(DESCUADRE DETECTADO)'}${multiCurrencySection}

NOTAS DEL CIERRE
--------------------------------
${notes || 'Sin notas adicionales.'}

================================
Generado automáticamente por Alfa POS
    `.trim();

    const mailtoLink = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    // Use window.location.href to trigger the mail client without opening a blank tab
    window.location.href = mailtoLink;
};

