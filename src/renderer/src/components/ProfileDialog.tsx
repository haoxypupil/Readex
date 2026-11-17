import { useEffect, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  Copy,
  Database,
  Eraser,
  FolderOpen,
  HardDrive,
  ShieldAlert,
  Trash2,
  X
} from 'lucide-react'
import type { ProfileInfo } from '@shared/types'
import { formatBytes } from '../lib/format'
import { useDialogFocus } from '../lib/dialogFocus'

interface ProfileDialogProps {
  onClose: () => void
  onChanged: () => void
}

export function ProfileDialog({ onClose, onChanged }: ProfileDialogProps): React.JSX.Element {
  const dialogRef = useDialogFocus<HTMLElement>(onClose)
  const [info, setInfo] = useState<ProfileInfo | null>(null)
  const [busy, setBusy] = useState<'backup' | 'restore' | 'clear' | 'tts' | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [message, setMessage] = useState('')

  const load = (): void => {
    void window.readex.profile.info().then(setInfo)
  }

  useEffect(load, [])

  const backup = async (): Promise<boolean> => {
    setBusy('backup')
    setMessage('')
    const result = await window.readex.profile.backup()
    setBusy(null)
    if (!result.canceled) {
      setMessage(`备份已保存到 ${result.filePath}`)
      return true
    }
    return false
  }

  const clear = async (): Promise<void> => {
    setBusy('clear')
    await window.readex.profile.clear()
    setBusy(null)
    setConfirmClear(false)
    setMessage('个人资料已清空。缓存和原始书籍文件没有被修改。')
    onChanged()
    load()
  }

  const restore = async (): Promise<void> => {
    setBusy('restore')
    setMessage('')
    const result = await window.readex.profile.restore()
    setBusy(null)
    setConfirmRestore(false)
    if (result.restored) {
      // 备份替换了书库与设置，整页重载以重新读取个人资料。
      window.location.reload()
      return
    }
    if (result.message) setMessage(result.message)
  }

  const clearTts = async (): Promise<void> => {
    setBusy('tts')
    setMessage('')
    const result = await window.readex.profile.clearTtsCache()
    setBusy(null)
    setMessage(`听书缓存已清空，释放 ${formatBytes(result.freedBytes)}`)
    load()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="dialog profile-dialog"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="个人资料"
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">便携数据管理</p>
            <h2>个人资料</h2>
          </div>
          <button className="icon-button" type="button" title="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="profile-summary">
          <div>
            <Database size={18} />
            <span>
              <strong>{info?.bookCount ?? 0}</strong>
              本电子书
            </span>
          </div>
          <div>
            <Archive size={18} />
            <span>
              <strong>{info?.annotationCount ?? 0}</strong>
              条笔记
            </span>
          </div>
          <div>
            <HardDrive size={18} />
            <span>
              <strong>{formatBytes(info?.sizeBytes ?? 0)}</strong>
              个人数据
            </span>
          </div>
          <div>
            <Eraser size={18} />
            <span>
              <strong>{formatBytes(info?.cacheBytes ?? 0)}</strong>
              解析与听书缓存
            </span>
          </div>
        </div>

        <div className="path-card">
          <span>个人资料目录</span>
          <code>{info?.personalPath ?? '正在读取…'}</code>
          <div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void window.readex.profile.open()}
            >
              <FolderOpen size={15} />
              打开
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                void window.readex.profile.copyPath().then(() => setMessage('路径已复制'))
              }}
            >
              <Copy size={15} />
              复制路径
            </button>
          </div>
        </div>

        <div className="explanation-box">
          <p>
            <strong>personal</strong> 目录保存图书、阅读进度、设置和全部笔记。复制或备份这个目录即可迁移个人资料。
          </p>
          <code>{info?.cachePath ?? ''}</code>
          <p>这是可重建的解析缓存，不属于个人资料，可以安全删除。</p>
        </div>

        <div className="profile-actions cache-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={busy !== null}
            onClick={() => void clearTts()}
          >
            <Eraser size={15} />
            {busy === 'tts' ? '正在清理…' : '清空听书缓存'}
          </button>
        </div>

        {confirmClear ? (
          <div className="danger-zone">
            <ShieldAlert size={21} />
            <div>
              <h3>确认清空个人资料？</h3>
              <p>将删除上述 personal 目录中的所有书籍和笔记，但不会删除你导入前的原始文件。</p>
              <div className="danger-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void backup()}
                >
                  <Archive size={15} />
                  先备份
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void clear()}
                >
                  <Trash2 size={15} />
                  {busy === 'clear' ? '正在清空…' : '确认清空'}
                </button>
                <button className="text-button" type="button" onClick={() => setConfirmClear(false)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        ) : confirmRestore ? (
          <div className="danger-zone">
            <ShieldAlert size={21} />
            <div>
              <h3>从备份恢复个人资料？</h3>
              <p>
                恢复会用备份中的 personal 覆盖当前书库、阅读进度、设置和笔记。建议先备份当前数据。
              </p>
              <div className="danger-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void backup()}
                >
                  <Archive size={15} />
                  先备份当前数据
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void restore()}
                >
                  <ArchiveRestore size={15} />
                  {busy === 'restore' ? '正在恢复…' : '选择备份并恢复'}
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setConfirmRestore(false)}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="profile-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={busy !== null}
              onClick={() => void backup()}
            >
              <Archive size={16} />
              {busy === 'backup' ? '正在备份…' : '备份个人资料'}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirmRestore(true)}
            >
              <ArchiveRestore size={16} />
              从备份恢复
            </button>
            <button
              className="danger-outline-button"
              type="button"
              onClick={() => setConfirmClear(true)}
            >
              <Trash2 size={16} />
              清空个人资料
            </button>
          </div>
        )}

        {message && <p className="dialog-message">{message}</p>}
      </section>
    </div>
  )
}
