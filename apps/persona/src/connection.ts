import { DurableObject } from "cloudflare:workers";

/**
 * Durable Object for the linked-device session on Workers. Only the status
 * route exists yet. The Baileys channel itself is in packages/whatsapp/src/baileys.
 */
export class WhatsAppConnection extends DurableObject {
  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === "/status") {
      return Response.json({ status: "ok" });
    }
    return new Response("not found", { status: 404 });
  }
}
