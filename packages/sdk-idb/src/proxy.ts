import type { Operation, OpType } from "@ollu/shared-types";
import { hlcToString } from "@ollu/sdk-core";
import { idbReq, idbTx, INTERNAL_STORES } from "./idb-utils.js";
import { IdbKvStore } from "./kv.js";
import { IdbOutbox } from "./outbox.js";
import type { IdbProxy, IdbProxyOptions } from "./types.js";

interface ProxyState {
  options: IdbProxyOptions;
  dbReady: Promise<IDBDatabase>;
  resolveDbReady: (db: IDBDatabase) => void;
  db: IDBDatabase | null;
  originalOpen: typeof IDBFactory.prototype.open;
  originalTransaction: typeof IDBDatabase.prototype.transaction;
  originalPut: typeof IDBObjectStore.prototype.put;
  originalAdd: typeof IDBObjectStore.prototype.add;
  originalDelete: typeof IDBObjectStore.prototype.delete;
}

let state: ProxyState | null = null;
let suppressCapture = false;

export function installIdbProxy(options: IdbProxyOptions): IdbProxy {
  if (state) throw new Error("IDB proxy already installed");

  let resolveDbReady!: (db: IDBDatabase) => void;
  const dbReady = new Promise<IDBDatabase>((r) => {
    resolveDbReady = r;
  });

  state = {
    options,
    dbReady,
    resolveDbReady,
    db: null,
    originalOpen: IDBFactory.prototype.open,
    originalTransaction: IDBDatabase.prototype.transaction,
    originalPut: IDBObjectStore.prototype.put,
    originalAdd: IDBObjectStore.prototype.add,
    originalDelete: IDBObjectStore.prototype.delete,
  };

  patchOpen();
  patchTransaction();
  patchStoreWrites();

  const getDb = () => dbReady;

  return {
    outbox: new IdbOutbox(getDb),
    kv: new IdbKvStore(getDb),
    applyIncoming,
    ready: () => dbReady.then(() => undefined),
    uninstall,
  };
}

function uninstall(): void {
  if (!state) return;
  IDBFactory.prototype.open = state.originalOpen;
  IDBDatabase.prototype.transaction = state.originalTransaction;
  IDBObjectStore.prototype.put = state.originalPut;
  IDBObjectStore.prototype.add = state.originalAdd;
  IDBObjectStore.prototype.delete = state.originalDelete;
  state = null;
}

function patchOpen(): void {
  const s = state!;
  IDBFactory.prototype.open = function (
    this: IDBFactory,
    name: string,
    version?: number,
  ): IDBOpenDBRequest {
    const req = (s.originalOpen as typeof IDBFactory.prototype.open).call(
      this,
      name,
      version,
    );
    if (name === s.options.dbName) hookOpenRequest(req);
    return req;
  };
}

function hookOpenRequest(req: IDBOpenDBRequest): void {
  req.addEventListener("upgradeneeded", () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(INTERNAL_STORES.outbox)) {
      db.createObjectStore(INTERNAL_STORES.outbox, { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains(INTERNAL_STORES.kv)) {
      db.createObjectStore(INTERNAL_STORES.kv, { keyPath: "key" });
    }
    if (!db.objectStoreNames.contains(INTERNAL_STORES.meta)) {
      db.createObjectStore(INTERNAL_STORES.meta, { keyPath: "key" });
    }
  });
  req.addEventListener("success", () => {
    if (!state) return;
    state.db = req.result;
    state.resolveDbReady(req.result);
  });
}

function patchTransaction(): void {
  const s = state!;
  IDBDatabase.prototype.transaction = function (
    this: IDBDatabase,
    storeNames: string | Iterable<string>,
    mode?: IDBTransactionMode,
    options?: IDBTransactionOptions,
  ): IDBTransaction {
    const isTargetDb = this.name === s.options.dbName;
    if (!isTargetDb || suppressCapture) {
      return s.originalTransaction.call(
        this,
        storeNames as never,
        mode as IDBTransactionMode,
        options,
      );
    }
    const names = normalizeStoreNames(storeNames);
    if (
      mode === "readwrite" &&
      names.some((n) => s.options.syncedStores.includes(n))
    ) {
      for (const extra of [INTERNAL_STORES.outbox, INTERNAL_STORES.meta]) {
        if (!names.includes(extra) && this.objectStoreNames.contains(extra)) {
          names.push(extra);
        }
      }
    }
    return s.originalTransaction.call(
      this,
      names as never,
      mode as IDBTransactionMode,
      options,
    );
  };
}

function normalizeStoreNames(
  input: string | Iterable<string> | DOMStringList,
): string[] {
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) return input.slice();
  if (typeof DOMStringList !== "undefined" && input instanceof DOMStringList) {
    const arr: string[] = [];
    for (let i = 0; i < input.length; i++) {
      const v = input.item(i);
      if (v !== null) arr.push(v);
    }
    return arr;
  }
  return Array.from(input as Iterable<string>);
}

function patchStoreWrites(): void {
  const s = state!;
  IDBObjectStore.prototype.put = function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ): IDBRequest<IDBValidKey> {
    const req = s.originalPut.call(this, value, key);
    captureWrite(this, value, key, req, "put");
    return req;
  };
  IDBObjectStore.prototype.add = function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ): IDBRequest<IDBValidKey> {
    const req = s.originalAdd.call(this, value, key);
    captureWrite(this, value, key, req, "put");
    return req;
  };
  IDBObjectStore.prototype.delete = function (
    this: IDBObjectStore,
    keyRange: IDBValidKey | IDBKeyRange,
  ): IDBRequest<undefined> {
    const req = s.originalDelete.call(this, keyRange);
    captureDelete(this, keyRange, req);
    return req;
  };
}

function captureWrite(
  store: IDBObjectStore,
  value: unknown,
  explicitKey: IDBValidKey | undefined,
  req: IDBRequest,
  type: OpType,
): void {
  if (suppressCapture || !state) return;
  if (store.transaction.db.name !== state.options.dbName) return;
  if (!state.options.syncedStores.includes(store.name)) return;

  req.addEventListener("success", () => {
    const pk = keyToString(
      deriveKey(store, value, explicitKey, req.result as IDBValidKey),
    );
    enqueueOpInTx(store.transaction, store.name, pk, type, value);
  });
}

function captureDelete(
  store: IDBObjectStore,
  keyOrRange: IDBValidKey | IDBKeyRange,
  req: IDBRequest,
): void {
  if (suppressCapture || !state) return;
  if (store.transaction.db.name !== state.options.dbName) return;
  if (!state.options.syncedStores.includes(store.name)) return;

  if (typeof IDBKeyRange !== "undefined" && keyOrRange instanceof IDBKeyRange) {
    console.warn(
      "[ollu] delete by IDBKeyRange is not captured; use delete(key) instead",
    );
    return;
  }
  const pk = keyToString(keyOrRange as IDBValidKey);
  req.addEventListener("success", () => {
    enqueueOpInTx(store.transaction, store.name, pk, "delete", undefined);
  });
}

function deriveKey(
  store: IDBObjectStore,
  value: unknown,
  explicitKey: IDBValidKey | undefined,
  resultKey: IDBValidKey,
): IDBValidKey {
  if (explicitKey !== undefined) return explicitKey;
  const keyPath = store.keyPath;
  if (typeof keyPath === "string") {
    return (value as Record<string, IDBValidKey>)?.[keyPath] ?? resultKey;
  }
  if (Array.isArray(keyPath)) {
    return keyPath.map((p) => (value as Record<string, unknown>)?.[p] ?? "") as unknown as IDBValidKey;
  }
  return resultKey;
}

function keyToString(key: IDBValidKey): string {
  if (Array.isArray(key)) return key.map(String).join("");
  return String(key);
}

function enqueueOpInTx(
  tx: IDBTransaction,
  storeName: string,
  pk: string,
  type: OpType,
  value: unknown,
): void {
  if (!state) return;
  if (!tx.objectStoreNames.contains(INTERNAL_STORES.outbox)) {
    console.warn(
      "[ollu] write to synced store outside expanded scope; outbox not updated",
    );
    return;
  }
  const hlc = hlcToString(state.options.clock.now());
  const op: Operation = {
    id: generateOpId(),
    appId: state.options.appId,
    store: storeName,
    pk,
    type,
    hlc,
    ...(type === "put" ? { payload: value } : {}),
  };
  const outbox = tx.objectStore(INTERNAL_STORES.outbox);
  outbox.put({ id: op.id, op, enqueuedAt: Date.now() });
  if (tx.objectStoreNames.contains(INTERNAL_STORES.meta)) {
    const meta = tx.objectStore(INTERNAL_STORES.meta);
    meta.put({ key: `${storeName}:${pk}`, hlc, type });
  }
  if (state.options.onLocalWrite) {
    queueMicrotask(state.options.onLocalWrite);
  }
}

function generateOpId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `${Date.now().toString(16)}-${hex}`;
}

async function applyIncoming(ops: readonly Operation[]): Promise<void> {
  if (!state) throw new Error("IDB proxy not installed");
  const db = await state.dbReady;
  const byStore = new Map<string, Operation[]>();
  for (const op of ops) {
    if (!state.options.syncedStores.includes(op.store)) continue;
    const list = byStore.get(op.store) ?? [];
    list.push(op);
    byStore.set(op.store, list);
  }
  for (const [storeName, storeOps] of byStore) {
    suppressCapture = true;
    try {
      const tx = state.originalTransaction.call(
        db,
        [storeName, INTERNAL_STORES.meta] as never,
        "readwrite" as IDBTransactionMode,
      );
      const store = tx.objectStore(storeName);
      const meta = tx.objectStore(INTERNAL_STORES.meta);
      for (const op of storeOps) {
        const metaKey = `${storeName}:${op.pk}`;
        const existing = (await idbReq(meta.get(metaKey))) as
          | { hlc: string }
          | undefined;
        if (existing && existing.hlc >= op.hlc) continue;
        if (op.type === "put") {
          if (op.payload !== undefined) {
            await idbReq(store.put(op.payload));
          }
        } else {
          try {
            await idbReq(store.delete(op.pk));
          } catch {
            // ignore — record may not exist locally
          }
        }
        await idbReq(meta.put({ key: metaKey, hlc: op.hlc, type: op.type }));
      }
      await idbTx(tx);
    } finally {
      suppressCapture = false;
    }
  }
}
