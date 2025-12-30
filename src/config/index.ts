import dotenv from "dotenv";

dotenv.config();

export const config = {
  ncr: {
    apiGateway: process.env.NCR_API_GATEWAY || "https://api.ncr.com",
    organization: process.env.NCR_ORGANIZATION || "",
    siteId: process.env.NCR_SITE_ID || "",
    sharedKey: process.env.NCR_SHARED_KEY || "",
    secretKey: process.env.NCR_SECRET_KEY || "",
  },
  admin: {
    apiKey: process.env.ADMIN_API_KEY || "",
  },
  services: {
    order: "/order/3/orders/1",
    catalog: "/catalog/v2",
    site: "/site",
    cdm: "/cdm",
    tdm: "/transaction-document/transaction-documents",
    image: "/image/v1/images",
  },
} as const;
