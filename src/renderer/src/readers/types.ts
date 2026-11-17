import type {
  Annotation,
  BookRecord,
  ReadingLocator,
  ReaderSettings,
  SearchResult,
  TocItem
} from '@shared/types'
import type { SelectedText } from '../lib/textAnchors'

export type AutoScrollStatus = 'started' | 'end' | 'unavailable'

export interface ReaderSpeechSegment {
  id: string
  text: string
  top: number
  bottom: number
  range: Range
}

export interface ReaderSpeechSnapshot {
  segments: ReaderSpeechSegment[]
  startIndex: number
}

export interface FloatingDragHandlers {
  onPointerDown: (event: PointerEvent) => void
  onPointerMove: (event: PointerEvent) => void
  onPointerUp: (event: PointerEvent) => void
}

export interface ReaderHandle {
  goTo: (target: ReadingLocator | TocItem) => void
  scrollBy: (delta: number) => void
  search: (query: string) => Promise<SearchResult[]>
  /** Begin continuous auto-scroll; returns whether it could start. */
  startAutoScroll: () => AutoScrollStatus
  stopAutoScroll: () => void
  /** Collect readable sentences currently mounted in the reader. */
  getSpeechSnapshot: () => ReaderSpeechSnapshot | null
  /** Move the visible reading area to a collected sentence. */
  scrollToSpeechSegment: (segmentId: string) => void
  /** Keep the spoken sentence visible without editing the book DOM. */
  setSpeechSegmentHighlight: (segmentId: string | null) => void
  /** Load the next mounted section and report whether the snapshot changed. */
  advanceSpeechSection: () => Promise<boolean>
  /** Highlight the currently navigated search hit; null clears it. */
  setSearchHighlight: (result: SearchResult | null) => void
}

export interface ReaderProps {
  book: BookRecord
  settings: ReaderSettings
  annotations: Annotation[]
  onSelection: (selection: SelectedText) => void
  onSelectionContextMenu: (selection: SelectedText, point: { x: number; y: number }) => void
  onReaderPointerDown: () => void
  onOpenAnnotation: (annotation: Annotation) => void
  onProgress: (locator: ReadingLocator, progress: number) => void
  onTocChange: (items: TocItem[]) => void
  onError: (message: string) => void
  /** Fired when continuous auto-scroll reaches the end of the document. */
  onAutoScrollEnd?: () => void
  /** 漫画双页开关（全局阅读设置）。 */
  onComicTwoPageChange?: (enabled: boolean) => void
  floatingDragHandlers?: FloatingDragHandlers
}
