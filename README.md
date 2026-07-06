# NetherGate Bridge

A small **TypeScript** HTTP bridge that lets **Minecraft Bedrock** script addons
talk to **MongoDB**.

Bedrock's `@minecraft/server-net` module can make HTTP requests but **cannot**
open a raw database socket. This project provides:

1. **A Node.js API** (`src/`) that receives HTTP requests and runs them against
   MongoDB.
2. **A drop-in addon client** (`minecraft/` — TS and JS versions) exposing friendly methods
   — `get()`, `query()`, `write()`, `update()`, `delete()`, `count()`.

Each addon supplies **its own** MongoDB connection string + database name, so one
running bridge can serve many different addons/databases.

```
Bedrock addon (server-net)  ──HTTP──▶  NetherGate Bridge (Node)  ──▶  MongoDB
```

---

## 1. Run the bridge server

```bash
npm install
cp .env.example .env          # optional — only if you want to change defaults
npm run build                 # bundle everything into a single dist/index.js
npm start                     # or:  npm run dev   (watch mode, no build step)
```

`npm run build` produces one self-contained file — **`dist/index.js`** — with
express, the MongoDB driver, and all dependencies inlined. You can run it with
just `node dist/index.js` on any machine that has Node 18+; no `node_modules`
required at runtime.

Health check: `GET http://localhost:3000/health` → `{ "ok": true }`.

### Configuration (`.env`)

| Variable              | Required | Purpose                                                         |
| --------------------- | -------- | --------------------------------------------------------------- |
| `API_KEY`             |          | Optional single shared secret (`x-api-key` header). Unset = open. |
| `API_KEYS`            |          | Optional per-addon keys: `label:secret` pairs, comma-separated. |
| `PORT`                |          | Listen port (default `3000`).                                   |
| `ALLOWED_URI_HOSTS`   |          | Allowlist of MongoDB hostnames. Empty = any host (set in prod). |
| `ALLOWED_COLLECTIONS` |          | Allowlist of collections. Empty = any.                          |
| `MAX_DOCUMENTS`       |          | Cap per query/bulk-insert (default `500`).                      |

> The Mongo URI/db are **not** configured on the server — they come from the addon.

### Auth is optional

This is designed to run as an **open public service**: the MongoDB URI a caller
sends already contains their credentials, so that URI *is* the access control.
With no keys set, the bridge is open to anyone — no `apiKey` needed in `Bridge()`.

If you instead run a **private** instance and want to gate it, set `API_KEY`
(one shared secret) and/or `API_KEYS` (per-addon keys, so you can revoke one
addon without touching the others; the label just shows up in logs):

```env
API_KEYS=survival:9f3a...,skyblock:7c21...
```

Each gated addon then sends its own key: `new Bridge({ apiKey: "9f3a...", ... })`.

---

## 2. Use it from a Bedrock addon

`@minecraft/server-net` requires a **Bedrock Dedicated Server (BDS)** with the
module declared in your behaviour pack's `manifest.json`:

```json
{
  "dependencies": [
    { "module_name": "@minecraft/server",     "version": "2.0.0" },
    { "module_name": "@minecraft/server-net",  "version": "1.0.0-beta" }
  ]
}
```

Copy the client into your addon's scripts — **TypeScript** users take
[`minecraft/ts/bridge.ts`](minecraft/ts/bridge.ts), **JavaScript** users take
[`minecraft/js/bridge.js`](minecraft/js/bridge.js). Both expose the same API
(see [`minecraft/README.md`](minecraft/README.md)). Then:

```ts
import { Bridge } from "./bridge.js";

const db = new Bridge({
  baseUrl: "http://127.0.0.1:3000",   // where the bridge server runs
  mongoUri: "mongodb+srv://user:pass@cluster.mongodb.net", // THIS addon's DB
  database: "my_addon",
  // apiKey: "..."  // only if the bridge server has auth enabled
});

// insert
await db.write("players", { name: "Steve", coins: 100 });

// insert many
await db.write("players", [{ name: "Alex" }, { name: "Herobrine" }]);

// read one
const steve = await db.get("players", { name: "Steve" });

// read many (with sort/limit)
const rich = await db.query("players", { coins: { $gt: 50 } }, { sort: { coins: -1 }, limit: 10 });

// update (must use operators like $set / $inc)
await db.update("players", { name: "Steve" }, { $inc: { coins: 10 } }, { upsert: true });

// count
const total = await db.count("players");

// delete (empty filters are rejected on purpose)
await db.delete("players", { name: "Steve" });
```

See `minecraft/ts/example.ts` (or `minecraft/js/example.js`) for a working
player-data + `/scriptevent` example.

---

## 3. HTTP API reference

All data endpoints are `POST` under `/v1`, require the `x-api-key` header, and
take a JSON body that always includes `uri`, `db`, and `collection`.

| Endpoint     | Extra body fields                        | Returns                                   |
| ------------ | ---------------------------------------- | ----------------------------------------- |
| `/v1/get`    | `filter`, `options`                      | `{ document }`                            |
| `/v1/query`  | `filter`, `options{sort,limit,skip,projection}` | `{ count, documents }`             |
| `/v1/write`  | `document` **or** `documents[]`          | `{ insertedId }` / `{ insertedIds }`      |
| `/v1/update` | `filter`, `update`, `options{upsert,many}` | `{ matchedCount, modifiedCount, upsertedId }` |
| `/v1/delete` | `filter`, `options{many}`                | `{ deletedCount }`                        |
| `/v1/count`  | `filter`                                 | `{ count }`                               |

Errors return `{ ok: false, error }` with an appropriate HTTP status
(`400` bad input, `401` bad key, `403` not allowed, `502` DB unreachable).

---

## ⚠️ Security notes (read before going public)

This bridge is a **remote MongoDB gateway** that connects to whatever URI a
caller sends. Running it open to the public is intentional, but be aware:

- **SSRF.** Since callers control the target host, a malicious caller could aim
  the server at internal hosts (`127.0.0.1`, cloud metadata endpoints, private
  ranges). It only speaks the MongoDB wire protocol, which limits the blast
  radius, but if you deploy publicly you should **block private/internal hosts**
  (I can add an SSRF guard that resolves and rejects private IPs — just ask) or
  restrict targets via `ALLOWED_URI_HOSTS`.
- **Abuse / DoS.** An open endpoint invites resource exhaustion. Put a **rate
  limiter** and/or a reverse proxy in front of it.
- **TLS.** Terminate **HTTPS** in front of the bridge — callers' Mongo
  credentials (in the URI) travel inside the request body otherwise.
- **Least privilege.** Each user should use a **dedicated DB user** scoped to
  their database, never an admin/root Atlas account.
- Callers' credentials pass through the server in memory only; the bridge never
  logs request bodies or persists URIs.

---

## Docker

```bash
docker build -t nethergate-bridge .
docker run -p 3000:3000 --env-file .env nethergate-bridge
```

Multi-stage build: it bundles to `dist/index.js`, then the runtime image ships
**only that one file** (no `node_modules`) and runs as the non-root `node` user.

---

## Scripts

| Command             | Does                                                   |
| ------------------- | ------------------------------------------------------ |
| `npm run dev`       | Run the server with live reload (via `tsx`).           |
| `npm run build`     | Bundle `src/` → a single `dist/index.js` (via esbuild).|
| `npm start`         | Run the bundled server (`dist/index.js`).              |
| `npm run typecheck` | Type-check with `tsc` (no output emitted).             |
