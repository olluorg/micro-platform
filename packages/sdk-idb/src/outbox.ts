import type { Operation } from "@ollu/shared-types";
import type { Outbox, OutboxEntry } from "@ollu/sdk-core";

export class IdbOutbox implements Outbox {
  constructor(private readonly dbName: string) {}

  async enqueue(op: Operation): Promise<void> {
    void op;
    void this.dbName;
    throw new Error("IdbOutbox.enqueue: not implemented");
  }

  async peek(limit: number): Promise<readonly OutboxEntry[]> {
    void limit;
    throw new Error("IdbOutbox.peek: not implemented");
  }

  async ack(ids: readonly string[]): Promise<void> {
    void ids;
    throw new Error("IdbOutbox.ack: not implemented");
  }

  async size(): Promise<number> {
    throw new Error("IdbOutbox.size: not implemented");
  }
}
