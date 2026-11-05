import { safeRequest } from "@/shared/net/ssrf";
import { listingUrlRejection } from "../domain/listing-url";

/** A reachable page is still not proof of availability, price or ownership. No retries. */
export async function verifyListingPage(url: string): Promise<string> {
  if (listingUrlRejection(url)) return "UNSAFE_OR_NON_CARD_URL";
  try {
    const response = await safeRequest(url, { timeoutMs: 4000, maxBytes: 2_000_000, followRedirects: false });
    if ([401, 403, 429, 439].includes(response.status)) return `BLOCKED_HTTP_${response.status}`;
    if (response.status !== 200) return `HTTP_${response.status}`;
    if (!/text\/html/iu.test(String(response.headers["content-type"]))) return "NOT_HTML";
    if (/captcha|доступ ограничен|подтвердите.{0,40}человек|проверка браузера/iu.test(response.data.toString("utf8"))) return "POSSIBLE_ACCESS_CHALLENGE";
    return "HTML_REACHABLE_NEEDS_REVIEW";
  } catch { return "UNAVAILABLE_NEEDS_REVIEW"; }
}
