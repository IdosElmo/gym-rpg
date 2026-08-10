/**
 * Verifies that dist/index.html is a single self-contained file:
 *  - no <script src> / <link rel=stylesheet href> / <img src> pointing anywhere;
 *  - no absolute http(s) URLs other than XML namespaces (xmlns=…), which are
 *    identifiers, not network fetches;
 *  - the app code and the CSS are actually inlined.
 * Usage: node scripts/verify-dist.mjs
 */
import { readFileSync, statSync } from 'node:fs';

const file = 'dist/index.html';
const html = readFileSync(file, 'utf8');
const problems = [];

for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=/gi)) problems.push(`external <script src> at ${m.index}`);
for (const m of html.matchAll(/<link\b[^>]*rel\s*=\s*["']?stylesheet/gi)) problems.push(`external stylesheet at ${m.index}`);
for (const m of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["'](?!data:)/gi)) problems.push(`external <img src> at ${m.index}`);

for (const m of html.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) {
  const idx = m.index ?? 0;
  const before = html.slice(Math.max(0, idx - 40), idx);
  if (/xmlns(:\w+)?\s*=\s*["']?$/i.test(before)) continue; // SVG/XML namespace
  problems.push(`absolute URL: ${m[0]}`);
}

for (const m of html.matchAll(/@import\s+url\(|url\(\s*["']?(?!data:)(https?:|\/\/)/gi)) {
  problems.push(`external css url() at ${m.index}`);
}

if (!/<style[^>]*>[\s\S]*--accent:#3B82F6/i.test(html)) problems.push('CSS was not inlined');
if (!/PROGRAM|היפרטרופיה/.test(html)) problems.push('app content missing');
if (!/<script[^>]*>[\s\S]{2000,}<\/script>/.test(html)) problems.push('JS was not inlined');

const kb = (statSync(file).size / 1024).toFixed(1);
if (problems.length) {
  console.error(`✗ ${file} (${kb} kB) has ${problems.length} problem(s):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`✓ ${file} is self-contained (${kb} kB, zero external references)`);
