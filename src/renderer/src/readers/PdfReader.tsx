import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import type { Annotation, ReadingLocator, SearchResult, TocItem } from '@shared/types'
import { ANNOTATION_COLORS } from '@shared/types'
import type { ReaderHandle, ReaderProps } from './types'
import type { AutoScrollStatus } from './types'
import { ReaderError, ReaderLoading } from './TextFlowReader'
import { normalizedWheelDelta, smoothScrollBy } from '../lib/smoothScroll'
import { AutoScrollController } from '../lib/autoScroll'
import { buildPdfOutlineToc, type ResolvedOutlineItem } from '../lib/pdfOutline'
import {
  buildSpeechSnapshot,
  removeSpeechHighlight,
  scrollRangeToReadingPosition,
  setSpeechHighlight
} from '../lib/speech'
import { isLightColor } from '../lib/theme'
import { calculatePdfDisplayScale } from '../lib/pdfLayout'
import { findTextRange } from '../lib/textRange'

GlobalWorkerOptions.workerSrc = workerUrl
const PDF_PAGE_HORIZONTAL_GUTTER = 48

export const PdfReader = forwardRef<ReaderHandle, ReaderProps>(function PdfReader(
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
    onAutoScrollEnd
  },
  ref
): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const documentRef = useRef<PDFDocumentProxy | null>(null)
  const pageRefs = useRef(new Map<number, HTMLElement>())
  const [pageCount, setPageCount] = useState(0)
  const [availableWidth, setAvailableWidth] = useState(0)
  const [spreadActive, setSpreadActive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const settingsRef = useRef(settings)
  const autoScrollControllerRef = useRef<AutoScrollController | null>(null)
  const autoScrollEndHandler = useRef<(() => void) | null>(null)
  const speechSegments = useRef(new Map<string, Range>())
  const searchHighlightToken = useRef(0)

  useEffect(() => {
    autoScrollEndHandler.current = onAutoScrollEnd ?? null
  }, [onAutoScrollEnd])

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const updateWidth = (): void => {
      const spread = settings.pdfTwoPage && root.clientWidth >= 760
      setSpreadActive(spread)
      const columns = spread ? 2 : 1
      const gap = spread ? 22 : 0
      setAvailableWidth(
        Math.max(
          240,
          Math.floor((root.clientWidth - PDF_PAGE_HORIZONTAL_GUTTER - gap) / columns)
        )
      )
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(root)
    return () => observer.disconnect()
  }, [settings.pdfTwoPage])

  useEffect(() => {
    let active = true
    setLoading(true)
    const resourceUrl = window.readex.book.getResourceUrl(book.id, book.format)
    void getDocument({ url: resourceUrl }).promise
      .then(async (pdf) => {
        if (!active) {
          await pdf.destroy()
          return
        }
        documentRef.current = pdf
        setPageCount(pdf.numPages)
        onTocChange(buildPdfPageToc(pdf.numPages))
        // 内嵌大纲解析不阻塞首屏；解析完成后替换为真实章节目录。
        void resolvePdfOutline(pdf).then((resolved) => {
          if (!active || resolved.length === 0) return
          const outlineToc = buildPdfOutlineToc(resolved)
          if (outlineToc.length) onTocChange(outlineToc)
        })
        if (!book.coverFile && !book.coverDataUrl) {
          void generatePdfCover(pdf).then((dataUrl) => {
            if (!active || !dataUrl) return
            void window.readex.library
              .saveGeneratedCover(book.id, dataUrl)
              .then((saved) => {
                if (saved) {
                  window.dispatchEvent(new CustomEvent('readex:library-updated'))
                }
              })
          })
        }
        const state = await window.readex.reading.getState(book.id)
        if (state?.locator?.page) {
          const pageNumber = state.locator.page
          window.setTimeout(() => {
            pageRefs.current.get(pageNumber)?.scrollIntoView({ block: 'start' })
          }, 80)
        }
        setLoading(false)
      })
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : 'PDF 无法打开'
        setError(message)
        onError(message)
        setLoading(false)
      })

    return () => {
      active = false
      const pdf = documentRef.current
      documentRef.current = null
      void pdf?.destroy()
    }
  }, [book.id])

  useEffect(() => {
    const root = scrollRef.current
    if (!root || loading) return
    const onWheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      event.preventDefault()
      onReaderPointerDown()
      const current = settingsRef.current
      smoothScrollBy(
        root,
        normalizedWheelDelta(
          event.deltaY,
          event.deltaMode,
          current.wheelScrollStep,
          root.clientHeight
        ),
        current.smoothScrolling
      )
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [loading])

  const reportProgress = (): void => {
    const root = scrollRef.current
    if (!root || !pageCount) return
    const rootRect = root.getBoundingClientRect()
    let closestPage = 1
    let distance = Number.POSITIVE_INFINITY
    for (const [page, element] of pageRefs.current) {
      const rect = element.getBoundingClientRect()
      const nextDistance = Math.abs(rect.top - rootRect.top)
      if (nextDistance < distance) {
        distance = nextDistance
        closestPage = page
      }
    }
    const max = Math.max(1, root.scrollHeight - root.clientHeight)
    const progress = Math.max(0, Math.min(1, root.scrollTop / max))
    onProgress(
      {
        type: 'pdf-rect',
        value: String(closestPage),
        page: closestPage
      },
      progress
    )
  }

  const handleSelection = (page: number, event: React.MouseEvent): void => {
    const pageElement = pageRefs.current.get(page)
    const selection = window.getSelection()
    if (!pageElement || !selection || selection.rangeCount === 0 || selection.isCollapsed) return
    const text = selection.toString().replace(/\s+/g, ' ').trim()
    if (!text) return

    const pageRect = pageElement.getBoundingClientRect()
    const rects = Array.from(selection.getRangeAt(0).getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        x: (rect.left - pageRect.left) / pageRect.width,
        y: (rect.top - pageRect.top) / pageRect.height,
        width: rect.width / pageRect.width,
        height: rect.height / pageRect.height
      }))
    if (!rects.length) return

    onSelection({
      text,
      locator: {
        type: 'pdf-rect',
        value: String(page),
        page,
        rects,
        excerpt: text
      },
      x: event.clientX,
      y: event.clientY
    })
  }

  const goTo = (target: ReadingLocator | TocItem): void => {
    let page: number | undefined
    if ('page' in target) page = target.page
    else if ('chapterId' in target && target.chapterId) page = Number(target.chapterId)
    else if ('value' in target) page = Number(target.value)
    if (page !== undefined && Number.isFinite(page)) {
      pageRefs.current.get(page)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }

  const search = async (query: string): Promise<SearchResult[]> => {
    const pdf = documentRef.current
    const normalized = query.trim().toLocaleLowerCase()
    if (!pdf || !normalized) return []
    const results: SearchResult[] = []

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const text = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
      const lower = text.toLocaleLowerCase()
      let start = 0
      while (results.length < 200) {
        const index = lower.indexOf(normalized, start)
        if (index < 0) break
        results.push({
          id: `${book.id}:pdf:${pageNumber}:${index}`,
          bookId: book.id,
          bookTitle: book.title,
          source: 'text',
          title: `第 ${pageNumber} 页`,
          excerpt: text.slice(Math.max(0, index - 60), index + normalized.length + 60),
          locator: {
            type: 'pdf-rect',
            value: String(pageNumber),
            page: pageNumber,
            excerpt: text.slice(index, index + normalized.length)
          }
        })
        start = index + normalized.length
      }
      if (results.length >= 200) break
    }
    return results
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
          return [...pageRefs.current.entries()].flatMap(([, pageElement]) => {
            const textLayer = pageElement.querySelector(
              '.pdf-text-layer'
            ) as HTMLElement | null
            if (!textLayer) return []
            return [
              {
                el: textLayer,
                document: textLayer.ownerDocument,
                highlightHost: textLayer,
                mapY: (viewportY: number): number =>
                  viewportY - rootRect.top + root.scrollTop
              }
            ]
          })
        },
        getSpeed: () => settingsRef.current.autoScrollSpeed,
        getHighlightColor: () => settingsRef.current.autoScrollColor,
        isLightBackground: () => isLightColor(settingsRef.current.backgroundColor),
        isHighlightEnabled: () => settingsRef.current.autoScrollHighlight,
        getHighlightStyle: () => settingsRef.current.autoScrollHighlightStyle,
        getBandHost: () => scrollRef.current?.parentElement ?? null,
        getBandRect: () => {
          const shell = scrollRef.current?.querySelector('.pdf-page-shell')
          const rect = shell?.getBoundingClientRect()
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

  const closestPageNumber = (): number => {
    const root = scrollRef.current
    if (!root) return 1
    const rootRect = root.getBoundingClientRect()
    let closest = 1
    let distance = Number.POSITIVE_INFINITY
    for (const [page, element] of pageRefs.current) {
      const nextDistance = Math.abs(element.getBoundingClientRect().top - rootRect.top)
      if (nextDistance < distance) {
        distance = nextDistance
        closest = page
      }
    }
    return closest
  }

  const getSpeechSnapshot = (): ReturnType<ReaderHandle['getSpeechSnapshot']> => {
    const root = scrollRef.current
    if (!root) return null
    const rootRect = root.getBoundingClientRect()
    // 只收集当前页附近已渲染的文本层，避免长文档遍历所有页面。
    const current = closestPageNumber()
    const roots = [...pageRefs.current.entries()].flatMap(([page, pageElement]) => {
      if (page < current - 1 || page > current + 2) return []
      const textLayer = pageElement.querySelector('.pdf-text-layer') as HTMLElement | null
      if (!textLayer?.textContent?.trim()) return []
      return [
        {
          id: `pdf-${page}`,
          element: textLayer,
          mapY: (viewportY: number): number =>
            viewportY - rootRect.top + root.scrollTop
        }
      ]
    })
    const snapshot = buildSpeechSnapshot(roots, root.scrollTop)
    speechSegments.current = new Map(
      snapshot?.segments.map((segment) => [segment.id, segment.range]) ?? []
    )
    return snapshot
  }

  const scrollToSpeechSegment = (segmentId: string): void => {
    const container = scrollRef.current
    const range = speechSegments.current.get(segmentId)
    if (!container || !range) return
    scrollRangeToReadingPosition(range, container, settingsRef.current.smoothScrolling)
  }

  const setSpeechSegmentHighlight = (segmentId: string | null): void => {
    const range = segmentId ? speechSegments.current.get(segmentId) : null
    setSpeechHighlight(range ?? null, settingsRef.current.autoScrollColor)
  }

  const advanceSpeechSection = async (): Promise<boolean> => {
    if (!pageCount) return false
    const current = closestPageNumber()
    for (let offset = 1; offset <= 3; offset += 1) {
      const element = pageRefs.current.get(current + offset)
      if (!element) break
      element.scrollIntoView({ block: 'start' })
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 250))
        const layer = element.querySelector('.pdf-text-layer')
        if (layer?.textContent?.trim()) return true
      }
    }
    return false
  }

  const setSearchHighlight = (result: SearchResult | null): void => {
    const token = ++searchHighlightToken.current
    const registry = (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } })
      .CSS
    registry?.highlights?.delete('rdx-search')
    const pageNumber = result?.locator?.page
    const needle = result?.locator?.excerpt?.trim()
    if (!pageNumber || !needle) return

    const attemptHighlight = (attempt: number): void => {
      if (token !== searchHighlightToken.current) return
      const pageElement = pageRefs.current.get(pageNumber)
      const layer = pageElement?.querySelector('.pdf-text-layer') as HTMLElement | null
      const range = layer ? findTextRange(layer, needle) : null
      if (range) {
        if (registry?.highlights && typeof globalThis.Highlight !== 'undefined') {
          registry.highlights.set('rdx-search', new Highlight(range))
        }
        return
      }
      if (attempt < 5) {
        window.setTimeout(() => attemptHighlight(attempt + 1), 250)
      }
    }
    attemptHighlight(0)
  }

  useEffect(() => removeSpeechHighlight, [book.id])

  useEffect(() => {
    return () => {
      searchHighlightToken.current += 1
      const registry = (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } })
        .CSS
      registry?.highlights?.delete('rdx-search')
    }
  }, [book.id])

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
    setSearchHighlight,
    getThumbnails: () => (pageCount ? { pageCount, kind: 'pdf' } : null),
    getThumbnail: async (targetPage: number, maxWidth: number) => {
      const pdf = documentRef.current
      if (!pdf) return null
      const pageNumber = Math.round(targetPage)
      if (pageNumber < 1 || pageNumber > pdf.numPages) return null
      try {
        const page = await pdf.getPage(pageNumber)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({
          scale: Math.max(0.05, maxWidth / base.width)
        })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.floor(viewport.width))
        canvas.height = Math.max(1, Math.floor(viewport.height))
        const context = canvas.getContext('2d')
        if (!context) return null
        await page.render({ canvasContext: context, viewport }).promise
        return canvas.toDataURL('image/jpeg', 0.72)
      } catch {
        return null
      }
    }
  }))

  return (
    <div
      className={`pdf-reader theme-${settings.theme} ${settings.pdfNightMode ? 'pdf-night' : ''} ${spreadActive ? 'pdf-spread' : ''}`}
      ref={scrollRef}
      onScroll={reportProgress}
    >
      {loading && <ReaderLoading label="正在渲染 PDF" />}
      {error && <ReaderError message={error} />}
      <div className="pdf-pages">
        {Array.from({ length: pageCount }, (_, index) => (
          <PdfPage
            annotations={annotations}
            key={index + 1}
            pageNumber={index + 1}
            pdf={documentRef.current}
            availableWidth={availableWidth}
            zoom={settings.pdfScale}
            onOpenAnnotation={onOpenAnnotation}
            onSelection={handleSelection}
            refCallback={(element) => {
              if (element) pageRefs.current.set(index + 1, element)
              else pageRefs.current.delete(index + 1)
            }}
          />
        ))}
      </div>
    </div>
  )
})

function buildPdfPageToc(total: number): TocItem[] {
  return Array.from({ length: total }, (_, index) => ({
    id: `pdf-page-${index + 1}`,
    label: `第 ${index + 1} 页`,
    chapterId: String(index + 1)
  }))
}

interface RawOutlineNode {
  title?: unknown
  dest?: unknown
  items?: unknown
}

/** 解析 PDF 内嵌大纲并定位每个书签的页码；单个条目失败返回 null 页。 */
async function resolvePdfOutline(
  pdf: PDFDocumentProxy
): Promise<readonly ResolvedOutlineItem[]> {
  const raw = (await pdf.getOutline().catch(() => null)) as RawOutlineNode[] | null
  if (!raw?.length) return []

  const resolvePage = async (dest: unknown): Promise<number | null> => {
    try {
      const explicit =
        typeof dest === 'string' ? await pdf.getDestination(dest) : (dest as unknown[])
      if (!Array.isArray(explicit) || explicit.length === 0) return null
      const index = await pdf.getPageIndex(explicit[0] as never)
      return index + 1
    } catch {
      return null
    }
  }

  const resolveAll = async (items: RawOutlineNode[]): Promise<ResolvedOutlineItem[]> => {
    const resolved: ResolvedOutlineItem[] = []
    for (const item of items) {
      resolved.push({
        title: typeof item.title === 'string' ? item.title : '',
        page: await resolvePage(item.dest),
        items: Array.isArray(item.items)
          ? await resolveAll(item.items as RawOutlineNode[])
          : undefined
      })
    }
    return resolved
  }
  return resolveAll(raw)
}

async function generatePdfCover(pdf: PDFDocumentProxy): Promise<string | null> {
  try {
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 0.35 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    const context = canvas.getContext('2d')
    if (!context) return null
    await page.render({ canvasContext: context, viewport }).promise
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return null
  }
}

function PdfPage({  pdf,
  pageNumber,
  availableWidth,
  zoom,
  annotations,
  onSelection,
  onOpenAnnotation,
  refCallback
}: {
  pdf: PDFDocumentProxy | null
  pageNumber: number
  availableWidth: number
  zoom: number
  annotations: Annotation[]
  onSelection: (page: number, event: React.MouseEvent) => void
  onOpenAnnotation: (annotation: Annotation) => void
  refCallback: (element: HTMLDivElement | null) => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [visible, setVisible] = useState(pageNumber <= 2)
  const [baseViewport, setBaseViewport] = useState({ width: 720, height: 980 })

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true)
      },
      { rootMargin: '900px 0px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!pdf || !visible) return
    let active = true
    void pdf.getPage(pageNumber).then((loadedPage) => {
      if (!active) return
      setPage(loadedPage)
      const viewport = loadedPage.getViewport({ scale: 1 })
      setBaseViewport({ width: viewport.width, height: viewport.height })
    })
    return () => {
      active = false
    }
  }, [pdf, pageNumber, visible])

  const displayScale = calculatePdfDisplayScale({
    availableWidth,
    pageWidth: baseViewport.width,
    zoom
  })
  const dimensions = {
    width: baseViewport.width * displayScale,
    height: baseViewport.height * displayScale
  }

  useEffect(() => {
    if (!page || !canvasRef.current || !textLayerRef.current) return
    let active = true
    const viewport = page.getViewport({ scale: displayScale })
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    if (!context) return
    const outputScale = window.devicePixelRatio || 1
    canvas.width = Math.floor(viewport.width * outputScale)
    canvas.height = Math.floor(viewport.height * outputScale)
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`

    const renderTask = page.render({
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
    })
    const textLayer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container: textLayerRef.current,
      viewport
    })
    textLayerRef.current.replaceChildren()
    textLayerRef.current.style.setProperty('--scale-factor', String(viewport.scale))
    void Promise.all([renderTask.promise, textLayer.render()]).catch(() => {
      if (active) {
        // Render cancellation happens when zooming or closing quickly.
      }
    })

    return () => {
      active = false
      textLayer.cancel()
      renderTask.cancel()
    }
  }, [page, displayScale])

  const pageAnnotations = annotations.filter((annotation) => annotation.locator.page === pageNumber)

  return (
    <div
      className="pdf-page-shell"
      ref={(element) => {
        containerRef.current = element
        refCallback(element)
      }}
      data-page={pageNumber}
    >
      <div
        className="pdf-page"
        data-floating-reader-content=""
        style={{ width: dimensions.width, height: dimensions.height }}
        onMouseUp={(event) => onSelection(pageNumber, event)}
      >
        <canvas ref={canvasRef} />
        <div className="pdf-text-layer" ref={textLayerRef} />
        <div className="pdf-annotations">
          {pageAnnotations.flatMap((annotation) =>
            (annotation.locator.rects ?? []).map((rect, index) => (
              <button
                className="pdf-annotation"
                type="button"
                key={`${annotation.id}-${index}`}
                title={annotation.note || annotation.text}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                  background: ANNOTATION_COLORS[annotation.color]
                }}
                onClick={() => onOpenAnnotation(annotation)}
              />
            ))
          )}
        </div>
      </div>
      <span className="pdf-page-number">{pageNumber}</span>
    </div>
  )
}
