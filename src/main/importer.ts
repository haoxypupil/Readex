import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import type {
  BookFormat,
  BookMetadata,
  BookRecord,
  ImportBatchResult,
  ImportJob,
  ImportProgressEvent
} from '../shared/types'
import { BOOK_FORMATS } from '../shared/types'
import { isComicImagePath, sortComicImages } from './comic'
import { ReadexStorage, parseCoverDataUrl, writeJsonAtomic } from './storage'
import { decodeTextBuffer } from './text'

interface ImportCallbacks {
  onProgress?: (event: ImportProgressEvent) => void
  /** 返回 true 时不再开始下一本书，正在处理的一本仍会完成。 */
  shouldCancel?: () => boolean
}

interface ExtractedMetadata extends BookMetadata {
  coverDataUrl?: string
  chapterCount?: number
}

export async function importBookPaths(
  storage: ReadexStorage,
  filePaths: string[],
  callbacks: ImportCallbacks = {}
): Promise<ImportBatchResult> {
  const batchId = randomUUID()
  const jobs: ImportJob[] = filePaths.map((filePath) => ({
    id: randomUUID(),
    path: filePath,
    fileName: path.basename(filePath),
    status: 'queued',
    progress: 0
  }))
  const importedBooks: BookRecord[] = []

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index]
    if (callbacks.shouldCancel?.()) {
      for (const pending of jobs.slice(index)) {
        if (pending.status !== 'queued') continue
        pending.status = 'cancelled'
        pending.progress = 100
        pending.message = '已取消'
        emitProgress(callbacks, batchId, pending, index, jobs.length)
      }
      break
    }
    job.status = 'checking'
    emitProgress(callbacks, batchId, job, index, jobs.length)

    try {
      const book = await importSingleBook(storage, job, (progress, message) => {
        job.progress = progress
        job.message = message
        emitProgress(callbacks, batchId, job, index, jobs.length)
      })

      if (!book) {
        job.status = 'skipped'
        job.progress = 100
        job.message = '资料库中已存在相同文件'
      } else {
        job.status = 'success'
        job.progress = 100
        job.message = '导入完成'
        job.bookId = book.id
        importedBooks.push(book)
      }
    } catch (error) {
      job.status = 'failed'
      job.progress = 100
      job.message = normalizeImportError(error)
    }

    emitProgress(callbacks, batchId, job, index + 1, jobs.length)
  }

  return { jobs, books: importedBooks }
}

async function importSingleBook(
  storage: ReadexStorage,
  job: ImportJob,
  progress: (value: number, message: string) => void
): Promise<BookRecord | null> {
  const paths = storage.getPaths()
  const stats = await fs.stat(job.path).catch(() => null)
  if (!stats?.isFile()) {
    throw new Error('文件不存在或不可读取')
  }

  const extension = path.extname(job.path).slice(1).toLowerCase()
  if (!isBookFormat(extension)) {
    throw new Error('不支持的格式，请选择 EPUB、MOBI、AZW3、PDF 或 TXT 文件')
  }

  progress(8, '正在读取文件')
  const sha256 = await hashFile(job.path)
  const existing = (await storage.getLibrary()).books.find((book) => book.sha256 === sha256)
  if (existing) {
    return null
  }

  progress(18, '正在校验文件')
  const header = await readHeader(job.path, 256)
  validateFileHeader(extension, header)

  const temporaryDirectory = path.join(paths.importCache, job.id)
  await fs.rm(temporaryDirectory, { recursive: true, force: true })
  await fs.mkdir(temporaryDirectory, { recursive: true })

  try {
    const sourcePath = path.join(temporaryDirectory, `source.${extension}`)
    await fs.copyFile(job.path, sourcePath)
    progress(35, '正在提取书籍信息')

    const metadata = await extractMetadata(sourcePath, extension, job.fileName)
    const coverFile = await writeCoverFile(temporaryDirectory, metadata.coverDataUrl)
    const bookMetadata: BookMetadata = {
      title: metadata.title,
      author: metadata.author,
      language: metadata.language,
      publisher: metadata.publisher,
      description: metadata.description,
      chapterCount: metadata.chapterCount
    }
    progress(72, '正在写入个人资料库')

    const bookId = sha256.slice(0, 20)
    const now = new Date().toISOString()
    const book: BookRecord = {
      id: bookId,
      format: extension,
      fileName: job.fileName,
      originalPath: job.path,
      importedAt: now,
      updatedAt: now,
      size: stats.size,
      sha256,
      progress: 0,
      ...bookMetadata,
      ...(coverFile ? { coverFile } : {})
    }

    await writeJsonAtomic(path.join(temporaryDirectory, 'metadata.json'), {
      ...bookMetadata,
      ...(coverFile ? { coverFile } : {})
    })
    await writeJsonAtomic(path.join(temporaryDirectory, 'annotations.json'), {
      schemaVersion: 1,
      annotations: []
    })
    await writeJsonAtomic(path.join(temporaryDirectory, 'reading-state.json'), {
      schemaVersion: 1,
      locator: null,
      progress: 0,
      updatedAt: now
    })

    const finalDirectory = storage.getBookDirectory(bookId)
    await fs.mkdir(path.dirname(finalDirectory), { recursive: true })
    await fs.rm(finalDirectory, { recursive: true, force: true })
    await fs.rename(temporaryDirectory, finalDirectory)
    await storage.addBook(book)

    progress(100, '导入完成')
    return book
  } catch (error) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}

function isBookFormat(value: string): value is BookFormat {
  return (BOOK_FORMATS as readonly string[]).includes(value)
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const handle = await fs.open(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)

  try {
    let position = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
  } finally {
    await handle.close()
  }

  return hash.digest('hex')
}

async function readHeader(filePath: string, length: number): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

export function validateFileHeader(format: BookFormat, header: Buffer): void {
  const ascii = header.toString('latin1')
  if (format === 'pdf' && !ascii.startsWith('%PDF-')) {
    throw new Error('PDF 文件头无效或文件已损坏')
  }
  if (format === 'epub' && !(header[0] === 0x50 && header[1] === 0x4b)) {
    throw new Error('EPUB 文件头无效或文件已损坏')
  }
  if (format === 'cbz' && !(header[0] === 0x50 && header[1] === 0x4b)) {
    throw new Error('CBZ 文件头无效或文件已损坏')
  }
  if (format === 'mobi' || format === 'azw3') {
    if (!ascii.includes('BOOKMOBI')) {
      throw new Error(
        format === 'azw3'
          ? 'AZW3 文件头无效或文件已损坏（未加密的 KF8 文件应以 BOOKMOBI 开头）'
          : 'MOBI 文件头无效或文件已损坏'
      )
    }
  }
  if (format === 'txt' && header.includes(0) && !looksLikeUtf16(header)) {
    throw new Error('TXT 文件包含二进制内容')
  }
}

function looksLikeUtf16(header: Buffer): boolean {
  return (
    (header[0] === 0xff && header[1] === 0xfe) ||
    (header[0] === 0xfe && header[1] === 0xff)
  )
}

async function extractMetadata(
  filePath: string,
  format: BookFormat,
  fallbackFileName: string
): Promise<ExtractedMetadata> {
  if (format === 'epub') return extractEpubMetadata(filePath, fallbackFileName)
  if (format === 'mobi' || format === 'azw3') {
    return extractMobiMetadata(filePath, fallbackFileName)
  }
  if (format === 'txt') return extractTxtMetadata(filePath, fallbackFileName)
  if (format === 'cbz') return extractComicMetadata(filePath, fallbackFileName)
  return extractPdfMetadata(filePath, fallbackFileName)
}

async function extractComicMetadata(
  filePath: string,
  fallbackFileName: string
): Promise<ExtractedMetadata> {
  const archive = await JSZip.loadAsync(await fs.readFile(filePath))
  const entries = sortComicImages(
    Object.values(archive.files).filter((entry) => !entry.dir && isComicImagePath(entry.name))
  )
  if (!entries.length) throw new Error('CBZ 中未找到可显示的图片')

  let coverDataUrl: string | undefined
  try {
    const data = await entries[0].async('nodebuffer')
    if (data.byteLength <= 3 * 1024 * 1024) {
      coverDataUrl = `data:${mimeForPath(entries[0].name)};base64,${data.toString('base64')}`
    }
  } catch {
    coverDataUrl = undefined
  }

  return {
    title: cleanBookTitle(fallbackFileName),
    author: '未知作者',
    chapterCount: entries.length,
    coverDataUrl
  }
}

async function extractEpubMetadata(
  filePath: string,
  fallbackFileName: string
): Promise<ExtractedMetadata> {
  const archive = await JSZip.loadAsync(await fs.readFile(filePath))
  const encryptionFile = archive.file('META-INF/encryption.xml')
  if (encryptionFile) {
    const encryption = await encryptionFile.async('text')
    if (/<(?:\w+:)?EncryptedKey\b/i.test(encryption)) {
      throw new Error('该 EPUB 受 DRM 保护，Readex 不支持解密')
    }
  }

  const containerFile = archive.file('META-INF/container.xml')
  if (!containerFile) {
    throw new Error('EPUB 缺少 META-INF/container.xml')
  }

  const parser = createXmlParser()
  const container = parser.parse(await containerFile.async('text'))
  const rootfile = findFirstByKey(container, 'rootfile')
  const packagePath = String(readAttribute(rootfile, 'full-path') ?? '')
  if (!packagePath) throw new Error('EPUB 无法定位内容清单')

  const packageFile = archive.file(decodeURIComponent(packagePath))
  if (!packageFile) throw new Error('EPUB 内容清单不存在')
  const opf = parser.parse(await packageFile.async('text'))
  const pkg = findFirstByKey(opf, 'package') as Record<string, unknown> | undefined
  const metadataNode = findFirstByKey(pkg, 'metadata') as Record<string, unknown> | undefined
  const manifest = findFirstByKey(pkg, 'manifest') as Record<string, unknown> | undefined
  const spine = findFirstByKey(pkg, 'spine') as Record<string, unknown> | undefined
  const manifestItems = toArray(findFirstByKey(manifest, 'item'))
  const spineItems = toArray(findFirstByKey(spine, 'itemref'))

  const title = readText(metadataNode, ['title']) || cleanBookTitle(fallbackFileName)
  const author = readText(metadataNode, ['creator', 'author']) || '未知作者'
  const language = readText(metadataNode, ['language'])
  const publisher = readText(metadataNode, ['publisher'])
  const description = stripMarkup(readText(metadataNode, ['description']))
  const coverDataUrl = await extractEpubCover(archive, manifestItems, metadataNode, packagePath)

  return {
    title,
    author,
    language,
    publisher,
    description,
    coverDataUrl,
    chapterCount: spineItems.length
  }
}

async function extractEpubCover(
  archive: JSZip,
  manifestItems: unknown[],
  metadataNode: Record<string, unknown> | undefined,
  packagePath: string
): Promise<string | undefined> {
  const metadataEntries = toArray(findFirstByKey(metadataNode, 'meta'))
  const coverMeta = metadataEntries.find((item) => readAttribute(item, 'name') === 'cover')
  const coverId = readAttribute(coverMeta, 'content')
  const coverItem =
    (coverId && manifestItems.find((item) => readAttribute(item, 'id') === coverId)) ||
    manifestItems.find((item) => String(readAttribute(item, 'properties') ?? '').includes('cover-image'))

  const href = readAttribute(coverItem, 'href')
  if (typeof href !== 'string' || !href) return undefined

  const packageDirectory = path.posix.dirname(packagePath)
  const coverPath = normalizeArchivePath(path.posix.join(packageDirectory, decodeURIComponent(href)))
  const coverFile = archive.file(coverPath)
  if (!coverFile) return undefined

  const data = await coverFile.async('nodebuffer')
  if (data.byteLength > 3 * 1024 * 1024) return undefined
  return `data:${mimeForPath(coverPath)};base64,${data.toString('base64')}`
}

async function extractMobiMetadata(
  filePath: string,
  fallbackFileName: string
): Promise<ExtractedMetadata> {
  const data = await fs.readFile(filePath)
  const { openMobiDocument } = await import('./mobi')
  const mobi = await openMobiDocument(data, path.join(path.dirname(filePath), 'mobi-assets'))

  try {
    const metadata = mobi.getMetadata()
    const spine = mobi.getSpine()
    let coverDataUrl: string | undefined

    try {
      const cover = mobi.getCoverImage()
      if (typeof cover === 'string' && cover.startsWith('data:')) {
        coverDataUrl = cover
      } else if (typeof cover === 'string' && cover) {
        const coverPath = cover.startsWith('file:')
          ? decodeURIComponent(new URL(cover).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
          : cover
        const coverBuffer = await fs.readFile(coverPath)
        if (coverBuffer.byteLength <= 3 * 1024 * 1024) {
          coverDataUrl = `data:${mimeForPath(coverPath)};base64,${coverBuffer.toString('base64')}`
        }
      }
    } catch {
      coverDataUrl = undefined
    }

    return {
      title: metadata.title || cleanBookTitle(fallbackFileName),
      author: metadata.author?.filter(Boolean).join(', ') || '未知作者',
      language: metadata.language,
      publisher: metadata.publisher,
      description: stripMarkup(metadata.description),
      coverDataUrl,
      chapterCount: spine.length
    }
  } catch (error) {
    if (/drm|encrypt|locked/i.test(String(error))) {
      throw new Error('该 MOBI 文件受 DRM 保护，Readex 不支持解密')
    }
    throw error
  } finally {
    mobi.destroy()
  }
}

async function extractTxtMetadata(
  filePath: string,
  fallbackFileName: string
): Promise<ExtractedMetadata> {
  const buffer = await fs.readFile(filePath)
  if (buffer.byteLength === 0) throw new Error('TXT 文件为空')

  const text = decodeTextBuffer(buffer)
  if (!text.trim()) throw new Error('TXT 文件不包含可阅读文本')

  return {
    title: cleanBookTitle(fallbackFileName),
    author: '未知作者',
    language: /[\u3400-\u9fff]/.test(text.slice(0, 2000)) ? 'zh' : 'en'
  }
}

export async function extractPdfMetadata(
  filePath: string,
  fallbackFileName: string
): Promise<ExtractedMetadata> {
  const buffer = await fs.readFile(filePath)
  if (buffer.includes(Buffer.from('/Encrypt'))) {
    throw new Error('该 PDF 已加密或受 DRM 保护，Readex 不支持解密')
  }

  const ascii = buffer.subarray(0, Math.min(buffer.length, 1024 * 1024)).toString('latin1')
  const decodedTitle = decodePdfString(matchPdfInfo(ascii, 'Title'))
  const decodedAuthor = decodePdfString(matchPdfInfo(ascii, 'Author'))
  const title =
    cleanPdfMetadataText(decodedTitle) &&
    isPlausiblePdfMetadataTitle(decodedTitle)
      ? decodedTitle
      : cleanBookTitle(fallbackFileName)
  const author =
    cleanPdfMetadataText(decodedAuthor) &&
    isPlausiblePdfMetadataTitle(decodedAuthor)
      ? decodedAuthor
      : '未知作者'

  return {
    title: title || cleanBookTitle(fallbackFileName),
    author,
    language: /[\u3400-\u9fff]/.test(title) ? 'zh' : undefined
  }
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

function readText(node: unknown, keys: string[]): string {
  if (!node || typeof node !== 'object') return ''
  const record = node as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    if (value && typeof value === 'object' && '#text' in value) {
      return String((value as Record<string, unknown>)['#text'])
    }
  }
  return ''
}

function normalizeArchivePath(value: string): string {
  const normalized = path.posix.normalize(value).replace(/^\/+/, '')
  if (normalized.startsWith('../')) throw new Error('EPUB 包含不安全的资源路径')
  return normalized
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

export function cleanBookTitle(fileName: string): string {  return path
    .basename(fileName, path.extname(fileName))
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchPdfInfo(content: string, key: string): Buffer | null {
  const literalStart = content.search(new RegExp(`/${key}\\s*\\(`, 's'))
  if (literalStart >= 0) {
    const open = content.indexOf('(', literalStart)
    const bytes: number[] = []
    let depth = 1
    for (let index = open + 1; index < content.length; index += 1) {
      const code = content.charCodeAt(index)
      if (code === 0x5c) {
        const escaped = readPdfEscape(content, index)
        if (escaped) {
          bytes.push(...escaped.bytes)
          index = escaped.end
          continue
        }
      }
      if (code === 0x28) depth += 1
      if (code === 0x29) {
        depth -= 1
        if (depth === 0) return Buffer.from(bytes)
      }
      bytes.push(code & 0xff)
    }
  }

  const hexMatch = content.match(new RegExp(`/${key}\\s*<([\\da-f\\s]+)>`, 'i'))
  if (hexMatch) {
    const hex = hexMatch[1].replace(/\s+/g, '')
    const normalized = hex.length % 2 === 0 ? hex : `${hex}0`
    return Buffer.from(normalized, 'hex')
  }
  return null
}

export function decodePdfString(value: Buffer | null): string {
  if (!value?.length) return ''
  try {
    if (value[0] === 0xfe && value[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(value.subarray(2))
    }
    if (value[0] === 0xff && value[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(value.subarray(2))
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    return value.toString('latin1')
  }
}

function readPdfEscape(
  content: string,
  slashIndex: number
): { bytes: number[]; end: number } | null {
  const next = content[slashIndex + 1]
  if (!next) return null
  const simple: Record<string, number> = {
    n: 0x0a,
    r: 0x0d,
    t: 0x09,
    b: 0x08,
    f: 0x0c,
    '(': 0x28,
    ')': 0x29,
    '\\': 0x5c
  }
  if (next in simple) return { bytes: [simple[next]], end: slashIndex + 1 }
  if (/[0-7]/.test(next)) {
    const match = content.slice(slashIndex + 1).match(/^[0-7]{1,3}/)
    if (!match) return null
    return {
      bytes: [Number.parseInt(match[0], 8) & 0xff],
      end: slashIndex + match[0].length
    }
  }
  if (next === '\r' || next === '\n') {
    return {
      bytes: [],
      end: next === '\r' && content[slashIndex + 2] === '\n' ? slashIndex + 2 : slashIndex + 1
    }
  }
  return { bytes: [next.charCodeAt(0) & 0xff], end: slashIndex + 1 }
}

function cleanPdfMetadataText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()
}

export function isPlausiblePdfMetadataTitle(value: string): boolean {
  const normalized = cleanPdfMetadataText(value)
  if (normalized.length < 2 || normalized.length > 240) return false
  if (/[\uFFFD\uE000-\uF8FF]/.test(normalized)) return false
  if (/\.(?:tiff?|jpe?g|png|gif|bmp|webp|psd|indd|pdf)\b/i.test(normalized)) return false
  return /[\p{L}\p{N}]/u.test(normalized)
}

async function writeCoverFile(
  directory: string,
  dataUrl?: string
): Promise<string | undefined> {
  if (!dataUrl) return undefined
  const cover = parseCoverDataUrl(dataUrl)
  if (!cover) return undefined
  const fileName = `cover.${cover.extension}`
  await fs.writeFile(path.join(directory, fileName), cover.bytes)
  return fileName
}

function normalizeImportError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/password/i.test(message)) return '文件已加密，需要密码，无法导入'
  if (/corrupt|invalid|unexpected end/i.test(message)) return '文件损坏或格式不完整'
  if (/ENOSPC/i.test(message)) return '磁盘空间不足'
  if (/EACCES|EPERM/i.test(message)) return '没有写入个人资料目录的权限'
  return message || '导入失败'
}

function emitProgress(
  callbacks: ImportCallbacks,
  batchId: string,
  job: ImportJob,
  completed: number,
  total: number
): void {
  callbacks.onProgress?.({
    batchId,
    job: { ...job },
    completed,
    total
  })
}
