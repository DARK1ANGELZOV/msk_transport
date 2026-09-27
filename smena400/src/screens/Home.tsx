import { useEffect, useState } from 'react'

import { api, type Meta, type Progress as ProgressData, type ScenarioCard } from '../lib/api'
import { go } from '../lib/router'
import { Card, ErrorNote, Label, Panel, Spinner } from '../ui/kit'
import { IconAlert, IconBook, IconClock, IconTarget, IconTrain } from '../ui/brand'

/**
 * Главный экран — «Смена».
 *
 * Отвечает на один вопрос: что делать дальше. Поэтому наверху одна крупная
 * красная кнопка, которая ведёт в следующую непройденную ситуацию, и только
 * под ней — библиотека, если человек хочет выбрать сам.
 *
 * Уровней, очков и достижений здесь нет сознательно: они быстро становятся
 * целью вместо ситуации, а продукт про другое — вернуться и попробовать иначе.
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
    return <div className="mx-auto w-full max-w-5xl px-4 py-10"><ErrorNote>{error}</ErrorNote></div>
  }
  if (!list || !progress) {
    return <div className="mx-auto w-full max-w-5xl px-4 py-10"><Spinner /></div>
  }

  const attemptsOf = (id: string) => progress.scenarios.find((s) => s.id === id)?.attempts ?? 0
  const next = list.find((s) => attemptsOf(s.id) === 0) ?? list[0]
  const done = list.filter((s) => attemptsOf(s.id) > 0).length

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-7 flex flex-col gap-8">
      {/* ------------------------------------------------ текущая смена */}
      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <Label>Смена {name ? `· ${name}` : ''}</Label>
          <span className="label">ситуаций пройдено {done} из {list.length}</span>
        </div>

        <Card className="overflow-hidden">
          {/*
            Фотография показывает, где происходит ситуация. Тёмная заливка
            поверх неё держит контраст текста независимо от того, насколько
            светлым оказался кадр.
          */}
          {next.media && (
            <div className="relative h-36 sm:h-44">
              <img
                src={next.media.card}
                alt={next.media.alt}
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
              />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgb(var(--c-card) / .35), rgb(var(--c-card)) 96%)'
                }}
              />
            </div>
          )}
          <div className="p-5 sm:p-6 flex flex-col gap-5 relative">
            <div className="flex items-start gap-4">
              <span
                className="shrink-0 grid place-items-center rounded-lg text-accent"
                style={{
                  width: 52, height: 52,
                  background: 'rgb(var(--c-accent) / .12)',
                  border: '1px solid rgb(var(--c-accent) / .35)'
                }}
              >
                <IconTrain size={26} />
              </span>
              <div className="min-w-0">
                <Label>{done === 0 ? 'Начните отсюда' : 'Следующая ситуация'}</Label>
                <h1 className="text-2xl sm:text-3xl font-bold leading-tight mt-1.5">{next.title}</h1>
                {next.subtitle && <p className="text-muted text-sm mt-1.5">{next.subtitle}</p>}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {next.context.trip_stage && <span className="chip">{next.context.trip_stage}</span>}
              {next.context.service_class && (
                <span className="chip">класс {next.context.service_class}</span>
              )}
              {next.context.car && <span className="chip">{next.context.car}</span>}
              {next.context.urgency && (
                <span
                  className="chip"
                  style={{
                    color: 'rgb(var(--c-accent-soft))',
                    borderColor: 'rgb(var(--c-accent) / .45)',
                    background: 'rgb(var(--c-accent) / .1)'
                  }}
                >
                  <IconAlert size={13} /> {next.context.urgency}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <button className="btn btn-primary" onClick={() => go(`/s/${next.id}`)}>
                {done === 0 ? 'Заступить на смену' : 'Продолжить смену'}
              </button>
              <span className="text-xs text-faint flex items-center gap-1.5">
                <IconBook size={13} /> {next.source.situation}
              </span>
            </div>
          </div>
        </Card>
      </section>

      {/* -------------------------------------------------- библиотека */}
      <section className="flex flex-col gap-3">
        <Label>Библиотека ситуаций · {list.length}</Label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((s) => (
            <SituationCard key={s.id} s={s} attempts={attemptsOf(s.id)} />
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ о базе */}
      <Panel className="p-5 flex flex-col gap-2">
        <Label className="flex items-center gap-2">
          <IconBook size={13} /> Откуда ситуации
        </Label>
        <p className="text-sm text-muted max-w-[70ch]">
          Все ситуации взяты из банка «Ситуации на борту» — «Примеры ситуаций
          взаимодействия поездного персонала с пассажирами», 51 случай
          с рекомендуемой реакцией и речевыми модулями. Нормативная рамка — стандарты обслуживания
          пассажиров ВСМ: 974-р, 989-р и 990-р. В каждой ситуации отдельно
          указано, что следует из источника, а что является игровой
          интерпретацией.
        </p>
        {meta && <p className="text-xs text-faint max-w-[70ch]">{meta.ai.note}</p>}
      </Panel>
    </div>
  )
}

/**
 * Карточка ситуации.
 *
 * Вместо фотографии — градиент в цвете срочности с иконкой. Подходящих
 * изображений вагонов в материалах проекта нет, а случайные стоковые
 * фотографии хуже честной типографики.
 */
function SituationCard({ s, attempts }: { s: ScenarioCard; attempts: number }) {
  const urgent = s.context.urgency === 'критическая' || s.context.urgency === 'высокая'
  const hue = urgent ? 'var(--c-accent)' : 'var(--c-blue)'

  return (
    <button
      className="card text-left overflow-hidden transition-all hover:-translate-y-0.5"
      style={{ borderColor: 'rgb(var(--c-card-hair))' }}
      onClick={() => go(`/s/${s.id}`)}
    >
      <div
        className="relative h-28 flex items-end p-3"
        style={{ borderBottom: '1px solid rgb(var(--c-card-hair))' }}
      >
        {s.media ? (
          <img
            src={s.media.card}
            alt={s.media.alt}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(135deg, rgb(${hue} / .28), rgb(var(--c-raised)) 70%)` }}
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, rgb(var(--c-card) / .15), rgb(var(--c-card) / .92) 92%)`
          }}
        />
        <span className="relative" style={{ color: `rgb(${hue})` }}>
          <IconTarget size={20} />
        </span>
        {s.context.urgency && (
          <span className="relative ml-auto label" style={{ color: `rgb(${hue})` }}>
            {s.context.urgency}
          </span>
        )}
      </div>

      <div className="p-4 flex flex-col gap-2.5">
        <h3 className="font-semibold leading-snug">{s.title}</h3>
        {s.subtitle && <p className="text-sm text-muted leading-snug">{s.subtitle}</p>}
        <p className="text-xs text-faint">{s.source.situation}</p>
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="label flex items-center gap-1.5">
            <IconClock size={12} />
            {attempts > 0 ? `попыток: ${attempts}` : 'не пройдена'}
          </span>
          <span
            className="text-xs font-semibold px-3 py-1.5 rounded-md text-white"
            style={{ background: 'rgb(var(--c-accent))' }}
          >
            {attempts > 0 ? 'Пройти снова' : 'Начать'}
          </span>
        </div>
      </div>
    </button>
  )
}
