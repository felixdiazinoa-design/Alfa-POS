import { BusinessConfig, ZReport } from '../../../types';
import { resolveTerminalDisplayName } from '../../../utils/transactionHistoryPresentation';
import { getCloseReceiptSummary, closeTaxLabel } from '../../../utils/closeReceiptSummary';
import { getZReportPaymentMethodSummary, paymentMethodSummaryTotal } from '../../../utils/zReportPaymentSummary';

export const generateZReportReceipt = (
  report: ZReport,
  hiddenModules: string[] = [],
  config?: BusinessConfig,
): string => {
  const width = '80mm'; // Standard thermal paper width
  const isXReport = (report as any).reportType === 'X';
  const reportTitle = isXReport ? 'CIERRE X (ARQUEO)' : 'REPORTE DE CIERRE (Z)';
  const cashExpected = report.cashExpected || {};
  const cashCounted = report.cashCounted || {};
  const cashDiscrepancy = report.cashDiscrepancy || {};
  const cashMovementDetails = Array.isArray(report.cashMovementDetails) ? report.cashMovementDetails : [];
  const stats = (report.stats || {}) as any;
  const rawCurrency = String(report.baseCurrency || '').trim();
  const currencyCode = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : '';
  const currencyPrefix = currencyCode ? '' : (rawCurrency || '$');
  const terminalName = resolveTerminalDisplayName(report.terminalId, config?.terminals || []);
  const enabledSections = new Set(report.enabledSections || []);
  const reportDetails = report.reportDetails || {};
  const denominationBreakdown = report.denominationBreakdown || report.denomination_breakdown || {};
  const hasDenominationBreakdown = Object.values(denominationBreakdown)
    .some(lines => Array.isArray(lines) && lines.length > 0);
  const serviceTypeSummary = report.serviceTypeSummary || [];
  const closeSummary = getCloseReceiptSummary(report);
  const paymentMethodSummary = getZReportPaymentMethodSummary(report, config);
  const paymentMethodsTotal = paymentMethodSummaryTotal(paymentMethodSummary);
  const paymentMethodDeclarations = report.paymentMethodDeclarations || [];
  const escapeLabel = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

  const formatCurrency = (amount: number) => {
    const value = Number(amount || 0);
    if (currencyCode) {
      try {
        return new Intl.NumberFormat('es-DO', { style: 'currency', currency: currencyCode }).format(value);
      } catch {
        // Some legacy Z reports stored symbols instead of ISO currency codes.
      }
    }
    return `${currencyPrefix}${value.toFixed(2)}`;
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString('es-DO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  // Helper for dashed lines
  const line = '-'.repeat(32); // Approx 32 chars for 58mm, adjust for 80mm if needed

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${isXReport ? 'X-Report' : 'Z-Report'} ${report.sequenceNumber}</title>
      <style>
        @page { margin: 0; size: auto; }
        body {
          font-family: 'Courier New', Courier, monospace; /* Monospaced for alignment */
          width: ${width};
          margin: 0;
          padding: 10px;
          font-size: 12px;
          line-height: 1.2;
          color: black;
          background: white;
        }
        .center { text-align: center; }
        .right { text-align: right; }
        .bold { font-weight: bold; }
        .row { display: flex; justify-content: space-between; }
        .divider { border-top: 1px dashed black; margin: 5px 0; }
        .section-title { margin-top: 10px; font-weight: bold; text-transform: uppercase; border-bottom: 1px solid black; display: inline-block; }
        .total-row { font-size: 14px; font-weight: bold; margin-top: 5px; }
      </style>
    </head>
    <body>
      
      <!-- HEADER -->
      <div class="center">
        <div class="bold" style="font-size: 16px;">ALFA POS</div>
        <div>Sucursal Principal</div>
        <div>RNC: 123456789</div>
        <div>Tel: 809-555-0123</div>
        <br/>
        <div class="bold" style="font-size: 14px;">${reportTitle}</div>
        <div class="bold">${report.sequenceNumber}</div>
      </div>

      <div class="divider"></div>

      <!-- INFO -->
      <div class="row">
        <span>Fecha:</span>
        <span>${formatDate(report.closedAt)}</span>
      </div>
      <div class="row">
        <span>Cajero:</span>
        <span class="bold">${report.closedByUserName}</span>
      </div>
      <div class="row" style="font-size: 14px; margin-top: 4px;">
        <span class="bold">CAJA/TERMINAL:</span>
        <span class="bold">${terminalName}</span>
      </div>

      <div class="divider"></div>

      <!-- FINANCIAL SUMMARY -->
      ${!hiddenModules.includes('FINANCIAL') ? `
      <div class="bold">RESUMEN FINANCIERO</div>
      <div class="row">
        <span>Ventas Brutas:</span>
        <span>${formatCurrency(stats.grossSales || 0)}</span>
      </div>
      <div class="row">
        <span>Devoluciones/NC:</span>
        <span>- ${formatCurrency(stats.returnsTotal || 0)}</span>
      </div>
      <div class="divider" style="margin: 2px 0; border-top: 0.5px solid #ccc;"></div>
      <div class="row">
        <span>Ventas Netas:</span>
        <span class="bold">${formatCurrency(stats.netSales || 0)}</span>
      </div>
      <div class="row">
        <span>Transacciones:</span>
        <span>${report.transactionCount}</span>
      </div>
      ` : ''}

      ${serviceTypeSummary.length > 0 ? `
      <div class="section-title">VENTAS POR TIPO DE SERVICIO</div>
      ${closeSummary.services.map(line => `
        <div class="row">
          <span>${line.label}</span>
          <span>${formatCurrency(line.amount)}</span>
        </div>
      `).join('')}
      <div class="row bold"><span>Total por servicio</span><span>${formatCurrency(closeSummary.total)}</span></div>
      ` : ''}

      ${closeSummary.taxes.length > 0 ? `
      <div class="section-title">IMPUESTOS Y PROPINA</div>
      ${closeSummary.taxes.map(line => `
        <div class="row"><span>${escapeLabel(closeTaxLabel(line))}</span><span>${formatCurrency(line.amount)}</span></div>
      `).join('')}
      <div style="font-size: 10px;">Desglose informativo: no sumar al total.</div>
      ` : ''}
      
      <!-- PAYMENT METHODS -->
      ${!hiddenModules.includes('PAYMENTS') ? `
      <div class="section-title">FORMAS DE PAGO</div>
      ${paymentMethodSummary.map(line => `
        <div class="row">
          <span>${escapeLabel(line.name)}:</span>
          <span>${formatCurrency(Number(line.amount || 0))}</span>
        </div>
      `).join('')}
      <div class="row bold"><span>Total formas de pago:</span><span>${formatCurrency(paymentMethodsTotal)}</span></div>
      ` : ''}

      <!-- CASH DETAILS -->
      ${!hiddenModules.includes('CASH_DETAILS') ? `
      <div class="section-title">ARQUEO DE CAJA</div>
      ${Object.keys(cashExpected).map(currency => {
    const expected = cashExpected[currency] || 0;
    const counted = cashCounted[currency] || 0;
    const diff = cashDiscrepancy[currency] || 0;
    return `
          <div style="margin-bottom: 5px;">
            <div class="bold" style="text-decoration: underline;">${currency}</div>
            ${currency === report.baseCurrency ? `
            <div class="row"><span>Efectivo en ventas:</span> <span>${formatCurrency(report.cashSales || 0)}</span></div>
            <div class="row"><span>(+) Entradas:</span> <span>${formatCurrency(report.cashIn || 0)}</span></div>
            <div class="row"><span>(-) Salidas:</span> <span>${formatCurrency(report.cashOut || 0)}</span></div>
            ` : ''}
            <div class="row"><span>Efectivo esperado:</span> <span>${formatCurrency(expected)}</span></div>
            <div class="row"><span>Efectivo contado:</span> <span>${formatCurrency(counted)}</span></div>
            <div class="row"><span>Diferencia:</span> <span class="bold">${diff > 0 ? '+' : ''}${formatCurrency(diff)}</span></div>
          </div>
        `;
  }).join('')}
      ` : ''}

      ${!hiddenModules.includes('CASH_DETAILS') && paymentMethodDeclarations.length > 0 ? `
      <div class="section-title">DECLARACIÓN DE FORMAS DE PAGO</div>
      ${paymentMethodDeclarations.map(line => `
        <div style="margin-bottom: 5px;">
          <div class="bold">${escapeLabel(line.name)}</div>
          <div class="row"><span>Esperado:</span><span>${formatCurrency(line.expected)}</span></div>
          <div class="row"><span>Declarado:</span><span>${formatCurrency(line.declared)}</span></div>
          <div class="row"><span>Diferencia:</span><span class="bold">${line.difference > 0 ? '+' : ''}${formatCurrency(line.difference)}</span></div>
        </div>
      `).join('')}
      ` : ''}

      ${!hiddenModules.includes('CASH_DETAILS') && cashMovementDetails.length > 0 ? `
      <div class="section-title">ENTRADAS / SALIDAS DE EFECTIVO</div>
      ${cashMovementDetails.map(movement => `
        <div style="margin-bottom: 5px;">
          <div class="row">
            <span class="bold">${movement.type === 'IN' ? 'Entrada' : 'Salida'}</span>
            <span>${formatCurrency(Number(movement.amount || 0))}</span>
          </div>
          <div style="font-size: 11px;">${movement.reason || 'Movimiento General'}</div>
          <div style="font-size: 10px;">${movement.timestamp ? formatDate(movement.timestamp) : ''}${movement.userName ? ` · ${movement.userName}` : ''}</div>
        </div>
      `).join('')}
      ` : ''}

      <!-- KPIS -->
      ${!hiddenModules.includes('KPIS') && report.stats ? `
        <div class="divider"></div>
        <div class="bold center">ESTADÍSTICAS DEL TURNO</div>
        <div class="row">
          <span>Ticket Promedio:</span>
          <span>${formatCurrency(stats.averageTicket || 0)}</span>
        </div>
        <div class="row">
          <span>Items / Venta:</span>
          <span>${Number(stats.itemsPerSale || 0).toFixed(1)}</span>
        </div>
        <div class="row">
          <span>Prod. Estrella:</span>
          <span>${stats.topProduct?.name.substring(0, 15) || 'N/A'}</span>
        </div>
        <div class="right" style="font-size: 10px;">(${stats.topProduct?.quantity || 0} unds)</div>
      ` : ''}

      <!-- AUDIT (New) -->
      ${!hiddenModules.includes('AUDIT') && report.stats ? `
        <div class="divider"></div>
        <div class="bold center">AUDITORÍA</div>
        <div class="row">
          <span>Devoluciones:</span>
          <span>${stats.returnsCount || 0} (${formatCurrency(stats.returnsTotal || 0)})</span>
        </div>
        <div class="row">
          <span>Descuentos:</span>
          <span>${formatCurrency(stats.discountsTotal || 0)}</span>
        </div>
        <div class="row">
          <span>Recaud. Anticipos:</span>
          <span class="bold">${formatCurrency(stats.advancementsTotal || 0)}</span>
        </div>
      ` : ''}

      ${enabledSections.has('SELLER_SUMMARY') ? `
        <div class="section-title">RESUMEN X VENDEDOR</div>
        ${(reportDetails.sellerSummary || []).map(seller => `
          <div class="row"><span>${seller.userName} (${seller.transactionCount})</span><span>${formatCurrency(seller.netSales)}</span></div>
        `).join('') || '<div>Sin ventas registradas.</div>'}
      ` : ''}

      ${enabledSections.has('ITEM_SUMMARY') ? `
        <div class="section-title">RESUMEN X ARTÍCULO</div>
        ${(reportDetails.itemSummary || []).map(item => `
          <div class="row"><span>${item.productName} x ${item.quantity}</span><span>${formatCurrency(item.netSales)}</span></div>
        `).join('') || '<div>Sin artículos registrados.</div>'}
      ` : ''}

      ${enabledSections.has('TAX_SUMMARY') && closeSummary.taxes.length === 0 && !Array.isArray(report.closeTaxSummary) ? `
        <div class="section-title">IMPUESTOS</div>
        ${(reportDetails.taxSummary || []).map(tax => {
          const rate = Number(tax.rate || 0) <= 1 ? Number(tax.rate || 0) * 100 : Number(tax.rate || 0);
          return `<div><div class="bold">${tax.taxName} (${rate.toFixed(2)}%)</div><div class="row"><span>Base:</span><span>${formatCurrency(tax.taxableBase)}</span></div><div class="row"><span>Impuesto:</span><span>${formatCurrency(tax.taxAmount)}</span></div></div>`;
        }).join('') || '<div>Sin impuestos registrados.</div>'}
      ` : ''}

      ${(enabledSections.has('CURRENCY_BREAKDOWN') || hasDenominationBreakdown) ? `
        <div class="section-title">DESGLOSE DE MONEDA</div>
        ${Object.entries(denominationBreakdown).map(([currency, lines]) => `
          <div class="bold">${currency}</div>
          ${(lines || []).map(entry => `<div class="row"><span>${entry.denomination} x ${entry.quantity}</span><span>${Number(entry.total || 0).toFixed(2)}</span></div>`).join('')}
        `).join('') || '<div>Sin denominaciones registradas.</div>'}
      ` : ''}

      ${enabledSections.has('HOURLY_SALES') ? `
        <div class="section-title">VENTAS X HORA</div>
        ${(reportDetails.hourlySales || []).map(hour => `
          <div class="row"><span>${hour.label} (${hour.transactionCount})</span><span>${formatCurrency(hour.netSales)}</span></div>
        `).join('') || '<div>Sin ventas registradas.</div>'}
      ` : ''}

      <br/><br/>
      <div class="divider"></div>
      <div class="center">
        <br/>
        __________________________<br/>
        Firma del Cajero
      </div>
      ${isXReport ? '<div class="center bold" style="font-size: 10px; margin-top: 8px;">ARQUEO PARCIAL - NO LIMPIA VENTAS</div>' : ''}
      <br/>
      <div class="center" style="font-size: 10px;">
        Generado por ALFA POS<br/>
        ${new Date().toLocaleString()}
      </div>

    </body>
    </html>
  `;
};
