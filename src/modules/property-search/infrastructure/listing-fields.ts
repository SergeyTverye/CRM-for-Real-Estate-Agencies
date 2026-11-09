
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
export const listingText = (...values: unknown[]): string | null => {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.replace(/\s+/gu, " ").trim();
  return null;
};
export function listingFields(value: unknown) {
  const root = record(value), normalized = record(root.normalized), raw = record(root.raw);
  const candidates = [root, normalized, raw, record(raw.normalized)];
  const address = candidates.map(r => {
    const a = record(r.address), location = record(r.location);
    return listingText(r.address, r.addressText, a.formatted, a.fullAddress, a.streetAddress,
      location.address, location.addressText);
  });
  return {
    address: listingText(...address),
    district: listingText(...candidates.flatMap(r => [r.district, record(r.location).district])),
    city: listingText(...candidates.flatMap(r => [r.city, record(r.location).city])),
    title: listingText(...candidates.flatMap(r => [r.title, r.headline, r.name])),
  };
}
