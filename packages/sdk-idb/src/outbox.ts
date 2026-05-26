import type { Operation } from "@ollu/shared-types";
import type { Outbox, OutboxEntry } from "@ollu/sdk-core";
import { idbReq, idbTx, INTERNAL_STORES } from "./idb-utils.js";

interface StoredEntry {
  id: string;
  op: Operation;
  enqueuedAt: number;
}

export class IdbOutbox implements Outbox {
  constructor(private readonly getDb: () => Promise<IDBDatabase>) {}

  async enqueue(op: Operation): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(INTERNAL_STORES.outbox, "readwrite");
    const store = tx.objectStore(INTERNAL_STORES.outbox);
    store.put({ id: op.id, op, enqueuedAt: Date.now() } satisfies StoredEntry);
    await idbTx(tx);
  }

  async peek(limit: number): Promise<readonly OutboxEntry[]> {
    const db = await this.getDb();
    const tx = db.transaction(INTERNAL_STORES.outbox, "readonly");
    const store = tx.objectStore(INTERNAL_STORES.outbox);
    const rows = (await idbReq(store.getAll(null, limit))) as StoredEntry[];
    return rows.map((r) => ({ op: r.op, enqueuedAt: r.enqueuedAt }));
  }

  async ack(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await this.getDb();
    const tx = db.transaction(INTERNAL_STORES.outbox, "readwrite");
    const store = tx.objectStore(INTERNAL_STORES.outbox);
    for (const id of ids) store.delete(id);
    await idbTx(tx);
  }

  async size(): Promise<number> {
    const db = await this.getDb();
    const tx = db.transaction(INTERNAL_STORES.outbox, "readonly");
    return await idbReq(tx.objectStore(INTERNAL_STORES.outbox).count());
  }
}
