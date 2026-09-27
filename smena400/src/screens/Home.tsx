import { useEffect, useState } from 'react'

import { api, type Meta, type Progress as ProgressData, type ScenarioCard } from '../lib/api'
import { go } from '../lib/router'
import { Card, ErrorNote, Label, Spinner } from '../ui/kit'

/**
 * Список ситуаций.
 *
 * Карточка показывает контекст и номер ситуации в банке сразу, до входа.
 * Это не техническая подробность: человек должен видеть, что тренажёр
 * основан на реальном материале, а не на придуманных кейсах, — и видеть
 * это раньше, чем начнёт принимать решения.
 */
export function Home() {
  const [list, setList] = useState<ScenarioCard[] | null>(null)
  const [progress, setProgress] = useState<ProgressData | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api.scenarios(), api.progress(), api.meta()])
      .then(([s, p, m]) => {
        setList(s.scenarios)
        setProgress(p)
        setMeta(m)
      })
      .catch((e) => setError(e.message))
  }, [])

  if (error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <ErrorNote>{error}</ErrorNote>
      </div>
    )
  }
  if (!list) {
    return <div className="mx-auto w-full max-w-3xl px-4 py-10"><Spinner /></div>
  }

  const attemptsOf = (id: string) =>
    progress?.scenarios.find((s) => s.id === id)?.attempts ?? 0

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold leading-tight">
          Не угадай правильный ответ.<br />Прими правильное решение.
        </h1>
        <p className="text-sm text-muted max-w-[62ch]">
          Рабочая ситуация на высокоскоростном поезде. Время ограничено,
          вариантов несколько, и у каждого есть последствия — иногда сразу,
          иногда через несколько шагов. Пройти можно сколько угодно раз:
          именно сравнение попыток и показывает, что зависело от вас.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <Label>Ситуации · {list.length}</Label>
        <div className="flex flex-col gap-3">
          {list.map((s) => (
            <SituationCard key={s.id} s={s} attempts={attemptsOf(s.id)} />
          ))}
        </div>
      </section>

      {meta && (
        <section className="flex flex-col gap-2 border-t border-hair pt-5">
          <Label>Как это устроено</Label>
          <p className="text-sm text-muted max-w-[62ch]">
            Ситуации взяты из банка «Ситуации на борту»; нормативная рамка —
            стандарты обслуживания пассажиров ВСМ. В каждой ситуации отдельно
            указано, что следует из источника, а что является игровой
            интерпретацией: тренажёр не выдаёт свои правила за нормативные.
          </p>
          <p className="text-xs text-faint max-w-[62ch]">{meta.ai.note}</p>
        </section>
      )}
    </div>
  )
}

function SituationCard({ s, attempts }: { s: ScenarioCard; attempts: number }) {
  const ctx = [s.context.trip_stage, s.context.service_class && `класс ${s.context.service_class}`, s.context.car]
    .filter(Boolean)
    .join(' · ')

  return (
    <Card>
      <button
        className="w-full text-left p-4 flex flex-col gap-3 hover:bg-sunken transition-colors"
        onClick={() => go(`/s/${s.id}`)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-snug">{s.title}</h2>
            {s.subtitle && <p className="text-sm text-muted mt-0.5">{s.subtitle}</p>}
          </div>
          {s.context.urgency && (
            <span
              className={`chip shrink-0 ${
                s.context.urgency === 'критическая'
                  ? 'border-danger text-danger'
                  : s.context.urgency === 'высокая'
                    ? 'border-warn text-warn'
                    : ''
              }`}
            >
              {s.context.urgency}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="label">{ctx}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-hair">
          <span className="text-xs text-faint">
            {s.source.document}, {s.source.situation}
          </span>
          <span className="label">
            {attempts > 0 ? `попыток: ${attempts}` : 'не пройдена'}
          </span>
        </div>
      </button>
    </Card>
  )
}
