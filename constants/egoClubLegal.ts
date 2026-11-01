/**
 * Textos legales del alta de socio EGO Club.
 *
 * ⚠️ MARCADORES: son textos de trabajo, no los definitivos. Sustituir aquí (y sólo aquí)
 * cuando el cliente entregue los textos aprobados de términos y condiciones, política de
 * privacidad y consentimiento de comunicaciones. El formulario de alta y la cola de envío
 * leen de este archivo, así que no hay que tocar componentes para reemplazarlos.
 */

export const EGO_CLUB_LEGAL_VERSION = 'PLACEHOLDER-2026-01';

export interface LoyaltyLegalDocument {
    /** Identificador que viaja como `consents[].type` al ERP. */
    type: 'TERMS' | 'PRIVACY';
    title: string;
    version: string;
    body: string[];
}

export const EGO_CLUB_TERMS: LoyaltyLegalDocument = {
    type: 'TERMS',
    title: 'Términos y condiciones del programa EGO Club',
    version: EGO_CLUB_LEGAL_VERSION,
    body: [
        '[MARCADOR] Texto pendiente de aprobación por el cliente.',
        'El programa acumula puntos sobre el monto elegible de cada compra, excluyendo impuestos, artículos en oferta, pagos con tarjeta de regalo y pagos con wallet.',
        'El nivel del socio se determina por el gasto anual acumulado y es resuelto por el ERP. El cierre anual es el 30 de junio.',
        'Los puntos tienen vigencia según la configuración del programa y pueden canjearse a partir del mínimo de canje del nivel del socio.',
        'Las devoluciones generan el reverso proporcional de los puntos devengados.',
    ],
};

export const EGO_CLUB_PRIVACY: LoyaltyLegalDocument = {
    type: 'PRIVACY',
    title: 'Política de privacidad y tratamiento de datos',
    version: EGO_CLUB_LEGAL_VERSION,
    body: [
        '[MARCADOR] Texto pendiente de aprobación por el cliente.',
        'Los datos personales del socio (nombre, cédula, celular, correo y fecha de nacimiento) se usan para administrar el programa de fidelización y emitir los beneficios asociados.',
        'El tratamiento se realiza conforme a la Ley 172-13 de Protección Integral de los Datos Personales de la República Dominicana.',
        'El socio puede solicitar acceso, rectificación o eliminación de sus datos por los canales de atención de Retail Gold / EGO.',
    ],
};

/** Canales de marketing opcionales: cada uno es un consentimiento separado en el ERP. */
export const EGO_CLUB_MARKETING_CHANNELS = [
    { type: 'EMAIL' as const, label: 'Correo electrónico' },
    { type: 'SMS' as const, label: 'SMS' },
    { type: 'WHATSAPP' as const, label: 'WhatsApp' },
];

export type LoyaltyMarketingChannel = typeof EGO_CLUB_MARKETING_CHANNELS[number]['type'];

export const EGO_CLUB_MARKETING_TITLE = 'Comunicaciones de marketing';

export const EGO_CLUB_MARKETING_BODY =
    '[MARCADOR] Acepto recibir promociones, novedades y beneficios del programa por los canales que seleccione. Puedo revocar este consentimiento en cualquier momento.';
