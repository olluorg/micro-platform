export interface SdkConfig {
  readonly appId: string;
  readonly defaultServerUrl: string;
}

export interface ResolvedServerUrl {
  readonly url: string;
  readonly source: "user" | "default";
}
