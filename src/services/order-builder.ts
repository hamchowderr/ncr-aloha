import type { VoiceOrder, VoiceOrderItem, Menu } from "../models/menu.js";
import type { CreateOrderRequest, OrderLine, Customer, Fulfillment } from "../models/order.js";
import { MenuMatcher } from "./menu-matcher.js";
import { config } from "../config/index.js";

interface OrderBuildResult {
  success: boolean;
  order?: CreateOrderRequest;
  errors: string[];
  warnings: string[];
}

interface ResolvedItem {
  menuItemId: string;
  menuItemName: string;
  sizeId?: string;
  sizeName?: string;
  quantity: number;
  unitPrice: number;
  modifiers: Array<{ id: string; name: string; price: number }>;
  specialInstructions?: string;
}

/**
 * Converts voice orders into NCR order format
 */
export class OrderBuilder {
  private matcher: MenuMatcher;
  private menu: Menu;

  constructor(menu: Menu) {
    this.menu = menu;
    this.matcher = new MenuMatcher(menu);
  }

  /**
   * Resolve a voice order item to menu item with modifiers
   */
  private resolveItem(voiceItem: VoiceOrderItem): {
    resolved: ResolvedItem | null;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Find the menu item
    const itemMatch = this.matcher.findItem(voiceItem.itemName);
    if (!itemMatch.match) {
      errors.push(`Could not find menu item: "${voiceItem.itemName}"`);
      return { resolved: null, errors, warnings };
    }

    if (itemMatch.confidence < 0.7) {
      warnings.push(
        `Low confidence match for "${voiceItem.itemName}" -> "${itemMatch.match.name}" (${Math.round(itemMatch.confidence * 100)}%)`
      );
    }

    const menuItem = itemMatch.match;
    let unitPrice = menuItem.basePrice;
    let sizeId: string | undefined;
    let sizeName: string | undefined;

    // Resolve size if specified
    if (voiceItem.size && menuItem.sizes && menuItem.sizes.length > 0) {
      const sizeMatch = this.matcher.findSize(voiceItem.size, menuItem);
      if (sizeMatch.match) {
        sizeId = sizeMatch.match.id;
        sizeName = sizeMatch.match.name;
        unitPrice += sizeMatch.match.priceAdjustment;
      } else {
        warnings.push(`Size "${voiceItem.size}" not found for ${menuItem.name}, using default`);
        // Use first size as default
        sizeId = menuItem.sizes[0].id;
        sizeName = menuItem.sizes[0].name;
        unitPrice += menuItem.sizes[0].priceAdjustment;
      }
    } else if (menuItem.sizes && menuItem.sizes.length > 0) {
      // No size specified but item has sizes - use first as default
      sizeId = menuItem.sizes[0].id;
      sizeName = menuItem.sizes[0].name;
      unitPrice += menuItem.sizes[0].priceAdjustment;
    }

    // Resolve modifiers
    const resolvedModifiers: Array<{ id: string; name: string; price: number }> = [];
    if (voiceItem.modifiers && menuItem.modifierGroups) {
      const modifierMatches = this.matcher.findModifiers(
        voiceItem.modifiers,
        menuItem.modifierGroups
      );

      for (const match of modifierMatches) {
        resolvedModifiers.push({
          id: match.modifier.id,
          name: match.modifier.name,
          price: match.modifier.price,
        });
        unitPrice += match.modifier.price;
      }

      // Check for required modifiers
      for (const groupId of menuItem.modifierGroups) {
        const group = this.matcher.getModifierGroup(groupId);
        if (group?.required) {
          const hasModifier = modifierMatches.some((m) => m.groupId === groupId);
          if (!hasModifier) {
            warnings.push(`Required modifier group "${group.name}" not specified for ${menuItem.name}`);
          }
        }
      }
    }

    return {
      resolved: {
        menuItemId: menuItem.id,
        menuItemName: menuItem.name,
        sizeId,
        sizeName,
        quantity: voiceItem.quantity || 1,
        unitPrice,
        modifiers: resolvedModifiers,
        specialInstructions: voiceItem.specialInstructions,
      },
      errors,
      warnings,
    };
  }

  /**
   * Build NCR order from voice order
   */
  build(voiceOrder: VoiceOrder): OrderBuildResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const resolvedItems: ResolvedItem[] = [];

    // Resolve all items
    for (const voiceItem of voiceOrder.items) {
      const result = this.resolveItem(voiceItem);
      errors.push(...result.errors);
      warnings.push(...result.warnings);

      if (result.resolved) {
        resolvedItems.push(result.resolved);
      }
    }

    if (resolvedItems.length === 0) {
      errors.push("No valid items in order");
      return { success: false, errors, warnings };
    }

    // Build customer
    const customer: Customer = {
      name: voiceOrder.customer.name,
      phone: voiceOrder.customer.phone,
      email: voiceOrder.customer.email,
    };

    // Build fulfillment
    const fulfillment: Fulfillment = {
      type: voiceOrder.orderType === "pickup" ? "Pickup" :
            voiceOrder.orderType === "delivery" ? "Delivery" : "DineIn",
    };

    if (voiceOrder.orderType === "delivery" && voiceOrder.deliveryAddress) {
      fulfillment.address = {
        line1: voiceOrder.deliveryAddress.street,
        city: voiceOrder.deliveryAddress.city,
        postalCode: voiceOrder.deliveryAddress.postalCode,
        state: "", // Would need to be parsed or provided
        country: "Canada",
        notes: voiceOrder.deliveryAddress.notes,
      };
    }

    // Build order lines
    const orderLines: OrderLine[] = resolvedItems.map((item, index) => {
      const notes = [];

      if (item.modifiers.length > 0) {
        notes.push({
          type: "Preferences" as const,
          value: item.modifiers.map((m) => m.name).join(", "),
        });
      }

      if (item.specialInstructions) {
        notes.push({
          type: "Other" as const,
          value: item.specialInstructions,
        });
      }

      return {
        productId: {
          type: "SKU" as const,
          value: item.sizeId ? `${item.menuItemId}-${item.sizeId}` : item.menuItemId,
        },
        description: item.sizeName
          ? `${item.menuItemName} (${item.sizeName})`
          : item.menuItemName,
        quantity: {
          value: item.quantity,
          unitOfMeasure: "EA",
        },
        unitPrice: item.unitPrice,
        extendedAmount: item.unitPrice * item.quantity,
        notes: notes.length > 0 ? notes : undefined,
        priceModifiers: item.modifiers
          .filter((m) => m.price > 0)
          .map((m) => ({
            amount: m.price,
            description: m.name,
          })),
      };
    });

    // Calculate totals
    const subtotal = orderLines.reduce((sum, line) => sum + line.extendedAmount, 0);
    const taxRate = 0.13; // Ontario HST
    const taxAmount = subtotal * taxRate;
    const total = subtotal + taxAmount;

    // Build the order
    const order: CreateOrderRequest = {
      status: "OrderPlaced",
      channel: "PhoneIn", // Voice AI orders map to PhoneIn channel
      currency: "CAD",
      customer,
      fulfillment,
      orderLines,
      comments: voiceOrder.specialInstructions,
      owner: this.menu.restaurantName,
      taxes: [
        {
          amount: taxAmount,
          code: "HST",
          percentage: taxRate * 100,
          isIncluded: false,
        },
      ],
      totals: [
        { type: "TaxExcluded", value: subtotal },
        { type: "Net", value: total },
      ],
    };

    return {
      success: true,
      order,
      errors,
      warnings,
    };
  }
}
