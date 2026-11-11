import type {
    DatabaseAdapter,
    DurableDocumentMutation,
    MasterNumberRangeRecord,
    NumberedMasterCommitInput,
    NumberedMasterCommitResult,
} from '../DatabaseAdapter';
import {
    applyMasterNumberToDocument,
    buildNumberedCustomerMutation,
    mergeMasterNumberRange,
} from '../../sync/masterNumberRangeContract';

const DB_NAME = 'clic_pos_indexeddb';
const DB_VERSION = 25; // v25 adds the inventory locations catalog
const OLD_DB_KEY = 'clic_pos_db_v1';
const OPEN_TIMEOUT_MS = 15000;
const CURSOR_IDLE_TIMEOUT_MS = 3000;
const CURSOR_HARD_TIMEOUT_MS = 8000;

const STORES = [
    'config', 'users', 'roles', 'customers', 'warehouses',
    'products', 'transactions', 'transactionHistory', 'cashMovements', 'transfers',
    'parkedTickets', 'purchaseOrders', 'suppliers', 'inventoryLedger',
    'internalSequences', 'fiscalRanges', 'fiscalAllocations',
    'localFiscalBuffer', 'campaigns', 'coupons', 'zReports', 'xReports',
    'receptions', 'productStocks', 'supplierProductPrices',
    'productPrices', 'catalogEdits',
    'inventoryTracking', 'rooms', 'tables', 'globalSequenceCounter',
    'watchlists', 'syncMetadata', 'inventorySnapshots', 'inventoryAuditLogs', 'inventoryCounts',
    'offline_receptions', 'offline_reception_queue', 'offline_reception_conflicts',
    'offline_inventory_counts', 'offline_inventory_count_queue', 'offline_inventory_count_conflicts',
    'offline_print_queue', 'reservations', 'inventoryCommitments', 'serviceTypes', 'activities', 'collections',
    'crmOpportunities', 'erp_sales_documents', 'customerMutations',
    'currencyAuditLogs', 'currencyRateSchedules',
    'invoiceReviewFlags', 'invoiceAuditEvents', 'invoiceAdjustments',
    'masterNumberRanges', 'masterNumberSyncReceipts',
    'recoveryOriginals', 'recoveryState', 'recoveryStage', 'wallet_transactions',
    'receptionIdempotency', 'locations'
];

export class IndexedDBAdapter implements DatabaseAdapter {
    private db: IDBDatabase | null = null;
    private storageOnlyMode = false;
    public readonly adapterType = 'local';

    async connect(): Promise<void> {
        if (this.db) return;

        try {
            const versionToOpen = await this.resolveCompatibleVersion();
            this.db = await this.openDatabase(versionToOpen, OPEN_TIMEOUT_MS);
        } catch (error: any) {
            const message = String(error?.message || error || '');
            const isVersionDowngrade =
                error?.name === 'VersionError' ||
                message.toLowerCase().includes('less than the existing version');

            if (isVersionDowngrade) {
                console.warn('[IndexedDBAdapter] Requested version is older than existing DB. Reopening current version.', error);
                this.db = await this.openDatabase(undefined, OPEN_TIMEOUT_MS);
                this.storageOnlyMode = false;
                console.log('[IndexedDBAdapter] Connected using existing DB version');
                this.attachVersionChangeHandler();
                await this.migrateFromLocalStorage();
                return;
            }

            const canFallback = message.toLowerCase().includes('timeout') || message.toLowerCase().includes('blocked');

            if (!canFallback) {
                throw error;
            }

            console.warn('[IndexedDBAdapter] Upgrade open failed. Switching to localStorage-only mode.', error);
            this.storageOnlyMode = true;
            await this.migrateFromLocalStorage();
            return;
        }

        this.storageOnlyMode = false;
        console.log('[IndexedDBAdapter] Connected');
        this.attachVersionChangeHandler();
        await this.migrateFromLocalStorage();
    }

    private async resolveCompatibleVersion(): Promise<number | undefined> {
        try {
            const databasesApi = (indexedDB as IDBFactory & {
                databases?: () => Promise<Array<{ name?: string; version?: number }>>;
            }).databases;

            if (typeof databasesApi !== 'function') {
                return DB_VERSION;
            }

            const databases = await databasesApi.call(indexedDB);
            const existingDb = databases.find(db => db?.name === DB_NAME);
            const existingVersion = Number(existingDb?.version || 0);

            if (existingVersion > DB_VERSION) {
                console.warn(
                    `[IndexedDBAdapter] Existing DB version ${existingVersion} is newer than requested ${DB_VERSION}. Using existing version.`
                );
                return existingVersion;
            }
        } catch (error) {
            console.warn('[IndexedDBAdapter] Could not inspect existing IndexedDB versions. Falling back to requested version.', error);
        }

        return DB_VERSION;
    }

    private openDatabase(version?: number, timeoutMs = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const fail = (error: any) => {
                if (settled) return;
                settled = true;
                reject(error);
            };
            const complete = (db: IDBDatabase) => {
                if (settled) return;
                settled = true;
                resolve(db);
            };

            const request = typeof version === 'number'
                ? indexedDB.open(DB_NAME, version)
                : indexedDB.open(DB_NAME);

            const watchdog = window.setTimeout(() => {
                fail(new Error('IndexedDB open timeout. Possible blocked upgrade on another tab.'));
            }, timeoutMs);

            request.onupgradeneeded = (event: any) => {
                const db = event.target.result as IDBDatabase;
                const oldVersion = Number(event.oldVersion || 0);
                this.ensureSchema(db, oldVersion);
            };

            request.onsuccess = () => {
                window.clearTimeout(watchdog);
                if (settled) {
                    try {
                        request.result?.close();
                    } catch {
                        // no-op
                    }
                    return;
                }
                complete(request.result);
            };

            request.onerror = () => {
                window.clearTimeout(watchdog);
                console.error('[IndexedDBAdapter] Connection error:', request.error);
                fail(request.error || new Error('IndexedDB open error'));
            };

            request.onblocked = () => {
                window.clearTimeout(watchdog);
                fail(new Error('IndexedDB upgrade blocked by another open tab/session.'));
            };
        });
    }

    private ensureSchema(db: IDBDatabase, oldVersion: number) {
        console.log(`[IndexedDBAdapter] 🔼 Upgrading DB to version ${DB_VERSION}`);

        // Legacy schema fixes must run only for old DB versions.
        if (oldVersion < 7 && db.objectStoreNames.contains('transfers')) {
            db.deleteObjectStore('transfers');
        }

        if (oldVersion < 8 && db.objectStoreNames.contains('zReports')) {
            console.log('[IndexedDBAdapter] ♻️ Recreating zReports store to fix schema');
            db.deleteObjectStore('zReports');
        }

        STORES.forEach(store => {
            if (!db.objectStoreNames.contains(store)) {
                db.createObjectStore(store, { keyPath: 'id' });
            }
        });
    }

    private attachVersionChangeHandler() {
        if (!this.db) return;
        this.db.onversionchange = () => {
            console.warn('[IndexedDBAdapter] Version change detected. Closing DB connection to unblock upgrade.');
            this.db?.close();
            this.db = null;
        };
    }

    private hasStore(collectionName: string): boolean {
        return !this.storageOnlyMode && !!this.db && this.db.objectStoreNames.contains(collectionName);
    }

    private fallbackKey(collectionName: string): string {
        return `${DB_NAME}__fallback__${collectionName}`;
    }

    private isFallbackOnlyCollection(collectionName: string): boolean {
        return false; // Disable global fallback only mode for all collections to prioritize IndexedDB
    }

    private reconcileFlagKey(collectionName: string): string {
        return `${DB_NAME}__reconciled__${collectionName}__v1`;
    }

    private readFallbackCollection(collectionName: string): any[] {
        try {
            const raw = localStorage.getItem(this.fallbackKey(collectionName));
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private writeFallbackCollection(collectionName: string, docs: any[]): void {
        localStorage.setItem(this.fallbackKey(collectionName), JSON.stringify(Array.isArray(docs) ? docs : []));
    }

    private readStoreCollection(collectionName: string): Promise<any[]> {
        return new Promise((resolve, reject) => {
            if (!this.hasStore(collectionName)) return resolve([]);
            try {
                const transaction = this.db!.transaction(collectionName, 'readonly');
                const store = transaction.objectStore(collectionName);
                const request = store.getAll();
                request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(error);
            }
        });
    }

    private toStoredDocuments(collectionName: string, data: any): any[] {
        if (collectionName === 'config' && data && !Array.isArray(data)) {
            return [{ ...data, id: (data as any).id || 'current' }];
        }
        if (collectionName === 'globalSequenceCounter' && typeof data === 'number') {
            return [{ id: 'value', count: data }];
        }
        return Array.isArray(data) ? data : [];
    }

    private fromStoredDocuments(collectionName: string, docs: any[]): any {
        if (collectionName === 'config') {
            if (!docs.length) return {};
            // CRITICAL: Filter out metadata and seek 'current'
            const realDocs = docs.filter((doc: any) => doc?.id !== '_db_initialized' && doc?.id !== 'config_metadata');
            const current = realDocs.find((doc: any) => doc?.id === 'current');
            return current || realDocs[0] || {};
        }
        if (collectionName === 'globalSequenceCounter') {
            const row = docs.find((doc: any) => doc?.id === 'value');
            return Number(row?.count || 0);
        }
        return docs;
    }

    private upsertFallbackDocument(collectionName: string, doc: any): void {
        const docs = this.readFallbackCollection(collectionName);
        const index = docs.findIndex(item => item?.id === doc?.id);
        if (index >= 0) {
            docs[index] = doc;
        } else {
            docs.push(doc);
        }
        this.writeFallbackCollection(collectionName, docs);
    }

    private async migrateFromLocalStorage() {
        const raw = localStorage.getItem(OLD_DB_KEY);
        if (!raw) return;

        console.log('[IndexedDBAdapter] 🚚 Starting migration from LocalStorage...');
        try {
            const data = JSON.parse(raw);
            const collections = Object.keys(data);

            for (const colName of collections) {
                const colData = data[colName];
                if (colName === 'config' && !Array.isArray(colData)) {
                    // Config is usually an object, but our adapter expects collections of objects with 'id'
                    // We'll wrap it if necessary, or just skip if it doesn't fit the 'id' requirement
                    // Actually, let's just make it a document with id 'current'
                    await this.saveDocument('config', { ...colData, id: 'current' });
                } else if (Array.isArray(colData)) {
                    // Bulk save documents
                    for (const doc of colData) {
                        if (doc && typeof doc === 'object' && doc.id) {
                            await this.saveDocument(colName, doc);
                        }
                    }
                } else if (typeof colData === 'number' && colName === 'globalSequenceCounter') {
                    await this.saveDocument(colName, { id: 'value', count: colData });
                }
            }

            // Delete the old key - don't try to backup since localStorage is full!
            localStorage.removeItem(OLD_DB_KEY);
            console.log('[IndexedDBAdapter] ✅ Migration successful. Old LocalStorage key removed.');
        } catch (e) {
            console.error('[IndexedDBAdapter] ❌ Migration failed:', e);
        }
    }

    async disconnect(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        this.storageOnlyMode = false;
    }

    async getCollection<T>(collectionName: string, _queryParams?: Record<string, string>): Promise<T[]> {
        if (!this.db && !this.storageOnlyMode) throw new Error('DB not connected');

        return new Promise((resolve, reject) => {
            try {
                // Use localStorage fallback for heavy collections to avoid IndexedDB lock contention.
                // Self-heal: if fallback is empty but IndexedDB has rows from legacy writes, recover them.
                if (this.isFallbackOnlyCollection(collectionName)) {
                    const fallbackDocs = this.readFallbackCollection(collectionName);
                    const hasStore = this.hasStore(collectionName);
                    const reconcileDone = localStorage.getItem(this.reconcileFlagKey(collectionName)) === '1';

                    if (!hasStore || reconcileDone) {
                        return resolve(this.fromStoredDocuments(collectionName, fallbackDocs));
                    }

                    this.readStoreCollection(collectionName)
                        .then((storeDocs) => {
                            try {
                                // One-shot reconciliation: choose the most complete source.
                                if (storeDocs.length > fallbackDocs.length) {
                                    this.writeFallbackCollection(collectionName, storeDocs);
                                    console.warn(`[IndexedDBAdapter] Reconciled ${collectionName}: promoted ${storeDocs.length} rows from IndexedDB store over fallback ${fallbackDocs.length}.`);
                                    resolve(this.fromStoredDocuments(collectionName, storeDocs));
                                    return;
                                }
                            } finally {
                                localStorage.setItem(this.reconcileFlagKey(collectionName), '1');
                            }
                            resolve(this.fromStoredDocuments(collectionName, fallbackDocs));
                        })
                        .catch((error) => {
                            console.warn(`[IndexedDBAdapter] Could not reconcile ${collectionName} from IndexedDB store:`, error);
                            localStorage.setItem(this.reconcileFlagKey(collectionName), '1');
                            resolve(this.fromStoredDocuments(collectionName, fallbackDocs));
                        });
                    return;
                }

                if (!this.hasStore(collectionName)) {
                    const docs = this.readFallbackCollection(collectionName);
                    return resolve(this.fromStoredDocuments(collectionName, docs));
                }

                const transaction = this.db!.transaction(collectionName, 'readonly');
                const store = transaction.objectStore(collectionName);
                const request = store.getAll();

                request.onsuccess = () => {
                    const docs = Array.isArray(request.result) ? request.result : [];
                    resolve(this.fromStoredDocuments(collectionName, docs));
                };
                request.onerror = () => reject(request.error);
            } catch (e) {
                console.error(`Error getting collection ${collectionName}:`, e);
                const docs = this.readFallbackCollection(collectionName);
                resolve(this.fromStoredDocuments(collectionName, docs));
            }
        });
    }

    async saveCollection<T>(collectionName: string, data: T[]): Promise<void> {
        if (!this.db && !this.storageOnlyMode) throw new Error('DB not connected');
        const docs = this.toStoredDocuments(collectionName, data);

        return new Promise((resolve, reject) => {
            if (this.isFallbackOnlyCollection(collectionName)) {
                this.writeFallbackCollection(collectionName, docs);
                return resolve();
            }

            if (!this.hasStore(collectionName)) {
                this.writeFallbackCollection(collectionName, docs);
                return resolve();
            }

            const transaction = this.db!.transaction(collectionName, 'readwrite');
            const store = transaction.objectStore(collectionName);

            store.clear();
            docs.forEach(doc => store.put(doc));

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => {
                console.warn(`[IndexedDBAdapter] saveCollection fallback for ${collectionName}:`, transaction.error);
                try {
                    this.writeFallbackCollection(collectionName, docs);
                    resolve();
                } catch (e) {
                    reject(transaction.error || e);
                }
            };
        });
    }

    async saveDocument<T extends { id: string }>(collectionName: string, doc: T): Promise<void> {
        if (!this.db && !this.storageOnlyMode) throw new Error('DB not connected');

        return new Promise((resolve, reject) => {
            // Use localStorage for heavy collections to match getCollection behavior and avoid lock contention
            if (this.isFallbackOnlyCollection(collectionName)) {
                try {
                    this.upsertFallbackDocument(collectionName, doc);
                    return resolve();
                } catch (e) {
                    return reject(e);
                }
            }

            if (!this.hasStore(collectionName)) {
                this.upsertFallbackDocument(collectionName, doc);
                return resolve();
            }

            try {
                const transaction = this.db!.transaction(collectionName, 'readwrite');
                const store = transaction.objectStore(collectionName);
                store.put(doc);

                transaction.oncomplete = () => resolve();
                transaction.onerror = () => {
                    console.warn(`[IndexedDBAdapter] saveDocument fallback for ${collectionName}:`, transaction.error);
                    try {
                        this.upsertFallbackDocument(collectionName, doc);
                        resolve();
                    } catch (e) {
                        reject(transaction.error || e);
                    }
                };
            } catch (error) {
                console.warn(`[IndexedDBAdapter] saveDocument immediate fallback for ${collectionName}:`, error);
                try {
                    this.upsertFallbackDocument(collectionName, doc);
                    resolve();
                } catch (e) {
                    reject(error || e);
                }
            }
        });
    }

    async saveDocumentsAtomically(documents: DurableDocumentMutation[], requireAbsent = false, replaceCollections: string[] = []): Promise<void> {
        if (!documents.length && !replaceCollections.length) return;
        const names = [...new Set([...replaceCollections, ...documents.map(d => d.collectionName)])];
        if (!this.db || names.some(n => !this.hasStore(n))) throw new Error('RECOVERY_ATOMIC_STORAGE_UNAVAILABLE');
        await new Promise<void>((resolve, reject) => {
            const tx = this.db!.transaction(names, 'readwrite');
            let failure: Error | null = null;
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(failure || tx.error || new Error('RECOVERY_COMMIT_ABORTED'));
            tx.onerror = () => { /* onabort owns failure; do not write a fallback copy. */ };
            const put = (store: IDBObjectStore, document: unknown) => {
                try { store.put(document); }
                catch (error) {
                    failure = error instanceof Error ? error : new Error(String(error));
                    tx.abort();
                }
            };
            try {
                const seen = new Set<string>();
                for (const name of replaceCollections) tx.objectStore(name).clear();
                for (const mutation of documents) {
                    const identity = JSON.stringify([mutation.collectionName, mutation.document.id]);
                    if (requireAbsent && seen.has(identity)) throw new Error('RECOVERY_LOCAL_CONFLICT:' + identity);
                    seen.add(identity);
                    const store = tx.objectStore(mutation.collectionName);
                    if (!requireAbsent) { put(store, mutation.document); if (failure) break; continue; }
                    const request = store.get(mutation.document.id);
                    request.onsuccess = () => {
                        if (failure) return;
                        if (request.result !== undefined) {
                            failure = new Error('RECOVERY_LOCAL_CONFLICT:' + identity);
                            tx.abort();
                        } else put(store, mutation.document);
                    };
                }
            } catch (error) {
                failure = error instanceof Error ? error : new Error(String(error));
                tx.abort();
            }
        });
    }

    async bulkUpsert<T extends { id: string }>(collectionName: string, docs: T[]): Promise<void> {
        if (!this.db && !this.storageOnlyMode) throw new Error('DB not connected');
        if (!docs || docs.length === 0) return;

        return new Promise((resolve, reject) => {
            // Use localStorage for heavy collections
            if (this.isFallbackOnlyCollection(collectionName)) {
                try {
                    const storedDocs = this.readFallbackCollection(collectionName);
                    const docMap = new Map(storedDocs.map(d => [d.id, d]));

                    docs.forEach(doc => docMap.set(doc.id, doc));

                    this.writeFallbackCollection(collectionName, Array.from(docMap.values()));
                    return resolve();
                } catch (e) {
                    return reject(e);
                }
            }

            if (!this.hasStore(collectionName)) {
                try {
                    const storedDocs = this.readFallbackCollection(collectionName);
                    const docMap = new Map(storedDocs.map(d => [d.id, d]));
                    docs.forEach(doc => docMap.set(doc.id, doc));
                    this.writeFallbackCollection(collectionName, Array.from(docMap.values()));
                    return resolve();
                } catch (e) {
                    return reject(e);
                }
            }

            try {
                const transaction = this.db!.transaction(collectionName, 'readwrite');
                const store = transaction.objectStore(collectionName);

                docs.forEach(doc => store.put(doc));

                transaction.oncomplete = () => resolve();
                transaction.onerror = () => {
                    console.warn(`[IndexedDBAdapter] bulkUpsert fallback for ${collectionName}:`, transaction.error);
                    try {
                        const storedDocs = this.readFallbackCollection(collectionName);
                        const docMap = new Map(storedDocs.map(d => [d.id, d]));
                        docs.forEach(doc => docMap.set(doc.id, doc));
                        this.writeFallbackCollection(collectionName, Array.from(docMap.values()));
                        resolve();
                    } catch (e) {
                        reject(transaction.error || e);
                    }
                };
            } catch (error) {
                console.warn(`[IndexedDBAdapter] bulkUpsert immediate fallback for ${collectionName}:`, error);
                try {
                    const storedDocs = this.readFallbackCollection(collectionName);
                    const docMap = new Map(storedDocs.map(d => [d.id, d]));
                    docs.forEach(doc => docMap.set(doc.id, doc));
                    this.writeFallbackCollection(collectionName, Array.from(docMap.values()));
                    resolve();
                } catch (e) {
                    reject(error || e);
                }
            }
        });
    }

    async bulkUpdateProducts(productIds: string[], updates: any, userId?: string, userName?: string): Promise<void> {
        if (!this.db && !this.storageOnlyMode) throw new Error('DB not connected');

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db!.transaction(['products', 'productStocks', 'inventoryAuditLogs', 'config'], 'readwrite');
                const productsStore = transaction.objectStore('products');
                const stocksStore = transaction.objectStore('productStocks');
                const auditStore = transaction.objectStore('inventoryAuditLogs');
                const configStore = transaction.objectStore('config');

                const now = new Date().toISOString();

                // 1. Update Config (Seasons and Groups)
                const configReq = configStore.get('current');
                configReq.onsuccess = () => {
                    const config = configReq.result;
                    if (config) {
                        let configChanged = false;
                        if (updates.classification?.seasonId) {
                            config.seasons = (config.seasons || []).map((s: any) => ({
                                ...s,
                                productIds: (s.productIds || []).filter((id: string) => !productIds.includes(id))
                            }));
                            const target = config.seasons.find((s: any) => s.id === updates.classification.seasonId);
                            if (target) {
                                target.productIds = Array.from(new Set([...(target.productIds || []), ...productIds]));
                            }
                            configChanged = true;
                        }

                        if (updates.classification?.groupId) {
                            config.productGroups = (config.productGroups || []).map((g: any) => ({
                                ...g,
                                productIds: (g.productIds || []).filter((id: string) => !productIds.includes(id))
                            }));
                            const target = config.productGroups.find((g: any) => g.id === updates.classification.groupId);
                            if (target) {
                                target.productIds = Array.from(new Set([...(target.productIds || []), ...productIds]));
                            }
                            configChanged = true;
                        }

                        if (configChanged) {
                            configStore.put(config);
                        }
                    }
                };

                // 2. Process each product
                productIds.forEach(productId => {
                    const getRequest = productsStore.get(productId);
                    getRequest.onsuccess = () => {
                        const product = getRequest.result;
                        if (!product) return;

                        // --- Update Product Properties ---
                        if (updates.flags) {
                            const newFlags = { ...(product.operationalFlags || {}) };
                            Object.entries(updates.flags).forEach(([key, cfg]: [string, any]) => {
                                if (cfg.apply) (newFlags as any)[key] = cfg.value;
                            });
                            product.operationalFlags = newFlags;
                        }

                        if (updates.classification) {
                            const c = updates.classification;
                            if (c.categoryId) product.category = c.categoryId;
                            if (c.measurementUnit) product.measurementUnit = c.measurementUnit;
                            if (c.purchaseUnit) product.purchaseUnit = c.purchaseUnit;
                        }

                        if (updates.pricing?.tariffActions) {
                            const tariffCatalog = new Map(
                                (updates.pricing.tariffs || []).map((tariff: any) => [tariff.id, tariff])
                            );
                            const nextTariffs = [...(product.tariffs || [])];

                            Object.entries(updates.pricing.tariffActions).forEach(([tariffId, action]) => {
                                const existingIndex = nextTariffs.findIndex((tariff: any) => tariff.tariffId === tariffId);
                                if (action === 'ASSIGN') {
                                    if (existingIndex === -1) {
                                        const tariffMeta = tariffCatalog.get(tariffId) as { id: string; name?: string } | undefined;
                                        nextTariffs.push({
                                            tariffId,
                                            name: tariffMeta?.name,
                                            price: Number(product.price || 0),
                                            costBase: Number(product.cost || 0),
                                            margin: product.cost > 0
                                                ? ((Number(product.price || 0) - Number(product.cost || 0)) / Number(product.cost || 0)) * 100
                                                : 30
                                        });
                                    }
                                } else if (action === 'REMOVE' && existingIndex !== -1) {
                                    nextTariffs.splice(existingIndex, 1);
                                }
                            });

                            product.tariffs = nextTariffs;
                        }

                        // --- Warehouse Actions & activeInWarehouses Sync ---
                        if (updates.warehouseActions) {
                            const activeInWarehouses = new Set(product.activeInWarehouses || []);
                            Object.entries(updates.warehouseActions).forEach(([whId, action]) => {
                                const stockId = `${productId}_${whId}`;
                                if (action === 'ENABLE') {
                                    activeInWarehouses.add(whId);
                                    stocksStore.put({
                                        id: stockId,
                                        productId,
                                        warehouseId: whId,
                                        updatedAt: now
                                    });
                                } else if (action === 'DISABLE') {
                                    activeInWarehouses.delete(whId);
                                    stocksStore.delete(stockId);
                                }
                            });
                            product.activeInWarehouses = Array.from(activeInWarehouses);
                        }

                        product.updatedAt = now;
                        productsStore.put(product);
                    };
                });

                // 3. Audit Log
                const auditId = `BULK-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
                auditStore.put({
                    id: auditId,
                    sessionId: 'BULK_CATALOG_UPDATE',
                    warehouseId: 'SYSTEM',
                    action: 'APPLY',
                    reason: `Edición masiva aplicada a ${productIds.length} artículos`,
                    createdAt: now,
                    createdBy: userId || 'SYSTEM',
                    createdByName: userName || 'Sistema'
                });

                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            } catch (error) {
                console.warn('[IndexedDBAdapter] bulkUpdateProducts execution failed:', error);
                reject(error);
            }
        });
    }

    async getDocument<T>(collectionName: string, id: string): Promise<T | null> {
        if (!this.db && !this.storageOnlyMode) throw new Error('DB not connected');

        return new Promise((resolve, reject) => {
            if (this.isFallbackOnlyCollection(collectionName)) {
                const docs = this.readFallbackCollection(collectionName);
                const match = docs.find((doc: any) => doc?.id === id) || null;
                return resolve(match);
            }

            if (!this.hasStore(collectionName)) {
                const docs = this.readFallbackCollection(collectionName);
                const match = docs.find((doc: any) => doc?.id === id) || null;
                return resolve(match);
            }

            const transaction = this.db!.transaction(collectionName, 'readonly');
            const store = transaction.objectStore(collectionName);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteDocument(collectionName: string, id: string): Promise<void> {
        if (!this.db && !this.storageOnlyMode) throw new Error('DB not connected');

        return new Promise((resolve, reject) => {
            if (this.isFallbackOnlyCollection(collectionName)) {
                const docs = this.readFallbackCollection(collectionName).filter((doc: any) => doc?.id !== id);
                this.writeFallbackCollection(collectionName, docs);
                return resolve();
            }

            if (!this.hasStore(collectionName)) {
                const docs = this.readFallbackCollection(collectionName).filter((doc: any) => doc?.id !== id);
                this.writeFallbackCollection(collectionName, docs);
                return resolve();
            }

            const transaction = this.db!.transaction(collectionName, 'readwrite');
            const store = transaction.objectStore(collectionName);
            store.delete(id);

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async getMasterNumberRanges(): Promise<MasterNumberRangeRecord[]> {
        return this.getCollection<MasterNumberRangeRecord>('masterNumberRanges');
    }

    async upsertMasterNumberRanges(ranges: MasterNumberRangeRecord[]): Promise<void> {
        if (!ranges.length) return;
        if (!this.db || this.storageOnlyMode || !this.hasStore('masterNumberRanges')) {
            throw new Error('El almacenamiento local no soporta rangos numéricos de maestros.');
        }
        await new Promise<void>((resolve, reject) => {
            const transaction = this.db!.transaction('masterNumberRanges', 'readwrite');
            const store = transaction.objectStore('masterNumberRanges');
            for (const remote of ranges) {
                const request = store.get(remote.id);
                request.onsuccess = () => {
                    store.put(mergeMasterNumberRange(request.result as MasterNumberRangeRecord | undefined, remote));
                };
                request.onerror = () => transaction.abort();
            }
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error || new Error('No se pudieron actualizar los rangos.'));
            transaction.onabort = () => reject(transaction.error || new Error('No se pudieron actualizar los rangos.'));
        });
    }

    async commitNumberedMasterCreation(input: NumberedMasterCommitInput): Promise<NumberedMasterCommitResult> {
        if (!this.db || this.storageOnlyMode || !this.hasStore('masterNumberRanges') || !this.hasStore(input.collectionName)) {
            throw new Error('La terminal agotó el rango asignado. Conéctala y solicita un nuevo rango.');
        }

        return new Promise((resolve, reject) => {
            const stores = ['masterNumberRanges', input.collectionName];
            if (input.entityType === 'CUSTOMER') stores.push('customerMutations');
            const transaction = this.db!.transaction(stores, 'readwrite');
            const rangesStore = transaction.objectStore('masterNumberRanges');
            const documentsStore = transaction.objectStore(input.collectionName);
            let result: NumberedMasterCommitResult | null = null;
            const existingRequest = documentsStore.get(input.document.id);
            existingRequest.onsuccess = () => {
                if (existingRequest.result) {
                    const existing = existingRequest.result;
                    result = {
                        document: existing,
                        range: null,
                        issuedNumber: Number.isSafeInteger(existing.master_number_value) ? existing.master_number_value : null,
                        code: String(existing.external_code || existing.customer_code || existing.supplier_code || existing.sku || ''),
                    };
                    return;
                }
                const request = rangesStore.getAll();
                request.onsuccess = () => {
                const ranges = (request.result as MasterNumberRangeRecord[])
                    .filter(row => row.entityType === input.entityType && row.terminalId === input.sourceTerminalId
                        && row.status === 'ACTIVE' && row.nextNumber <= row.endNumber)
                    .sort((a, b) => a.startNumber - b.startNumber || a.id.localeCompare(b.id));
                const range = ranges[0];
                if (!range) {
                    transaction.abort();
                    return;
                }
                const issuedNumber = range.nextNumber;
                const document = applyMasterNumberToDocument(
                    input.entityType,
                    input.document,
                    range,
                    issuedNumber,
                    input.sourceTerminalId,
                );
                const updatedRange: MasterNumberRangeRecord = {
                    ...range,
                    nextNumber: issuedNumber + 1,
                    lastIssuedNumber: issuedNumber,
                    status: issuedNumber + 1 > range.endNumber ? 'EXHAUSTED' : range.status,
                    progressPending: true,
                };
                rangesStore.put(updatedRange);
                documentsStore.put(document);
                if (input.entityType === 'CUSTOMER') {
                    transaction.objectStore('customerMutations').put(buildNumberedCustomerMutation(
                        document, input.localTerminalId || input.sourceTerminalId, new Date().toISOString(),
                    ));
                }
                result = { document, range: updatedRange, issuedNumber, code: String(document.external_code) };
                };
                request.onerror = () => transaction.abort();
            };
            existingRequest.onerror = () => transaction.abort();
            transaction.oncomplete = () => result
                ? resolve(result)
                : reject(new Error('La terminal agotó el rango asignado. Conéctala y solicita un nuevo rango.'));
            transaction.onabort = () => reject(new Error('La terminal agotó el rango asignado. Conéctala y solicita un nuevo rango.'));
            transaction.onerror = () => reject(transaction.error || new Error('No se pudo reservar el código de maestro.'));
        });
    }

    async markMasterNumberRangeProgressReported(rangeId: string, lastIssuedNumber: number): Promise<void> {
        await this.mutateMasterNumberRange(rangeId, range => ({
            ...range,
            lastReportedNumber: Math.max(range.lastReportedNumber ?? (range.startNumber - 1), lastIssuedNumber),
            progressPending: (range.lastIssuedNumber ?? (range.startNumber - 1))
                > Math.max(range.lastReportedNumber ?? (range.startNumber - 1), lastIssuedNumber),
        }));
    }

    async blockMasterNumberRange(rangeId: string, reason: string): Promise<void> {
        await this.mutateMasterNumberRange(rangeId, range => ({ ...range, status: 'BLOCKED', blockedReason: reason }));
    }

    private async mutateMasterNumberRange(
        rangeId: string,
        transform: (range: MasterNumberRangeRecord) => MasterNumberRangeRecord,
    ): Promise<void> {
        if (!this.db || this.storageOnlyMode || !this.hasStore('masterNumberRanges')) {
            throw new Error('El almacenamiento local no soporta rangos numéricos de maestros.');
        }
        await new Promise<void>((resolve, reject) => {
            const transaction = this.db!.transaction('masterNumberRanges', 'readwrite');
            const store = transaction.objectStore('masterNumberRanges');
            const request = store.get(rangeId);
            request.onsuccess = () => {
                if (request.result) store.put(transform(request.result as MasterNumberRangeRecord));
            };
            request.onerror = () => transaction.abort();
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('No se pudo actualizar el rango.'));
        });
    }

    async checkHealth(): Promise<boolean> {
        return this.storageOnlyMode || !!this.db;
    }
}
