import type { RoomPlan } from '../../shared/roomPlan/types';

const labels: Record<string, string> = { storage: 'S', terminal: 'T', factory: 'F', link: 'L', spawn: 'SP',
  tower: 'TW', extension: 'E', container: 'C', powerSpawn: 'PS', observer: 'O', nuker: 'N' };
/** Full future intent, visible at any RCL. Colors represent modules, letters structures. */
export function renderRoomPlan(visual: Pick<RoomVisual, 'circle' | 'rect' | 'text' | 'line'>, plan: RoomPlan): void {
  const color = (module: string) => module === 'core' ? '#ffc857' : module.startsWith('source:') ? '#63d471' :
    module === 'controller' ? '#75baff' : module === 'labs' ? '#ce9dff' : '#e0e0e0';
  for (const r of plan.reservations) {
    visual.rect(r.x - 0.42, r.y - 0.42, 0.84, 0.84, { fill: color(r.module), opacity: 0.15, stroke: color(r.module), strokeWidth: 0.05 });
    if (r.purpose === 'manager') visual.text('M', r.x, r.y + 0.2, { color: '#ff7700', font: 0.7 });
    if (r.futureType) visual.text(r.futureType === 'lab' ? 'LAB' : r.futureType, r.x, r.y + 0.15, { color: color(r.module), font: 0.35 });
    if (r.purpose === 'work' && r.module === 'controller') visual.text('U', r.x, r.y + 0.15, { color: color(r.module), font: 0.5 });
  }
  for (const s of plan.structures) {
    visual.circle(s.x, s.y, { radius: s.type === 'road' ? 0.12 : 0.36, fill: s.type === 'road' ? '#888888' : color(s.module), opacity: 0.6, stroke: 'transparent' });
    if (s.type !== 'road') visual.text(labels[s.type] ?? s.type, s.x, s.y + 0.13, { color: '#ffffff', font: 0.32 });
  }
  for (const source of plan.sources) visual.text('MIN', source.miner.x, source.miner.y - 0.35, { color: '#63d471', font: 0.3 });
  visual.text(`${plan.id} score=${plan.score.total} ${plan.feasibility.complete ? 'complete' : plan.feasibility.reasons.join(', ')}`,
    1, 1, { align: 'left', color: '#ffffff', font: 0.45 });
}
