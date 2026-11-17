import { describe, expect, it } from 'vitest'
import { searchChapterText } from '../../src/main/fulltext'
import type { BookRecord } from '../../src/shared/types'

const baseBook: BookRecord = {
  id: 'book-1',
  title: '测试书',
  author: '作者',
  format: 'txt',
  fileName: 'book.txt',
  originalPath: 'D:/book.txt',
  importedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  size: 100,
  sha256: 'abc',
  progress: 0
}

describe('full text search', () => {
  it('builds text-offset locators for TXT results', () => {
    const results = searchChapterText(
      baseBook,
      [
        { id: 'txt-1', label: '第一章', text: '前面 关键词 后面 关键词' },
        { id: 'txt-2', label: '第二章', text: '没有命中' }
      ],
      '关键词'
    )

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({
      bookId: 'book-1',
      bookTitle: '测试书',
      title: '第一章',
      locator: { type: 'text-offset', chapterId: 'txt-1', start: 3, end: 6 }
    })
    expect(results[0].excerpt).toContain('关键词')
  })

  it('uses chapter hrefs for EPUB results', () => {
    const epubBook = { ...baseBook, format: 'epub' as const }
    const results = searchChapterText(
      epubBook,
      [{ id: '0', label: 'Chapter 1', href: 'text/ch1.xhtml', text: 'alpha beta gamma' }],
      'beta'
    )

    expect(results).toHaveLength(1)
    expect(results[0].locator).toMatchObject({
      type: 'epub-cfi',
      value: 'text/ch1.xhtml',
      chapterHref: 'text/ch1.xhtml'
    })
  })

  it('honours per-book result limits', () => {
    const results = searchChapterText(
      baseBook,
      [{ id: 'txt-1', label: '第一章', text: 'hit hit hit hit' }],
      'hit',
      2
    )
    expect(results).toHaveLength(2)
  })
})
