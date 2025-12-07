export interface MenuItem {
  id: string;
  name: string;
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
  restaurant: string;
  categories: string[];
  items: MenuItem[];
  modifierGroups: ModifierGroup[];
}

export interface CartItem {
  id: string;
  menuItem: MenuItem;
  size?: MenuItemSize;
  modifiers: Modifier[];
  quantity: number;
  unitPrice: number;
  total: number;
  specialInstructions?: string;
}

export interface VoiceOrder {
  orderType: "pickup" | "delivery" | "dine-in";
  items: {
    itemName: string;
    quantity: number;
    size?: string;
    modifiers?: string[];
    specialInstructions?: string;
  }[];
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
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  status?: string;
  errors?: string[];
  warnings?: string[];
}
