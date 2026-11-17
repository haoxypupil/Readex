import { describe, expect, it } from 'vitest'
import { parseByteRange } from '../../src/main/bookProtocol'
import {
  getBookResourceId,
  getBookResourceUrl,
  getComicPageRequest,
  getComicPageUrl
} from '../../src/shared/bookResource'

describe('book resource URLs', () => {
  it('round-trips a book id through the custom protocol', () => {
    const url = getBookResourceUrl('abc 123', 'epub')

    expect(url).toBe('readex://book/abc%20123/source.epub')
    expect(getBookResourceId(url)).toBe('abc 123')
  })

  it('rejects unrelated protocols and nested paths', () => {
    expect(getBookResourceId('https://book/example')).toBeNull()
    expect(getBookResourceId('readex://book/a/b')).toBeNull()
    expect(getBookResourceId('readex://book/a/source.bin')).toBeNull()
  })

  it('round-trips comic page requests', () => {
    const url = getComicPageUrl('abc 123', 7)
    expect(url).toBe('readex://comic/abc%20123/7')
    expect(getComicPageRequest(url)).toEqual({ bookId: 'abc 123', index: 7 })
    expect(getComicPageRequest('readex://comic/a/-1')).toBeNull()
    expect(getComicPageRequest('readex://comic/a/1/2')).toBeNull()
  })
})

describe('byte range parsing', () => {
  it('supports full and closed ranges', () => {
    expect(parseByteRange(null, 100)).toEqual({ kind: 'none' })
    expect(parseByteRange('bytes=10-19', 100)).toEqual({
      kind: 'range',
      start: 10,
      end: 19
    })
    expect(parseByteRange('bytes=75-', 100)).toEqual({
      kind: 'range',
      start: 75,
      end: 99
    })
  })

  it('supports suffix ranges and clamps the end', () => {
    expect(parseByteRange('bytes=-20', 100)).toEqual({
      kind: 'range',
      start: 80,
      end: 99
    })
    expect(parseByteRange('bytes=90-200', 100)).toEqual({
      kind: 'range',
      start: 90,
      end: 99
    })
  })

  it('rejects malformed and unsatisfiable ranges', () => {
    expect(parseByteRange('items=1-2', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseByteRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseByteRange('bytes=20-10', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseByteRange('bytes=0-0', 0)).toEqual({ kind: 'unsatisfiable' })
  })
})
