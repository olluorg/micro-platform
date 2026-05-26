import type { HLC, HLCString } from "@ollu/shared-types";

export function hlcToString(h: HLC): HLCString {
  const phys = h.physical.toString(16).padStart(12, "0");
  const logi = h.logical.toString(16).padStart(4, "0");
  return `${phys}-${logi}-${h.nodeId}`;
}

export function hlcFromString(s: HLCString): HLC {
  const parts = s.split("-");
  if (parts.length < 3) throw new Error(`bad HLC: ${s}`);
  const [phys, logi, ...rest] = parts as [string, string, ...string[]];
  return {
    physical: parseInt(phys, 16),
    logical: parseInt(logi, 16),
    nodeId: rest.join("-"),
  };
}

export function hlcCompare(a: HLC, b: HLC): number {
  if (a.physical !== b.physical) return a.physical - b.physical;
  if (a.logical !== b.logical) return a.logical - b.logical;
  return a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0;
}

export class HLClock {
  private physical = 0;
  private logical = 0;

  constructor(private readonly nodeId: string) {}

  now(): HLC {
    const wall = Date.now();
    if (wall > this.physical) {
      this.physical = wall;
      this.logical = 0;
    } else {
      this.logical += 1;
    }
    return { physical: this.physical, logical: this.logical, nodeId: this.nodeId };
  }

  observe(remote: HLC): void {
    const wall = Date.now();
    const newPhysical = Math.max(wall, this.physical, remote.physical);
    if (newPhysical === this.physical && newPhysical === remote.physical) {
      this.logical = Math.max(this.logical, remote.logical) + 1;
    } else if (newPhysical === this.physical) {
      this.logical += 1;
    } else if (newPhysical === remote.physical) {
      this.logical = remote.logical + 1;
    } else {
      this.logical = 0;
    }
    this.physical = newPhysical;
  }
}
