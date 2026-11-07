// Developer tool: renders worker golem sprite sheets to .preview/*.png (no type check, no browser).
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
execFileSync("node_modules/.bin/esbuild", ["tests/support/workerPreviewSheets.ts", "--bundle", "--platform=node", "--format=cjs", "--outfile=.preview/run.cjs", "--log-level=warning"], { stdio: "inherit" });
const run = createRequire(import.meta.url)("../.preview/run.cjs");
run.sheets(".preview");
