#!/usr/bin/env node
/* CTTLFA site prerender (build step).
 * Generates one static HTML file per route from index.html, identical to the app
 * shell but with that route's own <title>, meta description, canonical URL and
 * Open Graph / Twitter tags baked into the served HTML. The single-page app still
 * runs on top (the router shows the right page from the URL path), so visitors see
 * no difference — but each clean URL now presents Google a distinct, self-canonical
 * page, instead of every address serving the home page's head.
 *
 * No dependencies. Run from the repo root:  node prerender.js
 */
const fs = require('fs');
const SRC = 'index.html';
const BASE = 'https://www.cttfa.co.za/';
if (!fs.existsSync('p')) fs.mkdirSync('p');

let html = fs.readFileSync(SRC, 'utf8');

// Pull the site's own PAGES table (title `t` + description `d` per route) straight
// from index.html so this stays the single source of truth — no duplication.
const m = html.match(/const PAGES=(\{[\s\S]*?\n\};)/);
if (!m) { console.error('prerender: PAGES table not found in index.html'); process.exit(1); }
const PAGES = eval('(' + m[1].replace(/;\s*$/, '') + ')');

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function replaceOnce(str, re, repl, label) {
  if (!re.test(str)) throw new Error('prerender: pattern not found: ' + label);
  return str.replace(re, repl);
}

let made = [], skipped = [];
for (const key of Object.keys(PAGES)) {
  if (key === 'home' || key === '404') continue;               // home = index.html; 404 not indexable
  if (!html.includes('id="page-' + key + '"')) { skipped.push(key); continue; } // no real page div
  const p = PAGES[key];
  const url = BASE + key;
  const t = esc(p.t), d = esc(p.d);
  let out = html;
  out = replaceOnce(out, /<title>[\s\S]*?<\/title>/, '<title>' + t + '</title>', 'title');
  out = replaceOnce(out, /(<meta name="description" content=")[\s\S]*?(">)/, '$1' + d + '$2', 'description');
  out = replaceOnce(out, /(<link rel="canonical" href=")[\s\S]*?(">)/, '$1' + url + '$2', 'canonical');
  out = replaceOnce(out, /(<meta property="og:title" id="og-title" content=")[\s\S]*?(">)/, '$1' + t + '$2', 'og:title');
  out = replaceOnce(out, /(<meta property="og:description" id="og-desc" content=")[\s\S]*?(">)/, '$1' + d + '$2', 'og:description');
  out = replaceOnce(out, /(<meta property="og:url" id="og-url" content=")[\s\S]*?(">)/, '$1' + url + '$2', 'og:url');
  out = replaceOnce(out, /(<meta name="twitter:title" id="tw-title" content=")[\s\S]*?(">)/, '$1' + t + '$2', 'twitter:title');
  out = replaceOnce(out, /(<meta name="twitter:description" id="tw-desc" content=")[\s\S]*?(">)/, '$1' + d + '$2', 'twitter:description');
  fs.writeFileSync('p/' + key + '.html', out);
  made.push(key);
}
console.log('prerender: wrote ' + made.length + ' route pages');
console.log('  routes: ' + made.join(', '));
if (skipped.length) console.log('  skipped (no page div): ' + skipped.join(', '));
