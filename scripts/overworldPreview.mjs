// Developer tool: renders the overworld (the one continuous surface: Westwake, the old road, the ruins) and the
// places where its sites meet to .preview/overworld/*.png (no type check, no browser).
// See tests/support/overworldSnapshot.ts and docs/world/overworld.md.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
execFileSync("node_modules/.bin/esbuild", ["tests/support/overworldSnapshot.ts", "--bundle", "--platform=node", "--format=cjs", "--outfile=.preview/overworldRun.cjs", "--log-level=warning"], { stdio: "inherit" });
const run = createRequire(import.meta.url)("../.preview/overworldRun.cjs");
run.run(".preview/overworld");
