import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('plugin', { recursive: true });
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'plugin/index.js',
  bundle: true,
  format: 'esm',
  target: 'chrome91',
  legalComments: 'inline',
  banner: { js: '/* ARAM Lite — based on WJZ-P/sona (7a88a31). */' },
});
