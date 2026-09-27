/**
 * Валидатор графа сценария.
 *
 * Один и тот же модуль работает в трёх местах: в редакторе методиста (он не даст
 * опубликовать сломанный граф), на сервере при импорте (клиент не может обойти
 * проверку, отправив JSON мимо редактора) и в CI (`npm run validate`).
 * Держать три копии правил — верный способ получить три разных мнения о том,
 * что такое корректный сценарий.
 *
 * Ошибки блокируют публикацию. Предупреждения — нет: это вопросы к методике,
 * а не к формату, и решать их должен человек.
 */
import {
  MULTI_TYPES, TERMINAL_TYPES, COMPETENCY_IDS, edgesOf, elementsOf, initialWorld
} from './model.js'
import { getLine } from './line.js'
import { stems as intentStems } from './intent.js'

const KNOWN_TYPES = new Set(['dialog', 'checklist', 'radio', 'sort', 'spatial', 'outcome'])

export function validate(scenario) {
  const errors = []
  const warnings = []
  const E = (m) => errors.push(m)
  const W = (m) => warnings.push(m)

  if (scenario?.schema !== 'ekipazh-400/scenario@1') {
    E(`неизвестная схема: ${scenario?.schema ?? 'не указана'}`)
  }
  if (!scenario?.id) E('не задан id сценария')
  if (!Number.isInteger(scenario?.version) || scenario.version < 1) E('version должен быть целым от 1')
  if (!scenario?.title) E('не задан заголовок')

  const nodes = scenario?.nodes ?? {}
  const ids = new Set(Object.keys(nodes))
  if (!ids.size) E('в сценарии нет узлов')
  if (!ids.has(scenario?.entry)) E(`entry «${scenario?.entry}» не найден среди узлов`)

  // ------------------------------------------------------------- узлы
  for (const [id, node] of Object.entries(nodes)) {
    if (!KNOWN_TYPES.has(node.type)) E(`узел «${id}»: неизвестный тип «${node.type}»`)
    const isTerminal = TERMINAL_TYPES.has(node.type)
    const isMulti = MULTI_TYPES.has(node.type)

    if (!isTerminal && !isMulti && !(node.choices?.length > 0)) {
      E(`узел «${id}»: тупик — нет вариантов и это не outcome`)
    }
    if (isMulti && !node.next) E(`узел «${id}»: тип ${node.type} требует узлового next`)
    if (isMulti && !elementsOf(node).length) E(`узел «${id}»: нет ни одного элемента для выбора`)
    if (!isTerminal && !isMulti && node.next) {
      E(`узел «${id}»: у одиночного выбора переход задаётся на варианте, а не на узле`)
    }
    if (node.limitSec > 0 && !node.onTimeout) {
      E(`узел «${id}»: задан limitSec, но нет ветки onTimeout`)
    }
    if (node.requiresWorld && !node.elseGoto) {
      E(`узел «${id}»: задан requiresWorld, но нет обходной ветки elseGoto`)
    }
    if (node.elseGoto && !node.requiresWorld) {
      E(`узел «${id}»: elseGoto без requiresWorld — обход никогда не сработает`)
    }
    if (node.requiresWorld && !node.elseReason) {
      W(`узел «${id}»: обход без elseReason — игрок не поймёт, почему его перебросило`)
    }
    if (isTerminal && (node.choices?.length || node.next)) {
      E(`узел «${id}»: outcome не может иметь переходов`)
    }
    for (const target of edgesOf(node)) {
      if (!ids.has(target)) E(`узел «${id}» ссылается на несуществующий «${target}»`)
      if (target === id) E(`узел «${id}»: переход сам в себя`)
    }

    const seenIds = new Set()
    for (const el of elementsOf(node)) {
      if (!el.id) E(`узел «${id}»: элемент без id`)
      else if (seenIds.has(el.id)) E(`узел «${id}»: повторяющийся id «${el.id}»`)
      seenIds.add(el.id)
      if (!el.text) W(`узел «${id}», элемент «${el.id}»: пустой текст`)
    }
    for (const need of node.required ?? []) {
      if (!seenIds.has(need)) E(`узел «${id}»: в required указан несуществующий «${need}»`)
    }
    for (const step of node.correctOrder ?? []) {
      if (!seenIds.has(step)) E(`узел «${id}»: в correctOrder указан несуществующий «${step}»`)
    }

    const cs = node.choices ?? []
    if (cs.length > 1) {
      const shape = new Set(cs.map((c) => `${c.next}|${JSON.stringify(c.effects ?? {})}`))
      if (shape.size === 1) W(`узел «${id}»: все варианты одинаковы по исходу и эффектам`)
    }
    for (const c of cs) {
      if (typeof c.costSec !== 'number') W(`узел «${id}», вариант «${c.id}»: не задана цена в секундах`)
      if (!c.next) E(`узел «${id}», вариант «${c.id}»: не задан переход`)
    }

    // Словарь свободной речи. Без него на узле остаётся только текст варианта
    // с половинным весом, и режим «своими словами» скатывается в переспросы:
    // проводник говорит правильные вещи, а тренажёр их не узнаёт.
    // См. docs/INTENT.md; цену пропуска показывает npm run bench:intent.
    if (node.type === 'dialog' && cs.length > 1) {
      const bare = cs.filter((c) => !(c.keywords ?? []).length).map((c) => c.id)
      if (bare.length === cs.length) {
        W(`узел «${id}»: ни у одного варианта нет keywords — свободная речь на нём почти не распознаётся`)
      } else if (bare.length) {
        W(`узел «${id}»: без keywords остались варианты ${bare.join(', ')} — они проиграют тем, у кого словарь есть`)
      }
      const vocab = new Map()
      for (const c of cs) {
        for (const w of new Set((c.keywords ?? []).flatMap(intentStems))) {
          vocab.set(w, (vocab.get(w) ?? 0) + 1)
        }
      }
      for (const c of cs) {
        const own = [...new Set((c.keywords ?? []).flatMap(intentStems))]
        if (own.length && own.every((w) => vocab.get(w) === cs.length)) {
          W(`узел «${id}», вариант «${c.id}»: весь его словарь есть у всех остальных — он ничего не различает`)
        }
      }
    }
    if (node.type === 'spatial') {
      if (!node.map) E(`узел «${id}»: у spatial не указана схема (map)`)
      for (const t of node.items ?? []) {
        const bad = [t.x, t.y, t.r].some((v) => typeof v !== 'number' || v < 0 || v > 1)
        if (bad) E(`узел «${id}»: цель «${t.id}» должна иметь x, y, r в долях 0..1`)
      }
    }
  }

  // ------------------------------------------------------- достижимость
  const reached = new Set()
  const queue = [scenario?.entry]
  while (queue.length) {
    const id = queue.pop()
    if (!id || reached.has(id) || !nodes[id]) continue
    reached.add(id)
    queue.push(...edgesOf(nodes[id]))
  }
  for (const id of ids) if (!reached.has(id)) E(`узел «${id}» недостижим из entry`)

  const terminals = [...ids].filter((id) => TERMINAL_TYPES.has(nodes[id].type))
  if (!terminals.length) E('в сценарии нет ни одного узла outcome')
  const back = new Map([...ids].map((id) => [id, []]))
  for (const [id, node] of Object.entries(nodes)) {
    for (const t of edgesOf(node)) if (back.has(t)) back.get(t).push(id)
  }
  const canFinish = new Set(terminals)
  const rq = [...terminals]
  while (rq.length) {
    const id = rq.pop()
    for (const prev of back.get(id) ?? []) {
      if (!canFinish.has(prev)) {
        canFinish.add(prev)
        rq.push(prev)
      }
    }
  }
  for (const id of reached) if (!canFinish.has(id)) E(`из узла «${id}» невозможно дойти до финала`)

  // ----------------------------------------------------------- эталон
  const ref = scenario?.reference ?? []
  if (!ref.length) W('не задан эталонный путь reference — разбор рейса будет неполным')
  for (let i = 0; i < ref.length; i += 1) {
    const id = ref[i]
    if (!ids.has(id)) {
      E(`reference: узла «${id}» не существует`)
      continue
    }
    const next = ref[i + 1]
    if (next && !edgesOf(nodes[id]).includes(next)) {
      E(`reference: из «${id}» нет перехода в «${next}»`)
    }
    if (!next && !TERMINAL_TYPES.has(nodes[id].type)) {
      E(`reference: путь заканчивается на «${id}», который не является outcome`)
    }
  }
  if (ref.length && ref[0] !== scenario?.entry) {
    E('reference: эталонный путь должен начинаться со стартового узла')
  }

  // ------------------------------------------------------ компетенции
  const declared = new Set(scenario?.competencies ?? [])
  for (const k of declared) {
    if (!COMPETENCY_IDS.includes(k)) E(`неизвестная компетенция «${k}»`)
  }
  const used = new Set()
  for (const node of Object.values(nodes)) {
    for (const el of elementsOf(node)) {
      for (const k of Object.keys(el.effects?.competency ?? {})) used.add(k)
    }
    for (const k of Object.keys(node.orderBonus?.competency ?? {})) used.add(k)
  }
  for (const k of declared) if (!used.has(k)) W(`компетенция «${k}» объявлена, но нигде не начисляется`)
  for (const k of used) if (!declared.has(k)) E(`компетенция «${k}» начисляется, но не объявлена`)

  // ------------------------------------------------- регламент и рамка
  const withSop = Object.values(nodes).filter(
    (n) => n.sop || (n.choices ?? []).some((c) => c.sop)
  ).length
  if (!withSop) W('ни один узел не сослался на пункт СОП — разбор будет неубедительным')
  if (!scenario?.authoring?.assumptions) {
    W('не заполнено authoring.assumptions: допущения по регламенту должны быть названы явно')
  }

  // ------------------------------------------------------------- линия
  const ctx = scenario?.context ?? {}
  if (ctx.line) {
    const line = getLine(ctx.line)
    if (!line) {
      W(`линия «${ctx.line}» не зарегистрирована — окно рейса и километраж посчитать нечем`)
    } else {
      if (ctx.service && !line.services.some((s) => s.id === ctx.service)) {
        E(`на линии «${line.id}» нет рейса «${ctx.service}»`)
      }
      const km = ctx.startKm
      if (typeof km !== 'number' || km < 0 || km > line.lengthKm) {
        E(`startKm ${km} вне линии длиной ${line.lengthKm} км`)
      }
      // Условия по времени до остановки не должны быть невыполнимы с самого старта.
      const world = initialWorld(scenario)
      for (const node of Object.values(nodes)) {
        for (const el of elementsOf(node)) {
          const need = el.requires?.minLeadSec
          if (typeof need === 'number' && typeof world.toStopSec === 'number' && need > world.toStopSec) {
            W(
              `вариант «${el.id}» требует ${need} с до остановки, а на старте сценария их только ` +
              `${Math.round(world.toStopSec)} — он не появится ни разу`
            )
          }
        }
      }
    }
  }

  // Эталон обязан физически укладываться в окно до ближайшей остановки.
  // estimatedSec — это реальное время игрока, costSec — секунды рейса;
  // складывать их нельзя, это разные величины.
  const windowSec = (scenario?.context?.nextStop?.inMin ?? 0) * 60
  if (windowSec > 0 && ref.length > 1) {
    let worst = 0
    for (let i = 0; i < ref.length - 1; i += 1) {
      const node = nodes[ref[i]]
      if (!node) continue
      worst += node.limitSec ?? 0
      if (MULTI_TYPES.has(node.type)) {
        for (const el of elementsOf(node)) {
          if ((node.required ?? []).includes(el.id)) worst += el.costSec ?? 0
        }
      } else {
        worst += (node.choices ?? []).find((c) => c.next === ref[i + 1])?.costSec ?? 0
      }
    }
    if (worst > windowSec) {
      E(
        `эталонный путь занимает до ${worst} с рейса, а до остановки «${scenario.context.nextStop.name}» ` +
        `всего ${windowSec} с — сценарий непроходим даже идеально`
      )
    }
  }

  return { ok: errors.length === 0, errors, warnings, nodes: ids.size }
}
