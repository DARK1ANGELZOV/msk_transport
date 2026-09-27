/**
 * Тесты смены.
 *
 * Смена — не сумма инцидентов, а последовательность с переносом состояния.
 * Здесь проверяется именно то, что делает её сменой: вагон помнит, усталость
 * копится, восстановление неполное, а подделать рейс не проще, чем эпизод.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { registerLine } from '../engine/line.js'
import { replay } from '../engine/replay.js'
import { initialWorld, meetsRequires, MULTI_TYPES, TERMINAL_TYPES } from '../engine/model.js'
import { TRIP, gapBetween, gradeTrip, recover } from '../engine/trip.js'

const line = registerLine(
  JSON.parse(fs.readFileSync('content/lines/vsm-msk-spb.json', 'utf8'))
)
const trip = JSON.parse(fs.readFileSync('content/trips/trip-701.json', 'utf8'))

const scenarios = {}
for (const f of fs.readdirSync('content/scenarios')) {
  const doc = JSON.parse(fs.readFileSync(`content/scenarios/${f}`, 'utf8'))
  scenarios[doc.id] = doc
}

/** Инциденты смены в порядке километража — так же, как их выстраивает сервер. */
const ordered = {
  ...trip,
  legs: [...trip.legs].sort(
    (a, b) => scenarios[a.scenario].context.startKm - scenarios[b.scenario].context.startKm
  )
}

/** Проходит инцидент, выбирая эталонную ветку там, где она есть. */
function playReference(scenario, carry = null) {
  const ref = scenario.reference ?? []
  const pairs = new Map()
  for (let i = 0; i < ref.length - 1; i += 1) pairs.set(ref[i], ref[i + 1])

  const steps = []
  let cursor = scenario.entry
  let world = initialWorld(scenario, carry)
  let guard = 0

  while (guard++ < 25) {
    const node = scenario.nodes[cursor]
    if (!node || TERMINAL_TYPES.has(node.type)) break

    if (MULTI_TYPES.has(node.type)) {
      const pool = [...(node.blocks ?? []), ...(node.items ?? [])]
      const good = pool.filter((el) => {
        const e = el.effects ?? {}
        const s = (e.safety ?? 0) + (e.loyalty ?? 0) + (e.carMood ?? 0) - (e.stress ?? 0)
        return s + Object.values(e.competency ?? {}).reduce((a, b) => a + b, 0) > 0
      })
      const order = node.correctOrder ?? []
      const ids = good.map((el) => el.id)
        .sort((a, b) => (order.indexOf(a) + 99) % 100 - (order.indexOf(b) + 99) % 100)
      steps.push({ node: cursor, choices: ids, deliberateMs: 3000 })
      cursor = node.next
      continue
    }

    const want = pairs.get(cursor)
    const options = (node.choices ?? []).filter((c) => meetsRequires(c.requires, world))
    const choice = options.find((c) => c.next === want) ?? options[0]
    if (!choice) break
    steps.push({ node: cursor, choice: choice.id, deliberateMs: 3000 })
    cursor = choice.next
    world = replay(scenario, { steps }, { strict: false, carry }).visited.at(-1)?.world ?? world
  }

  return { steps, breaths: [] }
}

/** Полная смена, пройденная эталонно, с переносом состояния между инцидентами. */
function playTrip() {
  let carry = null
  const legs = []
  for (const [i, leg] of ordered.legs.entries()) {
    const scenario = scenarios[leg.scenario]
    if (i > 0) {
      const prev = scenarios[ordered.legs[i - 1].scenario]
      const gap = gapBetween(line, trip.service, prev.context.startKm, scenario.context.startKm)
      carry = recover(carry, gap, i).carry
    }
    const path = playReference(scenario, carry)
    legs.push(path)
    const run = replay(scenario, path, { strict: false, carry })
    carry = {
      carMood: run.world.carMood, stress: run.world.stress, flags: [...run.world.flags]
    }
  }
  return { legs }
}

// ---------------------------------------------------------------------------

test('инциденты смены расставлены по километражу линии', () => {
  const kms = ordered.legs.map((l) => scenarios[l.scenario].context.startKm)
  assert.deepEqual(kms, [...kms].sort((a, b) => a - b))
  assert.ok(kms.length >= 3, 'смена из одного инцидента — не смена')
})

test('между инцидентами проходит настоящее время', () => {
  for (let i = 1; i < ordered.legs.length; i += 1) {
    const a = scenarios[ordered.legs[i - 1].scenario].context.startKm
    const b = scenarios[ordered.legs[i].scenario].context.startKm
    const gap = gapBetween(line, trip.service, a, b)
    assert.ok(gap > 5 * 60, `перегон ${a}→${b} км всего ${gap} с`)
  }
})

test('восстановление на перегоне неполное', () => {
  const beaten = { carMood: 30, stress: 80, flags: [] }
  const hour = recover(beaten, 3600, 1)
  assert.ok(hour.carry.carMood < TRIP.carMood.baseline, 'вагон не забывает полностью')
  assert.ok(hour.carry.stress > TRIP.stress.baseline, 'усталость не снимается целиком')
  // Даже бесконечный перегон не вернёт больше положенной доли.
  const forever = recover(beaten, 100_000, 1)
  assert.equal(forever.carry.carMood, hour.carry.carMood)
})

test('пол усталости поднимается с каждым инцидентом', () => {
  const carry = { carMood: 70, stress: 60, flags: [] }
  const floors = [0, 1, 2, 3].map((i) => recover(carry, 1800, i).change.fatigueFloor)
  for (let i = 1; i < floors.length; i += 1) {
    assert.ok(floors[i] > floors[i - 1], `пол ${floors[i - 1]} → ${floors[i]}`)
  }
})

test('флаги переносятся между инцидентами, лояльность — нет', () => {
  const carry = { carMood: 50, stress: 40, flags: ['filmed'] }
  const world = initialWorld(scenarios['med-01'], carry)
  assert.ok(world.flags.includes('filmed'), 'вас всё ещё снимают')
  assert.equal(world.carMood, 50, 'вагон помнит')
  assert.equal(world.stress, 40, 'усталость несётся дальше')
  assert.equal(world.loyalty, scenarios['med-01'].state.loyalty, 'пассажир другой')
  assert.equal(world.safety, scenarios['med-01'].state.safety, 'безопасность меряется заново')
})

test('эталонная смена доводится до конца и оценивается', () => {
  const result = gradeTrip(ordered, scenarios, playTrip(), { strict: false, line })
  assert.equal(result.ok, true, result.rejected.join('; '))
  assert.equal(result.legs.length, ordered.legs.length)
  assert.equal(result.gaps.length, ordered.legs.length - 1)
  assert.ok(result.scorePct >= 70, `результат ${result.scorePct} %`)
  assert.ok(result.achievements.includes('full-shift'))
  assert.ok(
    result.tripSec > result.legs.reduce((s, l) => s + l.run.tripSec, 0),
    'время смены включает перегоны'
  )
})

test('смена с пропущенным инцидентом не засчитывается', () => {
  const full = playTrip()
  const result = gradeTrip(ordered, scenarios, { legs: full.legs.slice(0, 2) }, {
    strict: false, line
  })
  assert.equal(result.ok, false)
  assert.equal(result.scorePct, 0)
})

test('подделанный шаг внутри смены отклоняет всю смену', () => {
  const full = playTrip()
  const broken = {
    legs: full.legs.map((l, i) => (i === 1
      ? { ...l, steps: [{ node: 'n-start', choice: 'c-нет-такого', deliberateMs: 3000 }] }
      : l))
  }
  const result = gradeTrip(ordered, scenarios, broken, { strict: false, line })
  assert.equal(result.ok, false)
  assert.ok(result.rejected.length > 0)
})

test('компетенции смены нормируются на сумму потолков её инцидентов', () => {
  const result = gradeTrip(ordered, scenarios, playTrip(), { strict: false, line })
  for (const [k, v] of Object.entries(result.competencyPct)) {
    assert.ok(v >= 0 && v <= 100, `${k} = ${v}`)
  }
  assert.ok(Object.keys(result.competencyPct).length >= 4, 'смена трогает много компетенций')
})
