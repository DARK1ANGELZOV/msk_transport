/**
 * Scenario Engine — единственное место, где меняется состояние ситуации.
 *
 * Сценарий здесь — граф состояний, а не последовательность экранов. Движок
 * ничего не знает про конкретные ситуации: он умеет только исполнять то,
 * что описано в конфигурации. Добавление нового сценария не требует правок
 * в этом файле — и это главная проверка, что архитектура выбрана верно.
 *
 * Три правила, которые движок держит жёстко:
 *
 *   1. Эффекты не придумываются. Движок применяет ровно те изменения шкал,
 *      которые записаны в конкретном переходе конкретного сценария. Никакой
 *      универсальной формулы «хороший ответ = +10» не существует.
 *
 *   2. Допустимость действия решает движок, а не интерфейс. Клиент может
 *      прислать любой идентификатор — он будет проверен по текущему
 *      состоянию, флагам и доступным ресурсам.
 *
 *   3. Истечение времени — это исход, а не отсутствие исхода. Опоздавшее
 *      действие не выполняется: вместо него применяется ветка бездействия.
 *
 * Функции чистые: сессия не мутируется, а возвращается новая. Благодаря
 * этому одна и та же сессия одинаково считается на сервере и в тестах,
 * а историю прохождения можно воспроизвести шаг за шагом.
 */
import { classify } from './intent.js'
import { SCALE_IDS, clamp, emptyCompetency } from './model.js'

/**
 * Запас на разницу часов и задержку сети.
 *
 * Без него решение, отправленное в последнюю десятую долю секунды, иногда
 * приходило бы «просроченным» из-за сети — и человек получал бы бездействие
 * за то, что успел. Полторы секунды достаточно, чтобы это исключить,
 * и слишком мало, чтобы на этом можно было выиграть время.
 */
export const CLOCK_GRACE_MS = 1500

const clone = (v) => JSON.parse(JSON.stringify(v))

const fail = (code, error) => ({ ok: false, code, error })

// ---------------------------------------------------------------------------
// Сессия
// ---------------------------------------------------------------------------

/** Новая сессия прохождения: начальное состояние ситуации из паспорта. */
export function startSession(scenario, { now = Date.now() } = {}) {
  const init = scenario.initial_state ?? {}
  const session = {
    scenarioId: scenario.id,
    scenarioVersion: scenario.version ?? 1,
    stateId: scenario.entry,
    scales: {
      loyalty: clamp(init.loyalty ?? 60),
      safety: clamp(init.safety ?? 80)
    },
    competency: emptyCompetency(),
    flags: [...(init.flags ?? [])],
    step: 0,
    deferred: [],
    log: [],
    status: 'active',
    outcome: null,
    startedAt: now,
    stateEnteredAt: now
  }
  // События входа работают и для стартового состояния: ситуация может
  // начинаться с того, что уже что-то произошло.
  return enterState(scenario, session, scenario.entry, now, null).session
}

export const currentState = (scenario, session) =>
  scenario.states?.[session.stateId] ?? null

export const isFinished = (session) => session.status === 'finished'

/** Сколько миллисекунд осталось на решение. `null` — таймера нет. */
export function remainingMs(scenario, session, now = Date.now()) {
  const state = currentState(scenario, session)
  if (!state?.timer_sec) return null
  const left = state.timer_sec * 1000 - (now - session.stateEnteredAt)
  return Math.max(0, left)
}

function expired(scenario, session, now) {
  const state = currentState(scenario, session)
  if (!state?.timer_sec) return false
  return now - session.stateEnteredAt > state.timer_sec * 1000 + CLOCK_GRACE_MS
}

// ---------------------------------------------------------------------------
// Доступные действия
// ---------------------------------------------------------------------------

/**
 * Что проводник реально может сделать прямо сейчас.
 *
 * Фильтрация по ресурсам — не украшение, а прямая реализация требования
 * из материалов проекта: не предлагать действие, которое невозможно
 * выполнить с учётом оборудования вагона. Если в вагоне нет работающей
 * связи, варианта «доложить по связи» не существует, и это часть обучения.
 *
 * Недоступные действия из выдачи убираются, а не показываются серыми:
 * серый вариант всё равно подсказывает, что «где-то есть такой путь».
 */
export function availableActions(scenario, session) {
  const state = currentState(scenario, session)
  if (!state || state.kind === 'final') return []
  const resources = new Set(scenario.context?.available_resources ?? [])
  const flags = new Set(session.flags)

  return (state.actions ?? [])
    .map((a) => {
      let reason = null
      if (a.requires_resource && !resources.has(a.requires_resource)) {
        reason = `нет ресурса: ${a.requires_resource}`
      } else if (a.requires_flag && !flags.has(a.requires_flag)) {
        reason = `не выполнено условие: ${a.requires_flag}`
      } else if (a.forbidden_flag && flags.has(a.forbidden_flag)) {
        reason = `уже неприменимо: ${a.forbidden_flag}`
      }
      return {
        id: a.id,
        label: a.label,
        kind: a.kind ?? 'choice',
        note: a.note ?? null,
        available: reason === null,
        reason
      }
    })
    .filter((a) => a.available)
}

/** Полное описание действия из паспорта — для применения эффектов. */
function findAction(scenario, session, actionId) {
  const state = currentState(scenario, session)
  return (state?.actions ?? []).find((a) => a.id === actionId) ?? null
}

// ---------------------------------------------------------------------------
// Эффекты и переходы
// ---------------------------------------------------------------------------

/** Изменения шкал строго из конфигурации перехода. Движок ничего не добавляет. */
function applyEffects(session, effects) {
  const applied = {}
  for (const id of SCALE_IDS) {
    const delta = Number(effects?.[id] ?? 0)
    if (!delta) continue
    const before = session.scales[id]
    session.scales[id] = clamp(before + delta)
    applied[id] = session.scales[id] - before
  }
  return applied
}

function applyCompetency(session, delta) {
  for (const [id, v] of Object.entries(delta ?? {})) {
    if (id in session.competency) session.competency[id] += Number(v) || 0
  }
}

/**
 * Куда ведёт действие.
 *
 * Условный переход разбирается по флагам: первое сработавшее правило
 * побеждает. Это позволяет одному и тому же решению приводить в разные
 * состояния в зависимости от того, что игрок делал раньше, — без единой
 * строчки кода в движке.
 */
function resolveNext(action, session) {
  for (const rule of action.next_when ?? []) {
    const has = session.flags.includes(rule.flag)
    if (rule.unless ? !has : has) return rule.state
  }
  return action.next ?? null
}

/**
 * Вход в состояние: срабатывают события входа и созревшие отложенные
 * последствия.
 *
 * Отложенное последствие — механика, ради которой всё и делалось.
 * Решение, принятое на первом шаге, может проявиться на третьем, когда
 * его уже не связать с причиной интуитивно. Разбор потом показывает связь
 * явно, и это и есть обучение.
 */
function enterState(scenario, session, stateId, now, cause) {
  const next = clone(session)
  next.stateId = stateId
  next.stateEnteredAt = now

  const events = []
  const state = scenario.states?.[stateId]
  const flags = () => new Set(next.flags)

  // 1. События входа, заданные состоянием.
  for (const ev of state?.on_enter ?? []) {
    const set = flags()
    if (ev.when_flag && !set.has(ev.when_flag)) continue
    if (ev.unless_flag && set.has(ev.unless_flag)) continue
    const applied = applyEffects(next, ev.effects)
    applyCompetency(next, ev.competency)
    for (const f of ev.set_flags ?? []) if (!next.flags.includes(f)) next.flags.push(f)
    events.push({
      type: 'event',
      note: ev.note,
      effects: applied,
      scalesAfter: { ...next.scales },
      cause: cause ?? null
    })
  }

  // 2. Созревшие отложенные последствия. В финале срабатывают все, что ещё
  //    висят: последствие не имеет права потеряться из-за того, что ситуация
  //    закончилась раньше, чем оно должно было проявиться.
  const isFinal = state?.kind === 'final'
  const due = next.deferred.filter((d) => isFinal || d.fireAtStep <= next.step)
  next.deferred = next.deferred.filter((d) => !due.includes(d))
  for (const d of due) {
    const applied = applyEffects(next, d.effects)
    applyCompetency(next, d.competency)
    for (const f of d.set_flags ?? []) if (!next.flags.includes(f)) next.flags.push(f)
    events.push({
      type: 'deferred',
      note: d.note,
      effects: applied,
      scalesAfter: { ...next.scales },
      cause: d.cause,
      causeLabel: d.causeLabel,
      late: isFinal && d.fireAtStep > next.step
    })
  }

  if (isFinal) {
    next.status = 'finished'
    next.outcome = stateId
    next.finishedAt = now
  }

  for (const e of events) next.log.push({ step: next.step, stateId, ...e })

  return { session: next, events }
}

// ---------------------------------------------------------------------------
// Единственная точка входа
// ---------------------------------------------------------------------------

/**
 * Выполнить ход.
 *
 * Принимает ровно одну из форм ввода:
 *
 *   { actionId }      выбор варианта или эскалация
 *   { said }          свободная реплика — разбирается здесь же
 *   { order }         последовательность действий
 *   { timeout: true } игрок ничего не сделал, время вышло
 *
 * Возвращает новую сессию и описание того, что произошло. Ошибка — это
 * отказ движка, а не исключение: сервер превращает её в понятный ответ.
 */
export function step(scenario, session, input = {}, { now = Date.now() } = {}) {
  if (session.status !== 'active') {
    return fail('finished', 'ситуация уже завершена')
  }
  const state = currentState(scenario, session)
  if (!state) return fail('bad-state', `состояние «${session.stateId}» не найдено`)
  if (state.kind === 'final') return fail('finished', 'ситуация уже завершена')

  // Таймер проверяется раньше всего: опоздавшее действие не выполняется.
  if (state.timer_sec && expired(scenario, session, now)) {
    return timeout(scenario, session, now, input.timeout ? 'declared' : 'late')
  }
  if (input.timeout) {
    // Клиент говорит, что время вышло, а по часам сервера — нет.
    // Верим часам сервера: иначе таймер можно было бы «доложить» досрочно.
    return fail('not-expired', 'время ещё не истекло')
  }

  if (state.kind === 'sequence') {
    // Сюда можно попасть, отправив реплику на состояние, где нужен порядок
    // действий. Отвечаем по-человечески, а не «не передан порядок».
    if (typeof input.said === 'string') {
      return fail('no-free-text', 'здесь нужно расставить действия по порядку')
    }
    return sequence(scenario, session, input, now)
  }

  // Свободная реплика: разбираем здесь, потому что решение о том, какое
  // действие имелось в виду, — часть игровой логики, а не интерфейса.
  let actionId = input.actionId ?? null
  let intent = null
  if (!actionId && typeof input.said === 'string') {
    if (!state.free_text) return fail('no-free-text', 'здесь нужно выбрать действие')
    const allowed = availableActions(scenario, session)
    const full = allowed.map((a) => ({ ...findAction(scenario, session, a.id), ...a }))
    const verdict = classify(full, input.said)
    intent = {
      said: String(input.said).slice(0, 400),
      reason: verdict.reason,
      via: verdict.via,
      words: verdict.words,
      scores: verdict.scores
    }
    if (!verdict.actionId) {
      return { ok: false, code: 'unclear', error: verdict.reason, intent }
    }
    actionId = verdict.actionId
  }

  if (!actionId) return fail('no-input', 'не передано действие')

  const allowed = availableActions(scenario, session)
  if (!allowed.some((a) => a.id === actionId)) {
    // Здесь же закрывается попытка прислать действие из другого состояния.
    return fail('not-allowed', `действие «${actionId}» сейчас недоступно`)
  }
  const action = findAction(scenario, session, actionId)
  if (!action) return fail('not-allowed', `действие «${actionId}» не найдено`)

  /*
   * Реплика, разобранная запасным путём (моделью), приходит сюда уже вместе
   * с идентификатором действия. Сохраняем и текст, и пометку о том, каким
   * путём он распознан: в разборе должно быть видно и что человек сказал,
   * и на каком основании это было засчитано.
   */
  const viaAi = input.via === 'ai' && typeof input.said === 'string'
  return commit(scenario, session, action, {
    now,
    said: intent?.said ?? (viaAi ? String(input.said).slice(0, 400) : null),
    intent: intent ?? (viaAi ? { reason: 'ok', via: 'ai', scores: [] } : null),
    timedOut: false
  })
}

/** Применение выбранного действия: эффекты, флаги, отложенные последствия, переход. */
function commit(scenario, session, action, { now, said, intent, timedOut }) {
  const next = clone(session)
  const state = currentState(scenario, session)
  const thinkMs = Math.max(0, now - session.stateEnteredAt)
  // Снимок выбора, который был у игрока в этот момент. Нужен разбору:
  // без него нельзя честно сказать «из того, что было доступно».
  const offered = availableActions(scenario, session).map((a) => a.id)

  const applied = applyEffects(next, action.effects)
  applyCompetency(next, action.competency)

  for (const f of action.set_flags ?? []) if (!next.flags.includes(f)) next.flags.push(f)
  for (const f of action.clear_flags ?? []) next.flags = next.flags.filter((x) => x !== f)

  // Отменённые отложенные последствия: игрок успел исправиться.
  for (const id of action.cancel_deferred ?? []) {
    next.deferred = next.deferred.filter((d) => d.id !== id)
  }

  next.step += 1

  for (const d of action.deferred ?? []) {
    next.deferred.push({
      id: d.id ?? `${action.id}:${next.step}`,
      fireAtStep: next.step + (d.after_steps ?? 1),
      effects: d.effects,
      competency: d.competency,
      set_flags: d.set_flags,
      note: d.note,
      cause: action.id,
      causeLabel: action.label
    })
  }

  next.log.push({
    type: 'action',
    step: next.step,
    stateId: session.stateId,
    stateText: state.text,
    actionId: action.id,
    actionLabel: action.label,
    kind: timedOut ? 'idle' : (action.kind ?? 'choice'),
    said: said ?? null,
    intent: intent ? { reason: intent.reason, via: intent.via, scores: intent.scores } : null,
    effects: applied,
    scalesAfter: { ...next.scales },
    competency: action.competency ?? {},
    consequence: action.consequence ?? null,
    normative: Boolean(action.normative),
    normative_ref: action.normative_ref ?? null,
    key: Boolean(action.key),
    offered,
    thinkMs,
    timedOut,
    at: new Date(now).toISOString()
  })

  const nextId = resolveNext(action, next)
  if (!nextId || !scenario.states?.[nextId]) {
    return fail('dead-end', `действие «${action.id}» никуда не ведёт`)
  }

  const entered = enterState(scenario, next, nextId, now, action.id)
  return {
    ok: true,
    session: entered.session,
    result: {
      actionId: action.id,
      actionLabel: action.label,
      effects: applied,
      consequence: action.consequence ?? null,
      events: entered.events,
      timedOut,
      intent
    }
  }
}

/**
 * Бездействие.
 *
 * Отдельный исход со своими эффектами. Сценарий обязан описать `on_timeout`
 * у каждого состояния с таймером — валидатор это проверяет, чтобы молчание
 * игрока никогда не приводило в тупик.
 */
function timeout(scenario, session, now, mode) {
  const state = currentState(scenario, session)
  const t = state.on_timeout
  if (!t) return fail('no-timeout-branch', 'у состояния нет ветки бездействия')

  // Ветка бездействия может ссылаться на существующее действие — тогда
  // «ничего не сделал» означает «сделал то, что произошло само».
  const action = t.action
    ? findAction(scenario, session, t.action)
    : {
        id: `${session.stateId}:timeout`,
        label: t.label ?? 'Решение не принято вовремя',
        kind: 'idle',
        effects: t.effects,
        competency: t.competency,
        set_flags: t.set_flags,
        deferred: t.deferred,
        consequence: t.consequence ?? null,
        next: t.next
      }
  if (!action) return fail('no-timeout-branch', 'ветка бездействия ссылается на несуществующее действие')

  const out = commit(scenario, session, { ...action, kind: 'idle' }, {
    now, said: null, intent: null, timedOut: true
  })
  if (out.ok) out.result.timeoutMode = mode
  return out
}

/**
 * Последовательность действий.
 *
 * Оценивается не «угадал весь порядок», а главное: что игрок сделал первым.
 * Приоритизация — это и есть выбор первого шага, когда важного несколько.
 */
function sequence(scenario, session, input, now) {
  const state = currentState(scenario, session)
  const order = Array.isArray(input.order) ? input.order : null
  if (!order) return fail('no-input', 'не передан порядок действий')

  const items = (state.items ?? []).map((i) => i.id)
  const unknown = order.filter((id) => !items.includes(id))
  if (unknown.length) return fail('not-allowed', `неизвестные пункты: ${unknown.join(', ')}`)
  if (new Set(order).size !== order.length) return fail('not-allowed', 'пункты повторяются')
  if (order.length !== items.length) return fail('not-allowed', 'выбраны не все пункты')

  const correct = state.correct_order ?? []
  const exact = order.every((id, i) => id === correct[i])
  const firstRight = order[0] === correct[0]
  const grade = exact ? 'correct' : firstRight ? 'partial' : 'wrong'
  const branch = state.on_submit?.[grade]
  if (!branch) return fail('bad-state', `у состояния нет ветки «${grade}»`)

  const labels = Object.fromEntries((state.items ?? []).map((i) => [i.id, i.label]))
  const action = {
    id: `${session.stateId}:${grade}`,
    label: order.map((id) => labels[id]).join(' → '),
    kind: 'sequence',
    effects: branch.effects,
    competency: branch.competency,
    set_flags: branch.set_flags,
    deferred: branch.deferred,
    consequence: branch.consequence ?? null,
    next: branch.next,
    key: Boolean(state.key)
  }
  const out = commit(scenario, session, action, { now, said: null, intent: null, timedOut: false })
  if (out.ok) {
    out.result.grade = grade
    out.result.correctOrder = correct.map((id) => labels[id])
  }
  return out
}
