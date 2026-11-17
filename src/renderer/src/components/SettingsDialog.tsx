import {
  Columns2,
  EyeOff,
  Highlighter,
  Moon,
  MoveVertical,
  PictureInPicture2,
  Play,
  RotateCcw,
  Target,
  Type,
  X
} from 'lucide-react'
import type { ReaderSettings, ThemeMode } from '@shared/types'
import { DEFAULT_READER_SETTINGS, THEME_PRESETS } from '@shared/types'
import { useDialogFocus } from '../lib/dialogFocus'

interface SettingsDialogProps {
  settings: ReaderSettings
  onChange: (settings: ReaderSettings) => void
  onClose: () => void
}

const fontChoices = [
  {
    label: '思源宋体（内置）',
    value: '"Noto Serif SC", "Microsoft YaHei UI", "PingFang SC", serif'
  },
  {
    label: '霞鹜文楷（内置）',
    value: '"LXGW WenKai", "Kaiti SC", KaiTi, STKaiti, serif'
  },
  {
    label: '站酷小薇（内置）',
    value: '"ZCOOL XiaoWei", "Noto Serif SC", Georgia, serif'
  },
  {
    label: '宋体 / 衬线',
    value: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", Georgia, serif'
  },
  {
    label: '黑体 / 无衬线',
    value: '"Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", sans-serif'
  },
  {
    label: '系统楷体',
    value: '"Kaiti SC", KaiTi, STKaiti, serif'
  },
  {
    label: '系统默认',
    value: 'system-ui, -apple-system, "Segoe UI", sans-serif'
  }
]

export function SettingsDialog({
  settings,
  onChange,
  onClose
}: SettingsDialogProps): React.JSX.Element {
  const dialogRef = useDialogFocus<HTMLElement>(onClose)

  const patch = (value: Partial<ReaderSettings>): void => {
    onChange({ ...settings, ...value })
  }

  const selectTheme = (theme: Exclude<ThemeMode, 'custom'>): void => {
    onChange({
      ...settings,
      theme,
      ...THEME_PRESETS[theme]
    })
  }

  const changeContentWidth = (contentWidth: number): void => {
    onChange({
      ...settings,
      contentWidth,
      floatingReaderWidth:
        settings.floatingReaderWidth === settings.contentWidth
          ? contentWidth
          : settings.floatingReaderWidth
    })
  }

  return (
    <div className="modal-backdrop settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="dialog settings-dialog"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="显示设置"
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">外观与排版</p>
            <h2>显示设置</h2>
          </div>
          <button className="icon-button" type="button" title="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="settings-scroll">
          <div className="settings-section">
            <h3>主题</h3>
            <p className="settings-help">主题颜色会同步应用到整个 Readex 界面和阅读区域。</p>
            <div className="theme-options">
              {(['dark', 'light', 'sepia'] as const).map((theme) => (
                <button
                  className={`theme-card theme-${theme} ${settings.theme === theme ? 'active' : ''}`}
                  type="button"
                  key={theme}
                  onClick={() => selectTheme(theme)}
                >
                  <span className="theme-preview">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>{theme === 'dark' ? '深色' : theme === 'light' ? '明亮' : '护眼'}</span>
                </button>
              ))}
            </div>
            <div className="color-row">
              <ColorField
                label="应用背景"
                value={settings.backgroundColor}
                onChange={(backgroundColor) =>
                  patch({ backgroundColor, theme: 'custom' })
                }
              />
              <ColorField
                label="界面文字"
                value={settings.textColor}
                onChange={(textColor) => patch({ textColor, theme: 'custom' })}
              />
              <ColorField
                label="强调颜色"
                value={settings.accentColor}
                onChange={(accentColor) => patch({ accentColor, theme: 'custom' })}
              />
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-title-row">
              <h3>
                <Type size={16} /> 字体与排版
              </h3>
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  onChange({
                    ...settings,
                    ...DEFAULT_READER_SETTINGS,
                    theme: settings.theme,
                    backgroundColor: settings.backgroundColor,
                    textColor: settings.textColor,
                    accentColor: settings.accentColor
                  })
                }
              >
                <RotateCcw size={14} />
                恢复排版默认值
              </button>
            </div>
            <label className="field">
              <span>字体</span>
              <select
                value={settings.fontFamily}
                onChange={(event) => patch({ fontFamily: event.target.value })}
              >
                {fontChoices.map((choice) => (
                  <option value={choice.value} key={choice.label}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="settings-help settings-font-license">
              标有“内置”的字体采用 SIL Open Font License 1.1，可随应用免费分发。
            </p>
            <RangeField
              label="字号"
              value={settings.fontSize}
              min={13}
              max={34}
              step={0.1}
              suffix="px"
              onChange={(fontSize) => patch({ fontSize })}
            />
            <RangeField
              label="行距"
              value={settings.lineHeight}
              min={1.2}
              max={2.6}
              step={0.05}
              suffix=""
              onChange={(lineHeight) => patch({ lineHeight })}
            />
            <RangeField
              label="段距"
              value={settings.paragraphSpacing}
              min={0}
              max={2}
              step={0.05}
              suffix="em"
              onChange={(paragraphSpacing) => patch({ paragraphSpacing })}
            />
            <RangeField
              label="字距"
              value={settings.letterSpacing}
              min={0}
              max={0.12}
              step={0.01}
              suffix="em"
              onChange={(letterSpacing) => patch({ letterSpacing })}
            />
            <RangeField
              label="内容宽度"
              value={settings.contentWidth}
              min={520}
              max={1100}
              step={20}
              suffix="px"
              onChange={changeContentWidth}
            />
            <label className="field">
              <span>阅读布局</span>
              <select
                value={
                  settings.readingLayout === 'paginated'
                    ? settings.pageColumns === 2
                      ? 'paginated:2'
                      : 'paginated:1'
                    : 'scroll:1'
                }
                onChange={(event) => {
                  const [layout, columns] = event.target.value.split(':')
                  patch({
                    readingLayout: layout === 'paginated' ? 'paginated' : 'scroll',
                    pageColumns: columns === '2' ? 2 : 1
                  })
                }}
              >
                <option value="scroll:1">连续滚动</option>
                <option value="paginated:1">分页 · 单栏</option>
                <option value="paginated:2">分页 · 双栏（宽窗口）</option>
              </select>
            </label>
            <p className="settings-help">
              分页与双栏目前仅用于 EPUB；TXT、MOBI/AZW3 和 PDF 仍使用连续滚动。
            </p>
            <RangeField
              label="PDF 自适应倍率"
              value={settings.pdfScale}
              min={0.6}
              max={2.2}
              step={0.05}
              suffix="×"
              onChange={(pdfScale) => patch({ pdfScale })}
            />
            <label className="toggle-field">
              <span>
                <Moon size={15} />
                PDF 夜间模式
              </span>
              <input
                type="checkbox"
                checked={settings.pdfNightMode}
                onChange={(event) => patch({ pdfNightMode: event.target.checked })}
              />
              <i />
            </label>
            <label className="toggle-field">
              <span>
                <Columns2 size={15} />
                PDF 双页
              </span>
              <input
                type="checkbox"
                checked={settings.pdfTwoPage}
                onChange={(event) => patch({ pdfTwoPage: event.target.checked })}
              />
              <i />
            </label>
            <p className="settings-help">
              PDF 夜间模式会把页面渲染结果反色，适合暗色主题下阅读文本型 PDF；彩色图片也会一并反色。PDF 双页会按行并排显示两页，适合宽屏阅读。
            </p>
            <RangeField
              label="滚轮步长"
              value={settings.wheelScrollStep}
              min={24}
              max={120}
              step={4}
              suffix="px"
              onChange={(wheelScrollStep) => patch({ wheelScrollStep })}
            />
            <label className="toggle-field">
              <span>
                <MoveVertical size={15} />
                平滑滚动
              </span>
              <input
                type="checkbox"
                checked={settings.smoothScrolling}
                onChange={(event) => patch({ smoothScrolling: event.target.checked })}
              />
              <i />
            </label>
          </div>

          <div className="settings-section">
            <h3>
              <Play size={16} /> 自动滚动
            </h3>
            <p className="settings-help">
              正文按设定速度匀速滚动。开启颜色标注后，可在“视线色带”与“逐句渐变”之间选择：
              色带固定在阅读视线区，文字随滚动穿过色带并前后淡入淡出，模拟视线跟着文字前进；
              逐句渐变则按句标注、柔和衔接。手动滚动或点击正文后自动暂停。
            </p>
            <RangeField
              label="滚动速度"
              value={settings.autoScrollSpeed}
              min={1}
              max={100}
              step={1}
              suffix="级"
              precision={0}
              onChange={(autoScrollSpeed) => patch({ autoScrollSpeed })}
            />
            <label className="toggle-field">
              <span>
                <Highlighter size={15} />
                颜色标注
              </span>
              <input
                type="checkbox"
                checked={settings.autoScrollHighlight}
                onChange={(event) => patch({ autoScrollHighlight: event.target.checked })}
              />
              <i />
            </label>
            {settings.autoScrollHighlight && (
              <label className="field">
                <span>标注样式</span>
                <select
                  value={settings.autoScrollHighlightStyle}
                  onChange={(event) =>
                    patch({
                      autoScrollHighlightStyle: event.target
                        .value as ReaderSettings['autoScrollHighlightStyle']
                    })
                  }
                >
                  <option value="band">视线色带（跟随滚动向前）</option>
                  <option value="sentence">逐句渐变标注</option>
                </select>
              </label>
            )}
            {settings.autoScrollHighlight && (
              <div className="color-row color-row-single">
                <ColorField
                  label="标注颜色"
                  value={settings.autoScrollColor}
                  onChange={(autoScrollColor) => patch({ autoScrollColor })}
                />
              </div>
            )}
          </div>

          <div className="settings-section">
            <h3>
              <Target size={16} /> 阅读目标
            </h3>
            <p className="settings-help">
              设置每日阅读目标后，阅读统计页会显示今日完成进度；0 分钟表示不设目标。
            </p>
            <RangeField
              label="每日目标"
              value={settings.dailyReadingGoalMinutes}
              min={0}
              max={180}
              step={5}
              suffix="分钟"
              precision={0}
              onChange={(dailyReadingGoalMinutes) =>
                patch({ dailyReadingGoalMinutes })
              }
            />
          </div>

          <div className="settings-section">
            <h3>
              <PictureInPicture2 size={16} /> 浮框阅读
            </h3>
            <p className="settings-help">
              浮框只显示书籍内容，默认宽度跟随阅读内容宽度，高度默认为 200px。
            </p>
            <RangeField
              label="浮框宽度"
              value={settings.floatingReaderWidth}
              min={360}
              max={1200}
              step={20}
              suffix="px"
              onChange={(floatingReaderWidth) => patch({ floatingReaderWidth })}
            />
            <RangeField
              label="浮框高度"
              value={settings.floatingReaderHeight}
              min={120}
              max={600}
              step={10}
              suffix="px"
              onChange={(floatingReaderHeight) => patch({ floatingReaderHeight })}
            />
            <label className="toggle-field">
              <span>
                <EyeOff size={15} />
                隐身模式
              </span>
              <input
                type="checkbox"
                checked={settings.floatingReaderStealth}
                onChange={(event) => patch({ floatingReaderStealth: event.target.checked })}
              />
              <i />
            </label>
            <p className="settings-help">
              隐身模式去掉浮窗边框与按钮，只保留背景色和正文；窗口右上角悬停可唤出按钮，鼠标移到右缘可唤出滚动控制。
            </p>
          </div>

          <div
            className="settings-preview"
            style={{
              background: settings.backgroundColor,
              color: settings.textColor,
              fontFamily: settings.fontFamily,
              fontSize: Math.min(settings.fontSize, 22),
              lineHeight: settings.lineHeight,
              letterSpacing: `${settings.letterSpacing}em`
            }}
          >
            <span style={{ color: settings.accentColor }}>Readex</span>
            <p style={{ marginTop: `${settings.paragraphSpacing}em` }}>
              阅读是安静地扩展自己的边界。
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label className="color-field">
      <span>{label}</span>
      <span className="color-input">
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
        <code>{value.toUpperCase()}</code>
      </span>
    </label>
  )
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  precision,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  precision?: number
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <label className="range-field">
      <span>{label}</span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>
        {precision !== undefined
          ? value.toFixed(precision)
          : Number.isInteger(value)
            ? value
            : value.toFixed(2)}
        {suffix}
      </output>
    </label>
  )
}
