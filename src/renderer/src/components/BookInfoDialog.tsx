import { useState } from 'react'
import { BookOpen, X } from 'lucide-react'
import type { BookRecord } from '@shared/types'
import { bookCoverSrc } from '../lib/covers'
import { useDialogFocus } from '../lib/dialogFocus'

interface BookInfoDialogProps {
  book: BookRecord
  onClose: () => void
  onSaved: (book: BookRecord) => void
}

export function BookInfoDialog({
  book,
  onClose,
  onSaved
}: BookInfoDialogProps): React.JSX.Element {
  const dialogRef = useDialogFocus<HTMLFormElement>(onClose)
  const [title, setTitle] = useState(book.title)
  const [author, setAuthor] = useState(book.author === '未知作者' ? '' : book.author)
  const [publisher, setPublisher] = useState(book.publisher ?? '')
  const [description, setDescription] = useState(book.description ?? '')
  const [tags, setTags] = useState((book.tags ?? []).join('，'))
  const [saving, setSaving] = useState(false)
  const [changingCover, setChangingCover] = useState(false)
  const [error, setError] = useState('')

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!title.trim()) {
      setError('书名不能为空')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await window.readex.library.updateMetadata(book.id, {
        title,
        author,
        publisher,
        description,
        // 语言和阅读方向不在表单中编辑，显式回传避免被清空。
        language: book.language,
        readingDirection: book.readingDirection,
        tags: tags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean)
      })
      if (saved) {
        onSaved(saved)
        onClose()
      } else {
        setError('书籍不存在或已被移除')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const chooseCover = async (): Promise<void> => {
    setChangingCover(true)
    setError('')
    try {
      const updated = await window.readex.library.chooseCover(book.id)
      if (updated) onSaved(updated)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '更换封面失败')
    } finally {
      setChangingCover(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className="dialog book-info-dialog"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="编辑书籍信息"
        onSubmit={(event) => void save(event)}
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">书库元数据</p>
            <h2>编辑书籍信息</h2>
          </div>
          <button className="icon-button" type="button" title="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="book-info-form">
          <div className="book-info-cover">
            <span className="book-info-cover-image">
              {bookCoverSrc(book) ? (
                <img src={bookCoverSrc(book)} alt="" />
              ) : (
                <BookOpen size={26} />
              )}
            </span>
            <div>
              <button
                className="secondary-button"
                type="button"
                disabled={changingCover}
                onClick={() => void chooseCover()}
              >
                {changingCover ? '正在更新…' : '更换封面'}
              </button>
              <p>支持 PNG、JPEG、WebP、GIF 或 BMP，最大 8 MB。</p>
            </div>
          </div>
          <label>
            <span>书名</span>
            <input
              autoFocus
              value={title}
              maxLength={240}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            <span>作者</span>
            <input
              value={author}
              maxLength={120}
              placeholder="未知作者"
              onChange={(event) => setAuthor(event.target.value)}
            />
          </label>
          <label>
            <span>出版社</span>
            <input
              value={publisher}
              maxLength={160}
              onChange={(event) => setPublisher(event.target.value)}
            />
          </label>
          <label>
            <span>简介</span>
            <textarea
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label>
            <span>标签</span>
            <input
              value={tags}
              maxLength={160}
              placeholder="用逗号分隔，例如：技术，待读"
              onChange={(event) => setTags(event.target.value)}
            />
          </label>
          {error && <p className="field-error">{error}</p>}
        </div>

        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? '正在保存…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  )
}
