import type { BackupInfo, BackupTarget } from "./target.js";

/**
 * Backup target backed by the user's local filesystem.
 *
 * `put(name, data)` triggers a browser download with the given filename.
 * `get(name)` opens a file picker — the `name` argument is informational
 * (used as `accept` filter / dialog title) and the user can pick any file.
 *
 * `list()` and `delete()` are unsupported (browsers can't enumerate or
 * delete arbitrary user files).
 */
export class LocalFileTarget implements BackupTarget {
  readonly id = "local-file";

  async put(name: string, data: Uint8Array): Promise<void> {
    if (typeof document === "undefined") {
      throw new Error("LocalFileTarget requires a DOM environment");
    }
    const blob = new Blob([data as BlobPart], { type: "application/cbor" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async get(_name: string): Promise<Uint8Array> {
    if (typeof document === "undefined") {
      throw new Error("LocalFileTarget requires a DOM environment");
    }
    return await new Promise<Uint8Array>((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".cbor,application/cbor,application/octet-stream";
      input.style.display = "none";
      input.addEventListener(
        "change",
        async () => {
          const file = input.files?.[0];
          document.body.removeChild(input);
          if (!file) {
            reject(new Error("no file selected"));
            return;
          }
          try {
            const buf = await file.arrayBuffer();
            resolve(new Uint8Array(buf));
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        },
        { once: true },
      );
      input.addEventListener(
        "cancel",
        () => {
          document.body.removeChild(input);
          reject(new Error("file picker cancelled"));
        },
        { once: true },
      );
      document.body.appendChild(input);
      input.click();
    });
  }

  async list(): Promise<readonly BackupInfo[]> {
    return [];
  }

  async delete(_name: string): Promise<void> {
    throw new Error("LocalFileTarget does not support delete");
  }
}
