import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Menu, MenuItem, ModifierGroup, MenuItemSize, Modifier } from "../models/menu.js";
import { allstarMenu } from "../data/allstar-menu.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MENU_FILE_PATH = path.resolve(__dirname, "../data/allstar-menu.ts");
const BACKUP_DIR = path.resolve(__dirname, "../data/backups");

/**
 * Service for reading and writing the menu TypeScript file
 */
export const menuFileService = {
  /**
   * Load the current menu from the imported module
   */
  loadMenu(): Menu {
    // Return a deep copy to prevent mutation
    return JSON.parse(JSON.stringify(allstarMenu));
  },

  /**
   * Save menu to the TypeScript file
   * Uses atomic write (temp file + rename) for safety
   */
  saveMenu(menu: Menu): void {
    // Create backup first
    this.createBackup();

    // Generate TypeScript content
    const content = this.generateMenuFile(menu);

    // Write to temp file first
    const tempPath = MENU_FILE_PATH + ".tmp";
    fs.writeFileSync(tempPath, content, "utf-8");

    // Rename temp file to actual file (atomic on most systems)
    fs.renameSync(tempPath, MENU_FILE_PATH);

    console.log(`Menu saved to ${MENU_FILE_PATH}`);
  },

  /**
   * Create a timestamped backup of the current menu file
   */
  createBackup(): string {
    // Ensure backup directory exists
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(BACKUP_DIR, `allstar-menu.${timestamp}.ts`);

    // Copy current file to backup
    if (fs.existsSync(MENU_FILE_PATH)) {
      fs.copyFileSync(MENU_FILE_PATH, backupPath);
      console.log(`Backup created: ${backupPath}`);
    }

    return backupPath;
  },

  /**
   * Generate TypeScript file content from menu object
   */
  generateMenuFile(menu: Menu): string {
    const itemsCode = menu.items.map((item) => this.generateItemCode(item)).join(",\n");
    const modifierGroupsCode = menu.modifierGroups
      .map((group) => this.generateModifierGroupCode(group))
      .join(",\n");

    return `import type { Menu } from "../models/menu.js";

/**
 * Complete menu data for ${menu.restaurantName}
 * Last updated: ${new Date().toISOString()}
 */
export const allstarMenu: Menu = {
  restaurantId: ${JSON.stringify(menu.restaurantId)},
  restaurantName: ${JSON.stringify(menu.restaurantName)},
  categories: ${JSON.stringify(menu.categories)},
  updatedAt: new Date().toISOString(),

  items: [
${itemsCode}
  ],

  modifierGroups: [
${modifierGroupsCode}
  ],
};
`;
  },

  /**
   * Generate code for a single menu item
   */
  generateItemCode(item: MenuItem): string {
    const lines: string[] = [];
    lines.push(`    {`);
    lines.push(`      id: ${JSON.stringify(item.id)},`);
    lines.push(`      name: ${JSON.stringify(item.name)},`);
    lines.push(`      aliases: ${JSON.stringify(item.aliases)},`);
    lines.push(`      description: ${JSON.stringify(item.description)},`);
    lines.push(`      category: ${JSON.stringify(item.category)},`);
    lines.push(`      basePrice: ${item.basePrice},`);

    if (item.sizes && item.sizes.length > 0) {
      lines.push(`      sizes: [`);
      for (const size of item.sizes) {
        lines.push(
          `        { id: ${JSON.stringify(size.id)}, name: ${JSON.stringify(size.name)}, aliases: ${JSON.stringify(size.aliases)}, priceAdjustment: ${size.priceAdjustment} },`
        );
      }
      lines.push(`      ],`);
    }

    if (item.modifierGroups && item.modifierGroups.length > 0) {
      lines.push(`      modifierGroups: ${JSON.stringify(item.modifierGroups)},`);
    }

    lines.push(`      available: ${item.available},`);
    lines.push(`    }`);

    return lines.join("\n");
  },

  /**
   * Generate code for a modifier group
   */
  generateModifierGroupCode(group: ModifierGroup): string {
    const lines: string[] = [];
    lines.push(`    {`);
    lines.push(`      id: ${JSON.stringify(group.id)},`);
    lines.push(`      name: ${JSON.stringify(group.name)},`);
    lines.push(`      required: ${group.required},`);
    lines.push(`      minSelections: ${group.minSelections},`);
    lines.push(`      maxSelections: ${group.maxSelections},`);
    lines.push(`      modifiers: [`);

    for (const mod of group.modifiers) {
      lines.push(
        `        { id: ${JSON.stringify(mod.id)}, name: ${JSON.stringify(mod.name)}, aliases: ${JSON.stringify(mod.aliases)}, price: ${mod.price} },`
      );
    }

    lines.push(`      ],`);
    lines.push(`    }`);

    return lines.join("\n");
  },

  /**
   * List available backups
   */
  listBackups(): string[] {
    if (!fs.existsSync(BACKUP_DIR)) {
      return [];
    }
    return fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("allstar-menu.") && f.endsWith(".ts"))
      .sort()
      .reverse();
  },
};
