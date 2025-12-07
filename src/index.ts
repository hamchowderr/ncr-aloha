/**
 * NCR Aloha Voice Ordering Integration
 *
 * This module provides the bridge between voice AI (Pipecat) and NCR Aloha POS.
 *
 * Main exports:
 * - OrderService: High-level service for processing voice orders
 * - MenuMatcher: Fuzzy matching for spoken items to menu
 * - NcrClient: Low-level API client with HMAC auth
 */

// Services
export { OrderService } from "./services/order-service.js";
export { OrderBuilder } from "./services/order-builder.js";
export { MenuMatcher } from "./services/menu-matcher.js";

// API clients
export { ncrClient, NcrClient } from "./api/client.js";
export { ordersApi } from "./api/orders.js";
export { catalogApi } from "./api/catalog.js";

// Auth
export { generateAuthHeader, generateNcrHeaders } from "./auth/hmac.js";

// Models
export type {
  Order,
  OrderLine,
  Customer,
  Fulfillment,
  Payment,
  CreateOrderRequest,
} from "./models/order.js";

export type {
  Menu,
  MenuItem,
  Modifier,
  ModifierGroup,
  VoiceOrder,
  VoiceOrderItem,
} from "./models/menu.js";

export type {
  CatalogItem,
  ItemPrice,
  ItemAttributes,
  LinkGroup,
} from "./models/catalog.js";

// Sample data
export { allstarMenu } from "./data/allstar-menu.js";

// Config
export { config } from "./config/index.js";
