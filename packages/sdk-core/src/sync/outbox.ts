import type { Operation } from "@ollu/shared-types";

export interface OutboxEntry {
  readonly op: Operation;
  readonly enqueuedAt: number;
}

export interface Outbox {
  enqueue(op: Operation): Promise<void>;
  peek(limit: number): Promise<readonly OutboxEntry[]>;
  ack(ids: readonly string[]): Promise<void>;
  size(): Promise<number>;
}
