import { useEffect, useState } from 'react'

import {
  api, type Comparison, type Debrief as Report, type Decision,
  type RewindPoint, type Scales, type TimelineItem
} from '../lib/api'
import { go } from '../lib/router'
import { seconds, sign } from '../lib/format'
import { Card, CompetencyBar, ErrorNote, Label, Spinner, Verdict } from '../ui/kit'

/**
 * Разбор.
 *
 * Главное правило продукта живёт на этом экране: здесь нигде не сказано,
 * какой ответ был правильным. Сказано, что сделал человек, к чему это
 * привело и как ситуация пошла бы при другом решении — с настоящей веткой
 * из сценария, а не с придуманной задним числом оценкой.
 *
 * Порядок блоков соответствует тому, как человек думает после ситуации:
 * сначала «чем кончилось», потом «что на это повлияло», потом «что было бы
 * иначе», и только в конце — компетенции и подробная лента.
 */
export function Debrief({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<{
    debrief: Report
    attempt: number
    comparison: Comparison | null
    previousAttempt: number | null
    rewindPoints: RewindPoint[]
  } | null>(null)
  const [error, setError] = useState('')
  const [again, setAgain] = useState(false)

  /**
   * Вернуться к развилке.
   *
   * Сервер воспроизводит записанный путь до этого шага и ставит человека
   * ровно туда, где он принимал решение, — со всеми последствиями прежних
   * ходов. Это не «начать сначала»: проверяется одна гипотеза, а не всё
   * прохождение заново.
   */
  const rewind = (step: number) => {
    setAgain(true)
    api.rewind(sessionId, step)
      .then((r) => go(`/play/${r.screen.sessionId}`))
      .catch((e) => {
        setError(e.message)
        setAgain(false)
      })
  }

  useEffect(() => {
    api.debrief(sessionId)
      .then(setData)
      .catch((e) => setError(e.message))
  }, [sessionId])

  const retry = () => {
    if (!data) return
    setAgain(true)
    api.start(data.debrief.scenario.id)
      .then((r) => go(`/play/${r.screen.sessionId}`))
      .catch((e) => {
        setError(e.message)
        setAgain(false)
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
  if (!data) return <div className="mx-auto w-full max-w-3xl px-4 py-10"><Spinner text="Собираем разбор" /></div>

  const d = data.debrief

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 flex flex-col gap-8">
      {/* ------------------------------------------------------- итог */}
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Label>Разбор · попытка {data.attempt}</Label>
          <Verdict verdict={d.outcome.verdict} />
        </div>
        <h1 className="text-xl font-bold leading-snug">{d.scenario.title}</h1>
        <p className="text-[0.95rem] leading-relaxed max-w-[62ch]">{d.outcome.text}</p>
        <p className="text-sm text-muted leading-relaxed max-w-[62ch] border-l-2 border-accent pl-3">
          {d.outcome.summary}
        </p>
      </header>

      {/* ------------------------------------------------------ шкалы */}
      <section className="grid sm:grid-cols-2 gap-3">
        {d.scales.map((s) => (
          <Card key={s.id} className="p-4">
            <Label>{s.title}</Label>
            <div className="flex items-baseline gap-3 mt-2">
              <span className="num text-faint text-lg">{s.from}</span>
              <span className="text-faint" aria-hidden="true">→</span>
              <span className={`num text-3xl ${toneOf(s.id)}`}>{s.to}</span>
              <span
                className={`num text-sm ${s.delta >= 0 ? 'text-good' : 'text-danger'}`}
              >
                {sign(s.delta)}
              </span>
            </div>
          </Card>
        ))}
      </section>

      {data.comparison && (
        <Card className="p-4 flex flex-wrap items-center justify-between gap-4 border-l-4 border-l-accent">
          <div>
            <Label className="text-accent">Есть с чем сравнить</Label>
            <p className="text-sm mt-1">
              {data.comparison.outcomeChanged
                ? `Исход изменился: было «${data.comparison.outcomeBefore}».`
                : 'Исход тот же, что и в прошлой попытке.'}
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => go(`/compare/${sessionId}`)}>
            Сравнить попытки
          </button>
        </Card>
      )}

      {/* ------------------------------------------- ключевые решения */}
      <section className="flex flex-col gap-3">
        <Label>Решения, которые определили исход</Label>
        {d.decisions.map((dec) => (
          <DecisionCard
            key={dec.step}
            d={dec}
            canRewind={data.rewindPoints.some((p) => p.step === dec.step)}
            busy={again}
            onRewind={() => rewind(dec.step)}
          />
        ))}
      </section>

      {/* ------------------------------ что получилось / что улучшить */}
      <section className="grid sm:grid-cols-2 gap-3">
        <Card className="p-4">
          <Label className="text-good">Что получилось</Label>
          <ul className="mt-2 flex flex-col gap-2.5 text-sm list-none p-0">
            {d.strengths.length ? (
              d.strengths.map((s, i) => <li key={i}>{s.text}</li>)
            ) : (
              <li className="text-muted">
                В этот раз ни одно решение не сыграло в плюс. Это поправимо —
                ситуация проходится заново.
              </li>
            )}
          </ul>
        </Card>
        <Card className="p-4">
          <Label className="text-warn">Что можно иначе</Label>
          <ul className="mt-2 flex flex-col gap-2.5 text-sm list-none p-0">
            {d.improvements.map((s, i) => <li key={i}>{s.text}</li>)}
          </ul>
        </Card>
      </section>

      {/* ------------------------------------------------ компетенции */}
      <section className="flex flex-col gap-3">
        <Label>Что проявилось</Label>
        <Card className="p-4 flex flex-col gap-4">
          {d.competency.map((c) => (
            <CompetencyBar
              key={c.id}
              title={c.title}
              hint={c.touched ? undefined : 'в этой ситуации не проверялось'}
              pct={c.pct}
              touched={c.touched}
            />
          ))}
          <p className="text-xs text-faint">
            Доля считается от того, что было достижимо на этом прохождении:
            часть веток вы закрыли своими же более ранними решениями.
          </p>
        </Card>
      </section>

      {/* ----------------------------------------------------- лента */}
      <Timeline items={d.timeline} />

      {/* ---------------------------------------------- повтор и выход */}
      <section className="flex flex-col gap-3 border-t border-hair pt-5">
        <p className="text-sm text-muted max-w-[62ch]">
          Повторное прохождение — не работа над ошибками, а проверка гипотезы.
          Можно вернуться к конкретной развилке кнопкой под решением: всё,
          что было до неё, сохранится, изменится только то, что вы решите там.
        </p>
        <div className="flex flex-wrap gap-3">
          <button className="btn btn-primary" onClick={retry} disabled={again}>
            {again ? 'Входим…' : 'Пройти ситуацию заново'}
          </button>
          {data.comparison && (
            <button className="btn" onClick={() => go(`/compare/${sessionId}`)}>
              Сравнить попытки
            </button>
          )}
          <button className="btn" onClick={() => go('/')}>К смене</button>
          <button className="btn btn-ghost" onClick={() => go('/progress')}>Профиль</button>
        </div>
      </section>
    </div>
  )
}

/**
 * Ключевое решение и соседняя ветка.
 *
 * Альтернатива — это действительно описанный в сценарии путь: его подпись,
 * его последствие, его влияние на шкалы. Никакой оценки «надо было так»:
 * человек сам сравнит два последствия и сделает вывод.
 */
function DecisionCard({
  d, canRewind, busy, onRewind
}: {
  d: Decision
  canRewind: boolean
  busy: boolean
  onRewind: () => void
}) {
  return (
    <Card className="p-4 flex flex-col gap-4">
      <div>
        <Label>Шаг {d.step}</Label>
        <p className="text-sm text-muted mt-1 max-w-[62ch]">{d.situation}</p>
      </div>

      <div className="border-l-2 border-accent pl-3">
        <Label className="text-accent">Вы выбрали</Label>
        <p className="text-[0.95rem] mt-1">{d.chosen.label}</p>
        {d.chosen.said && (
          <p className="text-sm text-muted italic mt-1">«{d.chosen.said}»</p>
        )}
        <Effects effects={d.chosen.effects} />
        {d.chosen.consequence && (
          <p className="text-sm text-muted mt-1.5 max-w-[62ch]">{d.chosen.consequence}</p>
        )}
      </div>

      {d.alternative && (
        <div className="border-l-2 border-hair pl-3">
          <Label>Если бы выбрали иначе</Label>
          <p className="text-[0.95rem] mt-1">{d.alternative.label}</p>
          <Effects effects={d.alternative.effects} />
          {d.alternative.consequence && (
            <p className="text-sm text-muted mt-1.5 max-w-[62ch]">{d.alternative.consequence}</p>
          )}
          {d.alternative.outcome_hint && (
            <p className="text-sm mt-2 max-w-[62ch] text-ink/90">{d.alternative.outcome_hint}</p>
          )}
        </div>
      )}

      {canRewind && (
        <button className="btn self-start" onClick={onRewind} disabled={busy}>
          {busy ? 'Возвращаемся…' : 'Вернуться сюда и решить иначе'}
        </button>
      )}
    </Card>
  )
}

/** Цвет показателя совпадает с тем, каким он был на экране ситуации. */
const TONE: Record<string, string> = {
  safety: 'text-safety',
  loyalty: 'text-loyalty',
  order: 'text-order',
  trust: 'text-trust'
}
const toneOf = (id: string) => TONE[id] ?? 'text-accent'

/** Человеческие подписи показателей: служебных идентификаторов на экране нет. */
const NAME: Record<string, string> = {
  safety: 'безопасность',
  loyalty: 'лояльность',
  order: 'порядок',
  trust: 'доверие'
}

function Effects({ effects }: { effects: Partial<Scales> }) {
  const items = Object.entries(effects ?? {}).filter(([, v]) => v)
  if (!items.length) return null
  return (
    <div className="flex flex-wrap gap-4 mt-1.5">
      {items.map(([k, v]) => (
        <span key={k} className="flex items-baseline gap-1">
          <span className={`text-xs ${toneOf(k)}`}>{NAME[k] ?? k}</span>
          <span className={`num text-xs ${(v as number) > 0 ? 'text-good' : 'text-danger'}`}>
            {sign(v as number)}
          </span>
        </span>
      ))}
    </div>
  )
}

/** Полная лента: что за чем происходило, включая отложенные последствия. */
function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <details className="card p-4">
      <summary className="label cursor-pointer select-none">
        Как всё происходило · {items.length} событий
      </summary>
      <ol className="mt-4 flex flex-col gap-4 list-none p-0">
        {items.map((it, i) =>
          it.type === 'action' ? (
            <li key={i} className="flex gap-3">
              <span className="num text-xs text-faint w-5 shrink-0 pt-1">{it.step}</span>
              <div className="flex-1 min-w-0 border-l-2 border-hair pl-3">
                <p className="text-sm">{it.label}</p>
                {it.said && <p className="text-sm text-muted italic">«{it.said}»</p>}
                <div className="flex flex-wrap items-center gap-3 mt-1">
                  <Effects effects={it.effects} />
                  <span className="label">
                    {it.timedOut ? 'не успел' : `раздумье ${seconds(it.thinkMs)}`}
                  </span>
                  {it.normative && <span className="label text-safety">опора на стандарт</span>}
                </div>
                {it.consequence && (
                  <p className="text-sm text-muted mt-1 max-w-[62ch]">{it.consequence}</p>
                )}
              </div>
            </li>
          ) : (
            <li key={i} className="flex gap-3">
              <span className="num text-xs text-faint w-5 shrink-0 pt-1">·</span>
              <div className="flex-1 min-w-0 border-l-2 border-warn pl-3">
                <Label className="text-warn">
                  {it.type === 'deferred' ? 'отложенное последствие' : 'событие'}
                  {it.causeLabel ? ` · причина: ${it.causeLabel}` : ''}
                </Label>
                <p className="text-sm text-muted mt-1 max-w-[62ch]">{it.note}</p>
                <Effects effects={it.effects} />
              </div>
            </li>
          )
        )}
      </ol>
    </details>
  )
}
