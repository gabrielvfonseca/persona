type Listener = (...args: unknown[]) => void;

export interface ShimOptions {
  headers?: Record<string, string> | undefined;
  origin?: string | undefined;
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

const WSS_PREFIX = /^wss:/u;
const WS_PREFIX = /^ws:/u;

async function toBuffer(raw: unknown): Promise<Buffer | string> {
  if (raw instanceof Blob) return Buffer.from(await raw.arrayBuffer());
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  return typeof raw === "string" ? raw : "";
}

export default class WebSocket {
  static CONNECTING = CONNECTING;
  static OPEN = OPEN;
  static CLOSING = CLOSING;
  static CLOSED = CLOSED;

  readyState: number = CONNECTING;
  private socket: globalThis.WebSocket | null = null;
  private readonly listeners = new Map<string, Listener[]>();
  private inbound: Promise<void> = Promise.resolve();
  private readonly url: URL | string;
  private readonly options: ShimOptions;

  constructor(url: URL | string, options: ShimOptions = {}) {
    this.url = url;
    this.options = options;
    this.connect().catch((err) => {
      this.readyState = CLOSED;
      this.emit("error", err);
      this.emit("close", 1006, String(err));
    });
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const fn of this.listeners.get(event) ?? []) fn(...args);
  }

  on(event: string, fn: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
    return this;
  }

  once(event: string, fn: Listener): this {
    return this.on(event, fn);
  }

  setMaxListeners(): this {
    return this;
  }

  removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }

  private async connect(): Promise<void> {
    const httpUrl = String(this.url)
      .replace(WSS_PREFIX, "https:")
      .replace(WS_PREFIX, "http:");
    const headers: Record<string, string> = {
      ...this.options.headers,
      Upgrade: "websocket",
    };
    if (this.options.origin) headers.Origin = this.options.origin;
    const res = await fetch(httpUrl, { headers });
    const socket = res.webSocket;
    if (!socket)
      throw new Error(`WebSocket upgrade failed: HTTP ${res.status}`);
    socket.accept();
    this.socket = socket;
    this.readyState = OPEN;
    socket.addEventListener("message", (e) => {
      this.inbound = this.inbound
        .then(async () => this.emit("message", await toBuffer(e.data)))
        .catch((err) => this.emit("error", err));
    });
    socket.addEventListener("close", (e) => {
      this.readyState = CLOSED;
      this.emit("close", e.code, e.reason);
    });
    socket.addEventListener("error", (e) => this.emit("error", e));
    this.emit("open");
  }

  send(data: string | Uint8Array, cb?: (err?: Error) => void): void {
    try {
      this.socket?.send(data);
      cb?.();
    } catch (err) {
      cb?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  close(code?: number, reason?: string): void {
    this.readyState = CLOSING;
    try {
      this.socket?.close(code, reason);
    } catch {}
  }

  terminate(): void {
    this.close();
  }
}
