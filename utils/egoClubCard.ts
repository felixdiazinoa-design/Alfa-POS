import { dbAdapter } from '../services/db';
import { getTierLabel, normalizeTier, pointsToCurrency } from './egoClub';
import type { BusinessConfig, Customer, LoyaltyTierId } from '../types';
import { buildEgoClubQrContent } from './cardIdentity';

/**
 * Tarjeta digital del socio EGO Club (T7).
 *
 * El saldo siempre lo dicta el ERP. Cuando no hay conexión se muestra el **último saldo
 * sincronizado** con su marca de tiempo («actualizado hace X»); si nunca se sincronizó,
 * se dice exactamente eso en lugar de inventar un saldo.
 */

const COLLECTION = 'egoClubCards';

export interface EgoClubCardSnapshot {
    customerId: string;
    name: string;
    tier?: LoyaltyTierId;
    points: number;
    redeemRate: number;
    /** Última actividad conocida del cliente (última visita / última venta). */
    lastActivityAt?: string;
    /** Momento en que el saldo se leyó del ERP. */
    syncedAt: string;
    qrPayload: string;
}

const readAll = async (): Promise<EgoClubCardSnapshot[]> => {
    const raw = await dbAdapter.getCollection(COLLECTION);
    return Array.isArray(raw) ? (raw as EgoClubCardSnapshot[]) : [];
};

/** Guarda el último saldo sincronizado del socio (sobrescribe el anterior). */
export const saveEgoClubCardSnapshot = async (customer: Customer, config: BusinessConfig): Promise<void> => {
    if (!customer?.id) return;

    const snapshot: EgoClubCardSnapshot = {
        customerId: customer.id,
        name: customer.name,
        tier: normalizeTier(customer.tier) || undefined,
        points: Math.max(0, Math.floor(Number(customer.loyaltyPoints) || 0)),
        redeemRate: Number(config?.loyalty?.redeemRate) || 0,
        lastActivityAt: customer.lastVisit,
        syncedAt: new Date().toISOString(),
        qrPayload: buildEgoClubQrPayload(customer),
    };

    const all = await readAll();
    const index = all.findIndex(item => item.customerId === snapshot.customerId);
    if (index >= 0) all[index] = snapshot;
    else all.push(snapshot);

    await dbAdapter.saveCollection(COLLECTION, all);
};

export const getEgoClubCardSnapshot = async (customerId: string): Promise<EgoClubCardSnapshot | null> => {
    if (!customerId) return null;
    const all = await readAll();
    return all.find(item => item.customerId === customerId) || null;
};

/**
 * Payload del QR: identifica al socio sin exponer datos sensibles.
 * Se prefiere el número de tarjeta del programa; si no hay, el id del cliente.
 */
export const buildEgoClubQrPayload = (customer: Customer): string => buildEgoClubQrContent(customer);

/** Texto relativo de frescura del dato, sin dependencias de locale. */
export const formatUpdatedAgo = (iso: string | undefined, now: Date = new Date()): string => {
    if (!iso) return 'sin sincronizar';
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return 'sin sincronizar';

    const diffMs = now.getTime() - then.getTime();
    if (diffMs < 0) return 'ahora mismo';

    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'ahora mismo';
    if (minutes < 60) return `hace ${minutes} min`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;

    const days = Math.floor(hours / 24);
    return days === 1 ? 'hace 1 día' : `hace ${days} días`;
};

export interface EgoClubCardView {
    customerId: string;
    name: string;
    tier?: LoyaltyTierId;
    tierLabel: string;
    points: number;
    /** Equivalente en RD$ según la tasa del ERP. */
    value: number;
    lastActivityAt?: string;
    qrPayload: string;
    /** De dónde salieron los datos que se están mostrando. */
    source: 'LIVE' | 'CACHED' | 'NONE';
    /** Marca de tiempo del dato mostrado: sólo si existe. */
    syncedAt?: string;
    /** «actualizado hace X» / «sin sincronizar». */
    freshness: string;
}

/**
 * Resuelve qué mostrar en la tarjeta.
 *
 * Reglas:
 * - Con datos vivos (cliente en memoria con saldo del ERP) se muestran esos y se marca
 *   como `LIVE`.
 * - Sin datos vivos pero con caché, se muestra el último saldo sincronizado con su hora
 *   (`CACHED`): es lo que permite operar sin conexión sin inventar cifras.
 * - Sin nada, `NONE`: se muestran los datos de identidad y se avisa que no hay saldo
 *   sincronizado. **No se asume 0 puntos** (0 sería una cifra inventada).
 */
export const resolveEgoClubCardView = (params: {
    customer: Customer;
    snapshot?: EgoClubCardSnapshot | null;
    config: BusinessConfig;
    now?: Date;
}): EgoClubCardView => {
    const { customer, snapshot, config } = params;
    const now = params.now || new Date();
    const hasLive = typeof customer.loyaltyPoints === 'number';
    const tier = normalizeTier(customer.tier) || snapshot?.tier || undefined;
    const base = {
        customerId: customer.id,
        name: customer.name,
        tier,
        tierLabel: tier ? getTierLabel(config, tier) : 'Sin membresía',
        qrPayload: snapshot?.qrPayload || buildEgoClubQrPayload(customer),
    };

    if (hasLive) {
        return {
            ...base,
            points: Math.max(0, Math.floor(Number(customer.loyaltyPoints) || 0)),
            value: pointsToCurrency(customer.loyaltyPoints, config),
            lastActivityAt: customer.lastVisit,
            source: 'LIVE',
            syncedAt: snapshot?.syncedAt,
            freshness: snapshot ? formatUpdatedAgo(snapshot.syncedAt, now) : 'ahora mismo',
        };
    }

    if (snapshot) {
        return {
            ...base,
            points: snapshot.points,
            value: pointsToCurrency(snapshot.points, config),
            lastActivityAt: snapshot.lastActivityAt,
            source: 'CACHED',
            syncedAt: snapshot.syncedAt,
            freshness: formatUpdatedAgo(snapshot.syncedAt, now),
        };
    }

    return {
        ...base,
        points: 0,
        value: 0,
        lastActivityAt: customer.lastVisit,
        source: 'NONE',
        syncedAt: undefined,
        freshness: 'sin sincronizar',
    };
};
