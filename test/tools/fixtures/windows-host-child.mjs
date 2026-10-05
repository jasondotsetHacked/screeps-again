import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [directory, role = 'parent'] = process.argv.slice(2);
writeFileSync(join(directory, `${role}.pid`), String(process.pid));
console.log(`${role} stdout`);
console.error(`${role} stderr`);
if (role === 'parent') {
  // Match the launcher's ordinary .cmd shim; no windowsHide on this module.
  const shim = spawn(process.env.ComSpec, ['/d', '/s', '/c', `""${join(directory, 'module.cmd')}""`], {
    stdio: 'inherit', windowsVerbatimArguments: true
  });
  writeFileSync(join(directory, 'shim.pid'), String(shim.pid));
  const detached = spawn(process.execPath, [process.argv[1], directory, 'detached'], {
    detached: true, windowsHide: true, stdio: 'ignore'
  });
  detached.unref();
}
setInterval(() => {}, 1000);
