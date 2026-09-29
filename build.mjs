import * as esbuild from 'esbuild';
import fs from 'fs';

const watch = process.argv.includes('--watch');
const opts = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: !process.argv.includes('--dev'),
  write: false,
  logLevel: 'warning',
};

async function build() {
  const r = await esbuild.build(opts);
  const js = r.outputFiles[0].text;
  const tpl = fs.readFileSync('src/index.html', 'utf8');
  const html = tpl.replace('/*__BUNDLE__*/', () => js.replace(/<\/script/g, '<\\/script'));
  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync('dist/battletext.html', html);
  console.log(`built dist/battletext.html (${(html.length / 1024).toFixed(0)} KB)`);
}
await build();
