import type { Customer } from '../types';

/**
 * Identificación de tarjetas presentadas en caja.
 *
 * En la caja convive más de un formato de tarjeta, así que el lector no puede
 * asumir que todo lo que entra es una tarjeta EGO Club. Este módulo clasifica
 * cualquier código leído (QR de la tarjeta digital, código de barras de socio,
 * o texto pegado a mano) y devuelve el tipo y la referencia para actuar.
 */

export type CardKind = 'EGO_CLUB' | 'CUSTOMER' | 'UNKNOWN';

export interface CardIdentity {
    kind: CardKind;
    /** Referencia utilizable: id del socio, número de tarjeta o código leído. */
    ref: string;
    /** Texto del código tal cual llegó, para diagnóstico. */
    raw: string;
    name?: string;
    points?: number;
    cardNumber?: string;
}

const EGO_CLUB_PREFIX = /^EGOCLUB:/i;

/** Payload legible de la tarjeta digital. */
export interface EgoClubQrData {
    card?: string;
    name?: string;
    points?: number;
    tenant?: string;
}

const safeJson = (value: string): Record<string, unknown> | null => {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
};

/**
 * Construye el contenido del QR de la tarjeta digital.
 *
 * Antes era solo `EGOCLUB:<id>`, un texto plano que muchos lectores muestran
 * como "datos no utilizables". Ahora el prefijo se conserva (el POS lo sigue
 * reconociendo) y detrás viaja un JSON con datos legibles: tarjeta, nombre y
 * saldo. Cualquier lector puede mostrar algo con sentido y la caja lo parsea.
 */
export const buildEgoClubQrContent = (customer: Customer): string => {
    const card = customer.cards?.find(entry => entry.type === 'LOYALTY' && entry.status === 'ACTIVE')
        || customer.cards?.[0]
        || customer.loyalty;
    const cardNumber = String(card?.cardNumber || '').trim();
    const ref = cardNumber || String(customer.id || '');
    const payload: EgoClubQrData = {
        card: cardNumber || undefined,
        name: customer.name || undefined,
        points: Number.isFinite(Number(customer.loyaltyPoints)) ? Number(customer.loyaltyPoints) : undefined,
    };
    return `${'EGOCLUB'}:${JSON.stringify(payload)}|${ref}`;
};

/**
 * Clasifica un código leído en caja.
 *
 * Acepta el formato nuevo (`EGOCLUB:{json}|ref`), el antiguo (`EGOCLUB:<ref>`),
 * y cualquier código de socio que la caja conozca por id o número de tarjeta.
 */
export const identifyCard = (rawValue: string, customers: Customer[] = []): CardIdentity => {
    const raw = String(rawValue || '').trim();
    if (!raw) return { kind: 'UNKNOWN', ref: '', raw };

    if (EGO_CLUB_PREFIX.test(raw)) {
        const body = raw.replace(EGO_CLUB_PREFIX, '');
        const [head, tail] = body.split('|');
        const json = safeJson(head);
        const ref = String((json?.card as string) || tail || head || '').trim();
        const name = typeof json?.name === 'string' ? json.name : undefined;
        const points = Number.isFinite(Number(json?.points)) ? Number(json.points) : undefined;
        // Se resuelve el socio aquí para que el lector tenga siempre un id de
        // cliente, venga el QR del formato nuevo o del antiguo.
        const cardNumber = String((typeof json?.card === 'string' ? json.card : (tail || ref)) || '').trim();
        const owner = customers.find((candidate) => {
            const numbers = [
                ...(candidate.cards || []).map(entry => String(entry.cardNumber || '')),
                String(candidate.loyalty?.cardNumber || ''),
                ...((candidate as unknown as { metadata?: { loyaltyCards?: Array<{ cardNumber?: string }> } })
                    .metadata?.loyaltyCards || []).map(entry => String(entry?.cardNumber || '')),
            ].filter(Boolean).map(value => value.toUpperCase());
            return numbers.includes(cardNumber.toUpperCase()) || String(candidate.id) === ref;
        });

        return {
            kind: 'EGO_CLUB',
            ref: owner ? String(owner.id) : ref,
            raw,
            name: name || owner?.name,
            points: points ?? (owner ? Number(owner.loyaltyPoints || 0) : undefined),
            cardNumber: cardNumber || undefined,
        };
    }

    const normalized = raw.toUpperCase();
    const cardNumbersOf = (candidate: Customer): string[] => {
        const fromCards = (candidate.cards || []).map(entry => String(entry.cardNumber || '')).filter(Boolean);
        const fromLoyalty = String(candidate.loyalty?.cardNumber || '');
        // El ERP del grupo entrega las tarjetas dentro de metadata.loyaltyCards.
        const metaCards = (candidate as unknown as { metadata?: { loyaltyCards?: Array<{ cardNumber?: string }> } })
            .metadata?.loyaltyCards || [];
        return [
            ...fromCards,
            ...(fromLoyalty ? [fromLoyalty] : []),
            ...metaCards.map(entry => String(entry?.cardNumber || '')).filter(Boolean),
        ];
    };

    const match = customers.find((candidate) => {
        if (cardNumbersOf(candidate).some(card => card.toUpperCase() === normalized)) return true;
        return [
            String(candidate.id || ''),
            String(candidate.customerCode || ''),
            String(candidate.taxId || ''),
        ].some(value => value && value.trim().toUpperCase() === normalized);
    });

    if (match) {
        return {
            kind: 'CUSTOMER',
            ref: String(match.id),
            raw,
            name: match.name,
            points: Number.isFinite(Number(match.loyaltyPoints)) ? Number(match.loyaltyPoints) : undefined,
        };
    }

    return { kind: 'UNKNOWN', ref: raw, raw };
};

/** Etiqueta legible del tipo de tarjeta, para avisos en caja. */
export const describeCardKind = (kind: CardKind): string => {
    if (kind === 'EGO_CLUB') return 'Tarjeta EGO Club';
    if (kind === 'CUSTOMER') return 'Tarjeta de cliente';
    return 'Tarjeta no reconocida';
};
