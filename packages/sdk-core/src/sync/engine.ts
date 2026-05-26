import type { Operation } from "@ollu/shared-types";
import type { SyncTransport } from "../transport/transport.js";
import type { Outbox } from "./outbox.js";
import type { HLClock } from "./hlc.js";

export interface SyncEngineOptions {
  readonly appId: string;
  readonly clock: HLClock;
  readonly outbox: Outbox;
  readonly transport: SyncTransport;
  readonly onIncoming: (ops: readonly Operation[]) => Promise<void>;
}

export class SyncEngine {
  private running = false;

  constructor(private readonly options: SyncEngineOptions) {}

  async start(): Promise<void> {
    void this.options;
    this.running = true;
    throw new Error("SyncEngine.start: not implemented");
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }
}
