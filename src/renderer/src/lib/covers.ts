import { getBookCoverUrl } from '@shared/bookResource'
import type { BookRecord } from '@shared/types'

type CoverBook = Pick<BookRecord, 'id' | 'updatedAt' | 'coverFile' | 'coverDataUrl'>

/** 新数据优先使用 coverFile，迁移前的旧数据回退到内嵌 data URL。 */
export function bookCoverSrc(book: CoverBook): string | undefined {
  if (book.coverFile) return getBookCoverUrl(book.id, book.updatedAt)
  return book.coverDataUrl
}
