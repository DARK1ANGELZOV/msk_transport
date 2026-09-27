import { useCallback, useEffect, useState } from 'react'

import {
  registerLine, type Line, type RunPath, type Scenario, type ScenarioNode
} from '../../engine/index.js'
import { api, type SubmitResponse } from '../lib/api'
import { errorText } from '../App'
import { seconds } from '../lib/format'
import { enqueue } from '../lib/offline'
import { go } from '../lib/router'
import { ErrorNote, Label, Spinner } from '../ui/kit'

import { Hud, LegFooter, Stage } from './Stage'
import { useSpeechMode } from './Speech'
import { useLeg } from './useLeg'

/**
 * Прохождение одного инцидента.
 *
 * Клиент не считает результат. Он ведёт **путь** — список узлов, выборов
 * и таймингов, — и после каждого шага прогоняет его через то же ядро,
 * которое потом отработает на сервере. Поэтому цифры на экране и цифры
 * в базе совпадают по построению, а не потому, что кто-то следил за
 * синхронностью двух реализаций.
 */
export function Play({ scenarioId, mode }: { scenarioId: string; mode: string }) {
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [line, setLine] = useState<Line | null>(null)
  const [error, setError] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<SubmitResponse | null>(null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    api.scenario(scenarioId, mode)
      .then((r) => {
        // Линию регистрируем до сценария: без неё ядро не знает километража
        // и посчитает мир по запасной ветке, разойдясь с сервером.
        if (r.line) {
          registerLine(r.line)
          setLine(r.line)
        }
        setScenario(r.scenario)
      })
      .catch((e) => setError(errorText(e)))
  }, [scenarioId, mode])

  const submit = useCallback((path: RunPath) => {
    if (!scenario) return
    setSubmitting(true)
    const payload = {
      scenarioId: scenario.id, scenarioVersion: scenario.version, mode, path
    }
    api.submitRun(payload)
      .then(setSubmitted)
      .catch(() => {
        enqueue(payload)
        setOffline(true)
      })
      .finally(() => setSubmitting(false))
  }, [scenario, mode])

  const [speech, toggleSpeech] = useSpeechMode()
  const leg = useLeg(scenario, null, submit)
  // На узле, где игрок попросил показать варианты, разговор уступает кнопкам.
  const speaking = speech && !leg.revealed

  if (error) {
    return (
      <div className="min-h-dvh grid place-items-center p-6">
        <div className="flex flex-col gap-4 items-start">
          <ErrorNote>{error}</ErrorNote>
          <button className="btn" onClick={() => go('/')}>К списку рейсов</button>
        </div>
      </div>
    )
  }
  if (!scenario || !leg.world || !leg.node) {
    return <div className="min-h-dvh grid place-items-center"><Spinner text="Посадка" /></div>
  }

  return (
    <div className={`min-h-dvh flex flex-col ${leg.stressed ? 'tunnel' : ''}`}>
      <style>{`
        .tunnel .stage { box-shadow: inset 0 0 140px 40px rgb(var(--c-ground)); }
        .tunnel .stage-text { letter-spacing: .012em; }
      `}</style>

      <Hud
        scenario={scenario}
        line={line}
        world={leg.world}
        remaining={leg.remaining}
        limit={leg.node.limitSec ?? 0}
        stressed={leg.stressed}
      />

      <Stage
        scenario={scenario}
        leg={leg}
        speech={speaking}
        onLeaveSpeech={leg.reveal}
        footer={leg.finished ? null : (
          <LegFooter
            leg={leg}
            onQuit={() => go('/')}
            speech={speech}
            onToggleSpeech={toggleSpeech}
          />
        )}
      >
        {leg.finished && leg.outcome ? (
          <Outcome
            node={leg.outcome}
            submitting={submitting}
            submitted={submitted}
            offline={offline}
          />
        ) : undefined}
      </Stage>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Финал
// ---------------------------------------------------------------------------

function Outcome({
  node, submitting, submitted, offline
}: {
  node: ScenarioNode
  submitting: boolean
  submitted: SubmitResponse | null
  offline: boolean
}) {
  const tone = node.verdict === 'good' ? 'border-good'
    : node.verdict === 'bad' ? 'border-danger' : 'border-warn'

  return (
    <article className="flex flex-col gap-6 animate-rise">
      <div className={`border-l-2 ${tone} pl-4 flex flex-col gap-3`}>
        <Label>Инцидент закрыт</Label>
        <p className="text-lg leading-snug max-w-[55ch]">{node.text}</p>
        {node.summary ? <p className="text-sm text-muted max-w-[60ch]">{node.summary}</p> : null}
      </div>

      {submitting ? <Spinner text="Сервер пересчитывает результат" /> : null}

      {offline ? (
        <div className="card p-4 flex flex-col gap-3">
          <Label>Нет сети</Label>
          <p className="text-sm">
            Прохождение сохранено на устройстве и уйдёт на сервер, когда появится связь.
            Результат посчитает сервер: на клиенте лежит только путь, а не очки.
          </p>
          <button className="btn self-start" onClick={() => go('/')}>К списку рейсов</button>
        </div>
      ) : null}

      {submitted ? (
        <div className="flex flex-col gap-5">
          {submitted.status === 'disputed' ? (
            <div className="card p-4 border-l-2 border-l-danger flex flex-col gap-2">
              <Label>Результат отклонён</Label>
              <p className="text-sm">
                Сервер не смог проиграть этот путь по своей копии графа. Прохождение сохранено
                как спорное и ушло методисту — оно не пропало.
              </p>
              <ul className="text-sm text-danger list-disc pl-5">
                {submitted.result.rejected.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
              <div>
                <Label>Результат</Label>
                <div className="font-display text-6xl leading-none num text-accent">
                  {submitted.result.scorePct}<span className="text-2xl"> %</span>
                </div>
              </div>
              <div>
                <Label>Потеряно времени</Label>
                <div className="num text-2xl leading-none">{seconds(submitted.result.lostSec)}</div>
              </div>
              <div>
                <Label>Совпало с СОП</Label>
                <div className="num text-2xl leading-none">
                  {submitted.result.sopMatched} / {submitted.result.sopTotal}
                </div>
              </div>
            </div>
          )}

          {submitted.freshAchievements.length ? (
            <div className="card p-4 flex flex-col gap-2">
              <Label>Новые достижения</Label>
              <div className="flex flex-wrap gap-2">
                {submitted.freshAchievements.map((id) => (
                  <span key={id} className="border border-accent text-accent px-2 py-1 text-xs font-mono uppercase tracking-wider">
                    {id}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => go(`/debrief/${submitted.runId}`)}>
              Разбор
            </button>
            <button className="btn" onClick={() => go('/')}>К списку</button>
          </div>
        </div>
      ) : null}
    </article>
  )
}
