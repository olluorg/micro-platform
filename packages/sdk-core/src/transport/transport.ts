import type {
  HLCString,
  Operation,
  SyncPullResponse,
} from "@ollu/shared-types";

export interface TransportSubscription {
  close(): void;
}

export interface SyncTransport {
  pullSince(cursor: HLCString | null, limit?: number): Promise<SyncPullResponse>;
  push(ops: readonly Operation[]): Promise<void>;
  subscribeHints(onHint: () => void): TransportSubscription;
}
