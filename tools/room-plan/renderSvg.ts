import type { RoomFacts, RoomPlan } from '../../shared/roomPlan/types';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Offline inspection only; never imported by the bot. */
export function renderPlanSvg(facts: RoomFacts, plan: RoomPlan): string {
  const size = 13, offset = 35;
  const color = (module: string) => module === 'core' ? '#d49116' : module.startsWith('source:') ? '#278a39' :
    module === 'controller' ? '#217bbc' : module === 'labs' ? '#9058b2' : '#4c5461';
  const rect = (x: number, y: number, fill: string, stroke = 'none', opacity = 1) =>
    `<rect x="${offset + x * size}" y="${offset + y * size}" width="${size}" height="${size}" fill="${fill}" stroke="${stroke}" opacity="${opacity}"/>`;
  const label = (x: number, y: number, text: string, fill = '#fff', font = 8) =>
    `<text x="${offset + (x + 0.5) * size}" y="${offset + (y + 0.7) * size}" text-anchor="middle" font-size="${font}" fill="${fill}">${escape(text)}</text>`;
  const elements = ['<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="730" viewBox="0 0 1000 730">',
    '<rect width="1000" height="730" fill="#f4f0e5"/>', '<rect x="35" y="35" width="650" height="650" fill="#e8dec7"/>', '<g font-family="Arial, sans-serif">'];
  for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) {
    const terrain = facts.terrain[y * 50 + x];
    if (terrain !== '0') elements.push(rect(x, y, Number(terrain) & 1 ? '#333a42' : '#b6c59f'));
  }
  for (const a of plan.assets) elements.push(rect(a.x, a.y, 'none', '#db5151'));
  for (const r of plan.reservations) {
    elements.push(rect(r.x, r.y, color(r.module), color(r.module), r.purpose === 'future' ? 0.6 : 0.25));
    if (r.purpose === 'manager') elements.push(label(r.x, r.y, 'M', '#9d4700', 11));
    if (r.purpose === 'work') elements.push(label(r.x, r.y, 'W', color(r.module)));
    if (r.futureType) elements.push(label(r.x, r.y, r.futureType === 'lab' ? 'Lb' : r.futureType));
  }
  const labels: Record<string, string> = { storage: 'S', terminal: 'T', factory: 'F', link: 'L', spawn: 'Sp', tower: 'Tw',
    extension: 'E', container: 'C', powerSpawn: 'P', nuker: 'N', observer: 'O' };
  for (const s of plan.structures) {
    if (s.type === 'road') elements.push(`<circle cx="${offset + (s.x + 0.5) * size}" cy="${offset + (s.y + 0.5) * size}" r="2" fill="#777"/>`);
    else { elements.push(rect(s.x, s.y, color(s.module))); elements.push(label(s.x, s.y, labels[s.type] ?? s.type)); }
  }
  elements.push(label(facts.controller.x, facts.controller.y, 'CTRL', '#005290', 8));
  for (const s of facts.sources) elements.push(label(s.x, s.y, 'SRC', '#005d1d', 8));
  if (facts.mineral) elements.push(label(facts.mineral.x, facts.mineral.y, 'MIN', '#777', 8));
  const legend = [facts.roomName, plan.id, `Score: ${plan.score.total}`, `Complete: ${plan.feasibility.complete}`,
    `Roads: ${plan.score.roadTiles} (cost ${plan.score.roadCost})`, `Core terrain penalty: ${plan.score.coreTerrainPenalty}`,
    '', 'Gold: core / M: manager', 'S: storage / T: terminal', 'F: factory / L: link', 'Green: sources / C: container',
    'Blue: controller / W: work tile', 'Purple: reserved lab module', 'E: extensions / Sp: spawns', 'Tw: towers / P: power spawn',
    'N: nuker / O: observer', 'Dots: shared road network', 'Red outlines: observed assets', '', ...plan.feasibility.reasons, ...plan.warnings];
  legend.forEach((text, i) => elements.push(`<text x="710" y="${45 + i * 20}" font-size="${i === 0 ? 20 : 12}" fill="#202932">${escape(text)}</text>`));
  elements.push('</g></svg>'); return elements.join('\n');
}
