import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemory } from "@persona/memory";
import { describe, expect, it } from "vitest";
import { createApi } from "../src/api/app";
import { GroupIndex } from "../src/memory/group-index";
import { memoryGroupStore } from "../src/memory/group-store";

const KEY = "test-api-key-0123456789";
const EXPORT = [
  "[28/10/2026, 20:00:00] Caio: alguém sabe o endereço do bakery novo?",
  "[28/10/2026, 20:01:00] Dani: é na rua azul 42, perto da praça",
  "[28/10/2026, 20:02:00] Caio: valeu pela ajuda",
].join("\n");

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "bot-api-"));
  const memory = createMemory();
  const index = new GroupIndex(memory.nodes);
  const groups = memoryGroupStore();
  const app = createApi({
    apiKey: KEY,
    groups,
    index,
    personaFile: join(dir, "persona.json"),
  });
  const auth = { authorization: `Bearer ${KEY}` };
  return { app, auth, dir, groups, index };
}

describe("ingest API", () => {
  it("rejects requests without the API key", async () => {
    const { app } = setup();
    const res = await app.request("/v1/memory/groups");
    expect(res.status).toBe(401);
  });

  it("rejects a wrong key", async () => {
    const { app } = setup();
    const res = await app.request("/v1/memory/groups", {
      headers: { authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });

  it("ingests a group, skips duplicates on re-import, and searches it", async () => {
    const { app, auth, groups } = setup();
    const post = () =>
      app.request("/v1/memory/groups/bakery", {
        body: EXPORT,
        headers: auth,
        method: "POST",
      });

    const first = await post();
    expect(await first.json()).toMatchObject({
      added: 3,
      parsed: 3,
      skipped: 0,
    });
    const second = await post();
    expect(await second.json()).toMatchObject({ added: 0, skipped: 3 });

    const search = await app.request(
      "/v1/memory/groups/bakery/search?q=bakery%20rua&limit=2",
      { headers: auth }
    );
    const body = (await search.json()) as {
      hits: { text: string; context?: string }[];
    };
    expect(body.hits[0]?.text).toContain(
      "Caio: alguém sabe o endereço do bakery"
    );
    expect((await groups.read("bakery")).length).toBeGreaterThan(0);
  });

  it("refuses unsafe group ids", async () => {
    const { app, auth } = setup();
    const res = await app.request("/v1/memory/groups/..%2Fetc", {
      body: EXPORT,
      headers: auth,
      method: "POST",
    });
    expect(res.status).toBe(400);
  });

  it("writes the persona file and keeps hand-written fields on re-ingest", async () => {
    const { app, auth, dir } = setup();
    const out = join(dir, "persona.json");
    writeFileSync(
      out,
      JSON.stringify({
        facts: ["Lives in Lisbon"],
        name: "Ana",
        phrases: ["bora"],
        quotes: [],
        stats: { medianLen: 1, p90Len: 2 },
        styleGuide: "Warm.",
        version: 1,
      })
    );
    const res = await app.request("/v1/persona?sender=Caio&name=Caio", {
      body: EXPORT,
      headers: auth,
      method: "POST",
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(out, "utf8")) as {
      styleGuide: string;
      phrases: string[];
      facts: string[];
    };
    expect(saved.styleGuide).toBe("Warm.");
    expect(saved.phrases).toEqual(["bora"]);
    expect(saved.facts).toEqual(["Lives in Lisbon"]);
  });

  it("requires the sender for a persona", async () => {
    const { app, auth } = setup();
    const res = await app.request("/v1/persona", {
      body: EXPORT,
      headers: auth,
      method: "POST",
    });
    expect(res.status).toBe(400);
  });

  it("deletes a group and stops returning its messages", async () => {
    const { app, auth, index } = setup();
    await app.request("/v1/memory/groups/bakery", {
      body: EXPORT,
      headers: auth,
      method: "POST",
    });
    const del = await app.request("/v1/memory/groups/bakery", {
      headers: auth,
      method: "DELETE",
    });
    expect(await del.json()).toMatchObject({ group: "bakery", removed: true });
    expect(index.rank("bakery")).toEqual([]);
  });

  it("refuses an export over the size limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bot-api-"));
    const index = new GroupIndex(createMemory().nodes);
    const app = createApi({
      apiKey: KEY,
      groups: memoryGroupStore(),
      index,
      maxBodyBytes: 10,
      personaFile: join(dir, "p.json"),
    });
    const res = await app.request("/v1/memory/groups/g", {
      body: EXPORT,
      headers: { authorization: `Bearer ${KEY}` },
      method: "POST",
    });
    expect(res.status).toBe(413);
  });
});
