import type { KvStore } from "@ollu/sdk-core";
import { idbReq, idbTx, INTERNAL_STORES } from "./idb-utils.js";

interface KvRow {
  key: string;
  value: unknown;
}

export class IdbKvStore implements KvStore {
  constructor(private readonly getDb: () => Promise<IDBDatabase>) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const db = await this.getDb();
    const tx = db.transaction(INTERNAL_STORES.kv, "readonly");
    const row = (await idbReq(tx.objectStore(INTERNAL_STORES.kv).get(key))) as
      | KvRow
      | undefined;
    return row?.value as T | undefined;
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(INTERNAL_STORES.kv, "readwrite");
    tx.objectStore(INTERNAL_STORES.kv).put({ key, value } satisfies KvRow);
    await idbTx(tx);
  }

  async delete(key: string): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(INTERNAL_STORES.kv, "readwrite");
    tx.objectStore(INTERNAL_STORES.kv).delete(key);
    await idbTx(tx);
  }

  async keys(): Promise<readonly string[]> {
    const db = await this.getDb();
    const tx = db.transaction(INTERNAL_STORES.kv, "readonly");
    const keys = (await idbReq(
      tx.objectStore(INTERNAL_STORES.kv).getAllKeys(),
    )) as IDBValidKey[];
    return keys.map(String);
  }
}
