/**
 * Разбор прохождения.
 *
 * Главное правило продукта живёт здесь: разбор не говорит «правильный ответ — Б».
 * Он говорит, что сделал игрок, к чему это привело и как ситуация развивалась
 * бы иначе. Разница принципиальная. Первая формулировка учит запоминать ответ,
 * вторая — видеть последствие, а видеть последствие и есть цель тренажёра.
 *
 * Поэтому вся альтернатива берётся не из головы движка, а из самого графа:
 * это настоящая, описанная автором сценария ветка, по которой ситуация
 * действительно пошла бы. Мы ничего не досочиняем — мы показываем соседнее
 * ребро и его последствие.
 */
import { COMPETENCIES, VERDICTS, scalesOf } from './model.js'

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Полный разбор: итог, шкалы, ключевые решения, сильные стороны,
 * зоны улучшения, компетенции и альтернативное развитие.
 */
export function debrief(scenario, session) {
  const finalState = scenario.states?.[session.outcome] ?? null
  const start = scenario.initial_state ?? {}

  const actions = session.log.filter((l) => l.type === 'action')
  const events = session.log.filter((l) => l.type === 'event' || l.type === 'deferred')

  return {
    scenario: {
      id: scenario.id,
      title: scenario.title,
      source: scenario.source
    },
    outcome: {
      stateId: session.outcome,
      verdict: finalState?.verdict ?? 'mixed',
      title: VERDICTS[finalState?.verdict]?.title ?? 'Ситуация завершена',
      text: finalState?.text ?? '',
      summary: finalState?.summary ?? ''
    },
    scales: scalesOf(scenario).map((s) => {
      const from = num(start[s.id] ?? (s.id === 'safety' ? 80 : 60))
      const to = num(session.scales[s.id])
      return { id: s.id, title: s.title, short: s.short, from, to, delta: to - from }
    }),
    timeline: timeline(session),
    decisions: keyDecisions(scenario, session),
    consequences: events.map((e) => ({
      note: e.note,
      effects: e.effects,
      delayed: e.type === 'deferred',
      causeLabel: e.causeLabel ?? null,
      late: Boolean(e.late)
    })),
    strengths: strengths(scenario, session, actions),
    improvements: improvements(scenario, session, actions, events),
    competency: competencyReport(scenario, session, actions),
    steps: actions.length
  }
}

/** Лента прохождения в том порядке, в каком всё происходило. */
function timeline(session) {
  return session.log.map((l) =>
    l.type === 'action'
      ? {
          type: 'action',
          step: l.step,
          stateText: l.stateText,
          label: l.actionLabel,
          said: l.said,
          intent: l.intent,
          kind: l.kind,
          effects: l.effects,
          scalesAfter: l.scalesAfter,
          consequence: l.consequence,
          normative: l.normative,
          timedOut: l.timedOut,
          thinkMs: l.thinkMs
        }
      : {
          type: l.type,
          step: l.step,
          note: l.note,
          effects: l.effects,
          scalesAfter: l.scalesAfter,
          causeLabel: l.causeLabel ?? null,
          late: Boolean(l.late)
        }
  )
}

/**
 * Ключевые решения и то, как пошла бы ситуация при другом выборе.
 *
 * Альтернатива берётся среди тех действий, которые в тот момент были доступны
 * игроку на самом деле (движок записал этот список в журнал). Предлагать
 * в разборе ветку, которой у человека не было, — обман.
 *
 * Выбирается не «правильная» альтернатива, а самая контрастная: та, что
 * сильнее всего расходится с выбранной по сумме изменений шкал. Именно
 * контраст показывает, что решение вообще имело значение.
 */
function keyDecisions(scenario, session) {
  const out = []
  for (const entry of pickKey(session)) {
    const state = scenario.states?.[entry.stateId]
    const siblings = (state?.actions ?? []).filter(
      (a) => a.id !== entry.actionId && (entry.offered ?? []).includes(a.id)
    )

    const chosenSum = num(entry.effects?.loyalty) + num(entry.effects?.safety)
    let alt = null
    let bestGap = -1
    for (const s of siblings) {
      const sum = num(s.effects?.loyalty) + num(s.effects?.safety)
      const gap = Math.abs(sum - chosenSum)
      if (gap > bestGap) {
        bestGap = gap
        alt = s
      }
    }

    out.push({
      step: entry.step,
      situation: entry.stateText,
      chosen: {
        label: entry.actionLabel,
        said: entry.said,
        effects: entry.effects,
        consequence: entry.consequence,
        timedOut: entry.timedOut
      },
      alternative: alt
        ? {
            label: alt.label,
            effects: alt.effects ?? {},
            consequence: alt.consequence ?? null,
            outcome_hint: alt.alt_hint ?? null
          }
        : null
    })
  }
  return out
}

/**
 * Что получилось хорошо.
 *
 * Источников два: правила, написанные автором сценария, и общие признаки,
 * которые движок выводит из журнала. Авторские правила точнее, поэтому идут
 * первыми; общие нужны, чтобы разбор не был пустым, если автор поленился.
 */
function strengths(scenario, session, actions) {
  const out = ruleTexts(scenario, session, 'strength')

  for (const a of actions) {
    if (a.timedOut) continue
    const safety = num(a.effects?.safety)
    const loyalty = num(a.effects?.loyalty)
    if (a.normative && safety > 0) {
      out.push({
        text: `«${a.actionLabel}» — действие с опорой на требование стандарта. Безопасность выросла на ${safety}.`,
        step: a.step
      })
    } else if (safety > 0 && loyalty > 0) {
      out.push({
        text: `«${a.actionLabel}» — редкий случай, когда обе шкалы пошли вверх: и человек остался доволен, и ситуация стала безопаснее.`,
        step: a.step
      })
    } else if (loyalty >= 6) {
      out.push({
        text: `«${a.actionLabel}» заметно улучшило отношение пассажира (+${loyalty}).`,
        step: a.step
      })
    }
  }
  return dedupe(out).slice(0, 4)
}

/**
 * Что можно улучшить.
 *
 * Формулировки причинно-следственные, без оценочных ярлыков. Отложенное
 * последствие показывается вместе со своей причиной — ради этого связь
 * и хранилась в журнале.
 */
function improvements(scenario, session, actions, events) {
  const out = ruleTexts(scenario, session, 'improvement')

  for (const a of actions) {
    if (a.timedOut) {
      out.push({
        text: `На шаге ${a.step} решение не было принято вовремя. Ситуация развивалась дальше без вас — это тоже исход, и обычно не тот, который нужен.`,
        step: a.step
      })
      continue
    }
    const safety = num(a.effects?.safety)
    const loyalty = num(a.effects?.loyalty)
    if (safety < 0 && loyalty > 0) {
      out.push({
        text: `«${a.actionLabel}» сняло напряжение (лояльность +${loyalty}), но безопасность просела на ${Math.abs(safety)}. Это самый частый размен в работе и самый дорогой.`,
        step: a.step
      })
    } else if (safety <= -5) {
      out.push({
        text: `«${a.actionLabel}» стоило ${Math.abs(safety)} пунктов безопасности.`,
        step: a.step
      })
    } else if (loyalty <= -6) {
      out.push({
        text: `«${a.actionLabel}» испортило отношение пассажира на ${Math.abs(loyalty)}. Результата это не отменяет, но осадок остался у человека, а не у регламента.`,
        step: a.step
      })
    }
  }

  for (const e of events) {
    if (e.type !== 'deferred') continue
    const sum = num(e.effects?.safety) + num(e.effects?.loyalty)
    if (sum >= 0) continue
    out.push({
      text: e.causeLabel
        ? `Последствие пришло не сразу: «${e.causeLabel}» аукнулось через несколько шагов. ${e.note ?? ''}`.trim()
        : e.note,
      step: e.step
    })
  }

  const list = dedupe(out).slice(0, 4)

  /*
   * Прохождение без единой ошибки — не повод показать пустой раздел.
   * Человеку, который прошёл ситуацию идеально, полезнее всего увидеть,
   * что было бы при другом решении: именно это возвращает его к повторному
   * прохождению, ради которого продукт и сделан.
   */
  if (!list.length) {
    const key = keyDecisions(scenario, session).find((d) => d.alternative)
    list.push({
      text: key
        ? `Улучшать нечего: ситуация закрыта без потерь. Если хотите увидеть, ` +
          `насколько она хрупкая, пройдите заново и вместо «${key.chosen.label}» ` +
          `выберите «${key.alternative.label}» — дальше всё пойдёт иначе.`
        : 'Улучшать нечего: ситуация закрыта без потерь. Попробуйте пройти её другой стратегией и сравнить.',
      step: key?.step ?? null,
      authored: false
    })
  }
  return list
}

/** Правила разбора, написанные автором сценария под конкретные флаги. */
function ruleTexts(scenario, session, kind) {
  const flags = new Set(session.flags)
  const out = []
  for (const r of scenario.feedback_rules ?? []) {
    if (r.kind !== kind) continue
    if (r.when_flag && !flags.has(r.when_flag)) continue
    if (r.unless_flag && flags.has(r.unless_flag)) continue
    if (r.when_outcome && r.when_outcome !== session.outcome) continue
    out.push({ text: r.text, step: null, authored: true })
  }
  return out
}

/**
 * Какие решения разбирать подробно.
 *
 * Обычно это те, что автор сценария пометил ключевыми. Но худшее прохождение
 * часто идёт мимо всех помеченных развилок — а именно такому игроку
 * альтернатива нужнее всего. Поэтому если ключевых решений не набралось,
 * берутся те, что сильнее всего сдвинули шкалы: разбор без единой
 * альтернативы бесполезен.
 */
function pickKey(session) {
  const actions = session.log.filter((l) => l.type === 'action')
  const marked = actions.filter((l) => l.key)
  if (marked.length) return marked

  const weight = (l) =>
    Math.abs(num(l.effects?.loyalty)) + Math.abs(num(l.effects?.safety))
  return [...actions]
    .sort((a, b) => weight(b) - weight(a))
    .slice(0, 2)
    .sort((a, b) => a.step - b.step)
}

const dedupe = (list) => {
  const seen = new Set()
  return list.filter((i) => {
    if (!i.text || seen.has(i.text)) return false
    seen.add(i.text)
    return true
  })
}

/**
 * Компетенции — из истории действий, а не из отдельного теста.
 *
 * Считается доля от того, что было достижимо **на этом прохождении**:
 * для каждого решения берётся лучший вклад среди действий, которые игроку
 * реально предлагались. Сравнивать с абсолютным потолком графа было бы
 * нечестно — часть веток человек закрыл своими же более ранними решениями.
 */
function competencyReport(scenario, session, actions) {
  const earned = {}
  const max = {}
  for (const c of COMPETENCIES) {
    earned[c.id] = 0
    max[c.id] = 0
  }

  for (const a of actions) {
    const state = scenario.states?.[a.stateId]
    const offered = (state?.actions ?? []).filter((x) => (a.offered ?? []).includes(x.id))
    for (const c of COMPETENCIES) {
      earned[c.id] += num(a.competency?.[c.id])
      const best = Math.max(0, ...offered.map((x) => num(x.competency?.[c.id])))
      max[c.id] += best
    }
  }

  return COMPETENCIES.map((c) => {
    const e = earned[c.id]
    const m = max[c.id]
    return {
      id: c.id,
      title: c.title,
      hint: c.hint,
      earned: e,
      max: m,
      // Компетенция, которую сценарий вообще не проверял, не показывается
      // как «ноль из ста»: это была бы ложь о человеке.
      touched: m > 0,
      pct: m > 0 ? Math.max(0, Math.min(100, Math.round((e / m) * 100))) : null
    }
  })
}

/**
 * Сравнение двух попыток.
 *
 * Сложной системы сравнения не нужно: достаточно показать, что изменилось
 * в шкалах, в финале и в ключевых решениях. Именно эта разница и доказывает
 * игроку, что результат зависел от него.
 */
export function compareAttempts(previous, current) {
  // Сравниваем по показателям той попытки, что разбираем: сценарий мог
  // объявить свою пару, и брать её из кода было бы неверно.
  const scaleDiff = current.scales.map((s) => {
    const before = previous.scales.find((x) => x.id === s.id)?.to ?? s.from
    return { id: s.id, title: s.title, short: s.short, before, after: s.to, delta: s.to - before }
  })

  const prevByStep = new Map(previous.decisions.map((d) => [d.step, d.chosen.label]))
  const changed = current.decisions
    .filter((d) => prevByStep.has(d.step) && prevByStep.get(d.step) !== d.chosen.label)
    .map((d) => ({
      step: d.step,
      situation: d.situation,
      before: prevByStep.get(d.step),
      after: d.chosen.label
    }))

  return {
    scales: scaleDiff,
    outcomeChanged: previous.outcome.stateId !== current.outcome.stateId,
    outcomeBefore: previous.outcome.title,
    outcomeAfter: current.outcome.title,
    changedDecisions: changed
  }
}
