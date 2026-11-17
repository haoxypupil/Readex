import { useEffect, useRef, useState } from 'react'
import { LayoutGrid } from 'lucide-react'
import type { ReaderThumbnailInfo } from '../readers/types'

interface ThumbnailPanelProps {
  info: ReaderThumbnailInfo
  getThumbnail: (page: number, maxWidth: number) => Promise<string | null>
  activePage: number
  onSelect: (page: number) => void
}

const CELL_IMAGE_WIDTH = 150
const LOAD_AHEAD_MARGIN = '260px 0px'

export function ThumbnailPanel({
  info,
  getThumbnail,
  activePage,
  onSelect
}: ThumbnailPanelProps): React.JSX.Element {
  const [thumbs, setThumbs] = useState<Record<number, string>>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const thumbsRef = useRef(thumbs)
  const getThumbnailRef = useRef(getThumbnail)
  thumbsRef.current = thumbs
  getThumbnailRef.current = getThumbnail

  useEffect(() => {
    setThumbs({})
  }, [info])

  // 可见 + 预加载范围内的页面按需渲染；用一个共享 observer 支持上千页的漫画。
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const page = Number((entry.target as HTMLElement).dataset.page)
          observer.unobserve(entry.target)
          if (!Number.isFinite(page) || thumbsRef.current[page]) continue
          void getThumbnailRef.current(page, CELL_IMAGE_WIDTH).then((url) => {
            if (!url) return
            setThumbs((current) =>
              current[page] ? current : { ...current, [page]: url }
            )
          })
        }
      },
      { rootMargin: LOAD_AHEAD_MARGIN }
    )
    root
      .querySelectorAll<HTMLElement>('.thumbnail-cell')
      .forEach((cell) => observer.observe(cell))
    return () => observer.disconnect()
  }, [info])

  // 打开面板或翻页时把当前页滚到可视区中央。
  useEffect(() => {
    if (!activePage) return
    rootRef.current
      ?.querySelector<HTMLElement>(`.thumbnail-cell[data-page="${activePage}"]`)
      ?.scrollIntoView({ block: 'center' })
  }, [activePage, info])

  const pages = Array.from({ length: info.pageCount }, (_, index) => index + 1)

  return (
    <div className="side-panel-content thumbnail-panel" data-kind={info.kind} ref={rootRef}>
      <div className="panel-title">
        <LayoutGrid size={16} />
        <span>页面缩略图</span>
      </div>
      <div className="thumbnail-grid">
        {pages.map((page) => (
          <button
            className={`thumbnail-cell ${page === activePage ? 'active' : ''}`}
            type="button"
            data-page={page}
            key={page}
            title={`第 ${page} 页`}
            onClick={() => onSelect(page)}
          >
            <span className="thumbnail-frame">
              {thumbs[page] && (
                <img src={thumbs[page]} alt={`第 ${page} 页`} loading="lazy" decoding="async" />
              )}
            </span>
            <small>{page}</small>
          </button>
        ))}
      </div>
    </div>
  )
}
