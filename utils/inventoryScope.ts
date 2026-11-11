/**
 * Alcance del conteo de inventario.
 *
 * El bloqueo de conteo es por `almacén + ubicación`. La ubicación se identifica
 * por su nombre normalizado (no por un id local) para que dos PDAs con catálogos
 * independientes colisionen igual al escribir la misma zona.
 */

export const INVENTORY_WHOLE_WAREHOUSE_LABEL = 'Todo el almacén';

/** Minúsculas, sin acentos y con espacios colapsados. */
export const normalizeInventoryScopeLabel = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * `warehouseId::<zona normalizada>`, o `warehouseId::*` para el almacén completo.
 */
export const buildInventoryScopeKey = (warehouseId: unknown, locationLabel: unknown): string => {
  const warehouse = String(warehouseId ?? '').trim();
  const label = normalizeInventoryScopeLabel(locationLabel);
  return `${warehouse}::${label || '*'}`;
};

export const isWholeWarehouseScope = (locationLabel: unknown): boolean => (
  normalizeInventoryScopeLabel(locationLabel) === ''
);

/** Etiqueta para mostrar: la zona o el texto de almacén completo. */
export const inventoryScopeDisplayLabel = (locationLabel: unknown): string => (
  String(locationLabel ?? '').trim() || INVENTORY_WHOLE_WAREHOUSE_LABEL
);
