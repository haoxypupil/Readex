import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  Annotation,
  AnnotationFile,
  AppSettings,
  BookRecord,
  LibraryData,
  ProfileInfo,
  ReadingLocator,
  ReadingState,
  ReadingStats
} from '../shared/types'
import {
  DEFAULT_READING_STATS,
  DEFAULT_SETTINGS
} from '../shared/types'
import {
  DEFAULT_TTS_VOICE,
  TTS_MAX_RATE,
  TTS_MAX_VOLUME,
  TTS_MIN_RATE,
  TTS_MIN_VOLUME
} from '../shared/speech'

export interface DataPaths {
  root: string
  personal: string
  cache: string
  books: string
  importCache: string
  parseCache: string
  ttsCache: string
  settings: string
  library: string
  stats: string
}

function getDataRoot(): string {
  if (app.isPackaged) {
    const executableDirectory =
      process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(process.execPath)
    return path.join(executableDirectory, 'data')
  }

  return path.join(process.cwd(), 'data-dev')
}

export function getDataPaths(): DataPaths {
  const root = getDataRoot()
  const personal = path.join(root, 'personal')
  const cache = path.join(root, 'cache')

  return {
    root,
    personal,
    cache,
    books: path.join(personal, 'books'),
    importCache: path.join(cache, 'import'),
    parseCache: path.join(cache, 'parsed'),
    ttsCache: path.join(cache, 'tts'),
    settings: path.join(personal, 'settings.json'),
    library: path.join(personal, 'library.json'),
    stats: path.join(personal, 'stats.json')
  }
}

export async function ensureDataDirectories(): Promise<DataPaths> {
  const paths = getDataPaths()
  await Promise.all([
    fs.mkdir(paths.personal, { recursive: true }),
    fs.mkdir(paths.books, { recursive: true }),
    fs.mkdir(paths.importCache, { recursive: true }),
    fs.mkdir(paths.parseCache, { recursive: true }),
    fs.mkdir(paths.ttsCache, { recursive: true })
  ])
  return paths
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    return JSON.parse(content) as T
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || error instanceof SyntaxError) {
      return fallback
    }
    throw error
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath)
  await fs.mkdir(directory, { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const content = `${JSON.stringify(value, null, 2)}\n`
  await fs.writeFile(temporaryPath, content, 'utf8')

  try {
    await fs.rename(temporaryPath, filePath)
  } catch {
    await fs.rm(filePath, { force: true })
    await fs.rename(temporaryPath, filePath)
  }
}

export class ReadexStorage {
  private paths = getDataPaths()
  private libraryWrite = Promise.resolve()
  private settingsWrite = Promise.resolve()
  private statsWrite = Promise.resolve()
  /** 书库里的进度展示按秒级节流写入，避免每次翻页都重写整个 library.json。 */
  private progressSync = new Map<string, { at: number; progress: number }>()
  private static readonly PROGRESS_SYNC_INTERVAL_MS = 15_000
  private static readonly PROGRESS_SYNC_DELTA = 0.01

  async initialize(): Promise<void> {
    this.paths = await ensureDataDirectories()
    await Promise.all([
      ensureJsonFile(this.paths.library, {
        schemaVersion: 1,
        books: []
      } satisfies LibraryData),
      ensureJsonFile(this.paths.settings, DEFAULT_SETTINGS),
      ensureJsonFile(this.paths.stats, DEFAULT_READING_STATS)
    ])
    // 旧版本的封面内嵌在 library.json 中，启动时逐个落成文件，失败则下次再试。
    await this.migrateCoverFiles().catch(() => undefined)
  }

  private async migrateCoverFiles(): Promise<void> {
    const library = await this.getLibrary()
    let changed = false
    for (const book of library.books) {
      if (!book.coverDataUrl) continue
      if (book.coverFile) {
        // 已经文件化，只需清理遗留的 data URL。
        delete book.coverDataUrl
        changed = true
        continue
      }
      const cover = parseCoverDataUrl(book.coverDataUrl)
      if (!cover) {
        delete book.coverDataUrl
        changed = true
        continue
      }
      try {
        const directory = this.getBookDirectory(book.id)
        await fs.mkdir(directory, { recursive: true })
        const fileName = `cover.${cover.extension}`
        await fs.writeFile(path.join(directory, fileName), cover.bytes)
        book.coverFile = fileName
        delete book.coverDataUrl
        changed = true
      } catch {
        // 保留原始 data URL，下次启动继续迁移。
      }
    }
    if (changed) await this.saveLibrary(library)
  }

  getPaths(): DataPaths {
    return this.paths
  }

  /** 恢复备份后清空进度节流状态，让新书库立即开始记录。 */
  resetProgressSync(): void {
    this.progressSync.clear()
  }

  async getLibrary(): Promise<LibraryData> {
    const library = await readJson<LibraryData>(this.paths.library, {
      schemaVersion: 1,
      books: []
    })

    return {
      schemaVersion: 1,
      books: Array.isArray(library.books) ? library.books : []
    }
  }

  async saveLibrary(library: LibraryData): Promise<void> {
    this.libraryWrite = this.libraryWrite.then(() => writeJsonAtomic(this.paths.library, library))
    await this.libraryWrite
  }

  async addBook(book: BookRecord): Promise<void> {
    const library = await this.getLibrary()
    const existingIndex = library.books.findIndex((item) => item.id === book.id)
    if (existingIndex >= 0) {
      library.books[existingIndex] = book
    } else {
      library.books.push(book)
    }
    await this.saveLibrary(library)
  }

  async updateBook(bookId: string, patch: Partial<BookRecord>): Promise<BookRecord | null> {
    const library = await this.getLibrary()
    const index = library.books.findIndex((book) => book.id === bookId)
    if (index < 0) return null

    const updated = {
      ...library.books[index],
      ...patch,
      id: library.books[index].id,
      updatedAt: new Date().toISOString()
    }
    library.books[index] = updated
    await this.saveLibrary(library)
    return updated
  }

  async removeBook(bookId: string, deleteSource: boolean): Promise<void> {
    const library = await this.getLibrary()
    const book = library.books.find((item) => item.id === bookId)
    if (!book) return
    this.progressSync.delete(bookId)

    const nextLibrary = {
      ...library,
      books: library.books.filter((item) => item.id !== bookId)
    }
    await this.saveLibrary(nextLibrary)

    if (deleteSource) {
      await fs.rm(path.join(this.paths.books, bookId), { recursive: true, force: true })
      await fs.rm(path.join(this.paths.parseCache, bookId), { recursive: true, force: true })
    }
  }

  getBookDirectory(bookId: string): string {
    return path.join(this.paths.books, bookId)
  }

  async replaceCover(bookId: string, sourcePath: string): Promise<BookRecord | null> {
    const book = await this.getBookRecord(bookId)
    if (!book) return null
    const extension = COVER_EXTENSIONS[path.extname(sourcePath).toLowerCase()]
    if (!extension) throw new Error('仅支持 PNG、JPEG、WebP、GIF 或 BMP 图片')
    const stat = await fs.stat(sourcePath).catch(() => null)
    if (!stat?.isFile()) throw new Error('无法读取封面文件')
    if (stat.size > 8 * 1024 * 1024) throw new Error('封面图片不能超过 8 MB')

    const directory = this.getBookDirectory(bookId)
    await fs.mkdir(directory, { recursive: true })
    const fileName = `cover.${extension}`
    await fs.copyFile(sourcePath, path.join(directory, fileName))
    if (book.coverFile && book.coverFile !== fileName) {
      await fs.rm(path.join(directory, book.coverFile), { force: true })
    }
    return this.updateBook(bookId, { coverFile: fileName })
  }

  /** 渲染层为 PDF 生成首屏封面后回传，只有书籍尚无封面时才写入。 */
  async saveGeneratedCover(bookId: string, dataUrl: string): Promise<BookRecord | null> {
    const book = await this.getBookRecord(bookId)
    if (!book) return null
    if (book.coverFile) return book
    const cover = parseCoverDataUrl(dataUrl)
    if (!cover || cover.bytes.length > 1.5 * 1024 * 1024) return null
    const fileName = `cover.${cover.extension}`
    const directory = this.getBookDirectory(bookId)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, fileName), cover.bytes)
    return this.updateBook(bookId, { coverFile: fileName })
  }

  getBookSourcePath(book: Pick<BookRecord, 'id' | 'format'>): string {
    return path.join(this.getBookDirectory(book.id), `source.${book.format}`)
  }

  async getBookRecord(bookId: string): Promise<BookRecord | null> {
    const library = await this.getLibrary()
    return library.books.find((book) => book.id === bookId) ?? null
  }

  async getSettings(): Promise<AppSettings> {
    const settings = await readJson<AppSettings>(this.paths.settings, DEFAULT_SETTINGS)
    return {
      schemaVersion: 1,
      reader: migrateReaderSettings(settings.reader),
      workspaces: Array.isArray(settings.workspaces) ? settings.workspaces : [],
      activeBookId: settings.activeBookId ?? null
    }
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const normalized: AppSettings = {
      schemaVersion: 1,
      reader: {
        ...DEFAULT_SETTINGS.reader,
        ...settings.reader
      },
      workspaces: settings.workspaces,
      activeBookId: settings.activeBookId
    }
    this.settingsWrite = this.settingsWrite.then(() => writeJsonAtomic(this.paths.settings, normalized))
    await this.settingsWrite
    return normalized
  }

  async getAnnotations(bookId: string): Promise<Annotation[]> {
    const file = path.join(this.getBookDirectory(bookId), 'annotations.json')
    const data = await readJson<AnnotationFile>(file, {
      schemaVersion: 1,
      annotations: []
    })
    return Array.isArray(data.annotations) ? data.annotations : []
  }

  async getAllAnnotations(): Promise<Annotation[]> {
    const library = await this.getLibrary()
    const groups = await Promise.all(
      library.books.map((book) => this.getAnnotations(book.id))
    )
    return groups.flat()
  }

  async saveAnnotation(annotation: Annotation): Promise<Annotation[]> {
    const annotations = await this.getAnnotations(annotation.bookId)
    const index = annotations.findIndex((item) => item.id === annotation.id)
    if (index >= 0) {
      annotations[index] = annotation
    } else {
      annotations.push(annotation)
    }
    await writeJsonAtomic(path.join(this.getBookDirectory(annotation.bookId), 'annotations.json'), {
      schemaVersion: 1,
      annotations
    } satisfies AnnotationFile)
    return annotations
  }

  async removeAnnotation(bookId: string, annotationId: string): Promise<Annotation[]> {
    const annotations = (await this.getAnnotations(bookId)).filter((item) => item.id !== annotationId)
    await writeJsonAtomic(path.join(this.getBookDirectory(bookId), 'annotations.json'), {
      schemaVersion: 1,
      annotations
    } satisfies AnnotationFile)
    return annotations
  }

  async getReadingState(bookId: string): Promise<ReadingState | null> {    const file = path.join(this.getBookDirectory(bookId), 'reading-state.json')
    try {
      return await readJson<ReadingState | null>(file, null)
    } catch {
      return null
    }
  }

  async saveReadingState(bookId: string, locator: ReadingLocator, progress: number): Promise<void> {
    const normalized = Math.max(0, Math.min(1, progress))
    await writeJsonAtomic(path.join(this.getBookDirectory(bookId), 'reading-state.json'), {
      schemaVersion: 1,
      locator,
      progress: normalized,
      updatedAt: new Date().toISOString()
    } satisfies ReadingState)

    const now = Date.now()
    const previous = this.progressSync.get(bookId)
    const due =
      !previous ||
      now - previous.at >= ReadexStorage.PROGRESS_SYNC_INTERVAL_MS ||
      Math.abs(normalized - previous.progress) >= ReadexStorage.PROGRESS_SYNC_DELTA
    if (!due) return

    this.progressSync.set(bookId, { at: now, progress: normalized })
    await this.updateBook(bookId, {
      lastLocation: locator,
      progress: normalized
    })
  }

  async getStats(): Promise<ReadingStats> {
    const stored = await readJson<ReadingStats>(this.paths.stats, DEFAULT_READING_STATS)
    const days: Record<string, number> = {}
    for (const [date, value] of Object.entries(stored.days ?? {})) {
      const seconds = Number(value)
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(seconds) && seconds > 0) {
        days[date] = Math.round(seconds)
      }
    }
    const books: Record<string, number> = {}
    for (const [bookId, value] of Object.entries(stored.books ?? {})) {
      const seconds = Number(value)
      if (bookId && Number.isFinite(seconds) && seconds > 0) books[bookId] = Math.round(seconds)
    }
    const totalSeconds = Number(stored.totalSeconds)
    return {
      schemaVersion: 1,
      totalSeconds: Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.round(totalSeconds) : 0,
      days,
      books,
      updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : undefined
    }
  }

  async addReadingTime(bookId: string, seconds: number): Promise<ReadingStats> {
    const amount = Math.max(0, Math.min(1200, Math.round(Number(seconds) || 0)))
    if (!amount) return this.getStats()
    const safeBookId = typeof bookId === 'string' && bookId.length <= 64 ? bookId : ''
    const run = this.statsWrite.then(async () => {
      const stats = await this.getStats()
      const date = localDateKey(new Date())
      stats.days[date] = (stats.days[date] ?? 0) + amount
      stats.totalSeconds += amount
      if (safeBookId) stats.books[safeBookId] = (stats.books[safeBookId] ?? 0) + amount
      const cutoff = localDateKey(new Date(Date.now() - 366 * 86_400_000))
      for (const key of Object.keys(stats.days)) {
        if (key < cutoff) delete stats.days[key]
      }
      stats.updatedAt = new Date().toISOString()
      await writeJsonAtomic(this.paths.stats, stats)
      return stats
    })
    this.statsWrite = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  async getProfileInfo(): Promise<ProfileInfo> {
    const books = (await this.getLibrary()).books
    let annotationCount = 0
    let sizeBytes = 0

    for (const book of books) {
      annotationCount += (await this.getAnnotations(book.id)).length
      sizeBytes += await directorySize(path.join(this.paths.books, book.id))
    }

    return {
      personalPath: this.paths.personal,
      cachePath: this.paths.cache,
      bookCount: books.length,
      annotationCount,
      sizeBytes,
      cacheBytes: await directorySize(this.paths.cache)
    }
  }

  async clearTtsCache(): Promise<{ freedBytes: number }> {
    const directory = this.paths.ttsCache
    const freedBytes = await directorySize(directory)
    await fs.rm(directory, { recursive: true, force: true })
    await fs.mkdir(directory, { recursive: true })
    return { freedBytes }
  }

  async resetPersonalData(): Promise<void> {
    this.progressSync.clear()
    await fs.rm(this.paths.personal, { recursive: true, force: true })
    await fs.mkdir(this.paths.books, { recursive: true })
    await writeJsonAtomic(this.paths.library, {
      schemaVersion: 1,
      books: []
    } satisfies LibraryData)
    await writeJsonAtomic(this.paths.settings, DEFAULT_SETTINGS)
    await writeJsonAtomic(this.paths.stats, DEFAULT_READING_STATS)
  }
}

export function migrateReaderSettings(
  input: Partial<AppSettings['reader']> | undefined
): AppSettings['reader'] {
  const reader = {
    ...DEFAULT_SETTINGS.reader,
    ...(input ?? {})
  }
  reader.ttsVoice =
    typeof input?.ttsVoice === 'string' && /^[A-Za-z0-9-]{3,80}$/.test(input.ttsVoice)
      ? input.ttsVoice
      : DEFAULT_TTS_VOICE
  reader.ttsRate = clampNumber(input?.ttsRate, TTS_MIN_RATE, TTS_MAX_RATE, 1)
  reader.ttsVolume = clampNumber(input?.ttsVolume, TTS_MIN_VOLUME, TTS_MAX_VOLUME, 1)
  reader.ttsEngine = input?.ttsEngine === 'system' ? 'system' : 'online'
  reader.systemTtsVoice =
    typeof input?.systemTtsVoice === 'string' ? input.systemTtsVoice.trim().slice(0, 120) : ''
  reader.readingLayout = input?.readingLayout === 'paginated' ? 'paginated' : 'scroll'
  reader.pageColumns = input?.pageColumns === 2 ? 2 : 1
  reader.pdfTwoPage = input?.pdfTwoPage === true
  reader.comicTwoPage = input?.comicTwoPage === true
  reader.dailyReadingGoalMinutes = Math.round(
    clampNumber(input?.dailyReadingGoalMinutes, 0, 600, 0)
  )
  if (input?.floatingReaderWidth === undefined) {
    reader.floatingReaderWidth = input?.contentWidth ?? reader.contentWidth
  }
  if (input?.floatingReaderHeight === undefined) {
    reader.floatingReaderHeight = DEFAULT_SETTINGS.reader.floatingReaderHeight
  }
  if (input?.autoScrollSpeed !== undefined && input.autoScrollSpeed <= 10) {
    reader.autoScrollSpeed = Math.max(
      1,
      Math.min(100, Math.round(input.autoScrollSpeed * 6 + 1))
    )
  } else if (input?.autoScrollSpeed !== undefined) {
    reader.autoScrollSpeed = Math.max(
      1,
      Math.min(100, Math.round(input.autoScrollSpeed))
    )
  }
  if (input?.pdfScale === 1.15) {
    reader.pdfScale = DEFAULT_SETTINGS.reader.pdfScale
  }
  const legacySerif =
    input?.fontFamily === '"Noto Serif SC", "Source Han Serif SC", "Songti SC", Georgia, serif'
  if (
    legacySerif &&
    input?.fontSize === 19 &&
    input?.lineHeight === 1.85 &&
    input?.contentWidth === 760
  ) {
    return {
      ...reader,
      fontFamily: DEFAULT_SETTINGS.reader.fontFamily,
      fontSize: DEFAULT_SETTINGS.reader.fontSize,
      lineHeight: DEFAULT_SETTINGS.reader.lineHeight,
      paragraphSpacing: DEFAULT_SETTINGS.reader.paragraphSpacing,
      letterSpacing: DEFAULT_SETTINGS.reader.letterSpacing,
      contentWidth: DEFAULT_SETTINGS.reader.contentWidth
    }
  }
  return reader
}

function clampNumber(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.min(maximum, value as number))
}

function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const COVER_EXTENSIONS: Record<string, string> = {
  '.png': 'png',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.webp': 'webp',
  '.gif': 'gif',
  '.bmp': 'bmp'
}

/** 解析旧版本保存的封面 data URL，供迁移和导入共用。 */
export function parseCoverDataUrl(
  value: string
): { bytes: Buffer; extension: string } | null {
  const match = /^data:image\/(png|jpe?g|webp|gif|bmp|avif|svg\+xml);base64,([a-z0-9+/=\s]+)$/i.exec(
    value
  )
  if (!match) return null
  const mime = match[1].toLowerCase()
  const extension = mime === 'jpeg' || mime === 'jpg' ? 'jpg' : mime === 'svg+xml' ? 'svg' : mime
  try {
    const bytes = Buffer.from(match[2], 'base64')
    if (!bytes.length || bytes.length > 4 * 1024 * 1024) return null
    return { bytes, extension }
  } catch {
    return null
  }
}

async function ensureJsonFile(filePath: string, fallback: unknown): Promise<void> {
  try {
    await fs.access(filePath)
  } catch {
    await writeJsonAtomic(filePath, fallback)
  }
}

async function directorySize(directory: string): Promise<number> {
  let total = 0
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      total += await directorySize(entryPath)
    } else if (entry.isFile()) {
      total += (await fs.stat(entryPath)).size
    }
  }
  return total
}
