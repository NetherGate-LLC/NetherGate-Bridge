import {
  http,
  HttpRequest,
  HttpRequestMethod,
  HttpHeader,
} from "@minecraft/server-net";

/**
 * Client for the NetherGate Bridge HTTP API.
 *
 * @minecraft/server-net can only do HTTP (never a raw DB socket), so this
 * class turns friendly method calls into POST requests that the Node bridge
 * translates into MongoDB operations.
 *
 * Each addon supplies its OWN MongoDB connection string and database name, so
 * one running bridge server can serve many different addons/databases.
 *
 * NOTE: @minecraft/server-net is only available on a Bedrock Dedicated Server
 * (BDS) with the "@minecraft/server-net" module declared in manifest.json.
 * It does not work on normal Realms/clients.
 *
 * Example:
 *   const db = new Bridge({
 *     baseUrl: "http://127.0.0.1:3000",
 *     mongoUri: "mongodb+srv://user:pass@cluster.mongodb.net",
 *     database: "my_addon",
 *     // apiKey: "secret"  // only if the bridge server has auth enabled
 *   });
 *   await db.write("players", { name: "Steve", coins: 100 });
 *   const p = await db.get("players", { name: "Steve" });
 */

export interface BridgeOptions {
  /** Where the Node bridge server is reachable, e.g. "http://127.0.0.1:3000". */
  baseUrl: string;
  /** This addon's MongoDB connection string (mongodb:// or mongodb+srv://). */
  mongoUri: string;
  /** The database name to use within that MongoDB deployment. */
  database: string;
  /** Only needed if the bridge server has auth enabled. */
  apiKey?: string;
  /** Request timeout in seconds (default 10). */
  timeout?: number;
}

export interface QueryOptions {
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
  projection?: Record<string, 0 | 1>;
}

export interface UpdateOptions {
  upsert?: boolean;
  many?: boolean;
}

export interface WriteResult {
  insertedId?: string;
  insertedIds?: string[];
  insertedCount?: number;
}

export interface UpdateResult {
  ok: true;
  matchedCount: number;
  modifiedCount: number;
  upsertedId: string | null;
}

export interface DeleteResult {
  ok: true;
  deletedCount: number;
}

type Json = Record<string, unknown>;

export class Bridge {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly mongoUri: string;
  private readonly database: string;
  private readonly timeout: number;

  constructor(opts: BridgeOptions) {
    if (!opts?.baseUrl) throw new Error("Bridge: baseUrl is required");
    if (!opts.mongoUri) throw new Error("Bridge: mongoUri is required");
    if (!opts.database) throw new Error("Bridge: database is required");
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.mongoUri = opts.mongoUri;
    this.database = opts.database;
    this.timeout = opts.timeout ?? 10;
  }

  /** Low-level POST to a bridge endpoint. Returns the parsed JSON body. */
  private async post<T = Json>(path: string, payload: Json): Promise<T> {
    const request = new HttpRequest(`${this.baseUrl}${path}`);
    // Enum casing varies by @minecraft/server-net version (.POST vs .Post).
    request.method = HttpRequestMethod.POST;
    request.timeout = this.timeout;
    const headers = [new HttpHeader("Content-Type", "application/json")];
    if (this.apiKey) headers.push(new HttpHeader("x-api-key", this.apiKey));
    request.headers = headers;
    // Every request carries this addon's connection details.
    request.body = JSON.stringify({ uri: this.mongoUri, db: this.database, ...payload });

    const response = await http.request(request);

    let parsed: Json;
    try {
      parsed = response.body ? (JSON.parse(response.body) as Json) : {};
    } catch {
      throw new Error(`Bridge: non-JSON response (status ${response.status}): ${response.body}`);
    }

    if (response.status < 200 || response.status >= 300 || parsed.ok === false) {
      const message = (parsed.error as string) || `HTTP ${response.status}`;
      throw new Error(`Bridge ${path} failed: ${message}`);
    }
    return parsed as T;
  }

  /** Fetch a single document, or null if none matches. */
  async get<T = Json>(collection: string, filter: Json = {}, options: Json = {}): Promise<T | null> {
    const res = await this.post<{ document: T | null }>("/v1/get", { collection, filter, options });
    return res.document;
  }

  /** Fetch many documents. */
  async query<T = Json>(
    collection: string,
    filter: Json = {},
    options: QueryOptions = {}
  ): Promise<T[]> {
    const res = await this.post<{ documents: T[] }>("/v1/query", { collection, filter, options });
    return res.documents;
  }

  /** Insert one document (object) or many (array). */
  async write(collection: string, documentOrArray: Json | Json[]): Promise<WriteResult> {
    if (Array.isArray(documentOrArray)) {
      const res = await this.post<WriteResult>("/v1/write", {
        collection,
        documents: documentOrArray,
      });
      return { insertedIds: res.insertedIds, insertedCount: res.insertedCount };
    }
    const res = await this.post<WriteResult>("/v1/write", { collection, document: documentOrArray });
    return { insertedId: res.insertedId };
  }

  /** Update document(s). `update` must use operators, e.g. { $set: { coins: 5 } }. */
  async update(
    collection: string,
    filter: Json,
    update: Json,
    options: UpdateOptions = {}
  ): Promise<UpdateResult> {
    return this.post<UpdateResult>("/v1/update", { collection, filter, update, options });
  }

  /** Delete document(s). Empty filters are rejected by the server on purpose. */
  async delete(collection: string, filter: Json, options: UpdateOptions = {}): Promise<DeleteResult> {
    return this.post<DeleteResult>("/v1/delete", { collection, filter, options });
  }

  /** Count documents matching a filter. */
  async count(collection: string, filter: Json = {}): Promise<number> {
    const res = await this.post<{ count: number }>("/v1/count", { collection, filter });
    return res.count;
  }
}
