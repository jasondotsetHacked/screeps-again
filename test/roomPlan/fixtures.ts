import type { RoomFacts } from '../../shared/roomPlan/types';
export function roomFacts(kind = 'open'): RoomFacts {
  const cells = Array<string>(2500).fill('0');
  for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) {
    if (x === 0 || y === 0 || x === 49 || y === 49) cells[y * 50 + x] = '1';
    else if (kind === 'swamp' && (x < 16 || x > 34 || y < 16 || y > 34)) cells[y * 50 + x] = '2';
    else if (kind === 'all-swamp') cells[y * 50 + x] = '2';
    else if (kind === 'walls' && (x % 13 === 0 && y % 11 > 2 || y % 17 === 0 && x % 11 > 2)) cells[y * 50 + x] = '1';
  }
  const facts: RoomFacts = { roomName: 'E1S1', terrain: cells.join(''), spawn1: { x: 20, y: 22 },
    controller: { x: 39, y: 36 }, sources: [{ id: 'a', x: 8, y: 10 }, { id: 'b', x: 40, y: 10 }],
    mineral: { x: 10, y: 39 }, assets: [{ type: 'spawn', x: 20, y: 22, owned: true }] };
  if (kind === 'controller') facts.controller = { x: 3, y: 46 };
  if (kind === 'sources') facts.sources = [{ id: 'a', x: 3, y: 3 }, { id: 'b', x: 4, y: 3 }];
  if (kind === 'brownfield') facts.assets.push(
    { type: 'container', x: 9, y: 11 }, { type: 'container', x: 38, y: 34 },
    { type: 'extension', x: 15, y: 16, owned: true }, { type: 'road', x: 14, y: 17 },
    { type: 'tower', x: 22, y: 27, owned: true });
  return facts;
}
