import type { KvStore } from "@ollu/sdk-core";

export class IdbKvStore implements KvStore {
  constructor(private readonly dbName: string) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    void key;
    void this.dbName;
    throw new Error("IdbKvStore.get: not implemented");
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    void key;
    void value;
    throw new Error("IdbKvStore.set: not implemented");
  }

  async delete(key: string): Promise<void> {
    void key;
    throw new Error("IdbKvStore.delete: not implemented");
  }

  async keys(): Promise<readonly string[]> {
    throw new Error("IdbKvStore.keys: not implemented");
  }
}
