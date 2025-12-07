import type { Menu, MenuItem, Modifier, ModifierGroup, MenuItemSize } from "../models/menu.js";

interface MatchResult<T> {
  match: T | null;
  confidence: number;
  alternatives: T[];
}

/**
 * Fuzzy matches spoken text to menu items/modifiers
 * Uses simple string matching - can be enhanced with NLP later
 */
export class MenuMatcher {
  private menu: Menu;

  constructor(menu: Menu) {
    this.menu = menu;
  }

  /**
   * Normalize text for matching (lowercase, remove punctuation)
   */
  private normalize(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  }

  /**
   * Calculate similarity between two strings (0-1)
   */
  private similarity(a: string, b: string): number {
    const aNorm = this.normalize(a);
    const bNorm = this.normalize(b);

    if (aNorm === bNorm) return 1;
    if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return 0.9;

    // Simple word overlap score
    const aWords = new Set(aNorm.split(/\s+/));
    const bWords = new Set(bNorm.split(/\s+/));
    const intersection = [...aWords].filter((w) => bWords.has(w));
    const union = new Set([...aWords, ...bWords]);

    return intersection.length / union.size;
  }

  /**
   * Find best matching menu item for spoken text
   */
  findItem(spokenText: string): MatchResult<MenuItem> {
    const candidates: Array<{ item: MenuItem; score: number }> = [];

    for (const item of this.menu.items) {
      if (!item.available) continue;

      // Check name
      let bestScore = this.similarity(spokenText, item.name);

      // Check aliases
      for (const alias of item.aliases) {
        const score = this.similarity(spokenText, alias);
        if (score > bestScore) bestScore = score;
      }

      if (bestScore > 0.3) {
        candidates.push({ item, score: bestScore });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      return { match: null, confidence: 0, alternatives: [] };
    }

    return {
      match: candidates[0].item,
      confidence: candidates[0].score,
      alternatives: candidates.slice(1, 4).map((c) => c.item),
    };
  }

  /**
   * Find best matching size for an item
   */
  findSize(spokenText: string, item: MenuItem): MatchResult<MenuItemSize> {
    if (!item.sizes || item.sizes.length === 0) {
      return { match: null, confidence: 1, alternatives: [] };
    }

    const candidates: Array<{ size: MenuItemSize; score: number }> = [];

    for (const size of item.sizes) {
      let bestScore = this.similarity(spokenText, size.name);

      for (const alias of size.aliases) {
        const score = this.similarity(spokenText, alias);
        if (score > bestScore) bestScore = score;
      }

      candidates.push({ size, score: bestScore });
    }

    candidates.sort((a, b) => b.score - a.score);

    return {
      match: candidates[0].size,
      confidence: candidates[0].score,
      alternatives: candidates.slice(1).map((c) => c.size),
    };
  }

  /**
   * Find best matching modifier for spoken text
   */
  findModifier(spokenText: string, groupId: string): MatchResult<Modifier> {
    const group = this.menu.modifierGroups.find((g) => g.id === groupId);
    if (!group) {
      return { match: null, confidence: 0, alternatives: [] };
    }

    const candidates: Array<{ modifier: Modifier; score: number }> = [];

    for (const modifier of group.modifiers) {
      let bestScore = this.similarity(spokenText, modifier.name);

      for (const alias of modifier.aliases) {
        const score = this.similarity(spokenText, alias);
        if (score > bestScore) bestScore = score;
      }

      if (bestScore > 0.3) {
        candidates.push({ modifier, score: bestScore });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      return { match: null, confidence: 0, alternatives: [] };
    }

    return {
      match: candidates[0].modifier,
      confidence: candidates[0].score,
      alternatives: candidates.slice(1, 4).map((c) => c.modifier),
    };
  }

  /**
   * Find modifiers from a list of spoken texts
   */
  findModifiers(
    spokenTexts: string[],
    groupIds: string[]
  ): Array<{ groupId: string; modifier: Modifier; confidence: number }> {
    const results: Array<{ groupId: string; modifier: Modifier; confidence: number }> = [];

    for (const text of spokenTexts) {
      for (const groupId of groupIds) {
        const match = this.findModifier(text, groupId);
        if (match.match && match.confidence > 0.5) {
          results.push({
            groupId,
            modifier: match.match,
            confidence: match.confidence,
          });
          break; // Found a match, move to next text
        }
      }
    }

    return results;
  }

  /**
   * Get modifier group by ID
   */
  getModifierGroup(groupId: string): ModifierGroup | undefined {
    return this.menu.modifierGroups.find((g) => g.id === groupId);
  }

  /**
   * Get all items in a category
   */
  getItemsByCategory(category: string): MenuItem[] {
    return this.menu.items.filter(
      (item) => item.available && item.category.toLowerCase() === category.toLowerCase()
    );
  }

  /**
   * Get menu categories
   */
  getCategories(): string[] {
    return this.menu.categories;
  }
}
