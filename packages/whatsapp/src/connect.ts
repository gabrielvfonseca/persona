import type { Logger } from "@persona/core";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type WAVersion,
} from "baileys";
import qrcode from "qrcode-terminal";

const RECONNECT_DELAY_MS = 3000;

export interface ConnectBaileysOpts {
  authDir?: string | undefined;
  onSocket?: ((sock: WASocket) => void) | undefined;
  onStatus?: ((status: string) => void) | undefined;
  reconnect?: boolean | undefined;
  version?: WAVersion | undefined;
  logger?: Logger | undefined;
}

type SocketConfig = Parameters<typeof makeWASocket>[0];

export async function connectBaileys(
  opts: ConnectBaileysOpts = {},
): Promise<WASocket> {
  const { onSocket, onStatus, reconnect = true, logger } = opts;

  const { state, saveCreds } = await import("baileys").then((b) =>
    b.useMultiFileAuthState(opts.authDir ?? ".auth"),
  );
  const { version: v } = await fetchLatestBaileysVersion();
  const resolvedVersion: WAVersion | undefined =
    opts.version ?? (Array.isArray(v) ? v : undefined);

  const sock = makeWASocket({
    auth: state,
    // Baileys wants a pino-style logger; ours only has info, warn and error.
    logger: logger as NonNullable<SocketConfig["logger"]>,
    printQRInTerminal: false,
    ...(resolvedVersion ? { version: resolvedVersion } : {}),
  });

  sock.ev.on("creds.update", () =>
    saveCreds().catch((e) => logger?.error?.("saveCreds", e)),
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
      const code = update.lastDisconnect?.error
        ? DisconnectReason.loggedOut
        : undefined;
      if (code === DisconnectReason.loggedOut) {
        onStatus?.("logged out");
      } else if (reconnect) {
        onStatus?.(`closed, reconnecting in ${RECONNECT_DELAY_MS}ms`);
        setTimeout(() => {
          connectBaileys(opts).catch((e) => logger?.error?.("reconnect", e));
        }, RECONNECT_DELAY_MS);
      } else {
        onStatus?.("closed");
      }
    }
  });

  onSocket?.(sock);
  return sock;
}
