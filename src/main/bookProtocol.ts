import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { BookContent, BookFormat } from '../shared/types'
import {
  BOOK_RESOURCE_SCHEME,
  getBookCoverId,
  getBookResourceId,
  getComicPageRequest
} from '../shared/bookResource'
import { readJson, type ReadexStorage } from './storage'

export type ByteRangeResult =
  | { kind: 'none' }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'unsatisfiable' }

export function parseByteRange(value: string | null, size: number): ByteRangeResult {
  if (!value) return { kind: 'none' }
  if (size <= 0) return { kind: 'unsatisfiable' }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || (!match[1] && !match[2])) return { kind: 'unsatisfiable' }

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { kind: 'unsatisfiable' }
    }
    return {
      kind: 'range',
      start: Math.max(0, size - suffixLength),
      end: size - 1
    }
  }

  const start = Number(match[1])
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) {
    return { kind: 'unsatisfiable' }
  }

  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) {
    return { kind: 'unsatisfiable' }
  }

  return {
    kind: 'range',
    start,
    end: Math.min(requestedEnd, size - 1)
  }
}

export function contentTypeForBookFormat(format: BookFormat): string {
  switch (format) {
    case 'epub':
      return 'application/epub+zip'
    case 'mobi':
    case 'azw3':
      return 'application/x-mobipocket-ebook'
    case 'pdf':
      return 'application/pdf'
    case 'txt':
      return 'text/plain; charset=utf-8'
    case 'cbz':
      return 'application/vnd.comicbook+zip'
  }
}

export function registerBookScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: BOOK_RESOURCE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ])
}

export function registerBookProtocol(storage: ReadexStorage): void {
  protocol.handle(BOOK_RESOURCE_SCHEME, async (request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: responseHeaders() })
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: responseHeaders({ Allow: 'GET, HEAD, OPTIONS' })
      })
    }

    let host = ''
    try {
      host = new URL(request.url).hostname
    } catch {
      host = ''
    }
    if (host === 'cover') {
      return serveCover(storage, request)
    }
    if (host === 'comic') {
      return serveComicPage(storage, request)
    }

    const bookId = getBookResourceId(request.url)
    const book = bookId ? await storage.getBookRecord(bookId) : null
    if (!book) return new Response('Book not found', { status: 404, headers: responseHeaders() })

    const filePath = storage.getBookSourcePath(book)
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat?.isFile()) {
      return new Response('Book file not found', { status: 404, headers: responseHeaders() })
    }

    const range = parseByteRange(request.headers.get('range'), stat.size)
    if (range.kind === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: responseHeaders({ 'Content-Range': `bytes */${stat.size}` })
      })
    }

    const start = range.kind === 'range' ? range.start : 0
    const end = range.kind === 'range' ? range.end : Math.max(0, stat.size - 1)
    const length = stat.size === 0 ? 0 : end - start + 1
    const headers = responseHeaders({
      'Accept-Ranges': 'bytes',
      'Content-Type': contentTypeForBookFormat(book.format),
      'Content-Length': String(length),
      ...(range.kind === 'range'
        ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` }
        : {})
    })

    if (request.method === 'HEAD' || length === 0) {
      return new Response(null, {
        status: range.kind === 'range' ? 206 : 200,
        headers
      })
    }

    const stream = createReadStream(filePath, { start, end })
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, {
      status: range.kind === 'range' ? 206 : 200,
      headers
    })
  })
}

async function serveCover(storage: ReadexStorage, request: Request): Promise<Response> {
  const bookId = getBookCoverId(request.url)
  const book = bookId ? await storage.getBookRecord(bookId) : null
  if (!book?.coverFile) {
    return new Response('Cover not found', { status: 404, headers: responseHeaders() })
  }
  const fileName = path.basename(book.coverFile)
  if (fileName !== book.coverFile) {
    return new Response('Cover not found', { status: 404, headers: responseHeaders() })
  }
  const filePath = path.join(storage.getBookDirectory(book.id), fileName)
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat?.isFile()) {
    return new Response('Cover not found', { status: 404, headers: responseHeaders() })
  }
  const headers = responseHeaders({
    'Content-Type': coverContentType(filePath),
    'Content-Length': String(stat.size)
  })
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers })
  }
  const data = await fs.readFile(filePath)
  return new Response(new Uint8Array(data), { status: 200, headers })
}

async function serveComicPage(
  storage: ReadexStorage,
  request: Request
): Promise<Response> {
  const parsed = getComicPageRequest(request.url)
  if (!parsed) {
    return new Response('Comic page not found', { status: 404, headers: responseHeaders() })
  }
  const book = await storage.getBookRecord(parsed.bookId)
  if (!book || book.format !== 'cbz') {
    return new Response('Comic page not found', { status: 404, headers: responseHeaders() })
  }
  const directory = path.join(storage.getPaths().parseCache, book.id)
  const content = await readJson<BookContent | null>(path.join(directory, 'content.json'), null)
  const page = content?.format === 'cbz' ? content.pages?.[parsed.index] : undefined
  if (!page) {
    return new Response('Comic page not found', { status: 404, headers: responseHeaders() })
  }
  const fileName = path.basename(page.fileName)
  const filePath = path.join(directory, 'pages', fileName)
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat?.isFile()) {
    return new Response('Comic page not found', { status: 404, headers: responseHeaders() })
  }
  const headers = responseHeaders({
    'Content-Type': page.mime,
    'Content-Length': String(stat.size),
    // 漫画翻页频繁，允许渲染进程在会话内复用图片。
    'Cache-Control': 'private, max-age=3600'
  })
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers })
  }
  const data = await fs.readFile(filePath)
  return new Response(new Uint8Array(data), { status: 200, headers })
}

function coverContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  return (
    {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.avif': 'image/avif',
      '.svg': 'image/svg+xml'
    }[extension] ?? 'application/octet-stream'
  )
}

function responseHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
    'Cache-Control': 'no-store',
    ...extra
  })
}
