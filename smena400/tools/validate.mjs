/**
 * Проверка банка сценариев.
 *
 *   npm run validate
 *
 * Ошибки валят проверку: такой сценарий нельзя отдавать игроку. Предупреждения
 * не валят — это вопросы к методике, а не к формату, и решать их должен автор
 * сценария, а не программа.
 */
import fs from 'node:fs'
import path from 'node:path'

import { validate } from '../engine/validate.js'

const DIR = 'content/scenarios'
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()

let bad = 0
let warned = 0

for (const file of files) {
  const full = path.join(DIR, file)
  let doc
  try {
    doc = JSON.parse(fs.readFileSync(full, 'utf8'))
  } catch (e) {
    console.log(`✗ ${file} — не разбирается как JSON: ${e.message}`)
    bad += 1
    continue
  }

  const r = validate(doc)
  const s = r.stats
  const mark = r.ok ? '✓' : '✗'
  console.log(
    `${mark} ${file} — состояний: ${s.states}, финалов: ${s.reachableFinals}/${s.finals}, ` +
    `путей: ${s.paths}, таймеров: ${s.timers}, ключевых решений: ${s.keyDecisions}, ` +
    `отложенных последствий: ${s.deferred}, свободная речь: ${s.freeTextStates}`
  )
  for (const m of r.errors) console.log(`    ошибка: ${m}`)
  for (const m of r.warnings) console.log(`    предупреждение: ${m}`)
  if (!r.ok) bad += 1
  warned += r.warnings.length
}

console.log('')
if (bad) {
  console.log(`Сценариев с ошибками: ${bad} из ${files.length}.`)
  process.exit(1)
}
console.log(
  `Все ${files.length} сценариев корректны` +
  (warned ? `, предупреждений: ${warned}.` : '.')
)
