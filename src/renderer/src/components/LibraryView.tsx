import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  FilePlus2,
  FolderSearch,
  LibraryBig,
  Pencil,
  Search,
  Trash2
} from 'lucide-react'
import type { BookRecord } from '@shared/types'
import { bookCoverSrc } from '../lib/covers'
import { bookFormatLabel, formatBytes, formatDate, formatPercent } from '../lib/format'

type SortMode = 'recent' | 'imported' | 'title' | 'progress'
type ReadingFilter = 'all' | 'unread' | 'reading' | 'finished'

interface LibraryViewProps {
  books: BookRecord[]
  importing: boolean
  onImport: () => void
  onImportPaths: (paths: string[]) => void
  onOpenBook: (bookId: string) => void
  onReveal: (bookId: string) => void
  onEdit: (book: BookRecord) => void
  onRemove: (book: BookRecord) => void
}

export function LibraryView({
  books,
  importing,
  onImport,
  onImportPaths,
  onOpenBook,
  onReveal,
  onEdit,
  onRemove
}: LibraryViewProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>('recent')
  const [filter, setFilter] = useState<ReadingFilter>('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [dragActive, setDragActive] = useState(false)

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    for (const book of books) {
      for (const tag of book.tags ?? []) tags.add(tag)
    }
    return [...tags].sort((left, right) => left.localeCompare(right, 'zh-CN'))
  }, [books])

  useEffect(() => {
    if (tagFilter !== 'all' && !allTags.includes(tagFilter)) setTagFilter('all')
  }, [allTags, tagFilter])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    let list = normalized
      ? books.filter((book) =>
          `${book.title} ${book.author} ${book.format} ${book.description ?? ''} ${book.fileName} ${(book.tags ?? []).join(' ')}`
            .toLocaleLowerCase()
            .includes(normalized)
        )
      : [...books]
    if (filter !== 'all') list = list.filter((book) => readingStatus(book) === filter)
    if (tagFilter !== 'all') {
      list = list.filter((book) => (book.tags ?? []).includes(tagFilter))
    }

    switch (sort) {
      case 'recent':
        list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        break
      case 'imported':
        list.sort((a, b) => b.importedAt.localeCompare(a.importedAt))
        break
      case 'title':
        list.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
        break
      case 'progress':
        list.sort((a, b) => b.progress - a.progress)
        break
    }
    return list
  }, [books, filter, query, sort, tagFilter])

  const dropFiles = (files: FileList): void => {
    const paths = Array.from(files)
      .map((file) => window.readex.system.getPathForFile(file))
      .filter(Boolean)
    if (paths.length) void onImportPaths(paths)
  }

  return (
    <main
      className={`library-view ${dragActive ? 'dragging' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault()
        setDragActive(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragActive(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragActive(false)
        if (event.dataTransfer.files.length) dropFiles(event.dataTransfer.files)
      }}
    >
      <header className="library-header">
        <div>
          <p className="eyebrow">个人图书库</p>
          <h1>全部书籍</h1>
          <p className="library-subtitle">
            {books.length
              ? `${books.length} 本书保存在 data/personal，完整离线可用`
              : '导入 EPUB、MOBI、PDF、TXT 或 CBZ 开始阅读'}
          </p>
        </div>
        <button className="primary-button" type="button" disabled={importing} onClick={onImport}>
          <FilePlus2 size={17} />
          <span>{importing ? '正在导入' : '导入图书'}</span>
        </button>
      </header>

      {books.length > 0 && (
        <div className="library-toolbar">
          <label className="search-field">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索书名、作者或简介"
            />
          </label>
          <select
            className="library-select"
            value={sort}
            aria-label="排序方式"
            onChange={(event) => setSort(event.target.value as SortMode)}
          >
            <option value="recent">最近活动</option>
            <option value="imported">导入时间</option>
            <option value="title">书名</option>
            <option value="progress">阅读进度</option>
          </select>
          <select
            className="library-select"
            value={filter}
            aria-label="阅读状态"
            onChange={(event) => setFilter(event.target.value as ReadingFilter)}
          >
            <option value="all">全部状态</option>
            <option value="unread">未读</option>
            <option value="reading">在读</option>
            <option value="finished">已读完</option>
          </select>
          {allTags.length > 0 && (
            <select
              className="library-select"
              value={tagFilter}
              aria-label="标签"
              onChange={(event) => setTagFilter(event.target.value)}
            >
              <option value="all">全部标签</option>
              {allTags.map((tag) => (
                <option value={tag} key={tag}>
                  {tag}
                </option>
              ))}
            </select>
          )}
          <span className="library-count">
            {filtered.length === books.length ? `${books.length} 本` : `${filtered.length} / ${books.length} 本`}
          </span>
        </div>
      )}

      {books.length === 0 ? (
        <section className="empty-library">
          <div className="empty-icon">
            <LibraryBig size={34} />
          </div>
          <h2>你的个人图书馆还是空的</h2>
          <p>将电子书拖到窗口任意位置，或从电脑中选择文件。原文件不会被移动。</p>
          <button className="primary-button" type="button" onClick={onImport}>
            <FilePlus2 size={17} />
            <span>选择电子书</span>
          </button>
          <div className="format-list">
            {['EPUB', 'MOBI / KF8', 'PDF', 'TXT', 'CBZ'].map((format) => (
              <span key={format}>{format}</span>
            ))}
          </div>
        </section>
      ) : filtered.length === 0 ? (
        <section className="empty-library">
          <div className="empty-icon">
            <Search size={30} />
          </div>
          <h2>没有符合条件的书籍</h2>
          <p>调整搜索词或阅读状态筛选后再试。</p>
        </section>
      ) : (
        <section className="book-grid">
          {filtered.map((book) => (
            <article className="book-card" key={book.id}>
              <button
                className="book-card-main"
                type="button"
                title={`${book.progress >= 0.98 ? '已读完，重新阅读' : '继续阅读'} ${formatPercent(book.progress)}`}
                onClick={() => onOpenBook(book.id)}
              >
                <div className="book-cover">
                  {bookCoverSrc(book) ? (
                    <img src={bookCoverSrc(book)} alt="" />
                  ) : (
                    <div className="cover-fallback">
                      <BookOpen size={28} />
                      <strong>{book.title.slice(0, 24)}</strong>
                    </div>
                  )}
                  <span className="format-badge">{bookFormatLabel(book.format)}</span>
                  {readingStatus(book) === 'finished' && (
                    <span className="finished-badge">已读完</span>
                  )}
                </div>
                <div className="book-card-copy">
                  <h2 title={book.title}>{book.title}</h2>
                  <p>{book.author || '未知作者'}</p>
                  {(book.tags ?? []).length > 0 && (
                    <div className="book-tags">
                      {(book.tags ?? []).slice(0, 3).map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  )}
                  <div className="book-meta">
                    <span title={`文件大小 ${formatBytes(book.size)}`}>
                      已读 {formatPercent(book.progress)}
                    </span>
                    <span title={`导入于 ${formatDate(book.importedAt)}`}>
                      {formatDate(book.updatedAt || book.importedAt)}
                    </span>
                  </div>
                </div>
              </button>
              <div className="book-progress" title={`阅读进度 ${formatPercent(book.progress)}`}>
                <span style={{ width: formatPercent(book.progress) }} />
              </div>
              <div className="book-actions">
                <button type="button" title="编辑书籍信息" onClick={() => onEdit(book)}>
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  title="在资源管理器中显示"
                  onClick={() => onReveal(book.id)}
                >
                  <FolderSearch size={15} />
                </button>
                <button type="button" title="移除" onClick={() => onRemove(book)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {dragActive && (
        <div className="drop-overlay">
          <FilePlus2 size={36} />
          <strong>释放以导入电子书</strong>
          <span>支持 EPUB、MOBI、PDF、TXT、CBZ</span>
        </div>
      )}
    </main>
  )
}

function readingStatus(book: BookRecord): Exclude<ReadingFilter, 'all'> {
  if (book.progress >= 0.98) return 'finished'
  if (book.progress > 0.001) return 'reading'
  return 'unread'
}
