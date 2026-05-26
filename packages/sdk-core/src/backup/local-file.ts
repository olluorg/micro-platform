import type { BackupInfo, BackupTarget } from "./target.js";

export class LocalFileTarget implements BackupTarget {
  readonly id = "local-file";

  async put(name: string, data: Uint8Array): Promise<void> {
    void name;
    void data;
    throw new Error("LocalFileTarget.put: not implemented");
  }

  async get(name: string): Promise<Uint8Array> {
    void name;
    throw new Error("LocalFileTarget.get: not implemented");
  }

  async list(): Promise<readonly BackupInfo[]> {
    throw new Error("LocalFileTarget.list: not implemented");
  }

  async delete(name: string): Promise<void> {
    void name;
    throw new Error("LocalFileTarget.delete: not implemented");
  }
}
