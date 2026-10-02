import { isSwamp, isWalkable, type RoomPositionLike } from './terrain';

const ROOM_SIZE = 50;
const DIRECTIONS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],           [1, 0],
  [-1, 1],  [0, 1],  [1, 1]
] as const;

interface QueueEntry {
  index: number;
  cost: number;
}

class MinHeap {
  private readonly values: QueueEntry[] = [];

  get size(): number {
    return this.values.length;
  }

  push(value: QueueEntry): void {
    this.values.push(value);
    let index = this.values.length - 1;

    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].cost <= value.cost) break;
      this.values[index] = this.values[parent];
      index = parent;
    }

    this.values[index] = value;
  }

  pop(): QueueEntry | undefined {
    if (this.values.length === 0) return undefined;

    const first = this.values[0];
    const last = this.values.pop();
    if (!last || this.values.length === 0) return first;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;

      let smallest = left;
      if (right < this.values.length && this.values[right].cost < this.values[left].cost) {
        smallest = right;
      }

      if (this.values[smallest].cost >= last.cost) break;
      this.values[index] = this.values[smallest];
      index = smallest;
    }

    this.values[index] = last;
    return first;
  }
}

export function terrainPathCost(
  encoded: string,
  from: RoomPositionLike,
  to: RoomPositionLike
): number | null {
  if (!isWalkable(encoded, from.x, from.y) || !isWalkable(encoded, to.x, to.y)) {
    return null;
  }

  const start = from.y * ROOM_SIZE + from.x;
  const goal = to.y * ROOM_SIZE + to.x;
  const distances = new Array<number>(ROOM_SIZE * ROOM_SIZE).fill(Number.POSITIVE_INFINITY);
  const queue = new MinHeap();

  distances[start] = 0;
  queue.push({ index: start, cost: 0 });

  while (queue.size > 0) {
    const current = queue.pop();
    if (!current) break;
    if (current.cost !== distances[current.index]) continue;
    if (current.index === goal) return current.cost;

    const x = current.index % ROOM_SIZE;
    const y = Math.floor(current.index / ROOM_SIZE);

    for (const [dx, dy] of DIRECTIONS) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (!isWalkable(encoded, nextX, nextY)) continue;

      const nextIndex = nextY * ROOM_SIZE + nextX;
      const stepCost = isSwamp(encoded, nextX, nextY) ? 10 : 2;
      const cost = current.cost + stepCost;

      if (cost >= distances[nextIndex]) continue;
      distances[nextIndex] = cost;
      queue.push({ index: nextIndex, cost });
    }
  }

  return null;
}
