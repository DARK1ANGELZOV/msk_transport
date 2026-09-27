import { useState } from 'react'

import { analyze, replay, COMPETENCIES, type RunResult } from '../../engine/index.js'
import { type DebriefResponse } from '../lib/api'
import { MODE_TITLE, VERDICT, km as kmText, mmss, relativeDay, seconds } from '../lib/format'
import { go } from '../lib/router'
import { BarRow, ErrorNote, Label, Radar, Section } from '../ui/kit'

import { DecisionMap } from './DecisionMap'
import { RunTrace } from './RunTrace'

/**
 * Разбор рейса — главный обучающий экран продукта.
 *
 * В авиации учит не полёт, а дебрифинг: разбор показывает не «сколько баллов»,
 * а что именно и почему пошло не так. Здесь то же самое — карта решений
 * с непройденными ветками, эталон по СОП, лента потерянного времени,
 * сравнение с бригадой и комментарий наставника.
 *
 * Сам путь проигрывается повторно на клиенте, чтобы показать состояние мира
 * после каждого шага. Числа при этом берутся из ответа сервера: пересчёт
 * нужен для подробностей, а не для оценки.
 */
export function Debrief({ data }: { data: DebriefResponse }) {
  const [open, setOpen] = useState<number | null>(0)

  const { run, scenario, annotations, stats } = data
  if (!scenario) {
    return <ErrorNote>Версия сценария, по которой шёл рейс, не найдена в базе.</ErrorNote>
  }

  const detail: RunResult = replay(scenario, run.path, { strict: false })
  const range = analyze(scenario)
  const verdict = VERDICT[run.status === 'disputed' ? 'rejected' : run.verdict] ?? VERDICT.unfinished

  const tone = verdict.tone === 'good' ? 'border-l-good'
    : verdict.tone === 'bad' ? 'border-l-danger' : 'border-l-warn'

  return (
    <>
      <section className={`card border-l-2 ${tone} p-5 sm:p-6 flex flex-col gap-5`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Label>{MODE_TITLE[run.mode] ?? run.mode} · {relativeDay(run.createdAt)}</Label>
            <h1 className="font-display text-3xl uppercase tracking-wide leading-none mt-1">
              {scenario.title}
            </h1>
            <p className="text-sm text-muted mt-2 max-w-[60ch]">{verdict.title}. {detail.outcome?.summary}</p>
          </div>
          {run.status === 'scored' ? (
            <div className="text-right">
              <Label>Результат</Label>
              <div className="font-display text-5xl leading-none num text-accent">{run.scorePct} %</div>
              {/*
                Показываем диапазон, а не «столько-то из потолка»: проценты
                считаются от расстояния между худшим и лучшим проходимым путём,
                и «536 из 544» без нижней границы вводило бы в заблуждение.
              */}
              <div className="label mt-1" title="Ноль — худший возможный путь, сто — лучший">
                {run.score} баллов · диапазон {range.minScore}–{range.maxScore}
              </div>
            </div>
          ) : null}
        </div>

        {run.status === 'disputed' ? (
          <div className="border-l-2 border-danger pl-3 flex flex-col gap-1">
            <p className="text-sm">
              Сервер не смог проиграть этот путь по своей копии графа, поэтому результат
              не попал в рейтинг. Запись сохранена и видна методисту.
            </p>
            <ul className="text-sm text-danger list-disc pl-5">
              {run.rejected.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
        ) : (
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
            <Fact label="Время рейса" value={mmss(run.tripSec)} />
            <Fact
              label="Потеряно"
              value={seconds(run.lostSec)}
              note={detail.visited[0]?.world?.speedKmh
                ? kmText((detail.visited[0].world.speedKmh / 3.6) * run.lostSec)
                : ''}
              tone={run.lostSec > 40 ? 'text-danger' : ''}
            />
            <Fact label="Совпало с СОП" value={`${run.sopMatched} / ${run.sopTotal}`} />
            <Fact label="Пик стресса" value={String(run.stressPeak)} tone={run.stressPeak >= 70 ? 'text-danger' : ''} />
          </dl>
        )}
      </section>

      {data.line && detail.visited.length > 1 ? (
        <Section eyebrow="География" title="Где принимались решения">
          <RunTrace
            line={data.line}
            scenario={scenario}
            visited={detail.visited}
            selected={open}
            onPick={(i) => setOpen(i)}
          />
        </Section>
      ) : null}

      <Section eyebrow="Шаг за шагом" title="Карта решений">
        <DecisionMap
          scenario={scenario}
          visited={detail.visited}
          annotations={annotations}
          reference={data.reference}
          stats={stats}
          selected={open}
          onSelect={setOpen}
        />
      </Section>

      {detail.events.length ? (
        <Section eyebrow="Мир" title="Что произошло без вас">
          <div className="flex flex-col divide-y divide-hair border-t border-hair">
            {detail.events.map((e, i) => (
              <div key={i} className="py-2.5 flex gap-4 items-baseline">
                <span className="num text-xs text-faint w-12">{mmss(e.at)}</span>
                <span className="text-sm">{e.toast || e.redirect?.why}</span>
              </div>
            ))}
          </div>
          <p className="text-sm text-faint">
            Эти события привязаны к секундам рейса, а не к вашим действиям: мир двигался,
            пока вы принимали решение.
          </p>
        </Section>
      ) : null}

      {run.status === 'scored' ? (
        <Section eyebrow="Компетенции" title="Что этот рейс показал">
          <div className="grid gap-6 md:grid-cols-[minmax(0,22rem)_1fr] items-start">
            <Radar
              values={run.competencyPct}
              axes={COMPETENCIES.filter((c) => c.id in run.competencyPct)}
            />
            <div className="flex flex-col gap-2.5">
              {COMPETENCIES.filter((c) => c.id in run.competencyPct).map((c) => (
                <BarRow key={c.id} title={c.title} value={run.competencyPct[c.id] ?? 0} />
              ))}
              <p className="text-sm text-faint mt-2">
                Сто процентов означает «сыграть лучше по этому графу было нельзя»,
                а не «набрал много»: потолок посчитан перебором всех проходимых путей.
              </p>
            </div>
          </div>
        </Section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={() => go(`/play/${scenario.id}?mode=practice`)}>
          Пройти ещё раз
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


