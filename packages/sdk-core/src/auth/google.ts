import type { AuthLoginResult, AuthProvider } from "./provider.js";

export interface GoogleAuthProviderOptions {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes?: readonly string[];
}

export class GoogleAuthProvider implements AuthProvider {
  readonly id = "google";

  constructor(private readonly options: GoogleAuthProviderOptions) {}

  async startLogin(): Promise<AuthLoginResult> {
    void this.options;
    throw new Error("GoogleAuthProvider.startLogin: not implemented");
  }
}
