import type { AuthLoginResult, AuthProvider } from "./provider.js";

export interface GoogleAuthProviderOptions {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes?: readonly string[];
  /** Open the OAuth flow in a popup (default) or full redirect. */
  readonly mode?: "popup" | "redirect";
}

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DEFAULT_SCOPES = ["openid", "email", "profile"];

export class GoogleAuthProvider implements AuthProvider {
  readonly id = "google";

  constructor(private readonly options: GoogleAuthProviderOptions) {}

  async startLogin(): Promise<AuthLoginResult> {
    const verifier = generateRandomString(64);
    const challenge = await sha256Base64Url(verifier);
    const state = generateRandomString(24);
    const scopes = (this.options.scopes ?? DEFAULT_SCOPES).join(" ");

    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", generateRandomString(24));

    const code = await this.runFlow(url.toString(), state);
    const idToken = await this.exchangeCode(code, verifier);
    return { provider: this.id, idToken };
  }

  private async runFlow(authUrl: string, expectedState: string): Promise<string> {
    const mode = this.options.mode ?? "popup";
    if (mode === "redirect") {
      sessionStorage.setItem("ollu.oauth.state", expectedState);
      sessionStorage.setItem("ollu.oauth.provider", this.id);
      window.location.assign(authUrl);
      return new Promise(() => undefined);
    }
    return await runPopupFlow(authUrl, expectedState, this.options.redirectUri);
  }

  private async exchangeCode(code: string, verifier: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.options.clientId,
      code,
      code_verifier: verifier,
      redirect_uri: this.options.redirectUri,
    });
    const resp = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!resp.ok) {
      throw new Error(`token exchange failed: ${resp.status} ${await resp.text()}`);
    }
    const data = (await resp.json()) as { id_token?: string };
    if (!data.id_token) throw new Error("id_token missing in token response");
    return data.id_token;
  }
}

async function runPopupFlow(
  authUrl: string,
  expectedState: string,
  redirectUri: string,
): Promise<string> {
  const popup = window.open(authUrl, "ollu-oauth", "width=480,height=640");
  if (!popup) throw new Error("popup blocked");
  return await new Promise<string>((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(timer);
          reject(new Error("popup closed by user"));
          return;
        }
        const href = popup.location.href;
        if (!href.startsWith(redirectUri)) return;
        const url = new URL(href);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        clearInterval(timer);
        popup.close();
        if (error) {
          reject(new Error(`oauth error: ${error}`));
          return;
        }
        if (state !== expectedState) {
          reject(new Error("oauth state mismatch"));
          return;
        }
        if (!code) {
          reject(new Error("oauth code missing"));
          return;
        }
        resolve(code);
      } catch {
        // cross-origin while popup is on accounts.google.com
      }
    }, 250);
  });
}

function generateRandomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes).slice(0, length);
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
