import type { Request, Response, NextFunction } from "express";
import { config } from "../config/index.js";

/**
 * Middleware to validate API key for admin routes
 * Checks X-API-Key header against ADMIN_API_KEY env var
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  // Skip auth if no API key is configured (dev mode)
  if (!config.admin.apiKey) {
    next();
    return;
  }

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
