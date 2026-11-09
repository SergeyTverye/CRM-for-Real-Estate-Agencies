import { z } from "zod";
import { AiError } from "./contracts";


export function decodeAiJson<T>(schema: z.ZodType<T>, text: string): T {
  const candidates: string[] = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (start < 0) {
      if (c === "{") { start = i; depth = 1; quoted = false; escaped = false; }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) { candidates.push(text.slice(start, i + 1)); start = -1; }
  }
  
  if (candidates.length !== 1 || start !== -1) throw new AiError("AI_INVALID_JSON_RESULT");
  try { return schema.parse(JSON.parse(candidates[0]!)); }
  catch { throw new AiError("AI_INVALID_JSON_RESULT"); }
}
