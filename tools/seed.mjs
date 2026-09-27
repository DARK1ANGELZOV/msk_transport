/**
 * Наполнение базы демонстрационными данными.
 *
 * Пустой экран на защите хуже отсутствующей функции: жюри должно открыть
 * рейтинг и увидеть рейтинг, а не подпись «пока никто не играл». Поэтому
 * здесь заводятся учётки, загружаются сценарии и синтезируются прохождения
 * за последние три недели.
 *
 * Прохождения не выдуманы, а **сыграны**: скрипт ходит по настоящему графу,
 * выбирает варианты с разной вероятностью в зависимости от «уровня» сотрудника
 * и прогоняет получившийся путь через то же ядро, что и сервер. Поэтому
 * профили компетенций, статистика по узлам и лидерборд в демо согласованы
 * между собой — их нельзя было бы согласовать, придумывая числа руками.
 *
 *   npm run seed            заполнить (существующая база не трогается)
 *   npm run seed -- --reset удалить базу и создать заново
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const RESET = process.argv.includes('--reset')
const DB_FILE = process.env.DB_FILE || path.join(process.env.DATA_DIR || 'data', 'ekipazh.sqlite')
if (RESET) {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = DB_FILE + suffix
    if (!fs.existsSync(file)) continue
    try {
      fs.rmSync(file)
    } catch (err) {
      // Не молчим: самая частая причина — запущенный сервер держит файл.
      // Тихо продолжить здесь означало бы «заполнил», а на деле база старая,
      // и человек полдня удивляется, почему правки не видны.
      console.error(`Не удалось удалить ${file}: ${err.message}`)
      console.error('Скорее всего, база занята запущенным сервером. Остановите его и повторите.')
      process.exit(1)
    }
  }
}

const db = await import('../server/lib/db.js')
const { hashPassword, MIN_PASSWORD_LENGTH } = await import('../server/lib/auth.js')
const { grade } = await import('../engine/index.js')
const { MULTI_TYPES, TERMINAL_TYPES, meetsRequires, initialWorld } = await import('../engine/model.js')
const { nextBox, dueAfter } = await import('../engine/recommend.js')
const { registerLine, getLine } = await import('../engine/line.js')
const { gapBetween, gradeTrip, recover } = await import('../engine/trip.js')

// Без линии сценарий не знает своего километра: прохождения посчитались бы
// по запасной ветке модели и разошлись бы с тем, что покажет сервер.
for (const f of fs.readdirSync('content/lines').filter((n) => n.endsWith('.json'))) {
  registerLine(JSON.parse(fs.readFileSync(path.join('content/lines', f), 'utf8')))
}

// ---------------------------------------------------------------------------
// Воспроизводимая случайность: одинаковый seed даёт одинаковую демо-базу,
// иначе на репетиции питча и на защите будут разные цифры.
// ---------------------------------------------------------------------------

let state = 20260925
const rnd = () => {
  state = (state * 1664525 + 1013904223) % 4294967296
  return state / 4294967296
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

// ---------------------------------------------------------------------------
// Люди
// ---------------------------------------------------------------------------

const DEFAULT_PASSWORD = 'krechet-2028'
const PASSWORD = process.env.SEED_PASSWORD || DEFAULT_PASSWORD

if (PASSWORD.length < MIN_PASSWORD_LENGTH) {
  console.error(`SEED_PASSWORD короче ${MIN_PASSWORD_LENGTH} символов — так учётки не заводим.`)
  process.exit(1)
}

const PEOPLE = [
  ['conductor', 'ivanova', 'Ирина Иванова', 'Депо ВСМ Москва', 'Бригада 1', '410233', 0.9],
  ['conductor', 'petrov', 'Артём Петров', 'Депо ВСМ Москва', 'Бригада 1', '410287', 0.75],
  ['conductor', 'sidorova', 'Мария Сидорова', 'Депо ВСМ Москва', 'Бригада 1', '410301', 0.55],
  ['conductor', 'kozlov', 'Денис Козлов', 'Депо ВСМ Москва', 'Бригада 2', '410344', 0.8],
  ['conductor', 'nikitina', 'Ольга Никитина', 'Депо ВСМ Москва', 'Бригада 2', '410358', 0.45],
  ['conductor', 'volkov', 'Сергей Волков', 'Депо ВСМ Москва', 'Бригада 2', '410372', 0.65],
  ['conductor', 'lebedeva', 'Анна Лебедева', 'Депо ВСМ Петербург', 'Бригада 7', '720114', 0.85],
  ['conductor', 'morozov', 'Илья Морозов', 'Депо ВСМ Петербург', 'Бригада 7', '720128', 0.6],
  ['conductor', 'orlova', 'Юлия Орлова', 'Депо ВСМ Петербург', 'Бригада 7', '720139', 0.35],
  ['conductor', 'demo', 'Демо Проводник', 'Депо ВСМ Москва', 'Бригада 1', '410999', 0.7],
  ['methodist', 'method', 'Елена Громова', 'Учебный центр ВСМ', '', '000112', 0],
  ['manager', 'boss', 'Виктор Асташев', 'Депо ВСМ Москва', '', '000045', 0]
]

function seedUsers() {
  const created = []
  for (const [role, login, name, depot, brigade, tabNumber, skill] of PEOPLE) {
    if (db.users.byLogin(login)) {
      created.push({ login, role, skill, id: db.users.byLogin(login).id, existed: true })
      continue
    }
    const { salt, hash } = hashPassword(PASSWORD)
    const u = db.users.create({
      id: db.uid('u_'), login, name, role, depot, brigade, tabNumber, salt, hash
    })
    created.push({ login, role, skill, id: u.id, existed: false })
  }
  return created
}

// ---------------------------------------------------------------------------
// Сценарии
// ---------------------------------------------------------------------------

function seedScenarios(authorId) {
  const dir = 'content/scenarios'
  const out = []
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    const existing = db.scenarios.publishedById(doc.id)
    // Опубликованное не переписывается: те, кто уже играет, доигрывают свою
    // версию. Но и молчать нельзя — изменённый файл контента должен доехать
    // до базы, иначе методист правит сценарий, а тренажёр учит по старому.
    if (existing && canon(existing) === canon(doc)) {
      out.push(existing)
      continue
    }
    const saved = db.scenarios.save(doc, authorId, 'published')
    if (existing) console.log(`  ${doc.id}: контент изменился, версия ${saved.version}`)
    out.push(saved)
  }
  return out
}

/** Содержимое сценария без служебных полей, с устойчивым порядком ключей. */
function canon(scenario) {
  const skip = new Set(['version', 'status'])
  return JSON.stringify(scenario, (key, value) => {
    if (skip.has(key)) return undefined
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
    }
    return value
  })
}

// ---------------------------------------------------------------------------
// Синтез прохождения: скрипт действительно играет в игру
// ---------------------------------------------------------------------------

/**
 * Насколько «хорош» вариант с точки зрения обучения: сумма эффектов.
 * По этой оценке сильный сотрудник чаще выбирает верное, слабый — чаще нет.
 */
function valueOf(el) {
  const e = el.effects ?? {}
  const scales = (e.safety ?? 0) * 2 + (e.loyalty ?? 0) + (e.carMood ?? 0) - (e.stress ?? 0)
  const comp = Object.values(e.competency ?? {}).reduce((s, v) => s + v, 0)
  return scales + comp
}

function playScenario(scenario, skill) {
  const world = initialWorld(scenario)
  const steps = []
  const breaths = []
  let cursor = scenario.entry
  let guard = 0

  while (guard++ < 30) {
    const node = scenario.nodes[cursor]
    if (!node || TERMINAL_TYPES.has(node.type)) break

    const limit = node.limitSec ?? 0
    // Слабый сотрудник думает дольше и чаще не успевает.
    const thinkSec = Math.min(limit || 12, 2 + rnd() * (limit ? limit * (1.25 - skill) : 8))
    const timedOut = limit > 0 && rnd() > 0.82 + skill * 0.15

    if (timedOut) {
      steps.push({ node: cursor, timeout: true })
      cursor = node.onTimeout
      continue
    }

    if (MULTI_TYPES.has(node.type)) {
      const pool = [...(node.blocks ?? []), ...(node.items ?? [])]
      const good = pool.filter((el) => valueOf(el) > 0)
      const bad = pool.filter((el) => valueOf(el) <= 0)
      const chosen = good.filter(() => rnd() < 0.45 + skill * 0.5)
      if (!chosen.length && good.length) chosen.push(good[0])
      if (bad.length && rnd() > 0.35 + skill * 0.55) chosen.push(pick(bad))
      const order = node.correctOrder ?? []
      const sorted = rnd() < 0.3 + skill * 0.6
        ? chosen.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
        : chosen.sort(() => rnd() - 0.5)
      steps.push({
        node: cursor,
        choices: sorted.map((el) => el.id),
        deliberateMs: Math.round(thinkSec * 1000)
      })
      cursor = node.next
      continue
    }

    const options = (node.choices ?? []).filter((c) => meetsRequires(c.requires, world))
    if (!options.length) break
    const ranked = [...options].sort((a, b) => valueOf(b) - valueOf(a))
    const choice = rnd() < 0.25 + skill * 0.65 ? ranked[0] : pick(ranked.slice(1).length ? ranked.slice(1) : ranked)
    steps.push({ node: cursor, choice: choice.id, deliberateMs: Math.round(thinkSec * 1000) })
    if (rnd() > 0.88) breaths.push({ afterStep: steps.length - 1 })

    // Грубая модель мира: нужна только чтобы не предлагать скрытые варианты.
    for (const ev of scenario.worldEvents ?? []) {
      if ((ev.atElapsedSec ?? 1e9) <= steps.length * 25) Object.assign(world, ev.set ?? {})
    }
    cursor = choice.next
  }

  const totalMs = steps.reduce((s, st) => s + (st.deliberateMs ?? 15_000), 0)
  return { steps, breaths, totalMs }
}

function seedRuns(people, scenarios) {
  const conductors = people.filter((p) => p.role === 'conductor')
  let inserted = 0
  let disputed = 0

  for (const person of conductors) {
    if (db.runs.countOfUser(person.id) > 0) continue
    const count = 4 + Math.floor(rnd() * 8)
    for (let i = 0; i < count; i += 1) {
      const scenario = pick(scenarios)
      const { steps, breaths, totalMs } = playScenario(scenario, person.skill)
      if (!steps.length) continue

      const daysAgo = Math.floor(rnd() * 21)
      const finished = Date.now() - daysAgo * 86_400_000 - Math.floor(rnd() * 8) * 3_600_000
      const started = finished - totalMs - 4000

      const path_ = {
        startedAt: new Date(started).toISOString(),
        finishedAt: new Date(finished).toISOString(),
        steps, breaths
      }
      const run = grade(scenario, path_, {
        runsTotal: db.runs.countOfUser(person.id) + 1,
        streakDays: 0,
        duelsReviewed: 0
      })

      const id = db.uid('run_')
      const status = run.ok ? 'scored' : 'disputed'
      db.runs.insert({
        id, userId: person.id,
        scenarioId: scenario.id, scenarioVersion: scenario.version,
        mode: rnd() > 0.85 ? 'exam' : 'practice', status,
        startedAt: started, finishedAt: finished,
        score: run.score, maxScore: run.maxScore, scorePct: run.scorePct,
        safety: run.world.safety, loyalty: run.world.loyalty, carMood: run.world.carMood,
        stressPeak: run.stressPeak, tripSec: run.tripSec, lostSec: run.lostSec,
        sopMatched: run.sopMatched, sopTotal: run.sopTotal, verdict: run.verdict,
        competencyPct: run.competencyPct, achievements: run.achievements,
        path: path_, rejected: run.rejected
      })
      // Дата создания задаётся отдельно: insert ставит «сейчас», а нам нужна история.
      db.db.prepare('UPDATE runs SET created_at = ? WHERE id = ?').run(finished, id)

      if (run.ok) {
        db.achievements.grant(person.id, run.achievements, id)
        db.nodeStats.bump(scenario.id, scenario.version, run.visited)
        const prev = db.srs.ofUser(person.id).find((s) => s.scenarioId === scenario.id)
        const box = nextBox(prev?.box ?? 0, run.scorePct)
        db.srs.upsert(person.id, scenario.id, box, finished + dueAfter(box), run.scorePct)
        inserted += 1
      } else {
        disputed += 1
      }
    }
  }
  return { inserted, disputed }
}

// ---------------------------------------------------------------------------
// Смены
// ---------------------------------------------------------------------------

/**
 * Прохождения полной смены.
 *
 * Смена — основной режим продукта, и в демо-базе она должна быть, иначе
 * руководитель откроет готовность бригад и увидит только отдельные эпизоды.
 * Считается тем же ядром и с тем же переносом состояния, что и на сервере:
 * иначе демо показывало бы не то, что покажет живой продукт.
 */
function seedTrips(people, published) {
  const dir = 'content/trips'
  if (!fs.existsSync(dir)) return 0

  const byId = Object.fromEntries(published.map((s) => [s.id, s]))
  let made = 0

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const trip = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    const line = getLine(trip.line)
    const legs = trip.legs
      .map((l) => ({ ...l, scenario: byId[l.scenario] }))
      .filter((l) => l.scenario)
      .sort((a, b) => (a.scenario.context?.startKm ?? 0) - (b.scenario.context?.startKm ?? 0))
    if (legs.length !== trip.legs.length) continue

    const scenarios = Object.fromEntries(legs.map((l) => [l.scenario.id, l.scenario]))
    const ordered = { ...trip, legs: legs.map((l) => ({ ...l, scenario: l.scenario.id })) }

    // Смену проходят не все и не каждый день: это долгое упражнение.
    for (const person of people.filter((p) => p.role === 'conductor' && rnd() > 0.45)) {
      let carry = null
      const paths = []
      for (const [i, leg] of legs.entries()) {
        if (i > 0) {
          const gap = gapBetween(
            line, trip.service,
            legs[i - 1].scenario.context.startKm, leg.scenario.context.startKm
          )
          carry = recover(carry, gap, i).carry
        }
        const { steps, breaths } = playScenario(leg.scenario, person.skill)
        if (!steps.length) break
        paths.push({ steps, breaths })
        const run = grade(leg.scenario, { steps, breaths }, { strict: false, carry })
        carry = {
          carMood: run.world.carMood, stress: run.world.stress, flags: [...run.world.flags]
        }
      }
      if (paths.length !== legs.length) continue

      const daysAgo = Math.floor(rnd() * 14)
      const finished = Date.now() - daysAgo * 86_400_000 - Math.floor(rnd() * 6) * 3_600_000
      const tripPath = {
        startedAt: new Date(finished - 20 * 60_000).toISOString(),
        finishedAt: new Date(finished).toISOString(),
        legs: paths,
        legVersions: legs.map((l) => ({ id: l.scenario.id, version: l.scenario.version }))
      }

      const result = gradeTrip(ordered, scenarios, tripPath, { strict: false, line })
      const id = db.uid('run_')
      db.runs.insert({
        id, userId: person.id,
        scenarioId: trip.id, scenarioVersion: 1,
        mode: 'trip', status: result.ok ? 'scored' : 'disputed',
        startedAt: finished - 20 * 60_000, finishedAt: finished,
        score: result.score, maxScore: result.maxScore, scorePct: result.scorePct,
        safety: result.safetyAvg, loyalty: null,
        carMood: result.legs.at(-1)?.run.world.carMood ?? null,
        stressPeak: result.stressPeak,
        tripSec: result.tripSec, lostSec: result.lostSec,
        sopMatched: result.sopMatched, sopTotal: result.sopTotal,
        verdict: result.ok ? 'good' : 'partial',
        competencyPct: result.competencyPct,
        achievements: result.achievements,
        path: tripPath, rejected: result.rejected
      })
      db.db.prepare('UPDATE runs SET created_at = ? WHERE id = ?').run(finished, id)

      if (result.ok) {
        const all = [...new Set([
          ...result.achievements,
          ...result.legs.flatMap((l) => l.run.achievements)
        ])]
        db.achievements.grant(person.id, all, id)
        for (const l of result.legs) db.nodeStats.bump(l.scenarioId, l.version, l.run.visited)
      }
      made += 1
    }
  }
  return made
}

// ---------------------------------------------------------------------------

const people = seedUsers()
const methodist = people.find((p) => p.role === 'methodist')
const scenarios = seedScenarios(methodist?.id)
const { inserted, disputed } = seedRuns(people, scenarios)
const shifts = seedTrips(people, scenarios)

// Отметка для интерфейса: показывать ли блок демонстрационных учёток
// и можно ли подставлять пароль по умолчанию. Сам пароль здесь не хранится.
db.meta.set('demo_default_password', PASSWORD === DEFAULT_PASSWORD ? '1' : '0')

console.log(`Учётных записей: ${people.length} (новых: ${people.filter((p) => !p.existed).length})`)
console.log(`Сценариев опубликовано: ${scenarios.length}`)
console.log(`Прохождений сыграно: ${inserted}, отклонено движком: ${disputed}`)
console.log(`Полных смен сыграно: ${shifts}`)
console.log('')
console.log('Демонстрационные учётки (пароль общий, задаётся SEED_PASSWORD):')
console.log(`  проводник     demo    / ${PASSWORD}`)
console.log(`  методист      method  / ${PASSWORD}`)
console.log(`  руководитель  boss    / ${PASSWORD}`)
console.log('')
console.log('Это демонстрационные пароли. Для установки у заказчика заводите учётки заново.')
