// Developer tool: names what an art change moved, sprite by sprite and baked tile by baked tile (pixels, on the
// pixel canvas; no type check, no browser). Use it before updating a golden hash in tests/art.test.ts or
// tests/artRegistry.test.ts, so the comment beside the golden can say exactly what differs. See tests/support/artDiff.ts.
//
//   node scripts/artDiff.mjs save .preview/art-before.json     on the tree as it was (git stash, or before starting)
//   node scripts/artDiff.mjs diff .preview/art-before.json     after the change
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
execFileSync("node_modules/.bin/esbuild", ["tests/support/artDiff.ts", "--bundle", "--platform=node", "--format=cjs", "--outfile=.preview/artDiffRun.cjs", "--log-level=warning"], { stdio: "inherit" });
const run = createRequire(import.meta.url)("../.preview/artDiffRun.cjs");
process.exitCode = run.main(process.argv.slice(2));
