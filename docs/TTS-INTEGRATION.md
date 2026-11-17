# Readex 听书集成方案与实现记录

## 1. 目标与边界

听书功能面向 Readex 的本地阅读体验，目标是从当前屏幕可见的第一句话开始连续朗读。

当前范围：

- 支持 TXT、MOBI/KF8、EPUB 和文本型 PDF。
- 从阅读区当前视口的第一句完整文字开始；存在选中文字时从选中位置开始。
- 支持播放、暂停、继续和停止。
- 支持 15、30、60 分钟定时停止。
- 支持中文音色、语速和音量。
- 支持在线神经语音和 Windows 系统离线语音两种引擎，可在听书设置中切换。
- 当前句高亮，读完自动推进并滚动到下一句。
- 在线合成结果缓存到便携目录，重复朗读不重复请求。
- 浮框内提供紧凑听书控件，可独立播放；进入浮框会先停止主窗口听书，返回主界面会停止浮窗听书。

当前不包含：

- 扫描版 PDF OCR。
- 逐字高亮。服务返回的是词或词组边界，第一版采用稳定的整句高亮。

## 2. 技术选型

使用 npm 包 `node-edge-tts@1.2.10`。

选择原因：

- 纯 Node 实现，不需要安装 Python，也不需要额外 sidecar。
- 支持 Microsoft Edge 在线神经语音。
- 支持 MP3 和词级时间戳。
- 包本身采用 MIT 许可证；但该包调用 Microsoft Edge 在线接口，服务使用仍受 Microsoft 条款约束，不视为商业授权。
- 当前 Readex 主进程可以直接调用。

没有使用 Python `rany2/edge-tts`：

- 那是一个独立 Python 项目。
- 如果接入 Electron，需要额外携带或依赖 Python 环境。
- 常驻 Python sidecar 会增加启动、打包、进程和日志管理成本。

没有使用 npm `edge-tts@1.0.1`：

- 虽然也是纯 Node，但源码关闭了词级和句级边界元数据。
- 它只返回 MP3 Buffer，无法直接支持时间戳同步。

已接受的限制：

- 必须联网。
- 正在朗读的句子会发送给微软在线语音服务。
- 接口不是微软公开支持的稳定 API，可能间歇性出现 `403`、`429`、`503` 或超时。
- 当前实现不改变这一事实，只通过缓存、重试、串行队列和错误提示降低影响。

### 2.1 系统离线语音

在线语音之外，设置中可选择 Windows 系统离线语音：

- 使用渲染进程的 Web Speech API（`speechSynthesis` + `SpeechSynthesisUtterance`），由 Chromium 调用系统语音包。
- 不请求网络，也不写入 `data/cache/tts`。
- 音色优先使用用户选择的系统语音名称；未选择时依次回退到中文语音和第一个可用语音。
- 仍沿用现有的句子切分、逐句播放、当前句高亮、滚动、跨章节推进和定时停止逻辑。
- 暂停、继续和停止分别映射到 `speechSynthesis.pause()`、`resume()` 和 `cancel()`。
- 可用音色取决于 Windows 已安装的语音包；系统未安装中文语音时会使用默认语音。

## 3. 总体架构

```text
React ReaderView
  |
  |-- SpeechPlaybackController
  |     |-- 选择当前可见首句
  |     |-- 播放 / 暂停 / 停止
  |     |-- 当前句高亮
  |     |-- 下一句预取
  |     `-- 跨章节推进
  |
  `-- window.readex.speech.synthesize()
          |
          v
Electron main: SpeechSynthesisService
  |-- 参数校验
  |-- SHA-256 缓存键
  |-- 串行合成队列
  |-- 重复请求合并
  |-- 失败重试一次
  |-- MP3 + cues JSON 原子落盘
  `-- 缓存容量裁剪
          |
          v
node-edge-tts -> Microsoft Edge online TTS
```

职责边界：

- 阅读器负责文字、DOM Range、滚动和高亮。
- React 播放控制器负责音频生命周期和播放顺序。
- 主进程负责联网、缓存、错误处理和 IPC。
- preload 只暴露 `speech.synthesize`，不暴露文件路径或 `node-edge-tts`。

## 4. 代码落点

| 文件 | 责任 |
| --- | --- |
| `src/shared/speech.ts` | 音色、参数范围、请求和结果类型 |
| `src/main/speech.ts` | 合成、缓存、重试和错误归一化 |
| `src/main/storage.ts` | `data/cache/tts` 路径和设置迁移 |
| `src/main/index.ts` | `speech:synthesize` IPC |
| `src/preload/index.ts` | 受限听书 API |
| `src/renderer/src/lib/speech.ts` | 句子定位、高亮、在线音频与系统离线语音播放控制器 |
| `src/renderer/src/readers/types.ts` | 阅读器统一听书接口 |
| `src/renderer/src/readers/TextFlowReader.tsx` | TXT/MOBI 句段、滚动和高亮 |
| `src/renderer/src/readers/EpubReader.tsx` | EPUB iframe 句段和跨章节推进 |
| `src/renderer/src/readers/PdfReader.tsx` | PDF 文本层句段、滚动、高亮和跨页推进 |
| `src/renderer/src/components/ReaderScrollControls.tsx` | 右侧听书按钮和设置面板 |
| `src/renderer/src/components/ReaderView.tsx` | 听书控制器生命周期和互斥 |

## 5. “从本页第一句开始”的规则

句子来自阅读器当前已经挂载的正文 DOM：

1. 使用现有 `Intl.Segmenter` 句子切分逻辑。
2. 将句子的 `Range` 和滚动容器坐标一并保存。
3. 当前视口顶部之后的第一个完整句子作为起点。
4. 如果句子顶部已滚出屏幕，但句尾仍可见，仍然从完整句首朗读。
5. 点击停止、切换书籍或进入浮框时清除当前句高亮。
6. 音频播放期间不修改书籍 DOM，只使用 CSS Custom Highlight API 叠加高亮。

这种方案保证朗读自然，不会从半句话开始，也不会破坏 EPUB 的 CFI、选择、笔记和标注。

## 6. 缓存设计

开发环境：

```text
data-dev/cache/tts/
```

绿色版：

```text
data/cache/tts/
```

缓存键：

```text
SHA-256(音色 + 语速 + 音量 + 文本)
```

文件：

```text
<cache-key>.mp3
<cache-key>.json
```

策略：

- 单句音频写入临时文件，成功后原子移动到正式缓存。
- 请求中的同键任务会复用同一个 Promise。
- 合成失败自动清理临时文件。
- 网络请求失败最多重试一次。
- 缓存达到约 300 MB 后按最近访问时间删除最旧条目。
- 缓存属于 `cache`，不是 `personal`，清空个人资料不会误删阅读笔记，也不会把音频写入系统用户目录。

## 7. 播放策略

- 当前句开始播放后，立刻预取下一句。
- 当前句播放完成后再决定播放已预取结果还是重新请求。
- 超长句子按 1200 个 Unicode 码点切分，音频仍复用同一个句子高亮。
- 暂停保留当前音频，继续时从暂停位置恢复。
- 停止会停止音频、废弃当前会话，并清除高亮。
- 自动滚动与听书互斥。
- 同一时间只允许一个听书控制器发声。
- 浮窗使用紧凑听书控件，音色、语速、音量和停止操作放在设置面板中。

## 8. 首次实现中遇到的坑

### 8.1 npm `edge-tts` 不等于 Python `edge-tts`

两个包同名但实现不同。截图中写的 `npm install edge-tts` 是纯 Node 包，不是 Python 项目的 npm 包装。

### 8.2 字幕和音频是两个文件

`node-edge-tts` 使用 `saveSubtitles: true` 时会在 MP3 旁边额外生成 `.mp3.json`。生成 MP3 后必须等待文件流 `finish`，否则可能读到未完成的音频。

### 8.3 没有公开的跨平台 AbortSignal

该库的 `timeout` 只会让 Promise 失败，并不保证立即关闭底层 WebSocket。因此第一版把“停止播放”和“取消网络请求”分开：

- 停止播放立即执行。
- 已发出的请求可能继续完成并进入缓存。
- 页面丢弃过期会话结果，不允许旧音频重新播放。

### 8.4 播放权限

`HTMLAudioElement.play()` 需要在用户操作触发后调用。虽然合成是异步的，但当前 Electron 环境验证可以正常播放；如果后续出现自动播放拦截，应改为在用户点击时预创建并解锁 `Audio` 实例。

### 8.5 EPUB iframe 高亮

EPUB 正文位于 iframe 内，顶层文档的全局 `CSS.highlights` 不可见。因此必须在句子所属文档中注册高亮样式和 Highlight 对象。

### 8.6 缓存不能使用 `app.getPath('userData')`

Readex 是绿色便携应用，缓存必须使用 `data/cache/tts` 或 `data-dev/cache/tts`，否则会破坏便携性和“同目录迁移”语义。

## 9. 验证记录

已完成：

- 单元测试覆盖参数转换、时间戳解析、视口首句选择和长句切分。
- 类型检查通过。
- 生产构建通过。
- Electron 真实运行验证 `window.readex.speech.synthesize()`。
- 中文 `zh-CN-XiaoxiaoNeural` 实际返回 MP3 和 8 条词级 cues。
- 相同请求二次调用命中缓存。
- 点击右侧按钮可进入播放状态。
- EPUB iframe 内成功创建高亮样式和 Highlight。
- 浮窗内听书按钮可见、可播放并在 EPUB iframe 内高亮；返回主界面会停止浮窗语音。
- 浮窗保持 `frame: false`、`alwaysOnTop: false` 无边框非置顶窗口；顶部内侧原生拖动带和左右、底部边框均支持移动，正文空白区也可通过窗口移动 IPC 拖动。
- 浮框拖动保留 4px 判定阈值，正文形成文本选区后优先选择文字，EPUB iframe 内的文本选择不会被窗口拖动抢占。
- Windows 上移动非置顶无边框浮窗使用 `setBounds()`，而不是 `setPosition()`，保持 Electron 44 下的移动兼容性。
- `release/win-unpacked` 打包版本中确认包含 `node-edge-tts`，并成功生成 MP3 和 cues。

仍需人工验证：

- 连续朗读多个句子时音色衔接和滚动节奏。
- EPUB 跨章节推进。
- 网络中断、`403`、`429`、`503` 和超时后的用户提示。
- 浮框窗口中的连续播放和恢复主界面行为。
- PDF 第一阶段的“不支持听书”提示。

## 10. 后续演进

1. PDF 文本型内容接入同一句段接口。
2. 使用 cues 做词组级高亮，但先保持整句作为主状态。
3. 增加离线 TTS Provider，形成在线和离线双 provider。
4. 在设置页增加独立“听书”分组和隐私说明。
5. 如服务持续不稳定，可替换为 Azure Speech 或本地语音模型，而阅读器接口无需改变。
