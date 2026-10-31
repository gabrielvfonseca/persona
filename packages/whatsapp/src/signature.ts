import { verifyWhatsAppWebhook } from "@openchannelprotocol/sdk/whatsapp";

/**
 * True when the `X-Hub-Signature-256` header matches the raw body. Uses the
 * OpenChannel SDK, which compares in constant time.
 */
export function isValidSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  try {
    verifyWhatsAppWebhook(
      {
        body: rawBody,
        headers: { "x-hub-signature-256": signatureHeader ?? undefined },
      },
      appSecret
    );
    return true;
  } catch {
    return false;
  }
}
