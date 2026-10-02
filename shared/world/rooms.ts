export interface WorldRoomCoordinate {
  x: number;
  y: number;
}

export type RoomClass = 'standard' | 'highway' | 'sourceKeeper';

const ROOM_NAME = /^([WE])(\d+)([NS])(\d+)$/;

export function parseRoomName(roomName: string): WorldRoomCoordinate {
  const match = ROOM_NAME.exec(roomName);
  if (!match) {
    throw new Error(`Invalid Screeps room name: ${roomName}`);
  }

  const horizontal = match[1];
  const xNumber = Number(match[2]);
  const vertical = match[3];
  const yNumber = Number(match[4]);

  return {
    x: horizontal === 'E' ? xNumber : -xNumber - 1,
    y: vertical === 'S' ? yNumber : -yNumber - 1
  };
}

export function roomNameFromCoordinate({ x, y }: WorldRoomCoordinate): string {
  const horizontal = x >= 0 ? `E${x}` : `W${-x - 1}`;
  const vertical = y >= 0 ? `S${y}` : `N${-y - 1}`;
  return horizontal + vertical;
}

export function roomLinearDistance(a: string, b: string): number {
  const aa = parseRoomName(a);
  const bb = parseRoomName(b);
  return Math.max(Math.abs(aa.x - bb.x), Math.abs(aa.y - bb.y));
}

function labelNumber(value: number): number {
  return value >= 0 ? value : -value - 1;
}

export function classifyRoom(roomName: string): RoomClass {
  const { x, y } = parseRoomName(roomName);
  const xMod = labelNumber(x) % 10;
  const yMod = labelNumber(y) % 10;

  if (xMod === 0 || yMod === 0) {
    return 'highway';
  }

  if (xMod >= 4 && xMod <= 6 && yMod >= 4 && yMod <= 6) {
    return 'sourceKeeper';
  }

  return 'standard';
}

export function distanceToNearestHighway(roomName: string): number {
  const { x, y } = parseRoomName(roomName);
  const xMod = labelNumber(x) % 10;
  const yMod = labelNumber(y) % 10;

  return Math.min(
    xMod,
    10 - xMod,
    yMod,
    10 - yMod
  );
}

export function roomsInSquare(centerRoom: string, radius: number): string[] {
  if (!Number.isInteger(radius) || radius < 0) {
    throw new Error('radius must be a non-negative integer');
  }

  const center = parseRoomName(centerRoom);
  const rooms: string[] = [];

  for (let y = center.y - radius; y <= center.y + radius; y += 1) {
    for (let x = center.x - radius; x <= center.x + radius; x += 1) {
      rooms.push(roomNameFromCoordinate({ x, y }));
    }
  }

  return rooms;
}
