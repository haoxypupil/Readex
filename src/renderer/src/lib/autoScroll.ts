export interface SentenceSegment {
  start: number
  end: number
  text: string
}

interface TextChunk {
  node: Text
  start: number
  end: number
}

interface SegmenterLike {
  segment: (value: string) => Iterable<{ segment: string; index: number }>
}

/**
 * Continuous auto-scroll speed in CSS pixels per second for a 1-100 level.
 * Two exponential segments share a knot at level 20: the low band spreads
 * 4-20 px/s over 20 levels so each step feels distinctly slower, while the
 * 20-120 px/s band keeps mid/high levels nearly unchanged.
 */
const AUTO_SCROLL_LOW_SEGMENT_LEVELS = 20

export function autoScrollPixelsPerSecond(speed: number): number {
  const normalized = normalizeAutoScrollSpeed(speed)
  if (normalized <= AUTO_SCROLL_LOW_SEGMENT_LEVELS) {
    const slowest = 4
    const lowBand = 20
    return slowest * (lowBand / slowest) ** ((normalized - 1) / (AUTO_SCROLL_LOW_SEGMENT_LEVELS - 1))
  }
  const lowBand = 20
  const fastest = 120
  return lowBand * (fastest / lowBand) ** ((normalized - AUTO_SCROLL_LOW_SEGMENT_LEVELS) / (100 - AUTO_SCROLL_LOW_SEGMENT_LEVELS))
}

export const AUTO_SCROLL_MIN_SPEED = 1
export const AUTO_SCROLL_MAX_SPEED = 100
export const AUTO_SCROLL_SPEED_STEP = 1

export function normalizeAutoScrollSpeed(speed: number): number {
  const clamped = Math.max(
    AUTO_SCROLL_MIN_SPEED,
    Math.min(AUTO_SCROLL_MAX_SPEED, Number.isFinite(speed) ? speed : 1)
  )
  return Math.round(clamped)
}

export function adjustAutoScrollSpeed(speed: number, delta: number): number {
  return normalizeAutoScrollSpeed(speed + delta)
}

/**
 * A sentence (or paragraph tail) inside one content root, with its vertical
 * position already converted into the scroll container's content coordinates
 * so it stays comparable with `container.scrollTop` while scrolling.
 */
export interface ScrollSegment {
  range: Range
  text: string
  top: number
  bottom: number
}

/**
 * One lazily-collected content region (a TXT chapter, an EPUB iframe body or
 * a PDF text layer) that the auto-scroll engine can walk through in order.
 * `mapY` converts viewport coordinates inside this root into the scroll
 * container's content space; it must compute offsets live because the
 * container keeps scrolling.
 */
export interface AutoScrollRootView {
  el: HTMLElement
  document: Document
  highlightHost: HTMLElement
  mapY: (viewportY: number) => number
}

export function collectScrollSegments(
  root: HTMLElement,
  mapY: (viewportY: number) => number
): ScrollSegment[] {
  const chunks = collectTextChunks(root)
  if (chunks.length === 0) return []
  let text = ''
  for (const [index, chunk] of chunks.entries()) {
    const previous = chunks[index - 1]
    if (
      previous &&
      text &&
      isBlockBoundary(previous.node.parentElement, chunk.node.parentElement)
    ) {
      text += '\n'
    }
    chunk.start = text.length
    text += chunk.node.data
    chunk.end = text.length
  }

  const segments: ScrollSegment[] = []
  for (const segment of splitSentenceSegments(text)) {
    const range = rangeFromOffsets(chunks, segment.start, segment.end)
    if (!range) continue
    const rect = range.getBoundingClientRect()
    if (rect.height <= 0) continue
    segments.push({
      range,
      text: segment.text,
      top: mapY(rect.top),
      bottom: mapY(rect.bottom)
    })
  }
  return segments
}

/** Index of the last segment whose top edge is at or above `y` (-1 if none). */
export function findSegmentIndexAt(segments: ScrollSegment[], y: number): number {
  let low = 0
  let high = segments.length - 1
  let result = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (segments[mid].top <= y) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return result
}

export function splitSentenceSegments(text: string): SentenceSegment[] {
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locale: string,
        options: { granularity: 'sentence' }
      ) => SegmenterLike
    }
  ).Segmenter

  const rawSegments: SentenceSegment[] = []
  if (Segmenter) {
    const segmenter = new Segmenter('zh-CN', { granularity: 'sentence' })
    for (const item of segmenter.segment(text)) {
      rawSegments.push({
        start: item.index,
        end: item.index + item.segment.length,
        text: item.segment
      })
    }
  } else {
    rawSegments.push(...fallbackSentenceSegments(text))
  }

  return rawSegments.flatMap((segment) => {
    const leading = segment.text.match(/^\s*/)?.[0].length ?? 0
    const trailing = segment.text.match(/\s*$/)?.[0].length ?? 0
    const start = segment.start + leading
    const end = segment.end - trailing
    const value = text.slice(start, end)
    return value.trim() ? [{ start, end, text: value }] : []
  })
}

const FADE_IN_MS = 420
const FADE_IN_STAGGER_MS = 70
const FADE_OUT_MS = 560

interface HighlightGroup {
  nodes: HTMLDivElement[]
  removeTimer: number | null
}

/**
 * Paints sentence highlights as absolutely-positioned overlay rectangles
 * anchored to the content, so the colored band glides together with the
 * scrolling text. New segments fade in line-by-line (soft leading edge) and
 * finished segments fade out (soft trailing edge) instead of jumping.
 */
export class GradientHighlighter {
  private readonly layer: HTMLDivElement
  private active: HighlightGroup | null = null
  private fading: HighlightGroup[] = []
  private destroyed = false

  constructor(host: HTMLElement, doc: Document) {
    this.layer = doc.createElement('div')
    this.layer.setAttribute('data-readex-auto-scroll-layer', '')
    const style = this.layer.style
    style.position = 'absolute'
    style.top = '0'
    style.left = '0'
    style.right = '0'
    style.bottom = '0'
    style.overflow = 'visible'
    style.pointerEvents = 'none'
    style.zIndex = '30'
    host.append(this.layer)
  }

  show(range: Range, color: string, light: boolean): void {
    if (this.destroyed) return
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0.5 && rect.height > 0.5
    )
    if (rects.length === 0) return
    this.retireActive()
    const layerRect = this.layer.getBoundingClientRect()
    const background = highlightBackground(color, light)
    const nodes: HTMLDivElement[] = []
    rects.forEach((rect, index) => {
      const node = this.layer.ownerDocument.createElement('div')
      const style = node.style
      style.position = 'absolute'
      style.left = `${rect.left - layerRect.left}px`
      style.top = `${rect.top - layerRect.top}px`
      style.width = `${rect.width}px`
      style.height = `${rect.height}px`
      style.background = background
      style.borderRadius = '0.28em'
      style.mixBlendMode = light ? 'multiply' : 'normal'
      style.opacity = '0'
      style.transition = `opacity ${FADE_IN_MS}ms cubic-bezier(0.25, 0.6, 0.3, 1)`
      style.transitionDelay = `${Math.min(index * FADE_IN_STAGGER_MS, 420)}ms`
      style.webkitMaskImage = SOFT_EDGE_MASK
      style.maskImage = SOFT_EDGE_MASK
      node.setAttribute('data-readex-auto-scroll-mark', '')
      this.layer.append(node)
      nodes.push(node)
    })
    // Next frame: transition from opacity 0 to 1 so lines cascade in.
    const ownerWindow = this.layer.ownerDocument.defaultView
    ownerWindow?.requestAnimationFrame(() => {
      if (this.destroyed) return
      for (const node of nodes) node.style.opacity = '1'
    })
    this.active = { nodes, removeTimer: null }
  }

  clear(immediate = false): void {
    this.retireActive()
    for (const group of this.fading) disposeGroup(group, immediate)
    this.fading = []
  }

  destroy(): void {
    this.clear(true)
    this.destroyed = true
    this.layer.remove()
  }

  private retireActive(): void {
    const group = this.active
    if (!group) return
    this.active = null
    for (const node of group.nodes) {
      node.style.transitionDelay = '0ms'
      node.style.transition = `opacity ${FADE_OUT_MS}ms ease`
      node.style.opacity = '0'
    }
    group.removeTimer =
      this.layer.ownerDocument.defaultView?.setTimeout(() => {
        this.fading = this.fading.filter((item) => item !== group)
        disposeGroup(group, true)
      }, FADE_OUT_MS + 120) ?? null
    this.fading.push(group)
  }
}

export type AutoScrollHighlightMode = 'off' | 'band' | 'sentence'

export interface AutoScrollDelegate {
  getContainer: () => HTMLElement | null
  getRoots: () => AutoScrollRootView[]
  getSpeed: () => number
  getHighlightColor: () => string
  isLightBackground: () => boolean
  /** Master switch for reading-focus annotations. */
  isHighlightEnabled: () => boolean
  /** 'band' = gaze band fixed at the reading line, 'sentence' = per-sentence marks. */
  getHighlightStyle: () => 'band' | 'sentence'
  /**
   * Positioned ancestor that fills the visible reading area; the gaze band is
   * appended here so it stays fixed while content scrolls.
   */
  getBandHost: () => HTMLElement | null
  /** Horizontal extent of the text column in viewport coordinates. */
  getBandRect: () => { left: number; width: number } | null
  onEnd?: () => void
}

const READING_RATIO = 0.3
const AUTO_SCROLL_INTERVAL_MS = 16
const SEGMENT_RETRY_DELAY = 0.28
const SEGMENT_MAX_RETRIES = 12
const END_GRACE_AT_END_OF_CONTENT = 2.4

type AutoScrollStatus = 'started' | 'end' | 'unavailable'

/**
 * Drives the document at a constant pixels-per-second pace with a
 * requestAnimationFrame loop and keeps the gradient highlight following the
 * reading line. Content roots are consumed lazily so lazily-rendered EPUB
 * sections / PDF pages can stream in while scrolling.
 */
export class AutoScrollController {
  private readonly delegate: AutoScrollDelegate
  private frame: ReturnType<typeof globalThis.setInterval> | 0 = 0
  private running = false
  private lastTime = 0
  private virtualScrollTop = 0
  private lastAppliedScrollTop = 0
  private endIdle = 0
  private noRootIdle = 0
  private segmentRetryTimer = 0
  private segmentRetries = 0
  private roots: AutoScrollRootView[] = []
  private rootIndex = -1
  private segments: ScrollSegment[] = []
  private activeSegmentIndex = -1
  private highlighter: GradientHighlighter | null = null
  private advanceCooldown = 0
  private bandDiv: HTMLDivElement | null = null
  private activeStyle: AutoScrollHighlightMode = 'sentence'

  constructor(delegate: AutoScrollDelegate) {
    this.delegate = delegate
  }

  start(): AutoScrollStatus {
    const container = this.delegate.getContainer()
    if (!container) return 'unavailable'
    this.roots = this.delegate.getRoots()
    if (this.roots.length === 0) return 'unavailable'

    const max = container.scrollHeight - container.clientHeight
    this.activeStyle = this.currentStyle()

    if (this.activeStyle === 'sentence') {
      const readingY = this.readingLineY(container)
      let index = this.roots.findIndex((root) => this.rootBottom(root) > readingY)
      if (index < 0) index = this.roots.length - 1
      this.rootIndex = index
      this.loadCurrentRoot()
      if (max <= 1 && this.segments.length <= 1) {
        this.stop()
        return 'end'
      }
    } else {
      if (this.activeStyle === 'band') this.ensureBand(container)
      if (max <= 1) {
        this.stop()
        return 'end'
      }
    }

    this.running = true
    this.lastTime = performance.now()
    this.virtualScrollTop = container.scrollTop
    this.lastAppliedScrollTop = container.scrollTop
    this.endIdle = 0
    this.noRootIdle = 0
    this.frame = globalThis.setInterval(
      () => this.tick(performance.now()),
      AUTO_SCROLL_INTERVAL_MS
    )
    return 'started'
  }

  stop(): void {
    this.running = false
    if (this.frame) globalThis.clearInterval(this.frame)
    this.frame = 0
    if (this.segmentRetryTimer) {
      window.clearInterval(this.segmentRetryTimer)
      this.segmentRetryTimer = 0
    }
    this.removeBand(false)
    this.highlighter?.destroy()
    this.highlighter = null
    this.roots = []
    this.rootIndex = -1
    this.segments = []
    this.activeSegmentIndex = -1
    this.virtualScrollTop = 0
    this.lastAppliedScrollTop = 0
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return
    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastTime) / 1000))
    this.lastTime = now
    const container = this.delegate.getContainer()
    if (!container) {
      this.finish()
      return
    }

    const speed = autoScrollPixelsPerSecond(this.delegate.getSpeed())
    const max = Math.max(0, container.scrollHeight - container.clientHeight)
    const externalScrollTop = container.scrollTop
    if (Math.abs(externalScrollTop - this.lastAppliedScrollTop) > 1.5) {
      // Keep user-driven jumps, but preserve fractions from our own updates.
      this.virtualScrollTop = externalScrollTop
    }
    const nextScrollTop = Math.min(max, this.virtualScrollTop + speed * dt)
    this.virtualScrollTop = nextScrollTop
    container.scrollTo({ top: nextScrollTop, behavior: 'auto' })
    this.lastAppliedScrollTop = nextScrollTop
    const atEnd = nextScrollTop >= max - 0.5

    const style = this.currentStyle()
    if (style !== this.activeStyle) {
      this.activeStyle = style
      this.syncHighlightMode(container)
    }
    if (this.activeStyle === 'sentence') {
      this.updateHighlight(container, dt)
    } else if (this.activeStyle === 'band') {
      this.updateBand(container)
    }

    if (atEnd) {
      this.endIdle += dt
      const lastSegment = this.segments[this.segments.length - 1]
      const readingY = this.readingLineY(container)
      const lastSegmentPassed =
        !lastSegment || readingY >= lastSegment.bottom - 4
      if (
        (lastSegmentPassed && this.endIdle > 0.9) ||
        this.endIdle > END_GRACE_AT_END_OF_CONTENT + 2
      ) {
        this.finish()
        return
      }
    } else {
      this.endIdle = 0
    }
  }

  private currentStyle(): AutoScrollHighlightMode {
    if (!this.delegate.isHighlightEnabled()) return 'off'
    return this.delegate.getHighlightStyle() === 'sentence' ? 'sentence' : 'band'
  }

  /** Tear down / build the annotation surfaces when the style flips mid-run. */
  private syncHighlightMode(container: HTMLElement): void {
    if (this.activeStyle === 'sentence') {
      this.removeBand(true)
      if (this.segments.length === 0) this.loadCurrentRoot()
      return
    }
    this.highlighter?.clear()
    this.highlighter?.destroy()
    this.highlighter = null
    this.segments = []
    this.activeSegmentIndex = -1
    if (this.activeStyle === 'band') {
      this.ensureBand(container)
    } else {
      this.removeBand(false)
    }
  }

  /** Fixed gaze band: text glides through it, tint fading in below, out above. */
  private ensureBand(container: HTMLElement): void {
    if (this.bandDiv) return
    const host = this.delegate.getBandHost()
    if (!host) return
    const doc = host.ownerDocument
    const div = doc.createElement('div')
    div.setAttribute('data-readex-auto-scroll-band', '')
    const style = div.style
    style.position = 'absolute'
    style.pointerEvents = 'none'
    style.zIndex = '12'
    style.borderRadius = '8px'
    style.opacity = '0'
    style.transition = 'opacity 460ms ease'
    const light = this.delegate.isLightBackground()
    style.background = bandGradient(this.delegate.getHighlightColor(), light)
    style.mixBlendMode = light ? 'multiply' : 'normal'
    host.append(div)
    this.bandDiv = div
    doc.defaultView?.requestAnimationFrame(() => {
      if (this.bandDiv === div) div.style.opacity = '1'
    })
    this.updateBand(container)
  }

  private updateBand(container: HTMLElement): void {
    if (!this.bandDiv) {
      this.ensureBand(container)
      if (!this.bandDiv) return
    }
    const band = this.bandDiv
    const host = band.parentElement
    if (!host) return
    const hostRect = host.getBoundingClientRect()
    const column = this.delegate.getBandRect()
    const height = Math.round(container.clientHeight * 0.16)
    const top = Math.round(container.clientHeight * READING_RATIO - height / 2)
    const left = Math.round(
      column ? column.left - hostRect.left : hostRect.width * 0.12
    )
    const width = Math.round(column ? column.width : hostRect.width * 0.76)
    const apply = (name: 'top' | 'left' | 'width' | 'height', value: number, current: string): void => {
      if (current !== `${value}px`) band.style[name] = `${value}px`
    }
    apply('top', top, band.style.top)
    apply('left', left, band.style.left)
    apply('width', width, band.style.width)
    apply('height', height, band.style.height)
  }

  private removeBand(immediate: boolean): void {
    const band = this.bandDiv
    if (!band) return
    this.bandDiv = null
    if (immediate) {
      band.remove()
      return
    }
    band.style.opacity = '0'
    band.ownerDocument.defaultView?.setTimeout(() => band.remove(), 520)
  }

  private updateHighlight(container: HTMLElement, dt: number): void {
    const readingY = this.readingLineY(container)
    const current = this.roots[this.rootIndex]
    if (current && readingY >= this.rootBottom(current) - 2) {
      this.advanceCooldown -= dt
      if (this.advanceCooldown <= 0) {
        this.advanceCooldown = 0.5
        this.advanceRoot()
      }
    } else {
      this.advanceCooldown = 0
    }

    if (this.segments.length === 0) {
      // Roots can mount lazily (EPUB sections, PDF text layers). Poll briefly.
      this.segmentRetryTimer += dt
      if (this.segmentRetryTimer >= SEGMENT_RETRY_DELAY) {
        this.segmentRetryTimer = 0
        this.segmentRetries += 1
        if (this.segmentRetries > SEGMENT_MAX_RETRIES) {
          if (!this.advanceRoot()) {
            this.noRootIdle += SEGMENT_RETRY_DELAY
            if (this.noRootIdle > END_GRACE_AT_END_OF_CONTENT) this.finish()
          }
        } else {
          this.loadCurrentRoot()
        }
      }
      return
    }
    this.segmentRetries = 0
    this.noRootIdle = 0

    const index = findSegmentIndexAt(this.segments, readingY)
    if (index < 0 || index === this.activeSegmentIndex) return
    this.activeSegmentIndex = index
    const segment = this.segments[index]
    if (!this.highlighter) return
    this.highlighter.show(
      segment.range,
      this.delegate.getHighlightColor(),
      this.delegate.isLightBackground()
    )
  }

  private loadCurrentRoot(): void {
    const root = this.roots[this.rootIndex]
    this.highlighter?.clear()
    this.highlighter?.destroy()
    this.highlighter = null
    this.segments = []
    this.activeSegmentIndex = -1
    this.segmentRetries = 0
    if (!root) return
    this.highlighter = new GradientHighlighter(root.highlightHost, root.document)
    this.segments = collectScrollSegments(root.el, root.mapY)
  }

  /** Move to the next content root; re-scans the DOM so streamed-in roots show up. */
  private advanceRoot(): boolean {
    this.roots = this.delegate.getRoots()
    if (this.rootIndex + 1 >= this.roots.length) return false
    this.rootIndex += 1
    this.loadCurrentRoot()
    return true
  }

  private rootBottom(root: AutoScrollRootView): number {
    return root.mapY(root.el.getBoundingClientRect().bottom)
  }

  private readingLineY(container: HTMLElement): number {
    return container.scrollTop + container.clientHeight * READING_RATIO
  }

  private finish(): void {
    const wasRunning = this.running
    this.stop()
    if (wasRunning) this.delegate.onEnd?.()
  }
}

const SOFT_EDGE_MASK =
  'linear-gradient(to bottom, transparent 0%, #000 24%, #000 80%, transparent 100%)'

function highlightBackground(color: string, light: boolean): string {
  const alpha = light ? 0.5 : 0.42
  return `rgba(${colorChannels(color)}, ${alpha})`
}

/**
 * Vertical soft-edge gradient for the gaze band: the trailing (top) edge fades
 * out while the leading (bottom) edge fades in, so text appears to light up as
 * it flows through the reading zone.
 */
function bandGradient(color: string, light: boolean): string {
  const alpha = light ? 0.5 : 0.3
  const channels = colorChannels(color)
  return `linear-gradient(to bottom, rgba(${channels}, 0) 0%, rgba(${channels}, ${alpha}) 26%, rgba(${channels}, ${alpha}) 74%, rgba(${channels}, 0) 100%)`
}

function colorChannels(color: string): string {
  const hex = /^#[\da-f]{6}$/i.test(color) ? color : '#b7e4c7'
  return [1, 3, 5]
    .map((index) => Number.parseInt(hex.slice(index, index + 2), 16))
    .join(', ')
}

function disposeGroup(group: HighlightGroup, immediate: boolean): void {
  if (group.removeTimer !== null) {
    group.nodes[0]?.ownerDocument.defaultView?.clearTimeout(group.removeTimer)
    group.removeTimer = null
  }
  if (immediate) {
    for (const node of group.nodes) node.remove()
  }
}

function collectTextChunks(root: HTMLElement): TextChunk[] {
  const ownerDocument = root.ownerDocument
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT
      }
      const style = parent.ownerDocument.defaultView?.getComputedStyle(parent)
      if (style?.display === 'none' || style?.visibility === 'hidden') {
        return NodeFilter.FILTER_REJECT
      }
      const text = node as Text
      return text.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })

  const chunks: TextChunk[] = []
  let node = walker.nextNode() as Text | null
  while (node) {
    chunks.push({ node, start: 0, end: 0 })
    node = walker.nextNode() as Text | null
  }
  return chunks
}

function rangeFromOffsets(
  chunks: TextChunk[],
  start: number,
  end: number
): Range | null {
  const startPosition = findBoundary(chunks, start)
  const endPosition = findBoundary(chunks, end)
  const ownerDocument = chunks[0]?.node.ownerDocument
  if (!startPosition || !endPosition || !ownerDocument) return null
  const range = ownerDocument.createRange()
  range.setStart(startPosition.node, startPosition.offset)
  range.setEnd(endPosition.node, endPosition.offset)
  return range
}

function findBoundary(
  chunks: TextChunk[],
  absoluteOffset: number
): { node: Text; offset: number } | null {
  for (const chunk of chunks) {
    if (absoluteOffset <= chunk.end) {
      return {
        node: chunk.node,
        offset: Math.max(0, Math.min(chunk.node.data.length, absoluteOffset - chunk.start))
      }
    }
  }
  return null
}

function isBlockBoundary(previous: Element | null, current: Element | null): boolean {
  if (!previous || !current || previous === current) return false
  const blockTags = new Set([
    'ADDRESS',
    'ARTICLE',
    'BLOCKQUOTE',
    'DIV',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'LI',
    'P',
    'SECTION'
  ])
  return blockTags.has(previous.tagName) || blockTags.has(current.tagName)
}

function fallbackSentenceSegments(text: string): SentenceSegment[] {
  const segments: SentenceSegment[] = []
  const closers = new Set(['”', '’', '」', '』', '】', '）', ')', ']'])
  let start = -1
  for (let index = 0; index < text.length; index += 1) {
    if (start < 0 && !/\s/.test(text[index])) start = index
    if (start < 0 || !/[。！？!?；;]/.test(text[index])) continue
    let end = index + 1
    while (end < text.length && closers.has(text[end])) end += 1
    segments.push({ start, end, text: text.slice(start, end) })
    start = -1
    index = end - 1
  }
  if (start >= 0) {
    segments.push({ start, end: text.length, text: text.slice(start) })
  }
  return segments
}
