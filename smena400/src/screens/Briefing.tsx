import { useEffect, useState } from 'react'

import { api, type ScenarioPassport } from '../lib/api'
import { go } from '../lib/router'
import { Card, ErrorNote, Label, ScaleBar, Spinner } from '../ui/kit'

/**
 * Ввод в ситуацию.
 *
 * Экран отвечает на один вопрос: где вы находитесь и чем располагаете.
 * Ни одного намёка на то, что случится и какие решения правильные, —
 * иначе тренировка превращается в проверку памяти.
 *
 * Зато здесь полностью раскрыт источник. Разделение «что следует
 * из стандарта» и «что придумали мы» показано пользователю дословно:
 * тренажёр, который выдаёт свои правила за нормативные, вредит.
 */
export function Briefing({ scenarioId }: { scenarioId: string }) {
  const [sc, setSc] = useState<ScenarioPassport | null>(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    api.scenario(scenarioId)
      .then((r) => setSc(r.scenario))
      .catch((e) => setError(e.message))
  }, [scenarioId])

  const start = () => {
    setStarting(true)
    api.start(scenarioId)
      .then((r) => go(`/play/${r.screen.sessionId}`))
      .catch((e) => {
        setError(e.message)
        setStarting(false)
      })
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 flex flex-col gap-4 items-start">
        <ErrorNote>{error}</ErrorNote>
        <button className="btn" onClick={() => go('/')}>К смене</button>
      </div>
    )
  }
  if (!sc) return <div className="mx-auto w-full max-w-3xl px-4 py-10"><Spinner /></div>

  const p = sc.context.passenger_profile

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 flex flex-col gap-7">
      {/*
        Фотография отвечает на вопрос «где я», прежде чем текст ответит
        на вопрос «что происходит». Именно за этим она здесь и стоит.
      */}
      <header className="flex flex-col gap-4">
        {sc.media && (
          <div className="relative h-44 sm:h-56 overflow-hidden" style={{ borderRadius: 10 }}>
            <img
              src={sc.media.card}
              alt={sc.media.alt}
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgb(var(--c-ground) / .25), rgb(var(--c-ground) / .92) 94%)'
              }}
            />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label>Ввод в ситуацию</Label>
          <h1 className="text-2xl font-bold leading-tight">{sc.title}</h1>
          {sc.subtitle && <p className="text-muted">{sc.subtitle}</p>}
        </div>
      </header>

      <Card className="p-4 flex flex-col gap-4">
        <Label>Обстановка</Label>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
          <Fact term="Этап поездки" value={sc.context.trip_stage} />
          <Fact term="Класс" value={sc.context.service_class} />
          <Fact term="Вагон" value={sc.context.car} />
          <Fact term="Зона" value={sc.context.location} />
          <Fact term="Срочность" value={sc.context.urgency} />
          <Fact term="Риск" value={sc.context.safety_risk ?? null} />
        </dl>

        {p && (
          <div className="border-t border-hair pt-3">
            <Label>Пассажир</Label>
            <p className="text-sm mt-1">{p.who}</p>
            {p.state && <p className="text-sm text-muted">{p.state}</p>}
            {p.mobility && p.mobility !== 'обычная' && (
              <p className="text-sm text-accent mt-1">Маломобильный пассажир: {p.mobility}</p>
            )}
          </div>
        )}
      </Card>

      <div className="grid sm:grid-cols-2 gap-3">
        <Card className="p-4">
          <Label>Что у вас есть</Label>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm list-none p-0">
            {(sc.context.available_resources ?? []).map((r) => (
              <li key={r} className="flex gap-2">
                <span className="text-accent" aria-hidden="true">·</span>
                {r}
              </li>
            ))}
          </ul>
          <p className="text-xs text-faint mt-3">
            Действий, для которых нет ресурса, в ситуации не будет:
            тренажёр не предлагает того, что вы не могли бы сделать.
          </p>
        </Card>

        <Card className="p-4">
          <Label>Ограничения</Label>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm list-none p-0">
            {(sc.context.constraints ?? []).map((c) => (
              <li key={c} className="flex gap-2">
                <span className="text-warn" aria-hidden="true">·</span>
                {c}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="p-4 flex flex-col gap-4">
        <Label>Что отслеживается в этой ситуации</Label>
        <div className="flex gap-6">
          {sc.scaleMeta.map((m) => (
            <ScaleBar key={m.id} meta={m} value={(sc.scales as Record<string, number>)[m.id] ?? 0} />
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          {sc.scaleMeta.map((m) => (
            <p key={m.id} className="text-sm text-muted max-w-[62ch]">
              <span className="text-ink">{m.title}</span> — {m.hint}.
            </p>
          ))}
        </div>
        <p className="text-sm text-muted max-w-[62ch]">
          Показатели независимы: одно и то же решение может поднять один
          и опустить другой. Именно в этом расхождении и состоит работа.
        </p>
      </Card>

      <Sources sc={sc} />

      <div className="flex flex-wrap gap-3 pt-1">
        <button className="btn btn-primary" onClick={start} disabled={starting}>
          {starting ? 'Входим…' : 'Войти в ситуацию'}
        </button>
        <button className="btn" onClick={() => go('/')}>Назад</button>
      </div>
    </div>
  )
}

function Fact({ term, value }: { term: string; value: string | null }) {
  if (!value) return null
  return (
    <div>
      <dt className="label">{term}</dt>
      <dd className="text-sm mt-0.5">{value}</dd>
    </div>
  )
}

/**
 * Источник ситуации целиком.
 *
 * Свёрнуто по умолчанию — но развернуть может любой, и там нет ничего,
 * что продукт стеснялся бы показать: и откуда взята фабула, и что именно
 * мы придумали сами.
 */
function Sources({ sc }: { sc: ScenarioPassport }) {
  return (
    <details className="card p-4">
      <summary className="label cursor-pointer select-none">
        Источник и нормативная опора
      </summary>

      <div className="mt-4 flex flex-col gap-5">
        <div>
          <Label>Зачем эта ситуация в тренажёре</Label>
          <p className="text-sm mt-1 max-w-[68ch]">{sc.source.scenario_rationale}</p>
        </div>

        <div>
          <Label className="text-safety">Следует из источника</Label>
          <ul className="mt-2 flex flex-col gap-2 text-sm list-none p-0 border-l-2 border-safety pl-3">
            {sc.source.normative_rule.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>

        <div>
          <Label className="text-loyalty">Игровая интерпретация — наша разработка</Label>
          <ul className="mt-2 flex flex-col gap-2 text-sm text-muted list-none p-0 border-l-2 border-loyalty pl-3">
            {sc.source.gameplay_interpretation.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>

        <div>
          <Label>Ссылка на источник</Label>
          <p className="text-xs text-faint mt-1 max-w-[68ch]">{sc.source.source_reference}</p>
        </div>
      </div>
    </details>
  )
}
