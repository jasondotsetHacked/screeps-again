import {
  distanceToNearestHighway,
  roomLinearDistance
} from '../../shared/world/rooms';
import type {
  DeepRoomAnalysis,
  NearbyOwner,
  RegionalRoomSummary,
  ScoreDimension,
  ScoredRoom
} from './types';

function dimension(max: number): ScoreDimension {
  return { score: 0, max, reasons: [], warnings: [] };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nearbyOwnersFor(
  roomName: string,
  regionalRooms: RegionalRoomSummary[]
): NearbyOwner[] {
  const owners = new Map<string, NearbyOwner>();

  for (const room of regionalRooms) {
    if (!room.owner) continue;

    const distance = roomLinearDistance(roomName, room.roomName);
    if (distance > 6) continue;

    const current = owners.get(room.owner.username);
    if (!current) {
      owners.set(room.owner.username, {
        username: room.owner.username,
        nearestDistance: distance,
        rooms: 1,
        maxRcl: room.owner.rcl
      });
      continue;
    }

    current.nearestDistance = Math.min(current.nearestDistance, distance);
    current.rooms += 1;
    current.maxRcl = Math.max(current.maxRcl, room.owner.rcl);
  }

  return [...owners.values()].sort(
    (a, b) => a.nearestDistance - b.nearestDistance || b.maxRcl - a.maxRcl
  );
}

export function scoreRoom(
  room: DeepRoomAnalysis,
  regionalRooms: RegionalRoomSummary[]
): ScoredRoom {
  const availability = dimension(10);
  const economy = dimension(30);
  const base = dimension(30);
  const strategy = dimension(30);
  const nearbyOwners = nearbyOwnersFor(room.roomName, regionalRooms);

  if (!room.owner && room.roomClass === 'standard' && room.status !== 'closed') {
    availability.score = 10;
    availability.reasons.push('Unowned standard room is available for consideration.');
  } else {
    availability.warnings.push('Room is not a normal unowned starting-room candidate.');
  }

  if (room.sources.length === 2) {
    economy.score += 18;
    economy.reasons.push('Two energy sources.');
  } else if (room.sources.length === 1) {
    economy.score += 8;
    economy.warnings.push('Only one energy source.');
  } else {
    economy.warnings.push('Source data is missing or no sources were found.');
  }

  if (room.sourceOpenTiles.length > 0) {
    const averageOpen =
      room.sourceOpenTiles.reduce((sum, value) => sum + value, 0) /
      room.sourceOpenTiles.length;

    const accessScore = clamp((averageOpen - 2) * 1.5, 0, 5);
    economy.score += accessScore;
    economy.reasons.push(`Average source access: ${averageOpen.toFixed(1)} walkable adjacent tiles.`);
  }

  const validSourceCosts = room.sourcePathCosts.filter(
    (cost): cost is number => cost !== null
  );
  if (validSourceCosts.length > 0) {
    const averageCost =
      validSourceCosts.reduce((sum, value) => sum + value, 0) /
      validSourceCosts.length;

    const logisticsScore =
      averageCost <= 45 ? 7 :
      averageCost <= 70 ? 5 :
      averageCost <= 100 ? 3 :
      averageCost <= 140 ? 1 : 0;

    economy.score += logisticsScore;
    economy.reasons.push(`Average anchor-to-source terrain cost: ${averageCost.toFixed(0)}.`);
    if (averageCost > 100) {
      economy.warnings.push('Sources are expensive to reach from the suggested base area.');
    }
  }

  if (room.terrain) {
    const walkableScore = clamp((room.terrain.walkableRatio - 0.55) * 30, 0, 8);
    base.score += walkableScore;
    base.reasons.push(
      `${(room.terrain.walkableRatio * 100).toFixed(1)}% of room terrain is walkable.`
    );

    const swampScore = clamp((0.25 - room.terrain.swampRatioOfWalkable) * 30, 0, 6);
    base.score += swampScore;
    base.reasons.push(
      `${(room.terrain.swampRatioOfWalkable * 100).toFixed(1)}% of walkable terrain is swamp.`
    );

    const side = room.terrain.largestOpenSquare.side;
    const footprintScore =
      side >= 14 ? 10 :
      side >= 11 ? 8 :
      side >= 9 ? 6 :
      side >= 7 ? 4 :
      side >= 5 ? 2 : 0;

    base.score += footprintScore;
    base.reasons.push(`Largest interior open square is approximately ${side}x${side}.`);
    if (side < 7) {
      base.warnings.push('Large compact base footprints may be difficult.');
    }
  }

  if (room.controllerPathCost !== null) {
    const controllerScore =
      room.controllerPathCost <= 35 ? 6 :
      room.controllerPathCost <= 55 ? 5 :
      room.controllerPathCost <= 80 ? 3 :
      room.controllerPathCost <= 110 ? 1 : 0;

    base.score += controllerScore;
    base.reasons.push(`Anchor-to-controller terrain cost: ${room.controllerPathCost}.`);
  } else {
    base.warnings.push('Controller path could not be measured.');
  }

  let pressure = 0;
  for (const owner of nearbyOwners) {
    const distanceWeight = Math.max(0, 7 - owner.nearestDistance) / 6;
    const strengthWeight = owner.maxRcl / 8;
    pressure += distanceWeight * strengthWeight * 4;
  }

  pressure = clamp(pressure, 0, 12);
  strategy.score += 12 - pressure;

  if (nearbyOwners.length === 0) {
    strategy.reasons.push('No owned player rooms found within the scanned regional context.');
  } else {
    const nearest = nearbyOwners[0];
    strategy.reasons.push(
      `Nearest observed player: ${nearest.username}, ${nearest.nearestDistance} room(s) away, up to RCL ${nearest.maxRcl}.`
    );
    if (pressure >= 7) {
      strategy.warnings.push('Nearby established-player pressure is high.');
    }
  }

  const nearbyOpen = regionalRooms.filter(
    (other) =>
      other.roomClass === 'standard' &&
      other.status !== 'closed' &&
      !other.owner &&
      other.roomName !== room.roomName &&
      roomLinearDistance(room.roomName, other.roomName) <= 2
  ).length;

  strategy.score += clamp(nearbyOpen, 0, 6);
  strategy.reasons.push(`${nearbyOpen} nearby unowned standard room(s) within range 2.`);

  const highwayDistance = distanceToNearestHighway(room.roomName);
  const highwayScore =
    highwayDistance === 1 ? 5 :
    highwayDistance === 2 ? 4 :
    highwayDistance === 3 ? 3 :
    highwayDistance === 4 ? 2 : 1;

  strategy.score += highwayScore;
  strategy.reasons.push(`Nearest highway band is ${highwayDistance} room(s) away.`);

  if (room.status === 'novice' || room.status === 'respawn') {
    strategy.score += 5;
    strategy.reasons.push(`Room is in a ${room.status} area.`);
  } else {
    strategy.score += 2;
  }

  let confidence: ScoredRoom['confidence'] = 'full';
  let confidencePenalty = 0;

  if (room.error || !room.terrain || !room.controller || room.sources.length === 0) {
    confidence = 'partial';
    confidencePenalty = 20;
    strategy.warnings.push(
      'Deep room data is incomplete; score is penalized until the room can be inspected fully.'
    );
  }

  const total = clamp(
    availability.score + economy.score + base.score + strategy.score - confidencePenalty,
    0,
    100
  );

  return {
    room,
    total: Number(total.toFixed(1)),
    max: 100,
    confidence,
    dimensions: {
      availability,
      economy,
      base,
      strategy
    },
    nearbyOwners
  };
}
