import { BookOpen, Github, Keyboard, ShieldCheck, X } from 'lucide-react'
import logoUrl from '../assets/readex-logo.png'
import { useDialogFocus } from '../lib/dialogFocus'

interface InfoDialogProps {
  mode: 'shortcuts' | 'about' | 'licenses'
  version: string
  onClose: () => void
}

export function InfoDialog({ mode, version, onClose }: InfoDialogProps): React.JSX.Element {
  const title =
    mode === 'shortcuts' ? '键盘快捷键' : mode === 'licenses' ? '第三方许可' : '关于 Readex'
  const dialogRef = useDialogFocus<HTMLElement>(onClose)

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="dialog info-dialog"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Readex</p>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" type="button" title="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {mode === 'shortcuts' && (
          <div className="shortcut-list">
            {[
              ['导入图书', 'Ctrl+O'],
              ['阅读设置', 'Ctrl+,'],
              ['书内搜索', 'Ctrl+F'],
              ['沉浸阅读', 'Ctrl+Shift+F'],
              ['上一页 / 下一页', 'PageUp / PageDown 或 Space'],
              ['上一章 / 下一章', 'Ctrl+PageUp / PageDown'],
              ['添加或移除书签', 'Ctrl+D'],
              ['开始 / 暂停自动滚动', 'Ctrl+Shift+A'],
              ['增大字号 / 缩放 PDF', 'Ctrl+= / Ctrl+-'],
              ['恢复默认字号 / 缩放', 'Ctrl+0'],
              ['全部书籍', 'Ctrl+Shift+B'],
              ['目录', 'Ctrl+Shift+T'],
              ['笔记', 'Ctrl+Shift+N'],
              ['关闭工作区', 'Ctrl+W'],
              ['全屏', 'F11']
            ].map(([label, key]) => (
              <div key={label}>
                <Keyboard size={15} />
                <span>{label}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
          </div>
        )}

        {mode === 'licenses' && (
          <div className="license-list">
            <p>Readex 使用以下开源组件构建：</p>
            <ul>
              <li>Electron - MIT</li>
              <li>React - MIT</li>
              <li>epub.js - BSD-2-Clause</li>
              <li>PDF.js - Apache-2.0</li>
              <li>@lingo-reader/mobi-parser - MIT</li>
              <li>JSZip、DOMPurify - MIT / Apache-2.0</li>
              <li>Noto Serif SC、LXGW WenKai、ZCOOL XiaoWei - SIL OFL 1.1</li>
            </ul>
            <p>内置字体许可证位于安装目录的 resources/font-licenses。</p>
            <p>Readex 项目采用 PolyForm Noncommercial License 1.0.0，禁止商业使用。</p>
          </div>
        )}

        {mode === 'about' && (
          <div className="about-panel">
            <span className="about-mark">
              <img src={logoUrl} alt="" />
            </span>
            <h3>Readex {version}</h3>
            <p>一个安静、私密、可随身携带的本地电子书阅读器。</p>
            <p className="about-author">作者：Xiaoyao.Hao</p>
            <div className="about-points">
              <span>
                <ShieldCheck size={15} /> 不登录，不上传，不接入云端
              </span>
              <span>
                <BookOpen size={15} /> EPUB / MOBI / PDF / TXT
              </span>
              <span>
                <Github size={15} /> 数据位于程序旁 personal 目录
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
