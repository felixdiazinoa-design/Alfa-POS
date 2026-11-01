import { Transaction, BusinessConfig, Reservation } from '../types';
import { PrintRouterService } from '../services/printer/PrintRouterService';
import { buildEscPosReservationPayload, buildEscPosTicketPayload } from '../services/printer/EscPosFormatter';
import { shouldSuppressBrowserPrintFallback } from '../services/printer/PrintRuntime';
import { dbAdapter } from '../services/db';

export const printTicket = async (transaction: Transaction, config: BusinessConfig) => {
    const { companyInfo, currencySymbol, receiptConfig, currencies } = config;
    const users = ((await dbAdapter.getCollection('users')) || []) as any[];
    const dateStr = new Date(transaction.date).toLocaleDateString();
    const timeStr = new Date(transaction.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Calculate totals and savings
    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    const isTaxIncluded = transaction.isTaxIncluded || false;

    // 1. Calculate Raw Totals
    let rawNetTotal = 0;
    let rawTaxTotal = 0;
    let rawGrossTotal = 0;

    transaction.items.forEach(item => {
        const originalPrice = item.originalPrice || item.price;
        const lineVal = item.price * item.quantity;
        const lineDiscount = (originalPrice - item.price) * item.quantity;

        discountTotal += lineDiscount;
        rawGrossTotal += lineVal;

        // Determine Tax Rate for this item
        let itemTaxRate = 0;
        if (item.appliedTaxIds && item.appliedTaxIds.length > 0) {
            item.appliedTaxIds.forEach(id => {
                const t = (config.taxes || []).find(tax => tax.id === id);
                if (t) itemTaxRate += t.rate;
            });
        } else {
            itemTaxRate = config.taxRate || 0;
        }

        let lineNet = 0;
        let lineTax = 0;

        if (isTaxIncluded) {
            lineNet = lineVal / (1 + itemTaxRate);
            lineTax = lineVal - lineNet;
        } else {
            lineNet = lineVal;
            lineTax = lineNet * itemTaxRate;
        }

        rawNetTotal += lineNet;
        rawTaxTotal += lineTax;
    });

    // 2. Apply Global Discount
    if (transaction.discountAmount && transaction.discountAmount > 0) {
        discountTotal += transaction.discountAmount;

        if (isTaxIncluded) {
            const ratio = (rawGrossTotal - transaction.discountAmount) / (rawGrossTotal || 1);
            subtotal = rawNetTotal * ratio;
            taxTotal = rawTaxTotal * ratio;
        } else {
            subtotal = rawNetTotal - transaction.discountAmount;
            const ratio = subtotal / (rawNetTotal || 1);
            taxTotal = rawTaxTotal * ratio;
        }
    } else {
        subtotal = rawNetTotal;
        taxTotal = rawTaxTotal;
    }

    const finalTotal = transaction.total || (subtotal + taxTotal);
    const savings = discountTotal;

    // NCF Type Label Map
    const ncfTypeLabels: Record<string, string> = {
        'B01': 'FACTURA DE CRÉDITO FISCAL',
        'B02': 'FACTURA DE CONSUMO',
        'B04': 'NOTA DE CRÉDITO',
        'B14': 'REGÍMENES ESPECIALES',
        'B15': 'GUBERNAMENTAL'
    };

    const documentTitle = transaction.ncfType ? (ncfTypeLabels[transaction.ncfType] || 'FACTURA DE VENTA') : 'TICKET DE VENTA';
    const isCreditNote = transaction.ncfType === 'B04' || transaction.documentType === 'REFUND';

    // Foreign Currency Calculation
    const foreignCurrenciesHtml = receiptConfig?.showForeignCurrencyTotals && currencies ? currencies
        .filter(c => !c.isBase && c.isEnabled)
        .map(c => {
            const converted = finalTotal / c.rate;
            return `<div class="meta-row" style="font-size: 11px; font-weight: bold;">${c.code}: ${c.symbol}${converted.toFixed(2)}</div>`;
        }).join('') : '';

    // Generate HTML content for the receipt
    const receiptHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Ticket #${transaction.displayId || transaction.id}</title>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
            <style>
                @page { size: 80mm auto; margin: 0; }
                body {
                    font-family: 'Courier New', Courier, monospace;
                    width: 72mm;
                    margin: 0 auto;
                    padding: 4mm;
                    font-size: 14px;
                    line-height: 1.2;
                    color: #000;
                    background: #fff;
                }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .text-left { text-align: left; }
                .font-bold { font-weight: 700; }
                .font-black { font-weight: 900; }
                
                .header-logo {
                    display: block;
                    margin: 0 auto 5px auto;
                    max-width: 100%;
                    height: auto;
                    object-fit: contain;
                    filter: grayscale(100%) contrast(150%);
                }
                
                .company-name { font-size: 18px; font-weight: 900; margin-bottom: 2px; text-transform: uppercase; }
                .company-info { font-size: 12px; color: #000; }
                
                .divider { border-top: 1px dashed #000; margin: 8px 0; }
                .divider-solid { border-top: 2px solid #000; margin: 8px 0; }
                
                .doc-title { font-size: 16px; font-weight: 900; text-transform: uppercase; margin-bottom: 2px; }
                .ncf-row { font-size: 14px; font-weight: 700; margin-bottom: 2px; }
                .meta-row { font-size: 12px; color: #000; }

                .items-table { width: 100%; border-collapse: collapse; margin-top: 5px; }
                .items-table th { text-align: left; font-size: 12px; border-bottom: 1px solid #000; padding-bottom: 2px; }
                .items-table td { padding: 4px 0; vertical-align: top; border-bottom: none; }
                
                .item-name { font-weight: 700; font-size: 14px; display: block; }
                .item-meta { font-size: 12px; color: #000; display: block; line-height: 1.1; margin-left: 5px; }
                .item-price { text-align: right; font-weight: 700; font-size: 14px; white-space: nowrap; }

                .totals-section { margin-top: 5px; }
                .total-row { display: flex; justify-content: space-between; margin-bottom: 2px; font-size: 14px; }
                .total-final { font-size: 20px; font-weight: 900; margin-top: 5px; border-top: 2px solid #000; padding-top: 5px; }
                
                .savings-box {
                    border: 2px solid #000;
                    padding: 5px;
                    margin: 10px 0;
                    text-align: center;
                    font-weight: 700;
                    font-size: 14px;
                }
                
                .footer { margin-top: 15px; text-align: center; font-size: 11px; }
                
                #qrcode {
                    width: 80px;
                    height: 80px;
                    margin: 10px auto;
                }
                #qrcode img { margin: 0 auto; }
            </style>
        </head>
        <body>
            <div class="text-center">
                ${receiptConfig?.logo ? `<img src="${receiptConfig.logo}" class="header-logo" alt="Logo" />` : ''}
                <div class="company-name">${companyInfo.name}</div>
                <div class="company-info">
                    <div>RNC: ${companyInfo.rnc}</div>
                    <div>${companyInfo.address}</div>
                    <div>TEL: ${companyInfo.phone}</div>
                </div>
            </div>

            <div class="divider"></div>
            
            <div class="text-center">
                <div class="doc-title">${documentTitle}</div>
                ${transaction.ncf ? `<div class="ncf-row">NCF: ${transaction.ncf}</div>` : ''}
                <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                    <div class="meta-row" style="font-weight: bold;">Ticket: ${transaction.displayId || transaction.id}</div>
                    <div class="meta-row">${dateStr} ${timeStr}</div>
                </div>
            </div>

            <div class="divider"></div>

            ${(() => {
            const snapshot = transaction.customerSnapshot;
            const name = snapshot?.name || transaction.customerName || 'Cliente Mostrador';
            const cleanName = (name === 'null' || !name) ? 'Cliente Mostrador' : name;

            let html = `<div class="text-left" style="margin-bottom: 5px;">
                    <div style="font-weight: bold;">Cliente: ${cleanName}</div>`;

            if (snapshot && cleanName !== 'Cliente Mostrador') {
                if (snapshot.taxId) html += `<div class="meta-row">RNC/Ced: ${snapshot.taxId}</div>`;
                if (snapshot.address) html += `<div class="meta-row">Dir: ${snapshot.address}</div>`;
                if (snapshot.phone) html += `<div class="meta-row">Tel: ${snapshot.phone}</div>`;
                if (snapshot.email) html += `<div class="meta-row">Email: ${snapshot.email}</div>`;
            }

            html += `</div>`;
            return html;
        })()}

            <div class="divider"></div>

            <table class="items-table">
                <tbody>
                    ${transaction.items.map(item => {
            let itemTaxRate = 0;
            if (item.appliedTaxIds && item.appliedTaxIds.length > 0) {
                item.appliedTaxIds.forEach(id => {
                    const t = (config.taxes || []).find(tax => tax.id === id);
                    if (t) itemTaxRate += t.rate;
                });
            } else {
                itemTaxRate = config.taxRate || 0;
            }

            const lineVal = item.price * item.quantity;
            let iTax = 0;
            if (isTaxIncluded) {
                iTax = lineVal - (lineVal / (1 + itemTaxRate));
            } else {
                iTax = lineVal * itemTaxRate;
            }

            const originalPrice = item.originalPrice || item.price;
            const hasDiscount = originalPrice > item.price;

            const trackingHtml = [];
            if (item.trackingData && item.trackingData.length > 0) {
                if (receiptConfig?.showSerialNumbers) {
                    const serials = item.trackingData.filter(t => t.type === 'SERIE' || t.type === 'SERIAL').map(t => t.trackingCode);
                    if (serials.length > 0) {
                        trackingHtml.push(`No. Serie: ${serials.join(', ')}`);
                    }
                }
                if (receiptConfig?.showLotNumbers) {
                    const lots = item.trackingData.filter(t => t.type === 'LOTE' || t.type === 'LOT').map(t => t.trackingCode);
                    if (lots.length > 0) {
                        trackingHtml.push(`Lote: ${lots.join(', ')}`);
                    }
                }
            }
            const hasTrackingHtml = trackingHtml.length > 0;
            let sellerNameHtml = '';
            if (item.salespersonId) {
                const sellerUser = users.find((u: any) => u.id === item.salespersonId);
                const sellerName = sellerUser ? sellerUser.name.split(' ')[0] : 'Vendedor';
                sellerNameHtml = `<br/>Vendedor: ${sellerName}`;
            }

            return `
                        <tr>
                            <td style="width: 70%;">
                                <span class="item-name">${item.name}</span>
                                <span class="item-meta">
                                    ${item.quantity} x ${currencySymbol}${item.price.toFixed(2)}
                                    ${hasDiscount ? `<span style="text-decoration: line-through; color: #999; margin-left: 5px;">${currencySymbol}${originalPrice.toFixed(2)}</span>` : ''}
                                    ${item.modifiers ? `<br/>Op: ${item.modifiers.join(', ')}` : ''}
                                    <br/>ITBIS: ${currencySymbol}${iTax.toFixed(2)}
                                    ${sellerNameHtml}
                                    ${hasTrackingHtml ? `<br/>${trackingHtml.join('<br/>')}` : ''}
                                </span>
                            </td>
                            <td class="item-price">
                                ${currencySymbol}${lineVal.toFixed(2)}
                            </td>
                        </tr>
                    `}).join('')}
                </tbody>
            </table>

            <div class="divider"></div>

            <div class="totals-section">
                <div class="total-row">
                    <span>SUBTOTAL</span>
                    <span>${currencySymbol}${(subtotal || 0).toFixed(2)}</span>
                </div>
                ${discountTotal > 0 ? `
                <div class="total-row">
                    <span>DESCUENTO TOTAL</span>
                    <span>-${currencySymbol}${(discountTotal || 0).toFixed(2)}</span>
                </div>` : ''}
                <div class="total-row">
                    <span>TOTAL IMPUESTOS</span>
                    <span>${currencySymbol}${(taxTotal || 0).toFixed(2)}</span>
                </div>
                
                <div class="total-row total-final">
                    <span>TOTAL</span>
                    <span>${currencySymbol}${(finalTotal || 0).toFixed(2)}</span>
                </div>
                
                ${foreignCurrenciesHtml ? `
                <div class="currency-section">
                    <div style="font-size: 9px; text-transform: uppercase; margin-bottom: 2px;">Equivalente en Divisas</div>
                    ${foreignCurrenciesHtml}
                </div>
                ` : ''}
            </div>

            ${savings > 0 ? `
            <div class="savings-box">
                <div>¡USTED HA AHORRADO!</div>
                <div style="font-size: 16px;">${currencySymbol}${savings.toFixed(2)}</div>
            </div>
            ` : ''}

            ${(() => {
            const payments = transaction.payments || [];
            const totalPaid = payments.reduce((acc: number, p: any) => acc + (p.amount || 0), 0);
            const change = Math.max(0, totalPaid - (finalTotal || 0));

            if (payments.length === 0) return '';

            return `
                <div class="divider"></div>
                <div class="totals-section">
                    <div style="font-weight: bold; margin-bottom: 4px; font-size: 10px;">FORMAS DE PAGO</div>
                    ${payments.map((p: any) => `
                    <div class="total-row">
                        <span>${p.methodLabel || (p.method === 'CASH' ? 'EFECTIVO' : p.method === 'CARD' ? 'TARJETA' : p.method === 'STORE_CREDIT' ? 'NOTA DE CRÉDITO' : p.method === 'LOYALTY' ? 'CANJE EGO CLUB' : p.method)}</span>
                        <span>${currencySymbol}${(p.amount || 0).toFixed(2)}</span>
                    </div>
                    `).join('')}
                    
                    ${change > 0 ? `
                    <div class="total-row" style="margin-top: 4px; font-weight: bold;">
                        <span>CAMBIO</span>
                        <span>${currencySymbol}${change.toFixed(2)}</span>
                    </div>
                    ` : ''}
                </div>
                `;
        })()}

            <!-- SECCIÓN: FACTURA AFECTADA (ALINEADA A LA IZQUIERDA) -->
            ${isCreditNote ? `
                <div class="divider"></div>
                <div class="text-left" style="margin-top: 10px; font-size: 12px; line-height: 1.4;">
                    <span style="font-weight: bold; text-decoration: underline;">FACTURA AFECTADA:</span><br/>
                    ${(transaction.affectedInvoiceNumber || transaction.originalTransactionId) ? `
                        <span>No. ${transaction.affectedInvoiceNumber || transaction.originalTransactionId}</span><br/>
                    ` : ''}
                    ${transaction.affectedNCF ? `
                        <span>NCF: ${transaction.affectedNCF}</span>
                    ` : ''}
                    ${!(transaction.affectedInvoiceNumber || transaction.affectedNCF || transaction.originalTransactionId) ? `
                        <span style="font-style: italic; color: #666;">Sin referencia disponible</span>
                    ` : ''}
                </div>
            ` : ''}

            <div class="footer">
                ${receiptConfig?.footerMessage ? `<div style="margin-bottom: 8px;">${receiptConfig.footerMessage}</div>` : ''}
                <div>¡Gracias por su compra!</div>
                <div>Vuelva pronto.</div>
                
                ${receiptConfig?.showQr ? `
                <div id="qrcode"></div>
                <div style="font-weight: bold; font-size: 9px; margin-top: 5px;">E-FACTURA VALIDADA</div>
                ` : ''}
            </div>
            
            <script>
                window.onload = function() {
                    ${receiptConfig?.showQr ? `
                    try {
                        const qrData = JSON.stringify({
                            type: 'INVOICE_RETURN',
                            id: "${transaction.id}",
                            sec: "${transaction.id.substring(0, 8)}"
                        });
                        new QRCode(document.getElementById("qrcode"), {
                            text: qrData,
                            width: 100,
                            height: 100,
                            colorDark : "#000000",
                            colorLight : "#ffffff",
                            correctLevel : QRCode.CorrectLevel.H
                        });
                    } catch (e) {
                        console.error("QR Code generation failed", e);
                        document.getElementById("qrcode").innerHTML = "QR ERROR";
                    }
                    ` : ''}
                    
                    setTimeout(() => {
                        window.print();
                    }, 500);
                }
            </script>
        </body>
        </html>
    `;

    const silentHtml = receiptHtml.replace(
        /<script>[\s\S]*?window\.onload[\s\S]*?<\/script>/,
        ''
    );

    const escPosBase64 = buildEscPosTicketPayload(transaction, config, users);
    let printedSilently = false;

    if (escPosBase64) {
        printedSilently = await PrintRouterService.routeAndPrintEscPos({
            config,
            escPosBase64,
            role: 'TICKET',
            terminalId: transaction.terminalId,
            jobType: 'TICKET',
            referenceId: transaction.id,
        });
    }

    if (printedSilently) return;

    if (!shouldSuppressBrowserPrintFallback()) {
        printedSilently = await PrintRouterService.routeAndPrintHtml({
            config,
            html: silentHtml,
            role: 'TICKET',
            terminalId: transaction.terminalId,
            jobType: 'TICKET',
            referenceId: transaction.id,
        });
    }

    if (printedSilently) return;

    if (shouldSuppressBrowserPrintFallback()) {
        console.warn('Silent native ticket print failed; browser print fallback suppressed.');
        return;
    }

    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
        printWindow.document.write(receiptHtml);
        printWindow.document.close();
    } else {
        alert('Por favor, permita las ventanas emergentes para imprimir el ticket.');
    }
};

export const printReservation = async (reservation: Reservation, config: BusinessConfig): Promise<boolean> => {
    const { companyInfo, currencySymbol, receiptConfig } = config;
    const dateStr = new Date(reservation.createdAt).toLocaleDateString();
    const timeStr = new Date(reservation.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const deliveryStr = reservation.deliveryDate ? new Date(reservation.deliveryDate).toLocaleDateString() : 'No especificada';
    const expiryStr = new Date(reservation.expiryDate).toLocaleDateString();

    const receiptHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Reserva #${reservation.code}</title>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
            <style>
                @page { size: 80mm auto; margin: 0; }
                body {
                    font-family: 'Courier New', Courier, monospace;
                    width: 72mm;
                    margin: 0 auto;
                    padding: 4mm;
                    font-size: 14px;
                    line-height: 1.2;
                    color: #000;
                    background: #fff;
                }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .font-bold { font-weight: 700; }
                .font-black { font-weight: 900; }
                .company-name { font-size: 18px; font-weight: 900; margin-bottom: 2px; text-transform: uppercase; }
                .company-info { font-size: 12px; }
                .divider { border-top: 1px dashed #000; margin: 8px 0; }
                .doc-title { font-size: 16px; font-weight: 900; text-transform: uppercase; margin-bottom: 5px; }
                .meta-row { font-size: 12px; }
                .items-table { width: 100%; border-collapse: collapse; margin-top: 5px; }
                .items-table td { padding: 4px 0; vertical-align: top; }
                .item-name { font-weight: 700; display: block; }
                .item-meta { font-size: 12px; display: block; }
                .totals-section { margin-top: 10px; }
                .total-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
                .total-final { font-size: 18px; font-weight: 900; border-top: 2px solid #000; padding-top: 5px; }
                #qrcode { width: 100px; height: 100px; margin: 10px auto; }
            </style>
        </head>
        <body>
            <div class="text-center">
                <div class="company-name">${companyInfo.name}</div>
                <div class="company-info">
                    <div>RNC: ${companyInfo.rnc}</div>
                    <div>${companyInfo.address}</div>
                    <div>TEL: ${companyInfo.phone}</div>
                </div>
            </div>

            <div class="divider"></div>
            
            <div class="text-center">
                <div class="doc-title">NOTA DE RESERVA</div>
                <div class="font-bold">Código: ${reservation.code}</div>
            </div>

            <div class="divider"></div>

            <div class="meta-row">
                <div><strong>Cliente:</strong> ${reservation.customerName}</div>
                <div><strong>Fecha Doc:</strong> ${dateStr} ${timeStr}</div>
                <div><strong>Fecha Entrega:</strong> ${deliveryStr}</div>
                <div><strong>Vence:</strong> ${expiryStr}</div>
            </div>

            <div class="divider"></div>

            <table class="items-table">
                <tbody>
                    ${reservation.items.map(item => `
                        <tr>
                            <td style="width: 70%;">
                                <span class="item-name">${item.name}</span>
                                <span class="item-meta">${item.quantity} x ${currencySymbol}${item.price.toFixed(2)}</span>
                            </td>
                            <td class="text-right font-bold">
                                ${currencySymbol}${(item.price * item.quantity).toFixed(2)}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="divider"></div>

            <div class="totals-section">
                <div class="total-row">
                    <span>TOTAL RESERVA</span>
                    <span>${currencySymbol}${reservation.total.toFixed(2)}</span>
                </div>
                <div class="total-row">
                    <span>ABONO RECIBIDO</span>
                    <span>${currencySymbol}${reservation.balancePaid.toFixed(2)}</span>
                </div>
                <div class="total-row total-final">
                    <span>SALDO PENDIENTE</span>
                    <span>${currencySymbol}${(reservation.total - reservation.balancePaid).toFixed(2)}</span>
                </div>
            </div>

            <div class="text-center" style="margin-top: 20px;">
                <div id="qrcode"></div>
                <div style="font-size: 10px; font-weight: bold; margin-top: 5px;">ESTE DOCUMENTO SE USA PARA RECUPERAR SU RESERVA</div>
            </div>

            <div class="text-center" style="margin-top: 15px; font-size: 11px;">
                ${receiptConfig?.footerMessage || '¡Gracias por su preferencia!'}
            </div>

            <script>
                window.onload = function() {
                    new QRCode(document.getElementById("qrcode"), {
                        text: "${reservation.qrPayload}",
                        width: 100,
                        height: 100
                    });
                    setTimeout(() => { window.print(); }, 500);
                }
            </script>
        </body>
        </html>
    `;

    const silentHtml = receiptHtml.replace(/<script>[\s\S]*?window\.onload[\s\S]*?<\/script>/, '');
    const escPosBase64 = buildEscPosReservationPayload(reservation, config);
    let printedSilently = false;

    if (escPosBase64) {
        printedSilently = await PrintRouterService.routeAndPrintEscPos({
            config,
            escPosBase64,
            role: 'TICKET',
            terminalId: reservation.terminalId,
            jobType: 'TICKET',
            referenceId: reservation.id,
        });
    }

    if (printedSilently) return true;

    if (!shouldSuppressBrowserPrintFallback()) {
        printedSilently = await PrintRouterService.routeAndPrintHtml({
            config,
            html: silentHtml,
            role: 'TICKET',
            jobType: 'TICKET',
            referenceId: reservation.id,
        });
    }

    if (printedSilently) return true;

    if (shouldSuppressBrowserPrintFallback()) {
        console.warn('Silent native reservation print failed; browser print fallback suppressed.');
        return false;
    }

    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
        printWindow.document.write(receiptHtml);
        printWindow.document.close();
        return true;
    }

    return false;
};
