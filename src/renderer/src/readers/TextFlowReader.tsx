import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import DOMPurify from 'dompurify'
import type { BookContent, SearchResult, TocItem } from '@shared/types'
import type { ReaderHandle, ReaderProps } from './types'
import type { AutoScrollStatus } from './types'
import {
  applyTextHighlights,
  clearTextHighlights,
  createRangeByOffsets,
  locatorFromSelection,
  scrollToTextOffset
} from '../lib/textAnchors'
import { AutoScrollController } from '../lib/autoScroll'
import {
  buildSpeechSnapshot,
  removeSpeechHighlight,
  scrollRangeToReadingPosition,
  setSpeechHighlight
} from '../lib/speech'
import { isLightColor } from '../lib/theme'
import { normalizedWheelDelta, smoothScrollBy } from '../lib/smoothScroll'

interface TextFlowReaderProps extends ReaderProps {
  format: 'mobi' | 'txt'
}

export const TextFlowReader = forwardRef<ReaderHandle, TextFlowReaderProps>(
  function TextFlowReader(
    {
      book,
      settings,
      annotations,
      onSelection,
      onReaderPointerDown,
      onOpenAnnotation,
      onProgress,
      onTocChange,
      onError,
      onAutoScrollEnd,
      format
    },
    ref
  ): React.JSX.Element {
    const [content, setContent] = useState<BookContent | null>(null)
    const [loading, setLoading] = useState(true)
    const scrollRef = useRef<HTMLDivElement>(null)
    const chapterRefs = useRef(new Map<string, HTMLElement>())
    const speechSegments = useRef(new Map<string, Range>())
    const pendingLocator = useRef<Parameters<ReaderHandle['goTo']>[0] | null>(null)
    const settingsRef = useRef(settings)
    const autoScrollControllerRef = useRef<AutoScrollController | null>(null)
    const autoScrollEndHandler = useRef<(() => void) | null>(null)

    useEffect(() => {
      autoScrollEndHandler.current = onAutoScrollEnd ?? null
    }, [onAutoScrollEnd])

    useEffect(() => {
      settingsRef.current = settings
    }, [settings])

    useEffect(() => {
      let active = true
      setLoading(true)
      void window.readex.book
        .getContent(book.id)
        .then((value) => {
          if (!active) return
          if (!value) throw new Error('无法读取书籍内容')
          setContent(value)
          onTocChange(value.toc)
        })
        .catch((error) => onError(error instanceof Error ? error.message : '书籍内容读取失败'))
        .finally(() => active && setLoading(false))

      return () => {
        active = false
      }
    }, [book.id, onError, onTocChange])

    const safeChapters = useMemo(
      () =>
        (content?.chapters ?? []).map((chapter) => ({
          ...chapter,
          html: DOMPurify.sanitize(chapter.html, {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick']
          })
        })),
      [content]
    )

    useEffect(() => {
      const chapters = [...chapterRefs.current.entries()].map(([id, root]) => ({ id, root }))
      clearTextHighlights()
      applyTextHighlights(chapters, annotations)
      return () => clearTextHighlights()
    }, [annotations, safeChapters])

    useEffect(() => {
      if (!content || loading) return
      void window.readex.reading.getState(book.id).then((state) => {
        if (state?.locator) pendingLocator.current = state.locator
        if (pendingLocator.current) goTo(pendingLocator.current)
      })
      // Initial positioning only; later navigation is driven by the imperative API.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [book.id, content, loading])

    useEffect(() => {
      const root = scrollRef.current
      if (!root || loading) return
      const onWheel = (event: WheelEvent): void => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
        event.preventDefault()
        onReaderPointerDown()
        const current = settingsRef.current
        const delta = normalizedWheelDelta(
          event.deltaY,
          event.deltaMode,
          current.wheelScrollStep,
          root.clientHeight
        )
        smoothScrollBy(root, delta, current.smoothScrolling)
      }
      root.addEventListener('wheel', onWheel, { passive: false })
      return () => root.removeEventListener('wheel', onWheel)
    }, [loading])

    const goTo = (target: Parameters<ReaderHandle['goTo']>[0]): void => {
      const chapterId = 'chapterId' in target ? target.chapterId : undefined
      const start = 'start' in target ? target.start : undefined
      const scrollRoot = scrollRef.current
      if (!scrollRoot) {
        pendingLocator.current = target
        return
      }

      if (chapterId) {
        const chapter = chapterRefs.current.get(chapterId)
        if (chapter) {
          chapter.scrollIntoView({ block: 'start', behavior: 'smooth' })
          if (start !== undefined) {
            window.setTimeout(() => scrollToTextOffset(chapter, start), 250)
          }
          return
        }
      }

      if ('href' in target && target.href) {
        pendingLocator.current = target
      }
    }

    const search = async (query: string): Promise<SearchResult[]> => {
      return window.readex.search.inBook(book.id, query)
    }

    const scrollBy = (delta: number): void => {
      const root = scrollRef.current
      if (root) smoothScrollBy(root, delta, settingsRef.current.smoothScrolling)
    }

    const ensureAutoScrollController = (): AutoScrollController => {
      if (!autoScrollControllerRef.current) {
        autoScrollControllerRef.current = new AutoScrollController({
          getContainer: () => scrollRef.current,
          getRoots: () => {
            const root = scrollRef.current
            if (!root) return []
            const rootRect = root.getBoundingClientRect()
            return [...chapterRefs.current.values()].map((chapter) => ({
              el: chapter,
              document: chapter.ownerDocument,
              highlightHost: chapter,
              mapY: (viewportY: number): number =>
                viewportY - rootRect.top + root.scrollTop
            }))
          },
          getSpeed: () => settingsRef.current.autoScrollSpeed,
          getHighlightColor: () => settingsRef.current.autoScrollColor,
          isLightBackground: () => isLightColor(settingsRef.current.backgroundColor),
          isHighlightEnabled: () => settingsRef.current.autoScrollHighlight,
          getHighlightStyle: () => settingsRef.current.autoScrollHighlightStyle,
          getBandHost: () => scrollRef.current?.parentElement ?? null,
          getBandRect: () => {
            const page = scrollRef.current?.querySelector('.reader-page')
            const rect = page?.getBoundingClientRect()
            return rect ? { left: rect.left, width: rect.width } : null
          },
          onEnd: () => autoScrollEndHandler.current?.()
        })
      }
      return autoScrollControllerRef.current
    }

    const startAutoScroll = (): AutoScrollStatus => {
      return ensureAutoScrollController().start()
    }

    const stopAutoScroll = (): void => {
      autoScrollControllerRef.current?.stop()
    }

    const getSpeechSnapshot = (): ReturnType<ReaderHandle['getSpeechSnapshot']> => {
      const container = scrollRef.current
      if (!container) return null
      const rootRect = container.getBoundingClientRect()
      const snapshot = buildSpeechSnapshot(
        [...chapterRefs.current.entries()].map(([id, element]) => ({
          id,
          element,
          mapY: (viewportY: number): number =>
            viewportY - rootRect.top + container.scrollTop
        })),
        container.scrollTop
      )
      speechSegments.current = new Map(
        snapshot?.segments.map((segment) => [segment.id, segment.range]) ?? []
      )
      return snapshot
    }

    const scrollToSpeechSegment = (segmentId: string): void => {
      const container = scrollRef.current
      const range = speechSegments.current.get(segmentId)
      if (!container || !range) return
      scrollRangeToReadingPosition(
        range,
        container,
        settingsRef.current.smoothScrolling
      )
    }

    const setSpeechSegmentHighlight = (segmentId: string | null): void => {
      const range = segmentId ? speechSegments.current.get(segmentId) : null
      setSpeechHighlight(range ?? null, settingsRef.current.autoScrollColor)
    }

    const advanceSpeechSection = async (): Promise<boolean> => false

    const setSearchHighlight = (result: SearchResult | null): void => {
      const registry = (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } })
        .CSS
      if (!registry?.highlights) return
      registry.highlights.delete('rdx-search')
      const locator = result?.locator
      if (!locator || typeof globalThis.Highlight === 'undefined') return
      const { chapterId, start, end } = locator
      if (!chapterId || start === undefined || end === undefined) return
      const root = chapterRefs.current.get(chapterId)
      if (!root) return
      const range = createRangeByOffsets(root, start, end)
      if (range) registry.highlights.set('rdx-search', new Highlight(range))
    }

    useEffect(() => {
      return () => setSearchHighlight(null)
    }, [book.id])

    useImperativeHandle(ref, () => ({
      goTo,
      scrollBy,
      search,
      startAutoScroll,
      stopAutoScroll,
      getSpeechSnapshot,
      scrollToSpeechSegment,
      setSpeechSegmentHighlight,
      advanceSpeechSection,
      setSearchHighlight
    }))

    useEffect(() => removeSpeechHighlight, [book.id])

    const reportProgress = (): void => {
      const root = scrollRef.current
      if (!root || !content) return
      const max = Math.max(1, root.scrollHeight - root.clientHeight)
      const progress = Math.max(0, Math.min(1, root.scrollTop / max))
      const visibleChapter = findVisibleChapter(root, chapterRefs.current)
      onProgress(
        {
          type: format === 'mobi' ? 'mobi-offset' : 'text-offset',
          value: visibleChapter?.id ?? 'start',
          chapterId: visibleChapter?.id,
          start: 0
        },
        progress
      )
    }

    if (loading) {
      return <ReaderLoading label={`正在解析 ${format.toUpperCase()} 内容`} />
    }

    if (!content) {
      return <ReaderError message="书籍内容加载失败" />
    }

    return (
      <div
        className={`reader-scroll text-flow-reader theme-${settings.theme}`}
        ref={scrollRef}
        onScroll={reportProgress}
        style={{ background: settings.backgroundColor }}
      >
        <article
          className="reader-page"
          data-floating-reader-content=""
          style={{
            maxWidth: settings.contentWidth,
            color: settings.textColor,
            fontFamily: settings.fontFamily,
            fontSize: settings.fontSize,
            lineHeight: settings.lineHeight,
            letterSpacing: `${settings.letterSpacing}em`
          }}
        >
          {safeChapters.map((chapter) => (
            <section
              className="reader-chapter"
              id={`chapter-${chapter.id}`}
              key={chapter.id}
              ref={(element) => {
                if (element) chapterRefs.current.set(chapter.id, element)
                else chapterRefs.current.delete(chapter.id)
              }}
              onMouseUp={() => {
                const root = chapterRefs.current.get(chapter.id)
                if (!root) return
                const selection = locatorFromSelection(
                  root,
                  chapter.id,
                  format === 'mobi' ? 'mobi-offset' : 'text-offset'
                )
                if (selection) onSelection(selection)
              }}
              dangerouslySetInnerHTML={{ __html: chapter.html }}
            />
          ))}
        </article>
      </div>
    )
  }
)

function findVisibleChapter(
  scrollRoot: HTMLElement,
  chapters: Map<string, HTMLElement>
): { id: string } | null {
  const rootRect = scrollRoot.getBoundingClientRect()
  let closest: { id: string; distance: number } | null = null
  for (const [id, element] of chapters) {
    const rect = element.getBoundingClientRect()
    const distance = Math.abs(rect.top - rootRect.top)
    if (!closest || distance < closest.distance) closest = { id, distance }
  }
  return closest
}

export function ReaderLoading({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="reader-loading">
      <span className="loading-orb" />
      <p>{label}</p>
    </div>
  )
}

export function ReaderError({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="reader-error">
      <strong>无法打开这本书</strong>
      <p>{message}</p>
    </div>
  )
}
