/**
 * Подготовка базы и проверка контента.
 *
 *   npm run db:seed
 *
 * Важно понимать, чего этот скрипт НЕ делает: он не заливает сценарии в базу.
 * Сценарии — это конфигурация, они лежат в content/scenarios и читаются
 * сервером при старте. Благодаря этому добавить ситуацию можно, положив файл
 * рядом с остальными, и ничего не пересобирая.
 *
 * В базе хранятся только прохождения. Поэтому работа скрипта — создать
 * пустую базу со схемой и убедиться, что весь банк корректен и играбелен.
 */
import fs from 'node:fs'
import path from 'node:path'

import { validate } from '../engine/validate.js'
import { startSession, availableActions, step, currentState } from '../engine/machine.js'

// Импорт создаёт файл базы и таблицы.
const { isEmpty } = await import('../server/lib/db.js')

const DIR = 'content/scenarios'
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()

let bad = 0
console.log('Банк ситуаций:')

for (const file of files) {
  const sc = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'))
  const r = validate(sc)
  if (!r.ok) {
    console.log(`  ✗ ${sc.title}`)
    for (const e of r.errors) console.log(`      ${e}`)
    bad += 1
    continue
  }

  // Контрольное прохождение: сценарий должен доходить до финала.
  let s = startSession(sc)
  let guard = 0
  while (s.status === 'active' && guard++ < 40) {
    const st = currentState(sc, s)
    const now = s.stateEnteredAt + 1000
    const out = st.kind === 'sequence'
      ? step(sc, s, { order: st.correct_order }, { now })
      : step(sc, s, { actionId: availableActions(sc, s)[0].id }, { now })
    if (!out.ok) break
    s = out.session
  }
  const playable = s.status === 'finished'
  if (!playable) bad += 1

  console.log(
    `  ${playable ? '✓' : '✗'} ${sc.title} — ${sc.source.situation}, ` +
    `состояний: ${r.stats.states}, путей: ${r.stats.paths}, ` +
    `финалов: ${r.stats.reachableFinals}`
  )
}

console.log('')
console.log(`База: ${process.env.DB_FILE || 'data/smena400.db'} (${isEmpty() ? 'пустая' : 'с прохождениями'})`)

if (bad) {
  console.log(`Проблемных сценариев: ${bad}. Играть можно, но не всем.`)
  process.exit(1)
}
console.log(`Готово: ${files.length} ситуации проверены и играбельны. Запуск — npm run dev.`)
