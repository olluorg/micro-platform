export interface BackupInfo {
  readonly name: string;
  readonly size: number;
  readonly createdAt: number;
}

export interface BackupTarget {
  readonly id: string;
  put(name: string, data: Uint8Array): Promise<void>;
  get(name: string): Promise<Uint8Array>;
  list(): Promise<readonly BackupInfo[]>;
  delete(name: string): Promise<void>;
}
