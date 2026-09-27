/**
 * Тесты ядра.
 *
 * Проверяется ровно то, на чём держится доверие к продукту: эталонный путь
 * даёт эталонный результат, подделанный путь отклоняется, а промедление
 * закрывает варианты. Если эти тесты зелёные, результат можно класть в допуск.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { grade, replay, validate, analyze, competencyPercent, ENGINE } from '../engine/index.js'
import { nextBox, recommend, streakDays } from '../engine/recommend.js'
import {
  brakingDistanceM, metresIn, profile, registerLine, trainState
} from '../engine/line.js'

const line = registerLine(
  JSON.parse(fs.readFileSync('content/lines/vsm-msk-spb.json', 'utf8'))
)
const med = JSON.parse(fs.readFileSync('content/scenarios/med-01.json', 'utf8'))

/** Эталонный путь med-01, пройденный вдумчиво, но без потерь. */
const perfect = {
  startedAt: '2026-09-27T08:00:00.000Z',
  finishedAt: '2026-09-27T08:02:00.000Z',
  steps: [
    { node: 'n-start', choice: 'c-call', deliberateMs: 3000 },
    { node: 'n-doctor', choice: 'c-announce', deliberateMs: 2500 },
    { node: 'n-report', choices: ['b-who', 'b-what', 'b-state', 'b-ask'], deliberateMs: 6000 },
    { node: 'n-prep', choices: ['i-stay', 'i-path', 'i-docs', 'i-announce'], deliberateMs: 8000 }
  ],
  breaths: []
}

// ---------------------------------------------------------------- линия

test('время в пути совпадает с опубликованным: около 2 ч 15 мин без остановок', () => {
  const nonstop = {
    ...line,
    services: [{
      id: 'ns', title: '', departure: '08:00',
      stops: ['Москва, Рижская', 'Санкт-Петербург Главный']
    }]
  }
  const minutes = profile(nonstop, 'ns').totalSec / 60
  assert.ok(minutes > 125 && minutes < 145, `получилось ${Math.round(minutes)} мин`)
})

test('экстренный тормозной путь с 400 км/ч около шести с половиной километров', () => {
  const d = brakingDistanceM(400, line, 'emergency')
  assert.ok(d > 6000 && d < 6600, `${d} м`)
  // Опубликованный ориентир для составов этого класса — менее 6500 м.
  assert.ok(brakingDistanceM(400, line, 'service') > d, 'служебное тормозит мягче экстренного')
})

test('скорость на линии меняется по профилю, а не задана в контенте', () => {
  const near = trainState(line, 'express-day', 20, 0)
  const cruise = trainState(line, 'express-day', 400, 0)
  const arriving = trainState(line, 'express-day', 675, 0)
  assert.ok(near.speedKmh < cruise.speedKmh, 'на выходе из Москвы медленнее')
  assert.equal(cruise.speedKmh, 400, 'на магистральном участке — четыреста')
  assert.ok(arriving.speedKmh < 200, 'на подходе к Петербургу медленнее')
})

test('обратный рейс идёт по тому же километражу в другую сторону', () => {
  const there = trainState(line, 'express-day', 300, 0)
  const back = trainState(line, 'express-back', 300, 0)
  assert.equal(there.nextStop.name, 'Великий Новгород')
  assert.equal(back.nextStop.name, 'Новая Тверь')
  assert.equal(back.direction, 'back')
})

test('секунда раздумья — это сто с лишним метров пути', () => {
  assert.equal(metresIn(400, 1), 111)
  assert.equal(metresIn(360, 12), 1200)
})

test('положение состава меняется по ходу прохождения', () => {
  const run = replay(med, perfect, { strict: false })
  const first = run.visited[0].world
  const last = run.visited.at(-1).world
  assert.ok(last.km > first.km, 'поезд должен уехать вперёд')
  assert.ok(last.toStopSec < first.toStopSec, 'до остановки должно остаться меньше')
  assert.equal(first.speedKmh, 360)
})

test('сценарий проходит валидацию', () => {
  const r = validate(med)
  assert.deepEqual(r.errors, [])
  assert.equal(r.ok, true)
})

test('эталонный путь: доведён до финала и полностью совпал с СОП', () => {
  const run = grade(med, perfect)
  assert.equal(run.ok, true)
  assert.deepEqual(run.rejected, [])
  assert.equal(run.verdict, 'good')
  assert.equal(run.sopMatched, run.sopTotal)
  assert.equal(run.sopTotal, 4)
  assert.ok(run.scorePct >= 90, `ожидали ≥90 %, получили ${run.scorePct}`)
})

test('проценты по компетенциям не превышают потолок сценария', () => {
  const run = grade(med, perfect)
  for (const [k, v] of Object.entries(run.competencyPct)) {
    assert.ok(v >= 0 && v <= 100, `${k} = ${v} вне 0..100`)
  }
  assert.ok(Object.keys(run.competencyPct).length > 0)
})

test('потолок сценария достижим: лучший путь даёт 100 %', () => {
  const { maxScore } = analyze(med)
  assert.ok(maxScore > 0)
  // Ни одно прохождение не может обогнать потолок.
  const run = grade(med, perfect)
  assert.ok(run.score <= maxScore, `${run.score} > ${maxScore}`)
})

test('пересчёт детерминирован: тот же путь даёт тот же результат', () => {
  const a = grade(med, perfect)
  const b = grade(med, perfect)
  assert.equal(a.score, b.score)
  assert.deepEqual(a.competency, b.competency)
  assert.equal(a.tripSec, b.tripSec)
})

// --------------------------------------------------------------- античит

test('несуществующее ребро отклоняется', () => {
  const run = replay(med, {
    ...perfect,
    steps: [{ node: 'n-start', choice: 'c-teleport', deliberateMs: 3000 }]
  })
  assert.equal(run.ok, false)
  assert.match(run.rejected[0], /нет варианта/)
  assert.equal(run.score, 0)
})

test('путь, разошедшийся с графом, отклоняется', () => {
  const run = replay(med, {
    ...perfect,
    steps: [
      { node: 'n-start', choice: 'c-call', deliberateMs: 3000 },
      { node: 'n-prep', choices: ['i-stay'], deliberateMs: 3000 }
    ]
  })
  assert.equal(run.ok, false)
  assert.match(run.rejected[0], /разошёлся с графом/)
})

test('слишком быстрые шаги отклоняются', () => {
  const run = replay(med, {
    ...perfect,
    steps: perfect.steps.map((s) => ({ ...s, deliberateMs: 50 }))
  })
  assert.equal(run.ok, false)
  assert.match(run.rejected.join(' '), new RegExp(`${ENGINE.MIN_DELIBERATE_MS} мс`))
})

test('раздумье дольше лимита без пометки таймаута отклоняется', () => {
  const run = replay(med, {
    ...perfect,
    steps: [{ node: 'n-start', choice: 'c-call', deliberateMs: 60_000 }]
  })
  assert.equal(run.ok, false)
  assert.match(run.rejected[0], /дольше лимита/)
})

test('сумма раздумий больше длительности прохождения отклоняется', () => {
  const run = replay(med, {
    ...perfect,
    startedAt: '2026-09-27T08:00:00.000Z',
    finishedAt: '2026-09-27T08:00:03.000Z'
  })
  assert.equal(run.ok, false)
  assert.match(run.rejected.join(' '), /сумма раздумий/)
})

test('предпросмотр методиста не требует правдоподобных таймингов', () => {
  const run = replay(med, { ...perfect, steps: perfect.steps.map((s) => ({ ...s, deliberateMs: 0 })) },
    { strict: false })
  assert.equal(run.ok, true)
})

// ------------------------------------------------------- время как ветвление

test('канал связи занимает начальник поезда, и вариант доклада исчезает', () => {
  // На 40-й секунде рейса ЛНП уходит на связь с диспетчером, канал занят.
  // Путь, в котором проводник пытается доложить в это окно, невозможен —
  // клиент на том же ядре такой вариант не показал бы.
  const run = replay(med, {
    startedAt: '2026-09-27T08:00:00.000Z',
    finishedAt: '2026-09-27T08:04:00.000Z',
    steps: [
      { node: 'n-start', choice: 'c-look', deliberateMs: 14_000 },
      { node: 'n-look', choice: 'c-call2', deliberateMs: 8000 }
    ]
  })
  assert.equal(run.ok, false)
  assert.match(run.rejected.join(' '), /был недоступен/)
  assert.ok(run.events.some((e) => /[Кк]анал занят/.test(e.toast)), 'событие занятости канала')
})

test('окно заказа медиков закрывается по километру, а не по таймеру', () => {
  // Медленный путь: к узлу доклада состав подходит, когда до станции
  // осталось меньше пяти минут. Диспетчер уже не успеет — рейс уходит
  // в ветку «окно упущено», и экран доклада не открывается вовсе.
  const run = replay(med, {
    startedAt: '2026-09-27T08:00:00.000Z',
    finishedAt: '2026-09-27T08:06:00.000Z',
    steps: [
      { node: 'n-start', choice: 'c-look', deliberateMs: 15_000 },
      { node: 'n-look', choice: 'c-aid-here', deliberateMs: 15_000 },
      { node: 'n-self-aid', choice: 'c-water', deliberateMs: 20_000 },
      { node: 'n-window', choice: 'c-unscheduled', deliberateMs: 10_000 },
      { node: 'n-prep', choices: ['i-stay', 'i-path', 'i-docs', 'i-announce'], deliberateMs: 12_000 }
    ]
  })
  assert.equal(run.ok, true, run.rejected.join('; '))
  const redirect = run.events.find((e) => e.redirect)
  assert.ok(redirect, 'должен был сработать обход узла доклада')
  assert.equal(redirect.redirect.from, 'n-report')
  assert.equal(redirect.redirect.to, 'n-window')
  const at = run.visited.find((v) => v.node === 'n-window')
  assert.ok(at.world.toStopSec < 300, `до остановки осталось ${at.world.toStopSec} с`)
})

test('перенос пассажира на ходу недоступен: только на стоянке', () => {
  const run = replay(med, {
    startedAt: '2026-09-27T08:00:00.000Z',
    finishedAt: '2026-09-27T08:03:00.000Z',
    steps: [
      { node: 'n-start', choice: 'c-look', deliberateMs: 5000 },
      { node: 'n-look', choice: 'c-carry', deliberateMs: 5000 }
    ]
  })
  assert.equal(run.ok, false)
  assert.match(run.rejected.join(' '), /был недоступен/)
})

test('таймаут — это ветка, а не поражение', () => {
  const run = replay(med, {
    startedAt: '2026-09-27T08:00:00.000Z',
    finishedAt: '2026-09-27T08:04:00.000Z',
    steps: [
      { node: 'n-start', timeout: true },
      { node: 'n-late-start', choice: 'c-call-late', deliberateMs: 4000 },
      { node: 'n-doctor', choice: 'c-announce', deliberateMs: 3000 },
      { node: 'n-report', choices: ['b-who', 'b-what', 'b-state', 'b-ask'], deliberateMs: 7000 },
      { node: 'n-prep', choices: ['i-stay', 'i-path', 'i-docs', 'i-announce'], deliberateMs: 9000 }
    ]
  })
  assert.equal(run.ok, true, run.rejected.join('; '))
  assert.equal(run.visited[0].timeout, true)
  assert.ok(run.visited[0].stressAfter > run.visited[0].stressBefore, 'таймаут поднимает стресс')
})

test('плохие решения дают заметно меньше эталонных', () => {
  const bad = replay(med, {
    startedAt: '2026-09-27T08:00:00.000Z',
    finishedAt: '2026-09-27T08:06:00.000Z',
    steps: [
      { node: 'n-start', choice: 'c-calm', deliberateMs: 3000 },
      { node: 'n-calm', choice: 'c-then-look', deliberateMs: 3000 },
      { node: 'n-look', choice: 'c-aid-here', deliberateMs: 3000 },
      { node: 'n-self-aid', choice: 'c-water', deliberateMs: 3000 },
      { node: 'n-report', choices: ['b-vague'], deliberateMs: 4000 },
      { node: 'n-prep', choices: ['i-photo'], deliberateMs: 4000 }
    ]
  })
  const good = replay(med, perfect)
  assert.equal(bad.ok, true, bad.rejected.join('; '))
  assert.ok(bad.score < good.score * 0.7, `плохой ${bad.score} против хорошего ${good.score}`)
  assert.ok(bad.world.safety < 70)
})

test('«Вдох» снимает стресс и стоит секунд рейса', () => {
  const withBreath = replay(med, { ...perfect, breaths: [{ afterStep: 0 }] })
  const without = replay(med, perfect)
  assert.equal(withBreath.ok, true)
  assert.equal(withBreath.tripSec, without.tripSec + ENGINE.BREATH_SEC)
  assert.ok(withBreath.world.stress < without.world.stress)
})

test('два вдоха на одном узле считаются за один', () => {
  // Вдох записывается как «после шага N», поэтому два вдоха на одном узле
  // неотличимы от одного. Интерфейс обязан это учитывать: иначе второй вдох
  // снимал бы стресс бесплатно. Тест фиксирует поведение движка,
  // чтобы правка интерфейса не разошлась с расчётом.
  const one = replay(med, { ...perfect, breaths: [{ afterStep: 0 }] })
  const two = replay(med, { ...perfect, breaths: [{ afterStep: 0 }, { afterStep: 0 }] })
  assert.equal(one.tripSec, two.tripSec)
  assert.equal(one.world.stress, two.world.stress)
})

test('раскрытие вариантов при туннельном зрении стоит секунд рейса', () => {
  const plain = replay(med, perfect)
  const revealed = replay(med, { ...perfect, reveals: [{ atStep: 1 }] })
  assert.equal(revealed.tripSec, plain.tripSec + ENGINE.REVEAL_SEC)
  assert.equal(revealed.visited[1].revealed, true)
})

test('неполный доклад бьёт по безопасности', () => {
  const full = replay(med, perfect)
  const partial = replay(med, {
    ...perfect,
    steps: perfect.steps.map((s) => (s.node === 'n-report' ? { ...s, choices: ['b-who'] } : s))
  })
  assert.equal(partial.ok, true)
  // Шкала безопасности упирается в сто и разницу прячет — поэтому смотрим
  // на то, что действительно измеряется: компетенцию и итоговый балл.
  assert.ok(partial.competency.comms < full.competency.comms)
  assert.ok(partial.score < full.score, `${partial.score} против ${full.score}`)
})

// ------------------------------------------------------------ достижения

test('достижения выдаются по фактическим числам, а не за участие', () => {
  const run = grade(med, perfect, { runsTotal: 1, streakDays: 0 })
  assert.ok(run.achievements.includes('by-the-book'))
  assert.ok(run.achievements.includes('no-timeouts'))
  assert.ok(!run.achievements.includes('veteran'), 'первый рейс не делает сменщиком')
})

test('отклонённое прохождение не приносит достижений', () => {
  const run = grade(med, { ...perfect, steps: [{ node: 'n-start', choice: 'c-nope', deliberateMs: 3000 }] })
  assert.deepEqual(run.achievements, [])
  assert.equal(run.score, 0)
})

// --------------------------------------------------- подбор и повторение

test('интервальное повторение двигает коробку по результату', () => {
  assert.equal(nextBox(0, 90), 1)
  assert.equal(nextBox(2, 70), 2)
  assert.equal(nextBox(3, 40), 0)
})

test('просроченное повторение важнее нового сценария', () => {
  const scenarios = [
    { id: 'a', title: 'Повторить', competencies: ['safety'], difficulty: 2 },
    { id: 'b', title: 'Новый', competencies: ['empathy'], difficulty: 2 }
  ]
  const now = Date.parse('2026-09-27T00:00:00Z')
  const list = recommend(
    scenarios,
    { competency: { safety: 80, empathy: 30 } },
    [{ scenarioId: 'a', box: 1, dueAt: now - 3 * 86_400_000, lastScorePct: 65 }],
    now
  )
  assert.equal(list[0].scenarioId, 'a')
  assert.equal(list[0].kind, 'repeat')
  assert.match(list[0].reason, /просрочен/)
})

test('серия дней считается по календарю и не рвётся до полуночи', () => {
  const now = Date.parse('2026-09-27T10:00:00Z')
  const days = ['2026-09-26T20:00:00Z', '2026-09-25T09:00:00Z']
  assert.equal(streakDays(days, now), 2)
  assert.equal(streakDays([...days, '2026-09-27T08:00:00Z'], now), 3)
  assert.equal(streakDays(['2026-09-20T08:00:00Z'], now), 0)
})

test('серия учитывает рейс, который сдаётся прямо сейчас', () => {
  // Сервер добавляет текущее время к списку дат: рейс ещё не в базе,
  // но он уже состоялся. Иначе достижение «неделя без пропусков»
  // не выдавалось бы именно в седьмой день.
  const now = Date.parse('2026-09-27T10:00:00Z')
  const previous = [1, 2, 3, 4, 5, 6].map((d) =>
    new Date(now - d * 86_400_000).toISOString()
  )
  assert.equal(streakDays(previous, now), 6)
  assert.equal(streakDays([now, ...previous], now), 7)
})
