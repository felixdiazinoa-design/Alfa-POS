import React, { useState, useEffect } from 'react';
import { X, Smartphone, Monitor, Moon, Sun } from 'lucide-react';

interface EmailPreviewModalProps {
    onClose: () => void;
}

// This would normally be loaded from the server, but for preview we embed it or fetch it.
// Since we are in a client-side app, we'll fetch the file content if possible, or paste it here.
// For this demo, I will paste the content I just created.
const EMAIL_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <title>¡Bienvenido a tu Wallet Digital de Alfa POS!</title>
    
    <style>
        /* RESET STYLES */
        html, body { margin: 0 auto !important; padding: 0 !important; height: 100% !important; width: 100% !important; background-color: #f3f4f6; }
        * { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
        div[style*="margin: 16px 0"] { margin: 0 !important; }
        table, td { mso-table-lspace: 0pt !important; mso-table-rspace: 0pt !important; }
        table { border-spacing: 0 !important; border-collapse: collapse !important; table-layout: fixed !important; margin: 0 auto !important; }
        img { -ms-interpolation-mode: bicubic; }
        
        /* MOBILE STYLES */
        @media screen and (max-width: 600px) {
            .email-container { width: 100% !important; max-width: 100% !important; }
            .stack-column, .stack-column-center { display: block !important; width: 100% !important; max-width: 100% !important; direction: ltr !important; }
            .stack-column-center { text-align: center !important; }
            .center-on-mobile { text-align: center !important; display: block !important; margin-left: auto !important; margin-right: auto !important; }
            .mobile-padding { padding-left: 20px !important; padding-right: 20px !important; }
            .hide-on-mobile { display: none !important; }
        }

        /* DARK MODE SUPPORT */
        @media (prefers-color-scheme: dark) {
            body, .email-bg { background-color: #111827 !important; }
            .content-bg { background-color: #1f2937 !important; }
            .text-primary { color: #ffffff !important; }
            .text-secondary { color: #9ca3af !important; }
            .border-color { border-color: #374151 !important; }
        }
    </style>
</head>
<body width="100%" style="margin: 0; padding: 0 !important; mso-line-height-rule: exactly; background-color: #f3f4f6;" class="email-bg">
    <center style="width: 100%; background-color: #f3f4f6;" class="email-bg">
        <!-- PREHEADER -->
        <div style="display: none; font-size: 1px; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all; font-family: sans-serif;">
            Descarga tu tarjeta digital y empieza a acumular puntos hoy mismo.
        </div>

        <!-- MAIN CONTAINER -->
        <table align="center" role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin: 0 auto; width: 600px; max-width: 600px;" class="email-container">
            
            <!-- HEADER / LOGO -->
            <tr>
                <td align="center" style="padding: 40px 0; text-align: center;">
                    <div style="width: 120px; height: 40px; background: #dddddd; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; color: #666; font-weight: bold; font-family: sans-serif;">LOGO</div>
                </td>
            </tr>

            <!-- CARD CONTENT -->
            <tr>
                <td style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);" class="content-bg">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        
                        <!-- HERO IMAGE / BANNER (Optional) -->
                        <tr>
                            <td style="background-color: #2563eb; padding: 40px 20px; text-align: center;">
                                <h1 style="margin: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 24px; line-height: 30px; color: #ffffff; font-weight: bold;">
                                    ¡Bienvenido al Club!
                                </h1>
                                <p style="margin: 10px 0 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 24px; color: #e0e7ff;">
                                    Tu tarjeta digital ya está lista.
                                </p>
                            </td>
                        </tr>

                        <!-- PERSONALIZATION & STATS -->
                        <tr>
                            <td style="padding: 40px 30px;" class="mobile-padding">
                                <p style="margin: 0 0 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 18px; line-height: 24px; color: #111827; font-weight: bold;" class="text-primary">
                                    Hola, Felix Diaz
                                </p>
                                <p style="margin: 0 0 30px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 24px; color: #4b5563;" class="text-secondary">
                                    Gracias por unirte a nuestro programa de fidelización. Con tu nueva tarjeta digital podrás acumular puntos en cada compra y acceder a beneficios exclusivos.
                                </p>

                                <!-- STATS GRID -->
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td width="50%" style="padding: 15px; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; text-align: center;" class="content-bg border-color">
                                            <p style="margin: 0; font-family: sans-serif; font-size: 12px; text-transform: uppercase; color: #6b7280; letter-spacing: 1px;">Saldo Wallet</p>
                                            <p style="margin: 5px 0 0; font-family: sans-serif; font-size: 24px; font-weight: bold; color: #2563eb;">$1,250.00</p>
                                        </td>
                                        <td width="10" style="font-size: 0; line-height: 0;">&nbsp;</td>
                                        <td width="50%" style="padding: 15px; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; text-align: center;" class="content-bg border-color">
                                            <p style="margin: 0; font-family: sans-serif; font-size: 12px; text-transform: uppercase; color: #6b7280; letter-spacing: 1px;">Puntos</p>
                                            <p style="margin: 5px 0 0; font-family: sans-serif; font-size: 24px; font-weight: bold; color: #2563eb;">450</p>
                                        </td>
                                    </tr>
                                </table>

                            </td>
                        </tr>

                        <!-- CTA BUTTONS (SMART DEVICE LOGIC) -->
                        <tr>
                            <td style="padding: 0 30px 40px; text-align: center;" class="mobile-padding">
                                <p style="margin: 0 0 20px; font-family: sans-serif; font-size: 14px; color: #6b7280;" class="text-secondary">
                                    Guárdala en tu celular para tenerla siempre a mano:
                                </p>
                                
                                <!-- BUTTONS WRAPPER -->
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                                    <tr>
                                        <!-- APPLE WALLET -->
                                        <td style="padding: 5px;" align="center">
                                            <a href="#" target="_blank">
                                                <img src="https://developer.apple.com/wallet/images/badge/add-to-apple-wallet-lrg.svg" alt="Add to Apple Wallet" width="160" height="50" style="display: block; border: 0; height: 50px; width: auto;">
                                            </a>
                                        </td>
                                        <!-- GOOGLE WALLET -->
                                        <td style="padding: 5px;" align="center">
                                            <a href="#" target="_blank">
                                                <img src="https://developers.google.com/static/wallet/images/en/badge.svg" alt="Add to Google Wallet" width="160" height="50" style="display: block; border: 0; height: 50px; width: auto;">
                                            </a>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>

                        <!-- DESKTOP QR CODE -->
                        <tr>
                            <td style="padding: 0 30px 40px; text-align: center; border-top: 1px dashed #e5e7eb;" class="border-color mobile-padding">
                                <p style="margin: 20px 0 15px; font-family: sans-serif; font-size: 14px; color: #6b7280;" class="text-secondary">
                                    ¿Estás en una computadora? Escanea este código:
                                </p>
                                <center>
                                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://clicpos.com/wallet/add" width="150" height="150" alt="QR Code" style="display: block; border: 4px solid #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                                </center>
                            </td>
                        </tr>

                    </table>
                </td>
            </tr>

            <!-- FOOTER -->
            <tr>
                <td style="padding: 40px 0; text-align: center;">
                    <p style="margin: 0 0 10px; font-family: sans-serif; font-size: 12px; color: #9ca3af;">
                        © 2024 Alfa POS. Todos los derechos reservados.
                    </p>
                    <p style="margin: 0; font-family: sans-serif; font-size: 12px; color: #9ca3af;">
                        <a href="#" style="color: #6b7280; text-decoration: underline;">Términos y Condiciones</a>
                        &nbsp;|&nbsp;
                        <a href="#" style="color: #6b7280; text-decoration: underline;">Darse de baja</a>
                    </p>
                </td>
            </tr>

        </table>
    </center>
</body>
</html>`;

const EmailPreviewModal: React.FC<EmailPreviewModalProps> = ({ onClose }) => {
    const [mode, setMode] = useState<'DESKTOP' | 'MOBILE'>('DESKTOP');
    const [darkMode, setDarkMode] = useState(false);

    const iframeSrc = `data:text/html;charset=utf-8,${encodeURIComponent(EMAIL_HTML_TEMPLATE)}`;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 w-full h-full max-w-6xl rounded-2xl overflow-hidden flex flex-col shadow-2xl">
                {/* Header */}
                <div className="bg-slate-800 p-4 flex justify-between items-center border-b border-slate-700">
                    <div className="flex items-center gap-4">
                        <h2 className="text-white font-bold text-lg">Vista Previa: Email Transaccional</h2>
                        <div className="flex bg-slate-700 rounded-lg p-1">
                            <button
                                onClick={() => setMode('DESKTOP')}
                                className={`p-2 rounded-md transition-all ${mode === 'DESKTOP' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                title="Vista Escritorio"
                            >
                                <Monitor size={18} />
                            </button>
                            <button
                                onClick={() => setMode('MOBILE')}
                                className={`p-2 rounded-md transition-all ${mode === 'MOBILE' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                                title="Vista Móvil"
                            >
                                <Smartphone size={18} />
                            </button>
                        </div>
                        <button
                            onClick={() => setDarkMode(!darkMode)}
                            className={`p-2 rounded-lg transition-all ${darkMode ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
                            title="Alternar Modo Oscuro (Simulado)"
                        >
                            {darkMode ? <Moon size={18} /> : <Sun size={18} />}
                        </button>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Preview Area */}
                <div className="flex-1 bg-slate-950 flex items-center justify-center p-8 overflow-auto">
                    <div
                        className={`transition-all duration-300 bg-white shadow-2xl overflow-hidden ${mode === 'MOBILE' ? 'w-[375px] h-[667px] rounded-[30px] border-[8px] border-slate-800' : 'w-full h-full max-w-4xl rounded-lg'}`}
                        style={{
                            filter: darkMode ? 'invert(1) hue-rotate(180deg)' : 'none' // Crude dark mode sim for iframe
                        }}
                    >
                        <iframe
                            src={iframeSrc}
                            className="w-full h-full border-0"
                            title="Email Preview"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EmailPreviewModal;
