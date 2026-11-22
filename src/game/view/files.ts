// Files in the browser (export / import of saves). DOM only, and only touched when
// called, so modules that import this still load in Node.

/** Offer `text` as a download called `name`. */
export function downloadText(name: string, text: string): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") return false;
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

/** Ask the player for a text file; resolves with its contents. */
export function pickTextFile(accept = ".json,application/json,text/plain"): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") { reject(new Error("no document")); return; }
    const input = document.createElement("input");
    input.type = "file"; input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) { reject(new Error("no file chosen")); return; }
      f.text().then(resolve, reject);
    };
    input.click();
  });
}
