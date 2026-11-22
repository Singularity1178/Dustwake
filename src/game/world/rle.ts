// Run-length coding for tile grids (pure). An area with large edits, and any area
// whose spec keeps its full grid (player-built), saves its tiles this way instead
// of as a list of changed cells (world/save.ts). Format: base64 of a byte string,
// one run after another: the value byte, then the run length as an unsigned
// LEB128 varint. A 96x72 grid of mostly-floor compresses to a few hundred bytes.

export function rleEncode(a: ArrayLike<number>): string {
  const out: number[] = [];
  for (let i = 0; i < a.length;) {
    const v = a[i];
    let n = 1;
    while (i + n < a.length && a[i + n] === v) n++;
    out.push(v & 255);
    let r = n;
    while (r >= 128) { out.push((r & 127) | 128); r = Math.floor(r / 128); }
    out.push(r);
    i += n;
  }
  let s = "";
  for (let i = 0; i < out.length; i += 4096) s += String.fromCharCode(...out.slice(i, i + 4096));
  return btoa(s);
}

/** Decode; `n` (if given) is the expected cell count, and a mismatch throws (a damaged save). */
export function rleDecode(s: string, n?: number): Uint8Array {
  const bin = atob(s);
  const vals: number[] = [];
  for (let i = 0; i < bin.length;) {
    const v = bin.charCodeAt(i++);
    let run = 0, mul = 1, b = 0;
    do {
      if (i >= bin.length) throw new Error("rle: truncated run");
      b = bin.charCodeAt(i++);
      run += (b & 127) * mul;
      mul *= 128;
    } while (b & 128);
    for (let k = 0; k < run; k++) vals.push(v);
  }
  if (n !== undefined && vals.length !== n) throw new Error(`rle: ${vals.length} cells, expected ${n}`);
  return Uint8Array.from(vals);
}
