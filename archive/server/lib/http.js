/**
 * Мелочи HTTP: ответы, разбор тела, куки, ограничение частоты.
 *
 * Ничего внешнего: у сервера ноль зависимостей, и это осознанно — контур
 * заказчика не любит цепочки транзитивных пакетов ради разбора JSON.
 */
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || ''

/**
 * Заголовки CORS.
 *
 * Пока ALLOWED_ORIGIN не задан, кросс-доменные запросы не разрешаются вовсе —
 * и это правильное поведение по умолчанию: сервер отдаёт и клиент, и API
 * с одного адреса, так что CORS ему просто не нужен.
 *
 * Отражать пришедший Origin вместе с `Allow-Credentials: true` нельзя ни при
 * каких обстоятельствах: это выдаёт разрешение любому сайту, который сумеет
 * дотянуться до сессии. Такой «удобный дефолт» — классическая дыра,
 * и здесь его нет намеренно.
 */
export function cors(req, res) {
  if (!ALLOWED_ORIGIN) return
  const origin = req.headers.origin
  if (!origin || origin !== ALLOWED_ORIGIN) return
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
}

export function send(res, status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers
  })
  res.end(text)
}

export const ok = (res, body = { ok: true }) => send(res, 200, body)
export const bad = (res, error, status = 400) => send(res, status, { ok: false, error })

const MAX_BODY = 2 * 1024 * 1024

/** Тело запроса как JSON. Слишком большое тело обрывается, а не копится в памяти. */
export function readBody(req) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        req.destroy()
        resolve(null)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

export function cookies(req) {
  const out = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export const clientIp = (req) =>
  (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || ''

// --------------------------------------------------- ограничение частоты

const buckets = new Map()
const WINDOW_MS = 60_000

const LIMITS = { login: 12, run: 40, write: 120, read: 600 }

/**
 * Простое окно на минуту, в памяти процесса. Этого достаточно против
 * скриптов, а не против распределённой атаки: настоящий рубеж —
 * обратный прокси перед сервисом, и об этом честно сказано в README.
 */
export function rateLimited(kind, key) {
  const limit = LIMITS[kind] ?? 120
  const id = `${kind}:${key}`
  const t = Date.now()
  const b = buckets.get(id)
  if (!b || t - b.at > WINDOW_MS) {
    buckets.set(id, { at: t, n: 1 })
    return false
  }
  b.n += 1
  return b.n > limit
}

setInterval(() => {
  const t = Date.now()
  for (const [k, v] of buckets) if (t - v.at > WINDOW_MS * 2) buckets.delete(k)
}, WINDOW_MS).unref?.()

export const str = (v, n = 200) => (typeof v === 'string' ? v.slice(0, n) : '')
export const int = (v, lo, hi) =>
  Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Math.round(Number(v)) : lo))
