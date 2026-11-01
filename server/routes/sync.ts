import express from 'express';
import { db, getCollection, getSetting, saveSetting } from '../db.js';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { emitSyncEvent } from '../socket.js';

const router = express.Router();

// In-memory terminal tracking
interface ConnectedTerminal {
    terminalId: string;
    lastSeen: string;
    ip: string;
    deviceToken?: string;
    status: 'ONLINE' | 'OFFLINE';
}

const getTerminalTokens = () => {
    const rows = db.prepare("SELECT token, terminalId FROM sync_tokens").all() as any[];
    const tokens: Record<string, string> = {};
    rows.forEach(r => tokens[r.token] = r.terminalId);
    return tokens;
};

const getConnectedTerminals = () => {
    const rows = db.prepare("SELECT * FROM connected_terminals").all() as any[];
    const terminals: Record<string, any> = {};
    rows.forEach(r => terminals[r.terminalId] = r);
    return terminals;
};

// --- Sync Versioning & Change Log Helpers ---
const collectionAliasMap: Record<string, string> = {
    inventoryLedger: 'inventory_ledger',
    cashMovements: 'cash_movements',
    zReports: 'z_reports',
    productStocks: 'product_stocks',
    purchaseOrders: 'purchase_orders',
    supplierProductPrices: 'supplier_product_prices'
};

const resolveCollectionName = (collection: string) => collectionAliasMap[collection] || collection;

const getCollectionForSync = (collection: string): any[] => {
    const resolved = resolveCollectionName(collection);
    const data = getCollection(resolved);

    if (collection !== 'transactions' || !Array.isArray(data)) {
        return data;
    }

    // Do not sync table-open placeholder rows (ORD-*) as sales tickets.
    // These rows are operational state for restaurant tables, not fiscal documents.
    return data.filter((txn: any) => {
        const id = typeof txn?.id === 'string' ? txn.id.trim() : '';
        const displayId = typeof txn?.displayId === 'string' ? txn.displayId.trim() : '';
        const documentType = typeof txn?.documentType === 'string' ? txn.documentType.trim().toUpperCase() : '';

        if (id.startsWith('ORD-') && !displayId && !documentType) return false;
        return true;
    });
};

const getItemCount = (collection: string): number => {
    const data = getCollectionForSync(collection);
    return Array.isArray(data) ? data.length : 0;
};

const getSyncVersionKey = (collection: string) => `sync_version_${collection}`;

const getCurrentVersion = (collection: string): number => {
    const v = getSetting(getSyncVersionKey(collection));
    if (typeof v === 'number') return v;
    const syncMetadata = getSetting('syncMetadata') || {};
    const metaVersion = syncMetadata[collection]?.version;
    return typeof metaVersion === 'number' ? metaVersion : 0;
};

const bumpVersion = (collection: string, itemId?: string): number => {
    const next = getCurrentVersion(collection) + 1;
    saveSetting(getSyncVersionKey(collection), next);

    // Aditive: Update 'version' column for master data if itemId provided
    if (itemId && (collection === 'products' || collection === 'customers')) {
        const table = resolveCollectionName(collection);
        try {
            db.prepare(`UPDATE ${table} SET version = version + 1 WHERE id = ?`).run(itemId);
        } catch (e) {
            console.warn(`[Sync] Could not update version for ${collection}:${itemId}`, e);
        }
    }

    return next;
};

const ensureMetadata = (collection: string) => {
    const syncMetadata = getSetting('syncMetadata') || {};
    if (!syncMetadata[collection]) {
        syncMetadata[collection] = {
            version: getCurrentVersion(collection),
            lastUpdated: new Date().toISOString(),
            itemCount: getItemCount(collection),
            fullSyncVersion: 0
        };
        saveSetting('syncMetadata', syncMetadata);
    }
    return syncMetadata[collection];
};

const updateMetadata = (collection: string, version: number, fullSyncVersion?: number, requestOriginTerminalId?: string) => {
    const syncMetadata = getSetting('syncMetadata') || {};
    syncMetadata[collection] = {
        version,
        lastUpdated: new Date().toISOString(),
        itemCount: getItemCount(collection),
        fullSyncVersion: fullSyncVersion ?? syncMetadata[collection]?.fullSyncVersion ?? 0
    };
    saveSetting('syncMetadata', syncMetadata);

    // Aditive: Emit WebSocket event to notify clients for reactive sync
    const timestamp = new Date().toISOString();
    console.log(`[SERVER_WS_EMIT] ${timestamp} Notificando clientes: ${collection} (Origin: ${requestOriginTerminalId || 'Unknown'})`);

    if (collection === 'products') {
        emitSyncEvent('PRICE_CHANGED', { collection }, requestOriginTerminalId);
    } else {
        emitSyncEvent('CATALOG_UPDATED', { collection }, requestOriginTerminalId);
    }
};

const normalizeProductImages = (product: any): { image: string | null; images: string[] } => {
    const image = typeof product?.image === 'string' && product.image.trim().length > 0
        ? product.image
        : null;
    const images = Array.isArray(product?.images)
        ? product.images.filter((img: any) => typeof img === 'string' && img.trim().length > 0)
        : [];

    return { image, images };
};

const buildProductImageHash = (product: any): string => {
    const { image, images } = normalizeProductImages(product);
    return createHash('sha1')
        .update(JSON.stringify({ image, images }))
        .digest('hex');
};

const toFiniteNumber = (value: any, fallback = 0): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const toNumericMap = (value: any): Record<string, number> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value)) {
        out[key] = toFiniteNumber(raw, 0);
    }
    return out;
};

const safeJsonStringify = (value: any, fallback = '{}'): string => {
    if (value === undefined || value === null) return fallback;
    try {
        return JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? Number(v) : v);
    } catch {
        return fallback;
    }
};

const insertChangeStmt = db.prepare(`
    INSERT INTO sync_changes (collection, itemId, version, op, payload, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
`);

const clearChangesForCollection = (collection: string) => {
    db.prepare("DELETE FROM sync_changes WHERE collection = ?").run(collection);
};

const pruneOrphanOpenOrdersFromTransactions = () => {
    try {
        const txTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'").get();
        const tablesTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tables'").get();
        if (!txTableExists || !tablesTableExists) return;

        const countRow = db.prepare(`
            SELECT COUNT(*) AS count
            FROM transactions t
            WHERE t.id LIKE 'ORD-%'
              AND COALESCE(t.status, '') = 'ABIERTA'
              AND COALESCE(t.total, 0) = 0
              AND COALESCE(t.displayId, '') = ''
              AND COALESCE(t.documentType, '') = ''
              AND NOT EXISTS (
                  SELECT 1
                  FROM tables tb
                  WHERE tb.currentOrderId = t.id
              )
        `).get() as any;

        const toDelete = Number(countRow?.count || 0);
        if (toDelete <= 0) return;

        db.prepare(`
            DELETE FROM transactions
            WHERE id IN (
                SELECT t.id
                FROM transactions t
                WHERE t.id LIKE 'ORD-%'
                  AND COALESCE(t.status, '') = 'ABIERTA'
                  AND COALESCE(t.total, 0) = 0
                  AND COALESCE(t.displayId, '') = ''
                  AND COALESCE(t.documentType, '') = ''
                  AND NOT EXISTS (
                      SELECT 1
                      FROM tables tb
                      WHERE tb.currentOrderId = t.id
                  )
            )
        `).run();

        // Force clients to refresh transactions snapshot after cleanup.
        clearChangesForCollection('transactions');
        const newVersion = bumpVersion('transactions');
        updateMetadata('transactions', newVersion, newVersion);

        console.warn(`[Sync] Pruned ${toDelete} orphan ORD-* rows from transactions.`);
    } catch (error) {
        console.warn('[Sync] Failed to prune orphan ORD-* transactions:', error);
    }
};

pruneOrphanOpenOrdersFromTransactions();

/**
 * GET /api/sync/ping
 */
router.get('/ping', (req, res) => {
    res.json({ success: true, message: 'pong', serverTime: new Date().toISOString() });
});

router.get('/identify', (req, res) => {
    try {
        const businessConfig = getSetting('businessConfig') || {};

        res.json({
            status: 'online',
            app: 'CLIC-POS',
            role: 'MASTER',
            storeId: businessConfig.storeId || 'UNKNOWN',
            serverTime: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('Error in /identify:', error);
        res.status(500).json({ status: 'error', message: 'Internal Server Error' });
    }
});

/**
 * POST /api/sync/auth
 */
router.post('/auth', (req, res) => {
    const { terminalId, deviceToken } = req.body;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    if (!terminalId) {
        return res.status(400).json({ success: false, message: 'terminalId required' });
    }

    console.log(`[Sync] Terminal authentication: ${terminalId} from ${ip}`);

    // Security: Validate Device Token (Prevent Hijacking)
    if (!deviceToken) {
        return res.status(403).json({ success: false, message: 'Device token required', code: 'MISSING_TOKEN' });
    }

    const existing = db.prepare("SELECT deviceToken FROM connected_terminals WHERE terminalId = ?").get(terminalId) as any;
    if (existing && existing.deviceToken && existing.deviceToken !== deviceToken) {
        console.warn(`⚠️ [Sync] Token mismatch for ${terminalId}. Overwriting old token (Trust-on-First-Use)`);
        // We allow re-registration to support browser data clearing/re-installs
    }

    const token = `sync_${terminalId}_${Date.now()}`;

    db.prepare("INSERT OR REPLACE INTO sync_tokens (token, terminalId) VALUES (?, ?)").run(token, terminalId);
    db.prepare("INSERT OR REPLACE INTO connected_terminals (terminalId, lastSeen, ip, deviceToken, status) VALUES (?, ?, ?, ?, ?)").run(
        terminalId,
        new Date().toISOString(),
        ip,
        deviceToken,
        'ONLINE'
    );

    res.json({
        success: true,
        token,
        terminalId,
        expiresIn: 86400000
    });
});

/**
 * GET /api/sync/terminals
 */
router.get('/terminals', (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    const terminalsMap = getConnectedTerminals();
    const terminals = Object.values(terminalsMap).map((t: any) => {
        const isOnline = (new Date().getTime() - new Date(t.lastSeen).getTime()) < 120000;
        return {
            ...t,
            status: isOnline ? 'ONLINE' : 'OFFLINE'
        };
    });

    res.json({ success: true, terminals });
});

/**
 * GET /api/sync/collections/:collection/metadata
 */
router.get('/collections/:collection/metadata', async (req, res) => {
    const { collection } = req.params;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    const terminalId = tokens[authToken];
    if (terminalId) {
        db.prepare("UPDATE connected_terminals SET lastSeen = ? WHERE terminalId = ?").run(new Date().toISOString(), terminalId);
    }

    try {
        const metadata = ensureMetadata(collection);

        res.json({ success: true, metadata });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/collections/:collection/data
 */
router.get('/collections/:collection/data', async (req, res) => {
    const { collection } = req.params;
    const { sinceVersion } = req.query;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    const terminalId = tokens[authToken];
    if (terminalId) {
        db.prepare("UPDATE connected_terminals SET lastSeen = ? WHERE terminalId = ?").run(new Date().toISOString(), terminalId);
    }

    try {
        const items = getCollectionForSync(collection);
        const metadata = ensureMetadata(collection);

        const requestedVersion = sinceVersion ? parseInt(sinceVersion as string) : 0;
        if (requestedVersion >= metadata.version) {
            return res.json({ success: true, items: [], version: metadata.version, upToDate: true });
        }

        res.json({
            success: true,
            items,
            version: metadata.version,
            lastUpdated: metadata.lastUpdated,
            itemCount: items.length,
            upToDate: false
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/delta/:collection
 */
router.get('/delta/:collection', async (req, res) => {
    const { collection } = req.params;
    const { since, sinceVersion } = req.query;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    const terminalId = tokens[authToken];
    if (terminalId) {
        db.prepare("UPDATE connected_terminals SET lastSeen = ? WHERE terminalId = ?").run(new Date().toISOString(), terminalId);
    }

    try {
        const items = getCollectionForSync(collection);
        const metadata = ensureMetadata(collection);
        const latestVersion = metadata.version || 0;
        const fullSyncVersion = metadata.fullSyncVersion || 0;

        const requestedVersion = sinceVersion ? parseInt(sinceVersion as string) : 0;

        // SPECIAL CASE: 'config' is a singleton object, not an array
        if (collection === 'config') {
            if (requestedVersion >= latestVersion && latestVersion > 0) {
                return res.json({ success: true, items: [], serverTime: new Date().toISOString(), isFullDownload: false, latestVersion });
            }
            return res.json({ success: true, items: items ? [items] : [], serverTime: new Date().toISOString(), isFullDownload: true, latestVersion });
        }

        // If no version provided, or a full sync is required, return full download
        if (!requestedVersion || requestedVersion < fullSyncVersion) {
            return res.json({ success: true, items, serverTime: new Date().toISOString(), isFullDownload: true, latestVersion });
        }

        // Versioned delta using change log
        const rows = db.prepare(`
            SELECT itemId, op, payload, version
            FROM sync_changes
            WHERE collection = ? AND version > ?
            ORDER BY version ASC
        `).all(collection, requestedVersion) as any[];

        const deltaItems = rows.map(r => {
            if (r.op === 'DELETE') {
                let payload: any = {};
                try { payload = r.payload ? JSON.parse(r.payload) : {}; } catch { }
                return { id: r.itemId, deletedAt: payload.deletedAt || new Date().toISOString(), _op: 'DELETE' };
            }
            let payload: any = {};
            try { payload = r.payload ? JSON.parse(r.payload) : {}; } catch { }
            return { ...payload, _op: r.op || 'UPSERT' };
        });

        res.json({ success: true, items: deltaItems, serverTime: new Date().toISOString(), isFullDownload: false, latestVersion });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/products/images/manifest
 * Lightweight image channel: returns only image fingerprints to detect drift.
 */
router.get('/products/images/manifest', async (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    const terminalId = tokens[authToken];
    if (terminalId) {
        db.prepare("UPDATE connected_terminals SET lastSeen = ? WHERE terminalId = ?").run(new Date().toISOString(), terminalId);
    }

    try {
        const metadata = ensureMetadata('products');
        const sinceVersion = req.query.sinceVersion ? parseInt(req.query.sinceVersion as string, 10) : 0;

        if (sinceVersion >= metadata.version) {
            return res.json({
                success: true,
                items: [],
                version: metadata.version,
                upToDate: true,
                serverTime: new Date().toISOString()
            });
        }

        const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
        const requestedIds = new Set(
            idsParam.split(',').map(id => id.trim()).filter(Boolean)
        );

        const products = getCollectionForSync('products');
        const scopedProducts = requestedIds.size > 0
            ? products.filter((product: any) => requestedIds.has(product.id))
            : products;

        const items = scopedProducts
            .filter((product: any) => product?.id)
            .map((product: any) => {
                const { image, images } = normalizeProductImages(product);
                return {
                    id: product.id,
                    hash: buildProductImageHash(product),
                    hasImage: !!image || images.length > 0,
                    updatedAt: product.updatedAt || product.createdAt || null
                };
            });

        res.json({
            success: true,
            items,
            version: metadata.version,
            upToDate: false,
            serverTime: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/products/images/pull
 * Fetch images only for a subset of products.
 */
router.post('/products/images/pull', async (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    const terminalId = tokens[authToken];
    if (terminalId) {
        db.prepare("UPDATE connected_terminals SET lastSeen = ? WHERE terminalId = ?").run(new Date().toISOString(), terminalId);
    }

    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'ids must be a non-empty array' });
        }

        const MAX_BATCH = 300;
        if (ids.length > MAX_BATCH) {
            return res.status(400).json({ success: false, message: `Maximum ${MAX_BATCH} ids per request` });
        }

        const requestedIds = new Set(ids.map((id: any) => String(id)));
        const products = getCollectionForSync('products');

        const items = products
            .filter((product: any) => requestedIds.has(String(product?.id)))
            .map((product: any) => {
                const { image, images } = normalizeProductImages(product);
                return {
                    id: product.id,
                    image,
                    images,
                    hash: buildProductImageHash(product),
                    updatedAt: product.updatedAt || product.createdAt || null
                };
            });

        res.json({
            success: true,
            items,
            itemCount: items.length,
            serverTime: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/collections/:collection/push
 */
router.post('/collections/:collection/push', async (req, res) => {
    const { collection } = req.params;
    const { items, mode } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        if (!Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'items must be an array' });
        }

        const pushMode = mode === 'FULL_REPLACE' ? 'FULL_REPLACE' : 'UPSERT';

        // Define JSON fields (must match db.ts)
        const jsonFields: Record<string, string[]> = {
            products: ['images', 'attributes', 'variants', 'tariffs', 'stockBalances', 'activeInWarehouses', 'appliedTaxIds', 'warehouseSettings', 'availableModifiers', 'operationalFlags', 'recipeDetails'],
            roles: ['permissions', 'zReportConfig'],
            customers: ['tags', 'addresses'],
            transactions: ['items', 'payments', 'customerSnapshot', 'relatedTransactions'],
            receptions: ['items'],
            users: []
        };



        db.transaction(() => {
            const resolvedCollection = resolveCollectionName(collection);
            const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(resolvedCollection);
            const now = new Date().toISOString();

            if (tableExists) {
                const columns = db.prepare(`PRAGMA table_info(${resolvedCollection})`).all() as any[];
                const hasDataColumn = columns.some(c => c.name === 'data');

                // FORCE UPSERT for products to avoid FK violations from DELETE
                if (collection === 'products' && pushMode === 'FULL_REPLACE') {
                    console.warn('[Sync] Forcing UPSERT mode for products to preserve Foreign Keys');
                }

                if (pushMode === 'FULL_REPLACE' && collection !== 'products') {
                    // Full replace (force push) - Only for non-critical collections
                    db.prepare(`DELETE FROM ${resolvedCollection}`).run();

                    if (hasDataColumn) {
                        const stmt = db.prepare(`INSERT INTO ${resolvedCollection} (id, data) VALUES (?, ?)`);
                        for (const item of items) stmt.run(item.id, JSON.stringify(item));
                    } else {
                        const colNames = columns.map(c => c.name);
                        const placeholders = colNames.map(() => '?').join(',');
                        const updateSet = colNames.map(c => `${c}=excluded.${c}`).join(',');
                        const stmt = db.prepare(`INSERT INTO ${resolvedCollection} (${colNames.join(',')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`);
                        const fieldsToStringify = jsonFields[collection] || [];

                        for (const item of items) {
                            const values = colNames.map(col => {
                                const val = item[col];
                                if (fieldsToStringify.includes(col)) {
                                    return typeof val === 'object' ? JSON.stringify(val) : (val || '[]');
                                }
                                if (typeof val === 'boolean') return val ? 1 : 0;
                                if (val === undefined) return null;
                                return val;
                            });
                            stmt.run(...values);
                        }
                    }

                    // Full replace resets change log and forces full download for slaves
                    clearChangesForCollection(collection);
                    const newVersion = bumpVersion(collection);
                    updateMetadata(collection, newVersion, newVersion);
                } else {
                    // UPSERT / DELETE items (delta-friendly)
                    let dataStmt: any = null;
                    let structuredStmt: any = null;
                    let colNames: string[] = [];
                    let fieldsToStringify: string[] = [];

                    if (hasDataColumn) {
                        dataStmt = db.prepare(`INSERT INTO ${resolvedCollection} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`);
                    } else {
                        colNames = columns.map(c => c.name);
                        const placeholders = colNames.map(() => '?').join(',');
                        const updateSet = colNames.map(c => `${c}=excluded.${c}`).join(',');
                        structuredStmt = db.prepare(`INSERT INTO ${resolvedCollection} (${colNames.join(',')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateSet}`);
                        fieldsToStringify = jsonFields[collection] || [];
                    }

                    for (const rawItem of items) {
                        if (!rawItem || !rawItem.id) {
                            console.warn(`[Sync] Skipping ${collection} item without id`, rawItem);
                            continue;
                        }

                        // Optimistic Locking Check
                        if (collection === 'products' || collection === 'customers') {
                            const current = db.prepare(`SELECT version FROM ${resolvedCollection} WHERE id = ?`).get(rawItem.id) as any;
                            // If Slave version is behind Master, conflict.
                            // Slave must pull before pushing their changes.
                            if (current && rawItem.version !== undefined && rawItem.version < current.version) {
                                throw new Error(`CONFLICT: Version mismatch for ${collection}:${rawItem.id}. Slave: ${rawItem.version}, Master: ${current.version}`);
                            }
                        }

                        const item = { ...rawItem };
                        const op = item._op === 'DELETE' || item.deletedAt || item.isActive === false ? 'DELETE' : 'UPSERT';

                        if (op === 'DELETE') {
                            if (item.id) {
                                db.prepare(`DELETE FROM ${resolvedCollection} WHERE id = ?`).run(item.id);
                            }
                        } else {
                            if (hasDataColumn && dataStmt) {
                                dataStmt.run(item.id, JSON.stringify(item));
                            } else if (structuredStmt) {
                                let existingRow: Record<string, any> | null | undefined = undefined;
                                const values = colNames.map(col => {
                                    let val = item[col];
                                    if (val === undefined) {
                                        if (existingRow === undefined) {
                                            existingRow = db.prepare(`SELECT ${colNames.join(',')} FROM ${resolvedCollection} WHERE id = ?`).get(item.id) as Record<string, any> | null;
                                        }
                                        if (existingRow && Object.prototype.hasOwnProperty.call(existingRow, col)) {
                                            val = existingRow[col];
                                        }
                                    }
                                    if (fieldsToStringify.includes(col)) {
                                        return typeof val === 'object' ? JSON.stringify(val) : (val || '[]');
                                    }
                                    if (typeof val === 'boolean') return val ? 1 : 0;
                                    if (val === undefined) return null;
                                    return val;
                                });
                                structuredStmt.run(...values);
                            }
                        }

                        const version = bumpVersion(collection, item.id);
                        const payload = op === 'DELETE'
                            ? JSON.stringify({ id: item.id, deletedAt: item.deletedAt || now })
                            : JSON.stringify(item);
                        insertChangeStmt.run(collection, item.id, version, op, payload, now);
                    }

                    updateMetadata(collection, getCurrentVersion(collection), undefined, tokens[authToken]);
                }
            } else {
                // Settings-based collection (array)
                if (pushMode === 'FULL_REPLACE') {
                    saveSetting(collection, items);
                    clearChangesForCollection(collection);
                    const newVersion = bumpVersion(collection);
                    updateMetadata(collection, newVersion, newVersion, tokens[authToken]);
                } else {
                    const existing = (getSetting(collection) || []) as any[];
                    const map = new Map(existing.map((i: any) => [i.id, i]));

                    for (const rawItem of items) {
                        const item = { ...rawItem };
                        const op = item._op === 'DELETE' || item.deletedAt || item.isActive === false ? 'DELETE' : 'UPSERT';
                        if (op === 'DELETE') {
                            map.delete(item.id);
                        } else {
                            map.set(item.id, item);
                        }

                        const version = bumpVersion(collection);
                        const payload = op === 'DELETE'
                            ? JSON.stringify({ id: item.id, deletedAt: item.deletedAt || now })
                            : JSON.stringify(item);
                        insertChangeStmt.run(collection, item.id, version, op, payload, now);
                    }

                    saveSetting(collection, Array.from(map.values()));
                    updateMetadata(collection, getCurrentVersion(collection), undefined, tokens[authToken]);
                }
            }
        })();

        res.json({ success: true, version: getCurrentVersion(collection), itemCount: (getCollection(collection) || []).length });
    } catch (error: any) {
        if (error.message && error.message.startsWith('CONFLICT:')) {
            console.warn(`[Sync] Conflict detected for ${collection}: ${error.message}`);
            return res.status(409).json({ success: false, message: error.message });
        }

        console.error(`❌ Error pushing to ${collection}:`, error);
        // ... rest of error log ...
        res.status(500).json({ success: false, message: error.message, details: error.stack });
    }
});

/**
 * GET /api/sync/wallet/verify/:customerId
 * Real-time balance verification for sensitive payments (Strict Online Mode)
 */
router.get('/wallet/verify/:customerId', async (req, res) => {
    const { customerId } = req.params;
    try {
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'").get();

        let data: any = null;
        if (tableExists) {
            const columns = db.prepare("PRAGMA table_info(customers)").all() as any[];
            const hasDataColumn = columns.some(c => c.name === 'data');
            const raw = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as any;
            if (raw) {
                data = hasDataColumn ? JSON.parse(raw.data) : raw;
            }
        } else {
            const customers = getSetting('customers') || [];
            data = customers.find((c: any) => c.id === customerId);
        }

        if (!data) return res.status(404).json({ success: false, message: 'Customer not found' });

        res.json({
            success: true,
            balance: data.wallet?.balance || 0,
            creditLimit: data.creditLimit || 0
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/status
 */
router.get('/status', async (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    const terminalId = tokens[authToken];
    if (terminalId) {
        db.prepare("UPDATE connected_terminals SET lastSeen = ? WHERE terminalId = ?").run(new Date().toISOString(), terminalId);
    }

    try {
        const collections = ['products', 'customers', 'suppliers', 'internalSequences'];
        const syncMetadata = getSetting('syncMetadata') || {};
        const status = collections.map(collection => {
            const items = getCollection(collection);
            const metadata = syncMetadata[collection];
            return {
                collection,
                version: metadata?.version || 0,
                lastUpdated: metadata?.lastUpdated || null,
                itemCount: items.length
            };
        });

        res.json({ success: true, status, serverTime: new Date().toISOString() });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/transactions
 */
router.post('/transactions', async (req, res) => {
    const { items } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        if (!Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'items must be an array' });
        }

        let addedCount = 0;
        let conflictResolvedCount = 0;
        const now = new Date().toISOString();
        db.transaction(() => {
            const stmt = db.prepare(`INSERT OR IGNORE INTO transactions (id, globalSequence, displayId, documentType, seriesId, seriesNumber, date, items, total, payments, userId, userName, terminalId, status, customerId, customerName, customerSnapshot, taxAmount, netAmount, discountAmount, isTaxIncluded, ncf, ncfType, relatedTransactions, originalTransactionId, refundReason, affectedInvoiceNumber, affectedNCF, syncStatus, syncError) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            const updateStmt = db.prepare(`UPDATE transactions SET globalSequence = ?, displayId = ?, documentType = ?, seriesId = ?, seriesNumber = ?, date = ?, items = ?, total = ?, payments = ?, userId = ?, userName = ?, terminalId = ?, status = ?, customerId = ?, customerName = ?, customerSnapshot = ?, taxAmount = ?, netAmount = ?, discountAmount = ?, isTaxIncluded = ?, ncf = ?, ncfType = ?, relatedTransactions = ?, originalTransactionId = ?, refundReason = ?, affectedInvoiceNumber = ?, affectedNCF = ?, syncStatus = ?, syncError = ? WHERE id = ?`);
            const byIdStmt = db.prepare(`SELECT id, displayId, terminalId FROM transactions WHERE id = ?`);
            const byDisplayIdStmt = db.prepare(`SELECT id, displayId, terminalId FROM transactions WHERE displayId = ?`);

            const insertTxn = (txn: any) =>
                stmt.run(
                    txn.id,
                    txn.globalSequence,
                    txn.displayId,
                    txn.documentType,
                    txn.seriesId,
                    txn.seriesNumber,
                    txn.date,
                    JSON.stringify(txn.items),
                    txn.total,
                    JSON.stringify(txn.payments),
                    txn.userId,
                    txn.userName,
                    txn.terminalId,
                    txn.status,
                    txn.customerId,
                    txn.customerName,
                    JSON.stringify(txn.customerSnapshot),
                    txn.taxAmount,
                    txn.netAmount,
                    txn.discountAmount,
                    txn.isTaxIncluded ? 1 : 0,
                    txn.ncf,
                    txn.ncfType,
                    JSON.stringify(txn.relatedTransactions),
                    txn.originalTransactionId,
                    txn.refundReason,
                    txn.affectedInvoiceNumber,
                    txn.affectedNCF,
                    txn.syncStatus,
                    txn.syncError
                );

            const updateTxn = (targetId: string, txn: any) =>
                updateStmt.run(
                    txn.globalSequence,
                    txn.displayId,
                    txn.documentType,
                    txn.seriesId,
                    txn.seriesNumber,
                    txn.date,
                    JSON.stringify(txn.items),
                    txn.total,
                    JSON.stringify(txn.payments),
                    txn.userId,
                    txn.userName,
                    txn.terminalId,
                    txn.status,
                    txn.customerId,
                    txn.customerName,
                    JSON.stringify(txn.customerSnapshot),
                    txn.taxAmount,
                    txn.netAmount,
                    txn.discountAmount,
                    txn.isTaxIncluded ? 1 : 0,
                    txn.ncf,
                    txn.ncfType,
                    JSON.stringify(txn.relatedTransactions),
                    txn.originalTransactionId,
                    txn.refundReason,
                    txn.affectedInvoiceNumber,
                    txn.affectedNCF,
                    txn.syncStatus,
                    txn.syncError,
                    targetId
                );

            for (const txn of items) {
                const result = insertTxn(txn);
                if (result.changes > 0) {
                    addedCount++;
                    const version = bumpVersion('transactions');
                    insertChangeStmt.run('transactions', txn.id, version, 'UPSERT', JSON.stringify(txn), now);
                    continue;
                }

                // Conflict handling path:
                // 1) If id already exists, update existing row with newest payload.
                // 2) If displayId exists with different id, merge into existing display row.
                // 3) If id collision with different displayId, synthesize deterministic id and insert.
                const existingById = byIdStmt.get(txn.id) as any;
                if (existingById?.id) {
                    const updatedTxn = { ...txn, id: existingById.id };
                    const updateResult = updateTxn(existingById.id, updatedTxn);
                    if (updateResult.changes > 0) {
                        conflictResolvedCount++;
                        const version = bumpVersion('transactions');
                        insertChangeStmt.run('transactions', updatedTxn.id, version, 'UPSERT', JSON.stringify(updatedTxn), now);
                    }
                    continue;
                }

                const existingByDisplayId = txn.displayId ? (byDisplayIdStmt.get(txn.displayId) as any) : null;
                if (existingByDisplayId?.id) {
                    const mergedTxn = { ...txn, id: existingByDisplayId.id };
                    const updateResult = updateTxn(existingByDisplayId.id, mergedTxn);
                    if (updateResult.changes > 0) {
                        conflictResolvedCount++;
                        const version = bumpVersion('transactions');
                        insertChangeStmt.run('transactions', mergedTxn.id, version, 'UPSERT', JSON.stringify(mergedTxn), now);
                    }
                    continue;
                }

                const baseId = typeof txn.id === 'string' && txn.id.trim().length > 0 ? txn.id : 'TXN-CONFLICT';
                const terminalIdPart = typeof txn.terminalId === 'string' && txn.terminalId.trim().length > 0 ? txn.terminalId.trim() : 'UNKNOWN';
                const displayIdPart = typeof txn.displayId === 'string' && txn.displayId.trim().length > 0 ? txn.displayId.trim() : `${Date.now()}`;
                const fallbackId = `${baseId}__${terminalIdPart}__${displayIdPart}`;
                const fallbackTxn = { ...txn, id: fallbackId };
                const fallbackResult = insertTxn(fallbackTxn);

                if (fallbackResult.changes > 0) {
                    conflictResolvedCount++;
                    const version = bumpVersion('transactions');
                    insertChangeStmt.run('transactions', fallbackTxn.id, version, 'UPSERT', JSON.stringify(fallbackTxn), now);
                    console.warn(`[Sync] Transaction ID conflict resolved with fallback id: original=${txn.id}, fallback=${fallbackTxn.id}, displayId=${txn.displayId}`);
                } else {
                    console.warn(`[Sync] Transaction ignored after conflict handling: id=${txn.id}, displayId=${txn.displayId}, terminalId=${txn.terminalId}`);
                }
            }

            const pending = getSetting('pending_transactions') || [];
            const pendingMap = new Map(pending.map((p: any) => [p.id, p]));
            items.forEach((it: any) => pendingMap.set(it.id, it));
            saveSetting('pending_transactions', Array.from(pendingMap.values()));

            updateMetadata('transactions', getCurrentVersion('transactions'));
        })();

        res.json({
            success: true,
            addedCount,
            conflictResolvedCount,
            totalCount: (getCollection('transactions')).length,
            inventoryUpdates: 0
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/transactions/pending
 */
router.get('/transactions/pending', async (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const pending = getSetting('pending_transactions') || [];
        res.json({ success: true, items: pending });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/transactions/pending/ack
 */
router.post('/transactions/pending/ack', async (req, res) => {
    const { ids } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        if (!Array.isArray(ids)) {
            return res.status(400).json({ success: false, message: 'ids must be an array' });
        }
        const pending = getSetting('pending_transactions') || [];
        const remaining = pending.filter((p: any) => !ids.includes(p.id));
        saveSetting('pending_transactions', remaining);
        res.json({ success: true, remaining: remaining.length });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/operational-status
 */
router.get('/operational-status', async (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const transactions = getCollection('transactions');
        const inventoryLedger = getCollection('inventory_ledger');
        const zReports = getCollection('z_reports');
        const pendingTxns = getSetting('pending_transactions') || [];
        const pendingMovements = getSetting('pending_inventory_movements') || [];
        const syncErrors = getSetting('sync_errors') || [];

        const terminalStats: { [key: string]: any } = {};
        const getStat = (tid: string) => {
            if (!terminalStats[tid]) {
                terminalStats[tid] = {
                    terminalId: tid,
                    transactions: 0,
                    movements: 0,
                    zReports: 0,
                    pending: 0,
                    errors: 0,
                    lastActivity: null
                };
            }
            return terminalStats[tid];
        };

        transactions.forEach((txn: any) => {
            const stat = getStat(txn.terminalId || 'Unknown');
            stat.transactions++;
            if (!stat.lastActivity || new Date(txn.date) > new Date(stat.lastActivity)) {
                stat.lastActivity = txn.date;
            }
        });

        inventoryLedger.forEach((move: any) => {
            const stat = getStat(move.terminalId || 'Unknown');
            stat.movements++;
            if (!stat.lastActivity || new Date(move.createdAt) > new Date(stat.lastActivity)) {
                stat.lastActivity = move.createdAt;
            }
        });

        zReports.forEach((report: any) => {
            const stat = getStat(report.terminalId || 'Unknown');
            stat.zReports++;
            if (!stat.lastActivity || new Date(report.closedAt) > new Date(stat.lastActivity)) {
                stat.lastActivity = report.closedAt;
            }
        });

        pendingTxns.forEach((txn: any) => { getStat(txn.terminalId || 'Unknown').pending++; });
        pendingMovements.forEach((move: any) => { getStat(move.terminalId || 'Unknown').pending++; });
        syncErrors.forEach((err: any) => { getStat(err.terminalId || 'Unknown').errors++; });

        res.json({
            success: true,
            terminals: Object.values(terminalStats),
            globalPending: {
                transactions: pendingTxns.length,
                movements: pendingMovements.length
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/errors
 */
router.post('/errors', async (req, res) => {
    const { terminalId, error, itemType, itemId } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const errors = getSetting('sync_errors') || [];
        errors.push({ terminalId, error, itemType, itemId, timestamp: new Date().toISOString() });
        if (errors.length > 500) errors.shift();
        saveSetting('sync_errors', errors);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/sync/history/:terminalId
 */
router.get('/history/:terminalId', async (req, res) => {
    const { terminalId } = req.params;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const transactions = getCollection('transactions').filter((t: any) => t.terminalId === terminalId);
        const inventoryLedger = getCollection('inventory_ledger').filter((m: any) => m.terminalId === terminalId);
        const zReports = getCollection('z_reports').filter((r: any) => r.terminalId === terminalId);
        const cashMovements = getCollection('cash_movements').filter((c: any) => c.terminalId === terminalId);

        res.json({
            success: true,
            terminalId,
            data: { transactions, inventoryLedger, zReports, cashMovements }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/cash/movements
 */
router.post('/cash/movements', async (req, res) => {
    const { items } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        if (!Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'items must be an array' });
        }

        const collectionKey = 'cashMovements';
        let addedCount = 0;
        const now = new Date().toISOString();
        db.transaction(() => {
            const stmt = db.prepare(`INSERT OR IGNORE INTO cash_movements (id, createdAt, type, amount, concept, userId, userName, terminalId, zReportId, syncStatus, syncError) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const move of items) {
                const result = stmt.run(move.id, move.createdAt, move.type, move.amount, move.concept, move.userId, move.userName, move.terminalId, move.zReportId, move.syncStatus, move.syncError);
                if (result.changes > 0) {
                    addedCount++;
                    const version = bumpVersion(collectionKey);
                    insertChangeStmt.run(collectionKey, move.id, version, 'UPSERT', JSON.stringify(move), now);
                }
            }

            updateMetadata(collectionKey, getCurrentVersion(collectionKey));
        })();

        res.json({ success: true, addedCount });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/z-reports
 */
router.post('/z-reports', async (req, res) => {
    const { items } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        if (!Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'items must be an array' });
        }

        const collectionKey = 'zReports';
        let addedCount = 0;
        let skippedCount = 0;
        const now = new Date().toISOString();
        db.transaction(() => {
            const stmt = db.prepare(`INSERT OR IGNORE INTO z_reports (id, openedAt, closedAt, terminalId, userId, userName, openingBalance, closingBalance, totalSales, totalTaxes, totalDiscounts, totalCash, totalCard, totalTransfer, totalOther, status, syncStatus, syncError, sequenceNumber, totalsByMethod, cashExpected, cashCounted, cashDiscrepancy, stats, transactionCount, notes, baseCurrency, cashSales, cashIn, cashOut) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const report of items) {
                try {
                    if (!report?.id) {
                        skippedCount++;
                        continue;
                    }

                    const totalsByMethod = toNumericMap(report.totalsByMethod);
                    const cashExpected = toNumericMap(report.cashExpected);
                    const cashCounted = toNumericMap(report.cashCounted);
                    const cashDiscrepancy = toNumericMap(report.cashDiscrepancy);
                    const totalSales = report.totalSales !== undefined
                        ? toFiniteNumber(report.totalSales, 0)
                        : Object.values(totalsByMethod).reduce((sum, val) => sum + val, 0);

                    const result = stmt.run(
                        report.id,
                        report.openedAt || null,
                        report.closedAt || null,
                        report.terminalId || null,
                        report.userId || report.closedByUserId || null,
                        report.userName || report.closedByUserName || null,
                        toFiniteNumber(report.openingBalance, 0),
                        toFiniteNumber(report.closingBalance, 0),
                        totalSales,
                        toFiniteNumber(report.totalTaxes, 0),
                        toFiniteNumber(report.totalDiscounts, 0),
                        toFiniteNumber(report.totalCash, 0),
                        toFiniteNumber(report.totalCard, 0),
                        toFiniteNumber(report.totalTransfer, 0),
                        toFiniteNumber(report.totalOther, 0),
                        report.status || 'CLOSED',
                        report.syncStatus || 'PENDING',
                        report.syncError || null,
                        report.sequenceNumber || '',
                        safeJsonStringify(totalsByMethod),
                        safeJsonStringify(cashExpected),
                        safeJsonStringify(cashCounted),
                        safeJsonStringify(cashDiscrepancy),
                        safeJsonStringify(report.stats, '{}'),
                        toFiniteNumber(report.transactionCount, 0),
                        report.notes || '',
                        report.baseCurrency || '',
                        toFiniteNumber(report.cashSales, 0),
                        toFiniteNumber(report.cashIn, 0),
                        toFiniteNumber(report.cashOut, 0)
                    );
                    if (result.changes > 0) {
                        addedCount++;
                        const version = bumpVersion(collectionKey);
                        insertChangeStmt.run(collectionKey, report.id, version, 'UPSERT', JSON.stringify(report), now);
                    }
                } catch (itemError: any) {
                    skippedCount++;
                    console.warn(`[Sync] Skipping malformed z-report ${report?.id || '(no-id)'}: ${itemError?.message || itemError}`);
                }
            }

            updateMetadata(collectionKey, getCurrentVersion(collectionKey));
        })();

        res.json({ success: true, addedCount, skippedCount });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/config
 */
router.get('/config', async (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const config = getSetting('config');
        res.json({ success: true, config });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/inventory/stock-balances
 */
router.get('/inventory/stock-balances', async (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const products = getCollection('products');
        const balances = products.map((p: any) => ({
            id: p.id,
            stock: p.stock || 0,
            stockBalances: p.stockBalances || {}
        }));

        res.json({ success: true, balances, serverTime: new Date().toISOString() });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/inventory/kardex/:productId
 */
router.get('/inventory/kardex/:productId', async (req, res) => {
    const { productId } = req.params;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const ledger = getCollection('inventory_ledger');
        const productLedger = ledger.filter((entry: any) => entry.productId === productId);
        res.json({ success: true, items: productLedger, serverTime: new Date().toISOString() });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/reset/:terminalId
 */
router.post('/reset/:terminalId', async (req, res) => {
    const { terminalId } = req.params;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const isFullReset = terminalId === 'ALL';
        db.transaction(() => {
            const tables = ['transactions', 'inventory_ledger', 'z_reports', 'cash_movements', 'receptions'];
            for (const table of tables) {
                try {
                    if (isFullReset) {
                        db.prepare(`DELETE FROM ${table}`).run();
                    } else {
                        // Check if terminalId column exists before deleting
                        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
                        if (columns.some(c => c.name === 'terminalId')) {
                            db.prepare(`DELETE FROM ${table} WHERE terminalId = ?`).run(terminalId);
                        } else {
                            console.warn(`[Reset] Table ${table} does not have terminalId column. Skipping.`);
                        }
                    }
                } catch (e: any) {
                    console.error(`[Reset] Error clearing table ${table}:`, e.message);
                }
            }

            // Clear settings-based buffers
            if (isFullReset) {
                saveSetting('pending_transactions', []);
                saveSetting('pending_inventory_movements', []);
                saveSetting('sync_errors', []);
            } else {
                const pendingTx = (getSetting('pending_transactions') || []).filter((t: any) => t.terminalId !== terminalId);
                saveSetting('pending_transactions', pendingTx);
                const pendingMov = (getSetting('pending_inventory_movements') || []).filter((m: any) => m.terminalId !== terminalId);
                saveSetting('pending_inventory_movements', pendingMov);
                const errors = (getSetting('sync_errors') || []).filter((e: any) => e.terminalId !== terminalId);
                saveSetting('sync_errors', errors);
            }

            const syncMetadata = getSetting('syncMetadata') || {};
            const now = new Date().toISOString();
            const newVersion = Date.now();

            tables.forEach(col => {
                if (syncMetadata[col]) {
                    syncMetadata[col].version = newVersion;
                    syncMetadata[col].lastUpdated = now;
                    syncMetadata[col].itemCount = (getCollection(col)).length;
                }
            });
            saveSetting('syncMetadata', syncMetadata);
        })();

        res.json({ success: true, message: `Data for terminal ${terminalId} reset successfully` });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/sync/inventory/movements/pending
 */
router.get('/inventory/movements/pending', async (req, res) => {
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        const pending = getSetting('pending_inventory_movements') || [];
        res.json({ success: true, items: pending });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/inventory/movements/pending/ack
 */
router.post('/inventory/movements/pending/ack', async (req, res) => {
    const { ids } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        if (!Array.isArray(ids)) {
            return res.status(400).json({ success: false, message: 'ids must be an array' });
        }
        const pending = getSetting('pending_inventory_movements') || [];
        const remaining = pending.filter((p: any) => !ids.includes(p.id));
        saveSetting('pending_inventory_movements', remaining);
        res.json({ success: true, remaining: remaining.length });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/sync/inventory/movements
 */
router.post('/inventory/movements', async (req, res) => {
    const { items } = req.body;
    const authToken = req.headers['x-sync-token'] as string;
    const tokens = getTerminalTokens();

    if (!authToken || !tokens[authToken]) {
        return res.status(401).json({ success: false, message: 'Invalid or missing sync token' });
    }

    try {
        if (!Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'items must be an array' });
        }

        const collectionKey = 'inventoryLedger';
        let addedCount = 0;
        const processedIds: string[] = [];
        const now = new Date().toISOString();

        db.transaction(() => {
            const stmt = db.prepare(`INSERT OR IGNORE INTO inventory_ledger (id, createdAt, warehouseId, productId, concept, documentRef, qtyIn, qtyOut, unitCost, balanceQty, balanceAvgCost, terminalId, syncStatus, syncError) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const move of items) {
                const result = stmt.run(move.id, move.createdAt, move.warehouseId, move.productId, move.concept, move.documentRef, move.qtyIn, move.qtyOut, move.unitCost, move.balanceQty, move.balanceAvgCost, move.terminalId, move.syncStatus, move.syncError);
                if (result.changes > 0) {
                    addedCount++;
                    const version = bumpVersion(collectionKey);
                    insertChangeStmt.run(collectionKey, move.id, version, 'UPSERT', JSON.stringify(move), now);

                    // 1. Update product_stocks table (Detailed Stock)
                    db.prepare(`
                        INSERT INTO product_stocks (id, productId, warehouseId, quantity, updatedAt)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(productId, warehouseId) DO UPDATE SET
                        quantity = quantity + ?,
                        updatedAt = ?
                    `).run(
                        `${move.productId}_${move.warehouseId}`,
                        move.productId,
                        move.warehouseId,
                        (move.qtyIn || 0) - (move.qtyOut || 0),
                        new Date().toISOString(),
                        (move.qtyIn || 0) - (move.qtyOut || 0),
                        new Date().toISOString()
                    );

                    // 2. Update products table (Catalog View)
                    // We need to update both the scalar 'stock' (total) and the 'stockBalances' JSON
                    const productState = db.prepare("SELECT stock, stockBalances FROM products WHERE id = ?").get(move.productId) as any;

                    if (productState) {
                        const currentBalances = productState.stockBalances ? JSON.parse(productState.stockBalances) : {};
                        const movementQty = (move.qtyIn || 0) - (move.qtyOut || 0);

                        // Update specific warehouse balance
                        currentBalances[move.warehouseId] = (currentBalances[move.warehouseId] || 0) + movementQty;

                        // Calculate new total stock
                        const newTotalStock = (productState.stock || 0) + movementQty;

                        db.prepare(`
                            UPDATE products 
                            SET stock = ?, 
                                stockBalances = ?, 
                                updatedAt = ? 
                            WHERE id = ?
                        `).run(
                            newTotalStock,
                            JSON.stringify(currentBalances),
                            new Date().toISOString(),
                            move.productId
                        );

                        // audit: Record discrepancy if stock goes negative in Master
                        if (newTotalStock < 0) {
                            db.prepare(`
                                INSERT INTO inventory_discrepancies (id, productId, warehouseId, terminalId, negativeAmount, timestamp)
                                VALUES (?, ?, ?, ?, ?, ?)
                            `).run(
                                `DISC_${move.id}`,
                                move.productId,
                                move.warehouseId,
                                move.terminalId || 'UNKNOWN',
                                newTotalStock,
                                new Date().toISOString()
                            );
                            console.warn(`[Audit] Negative stock detected: Product ${move.productId} at ${move.warehouseId} is ${newTotalStock}`);
                        }
                    }


                }
                processedIds.push(move.id);
            }

            const pending = getSetting('pending_inventory_movements') || [];
            const pendingMap = new Map(pending.map((p: any) => [p.id, p]));
            items.forEach((it: any) => pendingMap.set(it.id, it));
            saveSetting('pending_inventory_movements', Array.from(pendingMap.values()));

            updateMetadata(collectionKey, getCurrentVersion(collectionKey));
        })();

        res.json({ success: true, processedIds, addedCount, totalCount: (getCollection('inventory_ledger')).length });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;
