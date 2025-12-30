import { ncrClient } from "./client.js";
import { config } from "../config/index.js";
import type { Site, SitesResponse } from "../models/site.js";

const basePath = config.services.site;

export const sitesApi = {
  /**
   * List all sites for the organization
   */
  async list() {
    return ncrClient.get<SitesResponse>(`${basePath}/sites`);
  },

  /**
   * Get a specific site by ID
   */
  async getById(siteId: string) {
    return ncrClient.get<Site>(`${basePath}/sites/${siteId}`);
  },

  /**
   * Find sites with criteria
   */
  async find(criteria: { status?: string; organizationId?: string } = {}) {
    return ncrClient.post<SitesResponse>(`${basePath}/sites/find`, criteria);
  },
};
