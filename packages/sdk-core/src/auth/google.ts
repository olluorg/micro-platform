import type { AuthLoginResult, AuthProvider } from "./provider.js";

export interface GoogleAuthProviderOptions {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes?: readonly string[];
  /** Open the OAuth flow in a popup (default) or full redirect. */
  readonly mode?: "popup" | "redirect";
}

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_SCOPES = ["openid", "email", "profile"];

/**
 * Google OIDC implicit flow.
 *
 * We use `response_type=id_token` so the browser receives the id_token
 * directly in the redirect URL fragment — no separate token exchange
 * step, no client_secret required. Google's "Web application" OAuth
 * client type rejects PKCE+code without a secret, but it does accept
 * pure id_token responses (this is plain OpenID Connect).
 *
 * The id_token is signed by Google and validated server-side via JWKS;
 * `nonce` ties the token to this specific login attempt so replays
 * across sessions don't pass validation.
 */
export class GoogleAuthProvider implements AuthProvider {
  readonly id = "google";

  constructor(private readonly options: GoogleAuthProviderOptions) {}

  async startLogin(): Promise<AuthLoginResult> {
    const state = generateRandomString(24);
    const nonce = generateRandomString(24);
    const scopes = (this.options.scopes ?? DEFAULT_SCOPES).join(" ");

    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    url.searchParams.set("response_type", "id_token");
    url.searchParams.set("scope", scopes);
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);

    const idToken = await this.runFlow(url.toString(), state);
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
        // id_token responses land in the URL fragment, not the query.
        const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
        const params = new URLSearchParams(fragment);
        const idToken = params.get("id_token");
        const state = params.get("state");
        const error = params.get("error");
        clearInterval(timer);
        popup.close();
        if (error) {
          const desc = params.get("error_description");
          reject(new Error(`oauth error: ${error}${desc ? ` (${desc})` : ""}`));
          return;
        }
        if (state !== expectedState) {
          reject(new Error("oauth state mismatch"));
          return;
        }
        if (!idToken) {
          reject(new Error("oauth callback missing id_token"));
          return;
        }
        resolve(idToken);
      } catch {
        // cross-origin access errors while the popup is on accounts.google.com
      }
    }, 250);
  });
}

function generateRandomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes).slice(0, length);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
