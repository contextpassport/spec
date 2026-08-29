#!/usr/bin/env node
/**
 * Asserts that the schema served at contextpassport.com is the schema in this
 * repository.
 *
 * That URL stopped being a convenience on 28 August 2026, when SchemaStore
 * merged a catalog entry pointing at it (SchemaStore/schemastore#6264). Every
 * VS Code, Visual Studio and JetBrains install now fetches it whenever someone
 * opens a *.passport.json file. Nobody who hits a stale or missing copy will
 * know to tell us: they will see validation errors on a valid document, blame
 * the format, and close the file.
 *
 * The failure this guards is silent by construction. A deploy that does not
 * happen leaves the repository correct and the world wrong, so nothing in the
 * commit history looks off. Only fetching the live bytes catches it, which is
 * why this runs on a schedule rather than on push: the risk is drift over
 * time, not a bad diff.
 *
 *     node tools/check-published-schema.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = join(ROOT, 'schema', 'v2.json');
const PUBLISHED = 'https://contextpassport.com/schema/v2.json';

// Compare canonically so key order in the served file cannot raise a false
// alarm. What matters is that the two describe the same constraints.
const canon = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]))
      : x,
  );

/**
 * Returns an array of failure strings. Empty means the published schema is
 * good. Never calls process.exit: exiting hard while an undici keep-alive
 * socket is open aborts the process with a libuv assertion on Windows, which
 * surfaces as exit 127 and a C-level stack trace instead of the readable
 * failure this file exists to produce.
 */
async function check() {
  const res = await fetch(PUBLISHED, { headers: { accept: 'application/json' } });

  if (res.status !== 200) {
    return [
      `${PUBLISHED} returned ${res.status} ${res.statusText}`,
      'SchemaStore points editors at this URL. While it is down, every',
      '*.passport.json file in every IDE fails to validate.',
    ];
  }

  // Editors and validators dispatch on this. text/html here usually means a
  // catch-all route swallowed the path and returned the site index with a 200,
  // which is worse than a 404: it parses as "not a schema" rather than "not
  // there", so the editor reports the user's document as the problem.
  const ctype = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const body = await res.text();

  let published;
  try {
    published = JSON.parse(body);
  } catch (e) {
    return [
      `the published schema is not valid JSON: ${e.message}`,
      `first 200 bytes: ${body.slice(0, 200)}`,
    ];
  }

  const local = JSON.parse(readFileSync(LOCAL, 'utf8'));
  const problems = [];

  if (ctype !== 'application/json') {
    problems.push(`content-type is "${ctype}", expected "application/json"`);
  }

  if (canon(published) !== canon(local)) {
    problems.push('the published schema differs from schema/v2.json');
    const pk = Object.keys(published);
    const lk = Object.keys(local);
    for (const k of pk.filter((k) => !lk.includes(k))) problems.push(`  only published: ${k}`);
    for (const k of lk.filter((k) => !pk.includes(k))) problems.push(`  only in repo:   ${k}`);
    for (const k of pk.filter((k) => lk.includes(k))) {
      if (canon(published[k]) !== canon(local[k])) problems.push(`  differs:        ${k}`);
    }
    problems.push("  The site needs redeploying, or the repo needs the site's version.");
  }

  // A schema whose $id disagrees with where it is served from resolves any
  // future $ref against the wrong base, and tells a reader it came from
  // somewhere else.
  if (published.$id !== PUBLISHED) {
    problems.push(`$id is "${published.$id}", expected "${PUBLISHED}"`);
  }

  if (problems.length === 0) {
    console.log(`Published schema matches schema/v2.json (${body.length} bytes, ${ctype}, $id ok).`);
  }
  return problems;
}

const problems = await check();
if (problems.length > 0) {
  for (const p of problems) console.error(p.startsWith(' ') ? p : `FAIL  ${p}`);
  console.error('\nSchemaStore catalog: https://www.schemastore.org/api/json/catalog.json');
  process.exitCode = 1;
}
