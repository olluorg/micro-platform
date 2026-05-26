const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export interface DriveFile {
  id: string;
  name: string;
  size?: string;
  createdTime?: string;
  mimeType?: string;
}

interface DriveListResponse {
  files?: DriveFile[];
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function expectOk(resp: Response, label: string): Promise<void> {
  if (resp.ok) return;
  const text = await resp.text().catch(() => "");
  throw new Error(`${label} failed: ${resp.status} ${text}`);
}

export async function findFolderByName(
  token: string,
  name: string,
): Promise<string | null> {
  const q = `name='${escapeQuoted(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const url = new URL(DRIVE_FILES);
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("spaces", "drive");
  const resp = await fetch(url.toString(), { headers: authHeader(token) });
  await expectOk(resp, "drive list folders");
  const data = (await resp.json()) as DriveListResponse;
  return data.files?.[0]?.id ?? null;
}

export async function createFolder(token: string, name: string): Promise<string> {
  const resp = await fetch(DRIVE_FILES, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  await expectOk(resp, "drive create folder");
  const data = (await resp.json()) as DriveFile;
  return data.id;
}

export async function listFilesInFolder(
  token: string,
  folderId: string,
): Promise<DriveFile[]> {
  const q = `'${folderId}' in parents and trashed=false`;
  const url = new URL(DRIVE_FILES);
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name,size,createdTime)");
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("orderBy", "createdTime desc");
  const resp = await fetch(url.toString(), { headers: authHeader(token) });
  await expectOk(resp, "drive list files");
  const data = (await resp.json()) as DriveListResponse;
  return data.files ?? [];
}

export async function findFileByName(
  token: string,
  folderId: string,
  name: string,
): Promise<DriveFile | null> {
  const q = `'${folderId}' in parents and name='${escapeQuoted(name)}' and trashed=false`;
  const url = new URL(DRIVE_FILES);
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name,size,createdTime)");
  const resp = await fetch(url.toString(), { headers: authHeader(token) });
  await expectOk(resp, "drive find file");
  const data = (await resp.json()) as DriveListResponse;
  return data.files?.[0] ?? null;
}

export async function uploadFile(
  token: string,
  folderId: string,
  name: string,
  data: Uint8Array,
  contentType: string = "application/cbor",
): Promise<DriveFile> {
  const boundary = `----ollu${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name, parents: [folderId] });
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + data.length + tail.length);
  body.set(head, 0);
  body.set(data, head.length);
  body.set(tail, head.length + data.length);

  const url = new URL(DRIVE_UPLOAD);
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,name,size,createdTime");
  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: {
      ...authHeader(token),
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  await expectOk(resp, "drive upload");
  return (await resp.json()) as DriveFile;
}

export async function downloadFile(token: string, fileId: string): Promise<Uint8Array> {
  const url = new URL(`${DRIVE_FILES}/${encodeURIComponent(fileId)}`);
  url.searchParams.set("alt", "media");
  const resp = await fetch(url.toString(), { headers: authHeader(token) });
  await expectOk(resp, "drive download");
  return new Uint8Array(await resp.arrayBuffer());
}

export async function deleteFile(token: string, fileId: string): Promise<void> {
  const resp = await fetch(`${DRIVE_FILES}/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: authHeader(token),
  });
  if (resp.status === 204) return;
  await expectOk(resp, "drive delete");
}

function escapeQuoted(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
