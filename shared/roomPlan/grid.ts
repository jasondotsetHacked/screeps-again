import type { Tile } from './types';

export const key = (p: Tile): number => p.y * 50 + p.x;
export const tile = (id: number): Tile => ({ x: id % 50, y: Math.floor(id / 50) });
export const range = (a: Tile, b: Tile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const inside = (p: Tile, margin = 1): boolean => Number.isInteger(p.x) && Number.isInteger(p.y) &&
  p.x >= margin && p.y >= margin && p.x < 50 - margin && p.y < 50 - margin;
export function neighbors(p: Tile): Tile[] {
  const out: Tile[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const n = { x: p.x + dx, y: p.y + dy };
    if ((dx || dy) && inside(n)) out.push(n);
  }
  return out;
}
export function flood(walk: Uint8Array, seeds: readonly Tile[], excluded = new Set<number>()): Uint8Array {
  const seen = new Uint8Array(2500), queue: number[] = [];
  for (const p of seeds) if (inside(p) && walk[key(p)] && !excluded.has(key(p)) && !seen[key(p)]) {
    seen[key(p)] = 1; queue.push(key(p));
  }
  for (let i = 0; i < queue.length; i++) for (const n of neighbors(tile(queue[i]))) {
    const id = key(n);
    if (walk[id] && !seen[id] && !excluded.has(id)) { seen[id] = 1; queue.push(id); }
  }
  return seen;
}
/** Chebyshev distance to terrain/obstacles, including the unbuildable room border. */
export function distanceTransform(walk: Uint8Array): Uint8Array {
  const out = new Uint8Array(2500), queue: number[] = [];
  out.fill(255);
  for (let id = 0; id < 2500; id++) if (!walk[id] || !inside(tile(id))) { out[id] = 0; queue.push(id); }
  for (let i = 0; i < queue.length; i++) for (const p of neighbors(tile(queue[i]))) {
    const id = key(p);
    if (out[id] > out[queue[i]] + 1) { out[id] = out[queue[i]] + 1; queue.push(id); }
  }
  return out;
}

// Stable binary heap: cell index breaks equal-cost ties independently of insertion order.
class Heap {
  private data: { id: number; cost: number }[] = [];
  private less(a: { id: number; cost: number }, b: { id: number; cost: number }) {
    return a.cost < b.cost || a.cost === b.cost && a.id < b.id;
  }
  push(value: { id: number; cost: number }) {
    let i = this.data.length; this.data.push(value);
    while (i) {
      const parent = (i - 1) >> 1;
      if (!this.less(value, this.data[parent])) break;
      this.data[i] = this.data[parent]; i = parent;
    }
    this.data[i] = value;
  }
  pop() {
    const first = this.data[0], last = this.data.pop();
    if (!last || !this.data.length) return first;
    let i = 0;
    while (i * 2 + 1 < this.data.length) {
      let child = i * 2 + 1;
      if (child + 1 < this.data.length && this.less(this.data[child + 1], this.data[child])) child++;
      if (!this.less(this.data[child], last)) break;
      this.data[i] = this.data[child]; i = child;
    }
    this.data[i] = last; return first;
  }
}
export function weightedPath(walk: Uint8Array, terrain: string, from: Tile, goals: readonly Tile[],
  roads: ReadonlySet<number> = new Set(), excluded: ReadonlySet<number> = new Set()): Tile[] | undefined {
  if (!inside(from) || !walk[key(from)] || excluded.has(key(from))) return undefined;
  const targets = new Set(goals.filter((p) => inside(p) && walk[key(p)] && !excluded.has(key(p))).map(key));
  const costs = new Float64Array(2500); costs.fill(Infinity);
  const previous = new Int16Array(2500); previous.fill(-1);
  const heap = new Heap(); costs[key(from)] = 0; heap.push({ id: key(from), cost: 0 });
  for (let current = heap.pop(); current; current = heap.pop()) {
    if (current.cost !== costs[current.id]) continue;
    if (targets.has(current.id)) {
      const path: Tile[] = [];
      for (let id = current.id; id !== -1; id = previous[id]) path.push(tile(id));
      return path.reverse();
    }
    for (const n of neighbors(tile(current.id))) {
      const id = key(n);
      if (!walk[id] || excluded.has(id)) continue;
      const cost = current.cost + (roads.has(id) ? 1 : terrain[id] === '2' ? 15 : 3);
      if (cost >= costs[id]) continue;
      costs[id] = cost; previous[id] = current.id; heap.push({ id, cost });
    }
  }
  return undefined;
}
export function hash(value: string): string {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return (result >>> 0).toString(16).padStart(8, '0');
}
