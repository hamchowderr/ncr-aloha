import type { Request, Response, NextFunction } from "express";
import { config } from "../config/index.js";

// Trusted origins that can access admin routes without API key
const TRUSTED_ORIGINS = [
  "https://ncr-aloha.vercel.app",
  "https://ncr-aloha-otaku-solutions.vercel.app",
  "https://ncr-aloha.tylanmiller.tech",
  "http://localhost:5173",
  "http://localhost:3000",
];

/**
 * Middleware to validate API key for admin routes
 * - Allows requests from trusted origins (frontend) without API key
 * - Requires X-API-Key header for external integrations (n8n, etc.)
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  // Skip auth if no API key is configured (dev mode)
  if (!config.admin.apiKey) {
    next();
    return;
  }

  // Check if request is from a trusted origin
  const origin = req.header("Origin");
  const referer = req.header("Referer");

  const isTrustedOrigin = TRUSTED_ORIGINS.some(trusted =>
    origin === trusted || referer?.startsWith(trusted)
  );

  if (isTrustedOrigin) {
    next();
    return;
  }

  // For external requests, require API key
  const providedKey = req.header("X-API-Key");

  if (!providedKey) {
    res.status(401).json({ error: "Missing API key", message: "X-API-Key header required" });
    return;
  }

  if (providedKey !== config.admin.apiKey) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  next();
}
