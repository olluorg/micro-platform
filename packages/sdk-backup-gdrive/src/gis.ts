/** Loader for Google Identity Services. Lazily injects the GIS <script> tag. */

const GIS_SRC = "https://accounts.google.com/gsi/client";

interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GisTokenResponse {
  access_token?: string;
  expires_in?: string | number;
  error?: string;
  error_description?: string;
}

interface GisOauth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    prompt?: string;
    callback: (resp: GisTokenResponse) => void;
    error_callback?: (err: { type: string; message?: string }) => void;
  }): GisTokenClient;
}

interface GoogleGlobal {
  accounts: { oauth2: GisOauth2 };
}

let loadPromise: Promise<GoogleGlobal> | null = null;

export function loadGis(): Promise<GoogleGlobal> {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<GoogleGlobal>((resolve, reject) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      reject(new Error("GIS requires a browser environment"));
      return;
    }
    const existing = (window as { google?: GoogleGlobal }).google;
    if (existing?.accounts?.oauth2) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const g = (window as { google?: GoogleGlobal }).google;
      if (!g?.accounts?.oauth2) {
        reject(new Error("GIS loaded but google.accounts.oauth2 missing"));
        return;
      }
      resolve(g);
    };
    script.onerror = () => reject(new Error(`failed to load ${GIS_SRC}`));
    document.head.appendChild(script);
  });
  return loadPromise;
}

export interface AccessToken {
  readonly token: string;
  readonly expiresAt: number;
}

export interface RequestAccessTokenOptions {
  readonly clientId: string;
  readonly scope: string;
  /** "" for silent (default), "consent" to force the consent screen. */
  readonly prompt?: string;
}

export async function requestAccessToken(
  options: RequestAccessTokenOptions,
): Promise<AccessToken> {
  const gis = await loadGis();
  return await new Promise<AccessToken>((resolve, reject) => {
    const client = gis.accounts.oauth2.initTokenClient({
      client_id: options.clientId,
      scope: options.scope,
      callback: (resp) => {
        if (resp.error) {
          reject(
            new Error(`GIS error: ${resp.error}${resp.error_description ? ` (${resp.error_description})` : ""}`),
          );
          return;
        }
        if (!resp.access_token) {
          reject(new Error("GIS callback missing access_token"));
          return;
        }
        const expiresIn =
          typeof resp.expires_in === "string"
            ? parseInt(resp.expires_in, 10)
            : (resp.expires_in ?? 3600);
        resolve({
          token: resp.access_token,
          expiresAt: Date.now() + expiresIn * 1000,
        });
      },
      error_callback: (err) => {
        reject(new Error(`GIS error: ${err.type}${err.message ? ` (${err.message})` : ""}`));
      },
    });
    client.requestAccessToken({ prompt: options.prompt ?? "" });
  });
}
