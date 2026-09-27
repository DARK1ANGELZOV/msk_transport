/**
 * Валидатор паспорта сценария.
 *
 * Работает в трёх местах: при запуске проверки контента, при загрузке
 * сценариев сервером и в тестах. Держать три копии правил — верный способ
 * получить три разных мнения о том, что такое корректный сценарий.
 *
 * Валидатор проверяет не только связность графа, но и **дисциплину
 * источников**, а это в этом продукте важнее. Нельзя пометить игровое
 * последствие как нормативное требование, не сославшись на конкретное
 * утверждение источника. Нельзя сослаться на пункт стандарта, которого
 * мы не видели. Формально это техническая проверка, по сути — защита
 * от того, чтобы тренажёр учил людей выдуманному регламенту.
 */
import {
  ALL_SCALE_IDS, COMPETENCY_IDS, SERVICE_CLASSES, TRIP_STAGES, scaleIdsOf
} from './model.js'

const FINAL_VERDICTS = new Set(['good', 'mixed', 'bad'])
const STATE_KINDS = new Set(['decision', 'sequence', 'final'])

export function validate(scenario) {
  const scaleIds = scaleIdsOf(scenario)
  const errors = []
  const warnings = []
  const E = (m) => errors.push(m)
  const W = (m) => warnings.push(m)

  // ----------------------------------------------------------------- паспорт
  if (scenario?.schema !== 'smena400/scenario@1') {
    E(`неизвестная схема: ${scenario?.schema ?? 'не указана'}`)
  }
  if (!scenario?.id) E('не задан id')
  if (!scenario?.title) E('не задан заголовок')
  if (!Number.isInteger(scenario?.version) || scenario.version < 1) {
    E('version должен быть целым числом от 1')
  }

  // ---------------------------------------------------------------- источник
  const src = scenario?.source ?? {}
  if (!src.document) E('source.document не заполнен: неизвестно, откуда взята ситуация')
  if (!src.situation) E('source.situation не заполнен: неизвестно, какая именно это ситуация')
  if (!src.source_reference) E('source.source_reference не заполнен')
  if (!src.scenario_rationale) W('не сказано, зачем эта ситуация нужна в тренажёре')

  /*
   * Цитата из стандарта обязана быть проверяемой.
   *
   * Полные тексты 974-р, 989-р и 990-р в материалах проекта есть, поэтому
   * ссылаться на пункты можно и нужно. Но правило, помеченное как нормативное,
   * без указания документа — это утверждение без источника, и в тренажёре
   * для работы с пассажирами оно опаснее отсутствующей функции.
   */
  const DOCS = /СТО РЖД|974|989|990|Ситуации на борту|банк/i

  const rules = src.normative_rule ?? []
  if (!Array.isArray(rules)) E('normative_rule должен быть списком')
  for (const [i, rule] of (Array.isArray(rules) ? rules : []).entries()) {
    if (typeof rule !== 'string' || !rule.trim()) {
      E(`normative_rule[${i}] пуст`)
    } else if (!DOCS.test(rule)) {
      E(`normative_rule[${i}] не называет документ, из которого взято правило`)
    }
  }
  if (!Array.isArray(src.gameplay_interpretation)) {
    E('gameplay_interpretation должен быть списком')
  }
  if (!rules.length) {
    W('normative_rule пуст: у сценария нет ни одной опоры на источник')
  }

  // ----------------------------------------------------------------- контекст
  const ctx = scenario?.context ?? {}
  if (ctx.trip_stage && !TRIP_STAGES.includes(ctx.trip_stage)) {
    W(`нестандартный этап поездки: ${ctx.trip_stage}`)
  }
  if (ctx.service_class && !SERVICE_CLASSES.includes(ctx.service_class)) {
    E(`неизвестный класс обслуживания: ${ctx.service_class}`)
  }
  const resources = new Set(ctx.available_resources ?? [])
  if (!resources.size) W('не перечислены доступные ресурсы: движок не сможет отсечь невыполнимые действия')

  // -------------------------------------------------------------- состояния
  const states = scenario?.states ?? {}
  const ids = new Set(Object.keys(states))
  if (!ids.size) E('в сценарии нет состояний')
  if (!ids.has(scenario?.entry)) E(`entry «${scenario?.entry}» не найден среди состояний`)

  let finals = 0
  let keyDecisions = 0
  let timers = 0
  let freeTextStates = 0
  let deferredCount = 0
  let infoStates = 0

  for (const [id, st] of Object.entries(states)) {
    const at = `состояние «${id}»`
    if (!STATE_KINDS.has(st.kind)) E(`${at}: неизвестный тип «${st.kind}»`)
    if (!st.text) E(`${at}: нет текста`)

    if (st.info) infoStates += 1

    if (st.kind === 'final') {
      finals += 1
      if (!FINAL_VERDICTS.has(st.verdict)) E(`${at}: финал без корректного verdict`)
      if (st.actions?.length) W(`${at}: у финала есть действия — они никогда не выполнятся`)
      continue
    }

    // Таймер и обязательная ветка бездействия.
    if (st.timer_sec) {
      timers += 1
      if (typeof st.timer_sec !== 'number' || st.timer_sec < 3) {
        E(`${at}: timer_sec должен быть числом не меньше 3`)
      }
      if (!st.on_timeout) {
        E(`${at}: есть таймер, но нет ветки бездействия on_timeout`)
      }
    }
    if (st.on_timeout && !st.timer_sec) {
      W(`${at}: ветка бездействия описана, но таймера нет — она никогда не сработает`)
    }
    if (st.on_timeout) {
      const t = st.on_timeout
      if (t.action) {
        if (!(st.actions ?? []).some((a) => a.id === t.action)) {
          E(`${at}: on_timeout ссылается на несуществующее действие «${t.action}»`)
        }
      } else if (!t.next || !ids.has(t.next)) {
        E(`${at}: on_timeout ведёт в несуществующее состояние «${t.next}»`)
      }
    }

    if (st.kind === 'sequence') {
      const items = st.items ?? []
      if (items.length < 2) E(`${at}: в последовательности меньше двух пунктов`)
      const itemIds = items.map((i) => i.id)
      if (new Set(itemIds).size !== itemIds.length) E(`${at}: повторяющиеся id пунктов`)
      for (const i of items) if (!i.label) E(`${at}: пункт «${i.id}» без подписи`)
      const correct = st.correct_order ?? []
      if (correct.length !== items.length) {
        E(`${at}: correct_order не покрывает все пункты`)
      }
      for (const c of correct) {
        if (!itemIds.includes(c)) E(`${at}: correct_order ссылается на неизвестный пункт «${c}»`)
      }
      for (const grade of ['correct', 'partial', 'wrong']) {
        const b = st.on_submit?.[grade]
        if (!b) {
          E(`${at}: нет ветки «${grade}»`)
          continue
        }
        if (!b.next || !ids.has(b.next)) {
          E(`${at}: ветка «${grade}» ведёт в несуществующее состояние «${b.next}»`)
        }
        checkEffects(b.effects, `${at}, ветка «${grade}»`, E, scaleIds)
        checkCompetency(b.competency, `${at}, ветка «${grade}»`, E)
        deferredCount += (b.deferred ?? []).length
        checkDeferred(b.deferred, `${at}, ветка «${grade}»`, E, scaleIds)
      }
      continue
    }

    // Обычное решение.
    const actions = st.actions ?? []
    if (actions.length < 2) {
      E(`${at}: меньше двух действий — это не решение, а кнопка «далее»`)
    }
    const actionIds = new Set()
    if (st.free_text) freeTextStates += 1

    for (const a of actions) {
      const aat = `${at}, действие «${a.id}»`
      if (!a.id) E(`${at}: действие без id`)
      if (actionIds.has(a.id)) E(`${at}: повторяющийся id действия «${a.id}»`)
      actionIds.add(a.id)
      if (!a.label) E(`${aat}: нет подписи`)

      // Переход.
      const targets = [a.next, ...(a.next_when ?? []).map((r) => r.state)].filter(Boolean)
      if (!targets.length) E(`${aat}: не задан переход`)
      for (const t of targets) {
        if (!ids.has(t)) E(`${aat}: переход в несуществующее состояние «${t}»`)
      }
      for (const r of a.next_when ?? []) {
        if (!r.flag) E(`${aat}: условный переход без флага`)
      }

      checkEffects(a.effects, aat, E, scaleIds)
      checkCompetency(a.competency, aat, E)
      checkDeferred(a.deferred, aat, E, scaleIds)
      deferredCount += (a.deferred ?? []).length

      /*
       * Ресурс, которого нет в контексте, — это не «скрытое действие»,
       * а мёртвая конфигурация: движок уберёт вариант навсегда, и автор
       * сценария об этом не узнает.
       */
      if (a.requires_resource && !resources.has(a.requires_resource)) {
        E(`${aat}: требует ресурс «${a.requires_resource}», которого нет в context.available_resources`)
      }

      // Главная проверка дисциплины источников.
      if (a.normative) {
        if (a.normative_ref === undefined || a.normative_ref === null) {
          E(`${aat}: помечено как нормативно обоснованное, но нет normative_ref`)
        } else if (!rules[a.normative_ref]) {
          E(`${aat}: normative_ref = ${a.normative_ref}, но такого пункта нет в source.normative_rule`)
        }
      }

      if (!a.consequence) W(`${aat}: нет описания последствия — разбор будет беднее`)
      if (a.key) keyDecisions += 1
      if (st.free_text && !(a.keywords ?? []).length && !(a.patterns ?? []).length) {
        W(`${aat}: на узле со свободной репликой нет ни keywords, ни patterns — эту ветку не получится сказать словами`)
      }
    }

    if (st.free_text) {
      // Словарь, одинаковый у всех действий, не различает ничего.
      const vocab = new Map()
      for (const a of actions) {
        for (const w of new Set((a.keywords ?? []).flatMap((k) => k.toLowerCase().split(/\s+/)))) {
          vocab.set(w, (vocab.get(w) ?? 0) + 1)
        }
      }
      for (const a of actions) {
        const own = [...new Set((a.keywords ?? []).flatMap((k) => k.toLowerCase().split(/\s+/)))]
        if (own.length && own.every((w) => vocab.get(w) === actions.length)) {
          W(`${at}, действие «${a.id}»: весь словарь есть у всех остальных — он ничего не различает`)
        }
      }
    }
  }

  if (!finals) E('в сценарии нет ни одного финала')

  // -------------------------------------------------- достижимость и тупики
  const reach = reachable(scenario)
  for (const id of ids) {
    if (!reach.has(id)) W(`состояние «${id}» недостижимо из entry`)
  }
  const reachableFinals = [...reach].filter((id) => states[id]?.kind === 'final')
  if (!reachableFinals.length) E('из entry невозможно дойти ни до одного финала')

  for (const id of reach) {
    const st = states[id]
    if (st?.kind === 'final') continue
    if (!canReachFinal(scenario, id)) {
      E(`из состояния «${id}» невозможно дойти до финала — тупик`)
    }
  }

  // -------------------------------------------------- продуктовые требования
  if (reachableFinals.length < 2) {
    E('у сценария меньше двух достижимых финалов: ветвление не влияет на исход')
  }
  if (!keyDecisions) W('ни одно решение не помечено key — в разборе не будет альтернативы')
  if (!deferredCount) W('нет ни одного отложенного последствия: все решения проявляются сразу')
  if (!infoStates) W('ни одно состояние не приносит новой информации')

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      states: ids.size,
      finals,
      reachableFinals: reachableFinals.length,
      timers,
      keyDecisions,
      deferred: deferredCount,
      freeTextStates,
      infoStates,
      paths: countPaths(scenario)
    }
  }
}

// ---------------------------------------------------------------------------

function checkEffects(effects, at, E, ids) {
  for (const [k, v] of Object.entries(effects ?? {})) {
    if (!ALL_SCALE_IDS.includes(k)) {
      E(`${at}: неизвестный показатель «${k}» (справочник: ${ALL_SCALE_IDS.join(', ')})`)
    } else if (ids && !ids.includes(k)) {
      // Эффект на показатель, которого сценарий не показывает, невидим игроку:
      // он меняет исход, но человек не понимает почему.
      E(`${at}: показатель «${k}» не объявлен в scales этого сценария`)
    }
    if (typeof v !== 'number') E(`${at}: изменение показателя «${k}» должно быть числом`)
  }
}

function checkCompetency(delta, at, E) {
  for (const [k, v] of Object.entries(delta ?? {})) {
    if (!COMPETENCY_IDS.includes(k)) E(`${at}: неизвестная компетенция «${k}»`)
    if (typeof v !== 'number') E(`${at}: вклад в компетенцию «${k}» должен быть числом`)
  }
}

function checkDeferred(list, at, E, ids) {
  for (const d of list ?? []) {
    if (typeof d.after_steps !== 'number' || d.after_steps < 1) {
      E(`${at}: отложенное последствие без корректного after_steps`)
    }
    if (!d.note) E(`${at}: отложенное последствие без пояснения — игрок не поймёт, что произошло`)
    checkEffects(d.effects, `${at}, отложенное последствие`, E, ids)
  }
}

/** Все состояния, достижимые из entry. */
function reachable(scenario) {
  const seen = new Set()
  const walk = (id) => {
    if (!id || seen.has(id) || !scenario.states?.[id]) return
    seen.add(id)
    for (const t of edgesOf(scenario.states[id])) walk(t)
  }
  walk(scenario.entry)
  return seen
}

/** Куда вообще можно уйти из состояния — включая бездействие. */
export function edgesOf(state) {
  const out = []
  for (const a of state?.actions ?? []) {
    if (a.next) out.push(a.next)
    for (const r of a.next_when ?? []) if (r.state) out.push(r.state)
  }
  for (const grade of ['correct', 'partial', 'wrong']) {
    const b = state?.on_submit?.[grade]
    if (b?.next) out.push(b.next)
  }
  const t = state?.on_timeout
  if (t) {
    if (t.next) out.push(t.next)
    if (t.action) {
      const a = (state.actions ?? []).find((x) => x.id === t.action)
      if (a?.next) out.push(a.next)
    }
  }
  return [...new Set(out)]
}

function canReachFinal(scenario, from, seen = new Set()) {
  if (seen.has(from)) return false
  seen.add(from)
  const st = scenario.states?.[from]
  if (!st) return false
  if (st.kind === 'final') return true
  return edgesOf(st).some((t) => canReachFinal(scenario, t, seen))
}

/** Сколько различных путей ведёт от entry до финала — мера реального ветвления. */
function countPaths(scenario, from = scenario.entry, seen = new Set(), depth = 0) {
  if (depth > 40) return 0
  const st = scenario.states?.[from]
  if (!st) return 0
  if (st.kind === 'final') return 1
  if (seen.has(from)) return 0
  const next = new Set(seen)
  next.add(from)
  return edgesOf(st).reduce((n, t) => n + countPaths(scenario, t, next, depth + 1), 0)
}
