import { useMemo, useState } from 'react'
import { BookOpen, Download, NotebookPen, Search } from 'lucide-react'
import type { Annotation, AnnotationType, BookRecord } from '@shared/types'
import { ANNOTATION_COLORS } from '@shared/types'
import { allAnnotationsToMarkdown, annotationTypeLabel } from '../lib/notes'

type SortMode = 'recent' | 'oldest' | 'book'
type TypeFilter = 'all' | AnnotationType

interface NotesDashboardProps {
  books: BookRecord[]
  annotations: Annotation[]
  loading: boolean
  onOpenBook: (bookId: string, annotation: Annotation) => void
}

export function NotesDashboard({
  books,
  annotations,
  loading,
  onOpenBook
}: NotesDashboardProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [bookFilter, setBookFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<SortMode>('recent')

  const bookTitle = (bookId: string): string =>
    books.find((book) => book.id === bookId)?.title ?? '未知书籍'

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const list = annotations.filter((annotation) => {
      if (bookFilter !== 'all' && annotation.bookId !== bookFilter) return false
      if (typeFilter !== 'all' && annotation.type !== typeFilter) return false
      if (!normalized) return true
      return `${annotation.text} ${annotation.note}`.toLocaleLowerCase().includes(normalized)
    })
    list.sort((a, b) => {
      if (sort === 'book') {
        const byBook = bookTitle(a.bookId).localeCompare(bookTitle(b.bookId), 'zh-CN')
        if (byBook !== 0) return byBook
        return b.createdAt.localeCompare(a.createdAt)
      }
      return sort === 'oldest'
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt)
    })
    return list
    // bookTitle 依赖 books，books 变化会影响排序结果。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, bookFilter, books, query, sort, typeFilter])

  const exportAll = (): void => {
    if (!annotations.length) return
    void window.readex.annotations.exportMarkdown(
      'library',
      allAnnotationsToMarkdown(books, annotations)
    )
  }

  return (
    <main className="notes-dashboard">
      <header>
        <p className="eyebrow">本地知识库</p>
        <h1>所有笔记</h1>
        <p>{annotations.length} 条高亮与批注，数据仅保存在 personal 目录</p>
      </header>
      <div className="notes-filters">
        <label className="search-field dashboard-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索摘录和批注"
          />
        </label>
        <select
          className="library-select"
          value={bookFilter}
          aria-label="按书籍筛选"
          onChange={(event) => setBookFilter(event.target.value)}
        >
          <option value="all">全部书籍</option>
          {books.map((book) => (
            <option value={book.id} key={book.id}>
              {book.title}
            </option>
          ))}
        </select>
        <select
          className="library-select"
          value={typeFilter}
          aria-label="按类型筛选"
          onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
        >
          <option value="all">全部类型</option>
          <option value="highlight">高亮</option>
          <option value="comment">笔记</option>
          <option value="bookmark">书签</option>
        </select>
        <select
          className="library-select"
          value={sort}
          aria-label="排序方式"
          onChange={(event) => setSort(event.target.value as SortMode)}
        >
          <option value="recent">最新在前</option>
          <option value="oldest">最早在前</option>
          <option value="book">按书名</option>
        </select>
        <button
          className="secondary-button notes-export"
          type="button"
          disabled={!annotations.length}
          onClick={exportAll}
        >
          <Download size={15} />
          导出全部
        </button>
      </div>
      {loading ? (
        <section className="empty-notes">
          <NotebookPen size={32} />
          <h2>正在加载笔记</h2>
          <p>只读取 local personal 目录中的批注数据。</p>
        </section>
      ) : results.length === 0 ? (
        <section className="empty-notes">
          <NotebookPen size={32} />
          <h2>{annotations.length ? '没有匹配的笔记' : '还没有笔记'}</h2>
          <p>{annotations.length ? '调整搜索词或筛选条件后再试。' : '打开一本书，选中文字即可开始高亮和批注。'}</p>
        </section>
      ) : (
        <section className="global-note-list">
          {results.map((annotation) => {
            const book = books.find((item) => item.id === annotation.bookId)
            return (
              <article key={annotation.id}>
                <button type="button" onClick={() => onOpenBook(annotation.bookId, annotation)}>
                  <span
                    className="annotation-color"
                    style={{ background: ANNOTATION_COLORS[annotation.color] }}
                  />
                  <span className="global-note-copy">
                    <strong>{annotation.text}</strong>
                    {annotation.note && <span>{annotation.note}</span>}
                    <small>
                      <BookOpen size={13} />
                      {book?.title ?? '未知书籍'} · {annotationTypeLabel(annotation)} ·{' '}
                      {new Date(annotation.createdAt).toLocaleDateString('zh-CN')}
                    </small>
                  </span>
                </button>
              </article>
            )
          })}
        </section>
      )}
    </main>
  )
}
