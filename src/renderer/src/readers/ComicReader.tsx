import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Columns2,
  LoaderCircle
} from 'lucide-react'
import type {
  ComicPage,
  ReadingDirection,
  ReadingLocator,
  SearchResult,
  TocItem
} from '@shared/types'
import { getComicPageUrl } from '@shared/bookResource'
import type { AutoScrollStatus, ReaderHandle, ReaderProps } from './types'
import { clampComicPage, snapSpreadStart } from '../lib/comicPages'
import { ReaderError, ReaderLoading } from './TextFlowReader'

export const ComicReader = forwardRef<ReaderHandle, ReaderProps>(function ComicReader(
  {
    book,
    settings,
    onProgress,
    onTocChange,
    onError,
    onReaderPointerDown,
    onComicTwoPageChange
  },
  ref
): React.JSX.Element {
  const [pages, setPages] = useState<ComicPage[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [imageLoading, setImageLoading] = useState(true)
  const [twoPageActive, setTwoPageActive] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const lastTurnRef = useRef(0)
  const pendingPageRef = useRef<number | null>(null)
  const loadedCountRef = useRef(0)
  const expectedImagesRef = useRef(1)
  const pageCount = pages.length
  const rtl = book.readingDirection === 'rtl'

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void window.readex.book
      .getContent(book.id)
      .then(async (content) => {
        if (!active) return
        const list = content?.format === 'cbz' ? content.pages ?? [] : []
        if (!list.length) throw new Error('漫画中没有可显示的图片')
        setPages(list)
        onTocChange(
          list.map((item) => ({
            id: `comic-page-${item.index + 1}`,
            label: `第 ${item.index + 1} 页`,
            chapterId: String(item.index + 1)
          }))
        )
        const state = await window.readex.reading.getState(book.id)
        const saved = state?.locator?.page ?? Number(state?.locator?.chapterId) ?? 1
        setPage(clampComicPage(pendingPageRef.current ?? saved, list.length))
        pendingPageRef.current = null
        setLoading(false)
      })
      .catch((reason) => {
        if (!active) return
        const message = reason instanceof Error ? reason.message : '漫画加载失败'
        setError(message)
        onError(message)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [book.id, onError, onTocChange])

  useEffect(() => {
    if (!pageCount) return
    onProgress(
      {
        type: 'comic-page',
        value: String(page),
        page,
        chapterId: String(page),
        excerpt: ''
      },
      page / pageCount
    )
  }, [onProgress, page, pageCount])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const updateWidth = (): void => {
      setTwoPageActive(settings.comicTwoPage && root.clientWidth >= 760)
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(root)
    return () => observer.disconnect()
  }, [settings.comicTwoPage])

  // 双页组合固定为 (1,2)、(3,4)，开启双页后把起始页对齐到奇数页。
  useEffect(() => {
    if (!twoPageActive) return
    setPage((current) => snapSpreadStart(current))
  }, [twoPageActive])

  // 页组变化时重置加载指示，等所有图片加载完成后隐藏 spinner。
  useEffect(() => {
    loadedCountRef.current = 0
    expectedImagesRef.current = twoPageActive && page < pageCount ? 2 : 1
    setImageLoading(true)
  }, [page, pageCount, twoPageActive])

  const goToPage = useCallback(
    (next: number): void => {
      if (!pageCount) return
      const target = clampComicPage(next, pageCount)
      setPage(twoPageActive ? snapSpreadStart(target) : target)
    },
    [pageCount, twoPageActive]
  )

  const turnPage = useCallback(
    (delta: number): void => {
      if (!pageCount || !delta) return
      onReaderPointerDown()
      const step = twoPageActive ? 2 : 1
      goToPage(page + delta * step)
    },
    [goToPage, onReaderPointerDown, page, pageCount, twoPageActive]
  )

  const goTo = (target: ReadingLocator | TocItem): void => {
    const raw =
      'page' in target && target.page !== undefined
        ? target.page
        : 'chapterId' in target && target.chapterId
          ? Number(target.chapterId)
          : 'value' in target
            ? Number(target.value)
            : Number.NaN
    if (!Number.isFinite(raw)) return
    if (!pageCount) {
      pendingPageRef.current = raw
      return
    }
    goToPage(raw)
  }

  useEffect(() => {
    const root = rootRef.current
    if (!root || loading) return
    const onWheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      event.preventDefault()
      const now = Date.now()
      if (now - lastTurnRef.current < 260) return
      lastTurnRef.current = now
      turnPage(event.deltaY > 0 ? 1 : -1)
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [loading, turnPage])

  // 方向键翻页：从右到左时左方向键表示下一页。
  useEffect(() => {
    if (loading || !pageCount) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.matches('input, textarea, select, [contenteditable="true"]')
      ) {
        return
      }
      if (document.querySelector('.modal-backdrop')) return
      event.preventDefault()
      const forward = rtl ? event.key === 'ArrowLeft' : event.key === 'ArrowRight'
      turnPage(forward ? 1 : -1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [loading, pageCount, rtl, turnPage])

  useEffect(() => {
    if (!pageCount || page >= pageCount) return
    const step = twoPageActive ? 2 : 1
    const upcoming = twoPageActive ? [page + step, page + step + 1] : [page + step]
    const images = upcoming
      .filter((candidate) => candidate <= pageCount)
      .map((candidate) => {
        const image = new Image()
        image.src = getComicPageUrl(book.id, candidate - 1)
        return image
      })
    return () => {
      images.forEach((image) => {
        image.src = ''
      })
    }
  }, [book.id, page, pageCount, twoPageActive])

  // 阅读方向按书记忆：提交完整元数据补丁，避免局部更新清掉其他字段。
  const toggleDirection = useCallback((): void => {
    const next: ReadingDirection = rtl ? 'ltr' : 'rtl'
    void window.readex.library
      .updateMetadata(book.id, {
        title: book.title,
        author: book.author,
        language: book.language,
        publisher: book.publisher,
        description: book.description,
        tags: book.tags,
        readingDirection: next
      })
      .then((saved) => {
        if (saved) {
          window.dispatchEvent(new CustomEvent('readex:library-updated'))
        }
      })
  }, [book, rtl])

  const handleImageLoaded = useCallback((): void => {
    loadedCountRef.current += 1
    if (loadedCountRef.current >= expectedImagesRef.current) setImageLoading(false)
  }, [])

  useImperativeHandle(ref, () => ({
    goTo,
    scrollBy: (delta: number) => turnPage(delta > 0 ? 1 : -1),
    search: async () => [] as SearchResult[],
    startAutoScroll: () => 'unavailable' as AutoScrollStatus,
    stopAutoScroll: () => undefined,
    getSpeechSnapshot: () => null,
    scrollToSpeechSegment: () => undefined,
    setSpeechSegmentHighlight: () => undefined,
    advanceSpeechSection: async () => false,
    setSearchHighlight: () => undefined
  }))

  if (loading) return <ReaderLoading label="正在解析漫画" />
  if (error) return <ReaderError message={error} />
  if (!pages.length) return <ReaderError message="漫画中没有可显示的图片" />

  const step = twoPageActive ? 2 : 1
  const atStart = page <= 1
  const atEnd = page + step > pageCount
  const spreadEnd = Math.min(page + 1, pageCount)

  return (
    <div className="comic-reader" ref={rootRef} data-floating-reader-content="">
      <div className={`comic-stage ${twoPageActive ? 'two-page' : ''} ${rtl ? 'rtl' : ''}`}>
        {imageLoading && <LoaderCircle className="comic-spinner spin" size={24} />}
        <img
          className="comic-page"
          src={getComicPageUrl(book.id, page - 1)}
          alt={`第 ${page} 页`}
          draggable={false}
          decoding="async"
          onLoad={handleImageLoaded}
          onError={() => {
            setImageLoading(false)
            onError(`第 ${page} 页图片加载失败`)
          }}
        />
        {twoPageActive && page < pageCount && (
          <img
            className="comic-page"
            src={getComicPageUrl(book.id, page)}
            alt={`第 ${page + 1} 页`}
            draggable={false}
            decoding="async"
            onLoad={handleImageLoaded}
            onError={() => setImageLoading(false)}
          />
        )}
      </div>
      <button
        className="comic-nav prev"
        type="button"
        title={rtl ? '下一页' : '上一页'}
        disabled={rtl ? atEnd : atStart}
        onClick={() => turnPage(rtl ? 1 : -1)}
      >
        {rtl ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
      </button>
      <button
        className="comic-nav next"
        type="button"
        title={rtl ? '上一页' : '下一页'}
        disabled={rtl ? atStart : atEnd}
        onClick={() => turnPage(rtl ? -1 : 1)}
      >
        {rtl ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
      </button>
      <div className="comic-toolbar">
        <button
          type="button"
          title={
            rtl ? '当前从右到左（日漫），点击切换为从左到右' : '当前从左到右，点击切换为日漫方向'
          }
          onClick={toggleDirection}
        >
          <ArrowLeftRight size={15} />
        </button>
        <button
          type="button"
          title={settings.comicTwoPage ? '关闭双页' : '宽窗口双页显示'}
          aria-pressed={settings.comicTwoPage}
          onClick={() => onComicTwoPageChange?.(!settings.comicTwoPage)}
        >
          <Columns2 size={15} />
        </button>
      </div>
      <div className="comic-indicator">
        {twoPageActive && page < pageCount
          ? `${page}-${spreadEnd} / ${pageCount}`
          : `${page} / ${pageCount}`}
      </div>
    </div>
  )
})
