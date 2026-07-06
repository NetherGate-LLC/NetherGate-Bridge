import { Router, type Request, type Response, type NextFunction } from "express";
import type { Collection, Document, Filter, UpdateFilter } from "mongodb";
import { getCollection } from "./db.js";
import { config } from "./config.js";
import { HttpError } from "./errors.js";

export const router = Router();

/** Wrap an async handler so thrown errors reach the error middleware. */
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

function validateCollectionName(name: unknown): string {
  if (typeof name !== "string" || !name.trim()) {
    throw new HttpError(400, "Field 'collection' is required and must be a string");
  }
  const clean = name.trim();
  if (clean.startsWith("system.") || clean.includes("$") || clean.includes("\0")) {
    throw new HttpError(400, `Illegal collection name: ${clean}`);
  }
  if (config.allowedCollections.length && !config.allowedCollections.includes(clean)) {
    throw new HttpError(403, `Collection '${clean}' is not allowed`);
  }
  return clean;
}

/** Resolve the target collection from the request body's uri/db/collection. */
async function resolveCollection(body: Record<string, unknown>): Promise<Collection<Document>> {
  const name = validateCollectionName(body.collection);
  return getCollection(body.uri, body.db, name);
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `Field '${field}' must be an object`);
  }
  return value as Record<string, unknown>;
}

// GET one document — body: { uri, db, collection, filter, options }
router.post(
  "/get",
  wrap(async (req, res) => {
    const col = await resolveCollection(req.body);
    const filter = asObject(req.body.filter, "filter") as Filter<Document>;
    const options = asObject(req.body.options, "options");
    const document = await col.findOne(filter, options);
    res.json({ ok: true, document });
  })
);

// QUERY many — body: { uri, db, collection, filter, options: {sort,limit,skip,projection} }
router.post(
  "/query",
  wrap(async (req, res) => {
    const col = await resolveCollection(req.body);
    const filter = asObject(req.body.filter, "filter") as Filter<Document>;
    const options = asObject(req.body.options, "options");
    const limit = Math.min(Number(options.limit) || config.maxDocuments, config.maxDocuments);

    let cursor = col.find(filter, { projection: options.projection as Document }).limit(limit);
    if (options.sort) cursor = cursor.sort(options.sort as Document);
    if (options.skip) cursor = cursor.skip(Number(options.skip));

    const documents = await cursor.toArray();
    res.json({ ok: true, count: documents.length, documents });
  })
);

// WRITE — body: { uri, db, collection, document } OR { ..., documents: [...] }
router.post(
  "/write",
  wrap(async (req, res) => {
    const col = await resolveCollection(req.body);

    if (Array.isArray(req.body.documents)) {
      const docs = req.body.documents as Document[];
      if (docs.length > config.maxDocuments) {
        throw new HttpError(400, `Cannot insert more than ${config.maxDocuments} documents at once`);
      }
      const result = await col.insertMany(docs);
      res.json({
        ok: true,
        insertedCount: result.insertedCount,
        insertedIds: Object.values(result.insertedIds).map(String),
      });
      return;
    }

    const document = asObject(req.body.document, "document");
    if (!Object.keys(document).length) {
      throw new HttpError(400, "Provide a non-empty 'document' or a 'documents' array");
    }
    const result = await col.insertOne(document as Document);
    res.json({ ok: true, insertedId: String(result.insertedId) });
  })
);

// UPDATE — body: { uri, db, collection, filter, update, options: {upsert, many} }
router.post(
  "/update",
  wrap(async (req, res) => {
    const col = await resolveCollection(req.body);
    const filter = asObject(req.body.filter, "filter") as Filter<Document>;
    const update = asObject(req.body.update, "update");
    const options = asObject(req.body.options, "options");

    if (!Object.keys(update).length) {
      throw new HttpError(400, "Field 'update' is required");
    }
    const hasOperator = Object.keys(update).some((k) => k.startsWith("$"));
    if (!hasOperator) {
      throw new HttpError(400, "'update' must use operators like $set or $inc");
    }

    const method = options.many ? "updateMany" : "updateOne";
    const result = await col[method](filter, update as UpdateFilter<Document>, {
      upsert: Boolean(options.upsert),
    });
    res.json({
      ok: true,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedId: result.upsertedId ? String(result.upsertedId) : null,
    });
  })
);

// DELETE — body: { uri, db, collection, filter, options: {many} }
router.post(
  "/delete",
  wrap(async (req, res) => {
    const col = await resolveCollection(req.body);
    const filter = asObject(req.body.filter, "filter") as Filter<Document>;
    const options = asObject(req.body.options, "options");

    if (!Object.keys(filter).length) {
      throw new HttpError(400, "Refusing to delete with an empty filter");
    }

    const method = options.many ? "deleteMany" : "deleteOne";
    const result = await col[method](filter);
    res.json({ ok: true, deletedCount: result.deletedCount });
  })
);

// COUNT — body: { uri, db, collection, filter }
router.post(
  "/count",
  wrap(async (req, res) => {
    const col = await resolveCollection(req.body);
    const filter = asObject(req.body.filter, "filter") as Filter<Document>;
    const count = await col.countDocuments(filter);
    res.json({ ok: true, count });
  })
);

// Surface HttpError with its status; everything else is a 500.
router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error("[bridge] unexpected error:", err);
  res.status(status).json({ ok: false, error: err.message });
});
