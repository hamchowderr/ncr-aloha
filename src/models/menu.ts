/**
 * Menu models for voice ordering
 * This is the layer between voice AI and NCR catalog
 */

export interface MenuItem {
  id: string;
  name: string;
  aliases: string[]; // Alternative names the voice AI might hear
  description: string;
  category: string;
  basePrice: number;
  sizes?: MenuItemSize[];
  modifierGroups?: string[]; // References to modifier group IDs
  available: boolean;
}

export interface MenuItemSize {
  id: string;
  name: string;
  aliases: string[];
  priceAdjustment: number; // Added to base price
}

export interface Modifier {
  id: string;
  name: string;
  aliases: string[];
  price: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  modifiers: Modifier[];
}

export interface Menu {
  restaurantId: string;
  restaurantName: string;
  categories: string[];
  items: MenuItem[];
  modifierGroups: ModifierGroup[];
  updatedAt: string;
}

/**
 * Voice order representation - what comes from the AI agent
 */
export interface VoiceOrderItem {
  itemName: string; // As spoken by customer
  quantity: number;
  size?: string;
  modifiers?: string[]; // As spoken by customer
  specialInstructions?: string;
}

export interface VoiceOrder {
  orderType: "pickup" | "delivery" | "dine-in";
  items: VoiceOrderItem[];
  customer: {
    name: string;
    phone: string;
    email?: string;
  };
  deliveryAddress?: {
    street: string;
    city: string;
    postalCode: string;
    notes?: string;
  };
  specialInstructions?: string;
  scheduledTime?: string; // ISO string if not ASAP
}
