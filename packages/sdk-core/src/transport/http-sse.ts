import type {
  HLCString,
  Operation,
  SyncPullResponse,
} from "@ollu/shared-types";
import type { SyncTransport, TransportSubscription } from "./transport.js";

export interface HttpSseTransportOptions {
  readonly serverUrl: () => string;
  readonly appId: string;
  readonly sessionToken: () => string | null;
}

export class HttpSseTransport implements SyncTransport {
  constructor(private readonly options: HttpSseTransportOptions) {}

  async pullSince(
    cursor: HLCString | null,
    limit?: number,
  ): Promise<SyncPullResponse> {
    void cursor;
    void limit;
    void this.options;
    throw new Error("HttpSseTransport.pullSince: not implemented");
  }

  async push(ops: readonly Operation[]): Promise<void> {
    void ops;
    throw new Error("HttpSseTransport.push: not implemented");
  }

  subscribeHints(onHint: () => void): TransportSubscription {
    void onHint;
    throw new Error("HttpSseTransport.subscribeHints: not implemented");
  }
}
