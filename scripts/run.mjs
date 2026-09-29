// Bundle a TS script for node and run it: node scripts/run.mjs scripts/foo.ts [args]
import * as esbuild from 'esbuild';
import { pathToFileURL } from 'url';
import fs from 'fs';
const entry = process.argv[2];
const out = `node_modules/.cache/run-${entry.replace(/[\/.]/g, '_')}.mjs`;
fs.mkdirSync('node_modules/.cache', { recursive: true });
await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning' });
process.argv.splice(2, 1);
await import(pathToFileURL(out).href);
