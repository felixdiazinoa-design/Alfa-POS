import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ClipboardList, Lock, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import {
  BusinessConfig,
  InventoryAuditLog,
  InventoryCountSession,
  InventoryLedgerEntry,
  InventorySnapshot,
  InventorySnapshotItem,
  Product,
  RoleDefinition,
  User,
  Warehouse
} from '../../types';
import { db } from '../../utils/db';
import { getWarehouseScopedNumber, isProductWarehouseActive } from '../../utils/masterIdentity';

interface InventoryAuditClosureProps {
  warehouses: Warehouse[];
  products: Product[];
  config: BusinessConfig;
  currentUser: User | null;
  roles: RoleDefinition[];
  terminalId?: string;
}

type AuditRowStatus = 'FALTANTE' | 'SOBRANTE' | 'SIN_CONTAR' | 'OK';

type AuditRow = {
  productId: string;
  productName: string;
  category?: string;
  systemQty: number;
  physicalQty?: number;
  diffQty?: number;
  avgCost: number;
  discrepancyValue: number;
  status: AuditRowStatus;
};

const toInputDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseCutoffEnd = (dateInput: string): Date => new Date(`${dateInput}T23:59:59.999`);

const getSnapshotLockTime = (snapshot: InventorySnapshot): number => {
  const lockRef = snapshot.lockDate || snapshot.cutoffDate || snapshot.closedAt || snapshot.createdAt;
  return new Date(lockRef).getTime();
};

const InventoryAuditClosure: React.FC<InventoryAuditClosureProps> = ({
  warehouses,
  products,
  currentUser
}) => {
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(warehouses[0]?.id || '');
  const [sessions, setSessions] = useState<InventoryCountSession[]>([]);
  const [snapshots, setSnapshots] = useState<InventorySnapshot[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [cutoffDate, setCutoffDate] = useState<string>(toInputDate(new Date().toISOString()));
  const [isClosing, setIsClosing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const warehouseNameById = useMemo(() => {
    const map = new Map<string, string>();
    warehouses.forEach(w => map.set(w.id, w.name));
    return map;
  }, [warehouses]);

  const loadData = async (warehouseId: string) => {
    if (!warehouseId) return;

    try {
      // 1. Load Legacy Data
      const [storedSessions, storedSnapshots] = await Promise.all([
        db.get('inventoryCounts') as Promise<InventoryCountSession[]>,
        db.get('inventorySnapshots') as Promise<InventorySnapshot[]>
      ]);

      // 2. Load New API Data
      const response = await fetch(`http://localhost:3001/api/audit/history/${warehouseId}`);
      if (!response.ok) throw new Error('Failed to fetch audit history');

      const apiSessions: any[] = await response.json();

      // 3. Map API Data to InventoryCountSession
      const mappedSessions: InventoryCountSession[] = apiSessions.map(s => ({
        id: s.id,
        warehouseId: s.warehouseId,
        warehouseName: warehouseNameById.get(s.warehouseId) || 'Unknown',
        createdAt: s.startedAt,
        finalizedAt: s.closedAt,
        status: ['CLOSED', 'CANCELLED', 'EXPIRED', 'TAKEN_OVER'].includes(String(s.status)) ? 'FINALIZED' : 'OPEN',
        createdBy: 'SYSTEM', // or populate from parsing s.notes if strictly needed
        createdByName: 'Sistema',
        items: s.items.map((item: any) => {
          const product = products.find(p => p.id === item.productId);
          return {
            productId: item.productId,
            productName: product?.name || 'Unknown Product',
            category: product?.category,
            systemQty: item.systemQtyAtStart,
            countedQty: item.countedQty,
            difference: item.countedQty - item.systemQtyAtStart
          };
        })
      }));

      // 4. Merge (Prefer API if collision, though IDs should be UUIDs vs timestamps)
      const specificLegacy = (storedSessions || []).filter(s => s.warehouseId === warehouseId);
      const combined = [...mappedSessions, ...specificLegacy];

      // Deduplicate by ID just in case
      const unique = Array.from(new Map(combined.map(s => [s.id, s])).values());

      setSessions(unique);
      setSnapshots(storedSnapshots || []);
    } catch (error) {
      console.error("Error loading audit data:", error);
    }
  };

  useEffect(() => {
    if (selectedWarehouseId) {
      loadData(selectedWarehouseId);
    }
  }, [selectedWarehouseId]);

  useEffect(() => {
    if (!selectedWarehouseId && warehouses[0]?.id) {
      setSelectedWarehouseId(warehouses[0].id);
    }
  }, [warehouses, selectedWarehouseId]);

  const warehouseSessions = useMemo(() => {
    const normalizedSearch = searchFilter.trim().toLowerCase();

    return sessions
      .filter(session => {
        // Already filtered by selectedWarehouseId in loadData, but safe to keep check or just check ID match
        if (selectedWarehouseId && session.warehouseId !== selectedWarehouseId) return false;

        if (dateFilter && toInputDate(session.createdAt) !== dateFilter) return false;

        if (normalizedSearch) {
          const haystack = `${session.id} ${session.createdByName || ''} ${session.warehouseName || ''}`.toLowerCase();
          if (!haystack.includes(normalizedSearch)) return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [sessions, selectedWarehouseId, dateFilter, searchFilter]);

  useEffect(() => {
    if (warehouseSessions.length === 0) {
      setSelectedSessionId('');
      return;
    }

    if (!warehouseSessions.some(s => s.id === selectedSessionId)) {
      setSelectedSessionId(warehouseSessions[0].id);
    }
  }, [warehouseSessions, selectedSessionId]);

  const selectedSession = useMemo(
    () => sessions.find(s => s.id === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );

  const auditRows = useMemo<AuditRow[]>(() => {
    if (!selectedSession) return [];

    const countByProduct = new Map(selectedSession.items.map(item => [item.productId, item]));
    const baselineRows = selectedSession.systemSnapshot?.length
      ? selectedSession.systemSnapshot.map(base => ({
        productId: base.productId,
        productName: base.productName,
        category: base.category,
        systemQty: Number(base.systemQty || 0),
        avgCost: Number(base.avgCost || 0)
      }))
      : selectedSession.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        category: item.category,
        systemQty: Number(item.systemQty || 0),
        avgCost: Number(products.find(p => p.id === item.productId)?.cost || 0)
      }));

    const seen = new Set<string>();
    const rows: AuditRow[] = [];

    for (const base of baselineRows) {
      seen.add(base.productId);
      const counted = countByProduct.get(base.productId);
      const physicalQty = counted ? Number(counted.countedQty || 0) : undefined;
      const diffQty = physicalQty === undefined ? undefined : physicalQty - base.systemQty;

      let status: AuditRowStatus = 'OK';
      if (physicalQty === undefined) status = 'SIN_CONTAR';
      else if (physicalQty < base.systemQty) status = 'FALTANTE';
      else if (physicalQty > base.systemQty) status = 'SOBRANTE';

      const rowAvgCost = Math.max(0, base.avgCost);
      const discrepancyValue = diffQty === undefined ? 0 : Math.abs(diffQty * rowAvgCost);

      rows.push({
        productId: base.productId,
        productName: base.productName,
        category: base.category,
        systemQty: base.systemQty,
        physicalQty,
        diffQty,
        avgCost: base.avgCost,
        discrepancyValue,
        status
      });
    }

    for (const item of selectedSession.items) {
      if (seen.has(item.productId)) continue;
      const avgCost = Number(products.find(p => p.id === item.productId)?.cost || 0);
      const diffQty = Number(item.countedQty || 0) - Number(item.systemQty || 0);
      rows.push({
        productId: item.productId,
        productName: item.productName,
        category: item.category,
        systemQty: Number(item.systemQty || 0),
        physicalQty: Number(item.countedQty || 0),
        diffQty,
        avgCost,
        discrepancyValue: Math.abs(diffQty * Math.max(0, avgCost)),
        status: diffQty < 0 ? 'FALTANTE' : diffQty > 0 ? 'SOBRANTE' : 'OK'
      });
    }

    const order: Record<AuditRowStatus, number> = {
      FALTANTE: 0,
      SOBRANTE: 1,
      SIN_CONTAR: 2,
      OK: 3
    };

    return rows.sort((a, b) => {
      const byStatus = order[a.status] - order[b.status];
      if (byStatus !== 0) return byStatus;
      return a.productName.localeCompare(b.productName);
    });
  }, [selectedSession, products]);

  const auditSummary = useMemo(() => {
    const shortages = auditRows.filter(r => r.status === 'FALTANTE');
    const surplus = auditRows.filter(r => r.status === 'SOBRANTE');
    const uncounted = auditRows.filter(r => r.status === 'SIN_CONTAR');
    const totalDiscrepancy = [...shortages, ...surplus].reduce((sum, row) => sum + row.discrepancyValue, 0);

    return {
      shortages,
      surplus,
      uncounted,
      totalDiscrepancy
    };
  }, [auditRows]);

  const activeLock = useMemo(() => {
    const closed = snapshots
      .filter(s => s.warehouseId === selectedWarehouseId && s.status === 'CLOSED')
      .sort((a, b) => getSnapshotLockTime(b) - getSnapshotLockTime(a));

    return closed[0] || null;
  }, [snapshots, selectedWarehouseId]);

  const recentClosures = useMemo(() => {
    return snapshots
      .filter(s => s.warehouseId === selectedWarehouseId)
      .sort((a, b) => getSnapshotLockTime(b) - getSnapshotLockTime(a))
      .slice(0, 5);
  }, [snapshots, selectedWarehouseId]);

  const handleHardClose = async () => {
    if (!selectedWarehouseId) {
      setStatusMessage('Selecciona un almacén para ejecutar el cierre.');
      return;
    }
    if (!cutoffDate) {
      setStatusMessage('Selecciona una fecha de corte válida.');
      return;
    }

    const cutoffEnd = parseCutoffEnd(cutoffDate);
    if (Number.isNaN(cutoffEnd.getTime())) {
      setStatusMessage('Fecha de corte inválida.');
      return;
    }

    if (activeLock && cutoffEnd.getTime() <= getSnapshotLockTime(activeLock)) {
      const blockedBy = activeLock.lockDate || activeLock.cutoffDate || activeLock.closedAt;
      setStatusMessage(`No se puede cerrar una fecha <= ${new Date(blockedBy).toLocaleDateString()}.`);
      return;
    }

    setIsClosing(true);
    setStatusMessage(null);

    try {
      const nowIso = new Date().toISOString();
      const ledger = (await db.get('inventoryLedger')) as InventoryLedgerEntry[] || [];

      const warehouseProducts = products.filter(p => {
        if (selectedWarehouseId && !isProductWarehouseActive(p, selectedWarehouseId, warehouses)) return false;
        return true;
      });

      const items: InventorySnapshotItem[] = warehouseProducts.map(product => {
        const entries = ledger
          .filter(entry => entry.warehouseId === selectedWarehouseId && entry.productId === product.id)
          .filter(entry => new Date(entry.createdAt).getTime() <= cutoffEnd.getTime())
          .sort((a, b) => {
            const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            if (diff !== 0) return diff;
            return a.id.localeCompare(b.id);
          });

        let qty = 0;
        let avgCost = Number(product.cost || 0);

        if (entries.length === 0) {
          qty = getWarehouseScopedNumber(product.stockBalances || {}, selectedWarehouseId, warehouses, 0);
        } else {
          for (const entry of entries) {
            const qtyIn = Number(entry.qtyIn || 0);
            const qtyOut = Number(entry.qtyOut || 0);

            if (qtyIn > 0) {
              const prevQty = qty;
              const prevValue = prevQty * avgCost;
              const inCost = Number(entry.unitCost || avgCost || 0);
              qty += qtyIn;
              avgCost = qty > 0 ? (prevValue + (qtyIn * inCost)) / qty : inCost;
            }

            if (qtyOut > 0) {
              qty -= qtyOut;
            }
          }
        }

        const value = qty * avgCost;

        return {
          productId: product.id,
          productName: product.name,
          category: product.category,
          warehouseId: selectedWarehouseId,
          qty,
          avgCost,
          value
        };
      });

      const snapshot: InventorySnapshot = {
        id: `SNAP-${Date.now()}`,
        label: `Cierre ${cutoffDate} - ${warehouseNameById.get(selectedWarehouseId) || selectedWarehouseId}`,
        warehouseId: selectedWarehouseId,
        createdAt: nowIso,
        closedAt: nowIso,
        cutoffDate: new Date(`${cutoffDate}T00:00:00.000`).toISOString(),
        lockDate: cutoffEnd.toISOString(),
        immutable: true,
        status: 'CLOSED',
        createdBy: currentUser?.id,
        createdByName: currentUser?.name,
        items,
        totalValue: items.reduce((sum, item) => sum + item.value, 0)
      };

      await db.saveDocument('inventorySnapshots' as any, snapshot);

      const closeLog: InventoryAuditLog = {
        id: `AUDLOG-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sessionId: snapshot.id,
        warehouseId: selectedWarehouseId,
        action: 'CLOSE',
        createdAt: nowIso,
        createdBy: currentUser?.id,
        createdByName: currentUser?.name,
        reason: `Cierre de inventario con fecha de corte ${cutoffDate}`
      };
      await db.saveDocument('inventoryAuditLogs' as any, closeLog);

      await loadData(selectedWarehouseId);
      setStatusMessage('Cierre completado. Hard lock activo para fechas <= al corte seleccionado.');
    } catch (error: any) {
      setStatusMessage(error?.message || 'No fue posible completar el cierre.');
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-4 pb-4 overflow-hidden">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ClipboardList className="text-emerald-600" size={18} />
          <h2 className="text-base font-black text-gray-900">Auditoría de Inventarios (Histórico)</h2>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <select
            value={selectedWarehouseId}
            onChange={(e) => setSelectedWarehouseId(e.target.value)}
            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700"
          >
            <option value="">-- Seleccionar almacén --</option>
            {warehouses.map(warehouse => (
              <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
            ))}
          </select>
          <button
            onClick={() => loadData(selectedWarehouseId).catch(console.error)}
            className="px-3 py-2 bg-gray-900 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2"
          >
            <RefreshCw size={14} /> Recargar
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold rounded-xl p-2 text-center">
          {statusMessage}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 min-h-0 flex-1">
        <div className="xl:col-span-4 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col min-h-0">
          <div className="p-4 border-b border-gray-100 space-y-2">
            <div className="text-[10px] uppercase font-bold text-gray-400">Buscador Histórico</div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Sesión o usuario"
                className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm"
              />
            </div>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm"
            />
          </div>

          <div className="flex-1 overflow-auto p-3 space-y-2">
            {warehouseSessions.length === 0 && (
              <div className="text-xs text-gray-400 text-center py-8">
                No hay sesiones finalizadas con los filtros actuales.
              </div>
            )}

            {warehouseSessions.map(session => {
              const isSelected = session.id === selectedSessionId;
              return (
                <button
                  key={session.id}
                  onClick={() => setSelectedSessionId(session.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${isSelected ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-black text-gray-900 truncate">{session.id}</span>
                    <span className="text-[10px] font-bold text-gray-500">{new Date(session.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 font-bold truncate">
                    {session.warehouseName || warehouseNameById.get(session.warehouseId) || session.warehouseId}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1">
                    {session.createdByName || 'Sistema'} • {session.items.length} ítems contados
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="xl:col-span-8 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h3 className="text-sm font-black text-gray-900">Resultados de Auditoría (solo lectura)</h3>
              <p className="text-[10px] font-bold text-gray-400 uppercase">
                Comparación físico vs sistema en la sesión seleccionada
              </p>
            </div>
            {selectedSession && (
              <div className="text-[10px] font-bold text-gray-500">
                Sesión: {new Date(selectedSession.createdAt).toLocaleString()}
              </div>
            )}
          </div>

          {!selectedSession ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm p-8">
              Selecciona una sesión de conteo para ver su auditoría histórica.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 border-b border-gray-100 bg-gray-50/40">
                <div className="p-2 rounded-xl bg-red-50 border border-red-100">
                  <div className="text-[10px] font-bold text-red-500 uppercase">Faltantes</div>
                  <div className="text-lg font-black text-red-700">{auditSummary.shortages.length}</div>
                </div>
                <div className="p-2 rounded-xl bg-blue-50 border border-blue-100">
                  <div className="text-[10px] font-bold text-blue-500 uppercase">Sobrantes</div>
                  <div className="text-lg font-black text-blue-700">{auditSummary.surplus.length}</div>
                </div>
                <div className="p-2 rounded-xl bg-gray-50 border border-gray-200">
                  <div className="text-[10px] font-bold text-gray-500 uppercase">Sin Contar</div>
                  <div className="text-lg font-black text-gray-700">{auditSummary.uncounted.length}</div>
                </div>
                <div className="p-2 rounded-xl bg-amber-50 border border-amber-100">
                  <div className="text-[10px] font-bold text-amber-500 uppercase">Monto Discrepancia</div>
                  <div className="text-lg font-black text-amber-700">${auditSummary.totalDiscrepancy.toFixed(2)}</div>
                </div>
              </div>

              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 bg-white z-10 shadow-sm">
                    <tr className="text-left text-[10px] text-gray-400 uppercase font-bold tracking-wider">
                      <th className="py-3 px-4">Artículo</th>
                      <th className="py-3 px-2 text-right w-24">Sistema</th>
                      <th className="py-3 px-2 text-right w-24">Físico</th>
                      <th className="py-3 px-2 text-right w-24">Dif</th>
                      <th className="py-3 px-2 text-right w-28">Monto</th>
                      <th className="py-3 px-4 text-center w-28">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {auditRows.map(row => {
                      const rowClass =
                        row.status === 'FALTANTE'
                          ? 'bg-red-50/60'
                          : row.status === 'SOBRANTE'
                            ? 'bg-blue-50/60'
                            : row.status === 'SIN_CONTAR'
                              ? 'bg-gray-50/70'
                              : 'bg-white';

                      return (
                        <tr key={row.productId} className={rowClass}>
                          <td className="py-3 px-4">
                            <div className="font-bold text-gray-800 text-xs sm:text-sm">{row.productName}</div>
                            <div className="text-[10px] text-gray-400">{row.category || 'Sin categoría'}</div>
                          </td>
                          <td className="py-3 px-2 text-right font-mono text-xs text-gray-600">
                            {row.systemQty}
                            {row.systemQty < 0 && (
                              <div className="text-[9px] text-amber-600 font-black uppercase tracking-tighter">Negativo</div>
                            )}
                          </td>
                          <td className="py-3 px-2 text-right font-mono text-xs text-gray-700">
                            {row.physicalQty === undefined ? '--' : row.physicalQty}
                          </td>
                          <td className={`py-3 px-2 text-right font-bold text-xs ${row.status === 'FALTANTE'
                            ? 'text-red-700'
                            : row.status === 'SOBRANTE'
                              ? 'text-blue-700'
                              : row.status === 'SIN_CONTAR'
                                ? 'text-gray-400'
                                : 'text-emerald-700'
                            }`}>
                            {row.diffQty === undefined ? '--' : row.diffQty > 0 ? `+${row.diffQty}` : row.diffQty}
                            {row.systemQty < 0 && row.diffQty !== undefined && row.diffQty > 0 && (
                              <div className="text-[8px] text-blue-500 font-black leading-none mt-0.5 uppercase tracking-tighter">
                                Incl. {Math.abs(row.systemQty)} p/ nivelar
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-2 text-right font-bold text-xs text-gray-700">
                            {row.diffQty === undefined || row.diffQty === 0 ? '--' : `$${row.discrepancyValue.toFixed(2)}`}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${row.status === 'FALTANTE'
                              ? 'bg-red-100 text-red-700 border-red-200'
                              : row.status === 'SOBRANTE'
                                ? 'bg-blue-100 text-blue-700 border-blue-200'
                                : row.status === 'SIN_CONTAR'
                                  ? 'bg-gray-100 text-gray-600 border-gray-200'
                                  : 'bg-emerald-100 text-emerald-700 border-emerald-200'
                              }`}>
                              {row.status === 'SIN_CONTAR' ? 'SIN CONTAR' : row.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
              <Lock size={16} className="text-gray-700" /> Cierre de Inventario (Hard Lock)
            </h3>
            <p className="text-[10px] text-gray-500 font-bold uppercase mt-1">
              Bloquea transacciones con fecha &lt;= fecha de corte cerrada
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
              <CalendarClock size={14} className="text-gray-500" />
              <input
                type="date"
                value={cutoffDate}
                onChange={(e) => setCutoffDate(e.target.value)}
                className="bg-transparent text-sm font-bold text-gray-700 outline-none"
              />
            </div>
            <button
              onClick={handleHardClose}
              disabled={isClosing || !selectedWarehouseId}
              className="px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-bold disabled:opacity-50"
            >
              {isClosing ? 'Cerrando...' : 'Ejecutar Cierre'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-3 rounded-xl border border-amber-100 bg-amber-50">
            <div className="flex items-center gap-2 text-amber-700 text-xs font-black uppercase">
              <ShieldAlert size={14} /> Escudo Activo
            </div>
            {activeLock ? (
              <div className="text-xs text-amber-800 mt-1 font-bold">
                Cierre vigente: {new Date(activeLock.lockDate || activeLock.cutoffDate || activeLock.closedAt).toLocaleString()}
              </div>
            ) : (
              <div className="text-xs text-amber-700 mt-1 font-bold">
                Sin cierre activo para este almacén.
              </div>
            )}
            <div className="text-[11px] text-amber-700 mt-2">
              Mensaje de bloqueo: "Acción denegada: El inventario a esta fecha ya ha sido cerrado y auditado."
            </div>
          </div>

          <div className="p-3 rounded-xl border border-gray-200 bg-gray-50">
            <div className="text-[10px] text-gray-500 font-bold uppercase mb-2">Últimos cierres</div>
            <div className="space-y-2">
              {recentClosures.length === 0 && (
                <div className="text-xs text-gray-400">No hay cierres registrados para este almacén.</div>
              )}
              {recentClosures.map(snapshot => (
                <div key={snapshot.id} className="bg-white border border-gray-200 rounded-lg px-3 py-2">
                  <div className="text-xs font-black text-gray-800">{snapshot.label}</div>
                  <div className="text-[10px] text-gray-500">
                    Corte: {new Date(snapshot.lockDate || snapshot.cutoffDate || snapshot.closedAt).toLocaleDateString()} •
                    Total: ${snapshot.totalValue.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InventoryAuditClosure;
