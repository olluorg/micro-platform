import type { Operation, SyncCursor } from "@ollu/shared-types";
import type { KvStore } from "../kv/index.js";
import type { SyncTransport, TransportSubscription } from "../transport/transport.js";
import type { HLClock } from "./hlc.js";
import type { Outbox } from "./outbox.js";

export interface SyncEngineOptions {
  readonly appId: string;
  readonly clock: HLClock;
  readonly outbox: Outbox;
  readonly transport: SyncTransport;
  readonly kv: KvStore;
  readonly onIncoming: (ops: readonly Operation[]) => Promise<void>;
  readonly pushBatchSize?: number;
  readonly pullBatchSize?: number;
  readonly periodicMs?: number;
}

const DEFAULT_PUSH = 100;
const DEFAULT_PULL = 1000;
const DEFAULT_PERIODIC = 30_000;

export class SyncEngine {
  private running = false;
  private pumpInFlight = false;
  private pumpQueued = false;
  private sub: TransportSubscription | undefined;
  private cursor: SyncCursor | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: SyncEngineOptions) {}

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.cursor = (await this.options.kv.get<SyncCursor>(this.cursorKey())) ?? null;
    this.sub = this.options.transport.subscribeHints(() => this.schedule());
    this.periodicTimer = setInterval(
      () => this.schedule(),
      this.options.periodicMs ?? DEFAULT_PERIODIC,
    );
    this.schedule();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.sub?.close();
    this.sub = undefined;
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = undefined;
    }
  }

  /** Call this after a local write to push outbox immediately. */
  schedule(): void {
    if (!this.running) return;
    if (this.pumpInFlight) {
      this.pumpQueued = true;
      return;
    }
    this.pumpInFlight = true;
    this.pump()
      .catch((err) => {
        console.error("[sync] pump failed", err);
      })
      .finally(() => {
        this.pumpInFlight = false;
        if (this.pumpQueued && this.running) {
          this.pumpQueued = false;
          this.schedule();
        }
      });
  }

  private async pump(): Promise<void> {
    await this.flushOutbox();
    await this.pullAll();
  }

  private async flushOutbox(): Promise<void> {
    const batchSize = this.options.pushBatchSize ?? DEFAULT_PUSH;
    while (this.running) {
      const entries = await this.options.outbox.peek(batchSize);
      if (entries.length === 0) return;
      const ops = entries.map((e) => e.op);
      await this.options.transport.push(ops);
      await this.options.outbox.ack(entries.map((e) => e.op.id));
    }
  }

  private async pullAll(): Promise<void> {
    const batchSize = this.options.pullBatchSize ?? DEFAULT_PULL;
    while (this.running) {
      const resp = await this.options.transport.pullSince(this.cursor, batchSize);
      if (resp.ops.length > 0) {
        await this.options.onIncoming(resp.ops);
      }
      if (resp.nextCursor !== null) {
        this.cursor = resp.nextCursor;
        await this.options.kv.set(this.cursorKey(), this.cursor);
      }
      if (!resp.hasMore) return;
    }
  }

  private cursorKey(): string {
    return `_sync.cursor.${this.options.appId}`;
  }
}
