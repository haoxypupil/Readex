import type { TocItem } from '@shared/types'

export interface ResolvedOutlineItem {
  title?: string
  page?: number | null
  items?: ResolvedOutlineItem[]
}

const MAX_OUTLINE_LABEL = 120

/** 把解析出页码的 PDF 大纲转为目录树；无页码且无子项的条目会被丢弃。 */
export function buildPdfOutlineToc(
  outline: readonly ResolvedOutlineItem[]
): TocItem[] {
  const result: TocItem[] = []
  outline.forEach((item, index) => {
    const children = Array.isArray(item.items) ? buildPdfOutlineToc(item.items) : []
    if (!item.page && children.length === 0) return
    const title = String(item.title ?? '').trim()
    result.push({
      id: `pdf-outline-${index}-${item.page ?? 'x'}`,
      label: title.slice(0, MAX_OUTLINE_LABEL) || `书签 ${index + 1}`,
      chapterId: item.page ? String(item.page) : undefined,
      children: children.length ? children : undefined
    })
  })
  return result
}
