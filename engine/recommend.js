/**
 * Что проходить следующим.
 *
 * Две задачи одновременно, и они тянут в разные стороны:
 *   — закрыть провал: подобрать сценарий по самой слабой компетенции;
 *   — не дать забыть: вернуть пройденное по интервальному повторению.
 *
 * Повторение имеет приоритет над новым материалом, когда срок подошёл:
 * навык, который не подтверждали месяц, — это уже не навык. Расчёт
 * детерминированный и объяснимый: сотрудник видит, почему ему предложили
 * именно этот сценарий, а не «система так решила».
 */
import { COMPETENCY_IDS, competencyTitle } from './model.js'

/** Интервалы Лейтнера в днях. Индекс — «коробка», в которой лежит сценарий. */
export const BOXES = [1, 3, 7, 21, 60]

export const dueAfter = (box) => BOXES[Math.min(box, BOXES.length - 1)] * 86_400_000

/**
 * Новая коробка после прохождения.
 * Успех двигает вперёд, провал возвращает в начало: половинчатых
 * переходов нет намеренно — иначе слабое место остаётся в длинном интервале.
 */
export function nextBox(box, scorePct) {
  if (scorePct >= 80) return Math.min(box + 1, BOXES.length - 1)
  if (scorePct >= 60) return box
  return 0
}

/**
 * @param {object[]} scenarios  опубликованные сценарии
 * @param {object} profile      { competency: {id: 0..100} }
 * @param {object[]} srs        [{ scenarioId, box, dueAt, lastScorePct }]
 * @param {number} now
 */
export function recommend(scenarios, profile, srs, now = Date.now()) {
  const byId = new Map(srs.map((s) => [s.scenarioId, s]))
  const out = []

  // ------------------------------------------------------------ повторение
  for (const s of scenarios) {
    const rec = byId.get(s.id)
    if (!rec || rec.dueAt > now) continue
    const overdueDays = Math.floor((now - rec.dueAt) / 86_400_000)
    out.push({
      scenarioId: s.id,
      title: s.title,
      kind: 'repeat',
      priority: 1000 + overdueDays * 10 + (100 - (rec.lastScorePct ?? 0)),
      reason: overdueDays > 0
        ? `Повторение просрочено на ${overdueDays} дн.`
        : 'Пора повторить: срок подошёл сегодня'
    })
  }

  // ------------------------------------------------------------ слабое место
  const weakest = COMPETENCY_IDS
    .filter((k) => typeof profile.competency?.[k] === 'number')
    .sort((a, b) => profile.competency[a] - profile.competency[b])[0]

  for (const s of scenarios) {
    if (byId.has(s.id) && byId.get(s.id).dueAt > now) continue
    if (out.some((o) => o.scenarioId === s.id)) continue
    const covers = s.competencies ?? []
    const fresh = !byId.has(s.id)
    if (weakest && covers.includes(weakest)) {
      out.push({
        scenarioId: s.id,
        title: s.title,
        kind: fresh ? 'weakness' : 'weakness-again',
        priority: 500 + (100 - (profile.competency[weakest] ?? 0)) + (fresh ? 20 : 0),
        reason: `Слабое место: ${competencyTitle(weakest).toLowerCase()} — ${profile.competency[weakest]} %`
      })
      continue
    }
    if (fresh) {
      out.push({
        scenarioId: s.id,
        title: s.title,
        kind: 'new',
        priority: 100 - (s.difficulty ?? 3) * 5,
        reason: 'Новый сценарий'
      })
    }
  }

  return out.sort((a, b) => b.priority - a.priority || a.scenarioId.localeCompare(b.scenarioId))
}

/**
 * Серия дней подряд. Считается по календарным дням в часовом поясе сервера:
 * сотрудник живёт в днях, а не в скользящих сутках.
 */
export function streakDays(dates, now = Date.now()) {
  const days = new Set(dates.map((d) => new Date(d).toISOString().slice(0, 10)))
  let streak = 0
  for (let i = 0; ; i += 1) {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10)
    if (days.has(day)) streak += 1
    else if (i > 0) break
    else if (i === 0) continue // сегодня ещё мог не заниматься — серия не рвётся до полуночи
    if (i > 400) break
  }
  return streak
}
