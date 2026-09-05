#!/usr/bin/env node
/**
 * Asserts that server.js serves the site and nothing else.
 *
 * This exists because it did not. server.js joined the raw request path onto
 * the site root with no containment check, and since Node does not normalize
 * req.url, a client writing to the socket directly could ask for
 * "GET /../../../etc/passwd" and get it back with 200 OK. Browsers collapse
 * dot segments before sending, so ordinary use never showed it.
 *
 * The escape cases below are therefore written against a raw socket rather
 * than fetch(), because fetch normalizes the path and would quietly test
 * nothing at all. That is the trap this file is guarding, so it has to be
 * avoided here first.
 */

import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 34871;   // unlikely to collide with anything a contributor is running

/** Send a raw request line without normalization and return the response text. */
function rawRequest(target) {
  return new Promise((resolve, reject) => {
    const socket = connect(PORT, '127.0.0.1', () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    let out = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { out += chunk; });
    socket.on('end', () => resolve(out));
    socket.on('error', reject);
    socket.setTimeout(10000, () => { socket.destroy(); reject(new Error(`timeout on ${target}`)); });
  });
}

const waitFor = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      await rawRequest('/');
      return true;
    } catch {
      await waitFor(250);
    }
  }
  return false;
}

const server = spawn(process.execPath, [join(ROOT, 'server.js')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

let failures = 0;
const pass = (msg) => console.log(`  ok    ${msg}`);
const fail = (msg) => { failures++; console.error(`  FAIL  ${msg}`); };

try {
  if (!await waitForServer()) {
    console.error('server.js did not start');
    process.exit(1);
  }

  console.log('\n  Context Passport, checking server.js\n');

  // The site still works. A traversal fix that breaks serving is not a fix.
  const schema = await rawRequest('/schema/v2.json');
  if (schema.startsWith('HTTP/1.1 200') && schema.includes('"$id"') && schema.includes('contextpassport.com/schema/v2.json')) {
    pass('serves /schema/v2.json');
  } else {
    fail('did not serve /schema/v2.json');
  }

  const chain = await rawRequest('/schema/v2-chain.json');
  if (chain.startsWith('HTTP/1.1 200') && chain.includes('"$id"') && chain.includes('contextpassport.com/schema/v2-chain.json')) {
    pass('serves /schema/v2-chain.json');
  } else {
    fail('did not serve /schema/v2-chain.json');
  }

  const index = await rawRequest('/');
  if (index.startsWith('HTTP/1.1 200') && index.includes('text/html')) {
    pass('serves / as html');
  } else {
    fail('did not serve / as html');
  }

  const unknown = await rawRequest('/no-such-page');
  if (unknown.startsWith('HTTP/1.1 200') && unknown.includes('text/html')) {
    pass('unknown path falls back to index.html');
  } else {
    fail('unknown path did not fall back to index.html');
  }

  // Nothing outside the site root is reachable, however the path is spelled.
  const escapes = [
    ['/../../../etc/passwd', 'root:x:0:0'],
    ['/../../etc/passwd', 'root:x:0:0'],
    ['/./../../etc/passwd', 'root:x:0:0'],
    ['/%2e%2e/%2e%2e/%2e%2e/etc/passwd', 'root:x:0:0'],
    ['/..%2f..%2f..%2fetc%2fpasswd', 'root:x:0:0'],
    ['/subdir/../../../etc/passwd', 'root:x:0:0'],
  ];

  for (const [target, leak] of escapes) {
    const body = await rawRequest(target);
    if (body.includes(leak)) {
      fail(`escaped the site root: ${target}`);
    } else {
      pass(`contained: ${target}`);
    }
  }

  // .git sits inside the root, so containment alone does not cover it. The
  // Dockerfile is COPY . ., which means the deployed image carries the whole
  // history unless something refuses to serve it.
  const gitPaths = [
    ['/.git/config', 'repositoryformatversion'],
    ['/.git/HEAD', 'ref:'],
    ['/foo/../.git/config', 'repositoryformatversion'],
    ['/%2egit/config', 'repositoryformatversion'],
  ];

  for (const [target, leak] of gitPaths) {
    const body = await rawRequest(target);
    if (body.includes(leak)) {
      fail(`served the git directory: ${target}`);
    } else {
      pass(`refused: ${target}`);
    }
  }

  // The specification's examples reference /.well-known paths, so the rule
  // above has to be narrower than "reject anything beginning with a dot".
  // There is no .well-known directory yet; what matters is that the request
  // reaches the normal miss path rather than being rejected out of hand.
  const wellKnown = await rawRequest('/.well-known/did.json');
  if (wellKnown.startsWith('HTTP/1.1 200') && wellKnown.includes('text/html')) {
    pass('/.well-known is not blanket-denied');
  } else {
    fail('/.well-known was denied, which would block a documented path');
  }

  // A file that exists in the repo but is not part of the published site is
  // still inside the root, so this is not a traversal case. It is here to
  // record that containment is the property being tested, not an allow-list.
  const inRoot = await rawRequest('/package.json');
  if (inRoot.startsWith('HTTP/1.1 200')) {
    pass('files inside the root remain reachable');
  } else {
    fail('a file inside the root became unreachable');
  }

  if (failures === 0) {
    console.log('\n  server.js serves the site root and nothing outside it.\n');
  } else {
    console.error(`\n  ${failures} check(s) failed.\n`);
  }
} finally {
  server.kill();
}

process.exit(failures === 0 ? 0 : 1);
