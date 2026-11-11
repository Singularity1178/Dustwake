// Developer tool: renders the surface rune as the game draws it, left alone in each of its states (dormant, linked,
// severed) and refusing someone (E on it while the circle below is broken), to .preview/rune/*.png, through the real
// host on a pixel canvas (no type check, no browser). See tests/support/runeSnapshot.ts.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
execFileSync("node_modules/.bin/esbuild", ["tests/support/runeSnapshot.ts", "--bundle", "--platform=node", "--format=cjs", "--outfile=.preview/runeRun.cjs", "--log-level=warning"], { stdio: "inherit" });
const run = createRequire(import.meta.url)("../.preview/runeRun.cjs");
run.run(".preview/rune");
