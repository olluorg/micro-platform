import type { BackupInfo, BackupTarget } from "@ollu/sdk-core";
import {
  createFolder,
  deleteFile,
  downloadFile,
  findFileByName,
  findFolderByName,
  listFilesInFolder,
  uploadFile,
} from "./drive-api.js";
import { requestAccessToken, type AccessToken } from "./gis.js";

const DEFAULT_FOLDER = "Ollu Backups";
const DEFAULT_SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_REFRESH_SKEW_MS = 60_000;

export interface GoogleDriveTargetOptions {
  readonly clientId: string;
  readonly folderName?: string;
  readonly scope?: string;
}

export class GoogleDriveTarget implements BackupTarget {
  readonly id = "google-drive";
  private token: AccessToken | null = null;
  private folderId: string | null = null;
  private folderName: string;
  private scope: string;

  constructor(private readonly options: GoogleDriveTargetOptions) {
    this.folderName = options.folderName ?? DEFAULT_FOLDER;
    this.scope = options.scope ?? DEFAULT_SCOPE;
  }

  async put(name: string, data: Uint8Array): Promise<void> {
    const token = await this.ensureToken();
    const folderId = await this.ensureFolder(token);
    const existing = await findFileByName(token, folderId, name);
    if (existing) {
      await deleteFile(token, existing.id);
    }
    await uploadFile(token, folderId, name, data);
  }

  async get(name: string): Promise<Uint8Array> {
    const token = await this.ensureToken();
    const folderId = await this.ensureFolder(token);
    const file = await findFileByName(token, folderId, name);
    if (!file) throw new Error(`backup not found in Google Drive: ${name}`);
    return await downloadFile(token, file.id);
  }

  async list(): Promise<readonly BackupInfo[]> {
    const token = await this.ensureToken();
    const folderId = await this.ensureFolder(token);
    const files = await listFilesInFolder(token, folderId);
    return files.map((f) => ({
      name: f.name,
      size: f.size ? parseInt(f.size, 10) : 0,
      createdAt: f.createdTime ? new Date(f.createdTime).getTime() : 0,
    }));
  }

  async delete(name: string): Promise<void> {
    const token = await this.ensureToken();
    const folderId = await this.ensureFolder(token);
    const file = await findFileByName(token, folderId, name);
    if (!file) return;
    await deleteFile(token, file.id);
  }

  /** Manually request the access token (e.g. on a user-initiated button click). */
  async connect(prompt?: "consent"): Promise<void> {
    await this.requestToken(prompt);
  }

  private async ensureToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_REFRESH_SKEW_MS > Date.now()) {
      return this.token.token;
    }
    return await this.requestToken();
  }

  private async requestToken(prompt?: "consent"): Promise<string> {
    this.token = await requestAccessToken({
      clientId: this.options.clientId,
      scope: this.scope,
      ...(prompt ? { prompt } : {}),
    });
    return this.token.token;
  }

  private async ensureFolder(token: string): Promise<string> {
    if (this.folderId) return this.folderId;
    const existing = await findFolderByName(token, this.folderName);
    if (existing) {
      this.folderId = existing;
      return existing;
    }
    this.folderId = await createFolder(token, this.folderName);
    return this.folderId;
  }
}
