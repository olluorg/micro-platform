export type AppId = string;
export type UserId = string;
export type DeviceId = string;
export type OpId = string;

export interface HLC {
  readonly physical: number;
  readonly logical: number;
  readonly nodeId: string;
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

export type SyncCursor = number;

export interface SyncPullResponse {
  readonly ops: readonly Operation[];
  readonly nextCursor: SyncCursor | null;
  readonly hasMore: boolean;
}

export interface SyncPushResponse {
  readonly accepted: number;
}

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
