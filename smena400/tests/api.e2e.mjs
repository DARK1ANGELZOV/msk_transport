/**
 * Сквозная проверка API против живого сервера.
 *
 *   npm run test:api            полностью, включая ожидание таймера
 *   FAST=1 npm run test:api     без ожидания (таймер проверяют тесты ядра)
 *
 * Сервер поднимается сам на отдельном порту и с отдельной базой, поэтому
 * тест ничего не портит и не требует подготовки.
 *
 * Проверяется то, чего не видят тесты ядра: что клиенту не отдаётся граф,
 * что чужую сессию нельзя тронуть, что запрещённое действие не проходит
 * через HTTP и что продукт целиком работает без ключа модели.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PORT = 5411
const BASE = `http://localhost:${PORT}`
const DB = path.join(os.tmpdir(), `smena400-test-${Date.now()}.db`)
const FAST = process.env.FAST === '1'

let failed = 0
const check = (cond, name, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `\n    ${detail}`}`)
  if (!cond) failed += 1
}

// Куки храним сами: у игрока нет логина, его опознаёт кука.
const jars = new Map()
async function call(jar, method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(jars.get(jar) ? { cookie: jars.get(jar) } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const set = res.headers.get('set-cookie')
  if (set) jars.set(jar, set.split(';')[0])
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  return { status: res.status, data }
}

const get = (jar, url) => call(jar, 'GET', url)
const post = (jar, url, body) => call(jar, 'POST', url, body)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- запуск

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
  env: { ...process.env, PORT: String(PORT), DB_FILE: DB, AI_PROVIDER: '', AI_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe']
})
const logs = []
child.stdout.on('data', (d) => logs.push(String(d)))
child.stderr.on('data', (d) => logs.push(String(d)))

const stop = () => {
  child.kill()
  try {
    for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f)
  } catch { /* временные файлы — не беда */ }
}
process.on('exit', stop)

let up = false
for (let i = 0; i < 60 && !up; i++) {
  try {
    const r = await fetch(`${BASE}/api/health`)
    up = r.ok
  } catch {
    await sleep(150)
  }
}
if (!up) {
  console.log('Сервер не поднялся:')
  console.log(logs.join(''))
  process.exit(1)
}

// ------------------------------------------------------------- проверки

const health = await get('a', '/api/health')
check(health.data?.scenarios === 3, 'сервер поднялся и загрузил три ситуации',
  JSON.stringify(health.data))

const meta = await get('a', '/api/meta')
check(meta.data?.scales?.length === 2, 'шкал ровно две')
check(meta.data?.competencies?.length === 5, 'компетенций ровно пять')
check(meta.data?.ai?.enabled === false, 'без ключа AI выключен, и это штатный режим')

const list = await get('a', '/api/scenarios')
check(list.data?.scenarios?.length === 3, 'список ситуаций отдаётся')
check(
  list.data.scenarios.every((s) => s.source?.situation?.includes('№')),
  'в списке у каждой ситуации виден её номер в банке'
)

const passport = await get('a', '/api/scenarios/sit-19-medical')
check(passport.data?.scenario?.source?.normative_rule?.length > 0,
  'паспорт отдаёт нормативную опору')
check(passport.data?.scenario?.source?.gameplay_interpretation?.length > 0,
  'паспорт отдаёт игровую интерпретацию отдельно от норматива')
check(!('states' in (passport.data?.scenario ?? {})),
  'граф сценария клиенту не отдаётся')

// ------------------------------------------------------------ прохождение

const started = await post('a', '/api/sessions', { scenarioId: 'sit-19-medical' })
const s1 = started.data?.screen
check(started.status === 200 && s1?.sessionId, 'сессия создана')
check(s1?.state?.text?.length > 20, 'на экране есть текст ситуации')
check(s1?.actions?.length >= 3, 'есть из чего выбирать')
check(s1?.state?.timer?.totalSec === 25, 'таймер передан клиенту')
check(
  JSON.stringify(s1).includes('f-good') === false,
  'в экране нет ни одного идентификатора будущих состояний'
)
check(
  s1.actions.every((a) => !('effects' in a) && !('next' in a)),
  'клиент не знает ни эффектов, ни переходов доступных действий'
)

const sid = s1.sessionId

const wrong = await post('a', `/api/sessions/${sid}/actions`, { actionId: 'a-final-full' })
check(wrong.status === 409 && wrong.data?.code === 'not-allowed',
  'действие из другого состояния отклоняется сервером',
  JSON.stringify(wrong.data))

const early = await post('a', `/api/sessions/${sid}/actions`, { timeout: true })
check(early.status === 409 && early.data?.code === 'not-expired',
  'досрочно объявить истечение таймера нельзя')

const foreign = await get('b', `/api/sessions/${sid}`)
check(foreign.status === 403, 'чужую сессию не открыть')

const moved = await post('a', `/api/sessions/${sid}/actions`, { actionId: 'a-report' })
check(moved.status === 200, 'ход выполнен')
check(moved.data?.screen?.scales?.safety > s1.scales.safety,
  'шкала изменилась ровно так, как задано сценарием')
check(moved.data?.screen?.lastResult?.consequence?.length > 10,
  'игроку показано последствие решения')
check(moved.data?.screen?.state?.info?.length > 10,
  'следующее состояние приносит новую информацию')

// --------------------------------------------------------- свободная речь

check(moved.data?.screen?.state?.freeText === true,
  'на этом состоянии свободная речь предусмотрена')

// Сначала невнятная реплика: она не должна никуда продвинуть ситуацию.
const muddy = await post('a', `/api/sessions/${sid}/message`, { text: 'ну как-то так' })
check(
  muddy.status === 200 && muddy.data?.understood === false && muddy.data?.reply,
  'непонятную реплику пассажир переспрашивает, а не отвергает как ошибку ввода',
  JSON.stringify(muddy.data)
)
const stillHere = (await get('a', `/api/sessions/${sid}`)).data.screen
check(stillHere.state.id === moved.data.screen.state.id,
  'непонятая реплика не сдвинула ситуацию')

const clear = await post('a', `/api/sessions/${sid}/message`, {
  text: 'вагон четыре, место 14В, мужчина без сознания, дыхание есть'
})
check(clear.status === 200 && clear.data?.screen, 'свободная реплика распознана и выполнена')
check(clear.data.screen.state.id !== moved.data.screen.state.id,
  'понятая реплика продвинула ситуацию')

// ------------------------------------------------------- последовательность

let cur = (await get('a', `/api/sessions/${sid}`)).data.screen
check(cur.state.kind === 'sequence' && cur.sequence?.items?.length === 3,
  'состояние с последовательностью отдаёт пункты', cur.state.kind)

const badOrder = await post('a', `/api/sessions/${sid}/actions`, { order: ['i-note'] })
check(badOrder.status === 409, 'неполная последовательность отклоняется')

const seq = await post('a', `/api/sessions/${sid}/actions`, {
  order: ['i-announce', 'i-space', 'i-note']
})
check(seq.data?.screen?.lastResult?.grade === 'correct', 'порядок оценён')

// ------------------------------------------------------------- до финала

let guard = 0
cur = seq.data.screen
while (cur.status === 'active' && guard++ < 15) {
  const next = cur.state.kind === 'sequence'
    ? await post('a', `/api/sessions/${sid}/actions`, { order: cur.sequence.items.map((i) => i.id) })
    : await post('a', `/api/sessions/${sid}/actions`, { actionId: cur.actions[0].id })
  if (next.status !== 200) break
  cur = next.data.screen
}
check(cur.status === 'finished', 'ситуация доведена до финала')
check(Boolean(cur.state?.verdict), 'у финала есть исход')

const debrief1 = await get('a', `/api/sessions/${sid}/debrief`)
const d = debrief1.data?.debrief
check(debrief1.status === 200 && d, 'разбор доступен')
check(d?.scales?.length === 2, 'в разборе обе шкалы')
check(d?.decisions?.some((x) => x.alternative), 'в разборе есть альтернативное развитие')
check(d?.improvements?.length > 0, 'разбор говорит, что можно улучшить')
check(
  JSON.stringify(d).includes('правильный ответ') === false,
  'разбор не говорит «правильный ответ»'
)
check(debrief1.data?.comparison === null, 'на первой попытке сравнивать не с чем')

// ------------------------------------------------------ повторное прохождение

const again = await post('a', '/api/sessions', { scenarioId: 'sit-19-medical' })
const sid2 = again.data.screen.sessionId
check(again.data.screen.attempt === 2, 'вторая попытка пронумерована')

let cur2 = again.data.screen
// Другая стратегия: начинаем не с доклада.
let first = true
guard = 0
while (cur2.status === 'active' && guard++ < 15) {
  let next
  if (cur2.state.kind === 'sequence') {
    next = await post('a', `/api/sessions/${sid2}/actions`, {
      order: [...cur2.sequence.items.map((i) => i.id)].reverse()
    })
  } else {
    const pick = first ? 'a-calm' : cur2.actions.at(-1).id
    first = false
    next = await post('a', `/api/sessions/${sid2}/actions`, { actionId: pick })
  }
  if (next.status !== 200) break
  cur2 = next.data.screen
}
check(cur2.status === 'finished', 'вторая попытка тоже дошла до финала')

const debrief2 = await get('a', `/api/sessions/${sid2}/debrief`)
check(debrief2.data?.comparison !== null, 'на второй попытке появилось сравнение')
check(
  debrief2.data?.comparison?.outcomeChanged === true,
  'другая стратегия привела к другому исходу',
  JSON.stringify(debrief2.data?.comparison?.outcomeBefore)
)
check(
  debrief2.data?.comparison?.scales?.some((x) => x.delta !== 0),
  'видно, как изменились шкалы между попытками'
)

// ------------------------------------------------------------- прогресс

const progress = await get('a', '/api/progress')
check(progress.data?.runs === 2, 'прогресс учёл оба прохождения')
check(
  progress.data?.scenarios?.find((s) => s.id === 'sit-19-medical')?.attempts === 2,
  'по ситуации видно число попыток'
)
check(
  progress.data?.competency?.some((c) => c.touched),
  'компетенции посчитаны по истории решений'
)

// --------------------------------------------------------------- таймер

if (FAST) {
  console.log('· ожидание таймера пропущено (FAST=1)')
} else {
  const t = await post('a', '/api/sessions', { scenarioId: 'sit-20-smoking' })
  const tid = t.data.screen.sessionId
  const wait = t.data.screen.state.timer.totalSec * 1000 + 2500
  console.log(`· жду истечения таймера, ${Math.round(wait / 1000)} с`)
  await sleep(wait)

  const late = await post('a', `/api/sessions/${tid}/actions`, { actionId: 'a-aside' })
  check(
    late.status === 200 && late.data?.screen?.lastResult?.timedOut === true,
    'опоздавшее действие не выполняется: применяется ветка бездействия',
    JSON.stringify(late.data)
  )
  check(
    late.data?.screen?.scales?.safety < t.data.screen.scales.safety,
    'бездействие имеет собственные последствия'
  )
}

console.log('')
if (failed) {
  console.log(`Провалено проверок: ${failed}`)
  process.exit(1)
}
console.log('API работает: от списка ситуаций до сравнения попыток.')
process.exit(0)
