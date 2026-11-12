import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  History,
  Key,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings2,
  Smartphone,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import {
  BusinessConfig,
  PaymentIntegrationDefinition,
  PaymentIntegrationEnvironment,
  PaymentIntegrationAuditEvent,
  PaymentIntegrationProvider,
} from '../types';
import AzulSettlementModal from './AzulSettlementModal';
import IntegrationAuditModal from './IntegrationAuditModal';
import { AzulGatewayError, AzulNormalizedResult, azulMcmService } from '../services/payments/AzulMcmService';
import {
  appendAuditEventToIntegration,
  appendAuditEventToIntegrations,
  createPaymentIntegrationAuditEvent,
  dispatchAuditEventConfigUpdate,
} from '../services/payments/paymentIntegrationAudit';
import {
  IngenicoAzulWebApiError,
  IngenicoAzulWebApiNormalizedResult,
  ingenicoAzulWebApiService,
} from '../services/payments/IngenicoAzulWebApiService';
import {
  CARDNET_METADATA_KEYS,
  CardNetEcrError,
  CardNetEcrNormalizedResult,
  cardNetEcrService,
} from '../services/payments/CardNetEcrService';
import { CARDNET_FRAMING_LABELS, CardNetEcrFraming } from '../services/payments/CardNetEcrCodec';
import { printGatewayReceipt } from '../utils/printer';

interface IntegrationSettingsProps {
  config: BusinessConfig;
  onUpdateConfig: (newConfig: BusinessConfig) => void;
  onClose: () => void;
}

type TestResult = {
  success: boolean;
  message: string;
} | null;

type AzulTerminalModalState = {
  integration: PaymentIntegrationDefinition;
  mode: 'TOTALS' | 'SETTLE';
  isLoadingTotals: boolean;
  isSettling: boolean;
  previewResult: AzulNormalizedResult | IngenicoAzulWebApiNormalizedResult | CardNetEcrNormalizedResult | null;
  settledResult: AzulNormalizedResult | IngenicoAzulWebApiNormalizedResult | CardNetEcrNormalizedResult | null;
  errorMessage: string | null;
  printWarning: string | null;
};

const PROVIDER_LABELS: Record<PaymentIntegrationProvider, string> = {
  AZUL: 'AZUL',
  INGENICO_AZUL_WEBAPI: 'Ingenico Azul WebAPI',
  CARDNET: 'CardNet',
  CARNET: 'Carnet',
  VISANET: 'VisaNet',
  STRIPE: 'Stripe',
};

const CARDNET_DEFAULT_ENDPOINT = '192.168.1.10:7060';
const CARDNET_DEFAULT_TIMEOUT_MS = 90_000;

const defaultTimeoutMsFor = (provider: PaymentIntegrationProvider): number => (
  provider === 'INGENICO_AZUL_WEBAPI'
    ? 65_000
    : provider === 'CARDNET'
      ? CARDNET_DEFAULT_TIMEOUT_MS
      : 160_000
);

const resolveCardNetFraming = (integration: PaymentIntegrationDefinition): CardNetEcrFraming => {
  const raw = String(integration.metadata?.[CARDNET_METADATA_KEYS.framing] || '').toUpperCase();
  return raw === 'PLAIN' || raw === 'STX_ETX' || raw === 'STX_ETX_LRC'
    ? raw as CardNetEcrFraming
    : 'STX_ETX_LRC';
};

const createDefaultIntegration = (
  provider: PaymentIntegrationProvider = 'AZUL',
  environment: PaymentIntegrationEnvironment = 'TEST'
): PaymentIntegrationDefinition => ({
  id: `int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name:
    provider === 'AZUL'
      ? 'AZUL Desarrollo'
      : provider === 'INGENICO_AZUL_WEBAPI'
        ? 'Ingenico Lane 7000'
        : provider === 'CARDNET'
          ? 'CardNET Caja Ethernet'
          : `Nueva integración ${PROVIDER_LABELS[provider]}`,
  provider,
  isEnabled: true,
  environment,
  baseUrl:
    provider === 'AZUL'
      ? (environment === 'TEST'
        ? 'https://pruebas.azul.com.do/POSWebServices/JSON/default.aspx'
        : 'https://pagos.azul.com.do/POSWebServices/JSON/default.aspx')
      : provider === 'INGENICO_AZUL_WEBAPI'
        ? 'http://localhost:9000'
        : provider === 'CARDNET'
          ? CARDNET_DEFAULT_ENDPOINT
          : '',
  secondaryBaseUrl: '',
  merchantId: '',
  terminalId: '',
  auth1: '',
  auth2: '',
  timeoutMs: defaultTimeoutMsFor(provider),
  capabilities: {
    sale: true,
    getLastTrx: provider !== 'INGENICO_AZUL_WEBAPI',
    refund: true,
    void: true,
    pinpadInit: provider === 'AZUL',
    transactionTotals: provider === 'AZUL',
    settle: true,
  },
  metadata: {},
  auditEvents: [],
});

const IntegrationSettings: React.FC<IntegrationSettingsProps> = ({ config, onUpdateConfig, onClose }) => {
  const [integrations, setIntegrations] = useState<PaymentIntegrationDefinition[]>(config.integrations || []);
  const [editingIntegration, setEditingIntegration] = useState<PaymentIntegrationDefinition | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [auditIntegrationId, setAuditIntegrationId] = useState<string | null>(null);
  const [azulTerminalModal, setAzulTerminalModal] = useState<AzulTerminalModalState | null>(null);
  const [hasPendingIntegrationChanges, setHasPendingIntegrationChanges] = useState(false);

  const enabledCount = useMemo(() => integrations.filter(integration => integration.isEnabled).length, [integrations]);
  const selectedAuditIntegration = useMemo(
    () => integrations.find(integration => integration.id === auditIntegrationId) || null,
    [auditIntegrationId, integrations]
  );

  useEffect(() => {
    if (hasPendingIntegrationChanges) return;
    setIntegrations(config.integrations || []);
  }, [config.integrations, hasPendingIntegrationChanges]);

  const handleCreate = () => {
    setEditingIntegration(createDefaultIntegration());
    setTestResult(null);
    setIsEditorOpen(true);
  };

  const handleEdit = (integration: PaymentIntegrationDefinition) => {
    setEditingIntegration({
      ...integration,
      metadata: { ...(integration.metadata || {}) },
      auditEvents: [...(integration.auditEvents || [])],
    });
    setTestResult(null);
    setIsEditorOpen(true);
  };

  const handleDelete = async (integrationId: string) => {
    if (!await clicConfirm('¿Eliminar esta integración de pago?')) return;
    setHasPendingIntegrationChanges(true);
    setIntegrations(prev => prev.filter(integration => integration.id !== integrationId));
  };

  const handleSaveIntegration = () => {
    if (!editingIntegration) return;

    const normalized = {
      ...editingIntegration,
      name: editingIntegration.name.trim() || PROVIDER_LABELS[editingIntegration.provider],
      baseUrl: editingIntegration.baseUrl.trim(),
      secondaryBaseUrl: editingIntegration.secondaryBaseUrl?.trim() || '',
      merchantId: editingIntegration.merchantId?.trim() || '',
      terminalId: editingIntegration.terminalId?.trim() || '',
      auth1: editingIntegration.auth1?.trim() || '',
      auth2: editingIntegration.auth2?.trim() || '',
      timeoutMs: Math.max(1000, Number(editingIntegration.timeoutMs) || 160000),
      auditEvents: editingIntegration.auditEvents || [],
    };

    setIntegrations(prev => {
      const existing = prev.some(integration => integration.id === normalized.id);
      if (existing) {
        return prev.map(integration => integration.id === normalized.id ? normalized : integration);
      }
      return [...prev, normalized];
    });
    setHasPendingIntegrationChanges(true);
    setIsEditorOpen(false);
  };

  const handleSaveChanges = () => {
    onUpdateConfig({
      ...config,
      integrations,
    });
    alert('Integraciones guardadas correctamente.');
    onClose();
  };

  const handleProviderChange = (provider: PaymentIntegrationProvider) => {
    if (!editingIntegration) return;
    const draft = createDefaultIntegration(provider, editingIntegration.environment);
    setEditingIntegration({
      ...editingIntegration,
      provider,
      name: (!editingIntegration.name || editingIntegration.name === PROVIDER_LABELS[editingIntegration.provider]) ? draft.name : editingIntegration.name,
      baseUrl: draft.baseUrl,
      secondaryBaseUrl: provider === 'AZUL' ? (editingIntegration.secondaryBaseUrl || draft.secondaryBaseUrl) : '',
      timeoutMs: draft.timeoutMs,
      merchantId: provider === 'AZUL' ? editingIntegration.merchantId : '',
      terminalId: provider === 'AZUL' ? editingIntegration.terminalId : '',
      auth1: provider === 'AZUL' ? editingIntegration.auth1 : '',
      auth2: provider === 'AZUL' ? editingIntegration.auth2 : '',
      capabilities: draft.capabilities,
      metadata: {},
    });
    setTestResult(null);
  };

  const handleEnvironmentChange = (environment: PaymentIntegrationEnvironment) => {
    if (!editingIntegration) return;
    const defaults = createDefaultIntegration(editingIntegration.provider, environment);
    setEditingIntegration({
      ...editingIntegration,
      environment,
      // CardNET trabaja contra la misma IP en producción y en pruebas: no se pisa el endpoint.
      baseUrl: editingIntegration.provider === 'CARDNET' ? editingIntegration.baseUrl : defaults.baseUrl,
    });
    setTestResult(null);
  };

  const persistAuditEvent = async (event: PaymentIntegrationAuditEvent) => {
    setEditingIntegration(prev => (
      prev && prev.id === event.integrationId
        ? appendAuditEventToIntegration(prev, event)
        : prev
    ));
    setIntegrations(prev => appendAuditEventToIntegrations(prev, event.integrationId, event));

    const nextConfig = await dispatchAuditEventConfigUpdate(config, event.integrationId, event);
    if (nextConfig?.integrations && !hasPendingIntegrationChanges) {
      setIntegrations(nextConfig.integrations);
      return;
    }
  };

  const handleTestConnection = async () => {
    if (!editingIntegration) return;

    setIsTesting(true);
    setTestResult(null);
    try {
      const result = editingIntegration.provider === 'AZUL'
        ? await azulMcmService.testConnection(editingIntegration)
        : editingIntegration.provider === 'INGENICO_AZUL_WEBAPI'
          ? await ingenicoAzulWebApiService.testConnection(editingIntegration)
          : editingIntegration.provider === 'CARDNET'
            ? await cardNetEcrService.testConnection(editingIntegration)
            : {
              success: false,
              message: 'La prueba en vivo todavía no está disponible para este proveedor.',
            };
      await persistAuditEvent(createPaymentIntegrationAuditEvent(editingIntegration, {
        action: 'GET_LAST_TRX',
        status: result.success ? 'SUCCESS' : 'FAILED',
        message: result.message,
        requestDetails: {
          Origen: 'Prueba de conexión',
          TrxType: editingIntegration.provider === 'INGENICO_AZUL_WEBAPI' ? 'Config' : 'Sale',
          ...(editingIntegration.provider === 'CARDNET'
            ? {
              Endpoint: editingIntegration.baseUrl,
              Puerto: '7060',
              Handshake: 'ENQ/ACK',
            }
            : {}),
        },
        responseDetails: {
          MerchantId: result.merchantId || editingIntegration.merchantId || '',
          TerminalId: result.terminalId || editingIntegration.terminalId || '',
          Estado: result.success ? 'Conectado' : 'Fallido',
          ...(editingIntegration.provider === 'CARDNET' && 'latencyMs' in result && result.latencyMs
            ? { LatenciaMs: String(result.latencyMs) }
            : {}),
        },
        responseCode: result.responseCode,
        responseMessage: result.responseMessage,
        merchantId: result.merchantId,
        terminalId: result.terminalId,
      }));
      setTestResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo probar la conexión.';
      const gatewayError = error instanceof AzulGatewayError ? error : null;
      const ingenicoError = error instanceof IngenicoAzulWebApiError ? error : null;
      const cardNetError = error instanceof CardNetEcrError ? error : null;
      await persistAuditEvent(createPaymentIntegrationAuditEvent(editingIntegration, {
        action: 'GET_LAST_TRX',
        status: 'FAILED',
        message,
        requestDetails: {
          Origen: 'Prueba de conexión',
          TrxType: editingIntegration.provider === 'INGENICO_AZUL_WEBAPI' ? 'Config' : 'Sale',
        },
        responseDetails: {
          MerchantId: gatewayError?.normalized?.merchantId || '',
          TerminalId:
            gatewayError?.normalized?.terminalId ||
            ingenicoError?.normalized?.terminalId ||
            editingIntegration.terminalId ||
            '',
          Estado: 'Error',
        },
        responseCode:
          gatewayError?.normalized?.responseCode ||
          gatewayError?.response?.ResponseCode ||
          ingenicoError?.normalized?.responseCode ||
          cardNetError?.parsed?.responseCode,
        responseMessage:
          gatewayError?.normalized?.responseMessage ||
          gatewayError?.response?.ResponseMessage ||
          ingenicoError?.normalized?.responseMessage ||
          cardNetError?.parsed?.responseMessage,
        merchantId: gatewayError?.normalized?.merchantId,
        terminalId: gatewayError?.normalized?.terminalId || ingenicoError?.normalized?.terminalId,
      }));
      setTestResult({
        success: false,
        message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const openAzulTerminalModal = (integration: PaymentIntegrationDefinition, mode: 'TOTALS' | 'SETTLE') => {
    setAzulTerminalModal({
      integration,
      mode,
      isLoadingTotals: true,
      isSettling: false,
      previewResult: null,
      settledResult: null,
      errorMessage: null,
      printWarning: null,
    });
  };

  const handleLoadAzulTotals = async (integration: PaymentIntegrationDefinition, mode: 'TOTALS' | 'SETTLE') => {
    setAzulTerminalModal(prev => (
      prev && prev.integration.id === integration.id
        ? {
          ...prev,
          mode,
          isLoadingTotals: true,
          errorMessage: null,
          printWarning: null,
        }
        : {
          integration,
          mode,
          isLoadingTotals: true,
          isSettling: false,
          previewResult: null,
          settledResult: null,
          errorMessage: null,
          printWarning: null,
        }
    ));

    try {
      const result = integration.provider === 'AZUL'
        ? await azulMcmService.getTransactionTotals(integration)
        : null;

      if (!result) {
        setAzulTerminalModal(prev => (
          prev && prev.integration.id === integration.id
            ? {
              ...prev,
              mode,
              isLoadingTotals: false,
              previewResult: null,
              settledResult: null,
              errorMessage: null,
              printWarning: null,
            }
            : prev
        ));
        return;
      }

      await persistAuditEvent(createPaymentIntegrationAuditEvent(integration, {
        action: 'PINPAD_TRANSACTION_TOTALS',
        status: 'SUCCESS',
        message: 'Totales recuperados desde AZUL correctamente.',
        requestDetails: {
          MerchantId: integration.merchantId || '',
          TerminalId: integration.terminalId || '',
        },
        responseDetails: {
          Batch: result.batchNumber || result.responseFields.BTC || '',
          Estado: result.responseMessage || result.responseCode,
        },
        responseCode: result.responseCode,
        responseMessage: result.responseMessage,
        merchantId: result.merchantId,
        terminalId: result.terminalId,
      }));

      setAzulTerminalModal(prev => (
        prev && prev.integration.id === integration.id
          ? {
            ...prev,
            mode,
            isLoadingTotals: false,
            previewResult: result,
            settledResult: null,
            errorMessage: null,
            printWarning: null,
          }
          : prev
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron consultar los totales.';
      const gatewayError = error instanceof AzulGatewayError ? error : null;
      await persistAuditEvent(createPaymentIntegrationAuditEvent(integration, {
        action: 'PINPAD_TRANSACTION_TOTALS',
        status: 'FAILED',
        message,
        requestDetails: {
          MerchantId: integration.merchantId || '',
          TerminalId: integration.terminalId || '',
        },
        responseDetails: {
          Estado: 'Error',
        },
        responseCode: gatewayError?.normalized?.responseCode || gatewayError?.response?.ResponseCode,
        responseMessage: gatewayError?.normalized?.responseMessage || gatewayError?.response?.ResponseMessage,
        merchantId: gatewayError?.normalized?.merchantId,
        terminalId: gatewayError?.normalized?.terminalId,
      }));

      setAzulTerminalModal(prev => (
        prev && prev.integration.id === integration.id
          ? {
            ...prev,
            mode,
            isLoadingTotals: false,
            previewResult: null,
            settledResult: null,
            errorMessage: message,
            printWarning: null,
          }
          : prev
      ));
    }
  };

  const handleConfirmAzulSettle = async () => {
    if (!azulTerminalModal) return;

    const { integration } = azulTerminalModal;
    setAzulTerminalModal(prev => (
      prev && prev.integration.id === integration.id
        ? {
          ...prev,
          isSettling: true,
          errorMessage: null,
          printWarning: null,
        }
        : prev
    ));

    const providerLabel = PROVIDER_LABELS[integration.provider] || integration.provider;

    try {
      const result = integration.provider === 'AZUL'
        ? await azulMcmService.pinpadSettle(integration)
        : integration.provider === 'CARDNET'
          ? await cardNetEcrService.closeBatch(integration)
          : await ingenicoAzulWebApiService.closeTotals(integration);
      await persistAuditEvent(createPaymentIntegrationAuditEvent(integration, {
        action: 'PINPAD_SETTLE',
        status: 'SUCCESS',
        message: `Cierre de lote completado correctamente en ${providerLabel}.`,
        requestDetails: {
          MerchantId: integration.merchantId || '',
          TerminalId: integration.terminalId || '',
          ...(integration.provider === 'CARDNET'
            ? { Trama: 'CN01', Endpoint: integration.baseUrl }
            : {}),
        },
        responseDetails: {
          Batch: result.batchNumber || result.responseFields.BTC || '',
          Estado: result.responseMessage || result.responseCode,
          ...(integration.provider === 'CARDNET' && 'closeRecords' in result && result.closeRecords.length > 0
            ? {
              Host: result.closeRecords.map(record => record.host).filter(Boolean).join(' / '),
              Ventas: result.closeRecords.map(record => record.saleCount).filter(Boolean).join(' / '),
            }
            : {}),
        },
        responseCode: result.responseCode,
        responseMessage: result.responseMessage,
        merchantId: result.merchantId,
        terminalId: result.terminalId,
      }));

      let printWarning: string | null = null;
      const receipt = result.receiptMerchant || result.receiptClient || '';
      if (receipt) {
        const printed = await printGatewayReceipt(config, {
          providerLabel,
          copyLabel: 'Cierre de lote',
          voucherText: receipt,
          referenceId: `${integration.id}-settle-${Date.now()}`,
          terminalId: integration.terminalId,
        });
        if (!printed) {
          printWarning = `${providerLabel} cerró el lote, pero no se pudo imprimir el comprobante automáticamente.`;
        }
      } else {
        printWarning = `${providerLabel} no devolvió un comprobante legible para imprimir después del cierre.`;
      }

      setAzulTerminalModal(prev => (
        prev && prev.integration.id === integration.id
          ? {
            ...prev,
            isSettling: false,
            settledResult: result,
            errorMessage: null,
            printWarning,
          }
          : prev
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : `No se pudo cerrar el lote en ${providerLabel}.`;
      const gatewayError = error instanceof AzulGatewayError ? error : null;
      const ingenicoError = error instanceof IngenicoAzulWebApiError ? error : null;
      const cardNetError = error instanceof CardNetEcrError ? error : null;
      await persistAuditEvent(createPaymentIntegrationAuditEvent(integration, {
        action: 'PINPAD_SETTLE',
        status: 'FAILED',
        message,
        requestDetails: {
          MerchantId: integration.merchantId || '',
          TerminalId: integration.terminalId || '',
        },
        responseDetails: {
          Estado: 'Error',
          ...(cardNetError?.transcript ? { Traza: cardNetError.transcript.slice(0, 400) } : {}),
        },
        responseCode:
          gatewayError?.normalized?.responseCode ||
          gatewayError?.response?.ResponseCode ||
          ingenicoError?.normalized?.responseCode ||
          cardNetError?.parsed?.responseCode,
        responseMessage:
          gatewayError?.normalized?.responseMessage ||
          gatewayError?.response?.ResponseMessage ||
          ingenicoError?.normalized?.responseMessage ||
          cardNetError?.parsed?.responseMessage,
        merchantId: gatewayError?.normalized?.merchantId || ingenicoError?.normalized?.merchantId,
        terminalId: gatewayError?.normalized?.terminalId || ingenicoError?.normalized?.terminalId,
      }));

      setAzulTerminalModal(prev => (
        prev && prev.integration.id === integration.id
          ? {
            ...prev,
            isSettling: false,
            errorMessage: message,
          }
          : prev
      ));
    }
  };

  useEffect(() => {
    if (!azulTerminalModal) return;
    void handleLoadAzulTotals(azulTerminalModal.integration, azulTerminalModal.mode);
  }, [azulTerminalModal?.integration.id, azulTerminalModal?.mode]);

  const updateEditingIntegration = (patch: Partial<PaymentIntegrationDefinition>) => {
    if (!editingIntegration) return;
    setEditingIntegration({
      ...editingIntegration,
      ...patch,
    });
    setTestResult(null);
  };

  const updateEditingMetadata = (key: string, value: string) => {
    if (!editingIntegration) return;
    const nextMetadata = { ...(editingIntegration.metadata || {}) };
    if (value.trim()) {
      nextMetadata[key] = value;
    } else {
      delete nextMetadata[key];
    }
    updateEditingIntegration({ metadata: nextMetadata });
  };

  return (
    <div className="flex h-full flex-col bg-gray-50 animate-in fade-in">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-8 py-6">
        <div>
          <h1 className="text-2xl font-black text-gray-800">Integraciones</h1>
          <p className="text-sm text-gray-500">Configura proveedores de cobro para asignarlos luego a las formas de pago.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="rounded-lg px-4 py-2 font-bold text-gray-500 hover:bg-gray-100">
            Cancelar
          </button>
          <button
            onClick={handleSaveChanges}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-bold text-white transition-all hover:bg-blue-700"
          >
            <Save size={18} /> Guardar Cambios
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-5xl space-y-8">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-blue-100 bg-blue-50 p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-blue-500">Proveedores</p>
              <p className="mt-2 text-3xl font-black text-blue-900">{integrations.length}</p>
              <p className="mt-1 text-sm text-blue-700">Configurados en esta terminal.</p>
            </div>
            <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-500">Activos</p>
              <p className="mt-2 text-3xl font-black text-emerald-900">{enabledCount}</p>
              <p className="mt-1 text-sm text-emerald-700">Listos para asignarse a tarjeta integrada.</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Escalable</p>
              <p className="mt-2 text-lg font-black text-slate-800">AZUL, Ingenico y CardNET</p>
              <p className="mt-1 text-sm text-slate-500">El POS ya queda preparado para múltiples adquirentes.</p>
            </div>
          </div>

          <section>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold text-gray-700">
                <Settings2 size={20} className="text-blue-500" /> Proveedores configurados
              </h2>
              <button
                onClick={handleCreate}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
              >
                <Plus size={18} /> Nueva Integración
              </button>
            </div>

            {integrations.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-gray-300 bg-white p-10 text-center">
                <CreditCard className="mx-auto mb-3 text-gray-300" size={32} />
                <h3 className="text-lg font-black text-gray-700">Todavía no hay integraciones</h3>
                <p className="mt-2 text-sm text-gray-500">Crea primero una integración (AZUL, Ingenico o CardNET) y luego asígnala en Métodos de Pago.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {integrations.map((integration) => (
                  <div
                    key={integration.id}
                    className="flex items-center gap-5 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md"
                  >
                    <div className={`flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-md ${
                      integration.provider === 'AZUL'
                        ? 'bg-blue-600'
                        : integration.provider === 'CARDNET'
                          ? 'bg-emerald-600'
                          : 'bg-slate-700'
                    }`}>
                      <CreditCard size={28} />
                    </div>

                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-gray-800">{integration.name}</h3>
                        <span className="rounded border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700">
                          {PROVIDER_LABELS[integration.provider]}
                        </span>
                        <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${integration.isEnabled ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                          {integration.isEnabled ? 'Activa' : 'Inactiva'}
                        </span>
                        <span className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-500">
                          {integration.environment}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-500">
                        {integration.provider === 'CARDNET'
                          ? `Terminal Ethernet: ${integration.baseUrl || 'sin IP configurada'}`
                          : (integration.baseUrl || 'Sin URL base configurada.')}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-medium text-gray-500">
                        {integration.merchantId && <span>Merchant: {integration.merchantId}</span>}
                        {integration.terminalId && <span>Terminal: {integration.terminalId}</span>}
                        <span>Timeout: {Math.round((integration.timeoutMs || defaultTimeoutMsFor(integration.provider)) / 1000)}s</span>
                        {integration.provider === 'CARDNET' && (
                          <span>Enlace: {resolveCardNetFraming(integration)}</span>
                        )}
                        <span>Eventos: {(integration.auditEvents || []).length}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {integration.isEnabled && (
                        integration.provider === 'AZUL'
                        || integration.provider === 'INGENICO_AZUL_WEBAPI'
                        || integration.provider === 'CARDNET'
                      ) && (
                        <>
                          {integration.provider === 'AZUL' && (
                            <button
                              onClick={() => openAzulTerminalModal(integration, 'TOTALS')}
                              className="rounded-lg bg-gray-50 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
                            >
                              <span className="flex items-center gap-2">
                                <RefreshCw size={16} /> Totales
                              </span>
                            </button>
                          )}
                          <button
                            onClick={() => openAzulTerminalModal(integration, 'SETTLE')}
                            className="rounded-lg bg-gray-50 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-700"
                          >
                            <span className="flex items-center gap-2">
                              <CheckCircle2 size={16} /> Cierre
                            </span>
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => setAuditIntegrationId(integration.id)}
                        className="rounded-lg bg-gray-50 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-sky-50 hover:text-sky-700"
                      >
                        <span className="flex items-center gap-2">
                          <History size={16} /> Auditoría
                        </span>
                      </button>
                      <button
                        onClick={() => handleEdit(integration)}
                        className="rounded-lg bg-gray-50 p-2 text-gray-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
                      >
                        <Settings2 size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(integration.id)}
                        className="rounded-lg bg-gray-50 p-2 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {isEditorOpen && editingIntegration && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white p-5">
              <div>
                <h3 className="text-lg font-bold text-gray-800">Editar Integración</h3>
                <p className="text-sm text-gray-500">Define la conexión técnica del adquirente.</p>
              </div>
              <button onClick={() => setIsEditorOpen(false)} className="rounded-full bg-gray-100 p-2 hover:bg-gray-200">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6 overflow-y-auto p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-gray-500">Nombre</label>
                  <input
                    type="text"
                    value={editingIntegration.name}
                    onChange={(event) => updateEditingIntegration({ name: event.target.value })}
                    className="w-full rounded-xl bg-gray-50 p-3 outline-none ring-0 transition-all focus:ring-2 focus:ring-blue-500"
                    placeholder="AZUL Caja Principal"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-gray-500">Proveedor</label>
                  <select
                    value={editingIntegration.provider}
                    onChange={(event) => handleProviderChange(event.target.value as PaymentIntegrationProvider)}
                    className="w-full rounded-xl bg-gray-50 p-3 outline-none ring-0 transition-all focus:ring-2 focus:ring-blue-500"
                  >
                    {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-gray-500">Ambiente</label>
                  <select
                    value={editingIntegration.environment}
                    onChange={(event) => handleEnvironmentChange(event.target.value as PaymentIntegrationEnvironment)}
                    className="w-full rounded-xl bg-gray-50 p-3 outline-none ring-0 transition-all focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="TEST">Pruebas</option>
                    <option value="PRODUCTION">Producción</option>
                  </select>
                </div>
                <div
                  onClick={() => updateEditingIntegration({ isEnabled: !editingIntegration.isEnabled })}
                  className="flex cursor-pointer items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-4"
                >
                  <div>
                    <p className="text-sm font-bold text-gray-700">Integración activa</p>
                    <p className="text-xs text-gray-500">Disponible para métodos de pago integrados.</p>
                  </div>
                  <div className={`h-6 w-12 rounded-full transition-colors ${editingIntegration.isEnabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <div className={`mt-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${editingIntegration.isEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Wifi size={18} className="text-indigo-600" />
                  <h4 className="text-sm font-bold uppercase tracking-wide text-indigo-800">Conectividad</h4>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">
                      {editingIntegration.provider === 'CARDNET'
                        ? 'IP / Endpoint del terminal Ethernet'
                        : editingIntegration.provider === 'INGENICO_AZUL_WEBAPI'
                          ? 'URL Base WebAPI Local'
                          : 'URL Base JSON'}
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={editingIntegration.baseUrl}
                        onChange={(event) => updateEditingIntegration({ baseUrl: event.target.value })}
                        className="w-full rounded-xl border border-indigo-100 bg-white p-3 pl-10 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                        placeholder={
                          editingIntegration.provider === 'CARDNET'
                            ? '192.168.1.10:7060'
                            : editingIntegration.provider === 'INGENICO_AZUL_WEBAPI'
                              ? 'http://localhost:9000'
                              : 'https://pruebas.azul.com.do/POSWebServices/JSON/default.aspx'
                        }
                      />
                      <Server className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                    </div>
                  </div>
                  {editingIntegration.provider === 'AZUL' && (
                    <>
                      <div className="md:col-span-2">
                        <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">URL Secundaria / Failover</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={editingIntegration.secondaryBaseUrl || ''}
                            onChange={(event) => updateEditingIntegration({ secondaryBaseUrl: event.target.value })}
                            className="w-full rounded-xl border border-indigo-100 bg-white p-3 pl-10 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                            placeholder="Opcional"
                          />
                          <RefreshCw className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">Merchant ID</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={editingIntegration.merchantId || ''}
                            onChange={(event) => updateEditingIntegration({ merchantId: event.target.value })}
                            className="w-full rounded-xl border border-indigo-100 bg-white p-3 pl-10 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                            placeholder="39036630010"
                          />
                          <Server className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">Terminal ID</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={editingIntegration.terminalId || ''}
                            onChange={(event) => updateEditingIntegration({ terminalId: event.target.value })}
                            className="w-full rounded-xl border border-indigo-100 bg-white p-3 pl-10 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                            placeholder="01290010"
                          />
                          <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">Auth1</label>
                        <div className="relative">
                          <input
                            type="password"
                            value={editingIntegration.auth1 || ''}
                            onChange={(event) => updateEditingIntegration({ auth1: event.target.value })}
                            className="w-full rounded-xl border border-indigo-100 bg-white p-3 pl-10 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                            placeholder="••••••"
                          />
                          <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">Auth2</label>
                        <div className="relative">
                          <input
                            type="password"
                            value={editingIntegration.auth2 || ''}
                            onChange={(event) => updateEditingIntegration({ auth2: event.target.value })}
                            className="w-full rounded-xl border border-indigo-100 bg-white p-3 pl-10 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                            placeholder="••••••"
                          />
                          <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                        </div>
                      </div>
                    </>
                  )}
                  {editingIntegration.provider === 'CARDNET' && (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">Terminal ID (8)</label>
                        <div className="relative">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={editingIntegration.terminalId || ''}
                            onChange={(event) => updateEditingIntegration({ terminalId: event.target.value })}
                            className="w-full rounded-xl border border-indigo-100 bg-white p-3 pl-10 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                            placeholder="12345678"
                          />
                          <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">Merchant ID (15)</label>
                        <div className="relative">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={editingIntegration.merchantId || ''}
                            onChange={(event) => updateEditingIntegration({ merchantId: event.target.value })}
                            className="w-full rounded-xl border border-indigo-100 bg-white p-3 pl-10 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                            placeholder="000000000000000"
                          />
                          <Server className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">Multi-Merchant (2)</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={editingIntegration.metadata?.[CARDNET_METADATA_KEYS.multiMerchantId] || ''}
                          onChange={(event) => updateEditingMetadata(CARDNET_METADATA_KEYS.multiMerchantId, event.target.value)}
                          className="w-full rounded-xl border border-indigo-100 bg-white p-3 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                          placeholder="Opcional · 99 = todas las empresas"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">Delimitadores de trama</label>
                        <select
                          value={resolveCardNetFraming(editingIntegration)}
                          onChange={(event) => updateEditingMetadata(CARDNET_METADATA_KEYS.framing, event.target.value)}
                          className="w-full rounded-xl border border-indigo-100 bg-white p-3 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                        >
                          {Object.entries(CARDNET_FRAMING_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">Timeout (ms)</label>
                    <input
                      type="number"
                      min={1000}
                      step={1000}
                      value={editingIntegration.timeoutMs || defaultTimeoutMsFor(editingIntegration.provider)}
                      onChange={(event) => updateEditingIntegration({
                        timeoutMs: Number(event.target.value) || defaultTimeoutMsFor(editingIntegration.provider),
                      })}
                      className="w-full rounded-xl border border-indigo-100 bg-white p-3 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                </div>

                {editingIntegration.provider === 'INGENICO_AZUL_WEBAPI' && (
                  <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
                    <p className="font-bold">Companion app Android local</p>
                    <p className="mt-1">
                      Esta integración espera que la APK de Azul Ingenico WebAPI esté instalada en el mismo dispositivo y exponga su API local, por defecto en <code>http://localhost:9000</code>.
                    </p>
                  </div>
                )}

                {editingIntegration.provider === 'CARDNET' && (
                  <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    <p className="font-bold">Canal ECR Ethernet (CardNET v2.25)</p>
                    <p className="mt-1">
                      La caja actúa como ECR y se conecta por TCP al terminal CardNET en el puerto <code>7060</code>
                      usando el diálogo <code>ENQ → ACK → SYN → EOM → ENQ</code>. Solo funciona en la APK Android
                      (usa el plugin nativo <code>CardNetEcr</code>); el navegador no puede abrir sockets TCP.
                    </p>
                    <p className="mt-2">
                      El terminal debe estar en modo caja e incluir la IP de esta terminal en su lista blanca.
                      Con la venta (<code>CN00</code>) se envían monto, ITBIS, otros impuestos y el ticket de la factura.
                    </p>
                  </div>
                )}

                <div className="mt-5 space-y-3">
                  <button
                    onClick={handleTestConnection}
                    disabled={isTesting}
                    className={`flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-bold transition-all ${
                      testResult?.success
                        ? 'border-emerald-200 bg-emerald-100 text-emerald-700'
                        : testResult && !testResult.success
                          ? 'border-red-200 bg-red-100 text-red-700'
                          : 'border-indigo-200 bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                    }`}
                  >
                    {isTesting ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" /> Probando conexión...
                      </>
                    ) : testResult?.success ? (
                      <>
                        <CheckCircle2 size={16} /> Conexión exitosa
                      </>
                    ) : testResult ? (
                      <>
                        <AlertCircle size={16} /> Falló la conexión
                      </>
                    ) : (
                      <>
                        <Wifi size={16} /> Probar conexión
                      </>
                    )}
                  </button>

                  {testResult && (
                    <div className={`rounded-xl border px-4 py-3 text-sm ${testResult.success ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                      {testResult.message}
                    </div>
                  )}
                </div>
              </div>

              {editingIntegration.provider !== 'AZUL' && editingIntegration.provider !== 'CARDNET' && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                  {editingIntegration.provider === 'INGENICO_AZUL_WEBAPI'
                    ? 'La integración local de Ingenico se usa desde métodos de pago tipo tarjeta. En esta primera entrega queda soportado el flujo principal de cobro en caja.'
                    : 'Esta primera entrega deja el modelo listo para múltiples adquirentes, pero el flujo operativo en caja está implementado ahora mismo para AZUL, Ingenico Azul WebAPI y CardNET ECR.'}
                </div>
              )}
            </div>

            <div className="sticky bottom-0 z-10 flex justify-end gap-3 border-t border-gray-100 bg-gray-50 p-5">
              <button
                onClick={() => setIsEditorOpen(false)}
                className="rounded-xl px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveIntegration}
                className="rounded-xl bg-blue-600 px-6 py-2.5 font-bold text-white hover:bg-blue-700"
              >
                Guardar Integración
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedAuditIntegration && (
        <IntegrationAuditModal
          integration={selectedAuditIntegration}
          onClose={() => setAuditIntegrationId(null)}
        />
      )}

      {azulTerminalModal && (
        <AzulSettlementModal
          integration={azulTerminalModal.integration}
          mode={azulTerminalModal.mode}
          providerLabel={PROVIDER_LABELS[azulTerminalModal.integration.provider]}
          isLoadingTotals={azulTerminalModal.isLoadingTotals}
          isSettling={azulTerminalModal.isSettling}
          previewResult={azulTerminalModal.previewResult}
          settledResult={azulTerminalModal.settledResult}
          errorMessage={azulTerminalModal.errorMessage}
          printWarning={azulTerminalModal.printWarning}
          allowSettleWithoutPreview={
            azulTerminalModal.integration.provider === 'INGENICO_AZUL_WEBAPI'
            || azulTerminalModal.integration.provider === 'CARDNET'
          }
          onRefreshTotals={() => {
            void handleLoadAzulTotals(azulTerminalModal.integration, azulTerminalModal.mode);
          }}
          onConfirmSettle={() => {
            void handleConfirmAzulSettle();
          }}
          onClose={() => setAzulTerminalModal(null)}
        />
      )}
    </div>
  );
};

export default IntegrationSettings;
