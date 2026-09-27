import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  recover, registerLine, trainState,
  type Line, type RunPath, type Scenario, type World
} from '../../engine/index.js'
import { api, type TripPackage } from '../lib/api'
import { errorText } from '../App'
import { km as kmText, mmss } from '../lib/format'
import { go } from '../lib/router'
import { ErrorNote, Label, Meter, Spinner, toneFor } from '../ui/kit'

import { Hud, LegFooter, Stage } from './Stage'
import { useSpeechMode } from './Speech'
import { useLeg, type Carry } from './useLeg'

type Phase = 'briefing' | 'leg' | 'gap' | 'sending'

/**
 * Смена целиком.
 *
 * Инциденты идут подряд по километражу одной линии, а между ними поезд
 * действительно едет: время перегона считает профиль движения, вагон за эти
 * минуты частично отходит, стресс частично спадает — но не до нуля, и с каждым
 * инцидентом пол усталости поднимается. Именно поэтому смена ощущается
 * не как четыре упражнения, а как одна работа.
 *
 * На сервер уходит один пакет: пути по всем инцидентам сразу. Сервер
 * проигрывает их подряд своим ядром и сам переносит состояние — подделать
 * смену не проще, чем отдельный эпизод.
 */
export function Trip({ tripId }: { tripId: string }) {
  const [pack, setPack] = useState<TripPackage | null>(null)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<Phase>('briefing')
  const [index, setIndex] = useState(0)
  const [legPaths, setLegPaths] = useState<RunPath[]>([])
  const [carry, setCarry] = useState<Carry | null>(null)
  const [gap, setGap] = useState<ReturnType<typeof recover>['change'] | null>(null)
  const [startedAt] = useState(() => new Date().toISOString())
  const sent = useRef(false)

  useEffect(() => {
    api.trip(tripId)
      .then((r) => {
        if (r.line) registerLine(r.line)
        setPack(r)
      })
      .catch((e) => setError(errorText(e)))
  }, [tripId])

  const scenario: Scenario | null = pack?.scenarios[index] ?? null

  /**
   * Инцидент закончился: запоминаем путь, считаем перегон до следующего
   * и показываем, что за эти минуты изменилось. Последний инцидент
   * отправляет всю смену на сервер.
   */
  const onLegFinish = useCallback((path: RunPath, _outcome: unknown, world: World) => {
    if (!pack) return
    const paths = [...legPaths, path]
    setLegPaths(paths)

    const done = paths.length >= pack.scenarios.length
    if (done) {
      setPhase('sending')
      if (sent.current) return
      sent.current = true
      api.submitTrip({
        tripId: pack.trip.id,
        path: { startedAt, finishedAt: new Date().toISOString(), legs: paths }
      })
        .then((r) => go(`/debrief/${r.runId}`))
        .catch((e) => setError(errorText(e)))
      return
    }

    const next = index + 1
    const gapSec = pack.gaps[next - 1]?.gapSec ?? 0
    const from: Carry = {
      carMood: world.carMood,
      stress: world.stress,
      flags: [...world.flags]
    }
    const r = recover(from, gapSec, next)
    setCarry(r.carry)
    setGap(r.change)
    setIndex(next)
    setPhase('gap')
  }, [pack, legPaths, index, startedAt])

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
  if (!pack) return <div className="min-h-dvh grid place-items-center"><Spinner text="Подготовка смены" /></div>

  if (phase === 'briefing') {
    return <Briefing pack={pack} onStart={() => setPhase('leg')} />
  }
  if (phase === 'sending') {
    return (
      <div className="min-h-dvh grid place-items-center">
        <Spinner text="Смена закрыта, сервер считает результат" />
      </div>
    )
  }
  if (phase === 'gap' && gap && scenario) {
    return (
      <Interstitial
        pack={pack}
        index={index}
        gap={gap}
        onContinue={() => setPhase('leg')}
      />
    )
  }
  if (!scenario) {
    return <div className="min-h-dvh grid place-items-center"><Spinner text="Посадка" /></div>
  }

  return (
    <LegRunner
      // Ключ обязателен: без него следующий инцидент достался бы хуку вместе
      // с накопленными шагами предыдущего, путь перестал бы сходиться с графом,
      // и смена вставала бы намертво. Каждый инцидент — свежий монтаж.
      key={`${scenario.id}-${index}`}
      pack={pack}
      scenario={scenario}
      index={index}
      carry={carry}
      onFinish={onLegFinish}
    />
  )
}

// ---------------------------------------------------------------------------
// Один инцидент внутри смены
// ---------------------------------------------------------------------------

function LegRunner({
  pack, scenario, index, carry, onFinish
}: {
  pack: TripPackage
  scenario: Scenario
  index: number
  carry: Carry | null
  onFinish: (path: RunPath, outcome: unknown, world: World) => void
}) {
  const [speech, toggleSpeech] = useSpeechMode()
  const leg = useLeg(scenario, carry, onFinish)
  const speaking = speech && !leg.revealed

  if (!leg.world || !leg.node) {
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
        line={pack.line}
        world={leg.world}
        remaining={leg.remaining}
        limit={leg.node.limitSec ?? 0}
        stressed={leg.stressed}
        extra={
          <span className="text-accent uppercase tracking-[0.12em]">
            инцидент {index + 1} из {pack.scenarios.length}
          </span>
        }
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
            quitLabel="Сойти со смены"
            speech={speech}
            onToggleSpeech={toggleSpeech}
          />
        )}
      >
        {leg.finished && leg.outcome ? (
          <article className="flex flex-col gap-4 animate-rise">
            <div
              className={`border-l-2 pl-4 flex flex-col gap-3 ${
                leg.outcome.verdict === 'good' ? 'border-good'
                  : leg.outcome.verdict === 'bad' ? 'border-danger' : 'border-warn'
              }`}
            >
              <Label>Инцидент {index + 1} закрыт</Label>
              <p className="text-lg leading-snug max-w-[55ch]">{leg.outcome.text}</p>
            </div>
            <Spinner text="Смена продолжается" />
          </article>
        ) : undefined}
      </Stage>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Инструктаж перед сменой
// ---------------------------------------------------------------------------

function Briefing({ pack, onStart }: { pack: TripPackage; onStart: () => void }) {
  const line = pack.line
  const service = line?.services.find((s) => s.id === pack.trip.service)
  const total = pack.scenarios.reduce((s, sc) => s + (sc.estimatedSec ?? 180), 0)

  return (
    <div className="min-h-dvh flex flex-col">
      <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-10 flex flex-col gap-8 flex-1 justify-center">
        <div className="flex flex-col gap-3">
          <Label>{service?.title ?? line?.title}</Label>
          <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-wide leading-none">
            {pack.trip.title}
          </h1>
          <p className="text-lg leading-snug text-muted max-w-[62ch]">{pack.trip.briefing}</p>
        </div>

        <div className="card p-5 flex flex-col gap-4">
          <Label>Что вас ждёт</Label>
          <div className="flex flex-col divide-y divide-hair">
            {pack.scenarios.map((sc, i) => (
              <div key={sc.id} className="py-3 flex items-baseline gap-4">
                <span className="num text-xs text-accent w-16 shrink-0">
                  {sc.context?.startKm} км
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm">
                    {pack.trip.legs[i]?.lead ?? sc.summary}
                  </span>
                  <span className="label mt-0.5 block">
                    {line
                      ? `${trainState(line, pack.trip.service, sc.context?.startKm ?? 0, 0).speedKmh} км/ч`
                      : ''}
                    {pack.gaps[i - 1] ? ` · перегон ${mmss(pack.gaps[i - 1].gapSec)}` : ''}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className="text-sm text-faint max-w-[62ch]">
            Инциденты идут по километражу линии. Между ними поезд едет, и это время
            настоящее: вагон частично успокаивается, стресс частично спадает —
            но не до конца, и с каждым инцидентом усталость копится.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button className="btn btn-primary" onClick={onStart}>
            Заступить на смену
          </button>
          <button className="btn" onClick={() => go('/')}>Назад</button>
          <span className="label">
            {pack.scenarios.length} инцидента · около {Math.round(total / 60)} минут
          </span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Перегон между инцидентами
// ---------------------------------------------------------------------------

/**
 * Экран перегона.
 *
 * Единственный момент смены, когда ничего не решается, — и именно он делает
 * смену сменой. Здесь видно, сколько поезд прошёл, сколько это заняло
 * и что за это время произошло с вагоном и с вами.
 */
function Interstitial({
  pack, index, gap, onContinue
}: {
  pack: TripPackage
  index: number
  gap: NonNullable<ReturnType<typeof recover>['change']>
  onContinue: () => void
}) {
  const line = pack.line as Line
  const from = pack.gaps[index - 1]?.fromKm ?? 0
  const to = pack.gaps[index - 1]?.toKm ?? 0
  const next = pack.scenarios[index]

  const speeds = useMemo(() => {
    if (!line) return []
    const out: { km: number; kmh: number }[] = []
    for (let i = 0; i <= 6; i += 1) {
      const km = from + ((to - from) * i) / 6
      out.push({ km, kmh: trainState(line, pack.trip.service, km, 0).speedKmh })
    }
    return out
  }, [line, pack.trip.service, from, to])

  const moodDelta = gap.carMood[1] - gap.carMood[0]
  const stressDelta = gap.stress[1] - gap.stress[0]

  return (
    <div className="min-h-dvh flex flex-col">
      <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-10 flex flex-col gap-8 flex-1 justify-center animate-rise">
        <div className="flex flex-col gap-2">
          <Label>Перегон</Label>
          <h1 className="font-display text-3xl uppercase tracking-wide leading-none">
            {kmText((to - from) * 1000)} без происшествий
          </h1>
          <p className="text-muted">
            {mmss(gap.gapSec)} хода от {Math.round(from)} до {Math.round(to)} километра.
          </p>
        </div>

        {/* Профиль скорости на перегоне: видно, где состав шёл четыреста. */}
        {speeds.length ? (
          <div className="card p-4 flex flex-col gap-3">
            <Label>Скорость на перегоне</Label>
            <div className="flex items-stretch gap-1 h-20">
              {speeds.map((s, i) => (
                <div key={i} className="flex-1 flex flex-col justify-end">
                  <span className="num text-[0.6rem] text-faint text-center pb-1">{s.kmh}</span>
                  <div
                    className="w-full bg-accent/70 min-h-[2px]"
                    style={{ height: `${Math.max(4, (s.kmh / 400) * 100)}%` }}
                    title={`${Math.round(s.km)} км · ${s.kmh} км/ч`}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between label">
              <span>{Math.round(from)} км</span>
              <span>{Math.max(...speeds.map((s) => s.kmh))} км/ч максимум</span>
              <span>{Math.round(to)} км</span>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Recovery
            title="Настроение вагона"
            from={gap.carMood[0]}
            to={gap.carMood[1]}
            delta={moodDelta}
            note={
              moodDelta > 0
                ? 'Пассажиры немного отошли — но не забыли.'
                : 'Вагон и так был спокоен.'
            }
          />
          <Recovery
            title="Ваш стресс"
            from={gap.stress[0]}
            to={gap.stress[1]}
            delta={stressDelta}
            invert
            note={`Ниже ${gap.fatigueFloor} не опустится: смена копит усталость.`}
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button className="btn btn-primary" onClick={onContinue}>
            Инцидент {index + 1} из {pack.scenarios.length}
          </button>
          <span className="label max-w-md">
            {pack.trip.legs[index]?.lead ?? next?.summary}
          </span>
        </div>
      </div>
    </div>
  )
}

function Recovery({
  title, from, to, delta, note, invert = false
}: {
  title: string
  from: number
  to: number
  delta: number
  note: string
  invert?: boolean
}) {
  const good = invert ? delta < 0 : delta > 0
  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <Label>{title}</Label>
        <span className={`num text-sm ${delta === 0 ? 'text-faint' : good ? 'text-good' : 'text-warn'}`}>
          {from} → {to}
        </span>
      </div>
      <Meter value={to} tone={invert ? (to > 60 ? 'bad' : 'ink') : toneFor(to)} />
      <p className="text-sm text-faint">{note}</p>
    </div>
  )
}
