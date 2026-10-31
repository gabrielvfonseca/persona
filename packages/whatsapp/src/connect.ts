import type { Logger } from "@persona/core";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type WAVersion,
} from "baileys";
import qrcode from "qrcode-terminal";

const RECONNECT_DELAY_MS = 3000;

export interface ConnectWhatsappSocketOpts {
  authDir?: string | undefined;
  logger?: Logger | undefined;
  onSocket?: ((sock: WASocket) => void) | undefined;
  onStatus?: ((status: string) => void) | undefined;
  reconnect?: boolean | undefined;
  version?: WAVersion | undefined;
}

type SocketConfig = Parameters<typeof makeWASocket>[0];

/**
 * Baileys reports the disconnect reason as `output.statusCode` on its Boom error.
 * Only a logout code means the session is gone. Any other error is transient.
 */
export function isLoggedOut(error: unknown): boolean {
  const statusCode = (
    error as { output?: { statusCode?: unknown } } | undefined
  )?.output?.statusCode;
  return statusCode === DisconnectReason.loggedOut;
}

export async function connectWhatsappSocket(
  opts: ConnectWhatsappSocketOpts = {}
): Promise<WASocket> {
  const { onSocket, onStatus, reconnect = true, logger } = opts;

  const { state, saveCreds } = await import("baileys").then((b) =>
    b.useMultiFileAuthState(opts.authDir ?? ".auth")
  );
  const { version: v } = await fetchLatestBaileysVersion();
  const resolvedVersion: WAVersion | undefined =
    opts.version ?? (Array.isArray(v) ? v : undefined);

  const sock = makeWASocket({
    auth: state,
    // Baileys wants a pino-style logger; ours only has info, warn and error.
    // Without one, keep Baileys' default: passing `undefined` overrides it and crashes on logger.child.
    ...(logger
      ? { logger: logger as NonNullable<SocketConfig["logger"]> }
      : {}),
    printQRInTerminal: false,
    ...(resolvedVersion ? { version: resolvedVersion } : {}),
  });

  sock.ev.on("creds.update", () =>
    saveCreds().catch((e) => logger?.error?.("saveCreds", e))
  );

  sock.ev.on("connection.update", (update) => {
    if (update.qr) {
      qrcode.generate(update.qr, { small: true });
      onStatus?.("waiting for QR scan");
    }
    if (update.connection === "open") {
      onStatus?.("open");
    }
    if (update.connection === "close") {
      if (isLoggedOut(update.lastDisconnect?.error)) {
        onStatus?.("logged out");
      } else if (reconnect) {
        onStatus?.(`closed, reconnecting in ${RECONNECT_DELAY_MS}ms`);
        setTimeout(() => {
          connectWhatsappSocket(opts).catch((e) =>
            logger?.error?.("reconnect", e)
          );
        }, RECONNECT_DELAY_MS);
      } else {
        onStatus?.("closed");
      }
    }
  });

  onSocket?.(sock);
  return sock;
}
