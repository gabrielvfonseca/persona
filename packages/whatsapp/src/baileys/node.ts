import type { MessageHandler } from "@persona/core";
import type { WASocket } from "baileys";
import { attachBot } from "./attach";
import { connectBaileys } from "./connect";

export interface RunOnNodeOpts {
  authDir?: string | undefined;
  onStatus?: ((status: string) => void) | undefined;
}

export async function runOnNode(
  bot: MessageHandler,
  opts: RunOnNodeOpts = {},
): Promise<void> {
  const sock = await connectBaileys({
    authDir: opts.authDir,
    onStatus: opts.onStatus,
    reconnect: true,
  });
  attachBot(sock, bot);

  const stop = () => {
    sock.end(undefined);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

export async function withSocket<T>(
  fn: (sock: WASocket) => Promise<T>,
  opts: { authDir?: string } = {},
): Promise<T> {
  const sock = await connectBaileys({
    authDir: opts.authDir,
    reconnect: false,
  });
  try {
    return await fn(sock);
  } finally {
    sock.end(undefined);
  }
}
