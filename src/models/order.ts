/**
 * NCR Order Models
 * Based on the BSP Sandbox Postman collection
 */

export interface Customer {
  id?: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone: string;
  fiscalId?: string;
  externalIds?: Array<{
    lineId: string;
    type: string;
    value: string;
  }>;
}

export interface Address {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  notes?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  businessInfo?: {
    name: string;
    department?: string;
  };
  type?: "Residential" | "Business";
}

export interface Fulfillment {
  type: "Pickup" | "Delivery" | "DineIn";
  address?: Address;
  notes?: string;
  autoRelease?: boolean;
  catering?: boolean;
  leadTimes?: Array<{
    interval: number;
    intervalUnits: "Minutes" | "Hours";
    type: string;
  }>;
}

export interface PickupContact {
  name: string;
  phone: string;
  company?: string;
  hasArrived?: boolean;
  vehicle?: {
    make: string;
    model: string;
    color: string;
    licensePlate?: string;
    year?: string;
  };
}

export interface OrderLineNote {
  type: "Substitutions" | "Preferences" | "Allergies" | "Other";
  value: string;
}

export interface PriceModifier {
  amount: number;
  description: string;
}

export interface Tax {
  amount: number;
  code: string;
  percentage?: number;
  isIncluded?: boolean;
}

export interface OrderLine {
  productId: {
    type: "UPC" | "SKU" | "PLU";
    value: string;
  };
  description?: string;
  quantity: {
    value: number;
    unitOfMeasure: string;
    unitOfMeasureLabel?: string;
  };
  unitPrice: number;
  extendedAmount: number;
  notes?: OrderLineNote[];
  priceModifiers?: PriceModifier[];
  modifierCode?: string;
  linkGroupCode?: string;
  taxes?: Tax[];
  substitutionAllowed?: boolean;
  overridePrice?: boolean;
  fulfillmentResult?: "Fulfilled" | "Substituted" | "OutOfStock";
  itemType?: "Regular" | "Tare" | "Modifier";
}

export interface Payment {
  type: "Cash" | "Credit" | "Debit" | "GiftCard" | "Other";
  amount: number;
  status: "Pending" | "Authorized" | "Captured" | "Declined";
  description?: string;
  gratuity?: number;
  payBalance?: boolean;
  accountNumber?: string;
  expiration?: {
    month: number;
    year: number;
  };
}

export interface Fee {
  type: "Delivery" | "Service" | "Other";
  amount: number;
  lineId?: string;
  provider?: string;
  override?: boolean;
}

export interface OrderTotal {
  type: "TaxExcluded" | "TaxIncluded" | "Net";
  value: number;
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
  id?: string;
  status: OrderStatus;
  channel: string;
  currency: string;
  customer: Customer;
  fulfillment: Fulfillment;
  pickupContact?: PickupContact;
  orderLines: OrderLine[];
  payments?: Payment[];
  fees?: Fee[];
  taxes?: Tax[];
  totals?: OrderTotal[];
  comments?: string;
  owner?: string;
  partySize?: number;
  revenueCenter?: string;
  bagCount?: number;
  taxExempt?: boolean;
  errorDescription?: string;
  additionalReferenceIds?: Record<string, string>;
  checkInDetails?: {
    application: string;
    location: string;
    origin?: { id: number; type: string };
    vector?: { id: number; type: string };
  };
  promotions?: Array<{
    amount: number;
    adjustment?: {
      level: "ITEM" | "ORDER";
      type: string;
      applied?: boolean;
    };
    supportingData?: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
}

export type CreateOrderRequest = Omit<Order, "id" | "createdAt" | "updatedAt">;
