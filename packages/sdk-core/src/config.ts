import type { KvStore } from "./kv/index.js";

const SERVER_URL_KEY = "_config.serverUrl";

export interface ServerUrlConfigOptions {
  readonly defaultServerUrl: string;
  readonly kv: KvStore;
}

export class ServerUrlConfig {
  private cached: string | null = null;

  constructor(private readonly options: ServerUrlConfigOptions) {}

  async load(): Promise<void> {
    const override = await this.options.kv.get<string>(SERVER_URL_KEY);
    this.cached = override ?? this.options.defaultServerUrl;
  }

  get(): string {
    return this.cached ?? this.options.defaultServerUrl;
  }

  async set(url: string): Promise<void> {
    this.cached = url;
    await this.options.kv.set(SERVER_URL_KEY, url);
  }

  async reset(): Promise<void> {
    this.cached = this.options.defaultServerUrl;
    await this.options.kv.delete(SERVER_URL_KEY);
  }
}
