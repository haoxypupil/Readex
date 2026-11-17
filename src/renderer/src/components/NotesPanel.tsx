import { Download, NotebookPen, Trash2 } from 'lucide-react'
import type { Annotation } from '@shared/types'
import { ANNOTATION_COLORS } from '@shared/types'

interface NotesPanelProps {
  annotations: Annotation[]
  activeId?: string
  onSelect: (annotation: Annotation) => void
  onDelete: (annotation: Annotation) => void
  onExport: () => void
}

export function NotesPanel({
  annotations,
  activeId,
  onSelect,
  onDelete,
  onExport
}: NotesPanelProps): React.JSX.Element {
  const byNewest = (a: Annotation, b: Annotation): number =>
    b.createdAt.localeCompare(a.createdAt)
  const bookmarks = annotations.filter((annotation) => annotation.type === 'bookmark').sort(byNewest)
  const notes = annotations.filter((annotation) => annotation.type !== 'bookmark').sort(byNewest)

  const renderCard = (annotation: Annotation): React.JSX.Element => (
    <article
      className={`annotation-card ${activeId === annotation.id ? 'active' : ''}`}
      key={annotation.id}
    >
      <button type="button" className="annotation-main" onClick={() => onSelect(annotation)}>
        <span
          className="annotation-color"
          style={{ background: ANNOTATION_COLORS[annotation.color] }}
        />
        {annotation.type === 'bookmark' && <span className="annotation-kind">书签</span>}
        <span className="annotation-quote">{annotation.text}</span>
        {annotation.note && <span className="annotation-note">{annotation.note}</span>}
        {(annotation.tags ?? []).length > 0 && (
          <span className="annotation-tags">
            {(annotation.tags ?? []).map((tag) => (
              <i key={tag}>{tag}</i>
            ))}
          </span>
        )}
        <time>{new Date(annotation.createdAt).toLocaleString('zh-CN')}</time>
      </button>
      <button
        className="annotation-delete"
        type="button"
        title="删除"
        onClick={() => onDelete(annotation)}
      >
        <Trash2 size={14} />
      </button>
    </article>
  )

  return (
    <div className="side-panel-content">
      <div className="panel-title panel-title-actions">
        <span>
          <NotebookPen size={16} />
          笔记
        </span>
        <button type="button" title="导出 Markdown" onClick={onExport}>
          <Download size={15} />
        </button>
      </div>
      {annotations.length === 0 ? (
        <div className="panel-empty">
          选中正文后即可高亮或写批注。所有笔记只保存在本机。
        </div>
      ) : (
        <div className="annotation-list">
          {bookmarks.length > 0 && (
            <>
              <div className="annotation-group-title">
                书签<span>{bookmarks.length}</span>
              </div>
              {bookmarks.map(renderCard)}
            </>
          )}
          {notes.length > 0 && (
            <>
              <div className="annotation-group-title">
                {bookmarks.length > 0 ? '高亮与笔记' : '全部标注'}
                <span>{notes.length}</span>
              </div>
              {notes.map(renderCard)}
            </>
          )}
        </div>
      )}
    </div>
  )
}
