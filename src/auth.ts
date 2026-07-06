import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config, type ApiKey } from "./config.js";

/** Constant-time comparison so we don't leak the key via timing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Match the provided secret against every configured key. We check them all
 * (rather than short-circuiting) so timing doesn't reveal how many keys exist
 * or which one matched.
 */
function matchKey(provided: string): ApiKey | null {
  let matched: ApiKey | null = null;
  for (const key of config.apiKeys) {
    if (safeEqual(provided, key.secret)) matched = key;
  }
  return matched;
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  // No keys configured => open service, let everyone through.
  if (config.apiKeys.length === 0) {
    next();
    return;
  }
  const provided = req.get("x-api-key");
  const matched = provided ? matchKey(provided) : null;
  if (!matched) {
    res.status(401).json({ ok: false, error: "Invalid or missing API key" });
    return;
  }
  // Expose which addon/credential this request came in on (handy for logging).
  req.apiKeyLabel = matched.label;
  next();
}
