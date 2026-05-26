import type { AuthSession } from "@ollu/shared-types";
import type { AuthProvider } from "./provider.js";

export interface AuthClientOptions {
  readonly serverUrl: () => string;
  readonly providers: readonly AuthProvider[];
}

export class AuthClient {
  constructor(private readonly options: AuthClientOptions) {}

  async loginWith(providerId: string): Promise<AuthSession> {
    void providerId;
    void this.options;
    throw new Error("AuthClient.loginWith: not implemented");
  }

  async refresh(): Promise<AuthSession> {
    throw new Error("AuthClient.refresh: not implemented");
  }

  async logout(): Promise<void> {
    throw new Error("AuthClient.logout: not implemented");
  }

  currentSession(): AuthSession | null {
    return null;
  }
}
