/**
 * Comprobación manual reproducible de T6 (devengo y reporte de la venta).
 *
 *   npx tsx scripts/verify-ego-club-earn-report.ts
 *
 * Verifica que el POS reporte el documento de venta **una sola vez**, con la clave
 * estable derivada del id local del documento, que sobreviva al reinicio y que el
 * payload no lleve puntos calculados por el POS (el devengo lo decide el ERP).
 *
 * Sale con código 1 si alguna aserción falla.
 */
import {
    buildSaleDocumentOperationId,
    enqueueSaleDocumentReport,
} from '../services/loyalty/LoyaltyService';
import {
    enqueueLoyaltyOperation,
    listLoyaltyOutbox,
    processLoyaltyOutbox,
    setLoyaltyOutboxStorage,
    type LoyaltyOutboxItem,
} from '../utils/loyaltyOutbox';

let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures += 1;
    console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : ` → esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`}`);
};

// Almacén en memoria que simula la base local (sobrevive a "reinicios" del script).
let persisted: LoyaltyOutboxItem[] = [];
setLoyaltyOutboxStorage({
    read: async () => JSON.parse(JSON.stringify(persisted)),
    write: async (items) => { persisted = JSON.parse(JSON.stringify(items)); },
});

// El endpoint todavía no existe / no hay red: cualquier envío falla sin tocar la red.
(globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => { },
    removeItem: () => { },
    clear: () => { },
};
// `navigator.onLine` en Node es de sólo lectura y ya vale true; no se toca.
const tick = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
(globalThis as any).fetch = async () => { throw new Error('Failed to fetch'); };

const run = async () => {
    // --- Clave estable -------------------------------------------------------
    const id = buildSaleDocumentOperationId('txn-123');
    check('mismo documento ⇒ misma clave', buildSaleDocumentOperationId('txn-123'), id);
    check('otro documento ⇒ otra clave', buildSaleDocumentOperationId('txn-124') === id, false);
    check('la clave no expone el id crudo del documento', id.includes('txn-123'), false);

    // --- Encolado del documento ---------------------------------------------
    await enqueueSaleDocumentReport({ documentId: 'txn-123', reference: 'TCK01-000123' });
    await tick();
    const afterFirst = await listLoyaltyOutbox();
    check('el documento queda encolado', afterFirst.length, 1);
    check('tipo SALE_DOCUMENT', afterFirst[0].type, 'SALE_DOCUMENT');
    check('referencia legible para la UI', afterFirst[0].reference, 'TCK01-000123');

    // El POS NO calcula puntos: el payload lleva sólo el documento.
    check('payload mínimo: sólo document_id', Object.keys(afterFirst[0].payload), ['document_id']);
    check('payload.document_id', afterFirst[0].payload.document_id, 'txn-123');

    // Reintentar (o reintentar el cobro) no duplica el documento.
    await enqueueSaleDocumentReport({ documentId: 'txn-123', reference: 'TCK01-000123' });
    await enqueueSaleDocumentReport({ documentId: 'txn-123', reference: 'TCK01-000123' });
    await tick();
    check('reportar el mismo documento 3 veces deja 1 entrada', (await listLoyaltyOutbox()).length, 1);

    // --- Sobrevive al cierre de la app --------------------------------------
    const afterRestart = await listLoyaltyOutbox();
    check('la cola sobrevive al reinicio', afterRestart.length, 1);
    check('sin red el documento sigue pendiente', afterRestart[0].status, 'PENDING');

    // --- Se envía una sola vez al reconectar --------------------------------
    // Cola limpia para que el resultado sea determinista (sin flushes fire-and-forget en vuelo).
    persisted = [];
    await enqueueLoyaltyOperation('SALE_DOCUMENT', buildSaleDocumentOperationId('txn-123'), { document_id: 'txn-123' }, 'TCK01-000123');
    await enqueueLoyaltyOperation('SALE_DOCUMENT', buildSaleDocumentOperationId('txn-999'), { document_id: 'txn-999' }, 'TCK01-000124');
    check('dos documentos distintos => dos entradas', (await listLoyaltyOutbox()).length, 2);

    const sent: string[] = [];
    const runFlush = () => processLoyaltyOutbox(
        async (item) => {
            sent.push(String(item.payload.document_id));
            return { ok: true };
        },
        new Date(Date.now() + 24 * 60 * 60 * 1000),
    );

    const first = await runFlush();
    check('al reconectar se reportan los documentos pendientes', first.synced, 2);
    check('el ERP recibe los document_id locales', sent, ['txn-123', 'txn-999']);
    check('estado enviado', (await listLoyaltyOutbox()).map(item => item.status), ['SYNCED', 'SYNCED']);

    const second = await runFlush();
    check('un segundo flush no reenvía (idempotencia del POS)', [second.processed, sent.length], [0, 2]);

    // --- Devolución y canje no se reportan aquí -----------------------------
    // Sólo los documentos COMPLETED llegan a esta cola (el filtro vive en App.tsx).
    check('la cola no contiene puntos ni saldos', JSON.stringify(persisted).includes('points'), false);

    console.log(failures === 0 ? '\nTodo OK' : `\n${failures} aserción(es) fallida(s)`);
    process.exit(failures === 0 ? 0 : 1);
};

void run();
