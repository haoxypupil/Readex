import type { BookFormat } from './types'

export const BOOK_RESOURCE_SCHEME = 'readex'

export function getBookResourceUrl(bookId: string, format: BookFormat): string {
  return `${BOOK_RESOURCE_SCHEME}://book/${encodeURIComponent(bookId)}/source.${format}`
}

export function getBookCoverUrl(bookId: string, version?: string): string {
  const base = `${BOOK_RESOURCE_SCHEME}://cover/${encodeURIComponent(bookId)}`
  return version ? `${base}?v=${encodeURIComponent(version)}` : base
}

export function getBookCoverId(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== `${BOOK_RESOURCE_SCHEME}:` || url.hostname !== 'cover') return null
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length !== 1) return null
    const bookId = decodeURIComponent(segments[0])
    return bookId || null
  } catch {
    return null
  }
}

export function getComicPageUrl(bookId: string, pageIndex: number): string {
  return `${BOOK_RESOURCE_SCHEME}://comic/${encodeURIComponent(bookId)}/${pageIndex}`
}

export function getComicPageRequest(
  value: string
): { bookId: string; index: number } | null {
  try {
    const url = new URL(value)
    if (url.protocol !== `${BOOK_RESOURCE_SCHEME}:` || url.hostname !== 'comic') return null
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length !== 2) return null
    const bookId = decodeURIComponent(segments[0])
    const index = Number(segments[1])
    if (!bookId || !Number.isInteger(index) || index < 0) return null
    return { bookId, index }
  } catch {
    return null
  }
}

export function getBookResourceId(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== `${BOOK_RESOURCE_SCHEME}:` || url.hostname !== 'book') return null

    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length !== 2 || !/^source\.(epub|mobi|azw3|pdf|txt|cbz)$/i.test(segments[1])) {
      return null
    }

    const bookId = decodeURIComponent(segments[0])
    return bookId ? bookId : null
  } catch {
    return null
  }
}
