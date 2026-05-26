import type { Operation } from "@ollu/shared-types";

export interface SyncedStoreConfig {
  readonly name: string;
  readonly sync: boolean;
}

export interface IdbProxyOptions {
  readonly appId: string;
  readonly stores: readonly SyncedStoreConfig[];
  readonly onChange: (op: Operation) => void | Promise<void>;
}
