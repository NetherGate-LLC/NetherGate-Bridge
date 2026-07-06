import { MongoClient, type Collection, type Document } from "mongodb";
import { config } from "./config.js";
import { HttpError } from "./errors.js";

/**
 * Connection manager. The Mongo URI comes from each request (so any addon can
 * point the bridge at its own database), so we lazily open one pooled
 * MongoClient per unique URI and reuse it for every request that shares it.
 */
interface ClientEntry {
  client: MongoClient;
  connectPromise: Promise<MongoClient>;
  lastUsed: number;
}

const clients = new Map<string, ClientEntry>();

function hostAllowed(uri: string): boolean {
  if (!config.allowedUriHosts.length) return true;
  try {
    const host = new URL(uri).hostname;
    return config.allowedUriHosts.includes(host);
  } catch {
    return false;
  }
}

async function getClient(uri: unknown): Promise<MongoClient> {
  if (typeof uri !== "string" || !/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new HttpError(400, "A valid 'uri' (mongodb:// or mongodb+srv://) is required");
  }
  if (!hostAllowed(uri)) {
    throw new HttpError(403, "This MongoDB host is not allowed by the bridge");
  }

  let entry = clients.get(uri);
  if (!entry) {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: config.connectTimeoutMs,
    });
    entry = { client, connectPromise: client.connect(), lastUsed: Date.now() };
    clients.set(uri, entry);
    try {
      await entry.connectPromise;
    } catch (err) {
      clients.delete(uri); // don't cache a broken connection
      throw new HttpError(502, `Could not connect to MongoDB: ${(err as Error).message}`);
    }
  } else {
    await entry.connectPromise;
  }
  entry.lastUsed = Date.now();
  return entry.client;
}

/** Resolve a collection handle from a request's uri/db/collection triple. */
export async function getCollection(
  uri: unknown,
  dbName: unknown,
  collectionName: string
): Promise<Collection<Document>> {
  if (typeof dbName !== "string" || !dbName.trim()) {
    throw new HttpError(400, "Field 'db' is required and must be a string");
  }
  const client = await getClient(uri);
  return client.db(dbName).collection(collectionName);
}

/** Close idle connections so long-lived servers don't leak clients. */
export function startIdleSweeper(): NodeJS.Timeout {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [uri, entry] of clients) {
      if (now - entry.lastUsed > config.idleCloseMs) {
        clients.delete(uri);
        entry.client.close().catch(() => {});
      }
    }
  }, 60_000);
  timer.unref?.();
  return timer;
}

export async function closeAll(): Promise<void> {
  for (const [, entry] of clients) {
    await entry.client.close().catch(() => {});
  }
  clients.clear();
}
