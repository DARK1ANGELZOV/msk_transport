/**
 * Загрузка сценариев и сборка того, что видит клиент.
 *
 * Здесь проходит важная граница продукта: **граф сценария на клиент
 * не уходит никогда**. Клиент получает текущее состояние и список действий,
 * доступных прямо сейчас, — и всё. Причин две, и обе существенные.
 *
 * Первая: иначе в исходниках страницы видно, чем кончится каждая ветка,
 * какие эффекты у каждого действия и где лежит «правильный» путь. Тренажёр,
 * в котором ответы лежат в открытой вкладке, не тренирует ничего.
 *
 * Вторая: последствия должны приходить в своё время. Отложенное последствие,
 * которое можно прочитать заранее, перестаёт быть последствием.
 */
import fs from 'node:fs'
import path from 'node:path'

import { availableActions, currentState, remainingMs } from '../../engine/machine.js'
import { scalesOf } from '../../engine/model.js'
import { validate } from '../../engine/validate.js'

const DIR = process.env.CONTENT_DIR || 'content/scenarios'

const store = new Map()

/** Читает и проверяет весь банк. Сломанный сценарий до игрока не доходит. */
export function loadScenarios({ quiet = false } = {}) {
  store.clear()
  const problems = []
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
    const doc = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'))
    const r = validate(doc)
    if (!r.ok) {
      problems.push(`${file}: ${r.errors.join('; ')}`)
      continue
    }
    store.set(doc.id, doc)
  }
  if (problems.length && !quiet) {
    for (const p of problems) console.error(`[контент] сценарий отклонён — ${p}`)
  }
  return { loaded: store.size, problems }
}

export const getScenario = (id) => store.get(id) ?? null
export const allScenarios = () => [...store.values()]

/**
 * Карточка сценария для списка.
 *
 * Источник и нормативная опора отдаются сразу: пользователь должен видеть,
 * откуда взята ситуация, ещё до того, как начнёт её проходить. Это часть
 * доверия к тренажёру, а не дополнительная информация.
 */
export const scenarioCard = (sc) => ({
  id: sc.id,
  title: sc.title,
  subtitle: sc.subtitle ?? null,
  difficulty: sc.difficulty ?? null,
  context: {
    trip_stage: sc.context?.trip_stage ?? null,
    service_class: sc.context?.service_class ?? null,
    car: sc.context?.car ?? null,
    location: sc.context?.location ?? null,
    urgency: sc.context?.urgency ?? null
  },
  source: {
    document: sc.source?.document,
    situation: sc.source?.situation
  },
  // Изображение задаёт место действия. Что именно происходит,
  // говорит текст ситуации, а не фотография.
  media: sc.media ?? null
})

/** Полный паспорт без графа: контекст, источник, разделение норматива и игры. */
export const scenarioPassport = (sc) => ({
  ...scenarioCard(sc),
  context: sc.context,
  source: sc.source,
  scaleMeta: scalesOf(sc),
  scales: sc.initial_state
})

/**
 * Экран: то, что игрок видит прямо сейчас.
 *
 * Ни одного поля из будущих состояний здесь нет — ни переходов, ни эффектов,
 * ни подсказок о последствиях.
 */
export function screen(sc, run, { now = Date.now(), lastResult = null } = {}) {
  const session = run.state
  const st = currentState(sc, session)
  const finished = session.status !== 'active'

  const timer = st?.timer_sec
    ? { totalSec: st.timer_sec, remainingMs: remainingMs(sc, session, now) }
    : null

  return {
    sessionId: run.id,
    attempt: run.attempt,
    status: session.status,
    scenario: scenarioCard(sc),
    step: session.step,
    // Значения и их описание идут вместе: клиент не знает наперёд,
    // какие показатели у этой ситуации, и не должен знать.
    scales: { ...session.scales },
    scaleMeta: scalesOf(sc),
    state: st
      ? {
          id: session.stateId,
          kind: st.kind,
          zone: st.zone ?? null,
          speaker: st.speaker ?? null,
          text: st.text,
          info: st.info ?? null,
          freeText: Boolean(st.free_text) && !finished,
          verdict: st.kind === 'final' ? st.verdict : null,
          summary: st.kind === 'final' ? (st.summary ?? null) : null,
          timer
        }
      : null,
    actions: finished ? [] : availableActions(sc, session),
    sequence: !finished && st?.kind === 'sequence'
      ? { items: st.items.map((i) => ({ id: i.id, label: i.label })) }
      : null,
    lastResult
  }
}

/**
 * Результат хода в том виде, в каком его можно показать.
 *
 * События приходят сюда вместе с ходом — в том числе отложенные, созревшие
 * именно сейчас. Игрок видит их как то, что произошло, и только в разборе
 * узнаёт, каким решением они были вызваны.
 */
export const resultView = (result, scenario) => ({
  actionLabel: result.actionLabel ?? null,
  /*
   * Нормативное основание того, что только что произошло.
   *
   * Показывается ровно тогда, когда автор сценария пометил действие
   * как опирающееся на источник, и берётся из того же правила, на которое
   * он сослался. Это отвечает на вопрос «почему так вышло» ссылкой
   * на документ, а не оценкой «правильно / неправильно».
   */
  basis: result.normativeRef !== null && result.normativeRef !== undefined
    ? scenario?.source?.normative_rule?.[result.normativeRef] ?? null
    : null,
  effects: result.effects ?? {},
  consequence: result.consequence ?? null,
  timedOut: Boolean(result.timedOut),
  grade: result.grade ?? null,
  correctOrder: result.correctOrder ?? null,
  events: (result.events ?? []).map((e) => ({
    note: e.note,
    effects: e.effects,
    delayed: e.type === 'deferred'
  })),
  intent: result.intent
    ? { said: result.intent.said, via: result.intent.via }
    : null
})
