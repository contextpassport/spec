#!/usr/bin/env node
/**
 * Runs docs/quickstart-typescript.md and checks it still says what actually happens.
 *
 * Twin of tools/check-quickstart.py: extracts the typescript blocks from the
 * document, runs them as one script via tsx, and asserts the documented results
 * (the chain verifies; editing a record breaks it; undoing restores it) rather
 * than trusting prose nobody has run since it was written.
 *
 * Requires @contextpassport/core@^2 and tsx (CI installs both with --no-save):
 *
 *     node tools/check-quickstart-ts.mjs
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = join(ROOT, "docs", "quickstart-typescript.md");

// The boolean lines the document tells the reader to expect, in order:
//   parent_hash linkage, verify, verify after tampering, verify after undo.
const EXPECTED_BOOLS = ["true", "true", "false", "true"];

const blocks = [...readFileSync(DOC, "utf8").replace(/\r\n/g, "\n").matchAll(/```typescript\n(.*?)```/gs)].map((m) => m[1]);
if (blocks.length === 0) {
  console.error("No typescript blocks found in docs/quickstart-typescript.md");
  process.exit(1);
}

// The extracted script must live inside the repo tree so that ESM resolution
// finds this repo's node_modules (@contextpassport/core) regardless of cwd,
// and must be .mts because this repo's package.json is not type: module.
const dir = mkdtempSync(join(ROOT, ".tmp-qsts-"));
let result;
try {
  const script = join(dir, "quickstart.mts");
  writeFileSync(script, blocks.join("\n"), "utf8");
  result = spawnSync(process.execPath, ["--import", "tsx", script], {
    cwd: ROOT,
    encoding: "utf8",
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (result.error) {
  console.error(String(result.error));
  console.error("Is tsx installed? Run npm install, or: npm install --no-save @contextpassport/core@^2.0.0 tsx");
  process.exit(1);
}
// A missing tsx or SDK surfaces here rather than as result.error: node itself
// launches fine and the child exits non-zero when it cannot resolve the
// import. Blaming the document for that is wrong and sends the reader off to
// debug prose that is not broken.
if (result.status !== 0) {
  const stderr = result.stderr ?? "";
  const missing = stderr.match(/Cannot find package '([^']+)'/);
  if (missing) {
    console.error(stderr);
    console.error(
      `Cannot resolve '${missing[1]}', so the quickstart was never run. This is a ` +
        `missing dependency here, not a problem with the document.`,
    );
    console.error("Run npm install, or: npm install --no-save @contextpassport/core@^2.0.0 tsx");
    process.exit(1);
  }
  console.log(result.stdout);
  console.error(stderr);
  console.error("docs/quickstart-typescript.md does not run as written");
  process.exit(1);
}

const lines = result.stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

// Exactly six lines of output: id, payload hash, then the four booleans.
// Anything else means the document's code no longer prints what it claims.
if (lines.length !== EXPECTED_BOOLS.length + 2) {
  console.error("Output was:\n  " + lines.join("\n  "));
  console.error(
    `docs/quickstart-typescript.md runs, but printed ${lines.length} lines ` +
      `(expected ${EXPECTED_BOOLS.length + 2})`,
  );
  process.exit(1);
}

const bools = lines.filter((l) => l === "true" || l === "false");
if (bools.join() !== EXPECTED_BOOLS.join()) {
  console.error("Output was:\n  " + lines.join("\n  "));
  console.error(
    "docs/quickstart-typescript.md runs, but its results changed.\n" +
      `  expected booleans: ${EXPECTED_BOOLS.join(", ")}\n` +
      `  actual:            ${bools.join(", ")}`,
  );
  process.exit(1);
}

if (!lines[0].startsWith("ctx_")) {
  console.error(`Expected the first printed line to be a passport id, got: ${lines[0]}`);
  process.exit(1);
}
if (!lines[1].startsWith("sha256:")) {
  console.error(`Expected the second printed line to be a payload hash, got: ${lines[1]}`);
  process.exit(1);
}

console.log(
  `docs/quickstart-typescript.md runs as written: ${blocks.length} blocks, results as documented.`,
);
