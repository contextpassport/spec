const http = require('http');
const fs   = require('fs');
const path = require('path');
const port = process.env.PORT || 3000;

// Every path served is resolved against this and then checked to be inside it.
// realpath so that the comparison holds if the checkout itself sits behind a
// symlink, which would otherwise make every request look like an escape.
const ROOT = fs.realpathSync(__dirname);

/**
 * Resolve a request path to a file inside ROOT, or null if it points outside.
 *
 * req.url is the raw request target and Node does not normalize it, so a
 * client writing to the socket directly can send "GET /../../etc/passwd".
 * path.join would happily resolve that to a real file outside the site root,
 * which is an arbitrary file read. Browsers collapse the dot segments before
 * sending, which is why this does not show up in ordinary use.
 *
 * Decoding happens before the containment check, otherwise %2e%2e walks up
 * just as well as "..".
 */
function resolveWithinRoot(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;   // malformed percent-encoding
  }
  if (decoded.includes('\0')) return null;

  // The leading "." keeps an absolute decoded path from escaping ROOT: resolve
  // would otherwise take "/etc/passwd" as the final, absolute answer.
  const candidate = path.resolve(ROOT, '.' + decoded);
  if (candidate !== ROOT && !candidate.startsWith(ROOT + path.sep)) return null;
  return candidate;
}

const mime = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.md':   'text/markdown',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const tryServe = (candidate, onMiss) => {
    fs.stat(candidate, (statErr, stats) => {
      if (statErr) { onMiss(); return; }
      if (stats.isDirectory()) {
        // Directory request: try <dir>/index.html. Safe to join without a
        // second check, since candidate is already inside ROOT and the
        // appended segment is a constant.
        const indexCandidate = path.join(candidate, 'index.html');
        fs.readFile(indexCandidate, (idxErr, idxData) => {
          if (idxErr) { onMiss(); return; }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(idxData);
        });
        return;
      }
      fs.readFile(candidate, (readErr, data) => {
        if (readErr) { onMiss(); return; }
        const ext = path.extname(candidate);
        res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
        res.end(data);
      });
    });
  };

  const serveIndex = () => {
    // Fallback to root index.html for SPA-style routing of unknown paths
    fs.readFile(path.join(ROOT, 'index.html'), (err2, data2) => {
      if (err2) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data2);
    });
  };

  const filePath = resolveWithinRoot(urlPath);

  // A path pointing outside the root is treated as a miss rather than as its
  // own status code. It gets the same response an unknown path gets, so the
  // reply says nothing about what does or does not exist out there.
  if (filePath === null) { serveIndex(); return; }

  tryServe(filePath, serveIndex);
}).listen(port, () => {
  console.log(`Context Passport running on port ${port}`);
});
