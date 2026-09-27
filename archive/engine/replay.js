/**
 * Детерминированный проигрыш пути по графу сценария.
 *
 * Это единственное место, где считается результат. Клиент не присылает очки —
 * он присылает путь: какие узлы прошёл, что выбрал, сколько думал. Сервер
 * проигрывает этот путь по своей копии опубликованной версии графа и получает
 * те же числа, что игрок видел на экране, потому что на экране крутится
 * ровно этот же код.
 *
 * Отсюда три следствия, ради которых всё и затевалось:
 *   — рейтинг нельзя накрутить, не подделав правдоподобный путь;
 *   — результат воспроизводим и объясним по шагам в разборе рейса;
 *   — оценку можно класть в допуск к работе, а не только в развлечение.
 *
 * Языковая модель в этот файл не заглядывает. Она может озвучить пассажира
 * и отнести свободную реплику к одному из рёбер графа, но ветвление, шкалы
 * и компетенции считает арифметика, которую видно глазами.
 */
import {
  ENGINE, MULTI_TYPES, TERMINAL_TYPES, SCORE_WEIGHTS,
  applyEffects, clamp, edgesOf, emptyCompetency, initialWorld, meetsRequires, syncPosition
} from './model.js'
import { classify } from './intent.js'

/** Секунды рейса, потраченные на раздумье: не больше лимита узла. */
function deliberateSec(node, ms) {
  const raw = Math.max(0, (ms ?? 0) / 1000)
  return node.limitSec > 0 ? Math.min(raw, node.limitSec) : raw
}

/**
 * Срабатывание событий мира.
 *
 * Событие привязано к секунде рейса, а не к узлу: состав идёт своим ходом
 * независимо от того, чем в этот момент занят проводник. Именно поэтому
 * промедление закрывает варианты — оно не «штрафуется», оно двигает мир
 * и вместе с ним поезд по километражу линии.
 */
export function advanceWorld(scenario, world, until, fired, log) {
  // Мир двигается вместе с составом: сначала положение, потом события.
  // Порядок важен — событие может зависеть от того, где поезд оказался.
  syncPosition(scenario, world, until)
  for (const [i, ev] of (scenario.worldEvents ?? []).entries()) {
    if (fired.has(i)) continue
    if (typeof ev.atElapsedSec !== 'number' || ev.atElapsedSec > until) continue
    fired.add(i)
    for (const [k, v] of Object.entries(ev.set ?? {})) {
      if (k === 'flags') world.flags = [...new Set([...world.flags, ...v])]
      else world[k] = v
    }
    log.push({ at: Math.round(until), toast: ev.toast ?? '', goto: ev.goto ?? null })
  }
}

/** Совпадает ли относительный порядок отмеченных пунктов с эталонным. */
function orderAccuracy(selected, correctOrder) {
  if (!Array.isArray(correctOrder) || !correctOrder.length) return 1
  const seq = selected.filter((id) => correctOrder.includes(id))
  if (!seq.length) return 0
  let matched = 0
  for (let i = 0; i < seq.length; i += 1) if (seq[i] === correctOrder[i]) matched += 1
  return matched / correctOrder.length
}

/**
 * Узел, недоступный в текущем состоянии мира, отдаёт ход обходной ветке.
 *
 * Это не то же самое, что скрытый вариант. Вариант «доложить по связи»
 * прячется, когда связи нет; а целый узел «сеанс связи с начальником поезда»
 * в тоннеле не просто теряет варианты — его не существует, и рейс должен
 * уйти в ветку «связи нет». Без этого мир получается непоследовательным:
 * канал закрыт, а экран доклада всё равно открывается.
 */
export function resolveNode(scenario, cursor, world, limit = 5) {
  const redirects = []
  let cur = cursor
  for (let i = 0; i < limit; i += 1) {
    const node = scenario.nodes[cur]
    if (!node?.requiresWorld) break
    if (meetsRequires(node.requiresWorld, world)) break
    if (!node.elseGoto || !scenario.nodes[node.elseGoto]) break
    redirects.push({ from: cur, to: node.elseGoto, why: node.elseReason ?? '' })
    cur = node.elseGoto
  }
  return { cursor: cur, redirects }
}

/**
 * Один переход по графу. Общая механика для настоящего прохождения
 * и для перебора путей, которым считается потолок сценария.
 */
function transition(scenario, ctx, step) {
  const resolved = resolveNode(scenario, ctx.cursor, ctx.world)
  if (resolved.cursor !== ctx.cursor) {
    for (const r of resolved.redirects) {
      ctx.events.push({ at: Math.round(ctx.tripSec), toast: r.why, redirect: r })
    }
    ctx.cursor = resolved.cursor
  }
  const node = scenario.nodes[ctx.cursor]
  if (!node) return { error: `узла «${ctx.cursor}» нет в этой версии графа` }
  if (step.node && step.node !== ctx.cursor) {
    return { error: `путь разошёлся с графом: ожидался «${ctx.cursor}», прислан «${step.node}»` }
  }

  const think = deliberateSec(node, step.deliberateMs)
  const entry = {
    node: ctx.cursor,
    type: node.type,
    atTripSec: Math.round(ctx.tripSec),
    thinkSec: Math.round(think * 10) / 10,
    costSec: 0,
    timeout: false,
    picked: [],
    feedback: '',
    sop: '',
    mentorNote: '',
    stressBefore: ctx.world.stress
  }

  // Мир двигается, пока игрок думает: события успевают наступить раньше решения.
  advanceWorld(scenario, ctx.world, ctx.tripSec + think, ctx.fired, ctx.events)

  // ---------------------------------------------------------------- таймаут
  if (step.timeout) {
    if (!(node.limitSec > 0) || !node.onTimeout) {
      return { error: `узел «${ctx.cursor}» не имеет ветки по таймауту` }
    }
    ctx.world.stress = clamp(ctx.world.stress + ENGINE.TIMEOUT_STRESS)
    ctx.tripSec += node.limitSec
    entry.timeout = true
    entry.thinkSec = node.limitSec
    entry.next = node.onTimeout
    entry.feedback = 'Решение не принято в отведённое время. Рейс продолжается без вас.'
    advanceWorld(scenario, ctx.world, ctx.tripSec, ctx.fired, ctx.events)
    return { entry }
  }

  // ------------------------------------------------- множественный выбор
  if (MULTI_TYPES.has(node.type)) {
    const pool = new Map([...(node.blocks ?? []), ...(node.items ?? [])].map((e) => [e.id, e]))
    const selected = Array.isArray(step.choices) ? step.choices : []
    for (const id of selected) {
      if (!pool.has(id)) return { error: `в узле «${ctx.cursor}» нет элемента «${id}»` }
    }
    if (new Set(selected).size !== selected.length) {
      return { error: `в узле «${ctx.cursor}» элемент отмечен дважды` }
    }
    if (!node.next) return { error: `узел «${ctx.cursor}» типа ${node.type} не имеет next` }

    let cost = 0
    for (const id of selected) {
      const el = pool.get(id)
      applyEffects(ctx.world, el.effects, ctx.competency)
      cost += el.costSec ?? 0
      entry.picked.push({ id, text: el.text, effects: el.effects ?? {} })
    }

    // Порядок — часть навыка: сначала жизнь и здоровье, потом всё остальное.
    const acc = orderAccuracy(selected, node.correctOrder)
    entry.orderAccuracy = Math.round(acc * 100) / 100
    if (node.orderBonus) {
      const scale = node.partialCredit === false ? (acc === 1 ? 1 : 0) : acc
      const bonus = { competency: {} }
      for (const [k, v] of Object.entries(node.orderBonus)) {
        if (k === 'competency') {
          for (const [ck, cv] of Object.entries(v)) bonus.competency[ck] = cv * scale
        } else bonus[k] = v * scale
      }
      applyEffects(ctx.world, bonus, ctx.competency)
    }
    // Пропущенные обязательные блоки доклада: неполный доклад ничего не запускает.
    for (const id of node.required ?? []) {
      if (!selected.includes(id)) {
        ctx.world.safety = clamp(ctx.world.safety - 6)
        ctx.competency.comms -= 6
      }
    }

    ctx.tripSec += think + cost
    entry.costSec = cost
    entry.next = node.next
    entry.feedback = node.feedback ?? ''
    entry.sop = node.sop ?? ''
    entry.mentorNote = node.mentorNote ?? ''
    advanceWorld(scenario, ctx.world, ctx.tripSec, ctx.fired, ctx.events)
    return { entry }
  }

  // ------------------------------------------------------- одиночный выбор
  const choice = (node.choices ?? []).find((c) => c.id === step.choice)
  if (!choice) return { error: `в узле «${ctx.cursor}» нет варианта «${step.choice}»` }
  if (!meetsRequires(choice.requires, ctx.world)) {
    return { error: `вариант «${choice.id}» был недоступен в этом состоянии мира` }
  }

  /**
   * Свободная реплика: сервер распознаёт её тем же кодом, что и клиент,
   * и обязан прийти к тому же ребру графа. Разошлись — значит, путь
   * подделан или контент изменился под уже сыгранным прохождением.
   * Свободная речь не создаёт дыры в античите.
   */
  if (step.said) {
    const available = (node.choices ?? []).filter((c) => meetsRequires(c.requires, ctx.world))
    const verdict = classify(node, step.said, available)
    if (verdict.choice !== choice.id) {
      return {
        error: `реплика распознаётся как «${verdict.choice ?? verdict.reason}», ` +
          `а прислан вариант «${choice.id}»`
      }
    }
    entry.said = String(step.said).slice(0, 400)
    entry.intent = { words: verdict.words, scores: verdict.scores }
  }

  applyEffects(ctx.world, choice.effects, ctx.competency)
  ctx.tripSec += think + (choice.costSec ?? 0)
  entry.costSec = choice.costSec ?? 0
  entry.picked.push({ id: choice.id, text: choice.text, effects: choice.effects ?? {} })
  entry.next = choice.next
  entry.feedback = choice.feedback ?? ''
  entry.sop = choice.sop ?? ''
  entry.mentorNote = choice.mentorNote ?? ''
  advanceWorld(scenario, ctx.world, ctx.tripSec, ctx.fired, ctx.events)
  return { entry }
}

/** Пары «узел → следующий узел» эталонного пути: по ним считается совпадение с СОП. */
export function referencePairs(scenario) {
  const ref = scenario.reference ?? []
  const map = new Map()
  for (let i = 0; i < ref.length - 1; i += 1) map.set(ref[i], ref[i + 1])
  return map
}

/**
 * Окно рейса: сколько секунд есть до ближайшей остановки.
 * Оно же — знаменатель для оценки потерянного времени.
 *
 * Когда сценарий привязан к линии, окно не задаётся в контенте вовсе:
 * оно вытекает из километра, с которого начинается сценарий, и профиля
 * движения. Методисту нечего подгонять — и нечем ошибиться.
 */
export function tripWindow(scenario) {
  const world = initialWorld(scenario, null)
  if (typeof world.toStopSec === 'number' && world.toStopSec > 0) return world.toStopSec
  return scenario.estimatedSec ?? 300
}

/**
 * Проигрывает путь и считает всё, что нужно рейтингу и разбору.
 *
 * `strict` включает проверки правдоподобия таймингов. На сервере он обязателен,
 * в предпросмотре методиста — нет: методист имеет право кликать мгновенно.
 */
export function replay(scenario, path, options = {}) {
  const strict = options.strict !== false
  const ctx = {
    cursor: scenario.entry,
    world: initialWorld(scenario, options.carry ?? null),
    competency: emptyCompetency(),
    tripSec: 0,
    fired: new Set(),
    events: []
  }

  const steps = Array.isArray(path?.steps) ? path.steps : []
  const breaths = new Map((path?.breaths ?? []).map((b) => [b.afterStep, true]))
  // «Показать все варианты» при туннельном зрении: раскрытие стоит секунд рейса.
  const reveals = new Set((path?.reveals ?? []).map((r) => r.atStep))
  // Непонятые реплики: пассажир переспрашивает, и это стоит секунд рейса.
  const retries = new Map()
  for (const r of path?.retries ?? []) {
    if (!retries.has(r.atStep)) retries.set(r.atStep, [])
    retries.get(r.atStep).push(String(r.said ?? ''))
  }
  const visited = []
  const rejected = []
  let stressPeak = ctx.world.stress
  let fastSteps = 0
  let breathCount = 0
  let retryCount = 0

  if (!scenario.nodes?.[ctx.cursor]) {
    return fail(scenario, ctx, visited, ['в сценарии нет стартового узла'])
  }
  if (!steps.length) return fail(scenario, ctx, visited, ['пустой путь'])

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]
    if (TERMINAL_TYPES.has(scenario.nodes[ctx.cursor]?.type)) {
      rejected.push('шаг после финального узла')
      break
    }
    if (strict && !step.timeout) {
      if (typeof step.deliberateMs !== 'number' || step.deliberateMs < 0) {
        rejected.push(`шаг ${i + 1}: не прислано время раздумья`)
        break
      }
      if (step.deliberateMs < ENGINE.MIN_DELIBERATE_MS) fastSteps += 1
      const limit = scenario.nodes[ctx.cursor]?.limitSec ?? 0
      if (limit > 0 && step.deliberateMs > limit * 1000 + 1500) {
        rejected.push(`шаг ${i + 1}: раздумье дольше лимита, но не помечено таймаутом`)
        break
      }
    }

    if (reveals.has(i)) ctx.tripSec += ENGINE.REVEAL_SEC

    // Каждый переспрос обязан быть настоящим: сервер проверяет, что эту
    // реплику и правда нельзя было отнести ни к одному варианту.
    const said = retries.get(i) ?? []
    if (said.length) {
      const node = scenario.nodes[ctx.cursor]
      const available = (node?.choices ?? []).filter((c) => meetsRequires(c.requires, ctx.world))
      for (const text of said) {
        if (classify(node ?? {}, text, available).choice) {
          rejected.push(`шаг ${i + 1}: реплика «${text.slice(0, 40)}» была понятна, переспрос не нужен`)
          break
        }
        ctx.tripSec += ENGINE.RETRY_SEC
        retryCount += 1
      }
      if (rejected.length) break
    }

    const { entry, error } = transition(scenario, ctx, step)
    if (error) {
      rejected.push(`шаг ${i + 1}: ${error}`)
      break
    }
    if (reveals.has(i)) entry.revealed = true

    if (breaths.has(i)) {
      ctx.world.stress = clamp(ctx.world.stress + ENGINE.BREATH_STRESS)
      ctx.tripSec += ENGINE.BREATH_SEC
      entry.breath = true
      breathCount += 1
    }

    entry.stressAfter = ctx.world.stress
    entry.world = { ...ctx.world, flags: [...ctx.world.flags] }
    stressPeak = Math.max(stressPeak, ctx.world.stress)
    visited.push(entry)
    ctx.cursor = entry.next
    if (!scenario.nodes[ctx.cursor]) {
      rejected.push(`переход в несуществующий узел «${ctx.cursor}»`)
      break
    }
  }

  if (strict && fastSteps > ENGINE.FAST_STEPS_ALLOWED) {
    rejected.push(`${fastSteps} шагов быстрее ${ENGINE.MIN_DELIBERATE_MS} мс — так узел не прочитать`)
  }
  if (strict && path?.startedAt && path?.finishedAt) {
    const wall = new Date(path.finishedAt) - new Date(path.startedAt)
    const think = steps.reduce((s, st) => s + (st.deliberateMs ?? 0), 0)
    if (Number.isFinite(wall) && wall + ENGINE.CLOCK_TOLERANCE_MS < think) {
      rejected.push('сумма раздумий больше, чем длилось прохождение')
    }
  }

  // Финал тоже может оказаться за обходной веткой: разрешаем узел до проверки.
  ctx.cursor = resolveNode(scenario, ctx.cursor, ctx.world).cursor
  const firedEvents = [...ctx.fired]
  const final = scenario.nodes[ctx.cursor]
  const finished = TERMINAL_TYPES.has(final?.type)
  if (!finished && !rejected.length) rejected.push('путь не доведён до финального узла')

  return build(scenario, ctx, visited, rejected, {
    stressPeak, breathCount, retryCount, finished, firedEvents,
    outcome: finished ? final : null
  })
}

function fail(scenario, ctx, visited, rejected) {
  return build(scenario, ctx, visited, rejected, {
    stressPeak: ctx.world.stress, breathCount: 0, finished: false,
    firedEvents: [...ctx.fired], outcome: null
  })
}

/** Собирает итог: шкалы, компетенции, время, балл, вердикт. */
function build(scenario, ctx, visited, rejected, extra) {
  const pairs = referencePairs(scenario)
  let sopTotal = 0
  let sopMatched = 0
  for (const v of visited) {
    if (!pairs.has(v.node)) continue
    sopTotal += 1
    if (pairs.get(v.node) === v.next) sopMatched += 1
  }

  const idealSec = idealTripSec(scenario)
  const window = tripWindow(scenario)
  const lostSec = Math.max(0, Math.round(ctx.tripSec - idealSec))
  const slack = Math.max(1, window - idealSec)
  const timeScore = Math.round(SCORE_WEIGHTS.time * clamp(1 - lostSec / slack, 0, 1))
  const sopScore = sopTotal ? Math.round(SCORE_WEIGHTS.sop * (sopMatched / sopTotal)) : 0

  const scaleScore =
    ctx.world.safety * SCORE_WEIGHTS.safety +
    ctx.world.loyalty * SCORE_WEIGHTS.loyalty +
    ctx.world.carMood * SCORE_WEIGHTS.carMood

  const competencyScore =
    Object.values(ctx.competency).reduce((s, v) => s + v, 0) * SCORE_WEIGHTS.competency

  const score = extra.finished && !rejected.length
    ? Math.round(scaleScore + competencyScore + timeScore + sopScore)
    : 0

  return {
    ok: rejected.length === 0 && extra.finished,
    rejected,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    world: { ...ctx.world, flags: [...ctx.world.flags] },
    stressPeak: extra.stressPeak,
    breathCount: extra.breathCount,
    retryCount: extra.retryCount ?? 0,
    competency: { ...ctx.competency },
    tripSec: Math.round(ctx.tripSec),
    idealSec,
    lostSec,
    window,
    overdue: ctx.tripSec > window,
    sopMatched,
    sopTotal,
    timeScore,
    sopScore,
    competencyScore: Math.round(competencyScore),
    score,
    visited,
    events: ctx.events,
    /** Индексы уже сработавших событий мира — чтобы предпросмотр их не повторил. */
    firedEvents: extra.firedEvents ?? [],
    verdict: extra.outcome?.verdict ?? (rejected.length ? 'rejected' : 'unfinished'),
    outcome: extra.outcome
      ? { text: extra.outcome.text ?? '', summary: extra.outcome.summary ?? '' }
      : null
  }
}

/** Теоретический пол по времени: эталонный путь, пройденный без единой секунды раздумья. */
export function idealTripSec(scenario) {
  const ref = scenario.reference ?? []
  let sec = 0
  for (let i = 0; i < ref.length - 1; i += 1) {
    const node = scenario.nodes[ref[i]]
    if (!node) continue
    if (MULTI_TYPES.has(node.type)) {
      for (const el of [...(node.blocks ?? []), ...(node.items ?? [])]) {
        if ((node.required ?? []).includes(el.id)) sec += el.costSec ?? 0
      }
      continue
    }
    const choice = (node.choices ?? []).find((c) => c.next === ref[i + 1])
    sec += choice?.costSec ?? 0
  }
  return Math.round(sec)
}

export { transition }
