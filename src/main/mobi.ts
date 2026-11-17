import { initKf8File, initMobiFile } from '@lingo-reader/mobi-parser'

export interface MobiMetadataLike {
  title: string
  author: string[]
  publisher: string
  language: string
  description: string
}

export interface MobiChapterLike {
  id: string
  html: string
}

export interface MobiDocument {
  getMetadata: () => MobiMetadataLike
  getSpine: () => Array<Record<string, unknown>>
  loadChapter: (id: string) => MobiChapterLike | undefined
  getToc: () => Array<Record<string, unknown>>
  resolveHref: (href: string) => { id: string; selector: string } | undefined
  getCoverImage: () => string
  destroy: () => void
}

export async function openMobiDocument(
  data: Uint8Array,
  resourceDirectory: string
): Promise<MobiDocument> {
  let legacy: MobiDocument | null = null
  let legacySpineLength = 0

  try {
    legacy = (await initMobiFile(data, resourceDirectory)) as unknown as MobiDocument
    const legacySpine = legacy.getSpine()
    legacySpineLength = legacySpine.length
    const firstChapter = legacySpine[0]
      ? legacy.loadChapter(String(legacySpine[0].id))
      : undefined
    const firstTextLength = htmlToText(firstChapter?.html ?? '').length

    if (legacySpineLength > 1 || firstTextLength > 500) {
      return legacy
    }
  } catch {
    // 纯 AZW3/KF8 文件可能无法按 MOBI7 解析，回退到 KF8。
    legacy = null
  }

  try {
    const kf8 = (await initKf8File(data, resourceDirectory)) as unknown as MobiDocument
    if (kf8.getSpine().length > legacySpineLength) {
      legacy?.destroy()
      return kf8
    }
    kf8.destroy()
  } catch {
    // 非 KF8 文件保留 MOBI 解析结果。
  }

  if (legacy) return legacy
  throw new Error('MOBI/AZW3 文件解析失败：文件可能受 DRM 保护或已损坏')
}

function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
