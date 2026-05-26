import type { AuthSession } from "@ollu/shared-types";
import type { KvStore } from "../kv/index.js";
import type { AuthProvider } from "./provider.js";

const SESSION_KEY = "_auth.session";

export interface AuthClientOptions {
  readonly serverUrl: () => string;
  readonly providers: readonly AuthProvider[];
  readonly kv: KvStore;
}

export class AuthClient {
  private session: AuthSession | null = null;
  private listeners = new Set<(session: AuthSession | null) => void>();
  private loaded = false;

  constructor(private readonly options: AuthClientOptions) {}

  async hydrate(): Promise<void> {
    if (this.loaded) return;
    this.session = (await this.options.kv.get<AuthSession>(SESSION_KEY)) ?? null;
    this.loaded = true;
  }

  currentSession(): AuthSession | null {
    return this.session;
  }

  onChange(fn: (session: AuthSession | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async loginWith(providerId: string): Promise<AuthSession> {
    const provider = this.options.providers.find((p) => p.id === providerId);
    if (!provider) throw new Error(`unknown auth provider: ${providerId}`);
    const result = await provider.startLogin();
    const resp = await fetch(`${this.base()}/auth/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: result.provider, idToken: result.idToken }),
    });
    if (!resp.ok) {
      throw new Error(`create session failed: ${resp.status} ${await resp.text()}`);
    }
    const session = (await resp.json()) as AuthSession;
    await this.setSession(session);
    return session;
  }

  async refresh(): Promise<AuthSession> {
    if (!this.session) throw new Error("no session to refresh");
    const resp = await fetch(`${this.base()}/auth/sessions/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: this.session.refreshToken }),
    });
    if (!resp.ok) {
      await this.setSession(null);
      throw new Error(`refresh failed: ${resp.status} ${await resp.text()}`);
    }
    const session = (await resp.json()) as AuthSession;
    await this.setSession(session);
    return session;
  }

  async logout(): Promise<void> {
    if (!this.session) return;
    await fetch(`${this.base()}/auth/sessions/current`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.session.sessionToken}` },
    }).catch(() => undefined);
    await this.setSession(null);
  }

  async ensureFresh(): Promise<AuthSession | null> {
    if (!this.session) return null;
    const skew = 60_000;
    if (this.session.expiresAt - skew > Date.now()) return this.session;
    try {
      return await this.refresh();
    } catch {
      return null;
    }
  }

  sessionToken(): string | null {
    return this.session?.sessionToken ?? null;
  }

  private async setSession(session: AuthSession | null): Promise<void> {
    this.session = session;
    if (session) {
      await this.options.kv.set(SESSION_KEY, session);
    } else {
      await this.options.kv.delete(SESSION_KEY);
    }
    for (const fn of this.listeners) fn(session);
  }

  private base(): string {
    return this.options.serverUrl().replace(/\/+$/, "");
  }
}
