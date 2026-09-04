/**
 * 剪贴板图片自定义协议 —— 免 base64 过 IPC 的高效图片投递。
 *
 * 渲染端用 `<img src="prism-image://clipboard-images/<filename>">` 直接引用，
 * 浏览器原生缓存与懒加载；主进程只做一次路径校验 + 读文件，避免
 * readFileSync + base64 造成的 IPC 传输量与无界内存驻留。
 *
 * v2 性能：改为流式响应 + 支持 `Range`，大图不再整块读入主进程内存；
 * 并带 Cache-Control 让浏览器缓存，重复渲染不复读。
 */
import { app, protocol } from 'electron'
import { join } from 'node:path'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'

/** 自定义协议 scheme 名 */
export const IMAGE_SCHEME = 'prism-image'

/** 图片文件名合法格式（防御路径穿越，与 clipboardService 的 IMAGE_NAME_RE 保持一致） */
const IMAGE_NAME_RE = /^[\w-]+(?:\.[\w-]+)*$/

/** 在 app ready 前注册协议特权（standard + secure 才能作为 <img> src 加载） */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: IMAGE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: false }
    }
  ])
}

/** app ready 后注册协议处理器：校验文件名 → 流式读 userData/clipboard-images → 按 MIME/字节范围返回 */
export function registerImageProtocolHandler(): void {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      // 仅接受 prism-image://clipboard-images/<filename> 形态
      if (url.host !== 'clipboard-images') return new Response('Not Found', { status: 404 })
      const filename = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      if (!IMAGE_NAME_RE.test(filename)) return new Response('Forbidden', { status: 403 })
      const filePath = join(app.getPath('userData'), 'clipboard-images', filename)
      const ext = filename.split('.').pop()?.toLowerCase()
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext ?? 'png'}`

      const { size } = await stat(filePath)
      const baseHeaders: Record<string, string> = {
        'content-type': mime,
        'accept-ranges': 'bytes',
        // 图片不可变：允许浏览器缓存复用，重复渲染不重复从磁盘读
        'cache-control': 'max-age=3600'
      }

      // Range 请求：返回 206 分片（大图/断点协商更省内存）
      const rangeHeader = request.headers.get('range')
      if (rangeHeader) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
        if (!m) {
          return new Response('Range Not Satisfiable', { status: 416, headers: baseHeaders })
        }
        const start = m[1] ? Number(m[1]) : 0
        // 末字节超出文件大小：按 RFC 7233 裁剪到文件末尾，而非整段 416（仅起点越界才 416）
        const requestedEnd = m[2] ? Number(m[2]) : size - 1
        const end = Math.min(requestedEnd, size - 1)
        if (
          Number.isNaN(start) ||
          Number.isNaN(requestedEnd) ||
          start < 0 ||
          start > end ||
          start >= size
        ) {
          return new Response('Range Not Satisfiable', { status: 416, headers: baseHeaders })
        }
        const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
        return new Response(stream, {
          status: 206,
          headers: {
            ...baseHeaders,
            'content-range': `bytes ${start}-${end}/${size}`,
            'content-length': String(end - start + 1)
          }
        })
      }

      // 全量：流式返回，不整块读入内存
      const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream
      return new Response(stream, {
        headers: { ...baseHeaders, 'content-length': String(size) }
      })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}
