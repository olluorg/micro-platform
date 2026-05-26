export type AppId = string;
export type UserId = string;
export type DeviceId = string;
export type OpId = string;

export interface HLC {
  readonly physical: number;
  readonly logical: number;
  readonly nodeId: DeviceId;
}

export type HLCString = string;

export type OpType = "put" | "delete";

export interface Operation {
  readonly id: OpId;
  readonly appId: AppId;
  readonly store: string;
  readonly pk: string;
  readonly type: OpType;
  readonly hlc: HLCString;
  readonly payload?: unknown;
}

export interface SyncPullRequest {
  readonly appId: AppId;
  readonly cursor: HLCString | null;
  readonly limit?: number;
}

export interface SyncPullResponse {
  readonly ops: readonly Operation[];
  readonly nextCursor: HLCString | null;
  readonly hasMore: boolean;
}

export interface SyncPushRequest {
  readonly appId: AppId;
  readonly ops: readonly Operation[];
}

export interface SyncPushResponse {
  readonly accepted: number;
}

export type SseEvent =
  | { readonly kind: "hint"; readonly appId: AppId }
  | { readonly kind: "ping" };

export interface AuthCreateSessionRequest {
  readonly provider: string;
  readonly idToken: string;
}

export interface AuthSession {
  readonly sessionToken: string;
  readonly refreshToken: string;
  readonly user: { readonly id: UserId; readonly email: string };
  readonly expiresAt: number;
}
