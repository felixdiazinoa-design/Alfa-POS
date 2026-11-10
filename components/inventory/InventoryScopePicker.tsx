import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, MapPin, Plus } from 'lucide-react';
import { db } from '../../utils/db';
import { InventoryLocation } from '../../types';
import {
  INVENTORY_WHOLE_WAREHOUSE_LABEL,
  normalizeInventoryScopeLabel,
} from '../../utils/inventoryScope';

interface InventoryScopePickerProps {
  warehouseId?: string;
  warehouseName?: string;
  onConfirm: (scope: { label: string | null; locationId: string | null }) => void;
  onCancel: () => void;
}

/**
 * Elige la ubicación (zona) que se va a contar antes de reclamar el bloqueo.
 * Sin ubicación se cuenta el almacén completo. El catálogo es local; el bloqueo
 * se identifica por el nombre normalizado para que dos PDAs coincidan.
 */
const InventoryScopePicker: React.FC<InventoryScopePickerProps> = ({
  warehouseId,
  warehouseName,
  onConfirm,
  onCancel,
}) => {
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newLocation, setNewLocation] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const all = (await db.get('locations' as any)) as InventoryLocation[];
        if (cancelled) return;
        setLocations(
          (all || [])
            .filter((location) => location.warehouseId === warehouseId)
            .filter((location) => location.active !== false)
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch (error) {
        console.warn('[InventoryScope] No se pudo cargar el catálogo de ubicaciones:', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [warehouseId]);

  const availableLocations = useMemo(() => locations, [locations]);

  const createLocation = useCallback(async () => {
    const name = newLocation.trim();
    if (!name || !warehouseId) return;

    const duplicated = availableLocations.some(
      (location) => normalizeInventoryScopeLabel(location.name) === normalizeInventoryScopeLabel(name),
    );
    if (duplicated) {
      setNewLocation('');
      return;
    }

    const location: InventoryLocation = {
      id: `LOC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      warehouseId,
      name,
      type: 'ZONA',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setIsCreating(true);
    try {
      await db.saveDocument('locations' as any, location as any);
      setLocations((current) => [...current, location].sort((a, b) => a.name.localeCompare(b.name)));
      setNewLocation('');
    } catch (error) {
      console.warn('[InventoryScope] No se pudo crear la ubicación:', error);
    } finally {
      setIsCreating(false);
    }
  }, [availableLocations, newLocation, warehouseId]);

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto w-full max-w-md space-y-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-black uppercase text-gray-400">Almacén</p>
              <h1 className="text-lg font-black text-gray-900">{warehouseName || 'Seleccionado'}</h1>
            </div>
            <button
              onClick={onCancel}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border-2 border-gray-200 bg-white px-3 text-xs font-black text-gray-700"
            >
              <ArrowLeft size={16} /> Volver
            </button>
          </div>
          <p className="mt-3 text-xs font-bold text-gray-500">
            ¿Dónde vas a contar? Solo una PDA puede contar la misma ubicación a la vez.
          </p>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => onConfirm({ label: null, locationId: null })}
            className="flex w-full items-center justify-between rounded-2xl border-2 border-blue-200 bg-blue-50 p-4 text-left active:scale-[0.99]"
          >
            <span>
              <span className="block text-sm font-black text-blue-900">{INVENTORY_WHOLE_WAREHOUSE_LABEL}</span>
              <span className="block text-[11px] font-bold text-blue-600">Bloquea el almacén completo</span>
            </span>
            <Check size={18} className="text-blue-700" />
          </button>

          {isLoading && (
            <div className="rounded-2xl border border-gray-200 bg-white p-4 text-center text-xs font-bold text-gray-400">
              Cargando ubicaciones…
            </div>
          )}

          {!isLoading && availableLocations.map((location) => (
            <button
              key={location.id}
              onClick={() => onConfirm({ label: location.name, locationId: location.id })}
              className="flex w-full items-center justify-between rounded-2xl border-2 border-gray-200 bg-white p-4 text-left active:scale-[0.99]"
            >
              <span className="flex items-center gap-2">
                <MapPin size={16} className="text-gray-400" />
                <span>
                  <span className="block text-sm font-black text-gray-900">{location.name}</span>
                  {location.code && (
                    <span className="block text-[11px] font-bold text-gray-400">{location.code}</span>
                  )}
                </span>
              </span>
              <Check size={18} className="text-gray-300" />
            </button>
          ))}

          {!isLoading && availableLocations.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-center text-[11px] font-bold text-gray-500">
              Este almacén no tiene ubicaciones registradas. Puedes crear una aquí abajo.
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase text-gray-400">Nueva ubicación</p>
          <div className="mt-2 flex gap-2">
            <input
              value={newLocation}
              onChange={(event) => setNewLocation(event.target.value)}
              placeholder="Ej: Pasillo A"
              className="min-h-[48px] flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-200"
            />
            <button
              onClick={createLocation}
              disabled={isCreating || !newLocation.trim()}
              className="inline-flex min-h-[48px] items-center gap-1 rounded-xl bg-gray-900 px-4 text-xs font-black text-white disabled:opacity-40"
            >
              <Plus size={16} /> Crear
            </button>
          </div>
          <p className="mt-2 text-[11px] font-bold text-gray-400">
            Se guarda solo en esta PDA. El bloqueo usa el nombre para coincidir con otras cajas.
          </p>
        </div>
      </div>
    </div>
  );
};

export default InventoryScopePicker;
