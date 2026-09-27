/**
 * Вход, пароли, сессии.
 *
 * Пароли не хранятся и не логируются — только scrypt-хеш с индивидуальной
 * солью. Сессия живёт восемь часов и лежит в HttpOnly-куке, недоступной
 * скриптам страницы.
 *
 * Чего здесь намеренно нет: пароля по умолчанию. Учётка вида admin/admin
 * в системе, которую разворачивают одной командой, — это дыра, а не удобство.
 * Демонстрационные учётки заводит отдельная команда `npm run seed`,
 * и она честно печатает пароли в консоль, а не прячет их в коде.
 */
import crypto from 'node:crypto'
import { users } from './db.js'
import { cookies } from './http.js'

const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }
export const MIN_PASSWORD_LENGTH = 8
export const COOKIE = 'ekipazh_sid'

/** Блокировка после серии неудач: перебор должен упираться в паузу. */
const FAIL_LIMIT = 8
const FAIL_WINDOW_MS = 15 * 60 * 1000
const failures = new Map()
const sessions = new Map()

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto
    .scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
    .toString('hex')
  return { salt, hash }
}

function verify(password, salt, expected) {
  const { hash } = hashPassword(password, salt)
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function blocked(login) {
  const f = failures.get(login)
  if (!f) return false
  if (Date.now() - f.at > FAIL_WINDOW_MS) {
    failures.delete(login)
    return false
  }
  return f.n >= FAIL_LIMIT
}

function noteFailure(login) {
  const f = failures.get(login)
  if (!f || Date.now() - f.at > FAIL_WINDOW_MS) failures.set(login, { at: Date.now(), n: 1 })
  else f.n += 1
}

export function login(loginName, password) {
  if (blocked(loginName)) return { error: 'слишком много попыток, подождите 15 минут' }
  const user = users.byLogin(loginName)
  // Хешируем всегда, даже когда пользователя нет: иначе время ответа
  // подсказывает, какие логины существуют.
  const salt = user?.salt ?? 'nobody'
  const expected = user?.hash ?? crypto.randomBytes(SCRYPT.keylen).toString('hex')
  const okPassword = verify(password ?? '', salt, expected)
  if (!user || !okPassword) {
    noteFailure(loginName)
    return { error: 'неверный логин или пароль' }
  }
  failures.delete(loginName)
  users.touch(user.id)
  const sid = crypto.randomBytes(24).toString('base64url')
  sessions.set(sid, { userId: user.id, at: Date.now() })
  return { sid, user }
}

export function logout(sid) {
  sessions.delete(sid)
}

/** Текущий пользователь запроса или null. Просроченная сессия удаляется. */
export function current(req) {
  const sid = cookies(req)[COOKIE]
  if (!sid) return null
  const s = sessions.get(sid)
  if (!s) return null
  if (Date.now() - s.at > SESSION_TTL_MS) {
    sessions.delete(sid)
    return null
  }
  return users.byId(s.userId) ?? null
}

export const sessionCookie = (sid) =>
  `${COOKIE}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`

export const clearCookie = () => `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
