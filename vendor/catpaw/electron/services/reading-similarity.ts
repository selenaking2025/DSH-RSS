const stop = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'how', 'are', 'was', 'has', 'have', 'will', 'new', 'about', 'into']);
function terms(text: string) {
  const normalized = text.toLowerCase();
  const words = normalized.match(/[a-z0-9][a-z0-9.-]{2,}/g) ?? [];
  const chinese = normalized.match(/[\u3400-\u9fff]+/g) ?? [];
  return new Set([...words.filter((word) => !stop.has(word)), ...chinese.flatMap((word) => Array.from({ length: Math.max(0, word.length - 1) }, (_, i) => word.slice(i, i + 2)))]);
}
export function readingSimilarity(left: string, right: string) {
  const a = terms(left), b = terms(right); if (!a.size || !b.size) return 0;
  let shared = 0; for (const term of a) if (b.has(term)) shared++;
  return shared / Math.sqrt(a.size * b.size);
}
