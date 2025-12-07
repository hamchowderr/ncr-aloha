/**
 * NCR Catalog Models
 * Based on the BSP Sandbox Postman collection
 */

export interface CatalogItem {
  itemId: {
    itemCode: string;
    itemType?: string;
  };
  shortDescription: {
    locale: string;
    value: string;
  };
  longDescription?: {
    locale: string;
    value: string;
  };
  departmentId?: string;
  status?: "ACTIVE" | "INACTIVE" | "DISCONTINUED";
  merchandiseCategory?: {
    nodeId: string;
  };
  nonMerchandise?: boolean;
  version?: number;
}

export interface ItemPrice {
  itemId: string;
  prices: Array<{
    priceId: string;
    priceCode: string;
    effectiveDate?: string;
    endDate?: string;
    price: number;
    currency: string;
    status?: "ACTIVE" | "INACTIVE";
    basePrice?: boolean;
  }>;
  version?: number;
}

export interface ItemAttributes {
  itemId: string;
  attributes: Record<string, unknown>;
  version?: number;
}

export interface LinkGroupItem {
  itemCode: string;
  sequence?: number;
  defaultQuantity?: number;
  minQuantity?: number;
  maxQuantity?: number;
  priceOverride?: number;
}

export interface LinkGroup {
  groupId: string;
  groupType: "MODIFIER" | "COMBO" | "UPCHARGE";
  description: string;
  items: LinkGroupItem[];
  minSelections?: number;
  maxSelections?: number;
  required?: boolean;
  version?: number;
}
