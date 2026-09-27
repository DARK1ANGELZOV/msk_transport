import { useEffect, useState } from 'react'

import { api, type Meta, type Progress as ProgressData, type ScenarioCard } from '../lib/api'
import { go } from '../lib/router'
import { Card, ErrorNote, Label, Panel, Spinner } from '../ui/kit'

/**
 * Главный экран — «Смена».
 *
 * Отвечает на один вопрос: что делать дальше. Поэтому наверху одна крупная
 * кнопка «Продолжить смену», которая ведёт в следующую непройденную ситуацию,
 * и только под ней — библиотека, если человек хочет выбрать сам.
 *
 * Уровней, очков и достижений здесь нет сознательно. Они быстро становятся
 * целью вместо ситуации, а продукт про другое: вернуться и попробовать иначе.
 */
export function Home({ name }: { name: string | null }) {
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
    return <div className="mx-auto w-full max-w-3xl px-4 py-10"><ErrorNote>{error}</ErrorNote></div>
  }
  if (!list || !progress) {
    return <div className="mx-auto w-full max-w-3xl px-4 py-10"><Spinner /></div>
  }

  const attemptsOf = (id: string) =>
    progress.scenarios.find((s) => s.id === id)?.attempts ?? 0

  const next = list.find((s) => attemptsOf(s.id) === 0) ?? list[0]
  const done = list.filter((s) => attemptsOf(s.id) > 0).length

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-7 flex flex-col gap-7">
      {/* ------------------------------------------------ текущая смена */}
      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <Label>Смена {name ? `· ${name}` : ''}</Label>
          <span className="label">
            ситуаций пройдено {done} из {list.length}
          </span>
        </div>

        <Card className="p-5 flex flex-col gap-4">
          <div>
            <Label>{done === 0 ? 'Начните отсюда' : 'Следующая ситуация'}</Label>
            <h1 className="text-2xl font-bold leading-tight mt-1.5">{next.title}</h1>
            {next.subtitle && <p className="text-muted text-sm mt-1">{next.subtitle}</p>}
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span className="label">{next.context.trip_stage}</span>
            {next.context.service_class && (
              <span className="label">класс {next.context.service_class}</span>
            )}
            <span className="label">{next.context.car}</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" onClick={() => go(`/s/${next.id}`)}>
              {done === 0 ? 'Заступить на смену' : 'Продолжить смену'}
            </button>
            <span className="text-xs text-faint">
              {next.source.document.includes('Ситуации')
                ? `Банк «Ситуации на борту», ${next.source.situation}`
                : next.source.situation}
            </span>
          </div>
        </Card>
      </section>

      {/* -------------------------------------------------- библиотека */}
      <section className="flex flex-col gap-3">
        <Label>Библиотека ситуаций · {list.length}</Label>
        <div className="flex flex-col gap-2.5">
          {list.map((s) => (
            <SituationRow key={s.id} s={s} attempts={attemptsOf(s.id)} />
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ о базе */}
      <Panel className="p-4 flex flex-col gap-2">
        <Label>Откуда ситуации</Label>
        <p className="text-sm text-muted max-w-[64ch]">
          Все ситуации взяты из банка «Примеры ситуаций взаимодействия поездного
          персонала с пассажирами» — 51 случай с рекомендуемой реакцией
          и речевыми модулями. Нормативная рамка — стандарты обслуживания
          пассажиров ВСМ: 974-р, 989-р и 990-р. В каждой ситуации отдельно
          указано, что следует из источника, а что является игровой
          интерпретацией.
        </p>
        {meta && <p className="text-xs text-faint max-w-[64ch]">{meta.ai.note}</p>}
      </Panel>
    </div>
  )
}

function SituationRow({ s, attempts }: { s: ScenarioCard; attempts: number }) {
  const urgent = s.context.urgency === 'критическая' || s.context.urgency === 'высокая'

  return (
    <button
      className="action"
      onClick={() => go(`/s/${s.id}`)}
    >
      <span className="flex-1 min-w-0">
        <span className="flex items-start justify-between gap-3">
          <span className="block text-[1rem] leading-snug font-medium">{s.title}</span>
          {s.context.urgency && (
            <span className={`chip shrink-0 ${urgent ? 'border-danger text-danger' : ''}`}>
              {s.context.urgency}
            </span>
          )}
        </span>
        {s.subtitle && <span className="block text-sm text-muted mt-1">{s.subtitle}</span>}
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
          <span className="label">{s.source.situation}</span>
          <span className="label">
            {attempts > 0 ? `попыток: ${attempts}` : 'не пройдена'}
          </span>
        </span>
      </span>
    </button>
  )
}
