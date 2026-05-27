import type {
  Operation,
  SyncCursor,
  SyncPullResponse,
} from "@ollu/shared-types";
import type { SyncTransport, TransportSubscription } from "./transport.js";

export interface WebSocketTransportOptions {
  readonly serverUrl: () => string;
  readonly appId: string;
  readonly sessionToken: () => string | null;
  readonly onUnauthorized?: () => void | Promise<void>;
}

interface PendingPush {
  readonly resolve: () => void;
  readonly reject: (err: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const PUSH_TIMEOUT_MS = 30_000;
const RECENT_PUSH_TTL_MS = 60_000;
const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * SyncTransport over a single WebSocket connection.
 *
 * Protocol:
 *   ▸ client → server
 *     { type: "subscribe", appId, since }
 *     { type: "push", id, appId, ops }
 *     { type: "ping" }
 *   ▸ server → client
 *     { type: "ops", ops, nextCursor, hasMore }
 *     { type: "pushAck", id, accepted }
 *     { type: "error", id?, message }
 *     { type: "pong" }
 *
 * pullSince doesn't actively pull — incoming ops are queued as the server
 * pushes them, and pullSince drains the queue. The first pullSince call
 * issues the `subscribe` message with the engine's persisted cursor so
 * the server replays whatever the client missed while offline.
 *
 * Echoes (the server bouncing our own pushed ops back via the broadcast
 * bus) are filtered locally by remembering recently-sent op ids; the
 * server's broadcast logic doesn't single out the originator.
 */
export class WebSocketTransport implements SyncTransport {
  private socket: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private hintListeners = new Set<() => void>();
  private queue: Operation[] = [];
  private lastSeenCursor: SyncCursor | null = null;
  private subscribedWithCursor: SyncCursor | null | undefined = undefined;
  private pendingPushes = new Map<string, PendingPush>();
  private recentlySent = new Map<string, number>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectBackoff = RECONNECT_INITIAL_MS;
  private wantConnection = false;
  private closed = false;

  constructor(private readonly options: WebSocketTransportOptions) {}

  async pullSince(
    cursor: SyncCursor | null,
    _limit?: number,
  ): Promise<SyncPullResponse> {
    // Make sure the socket exists and the engine's cursor has been
    // communicated to the server. After that, just hand back whatever
    // landed in the queue since last drain.
    await this.ensureSubscribed(cursor);
    const ops = this.queue;
    this.queue = [];
    return {
      ops,
      nextCursor: this.lastSeenCursor,
      hasMore: false,
    };
  }

  async push(ops: readonly Operation[]): Promise<void> {
    if (ops.length === 0) return;
    const socket = await this.ensureConnected();
    const id = generateRequestId();
    const now = Date.now();
    for (const op of ops) this.recentlySent.set(op.id, now);
    this.gcRecentlySent(now);
    return await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingPushes.delete(id)) {
          reject(new Error("push timeout"));
        }
      }, PUSH_TIMEOUT_MS);
      this.pendingPushes.set(id, { resolve, reject, timer });
      try {
        socket.send(
          JSON.stringify({
            type: "push",
            id,
            appId: this.options.appId,
            ops,
          }),
        );
      } catch (err) {
        clearTimeout(timer);
        this.pendingPushes.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  subscribeHints(onHint: () => void): TransportSubscription {
    this.hintListeners.add(onHint);
    this.wantConnection = true;
    void this.ensureConnected().catch(() => undefined);
    return {
      close: () => {
        this.hintListeners.delete(onHint);
        if (this.hintListeners.size === 0) {
          this.wantConnection = false;
          this.closeSocket();
        }
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────

  private async ensureConnected(): Promise<WebSocket> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return this.socket;
    }
    if (this.connecting) return this.connecting;
    this.connecting = this.connect();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async ensureSubscribed(cursor: SyncCursor | null): Promise<void> {
    const socket = await this.ensureConnected();
    if (this.subscribedWithCursor === cursor) return;
    this.subscribedWithCursor = cursor;
    socket.send(
      JSON.stringify({
        type: "subscribe",
        appId: this.options.appId,
        since: cursor,
      }),
    );
  }

  private async connect(): Promise<WebSocket> {
    const token = this.options.sessionToken();
    if (!token) {
      throw new Error("no session token");
    }
    const base = this.options.serverUrl().replace(/\/+$/, "");
    const url = new URL(`${base}/sync/socket`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);

    return await new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url.toString());
      ws.onopen = () => {
        this.socket = ws;
        this.reconnectBackoff = RECONNECT_INITIAL_MS;
        // After a reconnect we need to re-subscribe with the latest cursor
        // we've seen so the server replays anything that happened while we
        // were down.
        const wasSubscribed = this.subscribedWithCursor !== undefined;
        if (wasSubscribed) {
          this.subscribedWithCursor = undefined;
          ws.send(
            JSON.stringify({
              type: "subscribe",
              appId: this.options.appId,
              since: this.lastSeenCursor,
            }),
          );
          this.subscribedWithCursor = this.lastSeenCursor;
        }
        settled = true;
        resolve(ws);
      };
      ws.onmessage = (e) => this.handleMessage(e.data);
      ws.onerror = () => {
        // onclose will fire next; reject there if we were never opened.
      };
      ws.onclose = (e) => {
        const wasOurSocket = this.socket === ws;
        this.socket = null;
        this.subscribedWithCursor = undefined;
        if (!settled) {
          settled = true;
          reject(new Error(`socket closed before open: ${e.code} ${e.reason}`));
        }
        for (const p of this.pendingPushes.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("socket closed"));
        }
        this.pendingPushes.clear();
        if (wasOurSocket && this.wantConnection && !this.closed) {
          // 4401 is what some browsers map server "401 during upgrade" to —
          // surface that to the caller so they can refresh the session.
          if (e.code === 4401 || e.code === 1008) {
            void this.options.onUnauthorized?.();
          }
          this.scheduleReconnect();
        }
      };
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closed) return;
    const delay = this.reconnectBackoff;
    this.reconnectBackoff = Math.min(this.reconnectBackoff * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.wantConnection) return;
      void this.ensureConnected().catch(() => {
        if (this.wantConnection) this.scheduleReconnect();
      });
    }, delay);
  }

  private closeSocket(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let msg: { type?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    switch (msg.type) {
      case "ops": {
        const opsRaw = Array.isArray(msg.ops) ? (msg.ops as Operation[]) : [];
        // Filter out our own pushed ops bouncing back via the server bus.
        const ops = opsRaw.filter((op) => !this.recentlySent.has(op.id));
        if (ops.length > 0) this.queue.push(...ops);
        if (typeof msg.nextCursor === "number") {
          this.lastSeenCursor = msg.nextCursor;
        }
        if (ops.length > 0) {
          for (const fn of this.hintListeners) fn();
        }
        break;
      }
      case "pushAck": {
        const id = msg.id as string | undefined;
        if (id) {
          const p = this.pendingPushes.get(id);
          if (p) {
            clearTimeout(p.timer);
            this.pendingPushes.delete(id);
            p.resolve();
          }
        }
        break;
      }
      case "error": {
        const id = msg.id as string | undefined;
        const message = (msg.message as string | undefined) ?? "server error";
        if (id) {
          const p = this.pendingPushes.get(id);
          if (p) {
            clearTimeout(p.timer);
            this.pendingPushes.delete(id);
            p.reject(new Error(message));
          }
        } else {
          console.warn("[ws] server error:", message);
        }
        break;
      }
      case "pong":
        break;
      default:
        break;
    }
  }

  private gcRecentlySent(now: number): void {
    for (const [opId, ts] of this.recentlySent) {
      if (now - ts > RECENT_PUSH_TTL_MS) this.recentlySent.delete(opId);
    }
  }
}

function generateRequestId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
