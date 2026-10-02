import { getScreepsClient } from '../lib/screepsClient';

const api = getScreepsClient();
const version = await api.version();

console.log(JSON.stringify(version, null, 2));
