import { Router } from "express";
import { sitesApi } from "../api/sites.js";
import { catalogApi } from "../api/catalog.js";
import { ordersApi } from "../api/orders.js";
import { config } from "../config/index.js";
import { allstarMenu } from "../data/allstar-menu.js";
import { menuFileService } from "../services/menu-file-service.js";
import { menuValidator } from "../services/menu-validator.js";
import type { MenuItem, ModifierGroup } from "../models/menu.js";

const router = Router();

// In-memory order storage (shared with server.ts via export)
// For demo purposes - in production use a database
interface StoredOrder {
  id: string;
  status: string;
  channel: string;
  currency: string;
  customer: { name: string; phone: string; email?: string };
  fulfillment: { type: string };
  orderLines: Array<{
    productId: { type: string; value: string };
    description: string;
    quantity: { value: number; unitOfMeasure: string };
    unitPrice: number;
    extendedAmount: number;
  }>;
  totals: Array<{ type: string; value: number }>;
  taxes: Array<{ amount: number; code: string; percentage: number }>;
  createdAt: string;
  acknowledged: boolean;
}

// Export for use in server.ts
// Pre-populated with mock data for demo purposes
export const orderStore: StoredOrder[] = [
  {
    id: "ORD-001",
    status: "OrderPlaced",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "John Smith", phone: "416-555-1234" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "WINGS-ORIGINAL" },
        description: "Original Wings - 2 lb (Honey Garlic)",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 30.99,
        extendedAmount: 30.99,
      },
      {
        productId: { type: "SKU", value: "FRIES-REGULAR" },
        description: "Regular Fries",
        quantity: { value: 2, unitOfMeasure: "EA" },
        unitPrice: 5.99,
        extendedAmount: 11.98,
      },
    ],
    totals: [{ type: "Net", value: 42.97 }],
    taxes: [{ amount: 5.59, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 48 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-002",
    status: "OrderReceived",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Sarah Johnson", phone: "647-555-5678" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "RIBS-PORK-FULL" },
        description: "Full Rack Pork Ribs (BBQ)",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 34.99,
        extendedAmount: 34.99,
      },
    ],
    totals: [{ type: "Net", value: 34.99 }],
    taxes: [{ amount: 4.55, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 46 * 60 * 60 * 1000).toISOString(), // 46 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-003",
    status: "InProgress",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Mike Chen", phone: "905-555-9012" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "WINGS-LORD" },
        description: "Lord of the Wing - 3 lb (Hot, Medium)",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 45.99,
        extendedAmount: 45.99,
      },
      {
        productId: { type: "SKU", value: "DRINK-POP" },
        description: "Soft Drink",
        quantity: { value: 3, unitOfMeasure: "EA" },
        unitPrice: 2.99,
        extendedAmount: 8.97,
      },
    ],
    totals: [{ type: "Net", value: 54.96 }],
    taxes: [{ amount: 7.14, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 44 * 60 * 60 * 1000).toISOString(), // 44 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-004",
    status: "Ready",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Emily Davis", phone: "416-555-3456" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "BURGER-CLASSIC" },
        description: "Classic Burger with Fries",
        quantity: { value: 2, unitOfMeasure: "EA" },
        unitPrice: 15.99,
        extendedAmount: 31.98,
      },
      {
        productId: { type: "SKU", value: "WINGS-BITES" },
        description: "Boneless Bites - 1 lb (Salt & Pepper)",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 15.99,
        extendedAmount: 15.99,
      },
    ],
    totals: [{ type: "Net", value: 47.97 }],
    taxes: [{ amount: 6.24, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 42 * 60 * 60 * 1000).toISOString(), // 42 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-005",
    status: "Completed",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "David Wilson", phone: "647-555-7890" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "WINGS-ORIGINAL" },
        description: "Original Wings - 5 lb (Suicide, BBQ)",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 68.99,
        extendedAmount: 68.99,
      },
    ],
    totals: [{ type: "Net", value: 68.99 }],
    taxes: [{ amount: 8.97, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString(), // 40 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-006",
    status: "Completed",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Lisa Brown", phone: "905-555-2345" },
    fulfillment: { type: "Delivery" },
    orderLines: [
      {
        productId: { type: "SKU", value: "RIBS-PORK-HALF" },
        description: "Half Rack Pork Ribs (Honey Garlic)",
        quantity: { value: 2, unitOfMeasure: "EA" },
        unitPrice: 19.99,
        extendedAmount: 39.98,
      },
      {
        productId: { type: "SKU", value: "SALAD-CAESAR" },
        description: "Caesar Salad",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 12.99,
        extendedAmount: 12.99,
      },
    ],
    totals: [{ type: "Net", value: 52.97 }],
    taxes: [{ amount: 6.89, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 38 * 60 * 60 * 1000).toISOString(), // 38 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-007",
    status: "Cancelled",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Tom Anderson", phone: "416-555-6789" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "WINGS-KING" },
        description: "King of the Wing - 2 lb",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 33.99,
        extendedAmount: 33.99,
      },
    ],
    totals: [{ type: "Net", value: 33.99 }],
    taxes: [{ amount: 4.42, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString(), // 36 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-008",
    status: "Refunded",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Jennifer Lee", phone: "647-555-4321" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "APPETIZER-NACHOS" },
        description: "Loaded Nachos",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 14.99,
        extendedAmount: 14.99,
      },
      {
        productId: { type: "SKU", value: "WINGS-ORIGINAL" },
        description: "Original Wings - 1 lb (Lemon Pepper)",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 16.99,
        extendedAmount: 16.99,
      },
    ],
    totals: [{ type: "Net", value: 31.98 }],
    taxes: [{ amount: 4.16, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 34 * 60 * 60 * 1000).toISOString(), // 34 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-009",
    status: "Completed",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Robert Taylor", phone: "416-555-8765" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "WINGS-VEGAN-CAULI" },
        description: "Vegan Cauliflower Wings (Buffalo)",
        quantity: { value: 2, unitOfMeasure: "EA" },
        unitPrice: 14.99,
        extendedAmount: 29.98,
      },
    ],
    totals: [{ type: "Net", value: 29.98 }],
    taxes: [{ amount: 3.90, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 32 * 60 * 60 * 1000).toISOString(), // 32 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-010",
    status: "Completed",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Amanda White", phone: "905-555-1122" },
    fulfillment: { type: "Delivery" },
    orderLines: [
      {
        productId: { type: "SKU", value: "BURGER-BACON" },
        description: "Bacon Cheeseburger with Fries",
        quantity: { value: 3, unitOfMeasure: "EA" },
        unitPrice: 17.99,
        extendedAmount: 53.97,
      },
      {
        productId: { type: "SKU", value: "DRINK-POP" },
        description: "Soft Drink",
        quantity: { value: 3, unitOfMeasure: "EA" },
        unitPrice: 2.99,
        extendedAmount: 8.97,
      },
    ],
    totals: [{ type: "Net", value: 62.94 }],
    taxes: [{ amount: 8.18, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(), // 30 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-011",
    status: "Completed",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Kevin Martinez", phone: "647-555-3344" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "RIBS-BEEF" },
        description: "Beef Ribs Full Rack",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 42.99,
        extendedAmount: 42.99,
      },
      {
        productId: { type: "SKU", value: "FRIES-LOADED" },
        description: "Loaded Fries",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 12.99,
        extendedAmount: 12.99,
      },
    ],
    totals: [{ type: "Net", value: 55.98 }],
    taxes: [{ amount: 7.28, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 28 * 60 * 60 * 1000).toISOString(), // 28 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-012",
    status: "Completed",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Nicole Garcia", phone: "416-555-5566" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "WINGS-ORIGINAL" },
        description: "Original Wings - 1 lb (Teriyaki)",
        quantity: { value: 2, unitOfMeasure: "EA" },
        unitPrice: 16.99,
        extendedAmount: 33.98,
      },
    ],
    totals: [{ type: "Net", value: 33.98 }],
    taxes: [{ amount: 4.42, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(), // 26 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-013",
    status: "Completed",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Chris Robinson", phone: "905-555-7788" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "STEAK-RIBEYE" },
        description: "12oz Ribeye Steak",
        quantity: { value: 2, unitOfMeasure: "EA" },
        unitPrice: 34.99,
        extendedAmount: 69.98,
      },
      {
        productId: { type: "SKU", value: "SALAD-GARDEN" },
        description: "Garden Salad",
        quantity: { value: 2, unitOfMeasure: "EA" },
        unitPrice: 9.99,
        extendedAmount: 19.98,
      },
    ],
    totals: [{ type: "Net", value: 89.96 }],
    taxes: [{ amount: 11.69, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 24 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-014",
    status: "Completed",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Stephanie Clark", phone: "647-555-9900" },
    fulfillment: { type: "Delivery" },
    orderLines: [
      {
        productId: { type: "SKU", value: "WINGS-LORD" },
        description: "Lord of the Wing - 2 lb (Garlic Parmesan)",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 31.99,
        extendedAmount: 31.99,
      },
      {
        productId: { type: "SKU", value: "APPETIZER-MOZZA" },
        description: "Mozzarella Sticks",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 11.99,
        extendedAmount: 11.99,
      },
    ],
    totals: [{ type: "Net", value: 43.98 }],
    taxes: [{ amount: 5.72, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 22 * 60 * 60 * 1000).toISOString(), // 22 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-015",
    status: "Cancelled",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Brian Lewis", phone: "416-555-2233" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "HOTDOG-CLASSIC" },
        description: "Classic Hot Dog",
        quantity: { value: 4, unitOfMeasure: "EA" },
        unitPrice: 8.99,
        extendedAmount: 35.96,
      },
    ],
    totals: [{ type: "Net", value: 35.96 }],
    taxes: [{ amount: 4.67, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(), // 20 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-016",
    status: "Completed",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Rachel Walker", phone: "905-555-4455" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "WINGS-BITES" },
        description: "Boneless Bites - 2 lb (Honey BBQ)",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 28.99,
        extendedAmount: 28.99,
      },
      {
        productId: { type: "SKU", value: "FRIES-SWEET" },
        description: "Sweet Potato Fries",
        quantity: { value: 2, unitOfMeasure: "EA" },
        unitPrice: 7.99,
        extendedAmount: 15.98,
      },
    ],
    totals: [{ type: "Net", value: 44.97 }],
    taxes: [{ amount: 5.85, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString(), // 18 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-017",
    status: "Cancelled",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Jason Hall", phone: "647-555-6677" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "RIBS-PORK-FULL" },
        description: "Full Rack Pork Ribs (Dry Rub)",
        quantity: { value: 2, unitOfMeasure: "EA" },
        unitPrice: 34.99,
        extendedAmount: 69.98,
      },
    ],
    totals: [{ type: "Net", value: 69.98 }],
    taxes: [{ amount: 9.10, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 16 * 60 * 60 * 1000).toISOString(), // 16 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-018",
    status: "Completed",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Michelle Young", phone: "416-555-8899" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "KIDS-FINGERS" },
        description: "Kids Chicken Fingers",
        quantity: { value: 3, unitOfMeasure: "EA" },
        unitPrice: 9.99,
        extendedAmount: 29.97,
      },
      {
        productId: { type: "SKU", value: "KIDS-DRINK" },
        description: "Kids Drink",
        quantity: { value: 3, unitOfMeasure: "EA" },
        unitPrice: 2.49,
        extendedAmount: 7.47,
      },
    ],
    totals: [{ type: "Net", value: 37.44 }],
    taxes: [{ amount: 4.87, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString(), // 14 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-019",
    status: "Refunded",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Daniel King", phone: "905-555-1234" },
    fulfillment: { type: "Delivery" },
    orderLines: [
      {
        productId: { type: "SKU", value: "WINGS-ORIGINAL" },
        description: "Original Wings - 3 lb (Mixed Flavors)",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 44.99,
        extendedAmount: 44.99,
      },
      {
        productId: { type: "SKU", value: "WINGS-LORD" },
        description: "Lord of the Wing - 2 lb (Cajun)",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 31.99,
        extendedAmount: 31.99,
      },
    ],
    totals: [{ type: "Net", value: 76.98 }],
    taxes: [{ amount: 10.01, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-020",
    status: "Completed",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Laura Scott", phone: "647-555-5678" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "BURGER-VEGGIE" },
        description: "Veggie Burger",
        quantity: { value: 2, unitOfMeasure: "EA" },
        unitPrice: 14.99,
        extendedAmount: 29.98,
      },
    ],
    totals: [{ type: "Net", value: 29.98 }],
    taxes: [{ amount: 3.90, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(), // 10 hours ago
    acknowledged: true,
  },
  {
    id: "ORD-021",
    status: "Ready",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Andrew Green", phone: "416-555-9012" },
    fulfillment: { type: "Delivery" },
    orderLines: [
      {
        productId: { type: "SKU", value: "APPETIZER-ONION" },
        description: "Onion Rings",
        quantity: { value: 2, unitOfMeasure: "EA" },
        unitPrice: 9.99,
        extendedAmount: 19.98,
      },
      {
        productId: { type: "SKU", value: "WINGS-KING" },
        description: "King of the Wing - 1 lb (House BBQ)",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 18.99,
        extendedAmount: 18.99,
      },
    ],
    totals: [{ type: "Net", value: 38.97 }],
    taxes: [{ amount: 5.07, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(), // 45 min ago
    acknowledged: true,
  },
  {
    id: "ORD-022",
    status: "InProgress",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Jessica Adams", phone: "905-555-3456" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "DESSERT-BROWNIE" },
        description: "Chocolate Brownie",
        quantity: { value: 4, unitOfMeasure: "EA" },
        unitPrice: 7.99,
        extendedAmount: 31.96,
      },
      {
        productId: { type: "SKU", value: "DESSERT-CHEESECAKE" },
        description: "New York Cheesecake",
        quantity: { value: 2, unitOfMeasure: "EA" },
        unitPrice: 8.99,
        extendedAmount: 17.98,
      },
    ],
    totals: [{ type: "Net", value: 49.94 }],
    taxes: [{ amount: 6.49, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
    acknowledged: true,
  },
  {
    id: "ORD-023",
    status: "InProgress",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Ryan Nelson", phone: "647-555-7890" },
    fulfillment: { type: "Delivery" },
    orderLines: [
      {
        productId: { type: "SKU", value: "WINGS-ORIGINAL" },
        description: "Original Wings - 5 lb Party Pack",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 68.99,
        extendedAmount: 68.99,
      },
    ],
    totals: [{ type: "Net", value: 68.99 }],
    taxes: [{ amount: 8.97, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20 min ago
    acknowledged: true,
  },
  {
    id: "ORD-024",
    status: "OrderReceived",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Samantha Hill", phone: "416-555-2345" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "SALAD-GREEK" },
        description: "Greek Salad",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 13.99,
        extendedAmount: 13.99,
      },
      {
        productId: { type: "SKU", value: "SOUP-DAILY" },
        description: "Soup of the Day",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 6.99,
        extendedAmount: 6.99,
      },
    ],
    totals: [{ type: "Net", value: 20.98 }],
    taxes: [{ amount: 2.73, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
    acknowledged: true,
  },
  {
    id: "ORD-025",
    status: "OrderPlaced",
    channel: "Voice",
    currency: "CAD",
    customer: { name: "Tyler Moore", phone: "905-555-6789" },
    fulfillment: { type: "Pickup" },
    orderLines: [
      {
        productId: { type: "SKU", value: "COMBO-FAMILY" },
        description: "Family Combo - Wings, Ribs, Fries, Coleslaw",
        quantity: { value: 1, unitOfMeasure: "EA" },
        unitPrice: 79.99,
        extendedAmount: 79.99,
      },
    ],
    totals: [{ type: "Net", value: 79.99 }],
    taxes: [{ amount: 10.40, code: "HST", percentage: 13 }],
    createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 min ago
    acknowledged: false,
  },
];

// ============================================================================
// Sites Endpoints
// ============================================================================

/**
 * GET /admin/sites - List all sites
 * Returns configured site from env, or tries NCR API
 */
router.get("/sites", async (req, res) => {
  // First try NCR API
  const result = await sitesApi.list();

  if (result.ok && result.data?.sites?.length) {
    res.json(result.data);
    return;
  }

  // Fall back to configured site from env
  const configuredSite = {
    id: config.ncr.siteId || "demo-site",
    enterpriseUnitId: config.ncr.siteId || "demo-site",
    siteName: allstarMenu.restaurantName,
    status: "ACTIVE" as const,
    address: {
      line1: "Demo Location",
      city: "Toronto",
      state: "ON",
      postalCode: "M5V 1A1",
      country: "CA",
    },
    timezone: "America/Toronto",
    organizationId: config.ncr.organization || "demo-org",
  };

  res.json({ sites: [configuredSite] });
});

/**
 * GET /admin/sites/:siteId - Get site details
 */
router.get("/sites/:siteId", async (req, res) => {
  const result = await sitesApi.getById(req.params.siteId);

  if (result.ok) {
    res.json(result.data);
  } else {
    // Return configured site if it matches
    if (req.params.siteId === config.ncr.siteId || req.params.siteId === "demo-site") {
      res.json({
        id: config.ncr.siteId || "demo-site",
        enterpriseUnitId: config.ncr.siteId || "demo-site",
        siteName: allstarMenu.restaurantName,
        status: "ACTIVE",
        organizationId: config.ncr.organization || "demo-org",
      });
    } else {
      res.status(404).json({ error: "Site not found" });
    }
  }
});

// ============================================================================
// Orders Endpoints - Uses local storage with NCR API fallback
// ============================================================================

/**
 * GET /admin/orders - List orders from local storage
 */
router.get("/orders", async (req, res) => {
  // First try local order store
  if (orderStore.length > 0) {
    let orders = [...orderStore];

    // Apply filters
    if (req.query.status) {
      orders = orders.filter((o) => o.status === req.query.status);
    }

    // Sort by most recent
    orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Apply limit
    const limit = parseInt(req.query.limit as string) || 50;
    orders = orders.slice(0, limit);

    res.json({ orders });
    return;
  }

  // Try NCR API as fallback
  const criteria: Record<string, unknown> = {
    enterpriseUnitId: config.ncr.siteId,
  };

  if (req.query.status) criteria.status = req.query.status;
  if (req.query.fromDate) criteria.fromDate = req.query.fromDate;
  if (req.query.toDate) criteria.toDate = req.query.toDate;
  if (req.query.limit) criteria.pageSize = parseInt(req.query.limit as string) || 50;

  const result = await ordersApi.find(criteria as { enterpriseUnitId?: string });

  if (result.ok) {
    res.json(result.data);
  } else {
    // Return empty array if no orders
    res.json({ orders: [] });
  }
});

/**
 * GET /admin/orders/:orderId - Get order details
 */
router.get("/orders/:orderId", async (req, res) => {
  // Check local store first
  const localOrder = orderStore.find((o) => o.id === req.params.orderId);
  if (localOrder) {
    res.json(localOrder);
    return;
  }

  // Try NCR API
  const result = await ordersApi.getById(req.params.orderId);

  if (result.ok) {
    res.json(result.data);
  } else {
    res.status(404).json({ error: "Order not found" });
  }
});

/**
 * POST /admin/orders/:orderId/acknowledge - Acknowledge an order
 */
router.post("/orders/:orderId/acknowledge", async (req, res) => {
  // Update local store
  const localOrder = orderStore.find((o) => o.id === req.params.orderId);
  if (localOrder) {
    localOrder.acknowledged = true;
    localOrder.status = "OrderReceived";
    res.json(localOrder);
    return;
  }

  // Try NCR API
  const result = await ordersApi.acknowledge(req.params.orderId);

  if (result.ok) {
    res.json(result.data);
  } else {
    res.status(result.status || 500).json({ error: result.error });
  }
});

/**
 * PATCH /admin/orders/:orderId - Update order status
 */
router.patch("/orders/:orderId", async (req, res) => {
  // Update local store
  const localOrder = orderStore.find((o) => o.id === req.params.orderId);
  if (localOrder && req.body.status) {
    localOrder.status = req.body.status;
    res.json(localOrder);
    return;
  }

  // Try NCR API
  const result = await ordersApi.patch(req.params.orderId, req.body);

  if (result.ok) {
    res.json(result.data);
  } else {
    res.status(result.status || 500).json({ error: result.error });
  }
});

// ============================================================================
// Menu Item Endpoints - CRUD for menu items
// ============================================================================

/**
 * POST /admin/menu/items - Create a new menu item
 */
router.post("/menu/items", (req, res) => {
  try {
    const menu = menuFileService.loadMenu();
    const itemData = req.body as MenuItem;

    // Validate
    const validation = menuValidator.validateItem(itemData, menu);
    if (!validation.valid) {
      res.status(400).json({ error: "Validation failed", details: validation.errors });
      return;
    }

    // Add item
    const newItem: MenuItem = {
      id: itemData.id,
      name: itemData.name,
      aliases: itemData.aliases || [],
      description: itemData.description || "",
      category: itemData.category,
      basePrice: itemData.basePrice,
      sizes: itemData.sizes,
      modifierGroups: itemData.modifierGroups,
      available: itemData.available ?? true,
    };

    menu.items.push(newItem);
    menuFileService.saveMenu(menu);

    res.status(201).json(newItem);
  } catch (error) {
    console.error("Error creating menu item:", error);
    res.status(500).json({ error: "Failed to create menu item" });
  }
});

/**
 * PUT /admin/menu/items/:itemId - Update a menu item
 */
router.put("/menu/items/:itemId", (req, res) => {
  try {
    const menu = menuFileService.loadMenu();
    const { itemId } = req.params;
    const itemData = req.body as Partial<MenuItem>;

    // Find existing item
    const itemIndex = menu.items.findIndex((i) => i.id === itemId);
    if (itemIndex === -1) {
      res.status(404).json({ error: "Item not found" });
      return;
    }

    // Merge with existing and validate
    const updatedItem: MenuItem = {
      ...menu.items[itemIndex],
      ...itemData,
      id: itemData.id || itemId, // Allow ID change
    };

    const validation = menuValidator.validateItem(updatedItem, menu, itemId);
    if (!validation.valid) {
      res.status(400).json({ error: "Validation failed", details: validation.errors });
      return;
    }

    menu.items[itemIndex] = updatedItem;
    menuFileService.saveMenu(menu);

    res.json(updatedItem);
  } catch (error) {
    console.error("Error updating menu item:", error);
    res.status(500).json({ error: "Failed to update menu item" });
  }
});

/**
 * DELETE /admin/menu/items/:itemId - Delete a menu item
 */
router.delete("/menu/items/:itemId", (req, res) => {
  try {
    const menu = menuFileService.loadMenu();
    const { itemId } = req.params;

    const itemIndex = menu.items.findIndex((i) => i.id === itemId);
    if (itemIndex === -1) {
      res.status(404).json({ error: "Item not found" });
      return;
    }

    menu.items.splice(itemIndex, 1);
    menuFileService.saveMenu(menu);

    res.json({ success: true, message: "Item deleted" });
  } catch (error) {
    console.error("Error deleting menu item:", error);
    res.status(500).json({ error: "Failed to delete menu item" });
  }
});

/**
 * PATCH /admin/menu/items/:itemId/availability - Toggle item availability
 */
router.patch("/menu/items/:itemId/availability", (req, res) => {
  try {
    const menu = menuFileService.loadMenu();
    const { itemId } = req.params;
    const { available } = req.body;

    const item = menu.items.find((i) => i.id === itemId);
    if (!item) {
      res.status(404).json({ error: "Item not found" });
      return;
    }

    item.available = available;
    menuFileService.saveMenu(menu);

    res.json(item);
  } catch (error) {
    console.error("Error updating item availability:", error);
    res.status(500).json({ error: "Failed to update availability" });
  }
});

// ============================================================================
// Category Endpoints
// ============================================================================

/**
 * POST /admin/menu/categories - Create a new category
 */
router.post("/menu/categories", (req, res) => {
  try {
    const menu = menuFileService.loadMenu();
    const { name } = req.body;

    const validation = menuValidator.validateCategory(name, menu);
    if (!validation.valid) {
      res.status(400).json({ error: "Validation failed", details: validation.errors });
      return;
    }

    menu.categories.push(name);
    menuFileService.saveMenu(menu);

    res.status(201).json({ name, message: "Category created" });
  } catch (error) {
    console.error("Error creating category:", error);
    res.status(500).json({ error: "Failed to create category" });
  }
});

/**
 * PUT /admin/menu/categories/:name - Rename a category
 */
router.put("/menu/categories/:name", (req, res) => {
  try {
    const menu = menuFileService.loadMenu();
    const oldName = decodeURIComponent(req.params.name);
    const { name: newName } = req.body;

    const categoryIndex = menu.categories.findIndex((c) => c === oldName);
    if (categoryIndex === -1) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    const validation = menuValidator.validateCategory(newName, menu, oldName);
    if (!validation.valid) {
      res.status(400).json({ error: "Validation failed", details: validation.errors });
      return;
    }

    // Update category name
    menu.categories[categoryIndex] = newName;

    // Update all items using this category
    menu.items.forEach((item) => {
      if (item.category === oldName) {
        item.category = newName;
      }
    });

    menuFileService.saveMenu(menu);

    res.json({ oldName, newName, message: "Category renamed" });
  } catch (error) {
    console.error("Error renaming category:", error);
    res.status(500).json({ error: "Failed to rename category" });
  }
});

/**
 * DELETE /admin/menu/categories/:name - Delete a category
 */
router.delete("/menu/categories/:name", (req, res) => {
  try {
    const menu = menuFileService.loadMenu();
    const name = decodeURIComponent(req.params.name);

    const categoryIndex = menu.categories.findIndex((c) => c === name);
    if (categoryIndex === -1) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    // Check if any items use this category
    const { canDelete, itemCount } = menuValidator.canDeleteCategory(name, menu);
    if (!canDelete) {
      res.status(400).json({
        error: "Cannot delete category",
        message: `${itemCount} item(s) are using this category. Move or delete them first.`,
      });
      return;
    }

    menu.categories.splice(categoryIndex, 1);
    menuFileService.saveMenu(menu);

    res.json({ success: true, message: "Category deleted" });
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).json({ error: "Failed to delete category" });
  }
});

// ============================================================================
// Modifier Group Endpoints
// ============================================================================

/**
 * POST /admin/menu/modifier-groups - Create a modifier group
 */
router.post("/menu/modifier-groups", (req, res) => {
  try {
    const menu = menuFileService.loadMenu();
    const groupData = req.body as ModifierGroup;

    const validation = menuValidator.validateModifierGroup(groupData, menu);
    if (!validation.valid) {
      res.status(400).json({ error: "Validation failed", details: validation.errors });
      return;
    }

    const newGroup: ModifierGroup = {
      id: groupData.id,
      name: groupData.name,
      required: groupData.required ?? false,
      minSelections: groupData.minSelections ?? 0,
      maxSelections: groupData.maxSelections ?? 1,
      modifiers: groupData.modifiers || [],
    };

    menu.modifierGroups.push(newGroup);
    menuFileService.saveMenu(menu);

    res.status(201).json(newGroup);
  } catch (error) {
    console.error("Error creating modifier group:", error);
    res.status(500).json({ error: "Failed to create modifier group" });
  }
});

/**
 * PUT /admin/menu/modifier-groups/:groupId - Update a modifier group
 */
router.put("/menu/modifier-groups/:groupId", (req, res) => {
  try {
    const menu = menuFileService.loadMenu();
    const { groupId } = req.params;
    const groupData = req.body as Partial<ModifierGroup>;

    const groupIndex = menu.modifierGroups.findIndex((g) => g.id === groupId);
    if (groupIndex === -1) {
      res.status(404).json({ error: "Modifier group not found" });
      return;
    }

    const updatedGroup: ModifierGroup = {
      ...menu.modifierGroups[groupIndex],
      ...groupData,
      id: groupData.id || groupId,
    };

    const validation = menuValidator.validateModifierGroup(updatedGroup, menu, groupId);
    if (!validation.valid) {
      res.status(400).json({ error: "Validation failed", details: validation.errors });
      return;
    }

    // If ID changed, update all items referencing the old ID
    if (groupData.id && groupData.id !== groupId) {
      menu.items.forEach((item) => {
        if (item.modifierGroups) {
          const refIndex = item.modifierGroups.indexOf(groupId);
          if (refIndex !== -1) {
            item.modifierGroups[refIndex] = groupData.id!;
          }
        }
      });
    }

    menu.modifierGroups[groupIndex] = updatedGroup;
    menuFileService.saveMenu(menu);

    res.json(updatedGroup);
  } catch (error) {
    console.error("Error updating modifier group:", error);
    res.status(500).json({ error: "Failed to update modifier group" });
  }
});

/**
 * DELETE /admin/menu/modifier-groups/:groupId - Delete a modifier group
 */
router.delete("/menu/modifier-groups/:groupId", (req, res) => {
  try {
    const menu = menuFileService.loadMenu();
    const { groupId } = req.params;

    const groupIndex = menu.modifierGroups.findIndex((g) => g.id === groupId);
    if (groupIndex === -1) {
      res.status(404).json({ error: "Modifier group not found" });
      return;
    }

    // Check if any items use this modifier group
    const { canDelete, itemCount } = menuValidator.canDeleteModifierGroup(groupId, menu);
    if (!canDelete) {
      res.status(400).json({
        error: "Cannot delete modifier group",
        message: `${itemCount} item(s) are using this modifier group. Remove the reference first.`,
      });
      return;
    }

    menu.modifierGroups.splice(groupIndex, 1);
    menuFileService.saveMenu(menu);

    res.json({ success: true, message: "Modifier group deleted" });
  } catch (error) {
    console.error("Error deleting modifier group:", error);
    res.status(500).json({ error: "Failed to delete modifier group" });
  }
});

export default router;
