import { z } from "zod";

const mediaRef = z.object({
  id: z.string(),
  mime_type: z.string(),
  caption: z.string().optional(),
});

const messageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  image: mediaRef.optional(),
  sticker: mediaRef.optional(),
});

const entrySchema = z.object({
  id: z.string(),
  changes: z.array(
    z.object({
      value: z.object({
        messaging_product: z.literal("whatsapp"),
        metadata: z.object({
          display_phone_number: z.string(),
          phone_number_id: z.string(),
        }),
        messages: z.array(messageSchema).optional(),
      }),
      field: z.string(),
    }),
  ),
});

const webhookSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(entrySchema),
});

export interface MediaRef {
  kind: "image" | "sticker";
  mediaId: string;
  mime: string;
}

/** One inbound message. Media is referenced by id; download it with the client. */
export interface InboundMessage {
  from: string;
  id: string;
  text: string;
  timestamp: string;
  media?: MediaRef | undefined;
}

/**
 * Text, image and sticker messages sent to `phoneNumberId`. Other types, and
 * messages with neither text nor media, are skipped.
 */
export function extractMessages(
  payload: unknown,
  phoneNumberId: string,
): InboundMessage[] {
  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success) return [];
  const out: InboundMessage[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.value.metadata.phone_number_id !== phoneNumberId) continue;
      for (const msg of change.value.messages ?? []) {
        const base = { from: msg.from, id: msg.id, timestamp: msg.timestamp };
        if (msg.type === "text" && msg.text) {
          out.push({ ...base, text: msg.text.body });
        } else if (msg.type === "image" && msg.image) {
          out.push({
            ...base,
            text: msg.image.caption ?? "",
            media: {
              kind: "image",
              mediaId: msg.image.id,
              mime: msg.image.mime_type,
            },
          });
        } else if (msg.type === "sticker" && msg.sticker) {
          out.push({
            ...base,
            text: "",
            media: {
              kind: "sticker",
              mediaId: msg.sticker.id,
              mime: msg.sticker.mime_type,
            },
          });
        }
      }
    }
  }
  return out;
}
