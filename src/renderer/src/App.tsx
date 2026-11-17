import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type {
  Annotation,
  AppSettings,
  BookRecord,
  ChapterProgress,
  ImportBatchResult,
  ImportJob,
  LibraryData,
  ReadingLocator,
  ReadingStats
} from '@shared/types'
import { DEFAULT_SETTINGS, upgradeLegacyThemeColors } from '@shared/types'
import { ConfirmDialog } from './components/ConfirmDialog'
import { BookInfoDialog } from './components/BookInfoDialog'
import { ImportOverlay } from './components/ImportOverlay'
import { InfoDialog } from './components/InfoDialog'
import { LibraryView } from './components/LibraryView'
import { NotesDashboard } from './components/NotesDashboard'
import { ProfileDialog } from './components/ProfileDialog'
import { SearchView } from './components/SearchView'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { StatsView } from './components/StatsView'
import { TitleBar, type MenuGroup } from './components/TitleBar'
import { THEME_PRESETS } from '@shared/types'
import logoUrl from './assets/readex-logo.png'
import { createAppThemeStyle, createTitleBarTheme } from './lib/theme'

const ReaderView = lazy(() =>
  import('./components/ReaderView').then((module) => ({ default: module.ReaderView }))
)

type View = 'library' | 'notes' | 'search' | 'stats' | 'book'
type InfoMode = 'shortcuts' | 'about' | 'licenses'

export default function App(): React.JSX.Element {
  const [library, setLibrary] = useState<LibraryData>({ schemaVersion: 1, books: [] })
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [annotationsLoaded, setAnnotationsLoaded] = useState(false)
  const [annotationsLoading, setAnnotationsLoading] = useState(false)
  const [stats, setStats] = useState<ReadingStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [chapterProgress, setChapterProgress] = useState<ChapterProgress | null>(null)
  const [view, setView] = useState<View>('library')
  const [activeBookId, setActiveBookId] = useState<string | null>(null)
  const [initialLocator, setInitialLocator] = useState<ReadingLocator | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [infoMode, setInfoMode] = useState<InfoMode | null>(null)
  const [version, setVersion] = useState('0.1.0')
  const [importJobs, setImportJobs] = useState<ImportJob[]>([])
  const [importCompleted, setImportCompleted] = useState(0)
  const [importTotal, setImportTotal] = useState(0)
  const [importing, setImporting] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<BookRecord | null>(null)
  const [editTarget, setEditTarget] = useState<BookRecord | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const importCloseTimer = useRef<number | null>(null)
  const latestSettings = useRef(settings)
  latestSettings.current = settings

  const refreshLibrary = useCallback(async (): Promise<BookRecord[]> => {
    const value = await window.readex.library.list()
    setLibrary(value)
    return value.books
  }, [])

  useEffect(() => {
    const refresh = (): void => {
      void refreshLibrary()
    }
    window.addEventListener('readex:library-updated', refresh)
    return () => window.removeEventListener('readex:library-updated', refresh)
  }, [refreshLibrary])

  const loadAllAnnotations = useCallback(async (): Promise<void> => {
    setAnnotationsLoading(true)
    try {
      setAnnotations(await window.readex.annotations.listAll())
      setAnnotationsLoaded(true)
    } finally {
      setAnnotationsLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.all([
      window.readex.settings.get(),
      window.readex.library.list(),
      window.readex.system.getVersion()
    ]).then(([storedSettings, storedLibrary, appVersion]) => {
      const ids = new Set(storedLibrary.books.map((book) => book.id))
      const workspaces = storedSettings.workspaces.filter((workspace) => ids.has(workspace.bookId))
      const restoredActive =
        storedSettings.activeBookId && ids.has(storedSettings.activeBookId)
          ? storedSettings.activeBookId
          : workspaces.at(-1)?.bookId ?? null
      setSettings({
        ...storedSettings,
        reader: upgradeLegacyThemeColors(storedSettings.reader),
        workspaces,
        activeBookId: restoredActive
      })
      setLibrary(storedLibrary)
      setVersion(appVersion)
      setActiveBookId(restoredActive)
      setView(restoredActive ? 'book' : 'library')
      setHydrated(true)
    })
  }, [])

  useEffect(() => {
    if (!hydrated || view !== 'notes' || annotationsLoaded) return
    void loadAllAnnotations()
  }, [annotationsLoaded, hydrated, loadAllAnnotations, view])

  useEffect(() => {
    if (!hydrated || view !== 'stats') return
    let active = true
    setStatsLoading(true)
    void window.readex.stats
      .get()
      .then((value) => {
        if (active) setStats(value)
      })
      .finally(() => {
        if (active) setStatsLoading(false)
      })
    return () => {
      active = false
    }
  }, [hydrated, view])

  useEffect(() => {
    if (!hydrated) return
    // 拖动排版滑块会高频触发设置变化，合并成一次落盘。
    const timer = window.setTimeout(() => {
      void window.readex.settings.update(latestSettings.current)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [hydrated, settings])

  useEffect(() => {
    const flush = (): void => {
      void window.readex.settings.update(latestSettings.current)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const modalDimAmount = settingsOpen
      ? 0.18
      : profileOpen || infoMode || removeTarget || editTarget
        ? 0.48
        : 0
    const titleBarTheme = createTitleBarTheme(settings.reader, modalDimAmount)
    void window.readex.windowControl.setTitleBarTheme(
      titleBarTheme.color,
      titleBarTheme.symbolColor
    )
  }, [
    hydrated,
    infoMode,
    profileOpen,
    removeTarget,
    editTarget,
    settings.reader.backgroundColor,
    settings.reader.textColor,
    settingsOpen
  ])

  useEffect(() => {
    return window.readex.import.onProgress((event) => {
      setImporting(true)
      setImportTotal(event.total)
      setImportCompleted(event.completed)
      setImportJobs((current) => {
        const index = current.findIndex((job) => job.id === event.job.id)
        if (index < 0) return [...current, event.job]
        const next = [...current]
        next[index] = event.job
        return next
      })
    })
  }, [])

  useEffect(() => {
    return window.readex.windowControl.onFloatingReaderRestored(() => {
      void (async () => {
        const [storedSettings, readingState] = await Promise.all([
          window.readex.settings.get(),
          activeBookId
            ? window.readex.reading.getState(activeBookId)
            : Promise.resolve(null)
        ])
        setSettings({
          ...storedSettings,
          reader: upgradeLegacyThemeColors(storedSettings.reader)
        })
        if (!activeBookId || !readingState?.locator) return

        setInitialLocator(readingState.locator)
        setLibrary((current) => {
          const index = current.books.findIndex((book) => book.id === activeBookId)
          if (index < 0) return current
          const books = [...current.books]
          books[index] = {
            ...books[index],
            progress: readingState.progress,
            lastLocation: readingState.locator ?? books[index].lastLocation,
            updatedAt: new Date().toISOString()
          }
          return { ...current, books }
        })
      })()
    })
  }, [activeBookId])

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      const modifier = event.ctrlKey || event.metaKey
      const target = event.target instanceof HTMLElement ? event.target : null
      const editingText = Boolean(
        target?.matches('input, textarea, select, [contenteditable="true"]')
      )
      const modalOpen =
        settingsOpen ||
        profileOpen ||
        Boolean(infoMode) ||
        Boolean(removeTarget) ||
        Boolean(editTarget)
      if (editingText || modalOpen) return
      if (modifier && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void importFromDialog()
      } else if (modifier && event.key === ',') {
        event.preventDefault()
        setSettingsOpen(true)
      } else if (modifier && event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        setView('library')
      } else if (modifier && event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('readex:set-panel', { detail: 'toc' }))
      } else if (modifier && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('readex:set-panel', { detail: 'notes' }))
      } else if (modifier && event.shiftKey && event.key.toLowerCase() === 'a' && view === 'book') {
        event.preventDefault()
        dispatchReaderCommand('toggle-auto-scroll')
      } else if (modifier && event.key === 'PageUp' && view === 'book') {
        event.preventDefault()
        dispatchReaderCommand('previous-chapter')
      } else if (modifier && event.key === 'PageDown' && view === 'book') {
        event.preventDefault()
        dispatchReaderCommand('next-chapter')
      } else if (
        modifier &&
        event.shiftKey &&
        event.key.toLowerCase() === 'f' &&
        view === 'book'
      ) {
        event.preventDefault()
        dispatchReaderCommand('toggle-immersive')
      } else if (modifier && event.key.toLowerCase() === 'f' && view === 'book') {
        event.preventDefault()
        dispatchReaderCommand('open-search')
      } else if (modifier && event.key.toLowerCase() === 'd' && view === 'book') {
        event.preventDefault()
        dispatchReaderCommand('toggle-bookmark')
      } else if (
        modifier &&
        (event.key === '=' || event.key === '+') &&
        view === 'book'
      ) {
        event.preventDefault()
        changeReadingScale(1)
      } else if (modifier && event.key === '-' && view === 'book') {
        event.preventDefault()
        changeReadingScale(-1)
      } else if (modifier && event.key === '0' && view === 'book') {
        event.preventDefault()
        resetReadingScale()
      } else if (modifier && event.key.toLowerCase() === 'w' && activeBookId) {
        event.preventDefault()
        closeWorkspace(activeBookId)
      } else if (event.key === 'F11') {
        event.preventDefault()
        void toggleFullScreen()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  })

  const completeImport = async (
    action: Promise<ImportBatchResult | null>
  ): Promise<void> => {
    if (importCloseTimer.current) window.clearTimeout(importCloseTimer.current)
    const result = await action
    if (!result) {
      setImporting(false)
      setImportJobs([])
      return
    }
    await refreshLibrary()
    if (result.books.length === 1) {
      openBook(result.books[0].id)
    } else if (result.books.length > 1) {
      openBook(result.books[0].id)
    } else {
      setView('library')
    }
    importCloseTimer.current = window.setTimeout(() => {
      setImporting(false)
      setImportJobs([])
    }, 900)
  }

  const importFromDialog = async (): Promise<void> => {
    await completeImport(window.readex.library.chooseAndImport())
  }

  const importPaths = async (paths: string[]): Promise<void> => {
    setImporting(true)
    setImportCompleted(0)
    setImportTotal(paths.length)
    setImportJobs([])
    await completeImport(window.readex.library.importPaths(paths))
  }

  const openBook = (bookId: string, locator: ReadingLocator | null = null): void => {
    const exists = settings.workspaces.some((workspace) => workspace.bookId === bookId)
    setSettings((current) => ({
      ...current,
      activeBookId: bookId,
      workspaces: exists
        ? current.workspaces
        : [...current.workspaces, { bookId, openedAt: new Date().toISOString() }]
    }))
    setInitialLocator(locator)
    setChapterProgress(null)
    setActiveBookId(bookId)
    setView('book')
  }

  const closeWorkspace = (bookId: string): void => {
    setSettings((current) => {
      const workspaces = current.workspaces.filter((workspace) => workspace.bookId !== bookId)
      const nextActive =
        current.activeBookId === bookId
          ? workspaces.at(-1)?.bookId ?? null
          : current.activeBookId
      setActiveBookId(nextActive)
      setView(nextActive ? 'book' : 'library')
      return {
        ...current,
        workspaces,
        activeBookId: nextActive
      }
    })
  }

  const handleBookProgress = useCallback(
    (bookId: string, locator: ReadingLocator, progress: number): void => {
      const normalizedProgress = Math.max(0, Math.min(1, progress))
      setLibrary((current) => {
        const index = current.books.findIndex((book) => book.id === bookId)
        if (index < 0) return current
        const existing = current.books[index]
        // 滚动时 EPUB CFI 每帧都变，但界面只关心进度和章节；
        // 只在这两者变化时更新书库状态，避免每个滚动事件都重渲染整棵树。
        const chapterChanged =
          (existing.lastLocation?.chapterHref ?? '') !== (locator.chapterHref ?? '') ||
          (existing.lastLocation?.chapterId ?? '') !== (locator.chapterId ?? '') ||
          existing.lastLocation?.page !== locator.page
        const progressChanged = Math.abs(existing.progress - normalizedProgress) >= 0.001
        if (!chapterChanged && !progressChanged) return current

        const books = [...current.books]
        books[index] = {
          ...existing,
          progress: normalizedProgress,
          lastLocation: locator,
          updatedAt: new Date().toISOString()
        }
        return { ...current, books }
      })
    },
    []
  )

  const removeBook = async (): Promise<void> => {
    if (!removeTarget) return
    await window.readex.library.remove(removeTarget.id, true)
    setSettings((current) => ({
      ...current,
      workspaces: current.workspaces.filter(
        (workspace) => workspace.bookId !== removeTarget.id
      ),
      activeBookId:
        current.activeBookId === removeTarget.id ? null : current.activeBookId
    }))
    if (activeBookId === removeTarget.id) {
      setActiveBookId(null)
      setView('library')
    }
    setRemoveTarget(null)
    await refreshLibrary()
    setAnnotationsLoaded(false)
  }

  const toggleFullScreen = async (): Promise<void> => {
    const state = await window.readex.windowControl.state()
    await window.readex.windowControl.setFullScreen(!state.fullscreen)
  }

  const cycleTheme = (): void => {
    const order = ['dark', 'light', 'sepia'] as const
    const currentIndex = order.indexOf(settings.reader.theme as (typeof order)[number])
    const theme = order[(currentIndex + 1) % order.length]
    setSettings((current) => ({
      ...current,
      reader: { ...current.reader, theme, ...THEME_PRESETS[theme] }
    }))
  }

  const changeReadingScale = (direction: -1 | 1): void => {
    if (activeBook?.format === 'cbz') return
    setSettings((current) => ({
      ...current,
      reader: {
        ...current.reader,
        ...(activeBook?.format === 'pdf'
          ? {
              pdfScale: Math.max(
                0.6,
                Math.min(2.2, Number((current.reader.pdfScale + direction * 0.05).toFixed(2)))
              )
            }
          : {
              fontSize: Math.max(13, Math.min(34, current.reader.fontSize + direction))
            })
      }
    }))
  }

  const resetReadingScale = (): void => {
    if (activeBook?.format === 'cbz') return
    setSettings((current) => ({
      ...current,
      reader: {
        ...current.reader,
        ...(activeBook?.format === 'pdf'
          ? { pdfScale: DEFAULT_SETTINGS.reader.pdfScale }
          : { fontSize: DEFAULT_SETTINGS.reader.fontSize })
      }
    }))
  }

  const dispatchReaderCommand = (
    command:
      | 'previous-chapter'
      | 'next-chapter'
      | 'open-search'
      | 'toggle-bookmark'
      | 'toggle-auto-scroll'
      | 'toggle-immersive'
  ): void => {
    window.dispatchEvent(new CustomEvent('readex:reader-command', { detail: command }))
  }

  const handleProfileChanged = async (): Promise<void> => {
    setSettings(DEFAULT_SETTINGS)
    setActiveBookId(null)
    setView('library')
    setAnnotations([])
    setAnnotationsLoaded(false)
    await refreshLibrary()
  }

  const activeBook = activeBookId
    ? library.books.find((book) => book.id === activeBookId) ?? null
    : null

  const menus: MenuGroup[] = [
    {
      label: '文件',
      items: [
        { label: '导入图书…', shortcut: 'Ctrl+O', onSelect: () => void importFromDialog() },
        {
          label: '导出当前笔记…',
          disabled: view !== 'book',
          onSelect: () => window.dispatchEvent(new Event('readex:export-notes'))
        },
        {
          label: '编辑书籍信息…',
          disabled: !activeBook,
          onSelect: () => activeBook && setEditTarget(activeBook)
        },
        { label: '', separator: true, onSelect: () => undefined },
        {
          label: '关闭当前工作区',
          shortcut: 'Ctrl+W',
          disabled: !activeBook,
          onSelect: () => activeBook && closeWorkspace(activeBook.id)
        },
        { label: '', separator: true, onSelect: () => undefined },
        {
          label: '打开个人资料目录',
          onSelect: () => void window.readex.profile.open()
        },
        { label: '个人资料管理…', onSelect: () => setProfileOpen(true) },
        { label: '', separator: true, onSelect: () => undefined },
        { label: '退出 Readex', onSelect: () => void window.readex.windowControl.close() }
      ]
    },
    {
      label: '阅读',
      items: [
        {
          label: '上一章',
          shortcut: 'Ctrl+PageUp',
          disabled: view !== 'book' || !chapterProgress || chapterProgress.current <= 1,
          onSelect: () => dispatchReaderCommand('previous-chapter')
        },
        {
          label: '下一章',
          shortcut: 'Ctrl+PageDown',
          disabled:
            view !== 'book' ||
            !chapterProgress ||
            chapterProgress.current >= chapterProgress.total,
          onSelect: () => dispatchReaderCommand('next-chapter')
        },
        { label: '', separator: true, onSelect: () => undefined },
        {
          label: '书内搜索',
          shortcut: 'Ctrl+F',
          disabled: view !== 'book' || activeBook?.format === 'cbz',
          onSelect: () => dispatchReaderCommand('open-search')
        },
        {
          label: '添加/移除书签',
          shortcut: 'Ctrl+D',
          disabled: view !== 'book',
          onSelect: () => dispatchReaderCommand('toggle-bookmark')
        },
        {
          label: '开始/暂停自动滚动',
          shortcut: 'Ctrl+Shift+A',
          disabled: view !== 'book' || activeBook?.format === 'cbz',
          onSelect: () => dispatchReaderCommand('toggle-auto-scroll')
        },
        { label: '', separator: true, onSelect: () => undefined },
        {
          label: activeBook?.format === 'pdf' ? '放大页面' : '增大字号',
          shortcut: 'Ctrl+=',
          disabled: view !== 'book' || activeBook?.format === 'cbz',
          onSelect: () => changeReadingScale(1)
        },
        {
          label: activeBook?.format === 'pdf' ? '缩小页面' : '减小字号',
          shortcut: 'Ctrl+-',
          disabled: view !== 'book' || activeBook?.format === 'cbz',
          onSelect: () => changeReadingScale(-1)
        },
        {
          label: activeBook?.format === 'pdf' ? '恢复默认缩放' : '恢复默认字号',
          shortcut: 'Ctrl+0',
          disabled: view !== 'book' || activeBook?.format === 'cbz',
          onSelect: resetReadingScale
        },
        { label: '', separator: true, onSelect: () => undefined },
        { label: '阅读设置…', shortcut: 'Ctrl+,', onSelect: () => setSettingsOpen(true) }
      ]
    },
    {
      label: '视图',
      items: [
        {
          label: '全部书籍',
          shortcut: 'Ctrl+Shift+B',
          checked: view === 'library',
          onSelect: () => setView('library')
        },
        {
          label: '阅读统计',
          checked: view === 'stats',
          onSelect: () => setView('stats')
        },
        {
          label: '全文搜索',
          checked: view === 'search',
          onSelect: () => setView('search')
        },
        {
          label: '目录',
          shortcut: 'Ctrl+Shift+T',
          onSelect: () =>
            window.dispatchEvent(new CustomEvent('readex:set-panel', { detail: 'toc' }))
        },
        {
          label: '笔记',
          shortcut: 'Ctrl+Shift+N',
          onSelect: () =>
            window.dispatchEvent(new CustomEvent('readex:set-panel', { detail: 'notes' }))
        },
        { label: '', separator: true, onSelect: () => undefined },
        {
          label: '沉浸阅读',
          shortcut: 'Ctrl+Shift+F',
          disabled: view !== 'book',
          onSelect: () => dispatchReaderCommand('toggle-immersive')
        },
        { label: '切换阅读主题', onSelect: cycleTheme },
        { label: '', separator: true, onSelect: () => undefined },
        { label: '全屏', shortcut: 'F11', onSelect: () => void toggleFullScreen() }
      ]
    },
    {
      label: '帮助',
      items: [
        { label: '键盘快捷键', onSelect: () => setInfoMode('shortcuts') },
        { label: '第三方许可', onSelect: () => setInfoMode('licenses') },
        { label: '', separator: true, onSelect: () => undefined },
        { label: '关于 Readex', onSelect: () => setInfoMode('about') }
      ]
    }
  ]

  if (!hydrated) {
    return (
      <div className="app-loading">
        <span className="brand-mark large">
          <img src={logoUrl} alt="" />
        </span>
        <strong>Readex</strong>
        <span>正在准备个人资料库…</span>
      </div>
    )
  }

  return (
    <div
      className="app-shell"
      data-app-theme={settings.reader.theme}
      style={createAppThemeStyle(settings.reader)}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        dragDepth.current += 1
        setDragActive(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault()
        dragDepth.current -= 1
        if (dragDepth.current <= 0) setDragActive(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        dragDepth.current = 0
        setDragActive(false)
        if (!event.dataTransfer.files.length) return
        const paths = Array.from(event.dataTransfer.files)
          .map((file) => window.readex.system.getPathForFile(file))
          .filter(Boolean)
        if (paths.length) void importPaths(paths)
      }}
    >
      <TitleBar
        menus={menus}
        bookTitle={activeBook?.title}
        bookProgress={view === 'book' ? activeBook?.progress ?? 0 : null}
        chapterProgress={view === 'book' ? chapterProgress : null}
        onBack={view === 'library' ? undefined : () => setView('library')}
      />
      <div className="app-body">
        <Sidebar
          collapsed={sidebarCollapsed}
          books={library.books}
          workspaceIds={settings.workspaces.map((workspace) => workspace.bookId)}
          activeBookId={activeBookId}
          currentView={view}
          onToggle={() => setSidebarCollapsed((value) => !value)}
          onOpenLibrary={() => setView('library')}
          onOpenStats={() => setView('stats')}
          onOpenSearch={() => setView('search')}
          onOpenBook={openBook}
          onCloseWorkspace={closeWorkspace}
          onOpenNotes={() => setView('notes')}
          onImport={() => void importFromDialog()}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenProfile={() => setProfileOpen(true)}
        />

        <div className="app-content">
          {view === 'library' && (
            <LibraryView
              books={library.books}
              importing={importing}
              onImport={() => void importFromDialog()}
              onImportPaths={importPaths}
              onOpenBook={openBook}
              onReveal={(bookId) => void window.readex.library.reveal(bookId)}
              onEdit={setEditTarget}
              onRemove={setRemoveTarget}
            />
          )}
          {view === 'notes' && (
            <NotesDashboard
              books={library.books}
              annotations={annotations}
              loading={annotationsLoading}
              onOpenBook={(bookId, annotation) => openBook(bookId, annotation.locator)}
            />
          )}
          {view === 'stats' && (
            <StatsView
              stats={stats}
              books={library.books}
              loading={statsLoading}
              goalMinutes={settings.reader.dailyReadingGoalMinutes}
            />
          )}
          {view === 'search' && (
            <SearchView
              books={library.books}
              onOpenBook={(bookId, locator) => openBook(bookId, locator)}
            />
          )}
          {view === 'book' && activeBook && (
            <Suspense
              fallback={
                <div className="reader-module-loading">
                  <span className="loading-orb" />
                  <span>正在打开阅读器…</span>
                </div>
              }
            >
              <ReaderView
                book={activeBook}
                settings={settings.reader}
                initialLocator={initialLocator}
                onBack={() => setView('library')}
                onOpenSettings={() => setSettingsOpen(true)}
                onProgress={handleBookProgress}
                onChapterProgress={setChapterProgress}
                onAnnotationsChanged={() => setAnnotationsLoaded(false)}
                onAutoScrollSpeedChange={(autoScrollSpeed) =>
                  setSettings((current) => ({
                    ...current,
                    reader: {
                      ...current.reader,
                      autoScrollSpeed: Math.max(1, Math.min(100, autoScrollSpeed))
                    }
                  }))
                }
                onTtsSettingsChange={(patch) =>
                  setSettings((current) => ({
                    ...current,
                    reader: {
                      ...current.reader,
                      ...patch
                    }
                  }))
                }
                onComicTwoPageChange={(comicTwoPage) =>
                  setSettings((current) => ({
                    ...current,
                    reader: { ...current.reader, comicTwoPage }
                  }))
                }
              />
            </Suspense>
          )}
        </div>
      </div>

      {dragActive && view !== 'library' && (
        <div className="global-drop-overlay">
          <span className="drop-icon">＋</span>
          <strong>释放以导入电子书</strong>
          <span>书籍将复制到个人资料库</span>
        </div>
      )}
      {importing && (
        <ImportOverlay
          jobs={importJobs}
          completed={importCompleted}
          total={importTotal}
          onCancel={() => void window.readex.library.cancelImport()}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          settings={settings.reader}
          onChange={(reader) => setSettings((current) => ({ ...current, reader }))}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {profileOpen && (
        <ProfileDialog
          onClose={() => setProfileOpen(false)}
          onChanged={() => void handleProfileChanged()}
        />
      )}
      {infoMode && (
        <InfoDialog mode={infoMode} version={version} onClose={() => setInfoMode(null)} />
      )}
      {removeTarget && (
        <ConfirmDialog
          title="从个人资料库移除？"
          body={`“${removeTarget.title}”的本地副本、阅读进度和笔记都会被删除。你导入前的原始文件不会被删除。`}
          confirmLabel="移除书籍"
          danger
          onConfirm={() => void removeBook()}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
      {editTarget && (
        <BookInfoDialog
          book={library.books.find((book) => book.id === editTarget.id) ?? editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => void refreshLibrary()}
        />
      )}
    </div>
  )
}
