/**
 * WhatsApp for persona bots, behind one API. Two ways in, one message shape out:
 *
 * - Cloud API (Meta's webhook, runs on Workers): `WhatsappClient`, `createWhatsappWebhook`.
 * - Linked device (a Baileys socket, runs on Node): `connectWhatsappSocket`,
 *   `attachBot`, `runOnNode`, `withSocket`, `listGroups`.
 *
 * Both implement `Channel` from `@persona/core` and deliver `IncomingMessage`s to the SDK.
 */

export { type AttachBotOpts, attachBot } from "./attach";
export {
  type KeyValueStorage,
  useKeyValueAuthState,
} from "./auth-state";
export { WhatsappSocketChannel } from "./channel";
export {
  WhatsappClient,
  type WhatsappClientOpts,
  WhatsappError,
} from "./client";
export {
  type ConnectWhatsappSocketOpts,
  connectWhatsappSocket,
} from "./connect";
export {
  createGroupSizeLookup,
  type GroupSizeLookup,
  type GroupSummary,
  listGroups,
} from "./groups";
export { type ToIncomingOpts, toIncoming } from "./message";
export { type RunOnNodeOpts, runOnNode, withSocket } from "./node";
export {
  type BackgroundTasks,
  createWhatsappWebhook,
  type WhatsappWebhookOpts,
} from "./webhook";
