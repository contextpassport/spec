#!/usr/bin/env python3
"""
Runs docs/quickstart.md and checks it still says what actually happens.

The quickstart claims specific results: that the parent hash matches, that the
chain verifies, that editing a record breaks verification, and that undoing the
edit restores it. Those claims are the entire point of the document, so CI
executes the code blocks and asserts the output rather than trusting prose that
nobody has run since it was written.

    python tools/check-quickstart.py
"""

from __future__ import annotations

import io
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC = ROOT / "docs" / "quickstart.md"

# The boolean lines the document tells the reader to expect, in order:
#   parent_hash linkage, verify, verify after tampering, verify after undo.
EXPECTED_BOOLS = ["True", "True", "False", "True"]

blocks = re.findall(r"```python\n(.*?)```", io.open(DOC, encoding="utf-8").read(), re.S)
if not blocks:
    sys.exit("No python blocks found in docs/quickstart.md")

script = "\n".join(blocks)

with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "quickstart.py"
    path.write_text(script, encoding="utf-8")
    result = subprocess.run([sys.executable, str(path)], capture_output=True, text=True)

# A missing context_passport surfaces here rather than as a launch failure:
# the interpreter starts fine and the child exits non-zero when it cannot
# import the SDK. Blaming the document for that is wrong and sends the reader
# off to debug prose that is not broken. The TypeScript checker separates the
# same two cases, and this one read as a document failure until it did too.
if result.returncode != 0:
    missing = re.search(r"ModuleNotFoundError: No module named '([^']+)'", result.stderr)
    if missing:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        sys.exit(
            f"Cannot import '{missing.group(1)}', so the quickstart was never run. "
            f"This is a missing dependency here, not a problem with the document.\n"
            f"Run: pip install context-passport"
        )
    print(result.stdout)
    print(result.stderr, file=sys.stderr)
    sys.exit("docs/quickstart.md does not run as written")

lines = [l.strip() for l in result.stdout.splitlines() if l.strip()]
bools = [l for l in lines if l in ("True", "False")]

if bools != EXPECTED_BOOLS:
    print("Output was:\n  " + "\n  ".join(lines))
    sys.exit(
        f"docs/quickstart.md runs, but its results changed.\n"
        f"  expected booleans: {EXPECTED_BOOLS}\n"
        f"  actual:            {bools}"
    )

# The first two lines should be an id and a payload hash, as the doc shows.
if not lines[0].startswith("ctx_"):
    sys.exit(f"Expected the first printed line to be a passport id, got: {lines[0]!r}")
if not lines[1].startswith("sha256:"):
    sys.exit(f"Expected the second printed line to be a payload hash, got: {lines[1]!r}")

print(f"docs/quickstart.md runs as written: {len(blocks)} blocks, results as documented.")
