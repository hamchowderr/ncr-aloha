/**
 * NCR BSP Site models
 */

export interface SiteAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface Site {
  id: string;
  enterpriseUnitId: string;
  siteName: string;
  status: "ACTIVE" | "INACTIVE";
  address?: SiteAddress;
  timezone?: string;
  organizationId: string;
  phone?: string;
  email?: string;
}

export interface SitesResponse {
  sites: Site[];
  pageContent?: {
    pageNumber: number;
    pageSize: number;
    totalResults: number;
  };
}
