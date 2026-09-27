import { useState } from 'react'

import { referencePairs, type Scenario, type VisitedEntry } from '../../engine/index.js'
import type { Annotations, GraphStats } from '../lib/api'
import { mmss, seconds } from '../lib/format'
import { Card, Label } from '../ui/kit'

/**
 * Карта решений одного инцидента.
 *
 * Разбирается не результат, а путь: что было выбрано, что осталось за кадром,
 * куда вёл эталон и как в этот момент выглядел мир. Используется и в разборе
 * отдельного инцидента, и в разборе смены — иначе у них разъехалась бы подача.
 */
export function DecisionMap({
  scenario, visited, annotations, reference, stats, selected, onSelect
}: {
  scenario: Scenario
  visited: VisitedEntry[]
  annotations: Annotations
  reference: string[]
  stats?: GraphStats | null
  selected?: number | null
  onSelect?: (index: number | null) => void
}) {
  const [own, setOwn] = useState<number | null>(0)
  const open = selected !== undefined ? selected : own
  const setOpen = onSelect ?? setOwn

  const pairs = referencePairs({ ...scenario, reference })

  return (
    <div className="flex flex-col gap-2">
      {visited.map((v, i) => {
        const node = scenario.nodes[v.node]
        const ann = annotations[v.node]
        const refNext = pairs.get(v.node)
        const onRef = refNext ? refNext === v.next : null
        const picked = v.picked[0]
        const choiceAnn = picked ? ann?.choices?.[picked.id] : undefined
        const isOpen = open === i

        return (
          <Card key={`${v.node}-${i}`} className="overflow-hidden">
            <button
              className="w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-raised transition-colors"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
            >
              <span className="num text-xs text-faint w-12 shrink-0">{mmss(v.atTripSec)}</span>
              <span
                className={`w-1.5 h-8 shrink-0 ${
                  v.timeout ? 'bg-danger' : onRef === true ? 'bg-good'
                    : onRef === false ? 'bg-warn' : 'bg-hair'
                }`}
                aria-hidden="true"
              />
              <span className="flex-1 min-w-0">
                <span className="block text-sm leading-snug">
                  {v.timeout
                    ? 'Решение не принято в отведённое время'
                    : v.picked.map((p) => p.text).join(' · ') || node?.text}
                </span>
                {v.said ? (
                  <span className="block text-sm text-muted mt-0.5 italic">
                    «{v.said}»
                  </span>
                ) : null}
                <span className="label mt-0.5 block">
                  {typeof v.world?.km === 'number'
                    ? `${v.world.km.toFixed(1).replace('.', ',')} км · `
                    : ''}
                  раздумье {v.thinkSec.toFixed(1).replace('.', ',')} с · действие {seconds(v.costSec)}
                  {v.breath ? ' · вдох' : ''}
                  {v.revealed ? ' · раскрыл варианты' : ''}
                </span>
              </span>
              <span className="label shrink-0">{isOpen ? '−' : '+'}</span>
            </button>

            {isOpen ? (
              <div className="px-4 pb-4 pt-1 flex flex-col gap-4 border-t border-hair">
                <p className="text-sm text-muted">{node?.text}</p>

                {v.feedback || choiceAnn?.feedback ? (
                  <div className="border-l-2 border-accent pl-3 flex flex-col gap-1">
                    <Label>Разбор</Label>
                    <p className="text-sm">{choiceAnn?.feedback || v.feedback}</p>
                  </div>
                ) : null}

                {choiceAnn?.mentorNote || v.mentorNote ? (
                  <div className="border-l-2 border-hair pl-3 flex flex-col gap-1">
                    <Label>Наставник</Label>
                    <p className="text-sm text-muted">{choiceAnn?.mentorNote || v.mentorNote}</p>
                  </div>
                ) : null}

                {refNext && !onRef ? (
                  <div className="border-l-2 border-good pl-3 flex flex-col gap-1">
                    <Label>Эталон по СОП</Label>
                    <p className="text-sm">
                      {(node?.choices ?? []).find((c) => c.next === refNext)?.text
                        ?? 'следующий узел эталонного пути'}
                    </p>
                    {choiceAnn?.sop || v.sop ? (
                      <p className="num text-xs text-faint">{choiceAnn?.sop || v.sop}</p>
                    ) : null}
                  </div>
                ) : null}

                {v.said && v.intent ? <WhyMatched entry={v} /> : null}

                <NotTaken node={v.node} picked={picked?.id} scenario={scenario} />

                <div className="flex flex-wrap gap-x-6 gap-y-1 label">
                  {typeof v.world.km === 'number' ? (
                    <span className="text-ink">
                      {v.world.km.toFixed(1).replace('.', ',')} км · {v.world.speedKmh} км/ч
                      {v.world.stopName && typeof v.world.toStopSec === 'number'
                        ? ` · ${v.world.stopName} через ${mmss(v.world.toStopSec)}`
                        : ''}
                    </span>
                  ) : null}
                  <span>безопасность {v.world.safety}</span>
                  <span>пассажир {v.world.loyalty}</span>
                  <span>вагон {v.world.carMood}</span>
                  <span className={v.stressAfter >= 70 ? 'text-danger' : ''}>
                    стресс {v.stressBefore} → {v.stressAfter}
                  </span>
                </div>

                {stats ? <Peers node={v.node} pickedId={picked?.id} stats={stats} /> : null}
              </div>
            ) : null}
          </Card>
        )
      })}
    </div>
  )
}

/**
 * Почему свободная реплика отнесена именно к этому варианту.
 *
 * Распознаватель, который нельзя проверить глазами, в тренажёре для допуска
 * не нужен. Здесь видно каждое сработавшее слово и его вес — и то, что
 * решение принято арифметикой, а не чьим-то мнением.
 */
function WhyMatched({ entry }: { entry: VisitedEntry }) {
  const scores = entry.intent?.scores ?? []
  const best = scores[0]
  if (!best) return null
  return (
    <details className="text-sm">
      <summary className="label cursor-pointer">Почему так распознано</summary>
      <div className="mt-2 flex flex-col gap-2">
        {scores.map((s) => (
          <div key={s.id} className="flex items-baseline gap-3">
            <span className={`num text-xs w-10 text-right ${s.id === best.id ? 'text-accent' : 'text-faint'}`}>
              {s.score}
            </span>
            <span className="flex-1 min-w-0">
              <span className="num text-xs text-faint">{s.id}</span>
              {s.hits.length ? (
                <span className="block text-xs text-muted mt-0.5">
                  {s.hits.map((h) => (
                    <span key={h.stem} className={h.exact ? '' : 'text-faint'}>
                      {h.stem}
                      <span className="text-faint"> {h.value}</span>
                      {'  '}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="block text-xs text-faint mt-0.5">ни одного слова</span>
              )}
            </span>
          </div>
        ))}
        <p className="text-xs text-faint">
          Вес слова тем выше, чем реже оно встречается у других вариантов этого узла:
          то, что есть у всех, не различает ничего. Бледным отмечены совпадения
          по общему началу основы, а не дословные.
        </p>
      </div>
    </details>
  )
}

/** Ветки, которые остались неоткрытыми: половина ценности разбора именно в них. */
function NotTaken({
  node, picked, scenario
}: { node: string; picked?: string; scenario: Scenario }) {
  const others = (scenario.nodes[node]?.choices ?? []).filter((c) => c.id !== picked)
  if (!others.length) return null
  return (
    <details className="text-sm">
      <summary className="label cursor-pointer">Не выбрано · {others.length}</summary>
      <ul className="mt-2 flex flex-col gap-2 list-none p-0">
        {others.map((c) => (
          <li key={c.id} className="border-l-2 border-hair pl-3">
            <div className="flex items-baseline gap-3">
              <span className="num text-xs text-faint">{seconds(c.costSec ?? 0)}</span>
              <span>{c.text}</span>
            </div>
            {c.feedback ? <p className="text-sm text-faint mt-1">{c.feedback}</p> : null}
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Норма как обратная связь: «так же поступает столько-то процентов бригады». */
function Peers({
  node, pickedId, stats
}: { node: string; pickedId?: string; stats: GraphStats }) {
  const row = stats.nodes.find((n) => n.node === node)
  const mine = row?.choices.find((c) => c.id === pickedId)
  if (!row || !mine || row.runs < 3) return null
  return (
    <p className="text-sm text-muted">
      На этом узле так же поступают <span className="num">{mine.share} %</span> проводников
      {row.correctShare !== null ? (
        <> · по эталону идут <span className="num">{row.correctShare} %</span></>
      ) : null}
    </p>
  )
}
