/**
 * Замер распознавателя свободной речи.
 *
 * Словарь без замера — вкусовщина: методист добавляет слово, и никто не знает,
 * стало лучше или хуже. Здесь считаются три числа, и только третье из них
 * по-настоящему страшное.
 *
 *   попадание   реплику отнесли к тому варианту, который человек имел в виду
 *   переспрос   не отнесли ни к чему — тренажёр переспросил
 *   подмена     отнесли к ЧУЖОМУ варианту
 *
 * Переспрос стоит секунд и раздражает. Подмена засчитывает действие, которого
 * проводник не совершал, — это ложь в допуске, и её доля должна быть нулём.
 * Поэтому пороги распознавателя настроены так, чтобы при сомнении молчать.
 *
 *   node tools/intent-bench.mjs            сводка
 *   node tools/intent-bench.mjs --verbose  разбор каждой реплики
 */
import fs from 'node:fs'
import path from 'node:path'

import { classify } from '../engine/intent.js'

const VERBOSE = process.argv.includes('--verbose')
const MARK = { hit: '·', retry: '?', swap: '!', noise: '!', quiet: '·' }

const bench = JSON.parse(fs.readFileSync('content/intent-bench.json', 'utf8'))
const scenarios = new Map()
const load = (id) => {
  if (!scenarios.has(id)) {
    scenarios.set(id, JSON.parse(
      fs.readFileSync(path.join('content/scenarios', `${id}.json`), 'utf8')
    ))
  }
  return scenarios.get(id)
}

const tally = { hit: 0, retry: 0, swap: 0, quiet: 0, noise: 0 }
const problems = []

for (const c of bench.cases) {
  const node = load(c.scenario).nodes[c.node]
  if (!node) {
    problems.push(`нет узла ${c.scenario}/${c.node}`)
    continue
  }
  const verdict = classify(node, c.said, node.choices ?? [])
  const got = verdict.choice

  let kind
  if (c.expect === null) {
    kind = got === null ? 'quiet' : 'noise'
  } else if (got === c.expect) {
    kind = 'hit'
  } else if (got === null) {
    kind = 'retry'
  } else {
    kind = 'swap'
  }
  tally[kind] += 1

  if (VERBOSE || kind === 'swap' || kind === 'noise' || kind === 'retry') {
    const top = verdict.scores.slice(0, 3)
      .map((s) => `${s.id}:${s.score}`).join('  ')
    const line = `${MARK[kind]} ${c.scenario}/${c.node} · «${c.said}»`
      + `\n     ждали ${c.expect ?? '—'}, получили ${got ?? verdict.reason}   ${top}`
    if (VERBOSE) console.log(line)
    else if (kind !== 'retry') problems.push(line)
  }
}

const meaningful = tally.hit + tally.retry + tally.swap
const noiseTotal = tally.quiet + tally.noise
const pct = (n, of) => (of ? Math.round((n / of) * 1000) / 10 : 0)

console.log('')
console.log(`Осмысленных реплик: ${meaningful}`)
console.log(`  попадание   ${tally.hit}   ${pct(tally.hit, meaningful)} %`)
console.log(`  переспрос   ${tally.retry}   ${pct(tally.retry, meaningful)} %`)
console.log(`  подмена     ${tally.swap}   ${pct(tally.swap, meaningful)} %`)
console.log(`Невнятных реплик: ${noiseTotal}`)
console.log(`  промолчали  ${tally.quiet}   ${pct(tally.quiet, noiseTotal)} %`)
console.log(`  выдумали    ${tally.noise}   ${pct(tally.noise, noiseTotal)} %`)

if (problems.length) {
  console.log('')
  console.log('Требует внимания методиста:')
  for (const p of problems) console.log(p)
}

// Подмена и выдумка — отказ, а не «недостаточно хорошо». Переспросы допустимы.
const fatal = tally.swap + tally.noise
console.log('')
console.log(fatal
  ? `Подмен и выдумок: ${fatal}. Словарь узла нужно поправить.`
  : 'Ни одной подмены: при сомнении тренажёр переспрашивает, а не угадывает.')
process.exit(fatal ? 1 : 0)
