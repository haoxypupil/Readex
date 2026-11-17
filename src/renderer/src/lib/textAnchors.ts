import type { Annotation, ReadingLocator } from '@shared/types'

export interface SelectedText {
  text: string
  locator: ReadingLocator
  x: number
  y: number
}

export function locatorFromSelection(
  root: HTMLElement,
  chapterId: string,
  type: 'mobi-offset' | 'text-offset'
): SelectedText | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null

  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null

  const text = range.toString().replace(/\s+/g, ' ').trim()
  if (!text) return null

  const start = getTextOffset(root, range.startContainer, range.startOffset)
  const end = getTextOffset(root, range.endContainer, range.endOffset)
  if (end <= start) return null

  const rootText = root.textContent ?? ''
  const rect = range.getBoundingClientRect()
  return {
    text,
    locator: {
      type,
      value: `${chapterId}:${start}:${end}`,
      chapterId,
      start,
      end,
      excerpt: rootText.slice(start, end),
      prefix: rootText.slice(Math.max(0, start - 80), start),
      suffix: rootText.slice(end, end + 80)
    },
    x: rect.left + rect.width / 2,
    y: rect.top
  }
}

export function createRangeByOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const startPosition = findTextPosition(root, start)
  const endPosition = findTextPosition(root, end)
  if (!startPosition || !endPosition) return null

  const range = document.createRange()
  range.setStart(startPosition.node, startPosition.offset)
  range.setEnd(endPosition.node, endPosition.offset)
  return range
}

export interface HighlightChapter {
  id: string
  root: HTMLElement
}

/**
 * 高亮注册表是按颜色共享的全局表，必须把所有章节的 range 收集完再一次性写入；
 * 逐章写入会让后一章覆盖前一章，导致长 TXT/MOBI 只显示最后一章的高亮。
 */
export function applyTextHighlights(
  chapters: ReadonlyArray<HighlightChapter>,
  annotations: Annotation[]
): void {
  const registry = (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS
  if (!registry?.highlights || typeof globalThis.Highlight === 'undefined') return

  const rangesByColor = new Map<Annotation['color'], Range[]>()
  for (const annotation of annotations) {
    const start = annotation.locator.start
    const end = annotation.locator.end
    if (start === undefined || end === undefined) continue
    const chapterId = annotation.locator.chapterId
    const candidates = chapterId
      ? chapters.filter((chapter) => chapter.id === chapterId)
      : chapters
    for (const chapter of candidates) {
      const range = createRangeByOffsets(chapter.root, start, end)
      if (!range) continue
      const ranges = rangesByColor.get(annotation.color) ?? []
      ranges.push(range)
      rangesByColor.set(annotation.color, ranges)
      break
    }
  }

  for (const color of ['yellow', 'green', 'blue', 'pink'] as const) {
    const ranges = rangesByColor.get(color)
    if (ranges?.length) {
      registry.highlights.set(`rdx-${color}`, new Highlight(...ranges))
    }
  }
}

export function clearTextHighlights(): void {
  const registry = (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS
  if (!registry?.highlights) return
  for (const color of ['yellow', 'green', 'blue', 'pink'] as const) {
    registry.highlights.delete(`rdx-${color}`)
  }
}

export function scrollToTextOffset(root: HTMLElement, start: number): void {
  const range = createRangeByOffsets(root, start, Math.min(start + 1, root.textContent?.length ?? start + 1))
  if (!range) return
  const element =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement
  element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

function getTextOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(root)
  range.setEnd(node, offset)
  return range.toString().length
}

function findTextPosition(root: HTMLElement, absoluteOffset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || ['SCRIPT', 'STYLE'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })

  let consumed = 0
  let node = walker.nextNode() as Text | null
  while (node) {
    const length = node.data.length
    if (absoluteOffset <= consumed + length) {
      return { node, offset: Math.max(0, absoluteOffset - consumed) }
    }
    consumed += length
    node = walker.nextNode() as Text | null
  }

  return null
}
