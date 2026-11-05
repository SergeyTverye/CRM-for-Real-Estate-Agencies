import { describe, expect, it } from "vitest";
import { canonicalListingUrl, stableListingId } from "@/modules/property-search/application/listing-identity";

describe("stable external listing identity", () => {
  it("normalizes host, tracking, query ordering, trailing slash and fragment", () => {
    expect(canonicalListingUrl("https://CIAN.ru:443/offer/?unit=2&id=1&utm_source=test#photos"))
      .toBe("https://cian.ru/offer?id=1&unit=2");
    expect(stableListingId(null, "https://cian.ru/offer/?b=2&a=1&utm_source=test#photo"))
      .toBe(stableListingId(null, "https://cian.ru/offer?a=1&b=2"));
  });
  it("keeps identity-bearing parameters and original source IDs", () => {
    expect(stableListingId(null, "https://cian.ru/?id=1")).not.toBe(stableListingId(null, "https://cian.ru/?id=2"));
    expect(stableListingId("native-id", "")).toBe("native-id");
  });
  it.each(["", "broken", "file:///private", "https://user:password@cian.ru/1"])("leaves unavailable URL for manual review: %s", url => {
    expect(stableListingId(null, url)).toBeNull();
  });
});
