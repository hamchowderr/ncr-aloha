import CryptoJS from "crypto-js";
import { config } from "../config/index.js";

interface HmacParams {
  method: string;
  url: string;
  contentType?: string;
  contentMd5?: string;
}

/**
 * Generates a unique signing key based on the secret key and current timestamp
 */
function generateUniqueKey(date: Date, secretKey: string): string {
  const nonce = date.toISOString().slice(0, 19) + ".000Z";
  return secretKey + nonce;
}

/**
 * Extracts the path from a full URL
 * e.g., "https://api.ncr.com/order/3/orders/1" -> "/order/3/orders/1"
 */
function extractPath(url: string): string {
  return url.replace(/^https?:\/\/[^\/]+/, "");
}

/**
 * Builds the signable content string from request parameters
 * Format: METHOD\nPATH\nCONTENT-TYPE\nCONTENT-MD5\nORGANIZATION
 */
function buildSignableContent(params: HmacParams): string {
  const path = extractPath(params.url);
  const parts = [
    params.method.toUpperCase(),
    path,
    params.contentType || "",
    params.contentMd5 || "",
    config.ncr.organization,
  ].filter((p) => p && p.length > 0);

  return parts.join("\n");
}

/**
 * Calculates the HMAC-SHA512 signature
 */
function calculateSignature(params: HmacParams, date: Date): string {
  const key = generateUniqueKey(date, config.ncr.secretKey);
  const signableContent = buildSignableContent(params);
  const hmac = CryptoJS.HmacSHA512(signableContent, key);
  return CryptoJS.enc.Base64.stringify(hmac);
}

/**
 * Generates the full Authorization header value
 * Format: "AccessKey {sharedKey}:{signature}"
 */
export function generateAuthHeader(params: HmacParams): {
  authorization: string;
  date: string;
} {
  const date = new Date();
  const signature = calculateSignature(params, date);
  const authorization = `AccessKey ${config.ncr.sharedKey}:${signature}`;

  return {
    authorization,
    date: date.toUTCString(),
  };
}

/**
 * Generates all required headers for an NCR API request
 */
export function generateNcrHeaders(params: HmacParams): Record<string, string> {
  const { authorization, date } = generateAuthHeader(params);

  return {
    Authorization: authorization,
    Date: date,
    "Content-Type": params.contentType || "application/json",
    "nep-organization": config.ncr.organization,
    "nep-enterprise-unit": config.ncr.siteId,
  };
}
