/** Форматирование чисел и времени. Всё, что видно на экране, — в одном месте. */

const pad = (n: number) => String(Math.floor(n)).padStart(2, '0')

/** Часы рейса: 09:04:00. Не время суток игрока, а время поезда. */
export function tripClock(baseClock: string | undefined, elapsedSec: number): string {
  const [h = 0, m = 0] = (baseClock ?? '00:00').split(':').map(Number)
  const total = h * 3600 + m * 60 + Math.round(elapsedSec)
  return `${pad((total / 3600) % 24)}:${pad((total / 60) % 60)}:${pad(total % 60)}`
}

/** Продолжительность: 4:07 или 0:39. */
export const mmss = (sec: number) => `${Math.floor(Math.max(0, sec) / 60)}:${pad(Math.max(0, sec) % 60)}`

export const seconds = (sec: number) => `${Math.round(sec)} с`

/** Метры пути в читаемом виде: до километра — метрами, дальше — километрами. */
export function km(metres: number): string {
  if (!Number.isFinite(metres)) return '—'
  if (Math.abs(metres) < 1000) return `${Math.round(metres)} м`
  return `${(metres / 1000).toFixed(1).replace('.', ',')} км`
}

export function relativeDay(ts: number, now = Date.now()): string {
  const days = Math.floor((now - ts) / 86_400_000)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн. назад`
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`
  return `${n} ${many}`
}

export const VERDICT: Record<string, { title: string; tone: 'good' | 'warn' | 'bad' }> = {
  good: { title: 'Рейс закрыт', tone: 'good' },
  partial: { title: 'Закрыт с потерями', tone: 'warn' },
  bad: { title: 'Инцидент', tone: 'bad' },
  rejected: { title: 'Спорный результат', tone: 'bad' },
  unfinished: { title: 'Не завершён', tone: 'warn' }
}

export const MODE_TITLE: Record<string, string> = {
  practice: 'Тренировка',
  exam: 'Экзамен',
  duel: 'Дуэль'
}

export const DIFFICULTY = ['', 'простой', 'несложный', 'средний', 'сложный', 'критический']
