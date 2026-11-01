import { BusinessConfig, Transaction } from '../types';
import { DEFAULT_PUBLIC_ERP_BASE_URL as DEFAULT_ERP_BASE_URL } from '../utils/erpBaseUrl';

const normalizeString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeBaseUrl = (value: unknown): string => {
  const normalized = normalizeString(value).replace(/\/+$/, '');
  return normalized || DEFAULT_ERP_BASE_URL;
};

const resolveFromStorage = (keys: string[]): string => {
  if (typeof window === 'undefined') return '';

  for (const key of keys) {
    try {
      const value = normalizeString(localStorage.getItem(key));
      if (value) return value;
    } catch {
      // Ignore localStorage access failures.
    }
  }

  return '';
};

const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error((data as any)?.message || (data as any)?.error || `HTTP ${response.status}`);
  }

  return data as T;
};

export interface UberEatsPosContext {
  baseUrl: string;
  tenantId: string;
  companyId?: string;
  storeId?: string;
}

export interface UberEatsPendingOrder {
  id: string;
  uberOrderId: string;
  displayId: string;
  status: string;
  posSyncStatus: string;
  total: number;
  itemCount: number;
  customerName: string;
  placedAt?: string;
}

export interface UberEatsPosDraftItem {
  line_number?: number;
  external_item_id?: string;
  erp_item_id?: string;
  sku?: string;
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
  modifiers?: Array<{ name?: string; quantity?: number; price?: number }>;
  raw?: Record<string, unknown>;
}

export interface UberEatsPosDraftPayment {
  method: 'UBER_EATS';
  label: string;
  amount: number;
  external_reference?: string;
}

export interface UberEatsPosDraft {
  source_channel: 'UBER_EATS';
  source_order_id: string;
  source_store_id: string;
  tenant_id: string;
  company_id?: string;
  store_id?: string;
  status?: string;
  customer?: {
    external_id?: string | null;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  items: UberEatsPosDraftItem[];
  totals: {
    total: number;
    item_count?: number;
  };
  payments: UberEatsPosDraftPayment[];
  metadata?: Record<string, unknown>;
}

interface UberEatsPendingOrdersResponse {
  ok: boolean;
  orders?: Array<Record<string, any>>;
}

interface UberEatsDraftResponse {
  ok: boolean;
  draft?: UberEatsPosDraft;
}

export const resolveUberEatsPosContext = (
  config?: BusinessConfig,
  activeTerminalId?: string
): UberEatsPosContext => {
  const terminal = (config?.terminals || []).find((entry) => entry.id === activeTerminalId)
    || (config?.terminals || [])[0];
  const binding = terminal?.config?.erpBinding;
  const snapshot = terminal?.config?.erpSnapshot;
  const metadata = terminal?.config?.metadata || {};

  const baseUrl = normalizeBaseUrl(
    resolveFromStorage(['CLIC_ERP_BASE_URL', 'erp_base_url'])
    || metadata.erp_base_url
  );

  const tenantId = normalizeString(
    resolveFromStorage(['clic_erp_sync_tenant_id', 'active_tenant_id', 'clic_tenant_id'])
    || binding?.tenantId
    || snapshot?.tenant_id
  );

  if (!tenantId) {
    throw new Error('No se encontró tenant_id configurado para consultar Uber Eats desde ERP.');
  }

  const companyId = normalizeString(
    resolveFromStorage(['clic_erp_sync_company_id'])
    || binding?.companyId
    || snapshot?.company_id
  ) || undefined;

  const storeId = normalizeString(
    resolveFromStorage(['clic_erp_sync_store_id'])
    || binding?.storeId
    || snapshot?.store_id
  ) || undefined;

  return {
    baseUrl,
    tenantId,
    companyId,
    storeId,
  };
};

export const fetchUberEatsPendingOrders = async (
  context: UberEatsPosContext,
  limit = 25
): Promise<UberEatsPendingOrder[]> => {
  const params = new URLSearchParams({
    tenant_id: context.tenantId,
    pos_sync_status: 'PUSHED_TO_POS',
    limit: String(limit),
  });
  const url = `${context.baseUrl}/api/uber-eats/orders?${params.toString()}`;
  const response = await fetchJson<UberEatsPendingOrdersResponse>(url);
  const orders = Array.isArray(response.orders) ? response.orders : [];

  return orders.map((order) => {
    const payload = order?.payload || {};
    const payment = payload?.payment?.charges?.total;
    const items = Array.isArray(payload?.cart?.items) ? payload.cart.items : [];
    const total = Number(order?.total || payment?.amount / 100 || 0);

    return {
      id: normalizeString(order?.id) || normalizeString(order?.uber_order_id),
      uberOrderId: normalizeString(order?.uber_order_id) || normalizeString(payload?.id),
      displayId: normalizeString(payload?.display_id),
      status: normalizeString(order?.status) || normalizeString(payload?.current_state),
      posSyncStatus: normalizeString(order?.pos_sync_status),
      total,
      itemCount: items.length,
      customerName: normalizeString(payload?.eater?.first_name)
        ? `${normalizeString(payload?.eater?.first_name)} ${normalizeString(payload?.eater?.last_name)}`.trim()
        : normalizeString(payload?.eaters?.[0]?.first_name),
      placedAt: normalizeString(payload?.placed_at) || undefined,
    };
  }).filter((order) => order.uberOrderId);
};

export const fetchUberEatsOrderDraft = async (
  context: UberEatsPosContext,
  uberOrderId: string
): Promise<UberEatsPosDraft> => {
  const url = `${context.baseUrl}/api/uber-eats/orders/${encodeURIComponent(uberOrderId)}/pos-draft`;
  const response = await fetchJson<UberEatsDraftResponse>(url);
  if (!response?.draft) {
    throw new Error('ERP no devolvió el draft POS de la orden Uber Eats.');
  }
  return response.draft;
};

export const confirmUberEatsPosInvoice = async (
  context: UberEatsPosContext,
  uberOrderId: string,
  transaction: Pick<Transaction, 'id' | 'displayId'>
): Promise<void> => {
  const url = `${context.baseUrl}/api/uber-eats/orders/${encodeURIComponent(uberOrderId)}/pos-invoice`;
  await fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pos_transaction_id: transaction.id,
      document_code: transaction.displayId || transaction.id,
      application_result: {
        document_id: transaction.id,
        document_code: transaction.displayId || transaction.id,
      },
    }),
  });
};
