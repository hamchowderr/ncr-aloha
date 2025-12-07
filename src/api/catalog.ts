import { ncrClient } from "./client.js";
import { config } from "../config/index.js";
import type { CatalogItem, ItemPrice, ItemAttributes, LinkGroup } from "../models/catalog.js";

const basePath = config.services.catalog;

export const catalogApi = {
  /**
   * Create a catalog item
   */
  async createItem(item: CatalogItem) {
    return ncrClient.post<CatalogItem>(`${basePath}/items`, item);
  },

  /**
   * Get a catalog item by ID
   */
  async getItem(itemId: string) {
    return ncrClient.get<CatalogItem>(`${basePath}/items/${itemId}`);
  },

  /**
   * Find catalog items
   */
  async findItems(criteria: Record<string, unknown> = {}) {
    return ncrClient.post<{ items: CatalogItem[] }>(`${basePath}/items/find`, criteria);
  },

  /**
   * Create or update item price
   */
  async upsertItemPrice(itemId: string, price: ItemPrice) {
    return ncrClient.put<ItemPrice>(`${basePath}/item-prices/${itemId}`, price);
  },

  /**
   * Get item price snapshot
   */
  async getItemPrice(itemId: string) {
    return ncrClient.get<ItemPrice>(`${basePath}/item-prices/${itemId}`);
  },

  /**
   * Create or update item attributes
   */
  async upsertItemAttributes(itemId: string, attributes: ItemAttributes) {
    return ncrClient.put<ItemAttributes>(`${basePath}/item-attributes/${itemId}`, attributes);
  },

  /**
   * Get item attributes snapshot
   */
  async getItemAttributes(itemId: string) {
    return ncrClient.get<ItemAttributes>(`${basePath}/item-attributes/${itemId}`);
  },

  /**
   * Create or update link group (modifiers)
   */
  async upsertLinkGroup(groupId: string, linkGroup: LinkGroup) {
    return ncrClient.put<LinkGroup>(`${basePath}/link-groups/${groupId}`, linkGroup);
  },

  /**
   * Get link group snapshot
   */
  async getLinkGroup(groupId: string) {
    return ncrClient.get<LinkGroup>(`${basePath}/link-groups/${groupId}`);
  },
};
