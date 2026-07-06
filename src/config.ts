import "dotenv/config";

function list(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** One credential the bridge accepts, with a human label for logs. */
export interface ApiKey {
  label: string;
  secret: string;
}

/**
 * Build the set of accepted keys. Auth is OPTIONAL: this is a public service
 * where the MongoDB URI (with its credentials) is the real access control, so
 * with no keys configured the bridge is open to anyone. Configure keys only if
 * you're self-hosting a private instance and want to gate it. Two sources:
 *   API_KEY   = a single shared secret (labelled "default")
 *   API_KEYS  = comma-separated "label:secret" pairs, one per addon
 */
function buildApiKeys(): ApiKey[] {
  const keys: ApiKey[] = [];

  const single = process.env.API_KEY?.trim();
  if (single) keys.push({ label: "default", secret: single });

  for (const pair of list("API_KEYS")) {
    const idx = pair.indexOf(":");
    if (idx === -1) {
      throw new Error(`Invalid API_KEYS entry "${pair}" — expected "label:secret"`);
    }
    const label = pair.slice(0, idx).trim();
    const secret = pair.slice(idx + 1).trim();
    if (!label || !secret) {
      throw new Error(`Invalid API_KEYS entry "${pair}" — label and secret are both required`);
    }
    keys.push({ label, secret });
  }

  return keys; // empty => open access
}

export interface Config {
  port: number;
  /** Every credential the bridge accepts. Empty => auth disabled (open access). */
  apiKeys: ApiKey[];
  /** Empty => any collection allowed. */
  allowedCollections: string[];
  /** Empty => any MongoDB host allowed. Otherwise an allowlist of hostnames. */
  allowedUriHosts: string[];
  maxDocuments: number;
  connectTimeoutMs: number;
  idleCloseMs: number;
}

export const config: Config = {
  port: Number(process.env.PORT ?? 3000),
  apiKeys: buildApiKeys(),
  allowedCollections: list("ALLOWED_COLLECTIONS"),
  allowedUriHosts: list("ALLOWED_URI_HOSTS"),
  maxDocuments: Number(process.env.MAX_DOCUMENTS ?? 500),
  connectTimeoutMs: Number(process.env.CONNECT_TIMEOUT_MS ?? 8000),
  idleCloseMs: Number(process.env.IDLE_CLOSE_MS ?? 5 * 60_000),
};
