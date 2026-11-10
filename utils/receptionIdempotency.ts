/**
 * Idempotencia y deduplicación de recepciones de mercancía.
 *
 * La recepción móvil (PDA) puede reenviar el mismo documento por varias razones:
 * la app se reinicia entre aplicar y marcar la cola, el operador pulsa dos veces
 * "Finalizar", o el documento sigue visible porque la recepción offline todavía
 * no se aplicó. Sin una clave estable, cada reenvío suma stock otra vez.
 *
 * Diseño:
 * - La clave se deriva del documento + usuario + líneas (esperado y recibido).
 *   Es determinista: el mismo envío repetido produce la misma clave.
 * - Incluir `expectedQty` evita bloquear una segunda entrega legítima del mismo
 *   documento: al aplicarse la primera, el remanente cambia y la clave cambia.
 * - La clave solo es válida dentro de una ventana corta; pasado ese tiempo un
 *   envío con el mismo contenido se considera una recepción nueva.
 * - El dedupe de cola bloquea el documento mientras exista una recepción
 *   pendiente de sincronizar, para que no se pueda encolar dos veces.
 */

export type ReceptionDocumentType = 'PURCHASE_ORDER' | 'TRANSFER_IN';

export interface ReceptionFingerprintLine {
  productId: string;
  variantSku?: string | null;
  expectedQty: number;
  receivedQty: number;
}

export interface ReceptionFingerprintInput {
  documentType: ReceptionDocumentType;
  documentId: string;
  receivedBy: string;
  items: ReceptionFingerprintLine[];
}

export interface ReceptionIdempotencyRecord {
  id: string;
  receptionId: string;
  documentType: ReceptionDocumentType;
  documentId: string;
  receivedBy: string;
  terminalId?: string;
  createdAt: string;
}

export interface QueuedReceptionLike {
  status?: string;
  documentType?: string | null;
  documentId?: string | null;
  payload?: {
    documentType?: string | null;
    documentId?: string | null;
    idempotencyKey?: string;
  } | null;
}

/** Colección de índice: `id` = clave de idempotencia, valor = recepción aplicada. */
export const RECEPTION_IDEMPOTENCY_COLLECTION = 'receptionIdempotency';

/** Ventana en la que un reenvío idéntico se considera el mismo intento. */
export const RECEPTION_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

const ACTIVE_QUEUE_STATUSES = new Set(['PENDING', 'ERROR', 'SYNCING']);
const NON_RECEPTION_DOCUMENT_TYPES = new Set(['INVENTORY_COUNT']);

const normalizeText = (value: unknown): string => String(value ?? '').trim();

const normalizeQuantity = (value: unknown): string => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '0.0000';
  return parsed.toFixed(4);
};

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const SECOND_LANE_SEED = 0x9e3779b9;

const hashLane = (text: string, seed: number): string => {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/** Hash estable de 64 bits (dos carriles FNV-1a). Sin async ni dependencias. */
export const stableReceptionHash = (text: string): string => (
  `${hashLane(text, FNV_OFFSET_BASIS)}${hashLane(text, SECOND_LANE_SEED)}`
);

const lineFingerprint = (line: ReceptionFingerprintLine): string => [
  normalizeText(line.productId),
  normalizeText(line.variantSku),
  normalizeQuantity(line.expectedQty),
  normalizeQuantity(line.receivedQty),
].join('::');

/**
 * Clave de idempotencia de una recepción. Solo considera líneas con cantidad
 * recibida > 0: agregar líneas en cero no cambia la recepción real.
 */
export const buildReceptionIdempotencyKey = (input: ReceptionFingerprintInput): string => {
  const lines = (input.items || [])
    .filter((line) => Number(line.receivedQty) > 0)
    .map(lineFingerprint)
    .sort();

  const material = [
    'RECEPTION_V1',
    normalizeText(input.documentType),
    normalizeText(input.documentId),
    normalizeText(input.receivedBy),
    ...lines,
  ].join('|');

  return `RID-${stableReceptionHash(material)}`;
};

/** ¿El registro de idempotencia sigue dentro de su ventana de validez? */
export const isReceptionIdempotencyFresh = (
  createdAt: unknown,
  now: number = Date.now(),
  windowMs: number = RECEPTION_IDEMPOTENCY_WINDOW_MS,
): boolean => {
  const created = Date.parse(normalizeText(createdAt));
  if (!Number.isFinite(created)) return false;
  return Math.abs(now - created) <= windowMs;
};

export const receptionDocumentKey = (documentType: unknown, documentId: unknown): string => (
  `${normalizeText(documentType)}:${normalizeText(documentId)}`
);

const queuedItemDocument = (item: QueuedReceptionLike): { type: string; id: string } => ({
  type: normalizeText(item.documentType || item.payload?.documentType),
  id: normalizeText(item.documentId || item.payload?.documentId),
});

const isActiveQueueItem = (item: QueuedReceptionLike): boolean => (
  ACTIVE_QUEUE_STATUSES.has(normalizeText(item.status).toUpperCase())
);

/** Busca una recepción pendiente de sincronizar para el mismo documento. */
export const findQueuedReceptionForDocument = (
  queue: QueuedReceptionLike[] | null | undefined,
  documentType: ReceptionDocumentType,
  documentId: string,
): QueuedReceptionLike | null => {
  const target = receptionDocumentKey(documentType, documentId);

  for (const item of queue || []) {
    if (!item || !isActiveQueueItem(item)) continue;
    const { type, id } = queuedItemDocument(item);
    if (!type || NON_RECEPTION_DOCUMENT_TYPES.has(type)) continue;
    if (receptionDocumentKey(type, id) === target) return item;
  }

  return null;
};

/**
 * Documentos bloqueados por la cola (claves `TIPO:id`). La recepción móvil los
 * oculta para que no se puedan volver a recibir mientras esperan sincronizar.
 */
export const buildBlockedReceptionDocumentKeys = (
  queue: QueuedReceptionLike[] | null | undefined,
): string[] => {
  const keys = new Set<string>();

  for (const item of queue || []) {
    if (!item || !isActiveQueueItem(item)) continue;
    const { type, id } = queuedItemDocument(item);
    if (!type || !id || NON_RECEPTION_DOCUMENT_TYPES.has(type)) continue;
    keys.add(receptionDocumentKey(type, id));
  }

  return Array.from(keys).sort();
};

/** Error de negocio: el documento ya tiene una recepción esperando sincronizar. */
export class DuplicateReceptionError extends Error {
  readonly code = 'RECEPTION_ALREADY_QUEUED';

  constructor(message = 'Ya existe una recepción pendiente de sincronización para este documento.') {
    super(message);
    this.name = 'DuplicateReceptionError';
  }
}

export const isDuplicateReceptionError = (error: unknown): boolean => (
  Boolean(error) && (error as { code?: string }).code === 'RECEPTION_ALREADY_QUEUED'
);
