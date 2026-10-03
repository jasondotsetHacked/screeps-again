import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRoom,
  parseRoomName,
  roomLinearDistance,
  roomNameFromCoordinate,
  roomsInSquare
} from '../../shared/world/rooms';

test('room names round-trip through signed world coordinates', () => {
  for (const roomName of ['E0S0', 'W0N0', 'E12N34', 'W19S7']) {
    assert.equal(roomNameFromCoordinate(parseRoomName(roomName)), roomName);
  }
});

test('adjacent rooms across axis boundaries remain adjacent', () => {
  assert.equal(roomLinearDistance('W0N0', 'E0N0'), 1);
  assert.equal(roomLinearDistance('E0N0', 'E0S0'), 1);
});

test('room classification recognizes highway and source keeper bands', () => {
  assert.equal(classifyRoom('E10N12'), 'highway');
  assert.equal(classifyRoom('E15N15'), 'sourceKeeper');
  assert.equal(classifyRoom('E12N12'), 'standard');
});

test('square region includes every room around the center', () => {
  const rooms = roomsInSquare('E0S0', 1);
  assert.equal(rooms.length, 9);
  assert.ok(rooms.includes('W0N0'));
  assert.ok(rooms.includes('E1S1'));
});
