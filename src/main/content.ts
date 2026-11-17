import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import type {
  BookContent,
  BookFormat,
  BookRecord,
  ComicPage,
  NormalizedChapter,
  SearchResult,
  TocItem
} from '../shared/types'
import { isComicImagePath, sortComicImages } from './comic'
import { ReadexStorage, readJson, writeJsonAtomic } from './storage'
import { decodeTextBuffer } from './text'

/** AZW3 是 KF8 容器，内容解析与定位复用 MOBI 管线，内容缓存也以 mobi 语义存储。 */
function contentFormatFor(book: BookRecord): BookFormat {
  return book.format === 'azw3' ? 'mobi' : book.format
}

export async function getBookContent(
  storage: ReadexStorage,
  book: BookRecord
): Promise<BookContent | null> {
  if (book.format === 'cbz') {
    return getComicContent(storage, book)
  }
  if (book.format === 'epub' || book.format === 'pdf') {
    return {
      format: book.format,
      toc: []
    }
  }

  const contentFormat = contentFormatFor(book)
  const cachePath = path.join(storage.getPaths().parseCache, book.id, 'content.json')
  const cached = await readJson<BookContent | null>(cachePath, null)
  if (cached && cached.format === contentFormat) {
    return cached
  }

  const sourcePath = storage.getBookSourcePath(book)
  const content =
    contentFormat === 'mobi'
      ? await parseMobiContent(sourcePath, path.join(storage.getPaths().parseCache, book.id, 'resources'))
      : await parseTxtContent(sourcePath)

  await writeJsonAtomic(cachePath, content)
  return content
}

export async function searchBookContent(
  storage: ReadexStorage,
  book: BookRecord,
  query: string
): Promise<SearchResult[]> {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized.length < 1) return []

  if (book.format === 'epub' || book.format === 'pdf' || book.format === 'cbz') return []
  const content = await getBookContent(storage, book)
  if (!content) return []

  const results: SearchResult[] = []
  for (const chapter of content.chapters ?? []) {
    const lower = chapter.text.toLocaleLowerCase()
    let from = 0
    while (results.length < 200) {
      const index = lower.indexOf(normalized, from)
      if (index < 0) break
      results.push({
        id: `${book.id}:${chapter.id}:${index}`,
        bookId: book.id,
        bookTitle: book.title,
        source: 'text',
        title: chapter.label || book.title,
        excerpt: excerptAt(chapter.text, index, normalized.length),
        locator: {
          type: 'mobi-offset',
          value: `${chapter.id}:${index}:${index + normalized.length}`,
          chapterId: chapter.id,
          start: index,
          end: index + normalized.length,
          excerpt: chapter.text.slice(index, index + normalized.length)
        }
      })
      from = index + Math.max(1, normalized.length)
    }
    if (results.length >= 200) break
  }

  return results
}

async function getComicContent(
  storage: ReadexStorage,
  book: BookRecord
): Promise<BookContent> {
  const directory = path.join(storage.getPaths().parseCache, book.id)
  const contentPath = path.join(directory, 'content.json')
  const pagesDirectory = path.join(directory, 'pages')
  const cached = await readJson<BookContent | null>(contentPath, null)
  if (cached?.format === 'cbz' && cached.pages?.length) {
    const pagesStat = await fs.stat(pagesDirectory).catch(() => null)
    if (pagesStat?.isDirectory()) return cached
  }

  const archive = await JSZip.loadAsync(await fs.readFile(storage.getBookSourcePath(book)))
  const entries = sortComicImages(
    Object.values(archive.files).filter((entry) => !entry.dir && isComicImagePath(entry.name))
  )
  if (!entries.length) throw new Error('CBZ 中未找到可显示的图片')
  if (entries.length > 3000) throw new Error('CBZ 页数超过 3000 页，暂不支持')

  await fs.rm(pagesDirectory, { recursive: true, force: true })
  await fs.mkdir(pagesDirectory, { recursive: true })
  const pages: ComicPage[] = []
  let totalBytes = 0
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const data = await entry.async('nodebuffer')
    if (data.byteLength > 20 * 1024 * 1024) {
      throw new Error(`第 ${index + 1} 页图片超过 20 MB`)
    }
    totalBytes += data.byteLength
    if (totalBytes > 4 * 1024 * 1024 * 1024) {
      throw new Error('CBZ 解压后体积超过 4 GB，暂不支持')
    }
    const extension = path.posix.extname(entry.name).toLowerCase() || '.jpg'
    const fileName = `${String(index + 1).padStart(4, '0')}${extension}`
    await fs.writeFile(path.join(pagesDirectory, fileName), data)
    pages.push({
      index,
      fileName,
      mime: mimeForPath(entry.name)
    })
  }

  const content: BookContent = {
    format: 'cbz',
    toc: pages.map((page) => ({
      id: `comic-page-${page.index + 1}`,
      label: `第 ${page.index + 1} 页`,
      chapterId: String(page.index + 1)
    })),
    pages
  }
  await writeJsonAtomic(contentPath, content)
  return content
}

async function parseMobiContent(sourcePath: string, resourceDirectory: string): Promise<BookContent> {
  await fs.mkdir(resourceDirectory, { recursive: true })
  const { openMobiDocument } = await import('./mobi')
  const mobi = await openMobiDocument(await fs.readFile(sourcePath), resourceDirectory)

  try {
    const spine = mobi.getSpine()
    const chapters: NormalizedChapter[] = []
    for (let index = 0; index < spine.length; index += 1) {
      const item = spine[index]
      const chapterId = String(item.id)
      const processed = mobi.loadChapter(chapterId)
      const html = await embedLocalResources(processed?.html ?? '')
      chapters.push({
        id: chapterId,
        label: `第 ${index + 1} 节`,
        html,
        text: htmlToText(html)
      })
    }

    const toc = mapMobiToc(mobi.getToc(), (href) => mobi.resolveHref(href))
    return {
      format: 'mobi',
      toc,
      chapters
    }
  } finally {
    mobi.destroy()
  }
}

async function embedLocalResources(html: string): Promise<string> {
  const paths = new Set<string>()
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
    const candidate = match[1]
    if (/^[a-zA-Z]:[\\/]/.test(candidate) || candidate.startsWith('file:')) {
      paths.add(candidate)
    }
  }

  let result = html
  for (const resourcePath of paths) {
    try {
      const localPath = resourcePath.startsWith('file:')
        ? decodeURIComponent(new URL(resourcePath).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
        : resourcePath
      const data = await fs.readFile(localPath)
      if (data.byteLength > 5 * 1024 * 1024) continue
      const dataUrl = `data:${mimeForPath(localPath)};base64,${data.toString('base64')}`
      result = result.split(resourcePath).join(dataUrl)
    } catch {
      // Missing optional resources should not make an otherwise readable book fail.
    }
  }
  return result
}

export async function parseTxtContent(sourcePath: string): Promise<BookContent> {
  const buffer = await fs.readFile(sourcePath)
  const text = decodeTextBuffer(buffer)
  const chapters = splitTxtIntoChapters(text)
  return {
    format: 'txt',
    toc: buildTxtToc(text, chapters),
    chapters
  }
}

interface TxtHeading {
  offset: number
  label: string
}

const TXT_HEADING_PATTERNS = [
  // 第X章 / 第X回 / 第X卷，标题行必须独占一行且不能是长段落。
  /^[ \t　]{0,3}(第[0-9０-９零〇一二三四五六七八九十百千万两]{1,12}[章节回卷部篇集][^\n]{0,30})[ \t　]*$/gm,
  // 序章、楔子、番外等结构标题；后面只能是行尾或分隔符，避免把“前言正文。”当成标题。
  /^[ \t　]{0,3}((?:序章|序言|楔子|前言|引子|后记|尾声|番外篇?)(?:[ \t　：:·—\-][^\n]{0,30})?)[ \t　]*$/gm,
  // 英文 Chapter / Part / Book 标题。
  /^[ \t]{0,3}((?:chapter|part|book)\s+(?:[0-9]+|[ivxlcdm]+)\b[^\n]{0,40})[ \t]*$/gim
]

/**
 * TXT 仍按固定字符块分章以保持阅读性能和既有笔记定位，
 * 但目录优先展示识别出的真实标题，并记录章内偏移用于跳转。
 */
export function buildTxtToc(text: string, chapters: NormalizedChapter[]): TocItem[] {
  const headings = findTxtHeadings(text)
  if (headings.length < 2) {
    return chapters.map((chapter) => ({ id: chapter.id, label: chapter.label }))
  }

  const ranges: Array<{ id: string; start: number; end: number }> = []
  let cursor = 0
  for (const chapter of chapters) {
    ranges.push({ id: chapter.id, start: cursor, end: cursor + chapter.text.length })
    cursor += chapter.text.length
  }
  if (!ranges.length) return []

  const toc: TocItem[] = []
  if (headings[0].offset > 3000) {
    toc.push({ id: 'txt-preamble', label: '开头', chapterId: ranges[0].id, start: 0 })
  }
  for (const heading of headings) {
    const range =
      ranges.find((item) => heading.offset >= item.start && heading.offset < item.end) ??
      ranges[ranges.length - 1]
    toc.push({
      id: `txt-heading-${heading.offset}`,
      label: heading.label,
      chapterId: range.id,
      start: Math.max(0, heading.offset - range.start)
    })
  }
  return toc
}

function findTxtHeadings(text: string): TxtHeading[] {
  const found = new Map<number, string>()
  for (const pattern of TXT_HEADING_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) {
      const label = match[1].replace(/\s+/g, ' ').trim().slice(0, 60)
      // 以句末标点结尾的多半是正文句子而不是章节标题。
      if (!label || /[。．.!?！？；;]$/.test(label)) continue
      if (!found.has(match.index)) found.set(match.index, label)
    }
  }
  return [...found.entries()]
    .map(([offset, label]) => ({ offset, label }))
    .sort((a, b) => a.offset - b.offset)
}

function splitTxtIntoChapters(text: string): NormalizedChapter[] {
  const targetSize = 24_000
  const chapters: NormalizedChapter[] = []
  let cursor = 0
  let section = 1

  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + targetSize)
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end)
      if (newline > cursor + targetSize * 0.6) end = newline + 1
    }

    const value = text.slice(cursor, end)
    chapters.push({
      id: `txt-${section}`,
      label: `第 ${section} 节`,
      html: value
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
        .join(''),
      text: value
    })
    cursor = end
    section += 1
  }

  return chapters
}

function mapMobiToc(
  items: unknown[],
  resolver: (href: string) => { id: string; selector: string } | undefined
): TocItem[] {
  return items.map((item, index) => {
    const record = item as Record<string, unknown>
    const href = typeof record.href === 'string' ? record.href : ''
    const resolved = href ? resolver(href) : undefined
    const children = Array.isArray(record.children)
      ? mapMobiToc(record.children, resolver)
      : undefined

    return {
      id: `toc-${index}-${resolved?.id ?? href}`,
      label: String(record.label ?? `章节 ${index + 1}`),
      href,
      chapterId: resolved?.id,
      children
    }
  })
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function mimeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  return (
    {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.avif': 'image/avif'
    }[extension] ?? 'application/octet-stream'
  )
}

function excerptAt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 60)
  const end = Math.min(text.length, index + length + 60)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`
}
