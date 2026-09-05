/**
 * 邮件内嵌图片自定义协议 —— 解析正文里 `cid:` 引用的本地图片。
 *
 * 邮件 HTML 中的内嵌图片以 `src="cid:xxx"` 形式引用，浏览器并不原生认识 `cid:`
 * scheme。本协议把 `cid:` 改写成 `prism-mail-attachment://<messageId>/<filename>`
 * 后，直接读取 `userData/mail-attachments/<messageId>/<filename>` 落盘副本，
 * 免 base64 过 IPC，流式返回并带缓存头（与剪贴板图片协议同一思路）。
 */
import { app, protocol } from 'electron'
import { join } from 'node:path'
import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'

/** 自定义协议 scheme 名 */
export const MAIL_IMAGE_SCHEME = 'prism-mail-attachment'

/** 附件文件名合法格式（防御路径穿越；与 mailService 的 safeFilename 产物一致） */
const FILE_NAME_RE = /^[^/\\]+$/

/** 常见图片扩展名 → MIME；未知走 octet-stream（浏览器仍会按内容嗅探渲染） */
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  avif: 'image/avif'
}

/** 在 app ready 前注册协议特权（standard + secure 才能作为 <img> src 加载） */
export function registerMailImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MAIL_IMAGE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: false }
    }
  ])
}

/** app ready 后注册协议处理器：校验 messageId/filename → 流式读 mail-attachments */
export function registerMailImageProtocolHandler(): void {
  protocol.handle(MAIL_IMAGE_SCHEME, (request) => {
    try {
      const url = new URL(request.url)
      // 仅接受 prism-mail-attachment://<messageId>/<filename>
      if (!/^[1-9]\d*$/.test(url.host)) return new Response('Not Found', { status: 404 })
      const filename = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      if (!FILE_NAME_RE.test(filename)) return new Response('Forbidden', { status: 403 })

      const messageId = url.host
      const filePath = join(app.getPath('userData'), 'mail-attachments', messageId, filename)
      const { size } = statSync(filePath)

      const ext = filename.split('.').pop()?.toLowerCase() ?? ''
      const mime = EXT_MIME[ext] ?? 'application/octet-stream'
      const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream
      return new Response(stream, {
        headers: {
          'content-type': mime,
          'content-length': String(size),
          // 内嵌图片不可变：允许浏览器缓存复用，重复渲染不复读
          'cache-control': 'max-age=3600'
        }
      })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}