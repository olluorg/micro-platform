import { decode, encode } from "cbor-x";

export const SNAPSHOT_FORMAT_VERSION = 1;

export interface SnapshotRecord {
  readonly pk: string;
  readonly value: unknown;
  readonly hlc: string;
}

export interface SnapshotStore {
  readonly records: SnapshotRecord[];
}

export interface SnapshotMeta {
  readonly appId: string;
  readonly createdAt: number;
  readonly schemaVersion?: number;
}

export interface Snapshot {
  readonly format: typeof SNAPSHOT_FORMAT_VERSION;
  readonly meta: SnapshotMeta;
  readonly stores: Record<string, SnapshotStore>;
  readonly kv: Record<string, unknown>;
}

export function encodeSnapshot(snapshot: Snapshot): Uint8Array {
  return encode(snapshot) as Uint8Array;
}

export function decodeSnapshot(data: Uint8Array): Snapshot {
  const decoded = decode(data) as unknown;
  if (
    !decoded ||
    typeof decoded !== "object" ||
    (decoded as { format?: unknown }).format !== SNAPSHOT_FORMAT_VERSION
  ) {
    throw new Error(
      `unsupported snapshot format (expected ${SNAPSHOT_FORMAT_VERSION})`,
    );
  }
  return decoded as Snapshot;
}

export function defaultSnapshotName(appId: string, at: number = Date.now()): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `${appId}-${stamp}.cbor`;
}
