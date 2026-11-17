import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import iconv from 'iconv-lite'
import { afterEach, describe, expect, it } from 'vitest'
import { buildTxtToc, parseTxtContent } from '../../src/main/content'
import type { NormalizedChapter } from '../../src/shared/types'

const temporaryFiles: string[] = []

afterEach(async () => {
  await Promise.all(temporaryFiles.splice(0).map((file) => fs.rm(file, { force: true })))
})

describe('TXT parsing', () => {
  it('splits large text into searchable chapters with stable offsets', async () => {
    const filePath = path.join(os.tmpdir(), `readex-${Date.now()}.txt`)
    temporaryFiles.push(filePath)
    await fs.writeFile(filePath, `${'段落一。\n'.repeat(100)}\n${'段落二。\n'.repeat(100)}`, 'utf8')

    const content = await parseTxtContent(filePath)

    expect(content.format).toBe('txt')
    expect(content.chapters?.length).toBeGreaterThan(0)
    expect(content.toc[0].label).toBe('第 1 节')
    expect(content.chapters?.[0].text).toContain('段落一')
  })

  it('decodes GB18030 Chinese text', async () => {
    const filePath = path.join(os.tmpdir(), `readex-gb-${Date.now()}.txt`)
    temporaryFiles.push(filePath)
    await fs.writeFile(filePath, iconv.encode('中文电子书\n第二章', 'gb18030'))

    const content = await parseTxtContent(filePath)

    expect(content.chapters?.[0].text).toContain('中文电子书')
    expect(content.chapters?.[0].text).toContain('第二章')
  })
})

describe('TXT table of contents', () => {
  it('maps detected chapter headings back to their fixed-size chunks', () => {
    const chapters: NormalizedChapter[] = [
      {
        id: 'txt-1',
        label: '第 1 节',
        html: '',
        text: `前言正文。\n第一章 开端\n${'内容。\n'.repeat(20)}`
      },
      {
        id: 'txt-2',
        label: '第 2 节',
        html: '',
        text: `第二章 转折\n${'内容。\n'.repeat(20)}`
      }
    ]
    const text = chapters.map((chapter) => chapter.text).join('')
    const toc = buildTxtToc(text, chapters)

    expect(toc.map((item) => item.label)).toEqual(['第一章 开端', '第二章 转折'])
    expect(toc[0].chapterId).toBe('txt-1')
    expect(toc[0].start).toBe(text.indexOf('第一章 开端'))
    expect(toc[1].chapterId).toBe('txt-2')
    expect(toc[1].start).toBe(0)
  })

  it('falls back to fixed sections when the text has no headings', () => {
    const chapters: NormalizedChapter[] = [
      { id: 'txt-1', label: '第 1 节', html: '', text: '只有一段普通文字。' }
    ]
    const toc = buildTxtToc(chapters[0].text, chapters)

    expect(toc).toEqual([{ id: 'txt-1', label: '第 1 节' }])
  })
})
