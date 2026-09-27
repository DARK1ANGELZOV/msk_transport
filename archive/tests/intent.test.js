/**
 * Тесты распознавания свободной реплики.
 *
 * Проверяется не «умность», а два свойства, без которых режим не имеет права
 * существовать в тренажёре для допуска: реплику относят к тому варианту,
 * который человек имел в виду, и сервер приходит к тому же выводу, что клиент.
 * Всё остальное — качество словаря, и оно в руках методиста.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { ENGINE } from '../engine/model.js'
import { classify, stem, stems } from '../engine/intent.js'
import { registerLine } from '../engine/line.js'
import { replay } from '../engine/replay.js'

registerLine(JSON.parse(fs.readFileSync('content/lines/vsm-msk-spb.json', 'utf8')))
const med = JSON.parse(fs.readFileSync('content/scenarios/med-01.json', 'utf8'))

const at = (nodeId) => med.nodes[nodeId]
const say = (nodeId, text) => classify(at(nodeId), text, at(nodeId).choices)

// ------------------------------------------------------------- нормализация

test('формы одного слова сходятся в одну основу', () => {
  for (const group of [
    ['доложить', 'доложу', 'доложил'],
    ['осмотреть', 'осмотрю'],
    ['медики', 'медиков', 'медика']
  ]) {
    const base = stem(group[0])
    for (const w of group) assert.equal(stem(w), base, `${w} → ${stem(w)}, ждали ${base}`)
  }
})

test('служебные слова выбрасываются', () => {
  // Остаётся только то, что несёт смысл: местоимения, предлоги и связки
  // есть в любой реплике и не различают ничего.
  assert.deepEqual(stems('я не буду это делать для вас'), [stem('делать')])
  assert.deepEqual(stems('и в на с у'), [])
})

// ------------------------------------------------------------- распознавание

test('реплики своими словами относятся к нужному варианту', () => {
  const cases = [
    ['n-start', 'доложу лнп и попрошу скорую на станцию', 'c-call'],
    ['n-start', 'сообщу начальнику поезда что человеку плохо', 'c-call'],
    ['n-start', 'подойду посмотрю что с ним', 'c-look'],
    ['n-start', 'скажу женщине успокоиться и не пугать вагон', 'c-calm'],
    ['n-doctor', 'объявлю по составу нет ли среди пассажиров врача', 'c-announce'],
    ['n-doctor', 'подожду указаний начальника поезда', 'c-wait'],
    ['n-look', 'попробую перенести его в тамбур', 'c-carry'],
    ['n-window', 'попрошу внеплановую остановку по медицинским показаниям', 'c-unscheduled']
  ]
  for (const [node, text, want] of cases) {
    const r = say(node, text)
    assert.equal(r.choice, want, `«${text}» → ${r.choice ?? r.reason}`)
  }
})

test('невнятная реплика не относится ни к чему', () => {
  assert.equal(say('n-start', 'ну не знаю').choice, null)
  assert.equal(say('n-start', 'сделаю что-нибудь').choice, null)
  assert.equal(say('n-start', 'да').reason, 'short')
})

test('решение объяснимо: видно, какие слова сработали', () => {
  const r = say('n-start', 'доложу начальнику поезда и вызову медиков')
  assert.equal(r.choice, 'c-call')
  const best = r.scores.find((s) => s.id === 'c-call')
  assert.ok(best.hits.length >= 2, 'должно быть видно несколько сработавших слов')
  assert.ok(best.hits.every((h) => typeof h.value === 'number'))
})

test('реплику нельзя отнести к варианту, недоступному в этот момент', () => {
  // Связь занята — «доложу по связи» не может быть засчитано,
  // и это правильный ответ распознавателя, а не его ошибка.
  const node = at('n-start')
  const withoutComms = node.choices.filter((c) => c.requires?.comms !== true)
  const r = classify(node, 'доложу начальнику поезда вызову медиков', withoutComms)
  assert.notEqual(r.choice, 'c-call')
})

// ------------------------------------------------------------------ античит

const path = (extra = {}) => ({
  startedAt: '2026-09-27T08:00:00.000Z',
  finishedAt: '2026-09-27T08:03:00.000Z',
  steps: [
    { node: 'n-start', choice: 'c-call', deliberateMs: 4000, ...(extra.first ?? {}) },
    { node: 'n-doctor', choice: 'c-announce', deliberateMs: 3000 },
    { node: 'n-report', choices: ['b-who', 'b-what', 'b-state', 'b-ask'], deliberateMs: 6000 },
    { node: 'n-prep', choices: ['i-stay', 'i-path', 'i-docs', 'i-announce'], deliberateMs: 8000 }
  ],
  ...(extra.path ?? {})
})

test('путь со свободной репликой принимается, если сервер распознаёт так же', () => {
  const run = replay(med, path({ first: { said: 'доложу лнп и попрошу медиков на станцию' } }))
  assert.equal(run.ok, true, run.rejected.join('; '))
  assert.equal(run.visited[0].said, 'доложу лнп и попрошу медиков на станцию')
  assert.ok(run.visited[0].intent.scores.length > 0, 'обоснование сохраняется в разборе')
})

test('реплика, не соответствующая присланному варианту, отклоняется', () => {
  // Сказал одно, а ребро прислал другое: ровно то, чем подделывали бы путь.
  const run = replay(med, path({ first: { said: 'подойду посмотрю что с ним' } }))
  assert.equal(run.ok, false)
  assert.match(run.rejected.join(' '), /распознаётся как/)
})

test('переспрос стоит секунд рейса', () => {
  const plain = replay(med, path())
  const withRetry = replay(med, path({
    path: { retries: [{ atStep: 0, said: 'ну как-то так' }] }
  }))
  assert.equal(withRetry.ok, true, withRetry.rejected.join('; '))
  assert.equal(withRetry.tripSec, plain.tripSec + ENGINE.RETRY_SEC)
  assert.equal(withRetry.retryCount, 1)
})

test('переспрос на понятной реплике отклоняется', () => {
  // Иначе можно было бы «переспрашивать» бесплатно, накручивая себе время
  // на раздумье под видом непонимания.
  const run = replay(med, path({
    path: { retries: [{ atStep: 0, said: 'доложу начальнику поезда вызову медиков' }] }
  }))
  assert.equal(run.ok, false)
  assert.match(run.rejected.join(' '), /была понятна/)
})
