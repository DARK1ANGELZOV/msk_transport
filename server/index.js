/**
 * Сервер «ЭКИПАЖ 400».
 *
 * Главное правило всего файла: клиент не сообщает результат, клиент сообщает
 * путь. Очки, шкалы, компетенции и достижения считает ядро (engine/) по копии
 * опубликованной версии графа, которая лежит в базе. Поэтому запись в рейтинг
 * невозможно накрутить, не подделав правдоподобное прохождение, а результат
 * можно объяснить по шагам через полгода.
 *
 * Публичное:
 *   GET  /api/health
 *   POST /api/login | /api/logout        GET /api/me
 *
 * Проводник:
 *   GET  /api/scenarios                  список опубликованных
 *   GET  /api/scenarios/:id?mode=        граф для прохождения
 *   POST /api/runs                       сдать путь, получить результат и разбор
 *   GET  /api/runs/:id                   разбор рейса
 *   GET  /api/profile                    компетенции, ачивки, серия, что дальше
 *   GET  /api/leaderboard?scope=&season=
 *   GET  /api/duels    POST /api/duels   POST /api/duels/:id/close
 *
 * Методист:
 *   GET  /api/methodist/scenarios        все версии
 *   GET  /api/methodist/scenarios/:id    последняя версия целиком
 *   POST /api/methodist/validate         проверка без публикации
 *   POST /api/methodist/publish          новая версия
 *   GET  /api/methodist/stats/:id        статистика по узлам графа
 *
 * Руководитель:
 *   GET  /api/manager/overview           готовность бригад
 *   POST /api/manager/assignments
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  achievements as achDb, audit, duels, isEmpty, leaderboard, meta, nodeStats,
  publicUser, runs as runsDb, scenarios as scenDb, seasonOf, srs, uid, users
} from './lib/db.js'
import * as auth from './lib/auth.js'
import { bad, clientIp, cors, int, ok, rateLimited, readBody, send, str } from './lib/http.js'

import { grade } from '../engine/index.js'
import { TRIP_ACHIEVEMENTS, gapBetween, gradeTrip } from '../engine/trip.js'
import { validate } from '../engine/validate.js'
import { analyze } from '../engine/scoring.js'
import { profileCompetency } from '../engine/scoring.js'
import { ACHIEVEMENTS } from '../engine/achievements.js'
import {
  COMPETENCIES, MULTI_TYPES, READINESS_TEXT, elementsOf, initialWorld, readiness
} from '../engine/model.js'
import { dueAfter, nextBox, recommend, streakDays } from '../engine/recommend.js'
import { getLine, knownLines, registerLine } from '../engine/line.js'

const PORT = Number(process.env.PORT) || 8787
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST = path.join(ROOT, 'dist')
const LINES_DIR = path.join(ROOT, 'content', 'lines')

/**
 * Линии — справочные данные инфраструктуры, а не версионируемый контент.
 * Они читаются при старте и живут в памяти: сценарий ссылается на линию
 * по идентификатору, а километраж, скорость и время до остановки считает
 * ядро. Без этого шага сценарий не знает, где он находится.
 */
for (const file of fs.existsSync(LINES_DIR) ? fs.readdirSync(LINES_DIR) : []) {
  if (!file.endsWith('.json')) continue
  try {
    const doc = registerLine(JSON.parse(fs.readFileSync(path.join(LINES_DIR, file), 'utf8')))
    console.log(`Линия: ${doc.title}, ${doc.lengthKm} км, рейсов ${doc.services.length}`)
  } catch (err) {
    console.error(`Линия ${file} не прочитана: ${err.message}`)
  }
}

/** Линия, на которой стоит сценарий, — уходит клиенту вместе с графом. */
const lineOf = (scenario) => (scenario?.context?.line ? getLine(scenario.context.line) : null)

/**
 * Рейсы — тоже справочный контент: последовательность инцидентов на одной
 * линии. Сам инцидент версионируется как сценарий, а рейс лишь ссылается
 * на него по идентификатору, поэтому обновление сценария подхватывается
 * рейсом автоматически, а в прохождении фиксируются конкретные версии.
 */
const TRIPS_DIR = path.join(ROOT, 'content', 'trips')
const trips = new Map()

for (const file of fs.existsSync(TRIPS_DIR) ? fs.readdirSync(TRIPS_DIR) : []) {
  if (!file.endsWith('.json')) continue
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(TRIPS_DIR, file), 'utf8'))
    trips.set(doc.id, doc)
    console.log(`Рейс: ${doc.title}, инцидентов ${doc.legs.length}`)
  } catch (err) {
    console.error(`Рейс ${file} не прочитан: ${err.message}`)
  }
}

/** Инциденты рейса в опубликованных версиях, упорядоченные по километру. */
function tripLegs(trip) {
  const out = []
  for (const leg of trip.legs ?? []) {
    const scenario = scenDb.publishedById(leg.scenario)
    if (scenario) out.push({ ...leg, scenario })
  }
  return out.sort(
    (a, b) => (a.scenario.context?.startKm ?? 0) - (b.scenario.context?.startKm ?? 0)
  )
}

/** Полный пакет рейса для клиента: линия, инциденты, перегоны между ними. */
function tripPackage(trip, mode) {
  const line = getLine(trip.line)
  const legs = tripLegs(trip)
  const gaps = []
  for (let i = 1; i < legs.length; i += 1) {
    gaps.push({
      index: i,
      fromKm: legs[i - 1].scenario.context?.startKm ?? 0,
      toKm: legs[i].scenario.context?.startKm ?? 0,
      gapSec: line
        ? gapBetween(line, trip.service, legs[i - 1].scenario.context?.startKm ?? 0,
            legs[i].scenario.context?.startKm ?? 0)
        : 0
    })
  }
  return {
    trip: { ...trip, legs: legs.map(({ scenario, ...rest }) => ({ ...rest, scenario: scenario.id })) },
    line,
    gaps,
    scenarios: legs.map((l) => forMode(l.scenario, mode))
  }
}

// ---------------------------------------------------------------------------
// Подготовка графа под режим прохождения
// ---------------------------------------------------------------------------

/**
 * В экзамене подсказки не отдаются вовсе.
 *
 * Иначе разбор ответа лежит в том же JSON, что и вопрос: достаточно открыть
 * инструменты разработчика, чтобы увидеть эталонный путь и текст «верно».
 * В тренировке всё наоборот — там объяснение и есть учебный материал.
 */
function forMode(scenario, mode) {
  if (mode !== 'exam') return scenario
  const strip = (o) => {
    const { feedback, sop, mentorNote, hint, ...rest } = o
    return rest
  }
  const nodes = {}
  for (const [id, node] of Object.entries(scenario.nodes)) {
    nodes[id] = {
      ...strip(node),
      choices: node.choices?.map(strip),
      blocks: node.blocks?.map(strip),
      items: node.items?.map(strip)
    }
    for (const k of ['choices', 'blocks', 'items']) if (!nodes[id][k]) delete nodes[id][k]
  }
  const { reference, ...head } = scenario
  return { ...head, nodes, examMode: true }
}

// ---------------------------------------------------------------------------
// Приём рейса — самое важное место сервера
// ---------------------------------------------------------------------------

async function submitRun(req, res, user) {
  const body = await readBody(req)
  if (!body) return bad(res, 'тело запроса не разобрано')

  const scenario = scenDb.exact(str(body.scenarioId, 64), int(body.scenarioVersion, 1, 1e6))
  if (!scenario) return bad(res, 'такой версии сценария нет', 404)
  if (scenario.status !== 'published') return bad(res, 'версия не опубликована', 409)

  const mode = ['practice', 'exam', 'duel'].includes(body.mode) ? body.mode : 'practice'
  const path_ = body.path ?? {}

  const run = grade(scenario, path_, {
    strict: true,
    runsTotal: runsDb.countOfUser(user.id) + 1,
    // Текущий рейс ещё не в базе, но он уже состоялся: без него достижение
    // «неделя без пропусков» не выдавалось бы именно в седьмой день.
    streakDays: streakDays([Date.now(), ...runsDb.daysOfUser(user.id)], Date.now()),
    duelsReviewed: duels.reviewedBy(user.id)
  })

  const id = uid('run_')
  const status = run.ok ? 'scored' : 'disputed'

  runsDb.insert({
    id, userId: user.id,
    scenarioId: scenario.id, scenarioVersion: scenario.version,
    mode, status,
    startedAt: Date.parse(path_.startedAt) || null,
    finishedAt: Date.parse(path_.finishedAt) || null,
    score: run.score, maxScore: run.maxScore, scorePct: run.scorePct,
    safety: run.world.safety, loyalty: run.world.loyalty, carMood: run.world.carMood,
    stressPeak: run.stressPeak, tripSec: run.tripSec, lostSec: run.lostSec,
    sopMatched: run.sopMatched, sopTotal: run.sopTotal, verdict: run.verdict,
    competencyPct: run.competencyPct, achievements: run.achievements,
    path: path_, rejected: run.rejected
  })

  let fresh = []
  if (run.ok) {
    fresh = achDb.grant(user.id, run.achievements, id)
    nodeStats.bump(scenario.id, scenario.version, run.visited)
    const prev = srs.ofUser(user.id).find((s) => s.scenarioId === scenario.id)
    const box = nextBox(prev?.box ?? 0, run.scorePct)
    srs.upsert(user.id, scenario.id, box, Date.now() + dueAfter(box), run.scorePct)
  } else {
    // Отклонённое прохождение не пропадает: оно уходит методисту как спорное.
    // Молча терять результат сотрудника нельзя — он потратил на него время.
    audit(user.login, 'run_disputed', `${scenario.id}@${scenario.version}: ${run.rejected.join('; ')}`)
  }

  ok(res, {
    ok: true,
    runId: id,
    status,
    result: run,
    freshAchievements: fresh,
    reference: scenario.reference ?? [],
    annotations: annotationsOf(scenario)
  })
}

/**
 * Приём смены целиком.
 *
 * Тот же принцип, что и с одиночным инцидентом: клиент присылает пути по
 * каждому инциденту, сервер проигрывает их подряд своим ядром, сам переносит
 * состояние между ними и сам считает свёртку. Подделать рейс не проще,
 * чем отдельный эпизод, — проверок ровно столько же, только четыре раза.
 */
async function submitTrip(req, res, user) {
  const body = await readBody(req)
  if (!body) return bad(res, 'тело запроса не разобрано')

  const trip = trips.get(str(body.tripId, 64))
  if (!trip) return bad(res, 'такого рейса нет', 404)

  const legs = tripLegs(trip)
  if (legs.length !== (trip.legs ?? []).length) {
    return bad(res, 'не все инциденты рейса опубликованы', 409)
  }

  const scenarios = Object.fromEntries(legs.map((l) => [l.scenario.id, l.scenario]))
  const ordered = { ...trip, legs: legs.map((l) => ({ ...l, scenario: l.scenario.id })) }

  const result = gradeTrip(ordered, scenarios, body.path ?? {}, {
    strict: true,
    line: getLine(trip.line),
    runsTotal: runsDb.countOfUser(user.id) + 1,
    streakDays: streakDays([Date.now(), ...runsDb.daysOfUser(user.id)], Date.now()),
    duelsReviewed: duels.reviewedBy(user.id)
  })

  const id = uid('run_')
  const status = result.ok ? 'scored' : 'disputed'
  const startedAt = Date.parse(body.path?.startedAt) || null
  const finishedAt = Date.parse(body.path?.finishedAt) || null

  runsDb.insert({
    id, userId: user.id,
    scenarioId: trip.id, scenarioVersion: 1,
    mode: 'trip', status,
    startedAt, finishedAt,
    score: result.score, maxScore: result.maxScore, scorePct: result.scorePct,
    safety: result.safetyAvg,
    loyalty: null,
    carMood: result.legs.at(-1)?.run.world.carMood ?? null,
    stressPeak: result.stressPeak,
    tripSec: result.tripSec, lostSec: result.lostSec,
    sopMatched: result.sopMatched, sopTotal: result.sopTotal,
    verdict: result.ok ? 'good' : 'partial',
    competencyPct: result.competencyPct,
    achievements: result.achievements,
    path: { ...body.path, legVersions: legs.map((l) => ({ id: l.scenario.id, version: l.scenario.version })) },
    rejected: result.rejected
  })

  let fresh = []
  if (result.ok) {
    // Достижения смены плюс всё, что заработано внутри инцидентов.
    const all = [...new Set([...result.achievements, ...result.legs.flatMap((l) => l.run.achievements)])]
    fresh = achDb.grant(user.id, all, id)
    for (const l of result.legs) {
      nodeStats.bump(l.scenarioId, l.version, l.run.visited)
      const prev = srs.ofUser(user.id).find((x) => x.scenarioId === l.scenarioId)
      const box = nextBox(prev?.box ?? 0, l.run.scorePct)
      srs.upsert(user.id, l.scenarioId, box, Date.now() + dueAfter(box), l.run.scorePct)
    }
  } else {
    audit(user.login, 'trip_disputed', `${trip.id}: ${result.rejected.join('; ')}`)
  }

  ok(res, { ok: true, runId: id, status, result, freshAchievements: fresh })
}

/**
 * Пояснения для разбора: что сказал бы наставник и на какой пункт СОП опереться.
 * В экзамене они не уходили на клиент до сдачи — теперь можно.
 */
function annotationsOf(scenario) {
  const out = {}
  for (const [id, node] of Object.entries(scenario.nodes)) {
    out[id] = {
      hint: node.hint ?? '',
      feedback: node.feedback ?? '',
      sop: node.sop ?? '',
      mentorNote: node.mentorNote ?? '',
      choices: Object.fromEntries(
        (node.choices ?? []).map((c) => [c.id, {
          feedback: c.feedback ?? '', sop: c.sop ?? '', mentorNote: c.mentorNote ?? ''
        }])
      )
    }
  }
  return out
}

/**
 * Обстановка сценария одной строкой: где, с какой скоростью, до чего.
 * Считается на сервере, чтобы список рейсов не пересчитывал физику
 * для двенадцати карточек на каждом открытии экрана.
 */
function settingOf(scenario) {
  const line = lineOf(scenario)
  if (!line) return null
  const w = initialWorld(scenario)
  return {
    km: w.km,
    speedKmh: w.speedKmh,
    stopName: w.stopName,
    toStopSec: w.toStopSec,
    brakingM: w.brakingM,
    lineTitle: line.title
  }
}

// ---------------------------------------------------------------------------
// Профиль
// ---------------------------------------------------------------------------

function buildProfile(user) {
  const history = runsDb.ofUser(user.id, 200)
  const scored = history.filter((r) => r.status === 'scored')
  const competency = profileCompetency(
    scored.map((r) => ({ ...r, finishedAt: r.finishedAt ?? r.createdAt, status: 'scored' }))
  )
  const owned = achDb.ofUser(user.id)
  const ownedIds = new Set(owned.map((a) => a.id))
  const published = scenDb.published()

  return {
    user: publicUser(user),
    competency,
    competencies: COMPETENCIES,
    runs: scored.length,
    disputed: history.length - scored.length,
    streak: streakDays(runsDb.daysOfUser(user.id), Date.now()),
    bestPct: scored.reduce((m, r) => Math.max(m, r.scorePct), 0),
    // Достижения инцидентов и достижения смены живут в одном списке:
    // для сотрудника это одна коллекция, а не два разных зачёта.
    achievements: [...ACHIEVEMENTS, ...TRIP_ACHIEVEMENTS].map((a) => ({
      id: a.id, title: a.title, condition: a.condition, icon: a.icon,
      owned: ownedIds.has(a.id),
      at: owned.find((o) => o.id === a.id)?.at ?? null
    })),
    history: history.slice(0, 25).map((r) => ({
      id: r.id, scenarioId: r.scenarioId, mode: r.mode, status: r.status,
      scorePct: r.scorePct, verdict: r.verdict, at: r.createdAt,
      title: published.find((s) => s.id === r.scenarioId)?.title
        ?? trips.get(r.scenarioId)?.title
        ?? r.scenarioId
    })),
    next: recommend(published, { competency }, srs.ofUser(user.id), Date.now()).slice(0, 4)
  }
}

// ---------------------------------------------------------------------------
// Кабинет руководителя
// ---------------------------------------------------------------------------

function managerOverview() {
  const conductors = users.byRole('conductor')
  const rows = conductors.map((u) => {
    const scored = runsDb.ofUser(u.id, 200).filter((r) => r.status === 'scored')
    const competency = profileCompetency(
      scored.map((r) => ({ ...r, finishedAt: r.finishedAt ?? r.createdAt, status: 'scored' }))
    )
    const status = readiness(competency, scored.length)
    return {
      id: u.id, name: u.name, depot: u.depot, brigade: u.brigade, tabNumber: u.tab_number,
      runs: scored.length,
      lastAt: scored[0]?.createdAt ?? null,
      competency,
      weakest: Object.entries(competency).sort((a, b) => a[1] - b[1])[0]?.[0] ?? null,
      status,
      ready: status === 'ready'
    }
  })

  const brigades = new Map()
  for (const r of rows) {
    const key = `${r.depot} · ${r.brigade}`
    if (!brigades.has(key)) brigades.set(key, { key, depot: r.depot, brigade: r.brigade, people: [] })
    brigades.get(key).people.push(r)
  }

  return {
    competencies: COMPETENCIES,
    readinessRule: READINESS_TEXT,
    people: rows,
    brigades: [...brigades.values()].map((b) => {
      const avg = {}
      for (const c of COMPETENCIES) {
        const vals = b.people.map((p) => p.competency[c.id]).filter((v) => typeof v === 'number')
        if (vals.length) avg[c.id] = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
      }
      return {
        ...b,
        size: b.people.length,
        ready: b.people.filter((p) => p.status === 'ready').length,
        near: b.people.filter((p) => p.status === 'near').length,
        competency: avg
      }
    })
  }
}

/**
 * Где массово ошибаются.
 *
 * Если больше половины бригады на одном узле уходит не туда, проблема
 * не в людях, а в регламенте или в инструктаже. Это самостоятельная
 * ценность для заказчика, которую не даёт ни один тест.
 */
function graphStats(scenarioId) {
  const scenario = scenDb.publishedById(scenarioId)
  if (!scenario) return null
  const raw = nodeStats.forScenario(scenario.id, scenario.version)
  const refPairs = new Map()
  const ref = scenario.reference ?? []
  for (let i = 0; i < ref.length - 1; i += 1) refPairs.set(ref[i], ref[i + 1])

  const byNode = new Map()
  for (const r of raw) {
    if (!byNode.has(r.node_id)) byNode.set(r.node_id, { node: r.node_id, total: 0, choices: [] })
    const n = byNode.get(r.node_id)
    n.total += r.count
    n.choices.push({ id: r.choice_id, count: r.count })
  }

  const nodes = [...byNode.values()].map((n) => {
    const node = scenario.nodes[n.node]
    const multi = MULTI_TYPES.has(node?.type)
    const refNext = refPairs.get(n.node)
    const label = (id) => elementsOf(node ?? {}).find((x) => x.id === id)?.text ?? id

    // Доля верных веток считается только там, где ветка одна.
    // В узле с множественным выбором «правильность» — это набор и порядок
    // отметок, а не переход: он там всегда один и тот же.
    const right = multi ? null : n.choices
      .filter((c) => (node?.choices ?? []).find((x) => x.id === c.id)?.next === refNext)
      .reduce((s, c) => s + c.count, 0)

    const runs = multi
      ? Math.max(...n.choices.map((c) => c.count), 1)
      : n.total

    return {
      ...n,
      text: node?.text ?? '',
      type: node?.type ?? 'dialog',
      multi,
      runs,
      onReference: refPairs.has(n.node) && !multi,
      correctShare: multi || !n.total ? null : Math.round((right / n.total) * 100),
      choices: n.choices.map((c) => ({
        ...c,
        text: c.id.startsWith('(') ? c.id : label(c.id),
        share: Math.round((c.count / runs) * 100)
      })).sort((a, b) => b.count - a.count)
    }
  })

  return {
    scenario: { id: scenario.id, version: scenario.version, title: scenario.title },
    nodes: nodes.sort((a, b) => (a.correctShare ?? 101) - (b.correctShare ?? 101)),
    problems: nodes.filter((n) => n.onReference && n.correctShare !== null && n.correctShare < 50)
  }
}

// ---------------------------------------------------------------------------
// Статика
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon'
}

function serveStatic(req, res, url) {
  if (!fs.existsSync(DIST)) {
    return send(res, 404, 'Сборка клиента отсутствует. Запустите npm run build или npm run dev.')
  }
  const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)
  // Раскрываем путь и проверяем, что он остался внутри dist. Разбираться,
  // какие последовательности «..» отсеклись при нормализации, а какие нет,
  // — плохой способ защищаться от обхода каталога: надёжнее сравнить итог.
  const resolved = path.resolve(DIST, `.${path.posix.normalize(rel)}`)
  const inside = resolved === DIST || resolved.startsWith(DIST + path.sep)
  const file = inside ? resolved : ''
  const target = file && fs.existsSync(file) && fs.statSync(file).isFile()
    ? file
    : path.join(DIST, 'index.html')
  const ext = path.extname(target)
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=604800'
  })
  fs.createReadStream(target).pipe(res)
}

// ---------------------------------------------------------------------------
// Маршрутизация
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  cors(req, res)
  if (req.method === 'OPTIONS') return send(res, 204, '')

  const url = new URL(req.url, 'http://localhost')
  const p = url.pathname
  const ip = clientIp(req)

  if (!p.startsWith('/api/')) return serveStatic(req, res, url)

  try {
    // ------------------------------------------------------------ открытое
    if (p === '/api/health') {
      return ok(res, {
        ok: true,
        seeded: !isEmpty(),
        // Пароль отсюда не уходит: сообщается только, что база заполнена
        // демонстрационными данными с паролем по умолчанию. Клиент знает
        // это значение из своей же поставки и может подставить его в форму.
        demoDefaultPassword: meta.get('demo_default_password') === '1',
        time: new Date().toISOString()
      })
    }

    if (p === '/api/login' && req.method === 'POST') {
      if (rateLimited('login', ip)) return bad(res, 'слишком часто', 429)
      const body = await readBody(req)
      if (!body) return bad(res, 'тело запроса не разобрано')
      const r = auth.login(str(body.login, 64), str(body.password, 200))
      if (r.error) {
        audit(str(body.login, 64), 'login_failed', ip)
        return bad(res, r.error, 401)
      }
      audit(r.user.login, 'login', ip)
      return send(res, 200, { ok: true, user: publicUser(r.user) },
        { 'set-cookie': auth.sessionCookie(r.sid) })
    }

    const user = auth.current(req)

    if (p === '/api/logout' && req.method === 'POST') {
      auth.logout(req.headers.cookie?.match(/ekipazh_sid=([^;]+)/)?.[1])
      return send(res, 200, { ok: true }, { 'set-cookie': auth.clearCookie() })
    }

    if (p === '/api/me') {
      return ok(res, { ok: true, user: user ? publicUser(user) : null })
    }

    if (!user) return bad(res, 'нужен вход', 401)
    if (rateLimited('read', user.id)) return bad(res, 'слишком часто', 429)

    // ---------------------------------------------------------- проводник
    if (p === '/api/lines' && req.method === 'GET') {
      return ok(res, { ok: true, lines: knownLines() })
    }

    if (p === '/api/trips' && req.method === 'GET') {
      return ok(res, {
        ok: true,
        trips: [...trips.values()].map((t) => {
          const legs = tripLegs(t)
          const line = getLine(t.line)
          return {
            id: t.id, title: t.title, summary: t.summary, difficulty: t.difficulty,
            lineTitle: line?.title ?? '',
            serviceTitle: line?.services.find((s) => s.id === t.service)?.title ?? '',
            legs: legs.length,
            ready: legs.length === (t.legs ?? []).length,
            estimatedSec: legs.reduce((sum, l) => sum + (l.scenario.estimatedSec ?? 180), 0),
            fromKm: legs[0]?.scenario.context?.startKm ?? 0,
            toKm: legs.at(-1)?.scenario.context?.startKm ?? 0
          }
        })
      })
    }

    if (p.startsWith('/api/trips/') && req.method === 'GET') {
      const trip = trips.get(decodeURIComponent(p.slice('/api/trips/'.length)))
      if (!trip) return bad(res, 'рейс не найден', 404)
      return ok(res, { ok: true, ...tripPackage(trip, url.searchParams.get('mode')) })
    }

    if (p === '/api/trip-runs' && req.method === 'POST') {
      if (rateLimited('run', user.id)) return bad(res, 'слишком часто', 429)
      return submitTrip(req, res, user)
    }

    if (p === '/api/scenarios' && req.method === 'GET') {
      return ok(res, {
        ok: true,
        scenarios: scenDb.published().map((s) => ({
          id: s.id, version: s.version, title: s.title, summary: s.summary,
          mode: s.mode, difficulty: s.difficulty, competencies: s.competencies,
          estimatedSec: s.estimatedSec, context: s.context,
          maxScore: analyze(s).maxScore,
          setting: settingOf(s)
        }))
      })
    }

    if (p.startsWith('/api/scenarios/') && req.method === 'GET') {
      const s = scenDb.publishedById(decodeURIComponent(p.slice('/api/scenarios/'.length)))
      if (!s) return bad(res, 'сценарий не найден', 404)
      return ok(res, { ok: true, scenario: forMode(s, url.searchParams.get('mode')), line: lineOf(s) })
    }

    if (p === '/api/runs' && req.method === 'POST') {
      if (rateLimited('run', user.id)) return bad(res, 'слишком часто', 429)
      return submitRun(req, res, user)
    }

    if (p.startsWith('/api/runs/') && req.method === 'GET') {
      const run = runsDb.byId(p.slice('/api/runs/'.length))
      if (!run) return bad(res, 'рейс не найден', 404)
      if (run.userId !== user.id && user.role === 'conductor') return bad(res, 'чужой рейс', 403)

      // Разбор смены: отдаём каждый инцидент в той версии, в которой он игрался,
      // иначе повтор пути показал бы не то, что видел проводник.
      if (run.mode === 'trip') {
        const trip = trips.get(run.scenarioId)
        if (!trip) return bad(res, 'рейс не найден', 404)
        const versions = run.path?.legVersions ?? []
        const scenarios = versions
          .map((v) => scenDb.exact(v.id, v.version))
          .filter(Boolean)
        return ok(res, {
          ok: true,
          run,
          trip,
          line: getLine(trip.line),
          scenarios,
          annotations: Object.fromEntries(scenarios.map((sc) => [sc.id, annotationsOf(sc)])),
          references: Object.fromEntries(scenarios.map((sc) => [sc.id, sc.reference ?? []]))
        })
      }

      const scenario = scenDb.exact(run.scenarioId, run.scenarioVersion)
      return ok(res, {
        ok: true, run, scenario, line: lineOf(scenario),
        reference: scenario?.reference ?? [],
        annotations: scenario ? annotationsOf(scenario) : {},
        stats: graphStats(run.scenarioId)
      })
    }

    if (p === '/api/profile') return ok(res, { ok: true, ...buildProfile(user) })

    if (p === '/api/leaderboard') {
      const season = str(url.searchParams.get('season'), 7) || seasonOf()
      return ok(res, {
        ok: true, season,
        brigades: leaderboard.brigades(season),
        personal: leaderboard.personal(season).map((r) => ({
          ...r, mine: r.id === user.id,
          achievements: achDb.countOfUser(r.id)
        }))
      })
    }

    if (p === '/api/duels' && req.method === 'GET') {
      return ok(res, { ok: true, duels: duels.forUser(user.id), colleagues:
        users.byRole('conductor').filter((u) => u.id !== user.id).map(publicUser) })
    }

    if (p === '/api/duels' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body) return bad(res, 'тело запроса не разобрано')
      const id = uid('duel_')
      duels.create({
        id, scenarioId: str(body.scenarioId, 64),
        fromUser: user.id, toUser: str(body.toUser, 64), fromRun: str(body.runId, 64)
      })
      return ok(res, { ok: true, id })
    }

    if (p.startsWith('/api/duels/') && p.endsWith('/close') && req.method === 'POST') {
      const body = await readBody(req)
      duels.close(p.split('/')[3], str(body?.runId, 64), str(body?.comment, 800))
      return ok(res)
    }

    // ---------------------------------------------------------- методист
    if (p.startsWith('/api/methodist/')) {
      if (!['methodist', 'manager'].includes(user.role)) return bad(res, 'нет доступа', 403)

      if (p === '/api/methodist/scenarios') {
        return ok(res, { ok: true, versions: scenDb.allVersions() })
      }
      if (p.startsWith('/api/methodist/scenarios/')) {
        const s = scenDb.latest(decodeURIComponent(p.slice('/api/methodist/scenarios/'.length)))
        if (!s) return bad(res, 'сценарий не найден', 404)
        return ok(res, { ok: true, scenario: s, analysis: analyze(s) })
      }
      if (p === '/api/methodist/validate' && req.method === 'POST') {
        const body = await readBody(req)
        if (!body?.scenario) return bad(res, 'нет сценария')
        const report = validate(body.scenario)
        return ok(res, {
          ok: true, report,
          analysis: report.ok ? analyze(body.scenario) : null
        })
      }
      if (p === '/api/methodist/publish' && req.method === 'POST') {
        if (rateLimited('write', user.id)) return bad(res, 'слишком часто', 429)
        const body = await readBody(req)
        if (!body?.scenario) return bad(res, 'нет сценария')
        const report = validate(body.scenario)
        if (!report.ok) return send(res, 422, { ok: false, error: 'сценарий не прошёл проверку', report })
        const saved = scenDb.save(body.scenario, user.id, 'published')
        audit(user.login, 'scenario_published', `${saved.id}@${saved.version}`)
        return ok(res, { ok: true, scenario: saved, report })
      }
      if (p.startsWith('/api/methodist/stats/')) {
        const stats = graphStats(decodeURIComponent(p.slice('/api/methodist/stats/'.length)))
        if (!stats) return bad(res, 'сценарий не найден', 404)
        return ok(res, { ok: true, ...stats })
      }
    }

    // ------------------------------------------------------ руководитель
    if (p.startsWith('/api/manager/')) {
      if (user.role !== 'manager') return bad(res, 'нет доступа', 403)
      if (p === '/api/manager/overview') return ok(res, { ok: true, ...managerOverview() })
    }

    return bad(res, 'нет такого метода', 404)
  } catch (err) {
    console.error('[api]', p, err)
    return bad(res, 'внутренняя ошибка', 500)
  }
})

server.listen(PORT, () => {
  console.log(`ЭКИПАЖ 400 — сервер на http://localhost:${PORT}`)
  if (isEmpty()) console.log('База пуста. Заполните демо-данными: npm run seed')
})
