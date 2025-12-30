/**
 * API client for all data fetching
 * In dev mode, /api prefix is used and stripped by vite proxy
 * In prod, requests go directly to the backend domain
 */

const API_URL = import.meta.env.DEV ? "/api" : "https://ncr-aloha.tylanmiller.tech";

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API Error: ${res.status}`);
  }

  return res.json();
}

// Menu API
export const menuApi = {
  getMenu: () => fetchApi<Menu>("/menu"),
  getMenuByCategory: (category: string) => fetchApi<{ category: string; items: MenuItem[] }>(`/menu/${category}`),

  // Item CRUD
  createItem: (item: CreateMenuItem) =>
    fetchApi<MenuItem>("/admin/menu/items", { method: "POST", body: JSON.stringify(item) }),
  updateItem: (itemId: string, item: Partial<CreateMenuItem>) =>
    fetchApi<MenuItem>(`/admin/menu/items/${itemId}`, { method: "PUT", body: JSON.stringify(item) }),
  deleteItem: (itemId: string) =>
    fetchApi<{ success: boolean; message: string }>(`/admin/menu/items/${itemId}`, { method: "DELETE" }),
  toggleAvailability: (itemId: string, available: boolean) =>
    fetchApi<MenuItem>(`/admin/menu/items/${itemId}/availability`, {
      method: "PATCH",
      body: JSON.stringify({ available }),
    }),

  // Category CRUD
  createCategory: (name: string) =>
    fetchApi<{ name: string; message: string }>("/admin/menu/categories", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  renameCategory: (oldName: string, newName: string) =>
    fetchApi<{ oldName: string; newName: string; message: string }>(
      `/admin/menu/categories/${encodeURIComponent(oldName)}`,
      { method: "PUT", body: JSON.stringify({ name: newName }) }
    ),
  deleteCategory: (name: string) =>
    fetchApi<{ success: boolean; message: string }>(
      `/admin/menu/categories/${encodeURIComponent(name)}`,
      { method: "DELETE" }
    ),

  // Modifier Group CRUD
  createModifierGroup: (group: CreateModifierGroup) =>
    fetchApi<ModifierGroup>("/admin/menu/modifier-groups", {
      method: "POST",
      body: JSON.stringify(group),
    }),
  updateModifierGroup: (groupId: string, group: Partial<CreateModifierGroup>) =>
    fetchApi<ModifierGroup>(`/admin/menu/modifier-groups/${groupId}`, {
      method: "PUT",
      body: JSON.stringify(group),
    }),
  deleteModifierGroup: (groupId: string) =>
    fetchApi<{ success: boolean; message: string }>(
      `/admin/menu/modifier-groups/${groupId}`,
      { method: "DELETE" }
    ),
};

// Orders API (local order history)
export const ordersApi = {
  getOrders: () => fetchApi<{ orders: Order[] }>("/admin/orders"),
  getOrder: (orderId: string) => fetchApi<Order>(`/admin/orders/${orderId}`),
  acknowledgeOrder: (orderId: string) =>
    fetchApi<Order>(`/admin/orders/${orderId}/acknowledge`, { method: "POST" }),
};

// Calls API (voice call history)
export const callsApi = {
  getCalls: (limit?: number) =>
    fetchApi<CallsResponse>(`/calls${limit ? `?limit=${limit}` : ""}`),
  getCall: (sessionId: string) => fetchApi<CallMetrics>(`/calls/${sessionId}`),
};

// Sites API
export const sitesApi = {
  getSites: () => fetchApi<{ sites: Site[] }>("/admin/sites"),
  getSite: (siteId: string) => fetchApi<Site>(`/admin/sites/${siteId}`),
};

// Types
export interface Menu {
  restaurant: string;
  categories: string[];
  items: MenuItem[];
  modifierGroups: ModifierGroup[];
}

export interface MenuItem {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  category: string;
  basePrice: number;
  sizes?: MenuItemSize[];
  modifierGroups?: string[];
  available: boolean;
}

export interface MenuItemSize {
  id: string;
  name: string;
  aliases: string[];
  priceAdjustment: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  modifiers: Modifier[];
}

export interface Modifier {
  id: string;
  name: string;
  aliases: string[];
  price: number;
}

// Input types for create/update operations
export interface CreateMenuItem {
  id: string;
  name: string;
  aliases?: string[];
  description?: string;
  category: string;
  basePrice: number;
  sizes?: MenuItemSize[];
  modifierGroups?: string[];
  available?: boolean;
}

export interface CreateModifierGroup {
  id: string;
  name: string;
  required?: boolean;
  minSelections?: number;
  maxSelections?: number;
  modifiers: Modifier[];
}

export interface Site {
  id: string;
  enterpriseUnitId: string;
  siteName: string;
  status: "ACTIVE" | "INACTIVE";
  address?: {
    line1?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
  timezone?: string;
}

export type OrderStatus =
  | "OrderPlaced"
  | "OrderReceived"
  | "InProgress"
  | "ReadyForPickup"
  | "OutForDelivery"
  | "Completed"
  | "Cancelled";

export interface Order {
  id: string;
  status: OrderStatus | string;
  channel?: string;
  currency?: string;
  customer: {
    name: string;
    phone: string;
    email?: string;
  };
  fulfillment?: {
    type: "Pickup" | "Delivery" | "DineIn";
  };
  orderLines: OrderLine[];
  totals?: Array<{ type: string; value: number }>;
  taxes?: Array<{ amount: number; code: string; percentage: number }>;
  createdAt?: string;
  acknowledged?: boolean;
  comments?: string;
}

export interface OrderLine {
  productId: { type: string; value: string };
  description?: string;
  quantity: { value: number; unitOfMeasure: string };
  unitPrice: number;
  extendedAmount: number;
  notes?: Array<{ type: string; value: string }>;
}

export interface TranscriptEntry {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface CallMetrics {
  sessionId: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  turnCount: number;
  interruptions: number;
  orderSubmitted: boolean;
  orderId?: string;
  errors: string[];
  customerName?: string;
  customerPhone?: string;
  transcript?: TranscriptEntry[];
}

export interface CallsResponse {
  summary: {
    totalCalls: number;
    successfulOrders: number;
    conversionRate: string;
    avgDurationSeconds: string;
    avgTurns: string;
  };
  calls: CallMetrics[];
}
