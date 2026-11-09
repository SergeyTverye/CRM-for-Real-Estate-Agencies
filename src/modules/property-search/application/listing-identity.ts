import { createHash } from "node:crypto";


export function canonicalListingUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|gclid|fbclid|yclid)$/iu.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

export function stableListingId(id: string | null, url: string): string | null {
  if (id?.trim()) return id;
  const canonical = canonicalListingUrl(url);
  return canonical ? `url:${createHash("sha256").update(canonical).digest("hex")}` : null;
}
