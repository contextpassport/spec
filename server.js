const http = require('http');
const fs   = require('fs');
const path = require('path');
const port = process.env.PORT || 3000;

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
        // Directory request: try <dir>/index.html
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

  const filePath = path.join(__dirname, urlPath);

  tryServe(filePath, () => {
    // Fallback to root index.html for SPA-style routing of unknown paths
    fs.readFile(path.join(__dirname, 'index.html'), (err2, data2) => {
      if (err2) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data2);
    });
  });
}).listen(port, () => {
  console.log(`Context Passport running on port ${port}`);
});
