import type { Annotation, AnnotationColor, BookRecord } from '@shared/types'

const MAX_REVISIONS = 10

/** 生成一次标注更新，内容有变化时把旧版本压入最多 10 条历史。 */
export function createAnnotationUpdate(
  annotation: Annotation,
  color: AnnotationColor,
  note: string,
  now = new Date().toISOString()
): Annotation {
  if (annotation.note === note && annotation.color === color) {
    return { ...annotation, updatedAt: now }
  }
  const revisions = [
    {
      note: annotation.note,
      color: annotation.color,
      updatedAt: annotation.updatedAt
    },
    ...(annotation.revisions ?? [])
  ].slice(0, MAX_REVISIONS)
  return { ...annotation, color, note, updatedAt: now, revisions }
}

export function annotationsToMarkdown(book: BookRecord, annotations: Annotation[]): string {
  const lines = [
    `# ${book.title} - 阅读笔记`,
    '',
    `- 作者：${book.author || '未知作者'}`,
    `- 格式：${book.format.toUpperCase()}`,
    `- 标注数量：${annotations.length}`,
    `- 导出时间：${new Date().toLocaleString('zh-CN')}`,
    ''
  ]

  for (const annotation of [...annotations].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    lines.push(
      `## ${annotationTypeLabel(annotation)}`
    )
    lines.push('')
    lines.push(`> ${annotation.text.replace(/\n/g, '\n> ')}`)
    lines.push('')
    if (annotation.note) {
      lines.push(annotation.note)
      lines.push('')
    }
    lines.push(`<small>${new Date(annotation.createdAt).toLocaleString('zh-CN')}</small>`)
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

/** 跨书导出：按书名分组，组内按时间顺序排列。 */
export function allAnnotationsToMarkdown(
  books: BookRecord[],
  annotations: Annotation[]
): string {
  const lines = [
    '# Readex 全部笔记',
    '',
    `- 标注数量：${annotations.length}`,
    `- 导出时间：${new Date().toLocaleString('zh-CN')}`,
    ''
  ]
  const groups = books
    .map((book) => ({
      book,
      items: annotations
        .filter((annotation) => annotation.bookId === book.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    }))
    .filter((group) => group.items.length > 0)

  for (const { book, items } of groups) {
    lines.push(`## ${book.title}`, '')
    lines.push(`- 作者：${book.author || '未知作者'}`)
    lines.push(`- 标注数量：${items.length}`, '')
    for (const annotation of items) {
      lines.push(`### ${annotationTypeLabel(annotation)}`, '')
      lines.push(`> ${annotation.text.replace(/\n/g, '\n> ')}`, '')
      if (annotation.note) lines.push(annotation.note, '')
      lines.push(`<small>${new Date(annotation.createdAt).toLocaleString('zh-CN')}</small>`, '')
    }
    lines.push('---', '')
  }

  return lines.join('\n')
}

export function annotationTypeLabel(annotation: Annotation): string {
  if (annotation.type === 'bookmark') return '书签'
  if (annotation.type === 'comment') return '笔记'
  return '高亮'
}
