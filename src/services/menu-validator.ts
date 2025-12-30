import type { Menu, MenuItem, ModifierGroup, MenuItemSize, Modifier } from "../models/menu.js";

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Menu validation service
 */
export const menuValidator = {
  /**
   * Validate a menu item for creation or update
   */
  validateItem(
    item: Partial<MenuItem>,
    menu: Menu,
    existingItemId?: string
  ): ValidationResult {
    const errors: ValidationError[] = [];

    // Required fields
    if (!item.id || item.id.trim() === "") {
      errors.push({ field: "id", message: "ID is required" });
    } else if (!/^[A-Z0-9-]+$/.test(item.id)) {
      errors.push({ field: "id", message: "ID must be uppercase letters, numbers, and hyphens only" });
    } else {
      // Check uniqueness (exclude current item if editing)
      const duplicate = menu.items.find(
        (i) => i.id === item.id && i.id !== existingItemId
      );
      if (duplicate) {
        errors.push({ field: "id", message: "An item with this ID already exists" });
      }
    }

    if (!item.name || item.name.trim() === "") {
      errors.push({ field: "name", message: "Name is required" });
    } else if (item.name.length > 100) {
      errors.push({ field: "name", message: "Name must be 100 characters or less" });
    }

    if (!item.category || item.category.trim() === "") {
      errors.push({ field: "category", message: "Category is required" });
    } else if (!menu.categories.includes(item.category)) {
      errors.push({ field: "category", message: `Category "${item.category}" does not exist` });
    }

    if (item.basePrice === undefined || item.basePrice === null) {
      errors.push({ field: "basePrice", message: "Base price is required" });
    } else if (item.basePrice < 0) {
      errors.push({ field: "basePrice", message: "Base price cannot be negative" });
    }

    // Validate sizes if provided
    if (item.sizes) {
      const sizeIds = new Set<string>();
      item.sizes.forEach((size, index) => {
        if (!size.id || size.id.trim() === "") {
          errors.push({ field: `sizes[${index}].id`, message: "Size ID is required" });
        } else if (sizeIds.has(size.id)) {
          errors.push({ field: `sizes[${index}].id`, message: "Duplicate size ID" });
        } else {
          sizeIds.add(size.id);
        }

        if (!size.name || size.name.trim() === "") {
          errors.push({ field: `sizes[${index}].name`, message: "Size name is required" });
        }

        if (size.priceAdjustment === undefined) {
          errors.push({ field: `sizes[${index}].priceAdjustment`, message: "Price adjustment is required" });
        }
      });
    }

    // Validate modifier group references
    if (item.modifierGroups) {
      item.modifierGroups.forEach((groupId, index) => {
        const exists = menu.modifierGroups.find((g) => g.id === groupId);
        if (!exists) {
          errors.push({
            field: `modifierGroups[${index}]`,
            message: `Modifier group "${groupId}" does not exist`,
          });
        }
      });
    }

    return { valid: errors.length === 0, errors };
  },

  /**
   * Validate a category name
   */
  validateCategory(
    name: string,
    menu: Menu,
    existingName?: string
  ): ValidationResult {
    const errors: ValidationError[] = [];

    if (!name || name.trim() === "") {
      errors.push({ field: "name", message: "Category name is required" });
    } else if (name.length > 50) {
      errors.push({ field: "name", message: "Category name must be 50 characters or less" });
    } else {
      // Check uniqueness (exclude current if renaming)
      const duplicate = menu.categories.find(
        (c) => c.toLowerCase() === name.toLowerCase() && c !== existingName
      );
      if (duplicate) {
        errors.push({ field: "name", message: "A category with this name already exists" });
      }
    }

    return { valid: errors.length === 0, errors };
  },

  /**
   * Validate a modifier group
   */
  validateModifierGroup(
    group: Partial<ModifierGroup>,
    menu: Menu,
    existingGroupId?: string
  ): ValidationResult {
    const errors: ValidationError[] = [];

    // Required fields
    if (!group.id || group.id.trim() === "") {
      errors.push({ field: "id", message: "ID is required" });
    } else if (!/^[A-Z0-9-]+$/.test(group.id)) {
      errors.push({ field: "id", message: "ID must be uppercase letters, numbers, and hyphens only" });
    } else {
      // Check uniqueness
      const duplicate = menu.modifierGroups.find(
        (g) => g.id === group.id && g.id !== existingGroupId
      );
      if (duplicate) {
        errors.push({ field: "id", message: "A modifier group with this ID already exists" });
      }
    }

    if (!group.name || group.name.trim() === "") {
      errors.push({ field: "name", message: "Name is required" });
    } else if (group.name.length > 100) {
      errors.push({ field: "name", message: "Name must be 100 characters or less" });
    }

    if (group.minSelections !== undefined && group.minSelections < 0) {
      errors.push({ field: "minSelections", message: "Min selections cannot be negative" });
    }

    if (group.maxSelections !== undefined && group.maxSelections < 0) {
      errors.push({ field: "maxSelections", message: "Max selections cannot be negative" });
    }

    if (
      group.minSelections !== undefined &&
      group.maxSelections !== undefined &&
      group.minSelections > group.maxSelections
    ) {
      errors.push({
        field: "minSelections",
        message: "Min selections cannot be greater than max selections",
      });
    }

    // Validate modifiers
    if (group.modifiers) {
      const modifierIds = new Set<string>();
      group.modifiers.forEach((mod, index) => {
        if (!mod.id || mod.id.trim() === "") {
          errors.push({ field: `modifiers[${index}].id`, message: "Modifier ID is required" });
        } else if (modifierIds.has(mod.id)) {
          errors.push({ field: `modifiers[${index}].id`, message: "Duplicate modifier ID" });
        } else {
          modifierIds.add(mod.id);
        }

        if (!mod.name || mod.name.trim() === "") {
          errors.push({ field: `modifiers[${index}].name`, message: "Modifier name is required" });
        }

        if (mod.price !== undefined && mod.price < 0) {
          errors.push({ field: `modifiers[${index}].price`, message: "Price cannot be negative" });
        }
      });

      // If group is required, must have at least one modifier
      if (group.required && group.modifiers.length === 0) {
        errors.push({ field: "modifiers", message: "Required modifier group must have at least one modifier" });
      }
    }

    return { valid: errors.length === 0, errors };
  },

  /**
   * Check if a category can be deleted (no items using it)
   */
  canDeleteCategory(categoryName: string, menu: Menu): { canDelete: boolean; itemCount: number } {
    const itemCount = menu.items.filter((i) => i.category === categoryName).length;
    return { canDelete: itemCount === 0, itemCount };
  },

  /**
   * Check if a modifier group can be deleted (no items using it)
   */
  canDeleteModifierGroup(groupId: string, menu: Menu): { canDelete: boolean; itemCount: number } {
    const itemCount = menu.items.filter(
      (i) => i.modifierGroups && i.modifierGroups.includes(groupId)
    ).length;
    return { canDelete: itemCount === 0, itemCount };
  },
};
