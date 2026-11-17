export const BOOK_FORMATS = ['epub', 'mobi', 'azw3', 'pdf', 'txt', 'cbz'] as const

export type BookFormat = (typeof BOOK_FORMATS)[number]

export type ThemeMode = 'dark' | 'light' | 'sepia' | 'custom'
export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'pink'
export type AnnotationType = 'highlight' | 'comment' | 'bookmark'
/** How the auto-scroll reading focus is visualised. */
export type AutoScrollHighlightStyle = 'band' | 'sentence'
/** EPUB 阅读布局；其他格式始终使用连续滚动。 */
export type ReadingLayout = 'scroll' | 'paginated'
/** 漫画阅读方向；日漫通常为从右到左。 */
export type ReadingDirection = 'ltr' | 'rtl'

export interface BookMetadata {
  title: string
  author: string
  language?: string
  publisher?: string
  description?: string
  chapterCount?: number
}

/** 书库中允许用户手动修改的元数据字段。 */
export interface BookMetadataPatch {
  title: string
  author: string
  language?: string
  publisher?: string
  description?: string
  tags?: string[]
  readingDirection?: ReadingDirection
}

export interface BookRecord extends BookMetadata {
  id: string
  format: BookFormat
  fileName: string
  originalPath: string
  importedAt: string
  updatedAt: string
  size: number
  sha256: string
  /** 旧版本内嵌在 library.json 的封面，启动时迁移到 coverFile 后不再写入。 */
  coverDataUrl?: string
  /** personal/books/<bookId>/ 下的封面文件名，例如 cover.jpg。 */
  coverFile?: string
  /** 用户维护的书籍标签，最多 8 个。 */
  tags?: string[]
  /** 漫画阅读方向；缺省为从左到右。 */
  readingDirection?: ReadingDirection
  progress: number
  lastLocation?: ReadingLocator
}

export interface LibraryData {
  schemaVersion: 1
  books: BookRecord[]
}

export interface ReaderSettings {
  theme: ThemeMode
  backgroundColor: string
  textColor: string
  accentColor: string
  fontFamily: string
  fontSize: number
  lineHeight: number
  paragraphSpacing: number
  letterSpacing: number
  contentWidth: number
  floatingReaderWidth: number
  floatingReaderHeight: number
  /** 隐身模式：浮窗只留背景色与正文，装饰性 UI 悬停才浮现。 */
  floatingReaderStealth: boolean
  /** EPUB 阅读布局：连续滚动或分页。 */
  readingLayout: ReadingLayout
  /** 分页模式下宽窗口显示的栏数，1 或 2。 */
  pageColumns: 1 | 2
  /** 每日阅读目标（分钟），0 表示不设目标。 */
  dailyReadingGoalMinutes: number
  pdfScale: number
  /** PDF 夜间模式：反转画布亮度，避免暗色主题下白页刺眼。 */
  pdfNightMode: boolean
  /** PDF 双页：按行并排显示两页，适合宽屏。 */
  pdfTwoPage: boolean
  /** 漫画双页：宽窗口并排显示两页。 */
  comicTwoPage: boolean
  wheelScrollStep: number
  smoothScrolling: boolean
  autoScrollSpeed: number
  autoScrollColor: string
  autoScrollHighlight: boolean
  autoScrollHighlightStyle: AutoScrollHighlightStyle
  ttsVoice: string
  ttsRate: number
  ttsVolume: number
  /** 在线神经语音或系统离线语音。 */
  ttsEngine: 'online' | 'system'
  /** 系统语音名称；为空时自动选择中文语音。 */
  systemTtsVoice: string
}

export interface WorkspaceSession {
  bookId: string
  openedAt: string
}

export interface AppSettings {
  schemaVersion: 1
  reader: ReaderSettings
  workspaces: WorkspaceSession[]
  activeBookId: string | null
}

export type LocatorType =
  | 'epub-cfi'
  | 'pdf-rect'
  | 'text-offset'
  | 'mobi-offset'
  | 'comic-page'

export interface PdfRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ReadingLocator {
  type: LocatorType
  value: string
  chapterId?: string
  chapterHref?: string
  page?: number
  start?: number
  end?: number
  rects?: PdfRect[]
  excerpt?: string
  prefix?: string
  suffix?: string
}

export interface AnnotationRevision {
  note: string
  color: AnnotationColor
  updatedAt: string
}

export interface Annotation {
  id: string
  bookId: string
  type: AnnotationType
  color: AnnotationColor
  text: string
  note: string
  locator: ReadingLocator
  createdAt: string
  updatedAt: string
  /** 用户标签，最多 8 个，与书籍标签共用同一套规范化规则。 */
  tags?: string[]
  /** 最近 10 次编辑前的笔记与颜色快照。 */
  revisions?: AnnotationRevision[]
}

export interface AnnotationFile {
  schemaVersion: 1
  annotations: Annotation[]
}

export interface ReadingState {
  schemaVersion: 1
  locator: ReadingLocator | null
  progress: number
  updatedAt: string
}

/** 按本地日期聚合的阅读时长，秒为单位。 */
export interface ReadingStats {
  schemaVersion: 1
  totalSeconds: number
  days: Record<string, number>
  books: Record<string, number>
  updatedAt?: string
}

export const DEFAULT_READING_STATS: ReadingStats = {
  schemaVersion: 1,
  totalSeconds: 0,
  days: {},
  books: {}
}

export interface TocItem {
  id: string
  label: string
  href?: string
  chapterId?: string
  /** 章内文本偏移；用于 TXT 这类按固定块分章后的标题定位。 */
  start?: number
  children?: TocItem[]
}

export interface NormalizedChapter {
  id: string
  label: string
  html: string
  text: string
}

export interface ComicPage {
  index: number
  fileName: string
  mime: string
}

export interface BookContent {
  format: BookFormat
  toc: TocItem[]
  chapters?: NormalizedChapter[]
  pages?: ComicPage[]
  text?: string
}

export interface ImportJob {
  id: string
  path: string
  fileName: string
  status: 'queued' | 'checking' | 'importing' | 'success' | 'skipped' | 'failed' | 'cancelled'
  progress: number
  message?: string
  bookId?: string
}

export interface ImportBatchResult {
  jobs: ImportJob[]
  books: BookRecord[]
}

export interface ImportProgressEvent {
  batchId: string
  job: ImportJob
  completed: number
  total: number
}

export interface SearchResult {
  id: string
  bookId?: string
  bookTitle?: string
  source: 'text' | 'annotation'
  title: string
  excerpt: string
  locator?: ReadingLocator
}

export interface ChapterProgress {
  label: string
  current: number
  total: number
  percent: number
}

export interface ProfileInfo {
  personalPath: string
  cachePath: string
  bookCount: number
  annotationCount: number
  sizeBytes: number
  cacheBytes: number
}

export interface BackupResult {
  canceled: boolean
  filePath?: string
}

export interface RestoreProfileResult {
  restored: boolean
  message?: string
}

export interface ClearProfileResult {
  cleared: boolean
}

export interface WindowState {
  maximized: boolean
  fullscreen: boolean
}

export interface FloatingReaderSync {
  settings: AppSettings
  locator: ReadingLocator | null
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: 'dark',
  backgroundColor: '#212121',
  textColor: '#ececec',
  accentColor: '#5b9cf6',
  fontFamily: '"Segoe UI Variable Text", "Microsoft YaHei UI", "PingFang SC", sans-serif',
  fontSize: 17,
  lineHeight: 1.78,
  paragraphSpacing: 0.78,
  letterSpacing: 0,
  contentWidth: 860,
  floatingReaderWidth: 860,
  floatingReaderHeight: 200,
  floatingReaderStealth: false,
  readingLayout: 'scroll',
  pageColumns: 1,
  dailyReadingGoalMinutes: 0,
  pdfScale: 1,
  pdfNightMode: false,
  pdfTwoPage: false,
  comicTwoPage: false,
  wheelScrollStep: 48,
  smoothScrolling: true,
  autoScrollSpeed: 25,
  autoScrollColor: '#b7e4c7',
  autoScrollHighlight: true,
  autoScrollHighlightStyle: 'band',
  ttsVoice: 'zh-CN-XiaoxiaoNeural',
  ttsRate: 1,
  ttsVolume: 1,
  ttsEngine: 'online',
  systemTtsVoice: ''
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  reader: DEFAULT_READER_SETTINGS,
  workspaces: [],
  activeBookId: null
}

type ThemePalette = Pick<
  ReaderSettings,
  'backgroundColor' | 'textColor' | 'accentColor'
>

export const THEME_PRESETS: Record<Exclude<ThemeMode, 'custom'>, ThemePalette> = {
  dark: {
    backgroundColor: '#212121',
    textColor: '#ececec',
    accentColor: '#5b9cf6'
  },
  light: {
    backgroundColor: '#ffffff',
    textColor: '#0d0d0d',
    accentColor: '#2563eb'
  },
  sepia: {
    backgroundColor: '#f3ead8',
    textColor: '#3e3427',
    accentColor: '#9a5b2d'
  }
}

/**
 * Historical preset generations, newest first. A profile that still carries one
 * of these exact palettes is silently upgraded to the current Codex-style colors,
 * so older installs pick up the refreshed shell without touching genuinely custom
 * colors.
 */
export const LEGACY_THEME_PRESETS: readonly Record<
  Exclude<ThemeMode, 'custom'>,
  ThemePalette
>[] = [
  {
    // Codex 灰白强调色一代：深色主题用近白强调色，浅色主题用近黑强调色。
    // 现在统一升级为蓝/橙强调色。
    dark: {
      backgroundColor: '#212121',
      textColor: '#ececec',
      accentColor: '#f5f5f5'
    },
    light: {
      backgroundColor: '#ffffff',
      textColor: '#0d0d0d',
      accentColor: '#0d0d0d'
    },
    sepia: {
      backgroundColor: '#f3ead8',
      textColor: '#3e3427',
      accentColor: '#9a5b2d'
    }
  },
  {
    // First public release: warm shell.
    dark: {
      backgroundColor: '#1c1a18',
      textColor: '#eae6e0',
      accentColor: '#e08a5a'
    },
    light: {
      backgroundColor: '#f7f4ef',
      textColor: '#37312a',
      accentColor: '#b95c33'
    },
    sepia: {
      backgroundColor: '#f3ead8',
      textColor: '#3e3427',
      accentColor: '#9a5b2d'
    }
  },
  {
    // Pre-refresh default: neutral gray shell with a blue accent.
    dark: {
      backgroundColor: '#171717',
      textColor: '#e8e8e8',
      accentColor: '#60a5fa'
    },
    light: {
      backgroundColor: '#ffffff',
      textColor: '#242424',
      accentColor: '#2563eb'
    },
    sepia: {
      backgroundColor: '#f3ead8',
      textColor: '#3e3427',
      accentColor: '#9a5b2d'
    }
  }
]

export function upgradeLegacyThemeColors(
  reader: ReaderSettings
): ReaderSettings {
  const theme = reader.theme
  if (theme === 'custom') return reader
  const matchesLegacy = LEGACY_THEME_PRESETS.some(
    (generation) =>
      reader.backgroundColor === generation[theme].backgroundColor &&
      reader.textColor === generation[theme].textColor &&
      reader.accentColor === generation[theme].accentColor
  )
  return matchesLegacy ? { ...reader, ...THEME_PRESETS[theme] } : reader
}

export const ANNOTATION_COLORS: Record<AnnotationColor, string> = {
  yellow: '#f5c542',
  green: '#57b894',
  blue: '#5b9cf6',
  pink: '#e978a8'
}
