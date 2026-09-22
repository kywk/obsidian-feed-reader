import { context } from 'esbuild';
import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';

const notices = ['LICENSE', 'THIRD_PARTY_NOTICES.md']
  .map(file => readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n\n')
  .replaceAll('*/', '* /');

const watch = process.argv.includes('--watch');
const builder = await context({
  entryPoints: ['src/main.ts'],
  outfile: 'main.js',
  bundle: true,
  banner: { js: `/*!\n${notices}\n*/` },
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
