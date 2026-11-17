import path from 'node:path'

const COMIC_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.avif'
])

export function isComicImagePath(name: string): boolean {
  const lower = name.toLowerCase()
  if (!lower) return false
  if (lower.startsWith('__macosx/') || lower.split('/').some((part) => part.startsWith('.'))) {
    return false
  }
  return COMIC_IMAGE_EXTENSIONS.has(path.posix.extname(lower))
}

/** 按文件名自然排序，让 2.jpg 排在 10.jpg 前面。 */
export function sortComicImages<T extends { name: string }>(items: readonly T[]): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return [...items].sort((left, right) => collator.compare(left.name, right.name))
}
