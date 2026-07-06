import express, { type Request, type Response, type NextFunction } from "express";
import { config } from "./config.js";
import { startIdleSweeper, closeAll } from "./db.js";
import { requireApiKey } from "./auth.js";
import { router } from "./routes.js";

const app = express();

app.use(express.json({ limit: "1mb" }));

// Public health check (no API key) so you can probe the server easily.
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "nethergate-bridge" });
});

// Everything under /v1 requires the API key.
app.use("/v1", requireApiKey, router);

// Reject malformed JSON bodies cleanly instead of a stack trace.
app.use((err: Error & { type?: string }, _req: Request, res: Response, next: NextFunction) => {
  if (err.type === "entity.parse.failed") {
    res.status(400).json({ ok: false, error: "Invalid JSON body" });
    return;
  }
  next(err);
});

const server = app.listen(config.port, () => {
  console.log(`[bridge] listening on http://localhost:${config.port}`);
  if (config.apiKeys.length) {
    console.log(`[bridge] auth ON — ${config.apiKeys.length} key(s): ${config.apiKeys.map((k) => k.label).join(", ")}`);
  } else {
    console.log(`[bridge] auth OFF — open access (URI credentials are the access control)`);
  }
  if (config.allowedCollections.length) {
    console.log(`[bridge] allowed collections: ${config.allowedCollections.join(", ")}`);
  }
  if (config.allowedUriHosts.length) {
    console.log(`[bridge] allowed Mongo hosts: ${config.allowedUriHosts.join(", ")}`);
  } else {
    console.log(`[bridge] WARNING: any MongoDB host is allowed (set ALLOWED_URI_HOSTS to restrict)`);
  }
});

const sweeper = startIdleSweeper();

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[bridge] ${signal} received, shutting down...`);
  clearInterval(sweeper);
  server.close();
  await closeAll();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
