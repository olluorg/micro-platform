import type { BackupInfo, BackupTarget } from "@ollu/sdk-core";

export interface GoogleDriveTargetOptions {
  readonly accessToken: () => Promise<string>;
  readonly folderName?: string;
}

export class GoogleDriveTarget implements BackupTarget {
  readonly id = "google-drive";

  constructor(private readonly options: GoogleDriveTargetOptions) {}

  async put(name: string, data: Uint8Array): Promise<void> {
    void name;
    void data;
    void this.options;
    throw new Error("GoogleDriveTarget.put: not implemented");
  }

  async get(name: string): Promise<Uint8Array> {
    void name;
    throw new Error("GoogleDriveTarget.get: not implemented");
  }

  async list(): Promise<readonly BackupInfo[]> {
    throw new Error("GoogleDriveTarget.list: not implemented");
  }

  async delete(name: string): Promise<void> {
    void name;
    throw new Error("GoogleDriveTarget.delete: not implemented");
  }
}
