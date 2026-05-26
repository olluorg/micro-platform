import type {
  Operation,
  SyncCursor,
  SyncPullResponse,
} from "@ollu/shared-types";
import type { SyncTransport, TransportSubscription } from "./transport.js";

export interface HttpSseTransportOptions {
  readonly serverUrl: () => string;
  readonly appId: string;
  readonly sessionToken: () => string | null;
  readonly onUnauthorized?: () => void | Promise<void>;
}

export class HttpSseTransport implements SyncTransport {
  constructor(private readonly options: HttpSseTransportOptions) {}

  async pullSince(
    cursor: SyncCursor | null,
    limit?: number,
  ): Promise<SyncPullResponse> {
    const url = new URL(`${this.base()}/sync/pull`);
    url.searchParams.set("appId", this.options.appId);
    if (cursor !== null) url.searchParams.set("cursor", String(cursor));
    if (limit !== undefined) url.searchParams.set("limit", String(limit));
    const resp = await fetch(url.toString(), { headers: this.authHeaders() });
    await this.checkResponse(resp, "pull");
    return (await resp.json()) as SyncPullResponse;
  }

  async push(ops: readonly Operation[]): Promise<void> {
    if (ops.length === 0) return;
    const resp = await fetch(`${this.base()}/sync/push`, {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ appId: this.options.appId, ops }),
    });
    await this.checkResponse(resp, "push");
  }

  subscribeHints(onHint: () => void): TransportSubscription {
    const controller = new AbortController();
    void this.streamLoop(onHint, controller.signal);
    return { close: () => controller.abort() };
  }

  private async streamLoop(onHint: () => void, signal: AbortSignal) {
    let backoff = 1000;
    while (!signal.aborted) {
      try {
        const url = new URL(`${this.base()}/sync/events`);
        url.searchParams.set("appId", this.options.appId);
        const resp = await fetch(url.toString(), {
          headers: { ...this.authHeaders(), Accept: "text/event-stream" },
          signal,
        });
        if (resp.status === 401) {
          await this.options.onUnauthorized?.();
          await sleep(5000, signal);
          continue;
        }
        if (!resp.ok || !resp.body) {
          throw new Error(`SSE failed: ${resp.status}`);
        }
        backoff = 1000;
        await parseSseStream(resp.body, onHint, signal);
      } catch (err) {
        if (signal.aborted) return;
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }

  private base(): string {
    return this.options.serverUrl().replace(/\/+$/, "");
  }

  private authHeaders(): Record<string, string> {
    const token = this.options.sessionToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async checkResponse(resp: Response, label: string): Promise<void> {
    if (resp.ok) return;
    if (resp.status === 401) await this.options.onUnauthorized?.();
    const text = await resp.text().catch(() => "");
    throw new Error(`${label} failed: ${resp.status} ${text}`);
  }
}

async function parseSseStream(
  body: ReadableStream<Uint8Array>,
  onHint: () => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const msg = parseSseMessage(raw);
      if (msg.event === "hint") onHint();
    }
  }
}

interface SseMessage {
  event?: string;
  data?: string;
}

function parseSseMessage(raw: string): SseMessage {
  const msg: SseMessage = {};
  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon);
    const value =
      line[colon + 1] === " " ? line.slice(colon + 2) : line.slice(colon + 1);
    if (field === "event") msg.event = value;
    else if (field === "data") msg.data = (msg.data ?? "") + value;
  }
  return msg;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
