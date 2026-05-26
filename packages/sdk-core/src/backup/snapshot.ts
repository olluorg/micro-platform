export interface SnapshotMeta {
  readonly appId: string;
  readonly version: number;
  readonly createdAt: number;
  readonly schemaVersion: number;
}

export interface Snapshot {
  readonly meta: SnapshotMeta;
  readonly stores: Readonly<Record<string, readonly unknown[]>>;
  readonly kv: Readonly<Record<string, unknown>>;
}

export async function createSnapshot(): Promise<Uint8Array> {
  throw new Error("createSnapshot: not implemented");
}

export async function restoreSnapshot(data: Uint8Array): Promise<Snapshot> {
  void data;
  throw new Error("restoreSnapshot: not implemented");
}
