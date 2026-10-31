import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { writePersonaFile } from "../ingest/persona-file";
import { importGroupExport } from "../memory/group-import";
import type { GroupIndex } from "../memory/group-index";
import { assertGroupId, type GroupStore } from "../memory/group-store";

export interface ApiOptions {
  apiKey: string;
  /** Where imported group records are stored. */
  groups: GroupStore;
  index: GroupIndex;
  /** Largest accepted export, in bytes. */
  maxBodyBytes?: number | undefined;
  /** Where the persona file is written. */
  personaFile: string;
}

const MAX_BODY = 50 * 1024 * 1024;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * HTTP API for ingesting WhatsApp exports: one persona (the voice to learn)
 * and any number of group chats (the memory to recall). Every route needs
 * `Authorization: Bearer <API_KEY>`.
 */
export function createApi(opts: ApiOptions): Hono {
  const app = new Hono();
  const maxBody = opts.maxBodyBytes ?? MAX_BODY;

  app.use("/v1/*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!(opts.apiKey && safeEqual(token, opts.apiKey))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  app.post("/v1/persona", async (c) => {
    const raw = await readBody(c.req.raw, maxBody);
    if (raw === undefined) {
      return c.json({ error: "export too large" }, 413);
    }
    const sender = c.req.query("sender");
    if (!sender) {
      return c.json({ error: "query parameter sender is required" }, 400);
    }
    const result = writePersonaFile(raw, {
      name: c.req.query("name") ?? undefined,
      out: opts.personaFile,
      sender,
    });
    return c.json({
      exchanges: result.exchanges,
      facts: result.factCount,
      note: "The bot reads the persona file at startup. Restart it to use the new file.",
      quotes: result.quotes,
    });
  });

  app.get("/v1/memory/groups", (c) =>
    c.json({ groups: opts.index.summaries() })
  );

  app.post("/v1/memory/groups/:group", async (c) => {
    let group: string;
    try {
      group = assertGroupId(c.req.param("group"));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
    const raw = await readBody(c.req.raw, maxBody);
    if (raw === undefined) {
      return c.json({ error: "export too large" }, 413);
    }

    const records = importGroupExport(raw, group);
    const added = await opts.groups.append(group, records);
    opts.index.add(group, records);
    return c.json({
      added,
      group,
      parsed: records.length,
      skipped: records.length - added,
    });
  });

  app.get("/v1/memory/groups/:group/search", (c) => {
    const query = c.req.query("q") ?? "";
    if (!query.trim()) {
      return c.json({ error: "query parameter q is required" }, 400);
    }
    const limit = Math.min(
      50,
      Math.max(1, Number(c.req.query("limit") ?? 5) || 5)
    );
    const group = c.req.param("group");
    const hits = opts.index.rank(query, { group, limit });
    return c.json({
      hits: hits.map((h) => ({
        breakdown: h.breakdown,
        context: h.context
          ? `${h.context.sender}: ${h.context.text}`
          : undefined,
        score: Number(h.score.toFixed(4)),
        sender: h.record.sender,
        text: h.node.text,
        ts: h.record.ts,
      })),
    });
  });

  app.delete("/v1/memory/groups/:group", async (c) => {
    const group = c.req.param("group");
    const removed = await opts.groups.remove(group);
    opts.index.delete(group);
    return c.json({ group, removed });
  });

  return app;
}

/** Reads a request body as text, or undefined when it is over the limit. */
async function readBody(
  req: Request,
  max: number
): Promise<string | undefined> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max) {
    return undefined;
  }
  const text = await req.text();
  return text.length > max ? undefined : text;
}
