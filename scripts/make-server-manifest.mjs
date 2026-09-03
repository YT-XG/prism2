#!/usr/bin/env node
/**
 * 生成「自托管服务器」更新用的 latest.json（下载地址指向你的服务器，而非 GitHub）。
 *
 * 用法（在 prism2 目录，先跑过 electron-builder --publish never 让 dist/ 有安装包）：
 *   node scripts/make-server-manifest.mjs <baseUrl> [选项]
 * 例：
 *   node scripts/make-server-manifest.mjs https://updates.example.com/prism2 --version 2.0.9 --out dist/latest.json
 *
 * 选项：
 *   --version <x.y.z>   清单版本号（默认取 package.json）
 *   --redirect <url>    （可选）给 manifest.redirect 赋值（一般服务器版留空；只有当你想让它再跳一次时才填）
 *   --out <path>        输出路径（默认 dist/latest.json）
 *
 * 行为：
 *   扫描 dist/ 下的安装包 → 按文件名识别 platform/arch → 计算 sha256
 *   → 生成 { version, notes, redirect, mirrors, binaries:[{platform,arch,url,sha256}] }
 *   url = <baseUrl>/<文件名>（绝对 https，客户端据此到你的服务器下载）
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const args = process.argv.slice(2)
const baseUrl = args.find((a) => !a.startsWith('--'))
const argVal = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const version = argVal('--version') || JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version
const redirect = argVal('--redirect')
const out = argVal('--out') || join('dist', 'latest.json')

if (!baseUrl) {
  console.error('用法: node scripts/make-server-manifest.mjs <baseUrl> [--version x.y.z] [--redirect url] [--out path]')
  process.exit(1)
}
const base = String(baseUrl).replace(/\/+$/, '')

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function classify(name) {
  const n = name.toLowerCase()
  if (n.endsWith('.zip')) {
    if (n.includes('mac') || n.includes('-osx')) return 'mac'
    if (n.includes('win')) return 'win'
    return null
  }
  if (n.endsWith('.appimage') || n.endsWith('.tar.gz') || n.endsWith('.deb')) return 'linux'
  if (n.endsWith('.exe') || n.includes('-setup')) return 'win'
  return null
}

function detectArch(name) {
  return ['universal', 'x64', 'arm64'].find((a) => name.includes(a)) || 'unknown'
}

const distDir = join(root, 'dist')
if (!existsSync(distDir)) {
  console.error(`未找到 dist/ 目录：${distDir}。请先执行 electron-builder --publish never 生成安装包。`)
  process.exit(1)
}

const binaries = []
const seen = new Set()
for (const name of readdirSync(distDir)) {
  const platform = classify(name)
  if (!platform || seen.has(platform)) continue
  seen.add(platform)
  const full = join(distDir, name)
  binaries.push({
    platform,
    arch: detectArch(name),
    url: `${base}/${name}`,
    sha256: sha256File(full)
  })
}

if (!binaries.length) {
  console.error('dist/ 下没有识别到安装包（win/mac zip 或 setup.exe）。')
  process.exit(1)
}

const manifest = {
  version: String(version),
  notes: '',
  redirect: redirect || null,
  mirrors: [],
  binaries
}

const outPath = join(root, out)
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
console.log(`已生成 ${outPath}`)
console.log(JSON.stringify(manifest, null, 2))
