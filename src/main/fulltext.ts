import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import type { BookRecord, LocatorType, SearchResult } from '../shared/types'
import { getBookContent, htmlToText } from './content'
import { ReadexStorage, readJson, writeJsonAtomic } from './storage'

interface SearchChapter {
  id: string
  label: string
  href?: string
  text: string
}

interface FullTextCache {
  version: number
  chapters: SearchChapter[]
}

const FULLTEXT_VERSION = 1
const PER_BOOK_LIMIT = 30
const TOTAL_LIMIT = 200
const MAX_QUERY_LENGTH = 100

/**
 * 跨书正文搜索：TXT/MOBI/AZW3 复用内容缓存，EPUB 首次搜索时提取 spine 文本。
 * PDF 需要逐页光栅化文本层，暂不纳入全局索引。
 */
export async function searchLibraryContent(
  storage: ReadexStorage,
  query: string
): Promise<SearchResult[]> {
  const normalized = query.trim()
  if (!normalized || normalized.length > MAX_QUERY_LENGTH) return []
  const library = await storage.getLibrary()
  const results: SearchResult[] = []

  for (const book of library.books) {
    if (results.length >= TOTAL_LIMIT) break
    if (book.format === 'pdf' || book.format === 'cbz') continue
    try {
      const chapters = await loadSearchChapters(storage, book)
      results.push(
        ...searchChapterText(
          book,
          chapters,
          normalized,
          Math.min(PER_BOOK_LIMIT, TOTAL_LIMIT - results.length)
        )
      )
    } catch {
      // 单本解析失败不影响其他书的搜索结果。
    }
  }
  return results
}

export function searchChapterText(
  book: BookRecord,
  chapters: SearchChapter[],
  query: string,
  limit = PER_BOOK_LIMIT
): SearchResult[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return []
  const results: SearchResult[] = []
  const locatorType: LocatorType = book.format === 'txt' ? 'text-offset' : 'mobi-offset'

  for (const chapter of chapters) {
    const lower = chapter.text.toLocaleLowerCase()
    let from = 0
    while (results.length < limit) {
      const index = lower.indexOf(normalized, from)
      if (index < 0) break
      const end = index + normalized.length
      const excerpt = excerptAt(chapter.text, index, normalized.length)
      results.push({
        id: `${book.id}:${chapter.id}:${index}`,
        bookId: book.id,
        bookTitle: book.title,
        source: 'text',
        title: chapter.label || book.title,
        excerpt,
        locator:
          book.format === 'epub'
            ? {
                type: 'epub-cfi',
                value: chapter.href ?? chapter.id,
                chapterHref: chapter.href,
                excerpt: chapter.text.slice(index, end)
              }
            : {
                type: locatorType,
                value: `${chapter.id}:${index}:${end}`,
                chapterId: chapter.id,
                start: index,
                end,
                excerpt: chapter.text.slice(index, end)
              }
      })
      from = index + Math.max(1, normalized.length)
    }
    if (results.length >= limit) break
  }
  return results
}

async function loadSearchChapters(
  storage: ReadexStorage,
  book: BookRecord
): Promise<SearchChapter[]> {
  const cachePath = path.join(storage.getPaths().parseCache, book.id, 'fulltext.json')
  const cached = await readJson<FullTextCache | null>(cachePath, null)
  if (cached?.version === FULLTEXT_VERSION && Array.isArray(cached.chapters)) {
    return cached.chapters
  }

  let chapters: SearchChapter[]
  if (book.format === 'epub') {
    chapters = await parseEpubTextChapters(storage.getBookSourcePath(book))
  } else {
    const content = await getBookContent(storage, book)
    chapters = (content?.chapters ?? []).map((chapter) => ({
      id: chapter.id,
      label: chapter.label,
      text: chapter.text
    }))
  }

  await writeJsonAtomic(cachePath, { version: FULLTEXT_VERSION, chapters })
  return chapters
}

async function parseEpubTextChapters(sourcePath: string): Promise<SearchChapter[]> {
  const archive = await JSZip.loadAsync(await fs.readFile(sourcePath))
  const containerFile = archive.file('META-INF/container.xml')
  if (!containerFile) return []

  const parser = createXmlParser()
  const container = parser.parse(await containerFile.async('text'))
  const rootfile = findFirstByKey(container, 'rootfile')
  const packagePath = String(readAttribute(rootfile, 'full-path') ?? '')
  if (!packagePath) return []

  const packageFile = archive.file(decodeURIComponent(packagePath))
  if (!packageFile) return []
  const opf = parser.parse(await packageFile.async('text'))
  const pkg = findFirstByKey(opf, 'package')
  const manifest = findFirstByKey(pkg, 'manifest')
  const spine = findFirstByKey(pkg, 'spine')
  const items = toArray(findFirstByKey(manifest, 'item'))
  const byId = new Map<string, { href: string; mediaType: string }>()
  for (const item of items) {
    const id = readAttribute(item, 'id')
    const href = readAttribute(item, 'href')
    if (typeof id !== 'string' || typeof href !== 'string') continue
    byId.set(id, {
      href,
      mediaType: String(readAttribute(item, 'media-type') ?? '')
    })
  }

  const baseDirectory = path.posix.dirname(packagePath)
  const chapters: SearchChapter[] = []
  let index = 0
  for (const itemref of toArray(findFirstByKey(spine, 'itemref'))) {
    const idref = readAttribute(itemref, 'idref')
    const item = typeof idref === 'string' ? byId.get(idref) : undefined
    if (!item) continue
    if (item.mediaType && !/html|xhtml/i.test(item.mediaType)) continue
    const href = decodeURIComponent(item.href.split('#')[0])
    const archivePath = path.posix.normalize(path.posix.join(baseDirectory, href))
    const file = archive.file(archivePath)
    if (!file) continue
    const html = await file.async('text')
    const text = htmlToText(html)
    if (!text) continue
    chapters.push({
      id: String(index),
      label: epubChapterLabel(html) || `第 ${index + 1} 节`,
      href,
      text
    })
    index += 1
  }
  return chapters
}

function epubChapterLabel(html: string): string {
  const heading = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(html)?.[1]
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  return htmlToText(heading ?? title ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

function excerptAt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40)
  const end = Math.min(text.length, index + length + 40)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`
}

function createXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    textNodeName: '#text',
    trimValues: true
  })
}

function findFirstByKey(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (key in record) return record[key]
  for (const nested of Object.values(record)) {
    const found = findFirstByKey(nested, key)
    if (found !== undefined) return found
  }
  return undefined
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function readAttribute(value: unknown, name: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  return (value as Record<string, unknown>)[`@_${name}`]
}
