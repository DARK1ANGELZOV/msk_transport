/**
 * Тесты ядра.
 *
 * Проверяется не «работает ли вообще», а те свойства, на которых держится
 * доверие к продукту: движок применяет только то, что написано в сценарии;
 * интерфейс не может выполнить запрещённое действие; истечение времени —
 * полноценный исход; отложенное последствие приходит тогда, когда должно.
 *
 * Часть сценария намеренно собрана прямо здесь, а не взята из content/:
 * тест движка не должен падать оттого, что методист поправил формулировку.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  startSession, availableActions, step, currentState, remainingMs, CLOCK_GRACE_MS
} from '../engine/machine.js'
import { debrief, compareAttempts } from '../engine/feedback.js'
import { validate } from '../engine/validate.js'

// ---------------------------------------------------------------- стенд

/** Маленький сценарий-стенд: ровно то, что нужно для проверки механики. */
const rig = () => ({
  schema: 'smena400/scenario@1',
  id: 'rig',
  version: 1,
  title: 'Стенд',
  source: {
    document: 'тест', situation: 'тест', source_reference: 'тест',
    normative_rule: ['правило'], gameplay_interpretation: ['интерпретация'],
    scenario_rationale: 'проверка движка'
  },
  context: { available_resources: ['связь'] },
  initial_state: { loyalty: 50, safety: 50, flags: [] },
  entry: 's1',
  states: {
    s1: {
      kind: 'decision',
      text: 'Начало',
      timer_sec: 10,
      free_text: true,
      actions: [
        {
          id: 'a-good', label: 'Доложить по связи', key: true,
          requires_resource: 'связь',
          keywords: ['доложить', 'связь', 'начальник поезда'],
          effects: { safety: 10, loyalty: 2 },
          competency: { safety: 3, communication: 2 },
          set_flags: ['reported'],
          consequence: 'Доклад ушёл.',
          next: 's2'
        },
        {
          id: 'a-bad', label: 'Ничего не делать и смотреть', key: true,
          keywords: ['смотреть', 'наблюдать', 'ждать'],
          effects: { safety: -8, loyalty: 4 },
          competency: { safety: -2 },
          consequence: 'Время идёт.',
          deferred: [{
            id: 'boom', after_steps: 2, effects: { safety: -5 },
            note: 'Отложенное последствие сработало.'
          }],
          next: 's2'
        },
        {
          id: 'a-locked', label: 'Действие, требующее недоступного ресурса',
          requires_resource: 'вертолёт',
          effects: {}, next: 's2'
        }
      ],
      on_timeout: {
        label: 'Время вышло',
        effects: { safety: -6, loyalty: -6 },
        competency: { decision: -3 },
        consequence: 'Решение не принято.',
        next: 's2'
      }
    },
    s2: {
      kind: 'decision',
      text: 'Развилка по флагу',
      actions: [
        {
          id: 'a-next', label: 'Дальше', effects: {},
          next_when: [{ flag: 'reported', state: 's3' }],
          next: 's-seq'
        },
        { id: 'a-fix', label: 'Исправиться', effects: { safety: 3 }, cancel_deferred: ['boom'], next: 's3' }
      ]
    },
    's-seq': {
      kind: 'sequence',
      text: 'Порядок',
      items: [{ id: 'i1', label: 'Первое' }, { id: 'i2', label: 'Второе' }],
      correct_order: ['i1', 'i2'],
      on_submit: {
        correct: { effects: { safety: 5 }, competency: { prioritization: 3 }, consequence: 'Верно.', next: 's3' },
        partial: { effects: { safety: 2 }, consequence: 'Почти.', next: 's3' },
        wrong: { effects: { safety: -3 }, competency: { prioritization: -2 }, consequence: 'Не тот порядок.', next: 's3' }
      }
    },
    s3: {
      kind: 'decision',
      text: 'Финальный выбор',
      on_enter: [{ when_flag: 'reported', effects: { loyalty: 2 }, note: 'Событие входа сработало.' }],
      actions: [
        { id: 'a-end-good', label: 'Хорошо', effects: { loyalty: 5 }, consequence: 'Ок.', next: 'f-good' },
        { id: 'a-end-bad', label: 'Плохо', effects: { loyalty: -5 }, consequence: 'Не ок.', next: 'f-bad' }
      ]
    },
    'f-good': { kind: 'final', verdict: 'good', text: 'Хороший финал', summary: 'Итог' },
    'f-bad': { kind: 'final', verdict: 'bad', text: 'Плохой финал', summary: 'Итог' }
  }
})

const at = (session, shift) => session.stateEnteredAt + shift

// ------------------------------------------------------------- состояние

test('сессия начинается в стартовом состоянии с начальными шкалами', () => {
  const s = startSession(rig(), { now: 1000 })
  assert.equal(s.stateId, 's1')
  assert.equal(s.scales.loyalty, 50)
  assert.equal(s.scales.safety, 50)
  assert.equal(s.status, 'active')
  assert.equal(s.log.length, 0)
})

test('действие, требующее недоступного ресурса, игроку не предлагается', () => {
  // Прямая реализация требования из материалов: не предлагать действие,
  // которое невозможно выполнить с учётом оснащения вагона.
  const sc = rig()
  const s = startSession(sc)
  const ids = availableActions(sc, s).map((a) => a.id)
  assert.deepEqual(ids, ['a-good', 'a-bad'])
  assert.ok(!ids.includes('a-locked'))
})

test('эффекты берутся из сценария, а не выводятся движком', () => {
  const sc = rig()
  const s = startSession(sc)
  const out = step(sc, s, { actionId: 'a-good' }, { now: at(s, 2000) })
  assert.equal(out.ok, true)
  assert.equal(out.session.scales.safety, 60)
  assert.equal(out.session.scales.loyalty, 52)
  assert.deepEqual(out.result.effects, { safety: 10, loyalty: 2 })
})

test('шкалы не выходят за границы', () => {
  const sc = rig()
  sc.initial_state.safety = 95
  const s = startSession(sc)
  const out = step(sc, s, { actionId: 'a-good' }, { now: at(s, 1000) })
  assert.equal(out.session.scales.safety, 100)
})

// --------------------------------------------------------------- защита

test('действие из другого состояния отклоняется', () => {
  const sc = rig()
  const s = startSession(sc)
  const out = step(sc, s, { actionId: 'a-end-good' }, { now: at(s, 1000) })
  assert.equal(out.ok, false)
  assert.equal(out.code, 'not-allowed')
})

test('несуществующее действие отклоняется', () => {
  const sc = rig()
  const s = startSession(sc)
  const out = step(sc, s, { actionId: 'a-нет-такого' }, { now: at(s, 1000) })
  assert.equal(out.ok, false)
  assert.equal(out.code, 'not-allowed')
})

test('заблокированное ресурсом действие нельзя выполнить, даже зная его идентификатор', () => {
  // Именно эта проверка означает, что интерфейсу не нужно доверять.
  const sc = rig()
  const s = startSession(sc)
  const out = step(sc, s, { actionId: 'a-locked' }, { now: at(s, 1000) })
  assert.equal(out.ok, false)
  assert.equal(out.code, 'not-allowed')
})

test('в завершённой сессии ходить нельзя', () => {
  const sc = rig()
  let s = startSession(sc)
  s = step(sc, s, { actionId: 'a-good' }, { now: at(s, 1000) }).session
  s = step(sc, s, { actionId: 'a-next' }, { now: at(s, 1000) }).session
  s = step(sc, s, { actionId: 'a-end-good' }, { now: at(s, 1000) }).session
  assert.equal(s.status, 'finished')
  const out = step(sc, s, { actionId: 'a-end-bad' }, { now: at(s, 1000) })
  assert.equal(out.ok, false)
  assert.equal(out.code, 'finished')
})

// --------------------------------------------------------------- таймер

test('истечение времени — отдельный исход со своими эффектами', () => {
  const sc = rig()
  const s = startSession(sc)
  const out = step(sc, s, { timeout: true }, { now: at(s, 10_000 + CLOCK_GRACE_MS + 1) })
  assert.equal(out.ok, true)
  assert.equal(out.result.timedOut, true)
  assert.equal(out.session.scales.safety, 44)
  assert.equal(out.session.stateId, 's2')
  const entry = out.session.log.at(-1)
  assert.equal(entry.kind, 'idle')
  assert.equal(entry.timedOut, true)
})

test('опоздавшее действие не выполняется — вместо него бездействие', () => {
  // Иначе таймер можно было бы обойти, отправив решение с задержкой.
  const sc = rig()
  const s = startSession(sc)
  const out = step(sc, s, { actionId: 'a-good' }, { now: at(s, 10_000 + CLOCK_GRACE_MS + 1) })
  assert.equal(out.ok, true)
  assert.equal(out.result.timedOut, true)
  assert.equal(out.session.scales.safety, 44, 'применились эффекты бездействия, а не выбранного действия')
})

test('досрочно объявить истечение времени нельзя', () => {
  const sc = rig()
  const s = startSession(sc)
  const out = step(sc, s, { timeout: true }, { now: at(s, 3000) })
  assert.equal(out.ok, false)
  assert.equal(out.code, 'not-expired')
})

test('решение на границе запаса засчитывается как своевременное', () => {
  const sc = rig()
  const s = startSession(sc)
  const out = step(sc, s, { actionId: 'a-good' }, { now: at(s, 10_000 + CLOCK_GRACE_MS - 1) })
  assert.equal(out.result.timedOut, false)
})

test('остаток времени считается от входа в состояние', () => {
  const sc = rig()
  const s = startSession(sc)
  assert.equal(remainingMs(sc, s, at(s, 0)), 10_000)
  assert.equal(remainingMs(sc, s, at(s, 4000)), 6000)
  assert.equal(remainingMs(sc, s, at(s, 99_000)), 0)
})

// ------------------------------------------------- отложенные последствия

test('отложенное последствие приходит через заданное число шагов, а не сразу', () => {
  const sc = rig()
  let s = startSession(sc)
  s = step(sc, s, { actionId: 'a-bad' }, { now: at(s, 1000) }).session
  assert.equal(s.scales.safety, 42, 'сразу применился только эффект самого действия')
  assert.equal(s.deferred.length, 1)

  s = step(sc, s, { actionId: 'a-next' }, { now: at(s, 1000) }).session
  assert.equal(s.scales.safety, 42, 'через один шаг ещё рано')

  const out = step(sc, s, { order: ['i1', 'i2'] }, { now: at(s, 1000) })
  s = out.session
  // +5 за верный порядок, −5 за созревшее последствие.
  assert.equal(s.scales.safety, 42)
  const fired = s.log.filter((l) => l.type === 'deferred')
  assert.equal(fired.length, 1)
  assert.match(fired[0].note, /Отложенное последствие/)
})

test('последствие можно отменить, если игрок успел исправиться', () => {
  const sc = rig()
  let s = startSession(sc)
  s = step(sc, s, { actionId: 'a-bad' }, { now: at(s, 1000) }).session
  s = step(sc, s, { actionId: 'a-fix' }, { now: at(s, 1000) }).session
  assert.equal(s.deferred.length, 0, 'последствие снято')
  s = step(sc, s, { actionId: 'a-end-good' }, { now: at(s, 1000) }).session
  assert.equal(s.log.filter((l) => l.type === 'deferred').length, 0)
})

test('несработавшее последствие всё равно проявляется в финале', () => {
  // Последствие не имеет права потеряться оттого, что ситуация кончилась
  // раньше: иначе продукт научил бы, что «пронесло» — рабочая стратегия.
  const sc = rig()
  let s = startSession(sc)
  s = step(sc, s, { actionId: 'a-bad' }, { now: at(s, 1000) }).session
  s = step(sc, s, { actionId: 'a-next' }, { now: at(s, 1000) }).session
  s = step(sc, s, { order: ['i2', 'i1'] }, { now: at(s, 1000) }).session
  s = step(sc, s, { actionId: 'a-end-good' }, { now: at(s, 1000) }).session
  assert.equal(s.status, 'finished')
  assert.equal(s.deferred.length, 0, 'очередь пуста — всё сработало')
})

// ------------------------------------------------------------ переходы

test('условный переход выбирает ветку по флагу', () => {
  const sc = rig()
  let withFlag = startSession(sc)
  withFlag = step(sc, withFlag, { actionId: 'a-good' }, { now: at(withFlag, 1000) }).session
  withFlag = step(sc, withFlag, { actionId: 'a-next' }, { now: at(withFlag, 1000) }).session
  assert.equal(withFlag.stateId, 's3', 'флаг reported увёл на другую ветку')

  let without = startSession(sc)
  without = step(sc, without, { actionId: 'a-bad' }, { now: at(without, 1000) }).session
  without = step(sc, without, { actionId: 'a-next' }, { now: at(without, 1000) }).session
  assert.equal(without.stateId, 's-seq')
})

test('событие входа срабатывает при выполнении условия', () => {
  const sc = rig()
  let s = startSession(sc)
  s = step(sc, s, { actionId: 'a-good' }, { now: at(s, 1000) }).session
  const out = step(sc, s, { actionId: 'a-next' }, { now: at(s, 1000) })
  const events = out.result.events.filter((e) => e.type === 'event')
  assert.equal(events.length, 1)
  assert.match(events[0].note, /Событие входа/)
})

// ------------------------------------------------- последовательность

test('последовательность оценивается по тому, что сделано первым', () => {
  const sc = rig()
  const base = () => {
    let s = startSession(sc)
    s = step(sc, s, { actionId: 'a-bad' }, { now: at(s, 1000) }).session
    return step(sc, s, { actionId: 'a-next' }, { now: at(s, 1000) }).session
  }
  const right = step(sc, base(), { order: ['i1', 'i2'] }, { now: Date.now() + 1 })
  assert.equal(right.result.grade, 'correct')

  const wrong = step(sc, base(), { order: ['i2', 'i1'] }, { now: Date.now() + 1 })
  assert.equal(wrong.result.grade, 'wrong')
})

test('неполная или повторяющаяся последовательность отклоняется', () => {
  const sc = rig()
  let s = startSession(sc)
  s = step(sc, s, { actionId: 'a-bad' }, { now: at(s, 1000) }).session
  s = step(sc, s, { actionId: 'a-next' }, { now: at(s, 1000) }).session
  assert.equal(step(sc, s, { order: ['i1'] }, { now: Date.now() }).code, 'not-allowed')
  assert.equal(step(sc, s, { order: ['i1', 'i1'] }, { now: Date.now() }).code, 'not-allowed')
  assert.equal(step(sc, s, { order: ['i1', 'нет'] }, { now: Date.now() }).code, 'not-allowed')
})

// ----------------------------------------------------- свободная реплика

test('свободная реплика относится к действию и выполняет его', () => {
  const sc = rig()
  const s = startSession(sc)
  const out = step(sc, s, { said: 'доложу начальнику поезда по связи' }, { now: at(s, 2000) })
  assert.equal(out.ok, true)
  assert.equal(out.result.actionId, 'a-good')
  assert.equal(out.session.log.at(-1).said, 'доложу начальнику поезда по связи')
})

test('непонятная реплика не выполняет ничего и объясняет почему', () => {
  const sc = rig()
  const s = startSession(sc)
  const out = step(sc, s, { said: 'ну как-то так' }, { now: at(s, 2000) })
  assert.equal(out.ok, false)
  assert.equal(out.code, 'unclear')
  assert.ok(out.intent, 'разбор возвращается для объяснения игроку')
  assert.equal(out.session, undefined, 'состояние не изменилось')
})

test('репликой нельзя выполнить действие, недоступное по ресурсам', () => {
  const sc = rig()
  const s = startSession(sc)
  const out = step(sc, s, { said: 'вызову вертолёт, действие требующее недоступного ресурса' }, { now: at(s, 1000) })
  assert.notEqual(out.result?.actionId, 'a-locked')
})

test('свободная реплика там, где она не предусмотрена, отклоняется', () => {
  const sc = rig()
  let s = startSession(sc)
  s = step(sc, s, { actionId: 'a-good' }, { now: at(s, 1000) }).session
  const out = step(sc, s, { said: 'дальше' }, { now: at(s, 1000) })
  assert.equal(out.ok, false)
  assert.equal(out.code, 'no-free-text')
})

// ---------------------------------------------------------------- разбор

test('разбор содержит итог, обе шкалы, ключевые решения и альтернативу', () => {
  const sc = rig()
  let s = startSession(sc)
  s = step(sc, s, { actionId: 'a-good' }, { now: at(s, 1500) }).session
  s = step(sc, s, { actionId: 'a-next' }, { now: at(s, 1000) }).session
  s = step(sc, s, { actionId: 'a-end-good' }, { now: at(s, 1000) }).session

  const d = debrief(sc, s)
  assert.equal(d.outcome.verdict, 'good')
  assert.equal(d.scales.length, 2, 'ровно две шкалы, третьей быть не должно')
  assert.deepEqual(d.scales.map((x) => x.id).sort(), ['loyalty', 'safety'])

  const key = d.decisions.find((x) => x.chosen.label === 'Доложить по связи')
  assert.ok(key, 'ключевое решение попало в разбор')
  assert.ok(key.alternative, 'у ключевого решения есть альтернатива')
  assert.equal(key.alternative.label, 'Ничего не делать и смотреть')
  assert.ok(d.improvements.length + d.strengths.length > 0)
})

test('компетенции считаются от того, что было достижимо на этом прохождении', () => {
  const sc = rig()
  let s = startSession(sc)
  s = step(sc, s, { actionId: 'a-good' }, { now: at(s, 1000) }).session
  s = step(sc, s, { actionId: 'a-next' }, { now: at(s, 1000) }).session
  s = step(sc, s, { actionId: 'a-end-good' }, { now: at(s, 1000) }).session

  const d = debrief(sc, s)
  const safety = d.competency.find((c) => c.id === 'safety')
  assert.equal(safety.earned, 3)
  assert.equal(safety.max, 3, 'лучший доступный вклад равен выбранному')
  assert.equal(safety.pct, 100)

  // Компетенция, которую сценарий не проверял, не показывается как ноль:
  // это была бы ложь о человеке.
  const deesc = d.competency.find((c) => c.id === 'deescalation')
  assert.equal(deesc.touched, false)
  assert.equal(deesc.pct, null)
})

test('альтернатива берётся только из того, что игроку было доступно', () => {
  const sc = rig()
  let s = startSession(sc)
  s = step(sc, s, { actionId: 'a-good' }, { now: at(s, 1000) }).session
  s = step(sc, s, { actionId: 'a-next' }, { now: at(s, 1000) }).session
  s = step(sc, s, { actionId: 'a-end-good' }, { now: at(s, 1000) }).session
  const d = debrief(sc, s)
  for (const dec of d.decisions) {
    if (!dec.alternative) continue
    assert.notEqual(dec.alternative.label, 'Действие, требующее недоступного ресурса')
  }
})

test('сравнение попыток показывает разницу шкал, финала и решений', () => {
  const sc = rig()
  const play = (first) => {
    let s = startSession(sc)
    s = step(sc, s, { actionId: first }, { now: at(s, 1000) }).session
    s = step(sc, s, { actionId: 'a-next' }, { now: at(s, 1000) }).session
    if (s.stateId === 's-seq') s = step(sc, s, { order: ['i1', 'i2'] }, { now: at(s, 1000) }).session
    s = step(sc, s, { actionId: 'a-end-good' }, { now: at(s, 1000) }).session
    return debrief(sc, s)
  }
  const cmp = compareAttempts(play('a-bad'), play('a-good'))
  assert.ok(cmp.scales.find((x) => x.id === 'safety').delta > 0)
  assert.equal(cmp.changedDecisions.length, 1)
  assert.equal(cmp.changedDecisions[0].before, 'Ничего не делать и смотреть')
  assert.equal(cmp.changedDecisions[0].after, 'Доложить по связи')
})

// ------------------------------------------------------- боевой сценарий

test('сценарий из банка проходится до финала и не имеет тупиков', () => {
  const sc = JSON.parse(fs.readFileSync('content/scenarios/sit-19-medical.json', 'utf8'))
  assert.equal(validate(sc).ok, true, validate(sc).errors.join('; '))

  let s = startSession(sc)
  let guard = 0
  while (s.status === 'active' && guard++ < 30) {
    const actions = availableActions(sc, s)
    assert.ok(actions.length || currentState(sc, s).kind === 'sequence',
      `в состоянии «${s.stateId}» нечего делать`)
    const st = currentState(sc, s)
    const out = st.kind === 'sequence'
      ? step(sc, s, { order: st.correct_order }, { now: s.stateEnteredAt + 1000 })
      : step(sc, s, { actionId: actions[0].id }, { now: s.stateEnteredAt + 1000 })
    assert.equal(out.ok, true, out.error)
    s = out.session
  }
  assert.equal(s.status, 'finished', 'прохождение дошло до финала')
  assert.ok(debrief(sc, s).outcome.text)
})

test('разные стратегии в боевом сценарии дают разные финалы', () => {
  // Если бы финал не зависел от решений, весь продукт не имел бы смысла.
  const sc = JSON.parse(fs.readFileSync('content/scenarios/sit-19-medical.json', 'utf8'))
  const play = (plan) => {
    let s = startSession(sc)
    let i = 0
    while (s.status === 'active' && i < 30) {
      const st = currentState(sc, s)
      const now = s.stateEnteredAt + 1000
      let out
      if (st.kind === 'sequence') {
        out = step(sc, s, { order: plan.badOrder ? [...st.correct_order].reverse() : st.correct_order }, { now })
      } else {
        const actions = availableActions(sc, s)
        const want = plan.prefer.find((id) => actions.some((a) => a.id === id))
        out = step(sc, s, { actionId: want ?? actions[0].id }, { now })
      }
      if (!out.ok) break
      s = out.session
      i += 1
    }
    return s
  }

  const best = play({ prefer: ['a-report', 'a-detail', 'a-handover', 'a-final-full'] })
  const worst = play({ prefer: ['a-calm', 'a-crowd'], badOrder: true })

  assert.equal(best.outcome, 'f-good')
  assert.equal(worst.outcome, 'f-bad')
  assert.ok(best.scales.safety > worst.scales.safety)
})
