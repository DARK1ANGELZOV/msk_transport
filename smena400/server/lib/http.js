/**
 * Мелочь вокруг HTTP: разбор тела, куки, ответы, раздача собранного клиента.
 *
 * Отдельный файл нужен ровно затем, чтобы в маршрутах остался только смысл,
 * а не работа со строками.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const MAX_BODY = 64 * 1024

export const json = (res, code, payload) => {
  const body = JSON.stringify(payload)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  res.end(body)
}

export const ok = (res, payload) => json(res, 200, { ok: true, ...payload })
export const bad = (res, error, code = 400, extra = {}) =>
  json(res, code, { ok: false, error, ...extra })

/** Тело запроса. Ограничение по размеру — чтобы не принимать что угодно. */
export async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('тело запроса слишком большое')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('тело запроса не разбирается как JSON')
  }
}

// ----------------------------------------------------------------- куки

export function cookies(req) {
  const out = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i < 1) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export const setCookie = (res, name, value, { days = 180 } = {}) => {
  // HttpOnly: идентификатор игрока не нужен скриптам страницы, а значит,
  // и доступа к нему у них быть не должно.
  res.setHeader('set-cookie',
    `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${days * 86400}; ` +
    'HttpOnly; SameSite=Lax')
}

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(9).toString('hex')}`

// --------------------------------------------------------------- статика

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
}

/**
 * Раздача собранного клиента.
 *
 * Путь приводится к абсолютному и проверяется на принадлежность каталогу.
 * Вырезать «..» из строки недостаточно: кодировки и симлинки обходят это
 * слишком легко, а цена ошибки — чтение любого файла на машине.
 */
export function serveStatic(root, urlPath, res) {
  const rel = decodeURIComponent(urlPath.split('?')[0])
  const target = path.resolve(root, '.' + (rel === '/' ? '/index.html' : rel))
  const inside = target === path.resolve(root) ||
    target.startsWith(path.resolve(root) + path.sep)

  const file = inside && fs.existsSync(target) && fs.statSync(target).isFile()
    ? target
    : path.resolve(root, 'index.html') // одностраничное приложение

  if (!fs.existsSync(file)) return false

  const type = TYPES[path.extname(file)] ?? 'application/octet-stream'
  const immutable = /\/assets\//.test(file)
  res.writeHead(200, {
    'content-type': type,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff'
  })
  fs.createReadStream(file).pipe(res)
  return true
}
