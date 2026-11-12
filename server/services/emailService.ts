import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resend } from 'resend';
import { Customer, EmailConfig } from '../../types';
import { db, getSetting } from '../db.js';
import { getZReportPaymentMethodSummary, paymentMethodSummaryTotal } from '../../utils/zReportPaymentSummary';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_RECEIPT_FROM = 'Alfa POS <no-reply@clicsuite.com>';

export type EmailDeliveryResult = {
    id: string;
    status: 'accepted';
};

export class EmailService {
    private templatePath: string;
    private zReportTemplatePath: string;
    private receiptTemplatePath: string;
    private resend: Resend | null = null;
    private config: EmailConfig | null = null;

    constructor() {
        this.templatePath = path.join(__dirname, '../templates/wallet_welcome.html');
        this.zReportTemplatePath = path.join(__dirname, '../templates/z_report.html');
        this.receiptTemplatePath = path.join(__dirname, '../templates/digital_receipt.html');
        this.loadConfig();
    }

    private loadConfig() {
        const environmentApiKey = String(process.env.RESEND_API_KEY || '').trim();
        if (environmentApiKey) {
            this.configure({
                provider: 'resend',
                apiKey: environmentApiKey,
                from: String(process.env.RESEND_FROM || DEFAULT_RECEIPT_FROM).trim(),
            });
            return;
        }

        const config = getSetting('emailConfig');
        if (config && config.apiKey) {
            this.configure(config);
        }
    }

    public configure(config: EmailConfig) {
        this.config = config;
        this.resend = new Resend(config.apiKey);
    }

    async sendTestEmail(to: string): Promise<void> {
        if (!this.resend || !this.config) {
            throw new Error('Email service not configured');
        }

        const { data, error } = await this.resend.emails.send({
            from: this.config.from,
            to: [to], // Resend expects an array
            subject: 'Test de Conexión Resend - Alfa POS',
            html: '<b>Si estás leyendo esto, la configuración de Resend funciona correctamente.</b>'
        });

        if (error) {
            throw new Error(error.message);
        }
    }

    /**
     * Sends the "Welcome to Wallet" email with the pass attached.
     */
    async sendWalletWelcome(customer: Customer, passBuffer: Buffer): Promise<void> {
        console.log(`[EmailService] Preparing to send wallet welcome email to: ${customer.email}`);

        // Ensure config is loaded
        if (!this.resend) {
            await this.loadConfig();
        }

        // 1. Read Template
        let html = fs.readFileSync(this.templatePath, 'utf-8');

        // 2. Replace Placeholders
        const balance = customer.wallet?.balance || 0;
        const points = customer.loyaltyPoints || 0;

        html = html.replace(/{{name}}/g, customer.name);
        html = html.replace(/{{balance}}/g, balance.toFixed(2));
        html = html.replace(/{{points}}/g, points.toString());
        html = html.replace(/{{year}}/g, new Date().getFullYear().toString());

        // 3. Send Email
        if (this.resend && this.config && customer.email) {

            const { data, error } = await this.resend.emails.send({
                from: this.config.from,
                to: [customer.email],
                subject: '¡Bienvenido a tu Wallet Digital de Alfa POS!',
                html: html,
                attachments: [
                    {
                        filename: 'loyalty.pkpass',
                        content: passBuffer,
                    }
                ]
            });

            if (error) {
                console.error('[EmailService] Failed to send email:', error);
                throw new Error(error.message);
            }

            console.log(`[EmailService] Email sent successfully to ${customer.email}`);
        } else {
            // Fallback to simulation if no config or no email
            console.log('---------------------------------------------------');
            console.log(`[SIMULATION] Sending email to: ${customer.email}`);
            console.log(`ATTACHMENT: loyalty.pkpass (${passBuffer.length} bytes)`);
            console.log('---------------------------------------------------');
            if (!this.resend) console.warn('[EmailService] Resend not configured, using simulation.');
        }
    }

    /**
     * Sends the Z-Report email.
     */
    async sendZReport(to: string, reportData: any): Promise<void> {
        console.log(`[EmailService] Sending Z-Report to: ${to}`);

        if (!this.resend) {
            await this.loadConfig();
        }

        // 1. Read Template
        let html = fs.readFileSync(this.zReportTemplatePath, 'utf-8');

        // 2. Format Data Helpers
        const currency = reportData.baseCurrency || 'DOP';
        const formatMoney = (amount: number) => new Intl.NumberFormat('es-DO', { style: 'currency', currency }).format(amount);

        // 3. Replace Placeholders
        html = html.replace(/{{companyName}}/g, reportData.companyName || 'ALFA POS');
        html = html.replace(/{{sequenceNumber}}/g, reportData.sequenceNumber);
        html = html.replace(/{{userName}}/g, reportData.closedByUserName);
        html = html.replace(/{{date}}/g, new Date(reportData.closedAt).toLocaleDateString());
        html = html.replace(/{{time}}/g, new Date(reportData.closedAt).toLocaleTimeString());

        // Financials
        const stats = reportData.stats || { averageTicket: 0, itemsPerSale: 0, peakHour: 'N/A', topProduct: null };
        html = html.replace(/{{grossSales}}/g, formatMoney(Number(stats.grossSales || 0)));
        html = html.replace(/{{returnsTotal}}/g, formatMoney(Number(stats.returnsTotal || 0)));
        html = html.replace(/{{netSales}}/g, formatMoney(Number(stats.netSales || 0)));
        html = html.replace(/{{transactionCount}}/g, reportData.transactionCount.toString());

        // Discrepancy
        const totalDiscrepancy = Object.values(reportData.cashDiscrepancy as Record<string, number>).reduce((a, b) => a + b, 0);
        const isDiscrepancy = Math.abs(totalDiscrepancy) > 0.01;
        html = html.replace(/{{discrepancyClass}}/g, isDiscrepancy ? 'badge-danger' : 'badge-success');
        html = html.replace(/{{discrepancyAmount}}/g, (totalDiscrepancy > 0 ? '+' : '') + formatMoney(totalDiscrepancy));

        // KPIs
        html = html.replace(/{{avgTicket}}/g, formatMoney(stats.averageTicket));
        html = html.replace(/{{itemsPerSale}}/g, stats.itemsPerSale.toFixed(1));
        html = html.replace(/{{peakHour}}/g, stats.peakHour);
        html = html.replace(/{{topProduct}}/g, stats.topProduct?.name || 'N/A');

        // Payment Methods Rows
        const paymentMethodSummary = getZReportPaymentMethodSummary(reportData, undefined);
        const paymentRows = paymentMethodSummary
            .map(line => `
                <tr>
                    <td>${line.name}</td>
                    <td style="text-align: right;">${formatMoney(line.amount)}</td>
                </tr>
            `).join('') + `
                <tr class="total-row">
                    <td>Total formas de pago</td>
                    <td style="text-align: right;">${formatMoney(paymentMethodSummaryTotal(paymentMethodSummary))}</td>
                </tr>`;
        html = html.replace(/{{paymentMethodsRows}}/g, paymentRows);

        // Cash Details Rows
        const cashRows = Object.keys(reportData.cashExpected as Record<string, number>)
            .map(curr => {
                const expected = reportData.cashExpected[curr] || 0;
                const counted = reportData.cashCounted[curr] || 0;
                const diff = reportData.cashDiscrepancy[curr] || 0;
                const diffClass = Math.abs(diff) > 0.01 ? 'color: #991b1b; font-weight: bold;' : 'color: #166534;';

                return `
                    <tr>
                        <td><strong>${curr} · Efectivo en ventas</strong></td>
                        <td style="text-align: right;">${formatMoney(Number(reportData.cashSales || 0))}</td>
                    </tr>
                    <tr><td>(+) Entradas</td><td style="text-align: right;">${formatMoney(Number(reportData.cashIn || 0))}</td></tr>
                    <tr><td>(-) Salidas</td><td style="text-align: right;">${formatMoney(Number(reportData.cashOut || 0))}</td></tr>
                    <tr><td>Efectivo esperado</td><td style="text-align: right;">${formatMoney(expected)}</td></tr>
                    <tr><td>Efectivo contado</td><td style="text-align: right;">${formatMoney(counted)}</td></tr>
                    <tr>
                        <td>Diferencia</td>
                        <td style="text-align: right; ${diffClass}">${diff > 0 ? '+' : ''}${formatMoney(diff)}</td>
                    </tr>
                `;
            }).join('');
        html = html.replace(/{{cashDetailsRows}}/g, cashRows);

        const paymentDeclarations = Array.isArray(reportData.paymentMethodDeclarations)
            ? reportData.paymentMethodDeclarations
            : [];
        const declarationRows = paymentDeclarations.map((line: any) => `
            <tr><td>${line.name}</td><td style="text-align:right;">${formatMoney(Number(line.expected || 0))}</td><td style="text-align:right;">${formatMoney(Number(line.declared || 0))}</td><td style="text-align:right;">${formatMoney(Number(line.difference || 0))}</td></tr>
        `).join('');
        html = html.replace(/{{paymentDeclarationsSection}}/g, declarationRows ? `
            <h3 style="font-size:14px;text-transform:uppercase;color:#64748b;margin-bottom:10px;">Declaración de formas de pago</h3>
            <table><thead><tr><th>Forma</th><th style="text-align:right;">Esperado</th><th style="text-align:right;">Declarado</th><th style="text-align:right;">Dif.</th></tr></thead><tbody>${declarationRows}</tbody></table>
        ` : '');

        // Notes
        if (reportData.notes) {
            html = html.replace(/{{notesSection}}/g, `
                <div style="background: #fffbeb; border: 1px solid #fcd34d; padding: 10px; border-radius: 6px; margin-top: 20px; font-size: 13px; color: #92400e;">
                    <strong>Notas:</strong> ${reportData.notes}
                </div>
            `);
        } else {
            html = html.replace(/{{notesSection}}/g, '');
        }

        html = html.replace(/{{systemDate}}/g, new Date().toLocaleString());

        // 4. Send
        if (this.resend && this.config) {
            const { error } = await this.resend.emails.send({
                from: this.config.from,
                to: to.split(','), // Support multiple recipients
                subject: `Reporte Z - ${reportData.sequenceNumber}`,
                html: html
            });

            if (error) {
                console.error('[EmailService] Failed to send Z-Report:', error);
                throw new Error(error.message);
            }
            console.log(`[EmailService] Z-Report sent successfully to ${to}`);
        } else {
            console.log('---------------------------------------------------');
            console.log(`[SIMULATION] Sending Z-Report to: ${to}`);
            console.log('---------------------------------------------------');
        }
    }
    /**
     * Sends a digital receipt for a purchase.
     */
    async sendReceipt(to: string, receiptData: any): Promise<EmailDeliveryResult> {
        console.log(`[EmailService] Sending receipt to: ${to}`);

        if (!this.resend) {
            await this.loadConfig();
        }

        const {
            items, total, paymentMethod, companyInfo, transactionId,
            ncf, date, cashierName, tax, subtotal, discount,
            currencySymbol = '$', logoUrl = 'https://clicpos.com/logo.png',
            totalSavings = 0, showSavings = false
        } = receiptData;

        // 1. Read Template
        let html = fs.readFileSync(this.receiptTemplatePath, 'utf-8');

        // 2. Generate Items HTML
        const itemsHtml = items.map((item: any) => {
            const itemTotal = (item.price * item.quantity);
            const optionsHtml = item.options && item.options.length > 0
                ? `<div style="font-size: 12px; color: #64748B; font-style: italic; margin-top: 2px;">&bull; ${item.options.join(' &bull; ')}</div>`
                : '';

            const itemSavings = (item.originalPrice && item.originalPrice > item.price)
                ? (item.originalPrice - item.price) * item.quantity
                : (item.discount || 0);

            const discountInfo = itemSavings > 0
                ? `<div style="font-size: 12px; color: #10B981; font-weight: 600; margin-top: 2px;">(Ahorro: ${currencySymbol}${itemSavings.toFixed(2)})</div>`
                : '';

            const sellerInfo = receiptData.config?.showSeller && item.sellerName
                ? `<div style="font-size: 11px; color: #94A3B8; margin-top: 2px;">Vendedor: ${item.sellerName}</div>`
                : '';

            return `
                <tr>
                    <td style="padding: 16px 0; border-bottom: 1px solid #F1F5F9;">
                        <div style="font-size: 15px; font-weight: 700; color: #1E293B;">${item.name}</div>
                        <div style="font-size: 13px; color: #64748B; margin-top: 2px;">${item.quantity} x ${currencySymbol}${item.price.toFixed(2)}</div>
                        ${optionsHtml}
                        ${discountInfo}
                        ${sellerInfo}
                    </td>
                    <td align="right" style="padding: 16px 0; border-bottom: 1px solid #F1F5F9; font-size: 15px; font-weight: 700; color: #1E293B; vertical-align: top;">
                        ${currencySymbol}${itemTotal.toFixed(2)}
                    </td>
                </tr>
            `;
        }).join('');

        // 3. Generate QR Code
        const qrJson = JSON.stringify({
            type: 'INVOICE_RETURN',
            id: transactionId || 'UNKNOWN',
            sec: (transactionId || 'UNKNOWN').substring(0, 8)
        });
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrJson)}`;

        // 4. Replace Placeholders
        html = html.replace(/{{companyName}}/g, companyInfo?.name || 'ALFA POS');
        html = html.replace(/{{companyAddress}}/g, companyInfo?.address || '');
        html = html.replace(/{{companyRnc}}/g, companyInfo?.rnc || '');
        html = html.replace(/{{companyPhone}}/g, companyInfo?.phone || '');
        html = html.replace(/{{logoUrl}}/g, logoUrl);
        html = html.replace(/{{currencySymbol}}/g, currencySymbol);
        html = html.replace(/{{total}}/g, total.toFixed(2));
        html = html.replace(/{{subtotal}}/g, (subtotal || total).toFixed(2));
        html = html.replace(/{{tax}}/g, (tax || 0).toFixed(2));
        html = html.replace(/{{date}}/g, new Date(date || Date.now()).toLocaleString());
        html = html.replace(/{{transactionId}}/g, transactionId || 'PENDIENTE');
        html = html.replace(/{{cashierName}}/g, cashierName || 'Sistema');
        html = html.replace(/{{customerName}}/g, receiptData.customerName || 'Cliente Mostrador');
        html = html.replace(/{{paymentMethod}}/g, paymentMethod || 'Efectivo');
        html = html.replace(/{{itemsHtml}}/g, itemsHtml);
        html = html.replace(/{{qrUrl}}/g, qrUrl);

        // NCF Row
        if (ncf) {
            html = html.replace(/{{ncfRow}}/g, `<div><strong>NCF:</strong> ${ncf}</div>`);
        } else {
            html = html.replace(/{{ncfRow}}/g, '');
        }

        // Global Discount Row
        if (discount > 0) {
            html = html.replace(/{{globalDiscountRow}}/g, `
                <tr>
                    <td style="font-size: 14px; color: #EF4444; padding: 4px 0;">Descuento</td>
                    <td align="right" style="font-size: 14px; color: #EF4444; font-weight: 600; padding: 4px 0;">-${currencySymbol}${discount.toFixed(2)}</td>
                </tr>
            `);
        } else {
            html = html.replace(/{{globalDiscountRow}}/g, '');
        }

        // --- Savings Section ---
        if (showSavings && totalSavings > 0) {
            html = html.replace(/{{savingsSection}}/g, `
                <tr>
                    <td colspan="2" align="center" style="padding: 30px 40px;">
                        <div style="border: 2px dashed #3B82F6; border-radius: 12px; padding: 20px; background-color: #EFF6FF;">
                            <div style="font-size: 14px; font-weight: 800; color: #3B82F6; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">
                                ¡USTED HA AHORRADO!
                            </div>
                            <div style="font-size: 28px; font-weight: 900; color: #1E293B;">
                                ${currencySymbol}${totalSavings.toFixed(2)}
                            </div>
                        </div>
                    </td>
                </tr>
            `);
        } else {
            html = html.replace(/{{savingsSection}}/g, '');
        }

        // 5. Send Email
        if (this.resend && this.config) {
            const from = String(process.env.RESEND_RECEIPT_FROM || process.env.RESEND_FROM || DEFAULT_RECEIPT_FROM).trim();
            const { data, error } = await this.resend.emails.send({
                from,
                to: [to],
                subject: `Ticket de Compra #${transactionId} - ${companyInfo?.name || 'ALFA POS'}`,
                html: html
            });

            if (error) {
                console.error('[EmailService] Failed to send receipt:', error);
                throw new Error(error.message);
            }
            if (!data?.id) {
                throw new Error('Resend did not return an email identifier');
            }
            console.log(`[EmailService] Receipt sent successfully. ID: ${data?.id}`);
            return { id: data.id, status: 'accepted' };
        } else {
            throw new Error('Email service not configured');
        }
    }
}
