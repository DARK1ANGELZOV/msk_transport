import { useMemo, useState } from 'react'

import {
  COMPETENCIES, gradeTrip, type RunPath, type TripResult
} from '../../engine/index.js'
import { type TripDebriefResponse } from '../lib/api'
import { km as kmText, mmss, relativeDay, seconds } from '../lib/format'
import { go } from '../lib/router'
import { BarRow, Card, ErrorNote, Label, Radar, Section } from '../ui/kit'

import { DecisionMap } from './DecisionMap'

const VERDICT_TONE: Record<string, string> = {
  good: 'bg-good',
  partial: 'bg-warn',
  bad: 'bg-danger'
}

/**
 * Разбор смены.
 *
 * Отдельный инцидент разбирается по шагам. Смена разбирается ещё и по связям
 * между инцидентами: видно, с каким настроением вагон подошёл к следующему
 * эпизоду, сколько стресса не успело сойти на перегоне и где решение,
 * принятое на пятидесятом километре, вернулось на четырёхсотом.
 *
 * Пересчёт делается на клиенте тем же ядром, что и на сервере, — чтобы
 * показать подробности по каждому инциденту. Итоговые числа берутся
 * из сохранённой записи: разбор ничего не пересуживает.
 */
export function TripDebrief({ data }: { data: TripDebriefResponse }) {
  const [openLeg, setOpenLeg] = useState(0)

  const detail: TripResult | null = useMemo(() => {
    const scenarios = Object.fromEntries(data.scenarios.map((s) => [s.id, s]))
    const ordered = {
      ...data.trip,
      legs: data.scenarios.map((s) => ({ scenario: s.id }))
    }
    try {
      return gradeTrip(ordered, scenarios, data.run.path as unknown as { legs: RunPath[] }, {
        strict: false,
        line: data.line ?? undefined
      })
    } catch {
      return null
    }
  }, [data])

  if (!detail) return <ErrorNote>Запись смены не разбирается: версии инцидентов не найдены.</ErrorNote>

  const { run, trip } = data
  const legs = detail.legs

  return (
    <>
      <section className="card border-l-2 border-l-accent p-5 sm:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Label>Смена · {relativeDay(run.createdAt)}</Label>
            <h1 className="font-display text-3xl uppercase tracking-wide leading-none mt-1">
              {trip.title}
            </h1>
            <p className="text-sm text-muted mt-2 max-w-[62ch]">{trip.summary}</p>
          </div>
          {run.status === 'scored' ? (
            <div className="text-right">
              <Label>Смена</Label>
              <div className="font-display text-5xl leading-none num text-accent">
                {run.scorePct} %
              </div>
              <div className="label mt-1">
                {run.score} баллов · диапазон {detail.minScore}–{detail.maxScore}
              </div>
            </div>
          ) : null}
        </div>

        {/* Полоса смены: четыре инцидента и то, чем каждый закончился. */}
        <div className="flex flex-col gap-2">
          <Label>Как прошла смена</Label>
          <div className="flex gap-1">
            {legs.map((l, i) => (
              <button
                key={l.scenarioId}
                className={`flex-1 h-2 ${VERDICT_TONE[l.run.verdict] ?? 'bg-hair'} ${
                  openLeg === i ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : ''
                }`}
                onClick={() => setOpenLeg(i)}
                title={`${l.title}: ${l.run.verdict}`}
                aria-label={`Инцидент ${i + 1}: ${l.title}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 label">
            {legs.map((l, i) => (
              <span key={l.scenarioId} className={openLeg === i ? 'text-ink' : ''}>
                {i + 1}. {l.title}
              </span>
            ))}
          </div>
        </div>

        {run.status === 'disputed' ? (
          <div className="border-l-2 border-danger pl-3 flex flex-col gap-1">
            <p className="text-sm">
              Сервер не смог проиграть эту смену по своим копиям графов, поэтому
              результат не попал в рейтинг. Запись сохранена и видна методисту.
            </p>
            <ul className="text-sm text-danger list-disc pl-5">
              {run.rejected.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
        ) : (
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
            <Fact label="Время смены" value={mmss(run.tripSec)} />
            <Fact
              label="Потеряно"
              value={seconds(run.lostSec)}
              note={kmText((360 / 3.6) * run.lostSec)}
              tone={run.lostSec > 90 ? 'text-danger' : ''}
            />
            <Fact label="Совпало с СОП" value={`${run.sopMatched} / ${run.sopTotal}`} />
            <Fact
              label="Пик стресса"
              value={String(run.stressPeak)}
              tone={run.stressPeak >= 70 ? 'text-danger' : ''}
            />
          </dl>
        )}
      </section>

      {/* Перегоны: главное отличие смены от набора упражнений. */}
      {detail.gaps.length ? (
        <Section eyebrow="Между инцидентами" title="Что несли с собой">
          <div className="flex flex-col gap-3">
            {detail.gaps.map((g) => (
              <Card key={g.index} className="p-4 flex flex-wrap items-center gap-x-8 gap-y-3">
                <div className="min-w-[10rem]">
                  <Label>Перегон</Label>
                  <div className="num text-sm mt-0.5">
                    {Math.round(g.fromKm ?? 0)} → {Math.round(g.toKm ?? 0)} км · {mmss(g.gapSec)}
                  </div>
                </div>
                <Delta title="Настроение вагона" pair={g.carMood} good={g.carMood[1] > g.carMood[0]} />
                <Delta title="Стресс" pair={g.stress} good={g.stress[1] < g.stress[0]} />
                <div>
                  <Label>Пол усталости</Label>
                  <div className="num text-sm mt-0.5 text-faint">{g.fatigueFloor}</div>
                </div>
              </Card>
            ))}
          </div>
          <p className="text-sm text-faint max-w-[68ch]">
            Восстановление на перегоне неполное и с каждым инцидентом всё слабее:
            вагон, которому нахамили в начале смены, к концу успокоится, но не станет
            таким, будто ничего не было, — а пол стресса поднимается, потому что
            смена выматывает. Именно это отличает рейс от четырёх отдельных упражнений.
          </p>
        </Section>
      ) : null}

      {run.status === 'scored' ? (
        <Section eyebrow="Компетенции" title="Что показала смена">
          <div className="grid gap-6 md:grid-cols-[minmax(0,22rem)_1fr] items-start">
            <Radar
              values={run.competencyPct}
              axes={COMPETENCIES.filter((c) => c.id in run.competencyPct)}
            />
            <div className="flex flex-col gap-2.5">
              {COMPETENCIES.filter((c) => c.id in run.competencyPct).map((c) => (
                <BarRow key={c.id} title={c.title} value={run.competencyPct[c.id] ?? 0} />
              ))}
              <p className="text-sm text-faint mt-2 max-w-[62ch]">
                По смене компетенции нормируются на сумму потолков всех её инцидентов.
                Средняя безопасность за смену — <span className="num">{run.safety}</span>:
                она считается по эпизодам отдельно и не тянется из одного в другой,
                иначе ранняя ошибка штрафовалась бы дважды.
              </p>
            </div>
          </div>
        </Section>
      ) : null}

      <Section
        eyebrow={`Инцидент ${openLeg + 1} из ${legs.length}`}
        title={legs[openLeg]?.title ?? ''}
        action={
          <div className="flex gap-2">
            <button
              className="btn"
              onClick={() => setOpenLeg((i) => Math.max(0, i - 1))}
              disabled={openLeg === 0}
            >
              ←
            </button>
            <button
              className="btn"
              onClick={() => setOpenLeg((i) => Math.min(legs.length - 1, i + 1))}
              disabled={openLeg === legs.length - 1}
            >
              →
            </button>
          </div>
        }
      >
        {legs[openLeg] ? (
          <DecisionMap
            scenario={data.scenarios[openLeg]}
            visited={legs[openLeg].run.visited}
            annotations={data.annotations[legs[openLeg].scenarioId] ?? {}}
            reference={data.references[legs[openLeg].scenarioId] ?? []}
          />
        ) : null}
      </Section>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={() => go(`/trip/${trip.id}`)}>
          Пройти смену ещё раз
        </button>
        <button className="btn" onClick={() => go('/')}>К списку рейсов</button>
      </div>
    </>
  )
}

function Fact({
  label, value, note = '', tone = ''
}: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className={`num text-xl leading-tight ${tone}`}>{value}</dd>
      {note ? <dd className="label mt-0.5">{note} пути</dd> : null}
    </div>
  )
}

function Delta({ title, pair, good }: { title: string; pair: [number, number]; good: boolean }) {
  const changed = pair[0] !== pair[1]
  return (
    <div>
      <Label>{title}</Label>
      <div className={`num text-sm mt-0.5 ${!changed ? 'text-faint' : good ? 'text-good' : 'text-warn'}`}>
        {pair[0]} → {pair[1]}
      </div>
    </div>
  )
}
