import type { IdbProxyOptions } from "./types.js";

let installed = false;

export function installIdbProxy(options: IdbProxyOptions): void {
  if (installed) throw new Error("IDB proxy already installed");
  void options;
  installed = true;
  throw new Error("installIdbProxy: not implemented");
}

export function uninstallIdbProxy(): void {
  installed = false;
}
