import React, { useMemo, useRef, useState } from 'react';
import {
  Banknote,
  Calendar,
  CreditCard,
  Edit2,
  GripVertical,
  PenTool,
  Plus,
  QrCode,
  Save,
  Trash2,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import {
  BusinessConfig,
  PaymentIntegrationDefinition,
  PaymentMethod,
  PaymentMethodDefinition,
  PaymentMethodRoundingRule,
} from '../types';

interface PaymentSettingsProps {
  config: BusinessConfig;
  onUpdateConfig: (newConfig: BusinessConfig) => void | Promise<void>;
  onClose: () => void;
}

const DEFAULT_METHODS: PaymentMethodDefinition[] = [
  { id: 'cash', name: 'Efectivo', type: 'CASH', isEnabled: true, icon: 'Banknote', color: 'bg-green-500', opensDrawer: true, requiresSignature: false, integration: 'NONE', integrationMode: 'MANUAL', foreignCurrencyRounding: 'NONE' },
  { id: 'card', name: 'Tarjeta', type: 'CARD', isEnabled: true, icon: 'CreditCard', color: 'bg-blue-500', opensDrawer: false, requiresSignature: false, integration: 'NONE', integrationMode: 'MANUAL', foreignCurrencyRounding: 'NONE' },
  { id: 'qr', name: 'Transferencia / QR', type: 'QR', isEnabled: true, icon: 'QrCode', color: 'bg-purple-500', opensDrawer: false, requiresSignature: false, integration: 'NONE', integrationMode: 'MANUAL', foreignCurrencyRounding: 'NONE' },
];

const ROUNDING_LABELS: Record<PaymentMethodRoundingRule, string> = {
  NONE: 'Exacto',
  UP: 'Hacia arriba',
  DOWN: 'Hacia abajo',
  ZERO_DECIMALS: 'En 0',
};

const ICONS = {
  Banknote,
  CreditCard,
  QrCode,
  Wallet,
};

const COLORS = [
  'bg-green-500',
  'bg-blue-500',
  'bg-red-500',
  'bg-orange-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-gray-800',
];

const isPendingPaymentMethod = (name: string): boolean => name.trim().toLowerCase() === 'pendiente';

const toValidCreditDays = (days?: number): number => {
  const parsed = Number(days);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
};

const normalizePaymentMethod = (method: PaymentMethodDefinition): PaymentMethodDefinition => {
  const forcedType: PaymentMethod = isPendingPaymentMethod(method.name) ? 'CREDIT' : method.type;
  const integrationMode = forcedType === 'CARD'
    ? method.integrationMode || (method.integration !== 'NONE' ? 'INTEGRATED' : 'MANUAL')
    : 'MANUAL';

  const normalizedMethod: PaymentMethodDefinition = {
    ...method,
    type: forcedType,
    integrationMode,
    integration: forcedType === 'CARD' && integrationMode === 'INTEGRATED' ? method.integration || 'NONE' : 'NONE',
    integrationId: forcedType === 'CARD' && integrationMode === 'INTEGRATED' ? method.integrationId : undefined,
    integrationConfig: forcedType === 'CARD' ? method.integrationConfig || {} : {},
    foreignCurrencyRounding: method.foreignCurrencyRounding || 'NONE',
    opensDrawer: method.opensDrawer === true,
  };

  if (forcedType === 'CREDIT') {
    return { ...normalizedMethod, paymentTermDays: toValidCreditDays(method.paymentTermDays) };
  }

  const { paymentTermDays, ...withoutCreditDays } = normalizedMethod;
  return withoutCreditDays;
};

const PaymentSettings: React.FC<PaymentSettingsProps> = ({ config, onUpdateConfig, onClose }) => {
  const [methods, setMethods] = useState<PaymentMethodDefinition[]>(
    (config.paymentMethods || DEFAULT_METHODS).map(normalizePaymentMethod)
  );
  const [editingMethod, setEditingMethod] = useState<PaymentMethodDefinition | null>(null);
  const [isMethodModalOpen, setIsMethodModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const allIntegrations = config.integrations || [];
  const availableIntegrations = useMemo(
    () => allIntegrations.filter((integration) => integration.isEnabled),
    [allIntegrations]
  );
  const integrationsById = useMemo(
    () => new Map(allIntegrations.map((integration) => [integration.id, integration] as const)),
    [allIntegrations]
  );

  const handleDragStart = (_event: React.DragEvent<HTMLDivElement>, position: number) => {
    dragItem.current = position;
  };

  const handleDragEnter = (_event: React.DragEvent<HTMLDivElement>, position: number) => {
    dragOverItem.current = position;
  };

  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const copyListItems = [...methods];
    const dragItemContent = copyListItems[dragItem.current];
    copyListItems.splice(dragItem.current, 1);
    copyListItems.splice(dragOverItem.current, 0, dragItemContent);
    dragItem.current = null;
    dragOverItem.current = null;
    setMethods(copyListItems);
  };

  const handleAddNewMethod = () => {
    setEditingMethod({
      id: Math.random().toString(36).slice(2, 11),
      name: 'Nuevo Método',
      type: 'OTHER',
      isEnabled: true,
      icon: 'Wallet',
      color: 'bg-gray-800',
      opensDrawer: false,
      requiresSignature: false,
      integration: 'NONE',
      integrationMode: 'MANUAL',
      integrationConfig: {},
      paymentTermDays: 0,
      foreignCurrencyRounding: 'NONE',
    });
    setIsMethodModalOpen(true);
  };

  const handleEditMethod = (method: PaymentMethodDefinition) => {
    setEditingMethod(normalizePaymentMethod({ ...method, integrationConfig: method.integrationConfig || {} }));
    setIsMethodModalOpen(true);
  };

  const handleDeleteMethod = async (id: string) => {
    if (await clicConfirm('¿Eliminar este método de pago?')) {
      setMethods((prev) => prev.filter((method) => method.id !== id));
    }
  };

  const handleIntegrationSelection = (integrationId: string) => {
    if (!editingMethod) return;
    const selectedIntegration = integrationsById.get(integrationId);
    setEditingMethod(normalizePaymentMethod({
      ...editingMethod,
      integrationMode: integrationId ? 'INTEGRATED' : 'MANUAL',
      integrationId: integrationId || undefined,
      integration: integrationId && selectedIntegration ? selectedIntegration.provider : 'NONE',
    }));
  };

  const handleSaveMethod = () => {
    if (!editingMethod) return;

    let normalizedMethod = normalizePaymentMethod(editingMethod);
    if (normalizedMethod.type === 'CARD' && normalizedMethod.integrationMode === 'INTEGRATED') {
      if (!normalizedMethod.integrationId) {
        alert('Seleccione una integración activa antes de guardar la tarjeta integrada.');
        return;
      }

      const selectedIntegration = integrationsById.get(normalizedMethod.integrationId);
      if (!selectedIntegration) {
        alert('La integración seleccionada ya no existe. Revise Ajustes > Integraciones.');
        return;
      }

      normalizedMethod = normalizePaymentMethod({
        ...normalizedMethod,
        integration: selectedIntegration.provider,
      });
    }

    setMethods((prev) => {
      const exists = prev.some((method) => method.id === normalizedMethod.id);
      if (exists) {
        return prev.map((method) => method.id === normalizedMethod.id ? normalizedMethod : method);
      }
      return [...prev, normalizedMethod];
    });
    setIsMethodModalOpen(false);
  };

  const handleSaveChanges = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onUpdateConfig({
        ...config,
        paymentMethods: methods.map(normalizePaymentMethod),
      });
      alert('Métodos de pago guardados correctamente.');
      onClose();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'No se pudieron guardar los métodos de pago.');
    } finally {
      setIsSaving(false);
    }
  };

  const Toggle: React.FC<{ label: string; checked: boolean; onChange: (value: boolean) => void; helper?: string }> = ({ label, checked, onChange, helper }) => (
    <label className="flex cursor-pointer items-center justify-between rounded-xl border border-transparent bg-gray-50 p-4 transition-colors hover:border-gray-200 hover:bg-gray-100">
      <span>
        <span className="block font-medium text-gray-700">{label}</span>
        {helper ? <span className="mt-1 block text-xs text-gray-500">{helper}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
      />
    </label>
  );

  const renderIntegrationBadge = (method: PaymentMethodDefinition) => {
    if (method.type !== 'CARD') return null;
    if (method.integrationMode !== 'INTEGRATED' || !method.integrationId) {
      return (
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">
          Manual
        </span>
      );
    }

    const assignedIntegration = integrationsById.get(method.integrationId);
    return (
      <span className="rounded border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700">
        {assignedIntegration?.name || method.integration}
      </span>
    );
  };

  const selectedIntegration = editingMethod?.integrationId
    ? integrationsById.get(editingMethod.integrationId)
    : undefined;

  return (
    <div className="flex h-full flex-col bg-gray-50 animate-in fade-in">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-8 py-6">
        <div>
          <h1 className="text-2xl font-black text-gray-800">Métodos de Pago</h1>
          <p className="text-sm text-gray-500">Configura las opciones de cobro visibles en caja y decide si una tarjeta se procesa manualmente o integrada a un dispositivo.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="inline-flex h-11 items-center rounded-xl border border-[#E1E9E8] bg-white px-5 text-sm font-bold text-[#4A615F] transition-colors hover:bg-[#F4F7F6]"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleSaveChanges()}
            disabled={isSaving}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#00A7A0] px-5 text-sm font-bold text-white transition-colors hover:bg-[#00877F] disabled:cursor-wait disabled:opacity-60"
          >
            <Save size={20} /> {isSaving ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-700">
              <Wallet size={20} className="text-blue-500" /> Métodos Activos
            </h2>
            <button
              onClick={handleAddNewMethod}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#00A7A0] px-4 text-sm font-bold text-white transition-colors hover:bg-[#00877F]"
            >
              <Plus size={18} /> Nuevo Método
            </button>
          </div>

          <div className="space-y-3">
            {methods.map((method, index) => {
              const IconComp = ICONS[method.icon as keyof typeof ICONS] || Wallet;

              return (
                <div
                  key={method.id}
                  draggable
                  onDragStart={(event) => handleDragStart(event, index)}
                  onDragEnter={(event) => handleDragEnter(event, index)}
                  onDragEnd={handleDragEnd}
                  className="group flex cursor-grab items-center gap-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md active:cursor-grabbing"
                >
                  <div className="cursor-grab text-gray-300 group-hover:text-gray-500">
                    <GripVertical size={24} />
                  </div>

                  <div className={`flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-md ${method.color}`}>
                    <IconComp size={28} />
                  </div>

                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-gray-800">{method.name}</h3>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {renderIntegrationBadge(method)}
                      {method.opensDrawer && (
                        <span className="flex items-center gap-1 rounded border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          <Zap size={10} /> Cajón
                        </span>
                      )}
                      {method.requiresSignature && (
                        <span className="flex items-center gap-1 rounded border border-orange-100 bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                          <PenTool size={10} /> Firma
                        </span>
                      )}
                      {method.type === 'CREDIT' && (
                        <span className="rounded border border-cyan-100 bg-cyan-50 px-2 py-0.5 text-[10px] font-medium text-cyan-700">
                          {method.paymentTermDays || 0} Días
                        </span>
                      )}
                      <span className="rounded border border-violet-100 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                        Redondeo: {ROUNDING_LABELS[method.foreignCurrencyRounding || 'NONE']}
                      </span>
                      <span className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-500">
                        {method.type}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => handleEditMethod(method)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#E1E9E8] bg-white text-[#4A615F] transition-colors hover:border-[#00A7A0] hover:text-[#00877F]"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDeleteMethod(method.id)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#F2DCD8] bg-white text-[#C0392B] transition-colors hover:bg-[#FDECEA]"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-8 text-center text-xs text-gray-400">
            Arrastra y suelta los elementos para reordenar cómo aparecen en la pantalla de cobro.
          </p>
        </div>
      </div>

      {isMethodModalOpen && editingMethod && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white p-5">
              <h3 className="text-lg font-bold text-gray-800">Editar Método de Pago</h3>
              <button onClick={() => setIsMethodModalOpen(false)} className="rounded-full bg-gray-100 p-2 hover:bg-gray-200">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6 overflow-y-auto p-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-bold uppercase text-gray-500">Nombre</label>
                  <input
                    type="text"
                    value={editingMethod.name}
                    onChange={(event) => {
                      const nextName = event.target.value;
                      const nextType = isPendingPaymentMethod(nextName) ? 'CREDIT' : editingMethod.type;
                      setEditingMethod(normalizePaymentMethod({ ...editingMethod, name: nextName, type: nextType }));
                    }}
                    className="w-full rounded-xl bg-gray-50 p-3 outline-none transition-all focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-gray-500">Tipo</label>
                  <select
                    value={editingMethod.type}
                    onChange={(event) => setEditingMethod(normalizePaymentMethod({ ...editingMethod, type: event.target.value as PaymentMethod }))}
                    disabled={isPendingPaymentMethod(editingMethod.name)}
                    className="w-full rounded-xl bg-gray-50 p-3 outline-none transition-all focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <option value="CASH">Efectivo</option>
                    <option value="CARD">Tarjeta</option>
                    <option value="QR">Transferencia / QR</option>
                  </select>
                  {isPendingPaymentMethod(editingMethod.name) && (
                    <p className="mt-1 text-[11px] font-medium text-cyan-700">
                      El método &quot;Pendiente&quot; siempre se guarda como Crédito.
                    </p>
                  )}
                </div>

                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-bold uppercase text-gray-500">Redondeo en otra moneda</label>
                  <select
                    value={editingMethod.foreignCurrencyRounding || 'NONE'}
                    onChange={(event) => setEditingMethod({ ...editingMethod, foreignCurrencyRounding: event.target.value as PaymentMethodRoundingRule })}
                    className="w-full rounded-xl bg-gray-50 p-3 outline-none transition-all focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="NONE">Exacto (sin redondeo)</option>
                    <option value="UP">Hacia arriba</option>
                    <option value="DOWN">Hacia abajo</option>
                    <option value="ZERO_DECIMALS">En 0 (sin decimales)</option>
                  </select>
                  <p className="mt-1 text-[11px] font-medium text-gray-500">
                    Aplica cuando el cobro se hace en una moneda distinta de la base.
                  </p>
                </div>

                {editingMethod.type === 'CARD' && (
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-gray-500">Integrado a</label>
                    <select
                      value={editingMethod.integrationMode || 'MANUAL'}
                      onChange={(event) => {
                        const nextMode = event.target.value as PaymentMethodDefinition['integrationMode'];
                        setEditingMethod(normalizePaymentMethod({
                          ...editingMethod,
                          integrationMode: nextMode,
                          integrationId: nextMode === 'INTEGRATED' ? editingMethod.integrationId : undefined,
                          integration: nextMode === 'INTEGRATED' ? editingMethod.integration : 'NONE',
                        }));
                      }}
                      className="w-full rounded-xl border border-indigo-100 bg-indigo-50 p-3 font-medium text-indigo-900 outline-none transition-all focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="MANUAL">Ninguno (cobro manual)</option>
                      <option value="INTEGRATED">Dispositivo / gateway</option>
                    </select>
                  </div>
                )}

                {editingMethod.type === 'CREDIT' && (
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-gray-500">Días de Crédito</label>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={editingMethod.paymentTermDays ?? 0}
                        onChange={(event) => setEditingMethod({ ...editingMethod, paymentTermDays: toValidCreditDays(parseInt(event.target.value, 10)) })}
                        className="w-full rounded-xl border border-cyan-100 bg-cyan-50 p-3 pl-10 font-medium text-cyan-900 outline-none transition-all focus:ring-2 focus:ring-cyan-400"
                      />
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-400">
                        <Calendar size={16} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {editingMethod.type === 'CARD' && editingMethod.integrationMode === 'INTEGRATED' && (
                <div className="space-y-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
                  <div className="flex items-center gap-2">
                    <CreditCard size={18} className="text-indigo-600" />
                    <h4 className="text-sm font-bold uppercase tracking-wide text-indigo-800">Dispositivo o gateway asignado</h4>
                  </div>

                  {availableIntegrations.length > 0 ? (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">Integración disponible</label>
                        <select
                          value={editingMethod.integrationId || ''}
                          onChange={(event) => handleIntegrationSelection(event.target.value)}
                          className="w-full rounded-xl border border-indigo-100 bg-white p-3 font-medium text-indigo-900 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                        >
                          <option value="">Seleccione una integración</option>
                          {availableIntegrations.map((integration) => (
                            <option key={integration.id} value={integration.id}>
                              {integration.name} - {integration.provider}
                            </option>
                          ))}
                        </select>
                      </div>

                      {selectedIntegration && (
                        <div className="rounded-xl border border-indigo-100 bg-white p-4 text-sm text-indigo-800">
                          <p className="font-bold">{selectedIntegration.name}</p>
                          <p className="mt-1">{selectedIntegration.provider} · {selectedIntegration.environment}</p>
                          <p className="mt-1 text-xs text-indigo-500">{selectedIntegration.baseUrl}</p>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-indigo-500">
                            {selectedIntegration.merchantId && <span>Merchant: {selectedIntegration.merchantId}</span>}
                            {selectedIntegration.terminalId && <span>Terminal: {selectedIntegration.terminalId}</span>}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed border-indigo-200 bg-white p-4 text-sm text-indigo-700">
                      No hay integraciones activas todavía. Configura primero <strong>Ajustes &gt; Integraciones</strong> y vuelve aquí para asignarla.
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="mb-2 block text-xs font-bold uppercase text-gray-500">Apariencia</label>
                <div className="flex gap-4">
                  <div className="grid grid-cols-4 gap-2">
                    {Object.keys(ICONS).map((iconName) => {
                      const Icon = ICONS[iconName as keyof typeof ICONS];
                      return (
                        <button
                          key={iconName}
                          onClick={() => setEditingMethod({ ...editingMethod, icon: iconName })}
                          className={`flex items-center justify-center rounded-lg border p-2 transition-all ${editingMethod.icon === iconName ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                        >
                          <Icon size={20} />
                        </button>
                      );
                    })}
                  </div>
                  <div className="w-px bg-gray-200" />
                  <div className="grid grid-cols-4 gap-2">
                    {COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setEditingMethod({ ...editingMethod, color })}
                        className={`h-9 w-9 rounded-full transition-transform ${color} ${editingMethod.color === color ? 'scale-110 ring-2 ring-gray-300 ring-offset-2' : 'hover:scale-105'}`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Toggle
                  label="Abrir cajón portamonedas al cobrar"
                  helper="Solo este medio de pago enviará la orden de apertura a la impresora de tickets."
                  checked={editingMethod.opensDrawer === true}
                  onChange={(value) => setEditingMethod({ ...editingMethod, opensDrawer: value })}
                />
                <Toggle
                  label="Requerir firma del cliente"
                  checked={editingMethod.requiresSignature}
                  onChange={(value) => setEditingMethod({ ...editingMethod, requiresSignature: value })}
                />
              </div>
            </div>

            <div className="sticky bottom-0 z-10 flex justify-end gap-3 border-t border-gray-100 bg-gray-50 p-5">
              <button onClick={() => setIsMethodModalOpen(false)} className="rounded-xl px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-200">
                Cancelar
              </button>
              <button onClick={handleSaveMethod} className="rounded-xl bg-blue-600 px-6 py-2.5 font-bold text-white hover:bg-blue-700">
                Guardar Método
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentSettings;
