import type { VoiceOrder, Menu } from "../models/menu.js";
import type { Order } from "../models/order.js";
import { OrderBuilder } from "./order-builder.js";
import { ordersApi } from "../api/orders.js";

interface SubmitOrderResult {
  success: boolean;
  orderId?: string;
  order?: Order;
  errors: string[];
  warnings: string[];
}

/**
 * High-level order service for voice ordering flow
 */
export class OrderService {
  private builder: OrderBuilder;

  constructor(menu: Menu) {
    this.builder = new OrderBuilder(menu);
  }

  /**
   * Process a voice order end-to-end:
   * 1. Validate and resolve items
   * 2. Build NCR order format
   * 3. Submit to NCR API
   */
  async submitOrder(voiceOrder: VoiceOrder): Promise<SubmitOrderResult> {
    // Build the order
    const buildResult = this.builder.build(voiceOrder);

    if (!buildResult.success || !buildResult.order) {
      return {
        success: false,
        errors: buildResult.errors,
        warnings: buildResult.warnings,
      };
    }

    // Submit to NCR
    const response = await ordersApi.create(buildResult.order);

    if (!response.ok) {
      return {
        success: false,
        errors: [...buildResult.errors, `NCR API Error: ${response.error}`],
        warnings: buildResult.warnings,
      };
    }

    return {
      success: true,
      orderId: response.data?.id,
      order: response.data,
      errors: buildResult.errors,
      warnings: buildResult.warnings,
    };
  }

  /**
   * Validate a voice order without submitting
   * Useful for confirming with the customer before placing
   */
  validateOrder(voiceOrder: VoiceOrder): {
    valid: boolean;
    orderSummary?: {
      items: Array<{
        name: string;
        quantity: number;
        price: number;
        modifiers: string[];
      }>;
      subtotal: number;
      tax: number;
      total: number;
    };
    errors: string[];
    warnings: string[];
  } {
    const buildResult = this.builder.build(voiceOrder);

    if (!buildResult.success || !buildResult.order) {
      return {
        valid: false,
        errors: buildResult.errors,
        warnings: buildResult.warnings,
      };
    }

    const order = buildResult.order;
    const items = order.orderLines.map((line) => ({
      name: line.description || line.productId.value,
      quantity: line.quantity.value,
      price: line.extendedAmount,
      modifiers: line.notes
        ?.filter((n) => n.type === "Preferences")
        .map((n) => n.value) || [],
    }));

    const subtotal = order.totals?.find((t) => t.type === "TaxExcluded")?.value || 0;
    const taxAmount = order.taxes?.[0]?.amount || 0;
    const total = order.totals?.find((t) => t.type === "Net")?.value || 0;

    return {
      valid: true,
      orderSummary: {
        items,
        subtotal,
        tax: taxAmount,
        total,
      },
      errors: buildResult.errors,
      warnings: buildResult.warnings,
    };
  }

  /**
   * Get order status
   */
  async getOrderStatus(orderId: string): Promise<{
    found: boolean;
    status?: string | undefined;
    order?: Order | undefined;
    error?: string | undefined;
  }> {
    const response = await ordersApi.getById(orderId);

    if (!response.ok) {
      return {
        found: false,
        error: response.error ?? "Unknown error",
      };
    }

    return {
      found: true,
      status: response.data?.status,
      order: response.data,
    };
  }
}
