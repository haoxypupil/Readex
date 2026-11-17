import { describe, expect, it } from 'vitest'
import { annotationsToMarkdown, createAnnotationUpdate } from '../../src/renderer/src/lib/notes'
import type { Annotation, BookRecord } from '../../src/shared/types'

describe('Markdown note export', () => {
  it('includes book metadata, quotes and comments', () => {
    const book: BookRecord = {
      id: 'book-1',
      title: '测试书籍',
      author: '作者',
      format: 'epub',
      fileName: 'book.epub',
      originalPath: 'D:/book.epub',
      importedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      size: 100,
      sha256: 'abc',
      progress: 0.2
    }
    const annotations: Annotation[] = [
      {
        id: 'a1',
        bookId: book.id,
        type: 'comment',
        color: 'blue',
        text: '这是摘录',
        note: '这是想法',
        locator: {
          type: 'epub-cfi',
          value: 'epubcfi(/6/2)',
          excerpt: '这是摘录'
        },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]

    const markdown = annotationsToMarkdown(book, annotations)

    expect(markdown).toContain('# 测试书籍 - 阅读笔记')
    expect(markdown).toContain('> 这是摘录')
    expect(markdown).toContain('这是想法')
  })

  it('labels bookmarks in exported notes', () => {
    const book = {
      id: 'book-2',
      title: '书签测试',
      author: '',
      format: 'epub' as const,
      fileName: 'book.epub',
      originalPath: 'D:/book.epub',
      importedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      size: 100,
      sha256: 'def',
      progress: 0
    }
    const markdown = annotationsToMarkdown(book, [
      {
        id: 'bookmark-1',
        bookId: book.id,
        type: 'bookmark',
        color: 'blue',
        text: '书签位置',
        note: '',
        locator: { type: 'epub-cfi', value: 'epubcfi(/6/4)', excerpt: '书签位置' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ])

    expect(markdown).toContain('## 书签')
    expect(markdown).toContain('> 书签位置')
  })
})

describe('annotation revision history', () => {
  const base: Annotation = {
    id: 'a1',
    bookId: 'book-1',
    type: 'comment',
    color: 'blue',
    text: '原文',
    note: '旧想法',
    locator: { type: 'epub-cfi', value: 'epubcfi(/6/2)' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  it('stores the previous note when content changes', () => {
    const updated = createAnnotationUpdate(base, 'green', '新想法', '2026-01-02T00:00:00.000Z')

    expect(updated.note).toBe('新想法')
    expect(updated.color).toBe('green')
    expect(updated.revisions?.[0]).toEqual({
      note: '旧想法',
      color: 'blue',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
  })

  it('does not add a revision when nothing changed', () => {
    const updated = createAnnotationUpdate(base, base.color, base.note, '2026-01-02T00:00:00.000Z')

    expect(updated.revisions).toBeUndefined()
    expect(updated.updatedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('keeps at most ten revisions', () => {
    let current = base
    for (let index = 0; index < 12; index += 1) {
      current = createAnnotationUpdate(
        current,
        'blue',
        `版本 ${index}`,
        `2026-01-02T00:00:${String(index).padStart(2, '0')}.000Z`
      )
    }
    expect(current.revisions).toHaveLength(10)
  })
})

describe('annotation tags', () => {
  const book: BookRecord = {
    id: 'book-1',
    title: '测试书籍',
    author: '作者',
    format: 'epub',
    fileName: 'book.epub',
    originalPath: 'D:/book.epub',
    importedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    size: 100,
    sha256: 'abc',
    progress: 0
  }
  const base: Annotation = {
    id: 'a1',
    bookId: book.id,
    type: 'comment',
    color: 'blue',
    text: '原文',
    note: '想法',
    locator: { type: 'epub-cfi', value: 'epubcfi(/6/2)' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  it('normalizes tags and preserves them on later updates', () => {
    const updated = createAnnotationUpdate(
      base,
      base.color,
      base.note,
      '2026-01-02T00:00:00.000Z',
      ['金句', ' 待复习 ', '金句']
    )
    expect(updated.tags).toEqual(['金句', '待复习'])
    expect(updated.revisions).toBeUndefined()

    const kept = createAnnotationUpdate(
      updated,
      base.color,
      base.note,
      '2026-01-03T00:00:00.000Z'
    )
    expect(kept.tags).toEqual(['金句', '待复习'])
  })

  it('does not add a tags key when no tags exist', () => {
    const updated = createAnnotationUpdate(base, base.color, base.note, '2026-01-02T00:00:00.000Z')
    expect(updated.tags).toBeUndefined()
  })

  it('exports tags in markdown', () => {
    const markdown = annotationsToMarkdown(book, [
      { ...base, tags: ['金句', '待复习'] }
    ])
    expect(markdown).toContain('标签：金句、待复习')
  })
})
