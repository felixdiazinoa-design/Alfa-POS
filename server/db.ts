import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'db.sqlite');

// Initialize database
export const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL'); // Better concurrency

const quoteIdentifier = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

const tableExists = (table: string): boolean => {
    const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(table);
    return Boolean(row);
};

const getTableColumns = (table: string): string[] => {
    if (!tableExists(table)) return [];
    const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>;
    return rows.map(row => row.name);
};

export const ensureColumn = (table: string, column: string, definition: string) => {
    if (!tableExists(table)) return;
    const columns = getTableColumns(table);
    if (columns.includes(column)) return;
    db.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition}`);
};

const ensureIndex = (indexName: string, table: string, columns: string[]) => {
    if (!tableExists(table)) return;
    db.exec(
        `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${quoteIdentifier(table)} (${columns
            .map(quoteIdentifier)
            .join(', ')})`
    );
};

const SYNC_AUDIT_TABLES = [
    'roles',
    'users',
    'warehouses',
    'customers',
    'products',
    'rooms',
    'tables',
    'product_stocks',
    'inventory_commitments',
    'inventory_ledger',
    'transactions',
    'transaction_history',
    'suppliers',
    'purchase_orders',
    'transfers',
    'z_reports',
    'cash_movements',
    'receptions',
    'reservations',
    'wallets',
    'wallet_transactions',
];

const SCOPED_TABLE_COLUMNS: Record<string, string[]> = {
    warehouses: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT'],
    customers: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT'],
    products: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT'],
    product_stocks: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT'],
    inventory_commitments: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT'],
    inventory_ledger: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT', 'warehouse_id TEXT'],
    transactions: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT', 'warehouse_id TEXT'],
    transaction_history: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT', 'warehouse_id TEXT'],
    suppliers: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT'],
    purchase_orders: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT'],
    transfers: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT'],
    receptions: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT'],
    reservations: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT'],
    z_reports: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT'],
    cash_movements: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT'],
    wallets: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT'],
    wallet_transactions: ['tenant_id TEXT', 'company_id TEXT', 'store_id TEXT'],
};

const TRANSACTION_SETTLEMENT_COLUMN_DEFINITIONS = [
    ['settlement_currency_code', 'TEXT'],
    ['settlement_exchange_rate', 'REAL'],
    ['settlement_received_original', 'REAL DEFAULT 0'],
    ['settlement_received_base', 'REAL DEFAULT 0'],
    ['settlement_applied_base', 'REAL DEFAULT 0'],
    ['settlement_change_base', 'REAL DEFAULT 0'],
    ['settlement_change_currency_code', 'TEXT'],
] as const;

const ensureTransactionSettlementColumns = () => {
    for (const table of ['transactions', 'transaction_history']) {
        for (const [column, definition] of TRANSACTION_SETTLEMENT_COLUMN_DEFINITIONS) {
            ensureColumn(table, column, definition);
        }
    }
};

const applyAuditAndScopeColumns = () => {
    for (const table of SYNC_AUDIT_TABLES) {
        ensureColumn(table, 'updated_at', 'TEXT');
        ensureColumn(table, 'deleted_at', 'TEXT');
    }

    Object.entries(SCOPED_TABLE_COLUMNS).forEach(([table, definitions]) => {
        definitions.forEach(definition => {
            const [column] = definition.split(' ');
            ensureColumn(table, column, definition);
        });
    });
};

const ensureSyncIndexes = () => {
    ensureIndex('idx_products_deleted_at', 'products', ['deleted_at']);
    ensureIndex('idx_products_tenant_store', 'products', ['tenant_id', 'store_id']);
    ensureIndex('idx_customers_deleted_at', 'customers', ['deleted_at']);
    ensureIndex('idx_customers_tenant_store', 'customers', ['tenant_id', 'store_id']);
    ensureIndex('idx_warehouses_deleted_at', 'warehouses', ['deleted_at']);
    ensureIndex('idx_warehouses_tenant_store', 'warehouses', ['tenant_id', 'store_id']);
    ensureIndex('idx_product_stocks_deleted_at', 'product_stocks', ['deleted_at']);
    ensureIndex('idx_product_stocks_tenant_store', 'product_stocks', ['tenant_id', 'store_id']);
    ensureIndex('idx_inventory_ledger_deleted_at', 'inventory_ledger', ['deleted_at']);
    ensureIndex('idx_inventory_ledger_tenant_store', 'inventory_ledger', ['tenant_id', 'store_id']);
    ensureIndex('idx_transactions_deleted_at', 'transactions', ['deleted_at']);
    ensureIndex('idx_transactions_tenant_store', 'transactions', ['tenant_id', 'store_id']);
    ensureIndex('idx_transaction_history_deleted_at', 'transaction_history', ['deleted_at']);
    ensureIndex('idx_transaction_history_tenant_store', 'transaction_history', ['tenant_id', 'store_id']);
};

export const backfillAuditColumns = () => {
    const auditBackfills: Array<{ table: string; expression: string }> = [
        { table: 'roles', expression: 'CURRENT_TIMESTAMP' },
        { table: 'users', expression: 'CURRENT_TIMESTAMP' },
        { table: 'warehouses', expression: 'CURRENT_TIMESTAMP' },
        { table: 'customers', expression: 'COALESCE(updated_at, createdAt, CURRENT_TIMESTAMP)' },
        { table: 'products', expression: 'COALESCE(updated_at, updatedAt, createdAt, CURRENT_TIMESTAMP)' },
        { table: 'rooms', expression: 'CURRENT_TIMESTAMP' },
        { table: 'tables', expression: 'CURRENT_TIMESTAMP' },
        { table: 'product_stocks', expression: 'COALESCE(updated_at, updatedAt, CURRENT_TIMESTAMP)' },
        { table: 'inventory_commitments', expression: 'COALESCE(updated_at, updatedAt, CURRENT_TIMESTAMP)' },
        { table: 'inventory_ledger', expression: 'COALESCE(updated_at, createdAt, CURRENT_TIMESTAMP)' },
        { table: 'transactions', expression: 'COALESCE(updated_at, date, CURRENT_TIMESTAMP)' },
        { table: 'transaction_history', expression: 'COALESCE(updated_at, date, CURRENT_TIMESTAMP)' },
        { table: 'suppliers', expression: 'CURRENT_TIMESTAMP' },
        { table: 'purchase_orders', expression: 'CURRENT_TIMESTAMP' },
        { table: 'transfers', expression: 'CURRENT_TIMESTAMP' },
        { table: 'z_reports', expression: 'COALESCE(updated_at, closedAt, openedAt, CURRENT_TIMESTAMP)' },
        { table: 'cash_movements', expression: 'COALESCE(updated_at, createdAt, CURRENT_TIMESTAMP)' },
        { table: 'receptions', expression: 'CURRENT_TIMESTAMP' },
        { table: 'reservations', expression: 'COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)' },
        { table: 'wallets', expression: 'COALESCE(updated_at, updatedAt, CURRENT_TIMESTAMP)' },
        { table: 'wallet_transactions', expression: 'COALESCE(updated_at, createdAt, CURRENT_TIMESTAMP)' },
    ];

    for (const { table, expression } of auditBackfills) {
        if (!tableExists(table) || !getTableColumns(table).includes('updated_at')) continue;
        db.exec(
            `UPDATE ${quoteIdentifier(table)}
             SET updated_at = ${expression}
             WHERE updated_at IS NULL OR TRIM(updated_at) = ''`
        );
    }

    if (tableExists('warehouses') && getTableColumns('warehouses').includes('store_id')) {
        db.exec(`
            UPDATE warehouses
            SET store_id = COALESCE(NULLIF(store_id, ''), storeId)
            WHERE store_id IS NULL OR TRIM(store_id) = ''
        `);
    }

    if (tableExists('product_stocks') && tableExists('warehouses') && getTableColumns('product_stocks').includes('store_id')) {
        db.exec(`
            UPDATE product_stocks
            SET store_id = COALESCE(
                NULLIF(store_id, ''),
                (
                    SELECT w.storeId
                    FROM warehouses w
                    WHERE w.id = product_stocks.warehouseId
                    LIMIT 1
                )
            )
            WHERE store_id IS NULL OR TRIM(store_id) = ''
        `);
    }

    if (tableExists('inventory_commitments') && tableExists('warehouses') && getTableColumns('inventory_commitments').includes('store_id')) {
        db.exec(`
            UPDATE inventory_commitments
            SET store_id = COALESCE(
                NULLIF(store_id, ''),
                (
                    SELECT w.storeId
                    FROM warehouses w
                    WHERE w.id = inventory_commitments.warehouseId
                    LIMIT 1
                )
            )
            WHERE store_id IS NULL OR TRIM(store_id) = ''
        `);
    }

    if (tableExists('inventory_ledger')) {
        const inventoryLedgerColumns = getTableColumns('inventory_ledger');
        if (inventoryLedgerColumns.includes('warehouse_id')) {
            db.exec(`
                UPDATE inventory_ledger
                SET warehouse_id = COALESCE(NULLIF(warehouse_id, ''), warehouseId)
                WHERE warehouse_id IS NULL OR TRIM(warehouse_id) = ''
            `);
        }
        if (inventoryLedgerColumns.includes('store_id') && tableExists('warehouses')) {
            db.exec(`
                UPDATE inventory_ledger
                SET store_id = COALESCE(
                    NULLIF(store_id, ''),
                    (
                        SELECT COALESCE(w.store_id, w.storeId)
                        FROM warehouses w
                        WHERE w.id = COALESCE(inventory_ledger.warehouse_id, inventory_ledger.warehouseId)
                        LIMIT 1
                    )
                )
                WHERE store_id IS NULL OR TRIM(store_id) = ''
            `);
        }
    }
};

// Ensure sync change log exists (for versioned delta sync)
db.exec(`
    CREATE TABLE IF NOT EXISTS currency_audit_logs (
        id TEXT PRIMARY KEY,
        currencyCode TEXT NOT NULL,
        field TEXT NOT NULL,
        oldValue TEXT,
        newValue TEXT,
        changedAt TEXT NOT NULL,
        changedBy TEXT NOT NULL,
        changedByName TEXT NOT NULL,
        terminalId TEXT,
        source TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_currency_audit_currency ON currency_audit_logs(currencyCode);
    CREATE INDEX IF NOT EXISTS idx_currency_audit_date ON currency_audit_logs(changedAt);

    CREATE TABLE IF NOT EXISTS currency_rate_schedules (
        id TEXT PRIMARY KEY,
        currencyCode TEXT NOT NULL,
        rate REAL NOT NULL,
        buyRate REAL,
        sellRate REAL,
        executeAt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        createdAt TEXT NOT NULL,
        createdBy TEXT NOT NULL,
        createdByName TEXT NOT NULL,
        terminalId TEXT,
        appliedAt TEXT,
        error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_currency_schedule_due ON currency_rate_schedules(status, executeAt);

    CREATE TABLE IF NOT EXISTS sync_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection TEXT NOT NULL,
        itemId TEXT NOT NULL,
        version INTEGER NOT NULL,
        op TEXT NOT NULL,
        payload TEXT,
        createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_changes_collection_version
    ON sync_changes(collection, version);

    CREATE TABLE IF NOT EXISTS inventory_discrepancies (
        id TEXT PRIMARY KEY,
        productId TEXT,
        warehouseId TEXT,
        terminalId TEXT,
        negativeAmount REAL,
        timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory_ledger (
        id TEXT PRIMARY KEY,
        createdAt TEXT NOT NULL,
        updated_at TEXT,
        deleted_at TEXT,
        tenant_id TEXT,
        company_id TEXT,
        store_id TEXT,
        warehouse_id TEXT,
        warehouseId TEXT NOT NULL,
        productId TEXT NOT NULL,
        concept TEXT NOT NULL,
        documentRef TEXT,
        qtyIn REAL DEFAULT 0,
        qtyOut REAL DEFAULT 0,
        unitCost REAL DEFAULT 0,
        balanceQty REAL DEFAULT 0,
        balanceAvgCost REAL DEFAULT 0,
        terminalId TEXT,
        syncStatus TEXT DEFAULT 'PENDING',
        syncError TEXT,
        FOREIGN KEY (productId) REFERENCES products(id),
        FOREIGN KEY (warehouseId) REFERENCES warehouses(id)
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_product_warehouse ON inventory_ledger(productId, warehouseId);

    -- TRG_STRICT_WAREHOUSE_VALIDATION
    -- Prevents entries in the ledger if the product is not enabled (exists in product_stocks)
    -- This enforces the "Active Product in Warehouse" rule at the database level.
    CREATE TRIGGER IF NOT EXISTS trg_inventory_ledger_integrity
    BEFORE INSERT ON inventory_ledger
    FOR EACH ROW
    WHEN NOT EXISTS (SELECT 1 FROM product_stocks WHERE productId = NEW.productId AND warehouseId = NEW.warehouseId)
    BEGIN
        SELECT RAISE(ABORT, '🚫 INTEGRIDAD DE ALMACÉN: El artículo no está habilitado para operar en el almacén especificado.');
    END;

    -- AUDIT SYSTEM (WMS)
    CREATE TABLE IF NOT EXISTS audit_sessions (
        id TEXT PRIMARY KEY,
        warehouseId TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        closedAt TEXT,
        status TEXT DEFAULT 'OPEN', -- OPEN, CLOSED, CANCELLED
        method TEXT, -- ABSOLUTE, RECONCILED
        notes TEXT,
        FOREIGN KEY (warehouseId) REFERENCES warehouses(id)
    );

    CREATE TABLE IF NOT EXISTS audit_items (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        productId TEXT NOT NULL,
        countedQty REAL DEFAULT 0,
        systemQtyAtStart REAL DEFAULT 0, -- Snapshot for reference
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (sessionId) REFERENCES audit_sessions(id),
        FOREIGN KEY (productId) REFERENCES products(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_audit_items_session ON audit_items(sessionId);

    -- Optimistic Locking columns
    -- Try/Catch is not possible in .exec(), so we use a safe approach or separate statements
    -- For better-sqlite3, we can just run these separately and ignore errors if column exists
`);

ensureColumn('currency_audit_logs', 'source', 'TEXT');

// Claim de auditoría: una sola PDA puede tener el almacén en conteo.
for (const [column, definition] of [
    ['deviceId', 'TEXT'],
    ['terminalId', 'TEXT'],
    ['userId', 'TEXT'],
    ['userName', 'TEXT'],
    ['heartbeatAt', 'TEXT'],
    ['expiresAt', 'TEXT'],
    ['takeoverReason', 'TEXT'],
    ['scopeKey', 'TEXT'],
    ['locationLabel', 'TEXT'],
] as const) {
    ensureColumn('audit_sessions', column, definition);
}
ensureIndex('idx_audit_sessions_open_warehouse', 'audit_sessions', ['warehouseId', 'status']);
ensureIndex('idx_audit_sessions_scope', 'audit_sessions', ['scopeKey', 'status']);

try {
    db.exec(`ALTER TABLE products ADD COLUMN version INTEGER DEFAULT 0`);
} catch (e) {
    // Column already exists
}
try {
    db.exec(`ALTER TABLE customers ADD COLUMN version INTEGER DEFAULT 0`);
} catch (e) {
    // Column already exists
}
ensureColumn('customers', 'image', 'TEXT');
ensureColumn('customers', 'imageUrl', 'TEXT');
ensureColumn('customers', 'imageVersion', 'TEXT');
ensureColumn('products', 'production_area_id', 'TEXT');

applyAuditAndScopeColumns();
ensureTransactionSettlementColumns();
ensureSyncIndexes();
backfillAuditColumns();

/**
 * Helper to get a collection (mimics lowdb .get().value())
 */
export const getCollection = (name: string): any[] => {
    try {
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
        if (tableExists) {
            const columns = db.prepare(`PRAGMA table_info(${name})`).all() as any[];
            const hasDataColumn = columns.some(c => c.name === 'data');
            const rows = db.prepare(`SELECT * FROM ${name}`).all() as any[];

            // Define JSON fields for each table
            const jsonFields: Record<string, string[]> = {
                products: ['images', 'attributes', 'variants', 'tariffs', 'stockBalances', 'activeInWarehouses', 'appliedTaxIds', 'warehouseSettings', 'availableModifiers', 'operationalFlags', 'recipeDetails'],
                roles: ['permissions', 'zReportConfig'],
                customers: ['tags', 'addresses'],
                transactions: ['items', 'payments', 'customerSnapshot', 'relatedTransactions'],
                receptions: ['items'],
                z_reports: ['totalsByMethod', 'cashExpected', 'cashCounted', 'cashDiscrepancy', 'stats'],
                users: [], // No JSON fields
                transaction_history: ['items', 'payments', 'customerSnapshot', 'relatedTransactions'],
                rooms: ['data'],
                tables: ['data']
            };

            // Boolean conversion for dedicated tables
            const booleanFields: Record<string, string[]> = {
                roles: ['isSystem'],
                warehouses: ['allowPosSale', 'allowNegativeStock', 'isMain'],
                customers: ['requiresFiscalInvoice', 'prefersEmail', 'isTaxExempt', 'applyChainedTax'],
                transactions: ['isTaxIncluded'],
                transaction_history: ['isTaxIncluded'],
                products: ['hasActivePromotion', 'is_sellable'], // UI flag if present
                parametros_operativos: ['usa_mesas', 'bloqueo_meseros', 'pedir_comensales']
            };

            return rows.map(row => {
                const newRow = { ...row };
                const fieldsToParse = jsonFields[name] || [];

                // Always try to parse 'data' if it exists in schema but not in our explicit map
                if (hasDataColumn && !fieldsToParse.includes('data')) {
                    fieldsToParse.push('data');
                }

                // Parse JSON fields
                fieldsToParse.forEach(field => {
                    if (field in newRow && typeof newRow[field] === 'string' && newRow[field] !== null) {
                        try {
                            newRow[field] = JSON.parse(newRow[field]);
                        } catch (e) {
                            console.warn(`Failed to parse JSON for ${name}.${field} (id=${newRow.id}):`, e);
                            newRow[field] = null;
                        }
                    } else if (field in newRow && newRow[field] === null) {
                        newRow[field] = null;
                    }
                });

                // Flatten 'data' if it exists
                if (hasDataColumn && newRow.data && typeof newRow.data === 'object') {
                    const data = newRow.data;
                    delete newRow.data;
                    return { ...newRow, ...data };
                }

                // Convert Booleans
                const fieldsToConvert = booleanFields[name] || [];
                fieldsToConvert.forEach(field => {
                    if (field in newRow) {
                        // Special case: is_sellable defaults to true if NULL (legacy data support)
                        if (field === 'is_sellable' && (newRow[field] === null || newRow[field] === undefined)) {
                            newRow[field] = true;
                        } else {
                            newRow[field] = newRow[field] === 1;
                        }
                    }
                });

                return newRow;
            });
        } else {
            const setting = db.prepare("SELECT value FROM settings WHERE key=?").get(name) as any;
            return setting ? JSON.parse(setting.value) : [];
        }
    } catch (error) {
        console.error(`Error getting collection ${name}:`, error);
        return [];
    }
};

/**
 * Helper to get a single object (mimics lowdb .get().value() for objects)
 */
export const getSetting = (key: string): any => {
    try {
        const setting = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as any;
        return setting ? JSON.parse(setting.value) : null;
    } catch (error) {
        console.error(`Error getting setting ${key}:`, error);
        return null;
    }
};

/**
 * Helper to save/update a setting
 */
export const saveSetting = (key: string, value: any) => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
};
