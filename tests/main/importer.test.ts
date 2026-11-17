import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  cleanBookTitle,
  decodePdfString,
  extractPdfMetadata,
  isPlausiblePdfMetadataTitle,
  validateFileHeader
} from '../../src/main/importer'

describe('import validation', () => {
  it('accepts supported file signatures', () => {
    expect(() => validateFileHeader('pdf', Buffer.from('%PDF-1.7\n'))).not.toThrow()
    expect(() => validateFileHeader('epub', Buffer.from([0x50, 0x4b, 0x03, 0x04]))).not.toThrow()
    expect(() =>
      validateFileHeader('mobi', Buffer.concat([Buffer.alloc(60), Buffer.from('BOOKMOBI')]))
    ).not.toThrow()
    expect(() =>
      validateFileHeader('azw3', Buffer.concat([Buffer.alloc(60), Buffer.from('BOOKMOBI')]))
    ).not.toThrow()
    expect(() => validateFileHeader('txt', Buffer.from('第一章\n你好'))).not.toThrow()
    expect(() => validateFileHeader('cbz', Buffer.from([0x50, 0x4b, 0x03, 0x04]))).not.toThrow()
  })

  it('rejects mismatched or binary files', () => {
    expect(() => validateFileHeader('pdf', Buffer.from('not pdf'))).toThrow(/PDF/)
    expect(() => validateFileHeader('epub', Buffer.from('not zip'))).toThrow(/EPUB/)
    expect(() => validateFileHeader('cbz', Buffer.from('not zip'))).toThrow(/CBZ/)
    expect(() => validateFileHeader('mobi', Buffer.from('not mobi'))).toThrow(/MOBI/)
    expect(() => validateFileHeader('azw3', Buffer.from('not azw3'))).toThrow(/AZW3/)
    expect(() => validateFileHeader('txt', Buffer.from([1, 0, 0, 0, 2]))).toThrow(/二进制/)
  })

  it('creates a readable title from a file name', () => {
    expect(cleanBookTitle('深入理解计算机系统_第三版.epub')).toBe('深入理解计算机系统 第三版')
  })

  it('decodes UTF-16BE PDF metadata and rejects damaged titles', () => {
    const encoded = Buffer.from('日语N3语法最全总结（推荐）', 'utf16le')
    const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(encoded).swap16()])
    expect(decodePdfString(utf16be)).toBe('日语N3语法最全总结（推荐）')

    const damaged = Buffer.from(
      '最全日语乜瑾Ꞌ\uED6C할㭾폿屢推荐｜琀开㄀⸀琀椀\uFFFD',
      'utf16le'
    )
    expect(isPlausiblePdfMetadataTitle(damaged.toString('utf16le'))).toBe(false)
  })

  const damagedPdf = 'D:\\PyProject\\Haoxiaoyao\\Readex\\日语N3语法最全总结（推荐）.pdf'
  it.skipIf(!existsSync(damagedPdf))(
    'falls back to the filename for a real damaged PDF title',
    async () => {
      const metadata = await extractPdfMetadata(
        damagedPdf,
        '日语N3语法最全总结（推荐）.pdf'
      )
      expect(metadata.title).toBe('日语N3语法最全总结（推荐）')
    }
  )
})
