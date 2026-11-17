export const MAX_BOOK_TAGS = 8
export const MAX_BOOK_TAG_LENGTH = 24

/** 接受数组或逗号分隔字符串，去空、去重、限量并截断。 */
export function normalizeBookTags(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,，]/)
      : []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const tag = value.trim().replace(/\s+/g, ' ').slice(0, MAX_BOOK_TAG_LENGTH)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
    if (tags.length >= MAX_BOOK_TAGS) break
  }
  return tags
}
