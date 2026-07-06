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
 * @example
 *   const db = new Bridge({
 *     baseUrl: "http://127.0.0.1:3000",
 *     mongoUri: "mongodb+srv://user:pass@cluster.mongodb.net",
 *     database: "my_addon",
 *     // apiKey: "secret"  // only if the bridge server has auth enabled
 *   });
 *   await db.write("players", { name: "Steve", coins: 100 });
 *   const p = await db.get("players", { name: "Steve" });
 */
export class Bridge {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl  Where the bridge server is, e.g. "http://127.0.0.1:3000".
   * @param {string} opts.mongoUri This addon's MongoDB connection string.
   * @param {string} opts.database The database name to use.
   * @param {string} [opts.apiKey] Only needed if the bridge server has auth enabled.
   * @param {number} [opts.timeout] Request timeout in seconds (default 10).
   */
  constructor(opts) {
    if (!opts || !opts.baseUrl) throw new Error("Bridge: baseUrl is required");
    if (!opts.mongoUri) throw new Error("Bridge: mongoUri is required");
    if (!opts.database) throw new Error("Bridge: database is required");
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.mongoUri = opts.mongoUri;
    this.database = opts.database;
    this.apiKey = opts.apiKey;
    this.timeout = opts.timeout ?? 10;
  }

  /**
   * Low-level POST to a bridge endpoint. Returns the parsed JSON body.
   * @param {string} path
   * @param {object} payload
   */
  async _post(path, payload) {
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

    let parsed;
    try {
      parsed = response.body ? JSON.parse(response.body) : {};
    } catch {
      throw new Error(`Bridge: non-JSON response (status ${response.status}): ${response.body}`);
    }

    if (response.status < 200 || response.status >= 300 || parsed.ok === false) {
      const message = parsed.error || `HTTP ${response.status}`;
      throw new Error(`Bridge ${path} failed: ${message}`);
    }
    return parsed;
  }

  /**
   * Fetch a single document, or null if none matches.
   * @param {string} collection
   * @param {object} [filter]
   * @param {object} [options]
   */
  async get(collection, filter = {}, options = {}) {
    const res = await this._post("/v1/get", { collection, filter, options });
    return res.document;
  }

  /**
   * Fetch many documents.
   * @param {string} collection
   * @param {object} [filter]
   * @param {{ sort?: object, limit?: number, skip?: number, projection?: object }} [options]
   */
  async query(collection, filter = {}, options = {}) {
    const res = await this._post("/v1/query", { collection, filter, options });
    return res.documents;
  }

  /**
   * Insert one document (object) or many (array).
   * @param {string} collection
   * @param {object | object[]} documentOrArray
   */
  async write(collection, documentOrArray) {
    if (Array.isArray(documentOrArray)) {
      const res = await this._post("/v1/write", { collection, documents: documentOrArray });
      return { insertedIds: res.insertedIds, insertedCount: res.insertedCount };
    }
    const res = await this._post("/v1/write", { collection, document: documentOrArray });
    return { insertedId: res.insertedId };
  }

  /**
   * Update document(s). `update` must use operators, e.g. { $set: { coins: 5 } }.
   * @param {string} collection
   * @param {object} filter
   * @param {object} update
   * @param {{ upsert?: boolean, many?: boolean }} [options]
   */
  async update(collection, filter, update, options = {}) {
    return this._post("/v1/update", { collection, filter, update, options });
  }

  /**
   * Delete document(s). Empty filters are rejected by the server on purpose.
   * @param {string} collection
   * @param {object} filter
   * @param {{ many?: boolean }} [options]
   */
  async delete(collection, filter, options = {}) {
    return this._post("/v1/delete", { collection, filter, options });
  }

  /**
   * Count documents matching a filter.
   * @param {string} collection
   * @param {object} [filter]
   */
  async count(collection, filter = {}) {
    const res = await this._post("/v1/count", { collection, filter });
    return res.count;
  }
}
