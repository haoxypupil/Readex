import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import ePub from 'epubjs'
import type { Book, Rendition } from 'epubjs'
import type { ReadingLocator, SearchResult, TocItem } from '@shared/types'
import { ANNOTATION_COLORS } from '@shared/types'
import type { ReaderHandle, ReaderProps } from './types'
import type { AutoScrollStatus } from './types'
import type { SelectedText } from '../lib/textAnchors'
import { normalizedWheelDelta, smoothScrollBy } from '../lib/smoothScroll'
import { AutoScrollController } from '../lib/autoScroll'
import {
  buildSpeechSnapshot,
  removeSpeechHighlight,
  scrollRangeToReadingPosition,
  setSpeechHighlight
} from '../lib/speech'
import { isLightColor } from '../lib/theme'
import { ensureEmbeddedFonts } from '../lib/embeddedFonts'
import { ReaderError, ReaderLoading } from './TextFlowReader'

export const EpubReader = forwardRef<ReaderHandle, ReaderProps>(function EpubReader(
  {
    book,
    settings,
    annotations,
    onSelection,
    onSelectionContextMenu,
    onReaderPointerDown,
    onOpenAnnotation,
    onProgress,
    onTocChange,
    onError,
    onAutoScrollEnd,
    floatingDragHandlers
  },
  ref
): React.JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<Book | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const pendingTarget = useRef<string | number | ReadingLocator | TocItem | null>(null)
  const lastSelection = useRef<SelectedText | null>(null)
  const speechSegments = useRef(new Map<string, Range>())
  const settingsRef = useRef(settings)
  const autoScrollControllerRef = useRef<AutoScrollController | null>(null)
  const autoScrollEndHandler = useRef<(() => void) | null>(null)
  // 记录已画到页面上的 CFI，删除标注时才能把对应高亮一并移除。
  const appliedHighlightCfis = useRef(new Set<string>())
  const searchHighlightCfi = useRef<string | null>(null)
  const lastCfiRef = useRef<string | null>(null)
  const lastBookIdRef = useRef<string | null>(null)
  const lastPageTurnRef = useRef(0)

  useEffect(() => {
    autoScrollEndHandler.current = onAutoScrollEnd ?? null
  }, [onAutoScrollEnd])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    appliedHighlightCfis.current.clear()
    searchHighlightCfi.current = null
    lastPageTurnRef.current = 0
    if (lastBookIdRef.current !== book.id) {
      lastBookIdRef.current = book.id
      lastCfiRef.current = null
    }
    const paginated = settings.readingLayout === 'paginated'

    const resourceUrl = window.readex.book.getResourceUrl(book.id, book.format)
    void (async () => {
      if (!active || !mountRef.current) return
      const epubBook = ePub(resourceUrl)
      const rendition = epubBook.renderTo(mountRef.current, {
        width: '100%',
        height: '100%',
        flow: paginated ? 'paginated' : 'scrolled-doc',
        manager: paginated ? 'default' : 'continuous',
        spread: paginated && settings.pageColumns === 2 ? 'auto' : 'none',
        minSpreadWidth: 760,
        allowScriptedContent: false
      })
      bookRef.current = epubBook
      renditionRef.current = rendition

      rendition.hooks.content.register((contents: unknown) => {
        const content = contents as {
          document: Document
          window: Window
        }
        content.document.documentElement.dataset.floatingReaderContent = ''
        ensureEmbeddedFonts(content.document, window.location.href)
        const onWheel = (event: WheelEvent): void => {
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
          const container = mountRef.current?.querySelector('.epub-container') as HTMLElement | null
          if (!container) return
          event.preventDefault()
          onReaderPointerDown()
          const current = settingsRef.current
          if (current.readingLayout === 'paginated') {
            const now = Date.now()
            if (now - lastPageTurnRef.current < 320) return
            lastPageTurnRef.current = now
            if (event.deltaY > 0) void renditionRef.current?.next()
            else void renditionRef.current?.prev()
            return
          }
          smoothScrollBy(
            container,
            normalizedWheelDelta(
              event.deltaY,
              event.deltaMode,
              current.wheelScrollStep,
              content.window.innerHeight
            ),
            current.smoothScrolling
          )
        }
        content.document.addEventListener('wheel', onWheel, { passive: false })
        const onContextMenu = (event: MouseEvent): void => {
          const selection = content.window.getSelection()
          if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return
          const text = selection.toString().replace(/\s+/g, ' ').trim()
          if (!text) return
          event.preventDefault()
          const range = selection.getRangeAt(0)
          const pageText = content.document.body.textContent ?? ''
          const index = pageText.indexOf(text)
          const frame = content.document.defaultView?.frameElement?.getBoundingClientRect()
          const previous = lastSelection.current
          const viewportPoint = {
            x: (frame?.left ?? 0) + event.clientX,
            y: (frame?.top ?? 0) + event.clientY
          }
          onSelectionContextMenu(
            previous?.text === text
              ? previous
              : {
                  text,
                  locator: {
                    type: 'epub-cfi',
                    value: renditionRef.current?.currentLocation()?.cfi ?? '',
                    excerpt: text,
                    prefix: index >= 0 ? pageText.slice(Math.max(0, index - 80), index) : '',
                    suffix:
                      index >= 0
                        ? pageText.slice(index + text.length, index + text.length + 80)
                        : ''
                  },
                  ...viewportPoint
                },
            viewportPoint
          )
        }
        const onPointerDown = (event: PointerEvent): void => {
          if (event.button === 0) {
            onReaderPointerDown()
            floatingDragHandlers?.onPointerDown(event)
          }
        }
        const onKeyDown = (event: KeyboardEvent): void => {
          if (!isReadexShortcut(event) && !isReaderPageKey(event)) return
          event.preventDefault()
          window.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: event.key,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              shiftKey: event.shiftKey,
              altKey: event.altKey
            })
          )
        }
        content.document.addEventListener('pointerdown', onPointerDown)
        content.document.addEventListener(
          'pointermove',
          floatingDragHandlers?.onPointerMove ?? noop
        )
        content.document.addEventListener(
          'pointerup',
          floatingDragHandlers?.onPointerUp ?? noop
        )
        content.document.addEventListener(
          'pointercancel',
          floatingDragHandlers?.onPointerUp ?? noop
        )
        content.document.addEventListener('contextmenu', onContextMenu)
        content.document.addEventListener('keydown', onKeyDown)
        return () => {
          content.document.removeEventListener('wheel', onWheel)
          content.document.removeEventListener('pointerdown', onPointerDown)
          content.document.removeEventListener(
            'pointermove',
            floatingDragHandlers?.onPointerMove ?? noop
          )
          content.document.removeEventListener(
            'pointerup',
            floatingDragHandlers?.onPointerUp ?? noop
          )
          content.document.removeEventListener(
            'pointercancel',
            floatingDragHandlers?.onPointerUp ?? noop
          )
          content.document.removeEventListener('contextmenu', onContextMenu)
          content.document.removeEventListener('keydown', onKeyDown)
        }
      })

      rendition.on('selected', (cfiRange: string, contents: unknown) => {
        const content = contents as {
          window: Window
          document: Document
        }
        const selection = content.window.getSelection()
        if (!selection || selection.isCollapsed) return
        const text = selection.toString().replace(/\s+/g, ' ').trim()
        if (!text) return
        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        const frame = content.document.defaultView?.frameElement?.getBoundingClientRect()
        const pageText = content.document.body.textContent ?? ''
        const contentSelection: SelectedText = {
          text,
          locator: {
            type: 'epub-cfi',
            value: cfiRange,
            excerpt: text,
            prefix: pageText.slice(Math.max(0, pageText.indexOf(text) - 80), pageText.indexOf(text)),
            suffix: pageText.slice(
              pageText.indexOf(text) + text.length,
              pageText.indexOf(text) + text.length + 80
            )
          },
          x: (frame?.left ?? 0) + rect.left + rect.width / 2,
          y: (frame?.top ?? 0) + rect.top
        }
        lastSelection.current = contentSelection
        onSelection(contentSelection)
      })

      rendition.on('relocated', (location: {
        start: {
          cfi: string
          href?: string
          percentage?: number
          index?: number
          displayed?: { page: number; total: number }
        }
      }) => {
        if (location.start.cfi) lastCfiRef.current = location.start.cfi
        let progress: number
        if (settingsRef.current.readingLayout === 'paginated') {
          const spineLength =
            (epubBook.spine as unknown as { length?: number }).length ?? 1
          const displayed = location.start.displayed
          const pageFraction =
            displayed && displayed.total > 0
              ? Math.max(0, displayed.page - 1) / displayed.total
              : 0
          progress =
            location.start.percentage && location.start.percentage > 0
              ? location.start.percentage
              : Math.min(1, ((location.start.index ?? 0) + pageFraction) / Math.max(1, spineLength))
        } else {
          progress =
            location.start.percentage && location.start.percentage > 0
              ? location.start.percentage
              : getContainerProgress(mountRef.current)
        }
        onProgress(
          {
            type: 'epub-cfi',
            value: location.start.cfi,
            chapterHref: location.start.href,
            excerpt: ''
          },
          progress
        )
      })

      rendition.themes.register('readex', {
        body: {
          color: settings.textColor,
          background: settings.backgroundColor,
          'font-family': settings.fontFamily,
          'font-size': `${settings.fontSize}px`,
          'line-height': String(settings.lineHeight),
          'letter-spacing': `${settings.letterSpacing}em`,
          padding: '0 6%'
        },
        p: {
          'margin-bottom': `${settings.paragraphSpacing}em`
        },
        a: {
          color: settings.accentColor
        }
      })
      rendition.themes.select('readex')

      void epubBook.ready
        .then(async () => {
          const navigation = await epubBook.loaded.navigation
          const mapItems = (items: Array<Record<string, unknown>>): TocItem[] =>
            items.map((item, index) => ({
              id: String(item.id ?? `epub-toc-${index}`),
              label: String(item.label ?? `章节 ${index + 1}`),
              href: String(item.href ?? ''),
              children: Array.isArray(item.subitems)
                ? mapItems(item.subitems as Array<Record<string, unknown>>)
                : undefined
            }))
          onTocChange(
            mapItems((navigation.toc ?? []) as unknown as Array<Record<string, unknown>>)
          )

          const state = await window.readex.reading.getState(book.id)
          const savedTarget = state?.locator?.value?.trim() || undefined
          const pending = pendingTarget.current
          const pendingValue =
            typeof pending === 'string' || typeof pending === 'number'
              ? pending
              : pending && 'type' in pending
                ? pending.value
                : pending?.href ?? pending?.chapterId ?? undefined
          // 切换布局重建 rendition 时优先回到当前页，其次才是待跳转目标和上次保存位置。
          const target = lastCfiRef.current ?? pendingValue ?? savedTarget
          if (target) {
            try {
              if (typeof target === 'number') {
                await rendition.display(target)
              } else {
                await rendition.display(target)
              }
            } catch {
              await rendition.display()
            }
          } else {
            await rendition.display()
          }
          setLoading(false)
        })
        .catch((reason: unknown) => {
          const message = reason instanceof Error ? reason.message : 'EPUB 解析失败'
          setError(message)
          onError(message)
          setLoading(false)
        })
    })().catch((reason: unknown) => {
        if (!active) return
        const message =
          reason instanceof Error
            ? reason.message
            : '无法读取 EPUB 文件，请确认 personal 目录和原始书籍文件没有移动'
        setError(message)
        onError(message)
        setLoading(false)
    })

    return () => {
      active = false
      bookRef.current?.destroy()
      bookRef.current = null
      renditionRef.current = null
    }
  }, [book.id, settings.pageColumns, settings.readingLayout])

  useEffect(() => {
    if (loading || settings.readingLayout === 'paginated') return
    const container = mountRef.current?.querySelector('.epub-container') as HTMLElement | null
    if (!container) return

    let frame = 0
    const reportScroll = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const current = renditionRef.current?.currentLocation()
        onProgress(
          {
            type: 'epub-cfi',
            value: current?.cfi ?? '',
            chapterHref: current?.href,
            excerpt: ''
          },
          getContainerProgress(mountRef.current)
        )
      })
    }

    container.addEventListener('scroll', reportScroll, { passive: true })
    reportScroll()
    return () => {
      cancelAnimationFrame(frame)
      container.removeEventListener('scroll', reportScroll)
    }
  }, [loading, onProgress, settings.readingLayout])

  useEffect(() => {
    if (loading) return
    const rendition = renditionRef.current
    const mount = mountRef.current
    if (!rendition || !mount) return
    let timer: number | null = null
    const observer = new ResizeObserver(() => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const current = renditionRef.current
        const element = mountRef.current
        if (!current || !element) return
        current.resize(element.clientWidth, element.clientHeight)
      }, 120)
    })
    observer.observe(mount)
    return () => {
      if (timer) window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [loading, settings.pageColumns, settings.readingLayout])

  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition || loading) return
    rendition.themes.register('readex', {
      body: {
        color: settings.textColor,
        background: settings.backgroundColor,
        'font-family': settings.fontFamily,
        'font-size': `${settings.fontSize}px`,
        'line-height': String(settings.lineHeight),
        'letter-spacing': `${settings.letterSpacing}em`,
        padding: '0 6%'
      },
      p: {
        'margin-bottom': `${settings.paragraphSpacing}em`
      },
      a: {
        color: settings.accentColor
      }
    })
    rendition.themes.select('readex')
  }, [loading, settings])

  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition || loading) return
    const nextCfis = new Set(
      annotations.map((annotation) => annotation.locator.value).filter(Boolean)
    )
    for (const cfi of appliedHighlightCfis.current) {
      if (!nextCfis.has(cfi)) rendition.annotations.remove(cfi, 'highlight')
    }
    for (const annotation of annotations) {
      rendition.annotations.remove(annotation.locator.value, 'highlight')
      rendition.annotations.highlight(
        annotation.locator.value,
        { annotationId: annotation.id },
        () => onOpenAnnotation(annotation),
        `rdx-epub-${annotation.color}`,
        {
          fill: ANNOTATION_COLORS[annotation.color],
          'fill-opacity': '0.38',
          'mix-blend-mode': 'multiply'
        }
      )
    }
    appliedHighlightCfis.current = nextCfis
  }, [annotations, loading, onOpenAnnotation])

  const goTo = (target: ReadingLocator | TocItem): void => {
    const value =
      'type' in target
        ? target.value
        : target.href ?? target.chapterId ?? undefined
    if (!value) return
    if (renditionRef.current && !loading) {
      void renditionRef.current.display(value)
    } else {
      pendingTarget.current = target
    }
  }

  const search = async (query: string): Promise<SearchResult[]> => {
    const epubBook = bookRef.current
    if (!epubBook || !query.trim()) return []
    const results: SearchResult[] = []
    const spineItems = (epubBook.spine as unknown as { spineItems: Array<Record<string, unknown>> })
      .spineItems

    for (const item of spineItems) {
      try {
        await (item.load as (loader: unknown) => Promise<void>)(epubBook.load.bind(epubBook))
        const found = (item.find as (value: string) => Array<Record<string, unknown>>)(query)
        for (const hit of found) {
          results.push({
            id: `${book.id}:${String(hit.cfi)}`,
            bookId: book.id,
            bookTitle: book.title,
            source: 'text',
            title: book.title,
            excerpt: String(hit.excerpt ?? query),
            locator: {
              type: 'epub-cfi',
              value: String(hit.cfi),
              excerpt: String(hit.excerpt ?? query)
            }
          })
        }
        ;(item.unload as () => void)()
      } catch {
        // Some EPUB sections are non-readable cover or navigation pages.
      }
      if (results.length >= 200) break
    }
    return results
  }

  const scrollBy = (delta: number): void => {
    if (settingsRef.current.readingLayout === 'paginated') {
      const rendition = renditionRef.current
      if (!rendition || !delta) return
      onReaderPointerDown()
      if (delta > 0) void rendition.next()
      else void rendition.prev()
      return
    }
    const container = mountRef.current?.querySelector('.epub-container') as HTMLElement | null
    if (container) {
      onReaderPointerDown()
      smoothScrollBy(container, delta, settingsRef.current.smoothScrolling)
    }
  }

  const ensureAutoScrollController = (): AutoScrollController | null => {
    if (!autoScrollControllerRef.current) {
      autoScrollControllerRef.current = new AutoScrollController({
        getContainer: () =>
          (mountRef.current?.querySelector('.epub-container') as HTMLElement | null) ?? null,
        getRoots: () => {
          const mount = mountRef.current
          const container = mount?.querySelector('.epub-container') as HTMLElement | null
          if (!mount || !container) return []
          return Array.from(mount.querySelectorAll<HTMLIFrameElement>('iframe')).flatMap(
            (frame) => {
              const body = frame.contentDocument?.body
              if (!body) return []
              // Live conversion from iframe-viewport Y to container content Y.
              const mapY = (viewportY: number): number => {
                const current = mountRef.current?.querySelector(
                  '.epub-container'
                ) as HTMLElement | null
                if (!current) return viewportY
                return (
                  viewportY +
                  frame.getBoundingClientRect().top -
                  current.getBoundingClientRect().top +
                  current.scrollTop
                )
              }
              return [
                {
                  el: body,
                  document: body.ownerDocument,
                  highlightHost: body,
                  mapY
                }
              ]
            }
          )
        },
        getSpeed: () => settingsRef.current.autoScrollSpeed,
        getHighlightColor: () => settingsRef.current.autoScrollColor,
        isLightBackground: () => isLightColor(settingsRef.current.backgroundColor),
        isHighlightEnabled: () => settingsRef.current.autoScrollHighlight,
        getHighlightStyle: () => settingsRef.current.autoScrollHighlightStyle,
        getBandHost: () => mountRef.current?.parentElement ?? null,
        getBandRect: () => {
          const frame = mountRef.current?.querySelector('iframe')
          const rect = frame?.getBoundingClientRect()
          if (!rect) return null
          // The epub theme pads the body by 6% on each side.
          return { left: rect.left + rect.width * 0.06, width: rect.width * 0.88 }
        },
        onEnd: () => autoScrollEndHandler.current?.()
      })
    }
    return autoScrollControllerRef.current
  }

  const startAutoScroll = (): AutoScrollStatus => {
    if (settingsRef.current.readingLayout === 'paginated') return 'unavailable'
    return ensureAutoScrollController()?.start() ?? 'unavailable'
  }

  const stopAutoScroll = (): void => {
    autoScrollControllerRef.current?.stop()
  }

  const getSpeechSnapshot = (): ReturnType<ReaderHandle['getSpeechSnapshot']> => {
    const mount = mountRef.current
    const container = mount?.querySelector('.epub-container') as HTMLElement | null
    if (!mount || !container) return null
    const roots = Array.from(mount.querySelectorAll<HTMLIFrameElement>('iframe'))
      .flatMap((frame, index) => {
        const body = frame.contentDocument?.body
        const frameRect = frame.getBoundingClientRect()
        if (!body || frameRect.height <= 0) return []
        return [
          {
            id: `epub-${index}`,
            element: body,
            mapY: (viewportY: number): number =>
              viewportY +
              frame.getBoundingClientRect().top -
              container.getBoundingClientRect().top +
              container.scrollTop
          }
        ]
      })
    const snapshot = buildSpeechSnapshot(roots, container.scrollTop)
    if (snapshot && settingsRef.current.readingLayout === 'paginated') {
      const index = snapshot.segments.findIndex((segment) => {
        const frame = segment.range.startContainer.ownerDocument?.defaultView?.frameElement
        if (!frame) return false
        const rect = segment.range.getBoundingClientRect()
        return (
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < frame.clientHeight &&
          rect.right > 0 &&
          rect.left < frame.clientWidth
        )
      })
      if (index >= 0) snapshot.startIndex = index
    }
    speechSegments.current = new Map(
      snapshot?.segments.map((segment) => [segment.id, segment.range]) ?? []
    )
    return snapshot
  }

  const revealRangeInPaginatedView = async (range: Range, attempt = 0): Promise<void> => {
    if (attempt > 10) return
    const rendition = renditionRef.current
    const frame = range.startContainer.ownerDocument?.defaultView?.frameElement
    if (!rendition || !frame) return
    const rect = range.getBoundingClientRect()
    const visible =
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < frame.clientHeight &&
      rect.right > 0 &&
      rect.left < frame.clientWidth
    if (visible) return
    const forward = rect.left >= frame.clientWidth || rect.top >= frame.clientHeight
    const backward = rect.left < 0 || rect.bottom < 0
    if (!forward && !backward) return
    if (forward) await rendition.next()
    else await rendition.prev()
    await new Promise((resolve) => window.setTimeout(resolve, 180))
    return revealRangeInPaginatedView(range, attempt + 1)
  }

  const scrollToSpeechSegment = (segmentId: string): void => {
    const container = mountRef.current?.querySelector('.epub-container') as HTMLElement | null
    const range = speechSegments.current.get(segmentId)
    if (!container || !range) return
    if (settingsRef.current.readingLayout === 'paginated') {
      void revealRangeInPaginatedView(range)
      return
    }
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

  const advanceSpeechSection = async (): Promise<boolean> => {
    const rendition = renditionRef.current
    if (!rendition) return false
    const currentCfi = (): string => {
      const location = rendition.currentLocation() as unknown as {
        start?: { cfi?: string; href?: string }
      }
      return location.start?.cfi ?? location.start?.href ?? ''
    }
    const before = currentCfi()
    await rendition.next()
    await new Promise((resolve) => window.setTimeout(resolve, 260))
    const after = currentCfi()
    return Boolean(after && after !== before)
  }

  const setSearchHighlight = (result: SearchResult | null): void => {
    const rendition = renditionRef.current
    if (!rendition) return
    const previous = searchHighlightCfi.current
    if (previous) {
      rendition.annotations.remove(previous, 'highlight')
      searchHighlightCfi.current = null
      // epub.js 按 CFI 移除全部高亮；若该段本来就是用户标注，需立即重绘。
      const annotation = annotations.find((item) => item.locator.value === previous)
      if (annotation) {
        rendition.annotations.highlight(
          annotation.locator.value,
          { annotationId: annotation.id },
          () => onOpenAnnotation(annotation),
          `rdx-epub-${annotation.color}`,
          {
            fill: ANNOTATION_COLORS[annotation.color],
            'fill-opacity': '0.38',
            'mix-blend-mode': 'multiply'
          }
        )
      }
    }
    const cfi = result?.locator?.value?.trim()
    if (!cfi) return
    // 与用户高亮同范围时不再叠加搜索高亮，避免二次移除互相覆盖。
    if (annotations.some((annotation) => annotation.locator.value === cfi)) return
    rendition.annotations.highlight(cfi, {}, undefined, 'rdx-search', {
      fill: '#f5a623',
      'fill-opacity': '0.35'
    })
    searchHighlightCfi.current = cfi
  }

  useEffect(() => {
    return () => stopAutoScroll()
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

  return (
    <div
      className={`epub-reader theme-${settings.theme}`}
      style={{ background: settings.backgroundColor }}
    >
      <div className="epub-mount" ref={mountRef} />
      {loading && <ReaderLoading label="正在打开 EPUB" />}
      {error && <ReaderError message={error} />}
    </div>
  )
})

function getContainerProgress(mount: HTMLElement | null): number {
  const container = mount?.querySelector('.epub-container') as HTMLElement | null
  if (!container) return 0
  const scrollRange = container.scrollHeight - container.clientHeight
  if (scrollRange <= 0) return 0
  return Math.max(0, Math.min(1, container.scrollTop / scrollRange))
}

function isReadexShortcut(event: KeyboardEvent): boolean {
  if (event.key === 'F11') return true
  if (event.key === 'Escape') return true
  if (!event.ctrlKey && !event.metaKey) return false
  const key = event.key.toLowerCase()
  return (
    ['o', ',', 'f', 'd', '=', '+', '-', '0', 'w', 'pageup', 'pagedown'].includes(key) ||
    (event.shiftKey && ['a', 'b', 't', 'n'].includes(key))
  )
}

function isReaderPageKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  return event.key === 'PageDown' || event.key === 'PageUp' || event.key === ' '
}

function noop(): void {}
