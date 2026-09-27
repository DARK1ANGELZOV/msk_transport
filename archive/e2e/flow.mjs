/**
 * Сквозная проверка полного цикла против живого сервера.
 *
 * Проверяется то, ради чего всё построено: клиент присылает путь, сервер
 * пересчитывает результат сам, отклоняет подделку и отдаёт разбор.
 * Тест ходит по настоящему HTTP, поэтому ловит и ошибки маршрутизации,
 * и расхождение форматов, которых юнит-тесты ядра не видят.
 *
 *   node e2e/flow.mjs                 (сервер должен быть запущен)
 *   BASE=http://host:8787 node e2e/flow.mjs
 */
import assert from 'node:assert/strict'

import { replay } from '../engine/index.js'
import { MULTI_TYPES, TERMINAL_TYPES, initialWorld, meetsRequires } from '../engine/model.js'

const BASE = process.env.BASE || 'http://localhost:8787'
const PASSWORD = process.env.SEED_PASSWORD || 'krechet-2028'

let cookie = ''
let passed = 0
const failures = []

async function req(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...init.headers
    }
  })
  const setCookie = res.headers.getSetCookie?.() ?? []
  for (const c of setCookie) if (c.startsWith('ekipazh_sid=')) cookie = c.split(';')[0]
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`✓ ${name}`)
  } catch (err) {
    failures.push(`${name}: ${err.message}`)
    console.log(`✗ ${name}\n    ${err.message}`)
  }
}

/** Проходит сценарий, всегда выбирая эталонную ветку, где она есть. */
function playReference(scenario, carry = null) {
  const refPairs = new Map()
  const ref = scenario.reference ?? []
  for (let i = 0; i < ref.length - 1; i += 1) refPairs.set(ref[i], ref[i + 1])

  const steps = []
  let cursor = scenario.entry
  let world = initialWorld(scenario, carry)
  let guard = 0

  while (guard++ < 25) {
    const node = scenario.nodes[cursor]
    if (!node || TERMINAL_TYPES.has(node.type)) break
    const deliberateMs = 3000

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
      steps.push({ node: cursor, choices: ids, deliberateMs })
      cursor = node.next
      continue
    }

    const want = refPairs.get(cursor)
    const options = (node.choices ?? []).filter((c) => meetsRequires(c.requires, world))
    const choice = options.find((c) => c.next === want) ?? options[0]
    if (!choice) break
    steps.push({ node: cursor, choice: choice.id, deliberateMs })
    cursor = choice.next
    world = replay(scenario, { steps }, { strict: false, carry }).visited.at(-1)?.world ?? world
  }

  const totalMs = steps.length * 3000
  return {
    startedAt: new Date(Date.now() - totalMs - 2000).toISOString(),
    finishedAt: new Date().toISOString(),
    steps,
    breaths: []
  }
}

// ---------------------------------------------------------------------------

const health = await req('/api/health')
if (health.status !== 200) {
  console.error(`Сервер не отвечает на ${BASE}. Запустите: npm start`)
  process.exit(2)
}
if (!health.body?.seeded) {
  console.error('База пуста. Заполните: npm run seed')
  process.exit(2)
}

await check('вход отклоняет неверный пароль', async () => {
  const r = await req('/api/login', {
    method: 'POST', body: JSON.stringify({ login: 'demo', password: 'нет' })
  })
  assert.equal(r.status, 401)
})

await check('вход проводника', async () => {
  const r = await req('/api/login', {
    method: 'POST', body: JSON.stringify({ login: 'demo', password: PASSWORD })
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.user.role, 'conductor')
})

let scenarios = []
await check('список сценариев не пуст', async () => {
  const r = await req('/api/scenarios')
  assert.equal(r.status, 200)
  scenarios = r.body.scenarios
  assert.ok(scenarios.length >= 12, `сценариев ${scenarios.length}`)
})

let scenario = null
await check('граф сценария отдаётся целиком в тренировке', async () => {
  const r = await req(`/api/scenarios/${scenarios[0].id}?mode=practice`)
  scenario = r.body.scenario
  assert.ok(scenario.reference?.length, 'эталонный путь должен приходить в тренировке')
  const withFeedback = Object.values(scenario.nodes)
    .some((n) => (n.choices ?? []).some((c) => c.feedback))
  assert.ok(withFeedback, 'разбор вариантов должен приходить в тренировке')
})

await check('сценарий приходит вместе с линией, на которой он стоит', async () => {
  const r = await req(`/api/scenarios/${scenarios[0].id}?mode=practice`)
  assert.ok(r.body.line, 'линия должна приходить с графом')
  assert.equal(r.body.line.id, scenario.context.line)
  assert.ok(r.body.line.stations.length > 5)
  assert.ok(r.body.line.physics.emergencyDecelMs2 > 0)
})

await check('список рейсов несёт обстановку, посчитанную по физике линии', async () => {
  const r = await req('/api/scenarios')
  const withSetting = r.body.scenarios.filter((s) => s.setting)
  assert.equal(withSetting.length, r.body.scenarios.length, 'обстановка должна быть у всех')
  for (const s of withSetting) {
    assert.ok(s.setting.km > 0 && s.setting.km < 700, `${s.id}: км ${s.setting.km}`)
    assert.ok(s.setting.brakingM > 0, `${s.id}: тормозной путь`)
  }
  // На магистральном ходу состав идёт быстрее, чем на подходе к городу.
  const fast = withSetting.find((s) => s.setting.speedKmh === 400)
  assert.ok(fast, 'хотя бы один сценарий должен идти на четырёхстах')
})

await check('в экзамене подсказки и эталон не отдаются', async () => {
  const r = await req(`/api/scenarios/${scenarios[0].id}?mode=exam`)
  const exam = r.body.scenario
  assert.equal(exam.reference, undefined, 'эталонный путь не должен уходить на клиент')
  const leaked = Object.values(exam.nodes).some(
    (n) => n.hint || n.feedback || n.sop || (n.choices ?? []).some((c) => c.feedback || c.sop)
  )
  assert.equal(leaked, false, 'в экзамене нельзя отдавать разбор вместе с вопросом')
})

let runId = ''
await check('эталонное прохождение принимается и оценивается сервером', async () => {
  const path = playReference(scenario)
  const r = await req('/api/runs', {
    method: 'POST',
    body: JSON.stringify({
      scenarioId: scenario.id, scenarioVersion: scenario.version, mode: 'practice', path
    })
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.status, 'scored', r.body.result?.rejected?.join('; '))
  assert.ok(r.body.result.scorePct >= 70, `результат ${r.body.result.scorePct} %`)
  assert.ok(r.body.result.sopMatched > 0)
  runId = r.body.runId
})

await check('разбор рейса отдаёт эталон и пояснения', async () => {
  const r = await req(`/api/runs/${runId}`)
  assert.equal(r.status, 200)
  assert.ok(r.body.reference.length > 0)
  assert.ok(Object.keys(r.body.annotations).length > 0)
  assert.equal(r.body.run.id, runId)
})

await check('подделанный путь отклоняется, но сохраняется как спорный', async () => {
  const r = await req('/api/runs', {
    method: 'POST',
    body: JSON.stringify({
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      mode: 'practice',
      path: {
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        finishedAt: new Date().toISOString(),
        steps: [{ node: scenario.entry, choice: 'c-несуществующий', deliberateMs: 3000 }]
      }
    })
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.status, 'disputed')
  assert.equal(r.body.result.score, 0)
  assert.ok(r.body.result.rejected.length > 0)
})

await check('мгновенные ответы отклоняются', async () => {
  const path = playReference(scenario)
  const r = await req('/api/runs', {
    method: 'POST',
    body: JSON.stringify({
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      mode: 'practice',
      path: { ...path, steps: path.steps.map((s) => ({ ...s, deliberateMs: 40 })) }
    })
  })
  assert.equal(r.body.status, 'disputed')
})

// ------------------------------------------------------------------ рейс

let trip = null
await check('рейс отдаётся вместе с линией и всеми инцидентами', async () => {
  const list = await req('/api/trips')
  assert.ok(list.body.trips.length >= 1)
  const r = await req(`/api/trips/${list.body.trips[0].id}`)
  assert.equal(r.status, 200)
  trip = r.body
  assert.ok(trip.line, 'линия')
  assert.equal(trip.scenarios.length, trip.trip.legs.length, 'все инциденты')
  assert.equal(trip.gaps.length, trip.scenarios.length - 1, 'перегоны между ними')
  for (const g of trip.gaps) assert.ok(g.gapSec > 60, `перегон ${g.fromKm}→${g.toKm}: ${g.gapSec} с`)
  // Инциденты должны идти по возрастанию километра: рейс — это маршрут.
  const kms = trip.scenarios.map((sc) => sc.context.startKm)
  assert.deepEqual(kms, [...kms].sort((a, b) => a - b), 'порядок по километражу')
})

let tripRunId = ''
await check('смена целиком принимается и оценивается сервером', async () => {
  const { registerLine } = await import('../engine/line.js')
  const { recover } = await import('../engine/trip.js')
  registerLine(trip.line)

  let carry = null
  const legs = []
  for (const [i, sc] of trip.scenarios.entries()) {
    if (i > 0) carry = recover(carry, trip.gaps[i - 1].gapSec, i).carry
    const path = playReference(sc, carry)
    legs.push(path)
    const run = replay(sc, path, { strict: false, carry })
    carry = {
      carMood: run.world.carMood, stress: run.world.stress, flags: [...run.world.flags]
    }
  }

  const r = await req('/api/trip-runs', {
    method: 'POST',
    body: JSON.stringify({
      tripId: trip.trip.id,
      path: {
        startedAt: new Date(Date.now() - 15 * 60_000).toISOString(),
        finishedAt: new Date().toISOString(),
        legs
      }
    })
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.status, 'scored', r.body.result?.rejected?.join('; '))
  assert.equal(r.body.result.legs.length, trip.scenarios.length)
  assert.ok(r.body.result.scorePct >= 60, `результат ${r.body.result.scorePct} %`)
  assert.ok(r.body.result.achievements.includes('full-shift'), 'достижение за полную смену')
  tripRunId = r.body.runId
})

await check('состояние вагона переносится между инцидентами', async () => {
  const r = await req(`/api/runs/${tripRunId}`)
  assert.equal(r.status, 200)
  assert.equal(r.body.run.mode, 'trip')
  assert.equal(r.body.scenarios.length, trip.scenarios.length, 'версии инцидентов зафиксированы')
  assert.ok(r.body.trip, 'описание рейса')
})

await check('рейс с пропущенным инцидентом не засчитывается', async () => {
  const r = await req('/api/trip-runs', {
    method: 'POST',
    body: JSON.stringify({
      tripId: trip.trip.id,
      path: {
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        finishedAt: new Date().toISOString(),
        legs: [playReference(trip.scenarios[0])]
      }
    })
  })
  assert.equal(r.body.status, 'disputed')
  assert.equal(r.body.result.scorePct, 0)
})

await check('профиль отдаёт компетенции и рекомендацию', async () => {
  const r = await req('/api/profile')
  assert.equal(r.status, 200)
  assert.ok(Object.keys(r.body.competency).length > 0)
  assert.ok(r.body.achievements.length > 0)
  assert.ok(r.body.next.length > 0, 'система должна предлагать следующий сценарий')
})

await check('рейтинг отдаёт бригады и личный зачёт', async () => {
  const r = await req('/api/leaderboard')
  assert.equal(r.status, 200)
  assert.ok(r.body.brigades.length > 0)
  assert.ok(r.body.personal.length > 0)
  assert.ok(r.body.personal.some((p) => p.mine))
})

await check('проводнику закрыт кабинет руководителя', async () => {
  const r = await req('/api/manager/overview')
  assert.equal(r.status, 403)
})

await check('проводнику закрыта публикация сценариев', async () => {
  const r = await req('/api/methodist/publish', {
    method: 'POST', body: JSON.stringify({ scenario: {} })
  })
  assert.equal(r.status, 403)
})

await check('методист видит статистику по узлам', async () => {
  await req('/api/logout', { method: 'POST' })
  cookie = ''
  await req('/api/login', {
    method: 'POST', body: JSON.stringify({ login: 'method', password: PASSWORD })
  })
  const r = await req(`/api/methodist/stats/${scenario.id}`)
  assert.equal(r.status, 200)
  assert.ok(Array.isArray(r.body.nodes))
})

await check('сломанный сценарий не публикуется', async () => {
  const broken = { ...scenario, nodes: { ...scenario.nodes }, entry: 'нет-такого-узла' }
  const r = await req('/api/methodist/publish', {
    method: 'POST', body: JSON.stringify({ scenario: broken })
  })
  assert.equal(r.status, 422)
  assert.ok(r.body.report.errors.length > 0)
})

await check('руководитель видит готовность бригад', async () => {
  await req('/api/logout', { method: 'POST' })
  cookie = ''
  await req('/api/login', {
    method: 'POST', body: JSON.stringify({ login: 'boss', password: PASSWORD })
  })
  const r = await req('/api/manager/overview')
  assert.equal(r.status, 200)
  assert.ok(r.body.brigades.length > 0)
  assert.ok(r.body.people.length > 0)
})

await check('без сессии закрыто всё', async () => {
  await req('/api/logout', { method: 'POST' })
  cookie = ''
  const r = await req('/api/profile')
  assert.equal(r.status, 401)
})

await check('сервер не отражает произвольный Origin вместе с куками', async () => {
  const res = await fetch(BASE + '/api/health', { headers: { origin: 'https://evil.example' } })
  const allow = res.headers.get('access-control-allow-origin')
  assert.equal(allow, null, `сервер разрешил источник ${allow}`)
  assert.equal(res.headers.get('access-control-allow-credentials'), null)
})

await check('статика не отдаёт файлы за пределами dist', async () => {
  for (const attack of [
    '/../package.json',
    '/../../package.json',
    '/..%2fpackage.json',
    '/%2e%2e/%2e%2e/data/ekipazh.sqlite',
    '/..\\package.json'
  ]) {
    const res = await fetch(BASE + attack)
    const text = await res.text()
    assert.ok(
      !text.includes('"ekipazh-400"') && !text.includes('SQLite format'),
      `обход каталога сработал на ${attack}`
    )
  }
})

console.log('')
console.log(`Пройдено: ${passed}, провалено: ${failures.length}`)
process.exit(failures.length ? 1 : 0)
