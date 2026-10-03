import { getScreepsClient } from '../lib/screepsClient';

const api = getScreepsClient();
const me = await api.authMe();

console.log(JSON.stringify(me, null, 2));
