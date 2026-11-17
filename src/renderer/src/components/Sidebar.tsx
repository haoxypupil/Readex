import {
  BarChart3,
  BookCopy,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  Library,
  NotebookPen,
  Search,
  Settings,
  ShieldCheck,
  X
} from 'lucide-react'
import type { BookRecord } from '@shared/types'
import { bookCoverSrc } from '../lib/covers'
import { bookFormatLabel, formatPercent } from '../lib/format'
import logoUrl from '../assets/readex-logo.png'

interface SidebarProps {
  collapsed: boolean
  books: BookRecord[]
  workspaceIds: string[]
  activeBookId: string | null
  currentView: 'library' | 'notes' | 'search' | 'stats' | 'book'
  onToggle: () => void
  onOpenLibrary: () => void
  onOpenStats: () => void
  onOpenSearch: () => void
  onOpenBook: (bookId: string) => void
  onCloseWorkspace: (bookId: string) => void
  onOpenNotes: () => void
  onImport: () => void
  onOpenSettings: () => void
  onOpenProfile: () => void
}

export function Sidebar({
  collapsed,
  books,
  workspaceIds,
  activeBookId,
  currentView,
  onToggle,
  onOpenLibrary,
  onOpenStats,
  onOpenSearch,
  onOpenBook,
  onCloseWorkspace,
  onOpenNotes,
  onImport,
  onOpenSettings,
  onOpenProfile
}: SidebarProps): React.JSX.Element {
  const workspaceBooks = workspaceIds
    .map((id) => books.find((book) => book.id === id))
    .filter((book): book is BookRecord => Boolean(book))

  if (collapsed) {
    return (
      <aside className="sidebar sidebar-collapsed">
        <button
          className="sidebar-rail-button sidebar-logo-button sidebar-expand-button"
          type="button"
          title="展开侧栏"
          onClick={onToggle}
        >
          <span className="brand-mark">
            <img src={logoUrl} alt="" />
          </span>
          <ChevronRight className="sidebar-expand-chevron" size={12} />
        </button>
        <button
          className={`sidebar-rail-button ${currentView === 'library' ? 'active' : ''}`}
          type="button"
          title="全部书籍"
          onClick={onOpenLibrary}
        >
          <Library size={18} />
        </button>
        <button
          className={`sidebar-rail-button ${currentView === 'stats' ? 'active' : ''}`}
          type="button"
          title="阅读统计"
          onClick={onOpenStats}
        >
          <BarChart3 size={18} />
        </button>
        <button
          className={`sidebar-rail-button ${currentView === 'search' ? 'active' : ''}`}
          type="button"
          title="全文搜索"
          onClick={onOpenSearch}
        >
          <Search size={18} />
        </button>
        <div className="rail-divider" />
        {workspaceBooks.slice(0, 8).map((book) => (
          <button
            className={`workspace-mini ${activeBookId === book.id ? 'active' : ''}`}
            key={book.id}
            type="button"
            title={book.title}
            onClick={() => onOpenBook(book.id)}
          >
            {bookCoverSrc(book) ? (
              <img src={bookCoverSrc(book)} alt="" />
            ) : (
              <span>{book.title.slice(0, 1).toUpperCase()}</span>
            )}
          </button>
        ))}
        <span className="rail-spacer" />
        <button className="sidebar-rail-button" type="button" title="导入图书" onClick={onImport}>
          <FilePlus2 size={18} />
        </button>
        <button className="sidebar-rail-button" type="button" title="设置" onClick={onOpenSettings}>
          <Settings size={18} />
        </button>
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <div className="sidebar-brand">
          <span className="brand-mark">
            <img src={logoUrl} alt="" />
          </span>
          <span>Readex</span>
        </div>
        <button className="icon-button subtle" type="button" title="收起侧栏" onClick={onToggle}>
          <ChevronLeft size={16} />
        </button>
      </div>

      <nav className="sidebar-nav">
        <button
          className={`sidebar-entry ${currentView === 'library' ? 'active' : ''}`}
          type="button"
          onClick={onOpenLibrary}
        >
          <Library size={16} />
          <span>全部书籍</span>
          <span className="entry-count">{books.length}</span>
        </button>
        <button
          className={`sidebar-entry ${currentView === 'notes' ? 'active' : ''}`}
          type="button"
          onClick={onOpenNotes}
        >
          <NotebookPen size={16} />
          <span>所有笔记</span>
        </button>
        <button
          className={`sidebar-entry ${currentView === 'stats' ? 'active' : ''}`}
          type="button"
          onClick={onOpenStats}
        >
          <BarChart3 size={16} />
          <span>阅读统计</span>
        </button>
        <button
          className={`sidebar-entry ${currentView === 'search' ? 'active' : ''}`}
          type="button"
          onClick={onOpenSearch}
        >
          <Search size={16} />
          <span>全文搜索</span>
        </button>
      </nav>

      <div className="sidebar-section-heading">
        <span>打开的书籍</span>
        <span>{workspaceBooks.length}</span>
      </div>

      <div className="workspace-list">
        {workspaceBooks.length === 0 ? (
          <div className="workspace-empty">
            <BookCopy size={20} />
            <span>打开一本书后，它会出现在这里</span>
          </div>
        ) : (
          workspaceBooks.map((book) => (
            <div
              className={`workspace-entry ${activeBookId === book.id && currentView === 'book' ? 'active' : ''}`}
              key={book.id}
            >
              <button className="workspace-main" type="button" onClick={() => onOpenBook(book.id)}>
                <span className="workspace-cover">
                  {bookCoverSrc(book) ? (
                    <img src={bookCoverSrc(book)} alt="" />
                  ) : (
                    <BookOpen size={17} />
                  )}
                </span>
                <span className="workspace-copy">
                  <strong>{book.title}</strong>
                  <span>
                    {bookFormatLabel(book.format)} · {formatPercent(book.progress)}
                  </span>
                </span>
              </button>
              <button
                className="workspace-close"
                type="button"
                title="关闭工作区"
                onClick={() => onCloseWorkspace(book.id)}
              >
                <X size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-footer-button primary" type="button" onClick={onImport}>
          <FilePlus2 size={16} />
          <span>导入图书</span>
        </button>
        <div className="sidebar-footer-row">
          <button type="button" onClick={onOpenProfile}>
            <ShieldCheck size={16} />
            <span>个人资料</span>
          </button>
          <button type="button" onClick={onOpenSettings} title="阅读设置">
            <Settings size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}
