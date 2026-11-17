import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Minimize2,
  ListTree,
  Maximize2,
  NotebookPen,
  PictureInPicture2,
  Search,
  Settings2,
  X
} from 'lucide-react'
import type {
  Annotation,
  AnnotationColor,
  AnnotationType,
  BookRecord,
  ChapterProgress,
  ReadingLocator,
  ReaderSettings,
  SearchResult,
  TocItem
} from '@shared/types'
import { annotationsToMarkdown, createAnnotationUpdate } from '../lib/notes'
import { normalizeBookTags } from '@shared/bookTags'
import { bookCoverSrc } from '../lib/covers'
import {
  findAdjacentTocItem,
  findTocItemById,
  findTocItemForLocator,
  findTocProgress
} from '../lib/toc'
import type { SelectedText } from '../lib/textAnchors'
import {
  SpeechPlaybackController,
  type SpeechPlaybackState
} from '../lib/speech'
import { useFloatingWindowDrag } from '../lib/floatingDrag'
import { EpubReader } from '../readers/EpubReader'
import { PdfReader } from '../readers/PdfReader'
import { ComicReader } from '../readers/ComicReader'
import { TextFlowReader } from '../readers/TextFlowReader'
import type { ReaderHandle } from '../readers/types'
import { NotesPanel } from './NotesPanel'
import { NotesHoverCard } from './NotesHoverCard'
import { ReaderScrollControls } from './ReaderScrollControls'
import { SelectionContextMenu } from './SelectionContextMenu'
import { SelectionToolbar } from './SelectionToolbar'
import { TocPanel } from './TocPanel'

interface ReaderViewProps {
  book: BookRecord
  settings: ReaderSettings
  initialLocator: ReadingLocator | null
  onBack: () => void
  onOpenSettings: () => void
  onProgress: (bookId: string, locator: ReadingLocator, progress: number) => void
  onChapterProgress: (progress: ChapterProgress | null) => void
  onAnnotationsChanged: () => void
  onAutoScrollSpeedChange: (speed: number) => void
  onTtsSettingsChange: (
    patch: Partial<
      Pick<
        ReaderSettings,
        'ttsVoice' | 'ttsRate' | 'ttsVolume' | 'ttsEngine' | 'systemTtsVoice'
      >
    >
  ) => void
  onComicTwoPageChange?: (enabled: boolean) => void
  floatingWindow?: boolean
}

type Panel = 'toc' | 'notes' | null
type ReaderCommand =
  | 'previous-chapter'
  | 'next-chapter'
  | 'open-search'
  | 'toggle-bookmark'
  | 'toggle-auto-scroll'
  | 'toggle-immersive'
interface ContextMenuState {
  x: number
  y: number
}

export function ReaderView({
  book,
  settings,
  initialLocator,
  onBack,
  onOpenSettings,
  onProgress,
  onChapterProgress,
  onAnnotationsChanged,
  onAutoScrollSpeedChange,
  onTtsSettingsChange,
  onComicTwoPageChange,
  floatingWindow = false
}: ReaderViewProps): React.JSX.Element {
  const readerRef = useRef<ReaderHandle>(null)
  const speechSettingsRef = useRef(settings)
  const speechControllerRef = useRef<SpeechPlaybackController | null>(null)
  const floatingDrag = useFloatingWindowDrag(floatingWindow)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [toc, setToc] = useState<TocItem[]>([])
  const [activeTocId, setActiveTocId] = useState<string | undefined>()
  const [panel, setPanel] = useState<Panel>(null)
  const [selection, setSelection] = useState<SelectedText | null>(null)
  const [selectionMenu, setSelectionMenu] = useState<ContextMenuState | null>(null)
  const [noteEditorOpen, setNoteEditorOpen] = useState(false)
  const [activeAnnotation, setActiveAnnotation] = useState<Annotation | null>(null)
  const [notesHoverOpen, setNotesHoverOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchIndex, setSearchIndex] = useState(-1)
  const [searchedQuery, setSearchedQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState('')
  const [autoScrollOn, setAutoScrollOn] = useState(false)
  const [immersive, setImmersive] = useState(false)
  const [speechState, setSpeechState] = useState<SpeechPlaybackState>('idle')
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null)
  const sleepTimerRef = useRef<number | null>(null)
  const progressTimer = useRef<number | null>(null)
  const currentLocatorRef = useRef<ReadingLocator | null>(initialLocator)
  const overlayRoot = document.querySelector<HTMLElement>('.app-shell') ?? document.body

  useEffect(() => {
    speechSettingsRef.current = settings
  }, [settings])

  if (!speechControllerRef.current) {
    speechControllerRef.current = new SpeechPlaybackController({
      getReader: () => readerRef.current,
      getSettings: () => speechSettingsRef.current,
      synthesize: (request) => window.readex.speech.synthesize(request),
      onStateChange: setSpeechState,
      onMessage: setMessage
    })
  }

  useEffect(() => {
    let active = true
    void window.readex.annotations.list(book.id).then((items) => {
      if (active) setAnnotations(items)
    })
    return () => {
      active = false
    }
  }, [book.id])

  useEffect(() => {
    currentLocatorRef.current = initialLocator
  }, [book.id, initialLocator])

  useEffect(() => {
    if (!initialLocator) return
    const timer = window.setTimeout(() => readerRef.current?.goTo(initialLocator), 450)
    return () => window.clearTimeout(timer)
  }, [initialLocator])

  // 只有 ReaderView 挂载且窗口在前台时才累计阅读时长。
  useEffect(() => {
    let active = document.visibilityState === 'visible' && document.hasFocus()
    let last = Date.now()
    const flush = (countWhenInactive = false): void => {
      const now = Date.now()
      const seconds = Math.round((now - last) / 1000)
      last = now
      if ((active || countWhenInactive) && seconds >= 5) {
        void window.readex.stats.addReadingTime(book.id, seconds)
      }
    }
    const timer = window.setInterval(() => flush(), 30_000)
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        flush()
        active = false
      } else {
        active = document.hasFocus()
        last = Date.now()
      }
    }
    const onFocus = (): void => {
      active = true
      last = Date.now()
    }
    const onBlur = (): void => {
      flush()
      active = false
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      flush(active)
    }
  }, [book.id])

  useEffect(() => {
    onChapterProgress(findTocProgress(toc, activeTocId))
  }, [activeTocId, onChapterProgress, toc])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 3500)
    return () => window.clearTimeout(timer)
  }, [message])

  useEffect(() => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults([])
    setSearchIndex(-1)
    setSearchedQuery('')
  }, [book.id])

  const stopAutoScroll = useCallback((notice?: string): void => {
    readerRef.current?.stopAutoScroll()
    setAutoScrollOn(false)
    if (notice) setMessage(notice)
  }, [])

  const handleAutoScrollEnd = useCallback((): void => {
    setAutoScrollOn(false)
    setMessage('已到文档结尾，自动滚动已停止')
  }, [])

  const stopSpeech = useCallback((): void => {
    speechControllerRef.current?.stop()
  }, [])

  const engineRef = useRef(settings.ttsEngine)
  useEffect(() => {
    if (engineRef.current === settings.ttsEngine) return
    engineRef.current = settings.ttsEngine
    stopSpeech()
  }, [settings.ttsEngine, stopSpeech])

  useEffect(() => {
    // 切换布局会重建 EPUB rendition，旧的听书句段和自动滚动控制器随即失效。
    stopSpeech()
    stopAutoScroll()
  }, [settings.pageColumns, settings.readingLayout, stopAutoScroll, stopSpeech])

  const toggleSpeech = useCallback(async (): Promise<void> => {
    if (speechState === 'idle') {
      stopAutoScroll()
      if (selection?.text) setMessage('从选中位置开始朗读')
    }
    await speechControllerRef.current?.toggle(selection?.text)
  }, [selection, speechState, stopAutoScroll])

  const armSleepTimer = useCallback((minutes: number | null): void => {
    if (sleepTimerRef.current) {
      window.clearTimeout(sleepTimerRef.current)
      sleepTimerRef.current = null
    }
    setSleepMinutes(minutes)
    if (!minutes) return
    sleepTimerRef.current = window.setTimeout(() => {
      sleepTimerRef.current = null
      setSleepMinutes(null)
      speechControllerRef.current?.stop()
      setMessage(`定时听书已结束（${minutes} 分钟）`)
    }, minutes * 60_000)
  }, [])

  useEffect(() => {
    if (speechState !== 'idle' || !sleepTimerRef.current) return
    window.clearTimeout(sleepTimerRef.current)
    sleepTimerRef.current = null
    setSleepMinutes(null)
  }, [speechState])

  const toggleAutoScroll = useCallback((): void => {
    if (book.format === 'cbz') {
      setMessage('漫画阅读不支持自动滚动')
      return
    }
    if (book.format === 'epub' && settings.readingLayout === 'paginated') {
      setMessage('分页模式不支持自动滚动，可在显示设置中切换为连续滚动')
      return
    }
    if (autoScrollOn) {
      stopAutoScroll()
      return
    }
    stopSpeech()
    const result = readerRef.current?.startAutoScroll()
    if (result === 'started') {
      setAutoScrollOn(true)
      setMessage('自动滚动已开启，正文将匀速前进')
      return
    }
    setMessage(result === 'end' ? '已经到达文档结尾' : '当前内容无法自动滚动')
  }, [autoScrollOn, book.format, settings.readingLayout, stopAutoScroll, stopSpeech])

  const toggleImmersive = useCallback((): void => {
    setImmersive((current) => !current)
    setPanel(null)
    setSearchOpen(false)
    setSelectionMenu(null)
    setNoteEditorOpen(false)
  }, [])

  const pageBy = useCallback((direction: 1 | -1): void => {
    const stage = document.querySelector<HTMLElement>('.reader-stage')
    const height = stage?.clientHeight ?? 600
    readerRef.current?.scrollBy(direction * Math.max(240, height * 0.85))
  }, [])

  const enterFloatingReader = useCallback((): void => {
    stopSpeech()
    setPanel(null)
    setSearchOpen(false)
    setSelectionMenu(null)
    void window.readex.windowControl.openFloatingReader(
      book.id,
      settings.floatingReaderWidth,
      settings.floatingReaderHeight,
      currentLocatorRef.current
    )
  }, [
    book.id,
    settings.floatingReaderHeight,
    settings.floatingReaderWidth,
    stopSpeech
  ])

  const exitFloatingReader = useCallback((): void => {
    stopSpeech()
    void window.readex.windowControl.closeFloatingReader()
  }, [stopSpeech])

  useEffect(() => {
    return () => {
      if (progressTimer.current) window.clearTimeout(progressTimer.current)
      if (sleepTimerRef.current) window.clearTimeout(sleepTimerRef.current)
      readerRef.current?.stopAutoScroll()
      speechControllerRef.current?.destroy()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (document.querySelector('.modal-backdrop')) return
      if (immersive) {
        event.preventDefault()
        setImmersive(false)
        return
      }
      if (!floatingWindow) return
      event.preventDefault()
      exitFloatingReader()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [exitFloatingReader, floatingWindow, immersive])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('.modal-backdrop')) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const pageDown = event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)
      const pageUp = event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)
      if (!pageDown && !pageUp) return
      if (event.key === ' ' && target?.closest('button, a, [role="button"], [role="menuitem"]')) {
        return
      }
      event.preventDefault()
      stopAutoScroll()
      pageBy(pageDown ? 1 : -1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pageBy, stopAutoScroll])

  useEffect(() => {
    const exportListener = (): void => {
      void exportNotes()
    }
    const panelListener = (event: Event): void => {
      const next = (event as CustomEvent<Panel>).detail
      setPanel(next)
    }
    const commandListener = (event: Event): void => {
      const command = (event as CustomEvent<ReaderCommand>).detail
      if (command === 'open-search') {
        if (book.format === 'cbz') {
          setMessage('漫画暂不支持书内搜索')
          return
        }
        setSearchOpen(true)
        return
      }
      if (command === 'toggle-bookmark') {
        void toggleCurrentBookmark()
        return
      }
      if (command === 'toggle-auto-scroll') {
        toggleAutoScroll()
        return
      }
      if (command === 'toggle-immersive') {
        toggleImmersive()
        return
      }

      const item = findAdjacentTocItem(
        toc,
        activeTocId,
        command === 'previous-chapter' ? 'previous' : 'next'
      )
      if (!item) {
        setMessage(command === 'previous-chapter' ? '已经是第一章' : '已经是最后一章')
        return
      }
      setActiveTocId(item.id)
      readerRef.current?.goTo(item)
    }
    window.addEventListener('readex:export-notes', exportListener)
    window.addEventListener('readex:set-panel', panelListener as EventListener)
    window.addEventListener('readex:reader-command', commandListener as EventListener)
    return () => {
      window.removeEventListener('readex:export-notes', exportListener)
      window.removeEventListener('readex:set-panel', panelListener as EventListener)
      window.removeEventListener('readex:reader-command', commandListener as EventListener)
    }
  }, [activeTocId, annotations, book.id, toc, toggleAutoScroll, toggleImmersive])

  const saveAnnotation = async (
    color: AnnotationColor,
    note: string,
    forcedType?: AnnotationType,
    tags?: string[]
  ): Promise<void> => {
    const locator = activeAnnotation?.locator ?? selection?.locator
    const text = activeAnnotation?.text ?? selection?.text
    if (!locator || !text) return
    const now = new Date().toISOString()
    const normalizedTags = tags !== undefined ? normalizeBookTags(tags) : undefined
    const annotation: Annotation = activeAnnotation
      ? createAnnotationUpdate(activeAnnotation, color, note, now, tags)
      : {
          id: crypto.randomUUID(),
          bookId: book.id,
          type: forcedType ?? (note.trim() ? 'comment' : 'highlight'),
          color,
          text,
          note,
          locator,
          createdAt: now,
          updatedAt: now,
          ...(normalizedTags?.length ? { tags: normalizedTags } : {})
        }
    const next = await window.readex.annotations.save(annotation)
    setAnnotations(next)
    setSelection(null)
    setSelectionMenu(null)
    setNoteEditorOpen(false)
    setActiveAnnotation(null)
    onAnnotationsChanged()
    setMessage(activeAnnotation ? '笔记已保存' : note ? '笔记已添加' : '高亮已保存')
  }

  const deleteAnnotation = async (annotation: Annotation): Promise<void> => {
    const next = await window.readex.annotations.remove(book.id, annotation.id)
    setAnnotations(next)
    if (activeAnnotation?.id === annotation.id) setActiveAnnotation(null)
    onAnnotationsChanged()
    setMessage('笔记已删除')
  }

  const runSearch = async (): Promise<void> => {
    const query = searchQuery.trim()
    if (!query) {
      clearSearch()
      return
    }
    setSearching(true)
    try {
      const results = await readerRef.current?.search(query)
      setSearchResults(results ?? [])
      setSearchIndex(-1)
      setSearchedQuery(query)
      readerRef.current?.setSearchHighlight(null)
    } finally {
      setSearching(false)
    }
  }

  const selectSearchResult = (index: number): void => {
    if (!searchResults.length) return
    const normalized = ((index % searchResults.length) + searchResults.length) % searchResults.length
    const result = searchResults[normalized]
    setSearchIndex(normalized)
    if (result.locator) readerRef.current?.goTo(result.locator)
    readerRef.current?.setSearchHighlight(result)
  }

  const stepSearch = (delta: number): void => {
    if (!searchResults.length) return
    if (searchIndex < 0) {
      selectSearchResult(delta > 0 ? 0 : searchResults.length - 1)
      return
    }
    selectSearchResult(searchIndex + delta)
  }

  const clearSearch = (): void => {
    setSearchResults([])
    setSearchIndex(-1)
    setSearchedQuery('')
    readerRef.current?.setSearchHighlight(null)
  }

  const closeSearch = (): void => {
    setSearchOpen(false)
    clearSearch()
  }

  const handleProgress = useCallback(
    (locator: ReadingLocator, progress: number): void => {
      currentLocatorRef.current = locator
      if (locator.value.trim()) {
        const activeItem = findTocItemForLocator(toc, locator)
        if (activeItem) setActiveTocId(activeItem.id)
      }
      onProgress(book.id, locator, progress)
      if (!locator.value.trim()) return
      if (progressTimer.current) window.clearTimeout(progressTimer.current)
      progressTimer.current = window.setTimeout(() => {
        void window.readex.reading.saveState(book.id, locator, progress)
      }, 650)
    },
    [book.id, onProgress, toc]
  )

  const onSelection = useCallback((value: SelectedText): void => {
    setActiveAnnotation(null)
    setSelectionMenu(null)
    setNoteEditorOpen(false)
    setSelection(value)
  }, [])

  const onSelectionContextMenu = useCallback(
    (value: SelectedText, point: { x: number; y: number }): void => {
      setActiveAnnotation(null)
      setSelection(value)
      setNoteEditorOpen(false)
      setSelectionMenu(point)
    },
    []
  )

  const closeSelectionMenu = useCallback((): void => {
    setSelectionMenu(null)
  }, [])

  const onReaderInteraction = useCallback((): void => {
    closeSelectionMenu()
    stopAutoScroll()
  }, [closeSelectionMenu, stopAutoScroll])

  const onOpenAnnotation = useCallback(
    (annotation: Annotation): void => {
      setSelection(null)
      setActiveAnnotation(annotation)
      setNoteEditorOpen(true)
      setPanel('notes')
      readerRef.current?.goTo(annotation.locator)
    },
    []
  )

  const exportNotes = async (): Promise<void> => {
    const saved = await window.readex.annotations.exportMarkdown(
      book.id,
      annotationsToMarkdown(book, annotations)
    )
    if (saved) setMessage('Markdown 笔记已导出')
  }

  const addBookmark = async (): Promise<void> => {
    const current = activeAnnotation?.locator ?? selection?.locator
    const text = activeAnnotation?.text ?? selection?.text
    if (!current || !text) return
    const duplicate = annotations.some(
      (annotation) =>
        annotation.type === 'bookmark' &&
        annotation.locator.type === current.type &&
        annotation.locator.value === current.value
    )
    if (duplicate) {
      setSelectionMenu(null)
      setMessage('该位置已经添加过书签')
      return
    }
    await saveAnnotation('blue', '', 'bookmark')
    setMessage('书签已添加')
  }

  const toggleCurrentBookmark = async (): Promise<void> => {
    const locator = currentLocatorRef.current
    if (!locator?.value.trim()) {
      setMessage('当前位置尚未加载完成')
      return
    }
    const existing = annotations.find(
      (annotation) =>
        annotation.type === 'bookmark' &&
        annotation.locator.type === locator.type &&
        annotation.locator.value === locator.value
    )
    if (existing) {
      const next = await window.readex.annotations.remove(book.id, existing.id)
      setAnnotations(next)
      onAnnotationsChanged()
      setMessage('当前位置书签已移除')
      return
    }

    const currentChapter = findTocItemById(toc, activeTocId)
    const now = new Date().toISOString()
    const annotation: Annotation = {
      id: crypto.randomUUID(),
      bookId: book.id,
      type: 'bookmark',
      color: 'blue',
      text: currentChapter?.label || locator.excerpt?.trim() || '阅读位置',
      note: '',
      locator,
      createdAt: now,
      updatedAt: now
    }
    const next = await window.readex.annotations.save(annotation)
    setAnnotations(next)
    onAnnotationsChanged()
    setMessage('当前位置书签已添加')
  }

  useEffect(() => {
    if (!selectionMenu || !selection) return
    const closeOnPointer = (): void => setSelectionMenu(null)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSelectionMenu(null)
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setSelectionMenu(null)
        setNoteEditorOpen(true)
      }
      if (event.key.toLowerCase() === 'c') {
        event.preventDefault()
        void navigator.clipboard.writeText(selection.text)
        setSelectionMenu(null)
        setMessage('已复制选中文本')
      }
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault()
        void addBookmark()
      }
    }
    window.addEventListener('pointerdown', closeOnPointer)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', closeOnPointer)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [selectionMenu, selection])

  const reader = useMemo(() => {
    const common = {
      book,
      settings,
      annotations,
      onSelection,
      onSelectionContextMenu,
      onReaderPointerDown: onReaderInteraction,
      onOpenAnnotation,
      onProgress: handleProgress,
      onTocChange: setToc,
      onError: setMessage,
      onAutoScrollEnd: handleAutoScrollEnd,
      onComicTwoPageChange,
      floatingDragHandlers: floatingWindow ? floatingDrag : undefined
    }
    if (book.format === 'epub') return <EpubReader ref={readerRef} {...common} />
    if (book.format === 'pdf') return <PdfReader ref={readerRef} {...common} />
    if (book.format === 'cbz') return <ComicReader ref={readerRef} {...common} />
    // AZW3 走 MOBI 解析与 mobi-offset 定位，渲染路径完全一致。
    return (
      <TextFlowReader
        ref={readerRef}
        {...common}
        format={book.format === 'azw3' ? 'mobi' : book.format}
      />
    )
  }, [
    annotations,
    book,
    handleAutoScrollEnd,
    handleProgress,
    onOpenAnnotation,
    onSelection,
    onSelectionContextMenu,
    onReaderInteraction,
    settings,
    floatingDrag,
    floatingWindow
  ])

  return (
    <main
      className={`reader-view ${floatingWindow ? 'floating-reader-window' : ''} ${immersive ? 'immersive' : ''}`}
      onPointerDownCapture={(event) => floatingDrag.onPointerDown(event.nativeEvent)}
      onPointerMoveCapture={(event) => floatingDrag.onPointerMove(event.nativeEvent)}
      onPointerUpCapture={(event) => floatingDrag.onPointerUp(event.nativeEvent)}
      onPointerCancelCapture={(event) => floatingDrag.onPointerUp(event.nativeEvent)}
    >
      <header className="reader-toolbar">
        <div className="reader-toolbar-left">
          <button className="icon-button" type="button" title="返回书库" onClick={onBack}>
            <ChevronLeft size={18} />
          </button>
          <span className="reader-mini-cover">
            {bookCoverSrc(book) ? (
              <img src={bookCoverSrc(book)} alt="" />
            ) : (
              <BookOpen size={16} />
            )}
          </span>
          <div className="reader-heading">
            <strong>{book.title}</strong>
            <span>{book.author || '未知作者'}</span>
          </div>
        </div>
        <div className="reader-toolbar-actions">
          <button
            className={`toolbar-text-button ${panel === 'toc' ? 'active' : ''}`}
            type="button"
            onClick={() => setPanel(panel === 'toc' ? null : 'toc')}
          >
            <ListTree size={16} />
            目录
          </button>
          <div
            className="notes-hover-anchor"
            onMouseEnter={() => setNotesHoverOpen(true)}
            onMouseLeave={() => setNotesHoverOpen(false)}
            onFocus={() => setNotesHoverOpen(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setNotesHoverOpen(false)
              }
            }}
          >
            <button
              className={`toolbar-text-button ${panel === 'notes' ? 'active' : ''}`}
              type="button"
              aria-expanded={notesHoverOpen}
              onClick={() => setPanel(panel === 'notes' ? null : 'notes')}
            >
              <NotebookPen size={16} />
              笔记
              {annotations.length > 0 && <span className="toolbar-count">{annotations.length}</span>}
            </button>
            {notesHoverOpen && (
              <NotesHoverCard
                annotations={annotations}
                onOpenAll={() => {
                  setNotesHoverOpen(false)
                  setPanel('notes')
                }}
                onSelect={(annotation) => {
                  setNotesHoverOpen(false)
                  setActiveAnnotation(annotation)
                  readerRef.current?.goTo(annotation.locator)
                }}
              />
            )}
          </div>
          {book.format !== 'cbz' && (
            <button
              className={`icon-button ${searchOpen ? 'active' : ''}`}
              type="button"
              title="书内搜索"
              onClick={() => setSearchOpen((value) => !value)}
            >
              <Search size={17} />
            </button>
          )}
          <button className="icon-button" type="button" title="阅读设置" onClick={onOpenSettings}>
            <Settings2 size={17} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="浮框阅读"
            onClick={enterFloatingReader}
          >
            <PictureInPicture2 size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="全屏"
            onClick={() => void window.readex.windowControl.maximize()}
          >
            <Maximize2 size={16} />
          </button>
        </div>
      </header>

      <div
        className="reader-workspace"
        onContextMenu={(event) => {
          event.preventDefault()
          if (!selection) return
          setSelectionMenu({ x: event.clientX, y: event.clientY })
        }}
        onPointerDown={onReaderInteraction}
      >
        <div className="reader-stage">
          {reader}
          <ReaderScrollControls
            step={settings.wheelScrollStep}
            onScroll={(delta) => {
              stopAutoScroll()
              readerRef.current?.scrollBy(delta)
            }}
            autoScrollOn={autoScrollOn}
            autoScrollSpeed={settings.autoScrollSpeed}
            onToggleAutoScroll={toggleAutoScroll}
            onAutoScrollSpeedChange={onAutoScrollSpeedChange}
            speechState={speechState}
            speechVoice={settings.ttsVoice}
            speechRate={settings.ttsRate}
            speechVolume={settings.ttsVolume}
            ttsEngine={settings.ttsEngine}
            systemTtsVoice={settings.systemTtsVoice}
            onToggleSpeech={() => void toggleSpeech()}
            onStopSpeech={stopSpeech}
            onTtsSettingsChange={onTtsSettingsChange}
            sleepMinutes={sleepMinutes}
            onSleepMinutesChange={armSleepTimer}
            paged={
              book.format === 'cbz' ||
              (book.format === 'epub' && settings.readingLayout === 'paginated')
            }
            showSpeech={book.format !== 'cbz'}
            floating={floatingWindow}
            onExitFloating={exitFloatingReader}
          />
        </div>

        {searchOpen && (
          <aside className="search-panel">
            <div className="search-panel-header">
              <div className="search-field">
                <Search size={15} />
                <input
                  autoFocus
                  value={searchQuery}
                  placeholder="在当前书中搜索"
                  onChange={(event) => {
                    setSearchQuery(event.target.value)
                    if (!event.target.value.trim()) clearSearch()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      if (event.shiftKey) {
                        stepSearch(-1)
                      } else if (
                        searchResults.length > 0 &&
                        searchQuery.trim() === searchedQuery
                      ) {
                        stepSearch(1)
                      } else {
                        void runSearch()
                      }
                    }
                    if (event.key === 'Escape') closeSearch()
                  }}
                />
              </div>
              <button className="icon-button subtle" type="button" onClick={closeSearch}>
                <X size={16} />
              </button>
            </div>
            <button
              className="secondary-button search-submit"
              type="button"
              onClick={() => void runSearch()}
            >
              {searching ? '正在搜索…' : '搜索'}
            </button>
            {searchResults.length > 0 && (
              <div className="search-nav">
                <span>
                  {searchIndex >= 0
                    ? `${searchIndex + 1} / ${searchResults.length}`
                    : `共 ${searchResults.length} 条`}
                </span>
                <div>
                  <button
                    type="button"
                    title="上一条（Shift+Enter）"
                    onClick={() => stepSearch(-1)}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    title="下一条（Enter）"
                    onClick={() => stepSearch(1)}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
            )}
            <div className="search-result-list">
              {searchResults.map((result, index) => (
                <button
                  type="button"
                  key={result.id}
                  className={index === searchIndex ? 'active' : undefined}
                  onClick={() => selectSearchResult(index)}
                >
                  <strong>{result.title}</strong>
                  <span>{result.excerpt}</span>
                </button>
              ))}
              {!searching && searchQuery && searchResults.length === 0 && (
                <div className="panel-empty">没有找到匹配内容</div>
              )}
            </div>
          </aside>
        )}

        {panel && (
          <aside className="reader-side-panel">
            {panel === 'toc' ? (
              <TocPanel
                items={toc}
                activeId={activeTocId}
                onSelect={(item) => {
                  setActiveTocId(item.id)
                  readerRef.current?.goTo(item)
                }}
              />
            ) : (
              <NotesPanel
                annotations={annotations}
                activeId={activeAnnotation?.id}
                onSelect={(annotation) => {
                  setActiveAnnotation(annotation)
                  readerRef.current?.goTo(annotation.locator)
                }}
                onDelete={(annotation) => void deleteAnnotation(annotation)}
                onExport={() => void exportNotes()}
              />
            )}
          </aside>
        )}
      </div>

      <footer className="reader-statusbar">
        <span>{book.format.toUpperCase()}</span>
        <span className="status-separator" />
        <span>{annotations.length} 条标注</span>
        <span className="status-spacer" />
        <span>数据已保存在 personal 目录</span>
      </footer>

      {selectionMenu && selection && (
        createPortal(
          <SelectionContextMenu
            x={selectionMenu.x}
            y={selectionMenu.y}
            onAddNote={() => {
              setSelectionMenu(null)
              setNoteEditorOpen(true)
            }}
            onCopy={() => {
              void navigator.clipboard.writeText(selection.text)
              setSelectionMenu(null)
              setMessage('已复制选中文本')
            }}
            onBookmark={() => void addBookmark()}
            onHighlight={(color) => void saveAnnotation(color, '')}
            onClose={() => setSelectionMenu(null)}
          />,
          overlayRoot
        )
      )}

      {(noteEditorOpen && selection) || activeAnnotation ? (
        createPortal(
          <SelectionToolbar
            key={activeAnnotation?.id ?? selection?.locator.value}
            selection={selection ?? undefined}
            annotation={activeAnnotation ?? undefined}
            initialNoteOpen={noteEditorOpen || Boolean(activeAnnotation)}
            onSave={(color, note, tags) => void saveAnnotation(color, note, undefined, tags)}
            onDelete={
              activeAnnotation ? () => void deleteAnnotation(activeAnnotation) : undefined
            }
            onClose={() => {
              setSelection(null)
              setActiveAnnotation(null)
              setNoteEditorOpen(false)
              window.getSelection()?.removeAllRanges()
            }}
          />,
          overlayRoot
        )
      ) : null}

      {message && createPortal(<div className="toast">{message}</div>, overlayRoot)}

      {immersive && (
        <button
          className="immersive-exit"
          type="button"
          title="退出沉浸阅读（Esc）"
          onClick={() => setImmersive(false)}
        >
          <Minimize2 size={14} />
          退出沉浸
        </button>
      )}
    </main>
  )
}
