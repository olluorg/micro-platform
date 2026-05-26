export interface AuthLoginResult {
  readonly provider: string;
  readonly idToken: string;
}

export interface AuthProvider {
  readonly id: string;
  startLogin(): Promise<AuthLoginResult>;
}
