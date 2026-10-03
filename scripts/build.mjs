import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  format: 'cjs',
  platform: 'neutral',
  target: 'es2020',
  sourcemap: false,
  minify: false,
  logLevel: 'info'
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching Screeps runtime sources...');
} else {
  await build(options);
}
