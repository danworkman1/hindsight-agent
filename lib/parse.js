// lib/parse.js
// Shared JSON extraction utility. Models sometimes wrap JSON in prose or
// markdown fences despite instructions — this finds the first valid {...} block.

/**
 * Find the first valid JSON object in a string.
 * Returns the parsed object, or null if none found.
 */
export function extractJsonObject(text) {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // try a smaller slice
      }
    }
  }
  return null;
}
