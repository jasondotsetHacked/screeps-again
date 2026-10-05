import fs from 'node:fs';
import path from 'node:path';
import { planRoom } from '../../shared/roomPlan/planRoom';
import type { RoomFacts } from '../../shared/roomPlan/types';
import { renderPlanSvg } from './renderSvg';

const [input, output = '.local/room-plan'] = process.argv.slice(2);
if (!input) throw new Error('Usage: node --import tsx tools/room-plan/inspect.ts facts.json [output-prefix]');
const facts = JSON.parse(fs.readFileSync(input, 'utf8')) as RoomFacts;
const result = planRoom(facts);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(`${output}.json`, JSON.stringify(result.roomPlan, null, 2) + '\n');
fs.writeFileSync(`${output}.svg`, renderPlanSvg(facts, result.roomPlan));
console.log(JSON.stringify({ id: result.roomPlan.id, score: result.score, feasibility: result.feasibility, warnings: result.warnings }, null, 2));
