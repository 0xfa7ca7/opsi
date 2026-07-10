const DEVICES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
export function safeFilename(remoteName: string | undefined, fallback = "download"): string {
  const leaf = (remoteName ?? "").replace(/\\/gu, "/").split("/").at(-1) ?? "";
  let value = leaf
    .normalize("NFC")
    .replace(/\p{Cc}/gu, "-")
    .replace(/[<>:"/\\|?*]/gu, "-")
    .replace(/[. ]+$/gu, "")
    .trim();
  if (value === "" || value === "." || value === ".." || DEVICES.test(value)) value = fallback;
  const encoded = Buffer.from(value);
  if (encoded.length > 180) {
    value = encoded
      .subarray(0, 180)
      .toString("utf8")
      .replace(/\uFFFD+$/gu, "");
  }
  return value || fallback;
}
export function filenameFromUrl(url: string | URL, fallback = "download"): string {
  const path = new URL(url).pathname;
  let leaf = path.split("/").at(-1) ?? "";
  try {
    leaf = decodeURIComponent(leaf);
  } catch {
    leaf = "";
  }
  return safeFilename(leaf, fallback);
}
