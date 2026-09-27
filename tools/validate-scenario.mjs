/**
 * Проверка сценариев из командной строки и в CI.
 *
 * Правила живут в engine/validate.js — том же модуле, который работает
 * в редакторе методиста и на сервере при импорте. Здесь только обход файлов
 * и печать, чтобы у трёх мест не было трёх разных мнений о корректности графа.
 *
 *   node tools/validate-scenario.mjs [файлы...]
 *
 * Код возврата 1, если есть ошибки. Предупреждения не блокируют.
 */
import fs from 'node:fs'
import path from 'node:path'

import { validate } from '../engine/validate.js'
import { analyze } from '../engine/scoring.js'
import { registerLine } from '../engine/line.js'

const DIR = 'content/scenarios'
const LINES = 'content/lines'

// Линии регистрируются до проверки: без них сценарий не знает ни своего
// километра, ни времени до остановки, и половина правил проверить нечего.
for (const f of fs.existsSync(LINES) ? fs.readdirSync(LINES) : []) {
  if (f.endsWith('.json')) registerLine(JSON.parse(fs.readFileSync(path.join(LINES, f), 'utf8')))
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => path.join(DIR, f))

let failed = 0
for (const file of files.sort()) {
  let scenario
  try {
    scenario = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    console.log(`✗ ${file}: не разбирается как JSON — ${err.message}`)
    failed += 1
    continue
  }

  const r = validate(scenario)
  const mark = r.ok ? '✓' : '✗'
  let tail = ''
  if (r.ok) {
    const a = analyze(scenario)
    tail = `, потолок: ${a.maxScore}, путей: ${a.paths}${a.truncated ? ' (перебор ограничен)' : ''}`
  }
  console.log(
    `${mark} ${file} — узлов: ${r.nodes}, ошибок: ${r.errors.length}, ` +
    `предупреждений: ${r.warnings.length}${tail}`
  )
  for (const m of r.errors) console.log(`    ошибка:         ${m}`)
  for (const m of r.warnings) console.log(`    предупреждение: ${m}`)
  if (!r.ok) failed += 1
}

console.log(failed ? `\nСценариев с ошибками: ${failed}` : `\nВсе ${files.length} сценариев корректны.`)
process.exit(failed ? 1 : 0)
