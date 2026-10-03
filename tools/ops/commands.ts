export type OpsCommand =
  | { type: 'help' }
  | { type: 'snapshot' }
  | { type: 'cpu' }
  | { type: 'room'; roomName: string }
  | { type: 'creep'; creepName: string };

const ROOM_PATTERN = /^[WE]\d+[NS]\d+$/;
const CREEP_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export function parseOpsCommand(raw: string): OpsCommand | null {
  const value = raw.trim();
  if (value.length > 200) return null;

  const parts = value.split(/\s+/);
  if (parts[0] !== '/screeps') return null;

  if (parts.length === 2 && parts[1] === 'help') {
    return { type: 'help' };
  }

  if (parts.length === 2 && parts[1] === 'snapshot') {
    return { type: 'snapshot' };
  }

  if (parts.length === 2 && parts[1] === 'cpu') {
    return { type: 'cpu' };
  }

  if (
    parts.length === 3 &&
    parts[1] === 'room' &&
    ROOM_PATTERN.test(parts[2])
  ) {
    return { type: 'room', roomName: parts[2] };
  }

  if (
    parts.length === 3 &&
    parts[1] === 'creep' &&
    CREEP_PATTERN.test(parts[2])
  ) {
    return { type: 'creep', creepName: parts[2] };
  }

  return null;
}

export function opsHelp(): string {
  return [
    '### Screeps Ops commands',
    '',
    '- /screeps snapshot — sanitized colony overview',
    '- /screeps cpu — CPU and bucket',
    '- /screeps room <room> — one owned room',
    '- /screeps creep <name> — one creep',
    '- /screeps help — this help',
    '',
    'This public bridge is intentionally read-only. Arbitrary console evaluation, Memory dumps, and write commands are not supported.'
  ].join('\n');
}
