export function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function idbTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

export const INTERNAL_STORES = {
  outbox: "_outbox",
  kv: "_kv",
  meta: "_meta",
} as const;

export const ALL_INTERNAL = Object.values(INTERNAL_STORES) as readonly string[];

export function isInternalStore(name: string): boolean {
  return ALL_INTERNAL.includes(name);
}
