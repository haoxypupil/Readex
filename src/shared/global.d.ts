import type {
  Annotation,
  AppSettings,
  BackupResult,
  BookContent,
  BookMetadataPatch,
  BookRecord,
  ClearProfileResult,
  FloatingReaderSync,
  ImportBatchResult,
  ImportProgressEvent,
  LibraryData,
  ProfileInfo,
  ReadingLocator,
  ReadingState,
  ReadingStats,
  RestoreProfileResult,
  SearchResult,
  WindowState,
  WorkspaceSession
} from './types'
import type { TtsSynthesisRequest, TtsSynthesisResult } from './speech'

export interface ReadexApi {
  library: {
    list: () => Promise<LibraryData>
    chooseAndImport: () => Promise<ImportBatchResult | null>
    importPaths: (paths: string[]) => Promise<ImportBatchResult>
    remove: (bookId: string, deleteSource: boolean) => Promise<void>
    updateMetadata: (bookId: string, patch: BookMetadataPatch) => Promise<BookRecord | null>
    chooseCover: (bookId: string) => Promise<BookRecord | null>
    saveGeneratedCover: (bookId: string, dataUrl: string) => Promise<BookRecord | null>
    cancelImport: () => Promise<boolean>
    reveal: (bookId: string) => Promise<void>
  }
  book: {
    getResourceUrl: (bookId: string, format: BookRecord['format']) => string
    getContent: (bookId: string) => Promise<BookContent | null>
    getRecord: (bookId: string) => Promise<BookRecord | null>
  }
  annotations: {
    list: (bookId: string) => Promise<Annotation[]>
    listAll: () => Promise<Annotation[]>
    save: (annotation: Annotation) => Promise<Annotation[]>
    remove: (bookId: string, annotationId: string) => Promise<Annotation[]>
    exportMarkdown: (bookId: string, markdown: string) => Promise<boolean>
  }
  settings: {
    get: () => Promise<AppSettings>
    update: (settings: AppSettings) => Promise<AppSettings>
  }
  search: {
    global: (query: string) => Promise<SearchResult[]>
    globalText: (query: string) => Promise<SearchResult[]>
    inBook: (bookId: string, query: string) => Promise<SearchResult[]>
  }
  speech: {
    synthesize: (request: TtsSynthesisRequest) => Promise<TtsSynthesisResult>
  }
  reading: {
    getState: (bookId: string) => Promise<ReadingState | null>
    saveState: (bookId: string, locator: ReadingLocator, progress: number) => Promise<void>
  }
  stats: {
    get: () => Promise<ReadingStats>
    addReadingTime: (bookId: string, seconds: number) => Promise<ReadingStats>
  }
  profile: {
    info: () => Promise<ProfileInfo>
    backup: () => Promise<BackupResult>
    restore: () => Promise<RestoreProfileResult>
    clearTtsCache: () => Promise<{ freedBytes: number }>
    clear: () => Promise<ClearProfileResult>
    open: () => Promise<void>
    copyPath: () => Promise<string>
  }
  system: {
    getVersion: () => Promise<string>
    getPathForFile: (file: File) => string
    openExternal: (url: string) => Promise<void>
  }
  windowControl: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    quit: () => Promise<void>
    setFullScreen: (value: boolean) => Promise<void>
    setTitleBarTheme: (color: string, symbolColor: string) => Promise<void>
    openFloatingReader: (
      bookId: string,
      width: number,
      height: number,
      locator: ReadingLocator | null
    ) => Promise<boolean>
    minimizeFloatingReader: () => Promise<void>
    closeFloatingReader: () => Promise<void>
    setFloatingReaderShadow: (enabled: boolean) => Promise<void>
    beginFloatingDrag: (screenX: number, screenY: number) => Promise<boolean>
    moveFloatingDrag: (screenX: number, screenY: number) => void
    endFloatingDrag: () => Promise<void>
    state: () => Promise<WindowState>
    onStateChange: (callback: (state: WindowState) => void) => () => void
    onFloatingReaderRestored: (callback: () => void) => () => void
    onFloatingReaderSync: (callback: (value: FloatingReaderSync) => void) => () => void
  }
  import: {
    onProgress: (callback: (event: ImportProgressEvent) => void) => () => void
  }
}

declare global {
  interface Window {
    readex: ReadexApi
  }
}

export {}
