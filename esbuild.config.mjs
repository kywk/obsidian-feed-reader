import { context } from 'esbuild';
import { builtinModules } from 'node:module';

const watch = process.argv.includes('--watch');
const builder = await context({
  entryPoints: ['src/main.ts'],
  outfile: 'main.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  external: ['obsidian', 'electron', ...builtinModules, ...builtinModules.map(m => `node:${m}`)],
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
});
if (watch) await builder.watch();
else {
  await builder.rebuild();
  await builder.dispose();
}
