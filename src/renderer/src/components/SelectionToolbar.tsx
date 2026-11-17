import { useRef, useState } from 'react'
import { Check, Copy, History, MessageSquarePlus, Trash2, X } from 'lucide-react'
import type { Annotation, AnnotationColor } from '@shared/types'
import { ANNOTATION_COLORS } from '@shared/types'
import type { SelectedText } from '../lib/textAnchors'

interface SelectionToolbarProps {
  selection?: SelectedText
  annotation?: Annotation
  initialNoteOpen?: boolean
  onSave: (color: AnnotationColor, note: string, tags?: string[]) => void
  onDelete?: () => void
  onClose: () => void
}

export function SelectionToolbar({
  selection,
  annotation,
  initialNoteOpen = false,
  onSave,
  onDelete,
  onClose
}: SelectionToolbarProps): React.JSX.Element {
  const [noteOpen, setNoteOpen] = useState(initialNoteOpen || Boolean(annotation?.note))
  const [note, setNote] = useState(annotation?.note ?? '')
  const [tags, setTags] = useState((annotation?.tags ?? []).join('，'))
  const [historyOpen, setHistoryOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const text = annotation?.text ?? selection?.text ?? ''
  const revisions = annotation?.revisions ?? []
  const toolbarWidth = Math.min(400, window.innerWidth - 24)
  const anchorX = annotation
    ? window.innerWidth / 2
    : selection?.x ?? window.innerWidth / 2
  const x = Math.max(
    toolbarWidth / 2 + 12,
    Math.min(anchorX, window.innerWidth - toolbarWidth / 2 - 12)
  )
  const anchorY = annotation
    ? Math.max(80, Math.min(window.innerHeight - 240, window.innerHeight / 2))
    : selection?.y ?? 0
  const y = noteOpen
    ? Math.max(52, Math.min(anchorY, window.innerHeight - 330))
    : anchorY

  const save = (): void => {
    if (!note.trim()) return
    const tagList = tags
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
    onSave(annotation?.color ?? 'yellow', note.trim(), tagList)
  }

  const insertLineBreak = (): void => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const next = `${note.slice(0, start)}\n${note.slice(end)}`
    setNote(next)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start + 1, start + 1)
    })
  }

  return (
    <div
      className={`selection-toolbar ${noteOpen ? 'note-open' : ''}`}
      style={{ left: x, top: y }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="selection-toolbar-main">
        {!annotation &&
          (Object.keys(ANNOTATION_COLORS) as AnnotationColor[]).map((color) => (
            <button
              className="color-swatch"
              type="button"
              key={color}
              title={`${color} 高亮`}
              style={{ background: ANNOTATION_COLORS[color] }}
              onClick={() => onSave(color, note)}
            />
          ))}
        <span className="toolbar-divider" />
        <button
          className="toolbar-icon-button"
          type="button"
          title="复制"
          onClick={() => void navigator.clipboard.writeText(text)}
        >
          <Copy size={15} />
        </button>
        <button
          className="toolbar-icon-button"
          type="button"
          title="添加笔记"
          onClick={() => setNoteOpen((value) => !value)}
        >
          <MessageSquarePlus size={15} />
        </button>
        {annotation && onDelete && (
          <button className="toolbar-icon-button danger" type="button" title="删除" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        )}
        <button className="toolbar-icon-button" type="button" title="关闭" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div className="selection-quote">{text}</div>
      {noteOpen && (
        <div className="note-editor">
          <div className="note-editor-heading">
            <span className="note-editor-icon">
              <MessageSquarePlus size={15} />
            </span>
            <span>
              <strong>{annotation ? '编辑笔记' : '添加笔记'}</strong>
              <small>记录此刻的想法</small>
            </span>
          </div>
          <textarea
            autoFocus
            ref={textareaRef}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
                return
              }
              if (event.key !== 'Enter') return
              if (event.ctrlKey || event.metaKey) {
                event.preventDefault()
                insertLineBreak()
                return
              }
              if (event.shiftKey) return
              event.preventDefault()
              save()
            }}
            placeholder="写下你的想法…"
          />
          <label className="note-tags-field">
            <span>标签</span>
            <input
              value={tags}
              maxLength={160}
              placeholder="用逗号分隔，例如：金句，待复习"
              onChange={(event) => setTags(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Escape') {
                  event.preventDefault()
                  onClose()
                  return
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  save()
                }
              }}
            />
          </label>
          {revisions.length > 0 && noteOpen && (
            <div className="note-history">
              <button
                className="note-history-toggle"
                type="button"
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen((value) => !value)}
              >
                <History size={13} />
                历史版本 {revisions.length}
              </button>
              {historyOpen && (
                <div className="note-history-list">
                  {revisions.map((revision, index) => (
                    <button
                      type="button"
                      key={`${revision.updatedAt}-${index}`}
                      title="载入此版本到编辑器"
                      onClick={() => {
                        setNote(revision.note)
                        setHistoryOpen(false)
                      }}
                    >
                      <span
                        className="note-history-color"
                        style={{ background: ANNOTATION_COLORS[revision.color] }}
                      />
                      <span className="note-history-text">
                        {revision.note.trim() || '（空笔记）'}
                      </span>
                      <time>{new Date(revision.updatedAt).toLocaleString('zh-CN')}</time>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="note-editor-footer">
            <span>
              <kbd>Enter</kbd> 保存
              <i />
              <kbd>Ctrl+Enter</kbd> 换行
            </span>
            <button
              className="primary-button compact"
              type="button"
              disabled={!note.trim()}
              onClick={save}
            >
              <Check size={14} />
              {annotation ? '保存笔记' : '添加笔记'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
