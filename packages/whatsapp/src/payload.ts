import { z } from "zod";

const mediaRef = z.object({
  caption: z.string().optional(),
  id: z.string(),
  mime_type: z.string(),
});

const messageSchema = z.object({
  from: z.string(),
  id: z.string(),
  image: mediaRef.optional(),
  sticker: mediaRef.optional(),
  text: z.object({ body: z.string() }).optional(),
  timestamp: z.string(),
  type: z.string(),
});

const entrySchema = z.object({
  changes: z.array(
    z.object({
      field: z.string(),
      value: z.object({
        messages: z.array(messageSchema).optional(),
        messaging_product: z.literal("whatsapp"),
        metadata: z.object({
          display_phone_number: z.string(),
          phone_number_id: z.string(),
        }),
      }),
    })
  ),
  id: z.string(),
});

const webhookSchema = z.object({
  entry: z.array(entrySchema),
  object: z.literal("whatsapp_business_account"),
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
  media?: MediaRef | undefined;
  text: string;
  timestamp: string;
}

/**
 * Text, image and sticker messages sent to `phoneNumberId`. Other types, and
 * messages with neither text nor media, are skipped.
 */
export function extractMessages(
  payload: unknown,
  phoneNumberId: string
): InboundMessage[] {
  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success) {
    return [];
  }
  const out: InboundMessage[] = [];
  const changes = parsed.data.entry
    .flatMap((entry) => entry.changes)
    .filter(
      (change) => change.value.metadata.phone_number_id === phoneNumberId
    );
  for (const change of changes) {
    for (const msg of change.value.messages ?? []) {
      const base = { from: msg.from, id: msg.id, timestamp: msg.timestamp };
      if (msg.type === "text" && msg.text) {
        out.push({ ...base, text: msg.text.body });
      } else if (msg.type === "image" && msg.image) {
        out.push({
          ...base,
          media: {
            kind: "image",
            mediaId: msg.image.id,
            mime: msg.image.mime_type,
          },
          text: msg.image.caption ?? "",
        });
      } else if (msg.type === "sticker" && msg.sticker) {
        out.push({
          ...base,
          media: {
            kind: "sticker",
            mediaId: msg.sticker.id,
            mime: msg.sticker.mime_type,
          },
          text: "",
        });
      }
    }
  }
  return out;
}
