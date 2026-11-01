/**
 * Comprobación manual reproducible de T4 (alta de socio con cola offline).
 *
 *   npx tsx scripts/verify-ego-club-enroll.ts
 *
 * Cubre la parte pura (validaciones, contrato del payload, claves idempotentes) y la
 * lógica de la cola con un almacén en memoria que simula la persistencia local:
 * sobrevive a "reiniciar la app" (se re-lee del mismo almacén) y no duplica el envío.
 *
 * Sale con código 1 si alguna aserción falla.
 */
import {
    buildEnrollOperationId,
    buildEnrollPayload,
    calculateAge,
    isAdult,
    isValidCedula,
    normalizeCedula,
    normalizePhone,
    validateEnrollInput,
    type LoyaltyEnrollInput,
} from '../services/loyalty/LoyaltyService';
import {
    computeNextAttempt,
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

const validInput: LoyaltyEnrollInput = {
    nombre: 'Ana Pérez',
    cedula: '001-1234567-8',
    celular: '+1 (809) 555-0101',
    email: 'Ana@Correo.com ',
    birthDate: '1990-05-20',
    registrationStoreId: 'store-01',
    consents: [
        { type: 'TERMS', granted: true },
        { type: 'PRIVACY', granted: true },
        { type: 'EMAIL', granted: false },
        { type: 'WHATSAPP', granted: false },
    ],
};

// --- Validaciones ------------------------------------------------------------
check('cédula con guiones se normaliza a 11 dígitos', normalizeCedula(validInput.cedula), '00112345678');
check('cédula válida aceptada', isValidCedula(validInput.cedula), true);
check('cédula de 10 dígitos rechazada', isValidCedula('0011234567'), false);
check('celular con +1 y formato se normaliza', normalizePhone(validInput.celular), '8095550101');
check('edad calculada', calculateAge('1990-05-20', '2026-06-01'), 36);
check('menor de 18 rechazado', isAdult('2010-01-01', '2026-06-01'), false);
check('18 años cumplidos el mismo día se aceptan', isAdult('2008-06-01', '2026-06-01'), true);
check('fecha imposible rechazada', calculateAge('1990-02-31'), null);

check('alta válida', validateEnrollInput(validInput).valid, true);
check('alta sin nombre y apellido falla', validateEnrollInput({ ...validInput, nombre: 'Ana' }).errors.nombre !== undefined, true);
check('alta sin cédula válida falla', validateEnrollInput({ ...validInput, cedula: '123' }).errors.cedula !== undefined, true);
check('alta sin correo válido falla', validateEnrollInput({ ...validInput, email: 'ana@' }).errors.email !== undefined, true);
check('alta sin tienda de registro falla', validateEnrollInput({ ...validInput, registrationStoreId: '' }).errors.registrationStoreId !== undefined, true);
check('alta sin términos falla', validateEnrollInput({
    ...validInput,
    consents: [{ type: 'PRIVACY', granted: true }],
}).errors.consents !== undefined, true);
check('alta con privacidad denegada falla', validateEnrollInput({
    ...validInput,
    consents: [{ type: 'TERMS', granted: true }, { type: 'PRIVACY', granted: false }],
}).errors.consents !== undefined, true);
check('marketing opcional no invalida el alta', validateEnrollInput({
    ...validInput,
    consents: [{ type: 'TERMS', granted: true }, { type: 'PRIVACY', granted: true }],
}).valid, true);

// --- Contrato del payload ----------------------------------------------------
const payload = buildEnrollPayload(validInput) as Record<string, any>;
check('payload: cédula sólo dígitos', payload.cedula, '00112345678');
check('payload: celular sin código de país', payload.celular, '8095550101');
check('payload: correo normalizado', payload.email, 'ana@correo.com');
check('payload: fecha de nacimiento en birth_date', payload.birth_date, '1990-05-20');
check('payload: tienda en registration_store_id', payload.registration_store_id, 'store-01');
check('payload: consentimientos como {type, granted}', payload.consents[0], { type: 'TERMS', granted: true });

// --- Claves idempotentes -----------------------------------------------------
const idA = buildEnrollOperationId('001-1234567-8');
const idB = buildEnrollOperationId('00112345678');
const idC = buildEnrollOperationId('402-0000000-1');
check('la misma cédula produce la misma clave (aunque cambie el formato)', idA, idB);
check('cédulas distintas producen claves distintas', idA === idC, false);

// --- Backoff -----------------------------------------------------------------
const base = new Date('2026-01-01T00:00:00.000Z');
check('primer reintento a 5s', computeNextAttempt(1, base), '2026-01-01T00:00:05.000Z');
check('segundo reintento a 15s', computeNextAttempt(2, base), '2026-01-01T00:00:15.000Z');
check('tercer reintento a 45s', computeNextAttempt(3, base), '2026-01-01T00:00:45.000Z');
check('el backoff tiene tope de 30m', computeNextAttempt(30, base), '2026-01-01T00:30:00.000Z');

// --- Cola persistente + envío único -----------------------------------------
// Almacén en memoria que simula la base local: si la "app se cierra", el contenido
// sigue ahí y una nueva lectura lo recupera.
let persisted: LoyaltyOutboxItem[] = [];
setLoyaltyOutboxStorage({
    read: async () => JSON.parse(JSON.stringify(persisted)),
    write: async (items) => { persisted = JSON.parse(JSON.stringify(items)); },
});

const run = async () => {
    // Mismo alta dos veces: una sola entrada en la cola.
    await enqueueLoyaltyOperation('ENROLL', idA, payload, 'Ana Pérez');
    await enqueueLoyaltyOperation('ENROLL', idA, payload, 'Ana Pérez');
    check('dos altas de la misma persona generan una sola entrada', persisted.length, 1);

    // Sin red: el envío falla y la entrada queda pendiente con reintento programado.
    const offline: string[] = [];
    const offlineResult = await processLoyaltyOutbox(async () => {
        offline.push('intento');
        return { ok: false, error: 'Failed to fetch' };
    });
    check('sin red no se marca como enviada', (await listLoyaltyOutbox())[0].status, 'PENDING');
    check('se registra el fallo', offlineResult.failed, 1);
    check('intentos incrementados', (await listLoyaltyOutbox())[0].attempts, 1);
    check('queda una hora de reintento programada', Boolean((await listLoyaltyOutbox())[0].nextAttemptAt), true);

    // Antes de esa hora no se reintenta (evita martillear el ERP).
    const tooEarly = await processLoyaltyOutbox(async () => ({ ok: true }));
    check('no reintenta antes del backoff', tooEarly.processed, 0);

    // "Se cierra la app" y se reabre: la entrada sigue en el almacén.
    const afterRestart = await listLoyaltyOutbox();
    check('la cola sobrevive al reinicio', afterRestart.length, 1);
    check('el estado pendiente sobrevive al reinicio', afterRestart[0].status, 'PENDING');

    // Al reconectar (ya vencido el backoff) se envía una sola vez.
    const sent: string[] = [];
    const online = await processLoyaltyOutbox(async (item) => { sent.push(item.id); return { ok: true }; }, new Date(Date.now() + 10 * 60 * 1000));
    check('al reconectar se envía una sola vez', sent.length, 1);
    check('resultado del flush: 1 enviado', online.synced, 1);
    check('estado final enviado', (await listLoyaltyOutbox())[0].status, 'SYNCED');

    // Un segundo flush no reenvía nada.
    const again = await processLoyaltyOutbox(async (item) => { sent.push(item.id); return { ok: true }; });
    check('no se reenvía lo ya sincronizado', again.processed, 0);
    check('total de envíos sigue siendo 1', sent.length, 1);

    console.log(failures === 0 ? '\nTodo OK' : `\n${failures} aserción(es) fallida(s)`);
    process.exit(failures === 0 ? 0 : 1);
};

void run();
