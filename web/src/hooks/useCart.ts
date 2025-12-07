import { useState, useCallback } from "react";
import type { CartItem, MenuItem, MenuItemSize, Modifier } from "@/types/menu";

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);

  const addItem = useCallback(
    (
      menuItem: MenuItem,
      size: MenuItemSize | undefined,
      modifiers: Modifier[],
      quantity: number
    ) => {
      let unitPrice = menuItem.basePrice;
      if (size) unitPrice += size.priceAdjustment;
      modifiers.forEach((m) => (unitPrice += m.price));

      const newItem: CartItem = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        menuItem,
        size,
        modifiers,
        quantity,
        unitPrice,
        total: unitPrice * quantity,
      };

      setItems((prev) => [...prev, newItem]);
    },
    []
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const tax = subtotal * 0.13;
  const total = subtotal + tax;

  return {
    items,
    addItem,
    removeItem,
    clearCart,
    subtotal,
    tax,
    total,
    isEmpty: items.length === 0,
  };
}
