import type { HLClock } from "@ollu/sdk-core";
import type { Operation } from "@ollu/shared-types";

export interface IdbProxyOptions {
  /** Database name the SDK will intercept. Other databases pass through untouched. */
  readonly dbName: string;
  readonly appId: string;
  readonly syncedStores: readonly string[];
  readonly clock: HLClock;
  /** Called after a local write enqueues an op. */
  readonly onLocalWrite?: () => void;
}

export interface IdbProxy {
  readonly outbox: import("@ollu/sdk-core").Outbox;
  readonly kv: import("@ollu/sdk-core").KvStore;
  /** Apply ops received from sync. Does not re-enqueue them in the outbox. */
  applyIncoming(ops: readonly Operation[]): Promise<void>;
  /**
   * Run a callback with outbox capture suppressed. Use for local-only writes
   * that must not propagate to other devices (e.g. history trim, GC).
   */
  withSuppressedCapture<T>(fn: () => Promise<T>): Promise<T>;
  /** Serialize the current local state (synced stores + KV) into a CBOR snapshot. */
  createSnapshot(): Promise<Uint8Array>;
  /** Apply a CBOR snapshot via LWW merge (does not generate outbox ops). */
  restoreSnapshot(data: Uint8Array): Promise<void>;
  /** Wait until the app has opened the patched IndexedDB database. */
  ready(): Promise<void>;
  uninstall(): void;
}
