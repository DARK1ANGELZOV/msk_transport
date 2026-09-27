/**
 * Потолок сценария и нормировка компетенций.
 *
 * «Сто процентов по безопасности» должно означать «сыграть лучше было нельзя»,
 * а не «набрал много». Поэтому потолок считается не на глаз, а перебором:
 * движок обходит все проходимые пути графа и берёт лучший достижимый результат.
 * Графы маленькие (десятки узлов), перебор занимает миллисекунды, а результат
 * кешируется по паре «сценарий + версия» — версия неизменяема, значит,
 * кеш никогда не протухнет незаметно.
 *
 * Там, где перебор был бы экспоненциальным (узлы с множественным выбором),
 * применяется одно понятное допущение — оно описано у функции bestSelection
 * и одинаково для всех игроков, поэтому сравнение остаётся честным.
 */
import {
  COMPETENCY_IDS, MULTI_TYPES, TERMINAL_TYPES, SCORE_WEIGHTS,
  clamp, emptyCompetency, initialWorld, meetsRequires
} from './model.js'
import { idealTripSec, referencePairs, resolveNode, transition, tripWindow } from './replay.js'

/** Сколько путей готовы перебрать, прежде чем признать оценку приблизительной. */
const PATH_LIMIT = 40_000

const cache = new Map()

/**
 * Лучший набор отметок для узла с множественным выбором.
 *
 * Допущение: игрок отмечает всё, что не вредит, в эталонном порядке.
 * Перебирать 2^n подмножеств ради потолка бессмысленно — разница
 * не влияет на сравнение игроков между собой, потому что знаменатель
 * у всех один и тот же.
 */
const netValue = (el) => {
  const e = el.effects ?? {}
  const scales = (e.safety ?? 0) + (e.loyalty ?? 0) + (e.carMood ?? 0) - (e.stress ?? 0)
  return scales + Object.values(e.competency ?? {}).reduce((s, v) => s + v, 0)
}

function bestSelection(node) {
  const pool = [...(node.blocks ?? []), ...(node.items ?? [])]
  const useful = pool.filter((el) => netValue(el) > 0)
  const order = node.correctOrder ?? []
  const ids = useful.map((el) => el.id)
  const inOrder = order.filter((id) => ids.includes(id))
  const rest = ids.filter((id) => !order.includes(id))
  const required = (node.required ?? []).filter((id) => !inOrder.includes(id) && !rest.includes(id))
  return [...inOrder, ...rest, ...required]
}

/** Худший осмысленный набор: отмечено всё вредное и ничего полезного. */
function worstSelection(node) {
  return [...(node.blocks ?? []), ...(node.items ?? [])]
    .filter((el) => netValue(el) <= 0)
    .map((el) => el.id)
}

/**
 * Все шаги, доступные из узла при данном состоянии мира.
 *
 * Таймаут входит в перебор наравне с выборами: «не ответить» — это реальный
 * исход, и без него нижняя граница диапазона была бы недостижимо мягкой.
 */
function optionsAt(scenario, cursor, world) {
  const node = scenario.nodes[cursor]
  if (!node || TERMINAL_TYPES.has(node.type)) return []
  const timeout = node.limitSec > 0 && node.onTimeout
    ? [{ node: cursor, timeout: true }]
    : []
  if (MULTI_TYPES.has(node.type)) {
    const worst = worstSelection(node)
    return [
      { node: cursor, choices: bestSelection(node), deliberateMs: 0 },
      ...(worst.length ? [{ node: cursor, choices: worst, deliberateMs: 0 }] : []),
      ...timeout
    ]
  }
  return [
    ...(node.choices ?? [])
      .filter((c) => meetsRequires(c.requires, world))
      .map((c) => ({ node: cursor, choice: c.id, deliberateMs: 0 })),
    ...timeout
  ]
}

function scoreOf(scenario, world, competency, tripSec, sopMatched, sopTotal) {
  const idealSec = idealTripSec(scenario)
  const slack = Math.max(1, tripWindow(scenario) - idealSec)
  const lost = Math.max(0, tripSec - idealSec)
  const timeScore = Math.round(SCORE_WEIGHTS.time * clamp(1 - lost / slack, 0, 1))
  const sopScore = sopTotal ? Math.round(SCORE_WEIGHTS.sop * (sopMatched / sopTotal)) : 0
  const competencyScore =
    Object.values(competency).reduce((s, v) => s + v, 0) * SCORE_WEIGHTS.competency
  return Math.round(
    world.safety * SCORE_WEIGHTS.safety +
    world.loyalty * SCORE_WEIGHTS.loyalty +
    world.carMood * SCORE_WEIGHTS.carMood +
    competencyScore + timeScore + sopScore
  )
}

/**
 * Разбор сценария: потолок балла, потолок по каждой компетенции,
 * теоретический пол по времени. Результат кешируется по версии.
 */
export function analyze(scenario, options = {}) {
  // Редактор правит сценарий, не меняя версию, поэтому ему нужен расчёт
  // в обход кеша. Раньше он чистил кеш целиком — и заодно ронял его
  // соседним экранам, которые ни при чём.
  const key = `${scenario.id}@${scenario.version}`
  const hit = options.cache === false ? null : cache.get(key)
  if (hit) return hit

  const pairs = referencePairs(scenario)
  const maxCompetency = emptyCompetency()
  let maxScore = 0
  let minScore = Infinity
  let paths = 0
  let truncated = false

  const walk = (cursor, world, competency, tripSec, sopMatched, sopTotal, seen, fired) => {
    if (paths > PATH_LIMIT) {
      truncated = true
      return
    }
    cursor = resolveNode(scenario, cursor, world).cursor
    const node = scenario.nodes[cursor]
    if (!node) return
    if (TERMINAL_TYPES.has(node.type)) {
      paths += 1
      const s = scoreOf(scenario, world, competency, tripSec, sopMatched, sopTotal)
      maxScore = Math.max(maxScore, s)
      minScore = Math.min(minScore, s)
      for (const k of COMPETENCY_IDS) maxCompetency[k] = Math.max(maxCompetency[k], competency[k])
      return
    }
    for (const step of optionsAt(scenario, cursor, world)) {
      const ctx = {
        cursor,
        world: { ...world, flags: [...world.flags] },
        competency: { ...competency },
        tripSec,
        fired: new Set(fired),
        events: []
      }
      const { entry, error } = transition(scenario, ctx, step)
      if (error || !entry?.next) continue
      if (seen.has(entry.next)) continue // защита от циклов: путь не должен ходить кругами
      const nextSop = pairs.has(cursor) ? sopTotal + 1 : sopTotal
      const nextMatched = pairs.get(cursor) === entry.next ? sopMatched + 1 : sopMatched
      walk(
        entry.next, ctx.world, ctx.competency, ctx.tripSec,
        nextMatched, nextSop, new Set([...seen, entry.next]), ctx.fired
      )
    }
  }

  const start = initialWorld(scenario)
  walk(scenario.entry, start, emptyCompetency(), 0, 0, 0, new Set([scenario.entry]), new Set())

  const result = {
    maxScore: Math.max(1, maxScore),
    minScore: Number.isFinite(minScore) ? minScore : 0,
    maxCompetency,
    idealSec: idealTripSec(scenario),
    window: tripWindow(scenario),
    paths,
    truncated
  }
  if (options.cache !== false) cache.set(key, result)
  return result
}

export function clearAnalysisCache() {
  cache.clear()
}

/**
 * Проценты по компетенциям для одного прохождения.
 * Компетенции, которых в этом сценарии не заработать, не показываются вовсе:
 * ноль из нуля — это не «плохо», это «не про этот сценарий».
 */
export function competencyPercent(scenario, competency) {
  const { maxCompetency } = analyze(scenario)
  const out = {}
  for (const k of COMPETENCY_IDS) {
    if (maxCompetency[k] <= 0) continue
    out[k] = Math.round(clamp((competency[k] / maxCompetency[k]) * 100))
  }
  return out
}

/**
 * Результат в процентах, 0..100. Именно он идёт в рейтинг, а не сырой балл.
 *
 * Нормируется по **диапазону** сценария, а не по одному потолку:
 * ноль — худший возможный путь по этому графу, сто — лучший.
 *
 * Так сделано не для красоты. Шкалы стартуют высоко (безопасность 100),
 * и при делении только на потолок даже безнадёжное прохождение давало
 * за восемьдесят процентов: метрика переставала отличать сильного
 * проводника от слабого и становилась бесполезной для допуска. Обе границы —
 * свойства графа, одинаковые для всех, поэтому сравнение остаётся честным.
 */
export function scorePercent(scenario, score) {
  const { maxScore, minScore } = analyze(scenario)
  const span = Math.max(1, maxScore - minScore)
  return Math.round(clamp(((score - minScore) / span) * 100))
}

/**
 * Профиль сотрудника: свёртка компетенций по всем его прохождениям.
 *
 * Свежие рейсы весят больше старых — навык, подтверждённый вчера, значит
 * больше, чем подтверждённый полгода назад. Затухание экспоненциальное
 * с периодом полураспада в 45 дней; период вынесен в константу, чтобы
 * методист мог его обсуждать, а не угадывать.
 */
export const HALF_LIFE_DAYS = 45

export function profileCompetency(runs, now = Date.now()) {
  const acc = {}
  const weight = {}
  for (const run of runs) {
    if (run.status !== 'scored') continue
    const days = Math.max(0, (now - new Date(run.finishedAt).getTime()) / 86_400_000)
    const w = Math.pow(0.5, days / HALF_LIFE_DAYS)
    for (const [k, v] of Object.entries(run.competencyPct ?? {})) {
      acc[k] = (acc[k] ?? 0) + v * w
      weight[k] = (weight[k] ?? 0) + w
    }
  }
  const out = {}
  for (const k of COMPETENCY_IDS) {
    if (!weight[k]) continue
    out[k] = Math.round(acc[k] / weight[k])
  }
  return out
}
