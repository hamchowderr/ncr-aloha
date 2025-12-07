import { ncrClient } from "./client.js";
import { config } from "../config/index.js";
import type { Order, OrderLine, CreateOrderRequest } from "../models/order.js";

const basePath = config.services.order;

export const ordersApi = {
  /**
   * Create a new order
   */
  async create(order: CreateOrderRequest) {
    return ncrClient.post<Order>(basePath, order);
  },

  /**
   * Get an order by ID
   */
  async getById(orderId: string) {
    return ncrClient.get<Order>(`${basePath}/${orderId}`);
  },

  /**
   * Find orders by criteria
   */
  async find(criteria: { enterpriseUnitId?: string }) {
    return ncrClient.post<{ orders: Order[] }>(`${basePath}/find`, criteria);
  },

  /**
   * Update an order (full replacement)
   */
  async replace(orderId: string, order: CreateOrderRequest) {
    return ncrClient.put<Order>(`${basePath}/${orderId}`, order);
  },

  /**
   * Partially update an order
   */
  async patch(orderId: string, updates: Partial<CreateOrderRequest>) {
    return ncrClient.patch<Order>(`${basePath}/${orderId}`, updates);
  },

  /**
   * Acknowledge an order
   */
  async acknowledge(orderId: string) {
    return ncrClient.post<Order>(`${basePath}/${orderId}/acknowledge`, {});
  },

  /**
   * Lock an order for processing
   */
  async lock(orderId: string) {
    return ncrClient.post<Order>(`${basePath}/${orderId}/lock`, {});
  },

  /**
   * Unlock an order
   */
  async unlock(orderId: string) {
    return ncrClient.post<Order>(`${basePath}/${orderId}/unlock`, {});
  },

  /**
   * Find unacknowledged orders
   */
  async findUnacknowledged() {
    return ncrClient.post<{ orders: Order[] }>(`${basePath}/find`, {
      enterpriseUnitId: config.ncr.siteId,
      acknowledged: false,
    });
  },
};
