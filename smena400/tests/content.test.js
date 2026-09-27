/**
 * Тесты контента.
 *
 * Движок может быть безупречным, а сценарий — приводить в тупик или иметь
 * ветвление, которое ни на что не влияет. Здесь проверяется именно это:
 * не «есть ли файл», а работает ли ситуация как ситуация.
 *
 * Отдельно проверяется дисциплина источников. Если из сценария однажды
 * исчезнет ссылка на источник или появится придуманный пункт стандарта,
 * тест это поймает — потому что в этом продукте выдуманный норматив хуже,
 * чем отсутствующая функция.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { startSession, availableActions, step, currentState } from '../engine/machine.js'
import { scaleIdsOf } from '../engine/model.js'
import { debrief } from '../engine/feedback.js'
import { validate } from '../engine/validate.js'

const DIR = 'content/scenarios'
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
const all = files.map(load)

/** Детерминированный псевдослучайный генератор: падение теста воспроизводится. */
function rng(seed) {
  let x = seed
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0
    return x / 0x1_0000_0000
  }
}

/** Прогон сценария до конца с выбором по переданной стратегии. */
function play(sc, pick) {
  let s = startSession(sc)
  let guard = 0
  while (s.status === 'active' && guard++ < 40) {
    const st = currentState(sc, s)
    const now = s.stateEnteredAt + 1000
    let out
    if (st.kind === 'sequence') {
      out = step(sc, s, { order: pick.order(st) }, { now })
    } else {
      const actions = availableActions(sc, s)
      assert.ok(actions.length, `в состоянии «${s.stateId}» нет доступных действий`)
      out = step(sc, s, { actionId: pick.action(actions, st) }, { now })
    }
    assert.equal(out.ok, true, `${sc.id}/${s.stateId}: ${out.error}`)
    s = out.session
  }
  assert.equal(s.status, 'finished', `${sc.id}: прохождение не дошло до финала`)
  return s
}

// --------------------------------------------------------------- формат

test('все сценарии проходят валидацию', () => {
  for (const sc of all) {
    const r = validate(sc)
    assert.equal(r.ok, true, `${sc.id}: ${r.errors.join('; ')}`)
  }
})

test('каждый сценарий назван, пронумерован и привязан к банку ситуаций', () => {
  for (const sc of all) {
    assert.ok(sc.source.document.includes('Ситуации на борту'), `${sc.id}: источник не банк ситуаций`)
    assert.match(sc.source.situation, /№\d+/, `${sc.id}: не указан номер ситуации`)
    assert.ok(sc.source.normative_rule.length, `${sc.id}: нет нормативной опоры`)
    assert.ok(sc.source.gameplay_interpretation.length, `${sc.id}: не отделена игровая интерпретация`)
    assert.ok(sc.source.scenario_rationale, `${sc.id}: не сказано, зачем ситуация в тренажёре`)
  }
})

test('каждое нормативное правило называет документ, из которого взято', () => {
  // Полные тексты 974-р, 989-р, 990-р и сам банк ситуаций в материалах есть,
  // поэтому ссылаться можно и нужно. Правило без источника — утверждение
  // без основания, а в тренажёре это опаснее отсутствующей функции.
  const DOCS = /СТО РЖД|974|989|990|Ситуации на борту|банк/i
  for (const sc of all) {
    for (const [i, rule] of sc.source.normative_rule.entries()) {
      assert.match(rule, DOCS, `${sc.id}: normative_rule[${i}] без источника`)
    }
  }
})

test('нормативно помеченные действия ссылаются на существующее правило', () => {
  for (const sc of all) {
    for (const [sid, st] of Object.entries(sc.states)) {
      for (const a of st.actions ?? []) {
        if (!a.normative) continue
        assert.ok(
          sc.source.normative_rule[a.normative_ref],
          `${sc.id}/${sid}/${a.id}: normative_ref указывает в пустоту`
        )
      }
    }
  }
})

test('ситуации, заявленные в инвентаризации банка, действительно реализованы', () => {
  const bank = JSON.parse(fs.readFileSync('content/situations.json', 'utf8'))
  const declared = bank.situations.filter((s) => s.in_mvp)
  assert.equal(declared.length, all.length, 'число заявленных и реализованных сценариев не совпало')
  for (const s of declared) {
    const sc = all.find((x) => x.id === s.scenario_id)
    assert.ok(sc, `ситуация №${s.no} заявлена в MVP, но сценария ${s.scenario_id} нет`)
    assert.ok(sc.source.situation.includes(String(s.no)), `${sc.id}: номер ситуации не совпадает с банком`)
  }
})

// ------------------------------------------------------------- механика

test('каждый сценарий проходится до финала при любых случайных решениях', () => {
  // Самая полезная проверка на тупики: обход графа доказывает, что путь
  // существует, а это — что игрок не может застрять, как бы ни ходил.
  for (const sc of all) {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed * 7919)
      play(sc, {
        action: (actions) => actions[Math.floor(r() * actions.length)].id,
        order: (st) => [...st.correct_order].sort(() => r() - 0.5)
      })
    }
  }
})

test('в каждом сценарии стратегии расходятся по финалу и по шкалам', () => {
  // Если бы исход не зависел от решений, продукт не имел бы смысла.
  for (const sc of all) {
    const best = play(sc, {
      action: (actions, st) => bestBy(sc, st, actions, +1),
      order: (st) => st.correct_order
    })
    const worst = play(sc, {
      action: (actions, st) => bestBy(sc, st, actions, -1),
      order: (st) => [...st.correct_order].reverse()
    })
    assert.notEqual(best.outcome, worst.outcome, `${sc.id}: разные стратегии дали один финал`)
    const sum = (x) => scaleIdsOf(sc).reduce((n, id) => n + x.scales[id], 0)
    assert.ok(sum(best) > sum(worst), `${sc.id}: показатели не различают стратегии`)
  }
})

/** Жадный выбор по сумме изменений шкал: +1 — лучшее, −1 — худшее. */
function bestBy(sc, st, actions, sign) {
  const full = (st.actions ?? []).filter((a) => actions.some((x) => x.id === a.id))
  let pick = full[0]
  let score = -Infinity
  for (const a of full) {
    const v = sign * scaleIdsOf(sc).reduce((n, id) => n + (a.effects?.[id] ?? 0), 0)
    if (v > score) {
      score = v
      pick = a
    }
  }
  return pick.id
}

test('в каждом сценарии есть решение, которое разводит показатели в разные стороны', () => {
  // Два показателя имеют смысл только там, где они расходятся. Если в сценарии
  // нет ни одного такого действия, второго показателя там фактически нет.
  // Какая это пара — решает сам сценарий, поэтому берём её из паспорта.
  for (const sc of all) {
    const [a1, a2] = scaleIdsOf(sc)
    let found = false
    for (const st of Object.values(sc.states)) {
      for (const a of st.actions ?? []) {
        if ((a.effects?.[a1] ?? 0) * (a.effects?.[a2] ?? 0) < 0) found = true
      }
    }
    assert.ok(found, `${sc.id}: показатели ${a1} и ${a2} нигде не расходятся`)
  }
})

test('отложенное последствие в каждом сценарии действительно срабатывает', () => {
  for (const sc of all) {
    let fired = false
    for (let seed = 1; seed <= 60 && !fired; seed++) {
      const r = rng(seed * 104729)
      const s = play(sc, {
        action: (actions) => actions[Math.floor(r() * actions.length)].id,
        order: (st) => [...st.correct_order].sort(() => r() - 0.5)
      })
      if (s.log.some((l) => l.type === 'deferred')) fired = true
    }
    assert.ok(fired, `${sc.id}: ни одно отложенное последствие не сработало ни разу`)
  }
})

test('разбор каждого сценария содержит всё, что обещано пользователю', () => {
  for (const sc of all) {
    const s = play(sc, {
      action: (actions, st) => bestBy(sc, st, actions, -1),
      order: (st) => [...st.correct_order].reverse()
    })
    const d = debrief(sc, s)
    assert.ok(d.outcome.text, `${sc.id}: нет текста финала`)
    assert.ok(d.outcome.summary, `${sc.id}: нет объяснения итога`)
    assert.equal(d.scales.length, 2)
    assert.ok(d.timeline.length, `${sc.id}: пустая лента прохождения`)
    assert.ok(d.decisions.length, `${sc.id}: нет ключевых решений`)
    assert.ok(
      d.decisions.some((x) => x.alternative),
      `${sc.id}: ни у одного ключевого решения нет альтернативы`
    )
    assert.ok(d.improvements.length, `${sc.id}: разбор ничего не предлагает улучшить`)
    assert.ok(
      d.competency.some((c) => c.touched),
      `${sc.id}: сценарий не проверил ни одной компетенции`
    )
  }
})

// ------------------------------------------------------ свободная речь

/**
 * Контрольные реплики: как проводник сказал бы это вслух.
 *
 * Набор небольшой сознательно — это проверка, что режим работает на реальных
 * формулировках, а не замер качества распознавания. Пополняется вместе
 * со словарями действий.
 */
const PHRASES = [
  ['sit-19-medical', 's-alarm', 'нажму кнопку связи и доложу начальнику поезда', 'a-report'],
  ['sit-19-medical', 's-alarm', 'подойду к пассажиру, посмотрю что с ним', 'a-assess'],
  ['sit-19-medical', 's-alarm', 'попрошу её не кричать и не пугать вагон', 'a-calm'],
  ['sit-19-medical', 's-lnp', 'вагон четыре, место 14В, мужчина без сознания, дыхание есть', 'a-detail'],

  ['sit-20-smoking', 's-notice', 'подойду и негромко скажу ему одному', 'a-aside'],
  ['sit-20-smoking', 's-notice', 'сделаю замечание громко, чтобы слышал весь вагон', 'a-public'],
  ['sit-20-smoking', 's-notice', 'вызову наряд транспортной безопасности', 'a-escalate-now'],
  ['sit-20-smoking', 's-denial', 'объясню, что запрет распространяется и на электронные', 'a-scope'],

  ['sit-16-equipment', 's-socket', 'проверю весь блок, не только розетку', 'a-check-block'],
  ['sit-16-equipment', 's-socket', 'предложу пересесть на свободное место', 'a-move'],
  ['sit-16-equipment', 's-block', 'доложу про весь блок и отдельно про кнопку вызова', 'a-report-full'],

  ['sit-41-unattended', 's-report', 'сообщу по радиосвязи начальнику поезда и птб', 'a-radio'],
  ['sit-41-unattended', 's-report', 'открою сумку и посмотрю что внутри', 'a-look-inside'],
  ['sit-41-unattended', 's-crowd', 'попрошу пассажиров не приближаться к предмету', 'a-announce'],

  ['sit-06-intoxicated', 's-notice', 'подойду и попрошу соблюдать спокойствие', 'a-calm-request'],
  ['sit-06-intoxicated', 's-notice', 'вызову по рации: нужна помощь в шестом вагоне', 'a-radio-neutral'],
  ['sit-06-intoxicated', 's-notice', 'скажу по рации что у меня пьяный пассажир', 'a-radio-open']
]

test('свободные реплики относятся к тем действиям, которые имелись в виду', () => {
  for (const [id, stateId, said, want] of PHRASES) {
    const sc = all.find((x) => x.id === id)
    const s = { ...startSession(sc), stateId }
    const out = step(sc, s, { said }, { now: s.stateEnteredAt + 2000 })
    const got = out.ok ? out.result.actionId : `отказ: ${out.code}`
    assert.equal(got, want, `«${said}» → ${got}`)
  }
})

test('невнятная реплика не выполняет действие и объясняет причину', () => {
  const sc = all.find((x) => x.id === 'sit-20-smoking')
  const s = startSession(sc)
  for (const said of ['ну как-то так', 'посмотрим по ситуации', 'не знаю даже']) {
    const out = step(sc, s, { said }, { now: s.stateEnteredAt + 1000 })
    assert.equal(out.ok, false, `«${said}» не должно было сработать`)
    assert.equal(out.code, 'unclear')
  }
})
