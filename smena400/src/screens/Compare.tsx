import { useEffect, useState } from 'react'

import { api, type Comparison, type Debrief as Report } from '../lib/api'
import { go } from '../lib/router'
import { sign } from '../lib/format'
import { Card, ErrorNote, Label, Panel, Spinner, Verdict, toneVar } from '../ui/kit'
import { IconReplay, ScaleIcon } from '../ui/brand'

/**
 * Сравнение попыток.
 *
 * Отдельный экран, а не блок в разборе: это единственное место в продукте,
 * где доказывается главное утверждение — результат зависел от вас. Пока
 * сравнение было врезкой среди прочего, его пролистывали вместе с остальным.
 *
 * Показывается ровно то, что реально сохранено: изменение показателей, смена
 * исхода и решения, которые человек сделал иначе. Ничего не достраивается:
 * если сравнивать не с чем, экран честно об этом говорит.
 */
export function Compare({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<{
    debrief: Report
    attempt: number
    comparison: Comparison | null
    previousAttempt: number | null
  } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.debrief(sessionId)
      .then(setData)
      .catch((e) => setError(e.message))
  }, [sessionId])

  if (error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 flex flex-col gap-4 items-start">
        <ErrorNote>{error}</ErrorNote>
        <button className="btn" onClick={() => go('/')}>К смене</button>
      </div>
    )
  }
  if (!data) {
    return <div className="mx-auto w-full max-w-3xl px-4 py-10"><Spinner text="Сравниваем попытки" /></div>
  }

  const c = data.comparison
  const previous = data.previousAttempt
  const attempt = data.attempt

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 flex flex-col gap-7">
      <header className="flex flex-col gap-2">
        <Label>Сравнение</Label>
        <h1 className="text-2xl font-bold leading-tight">{data.debrief.scenario.title}</h1>
        <p className="text-sm text-muted">
          Попытка {previous ?? '—'} против попытки {attempt}
        </p>
      </header>

      {!c ? (
        <Card className="p-5 flex flex-col gap-3">
          <p className="text-sm">
            Сравнивать пока не с чем: это первое завершённое прохождение
            ситуации. Пройдите её ещё раз другой стратегией — и здесь появится
            разница.
          </p>
          <button className="btn btn-primary self-start" onClick={() => go(`/debrief/${sessionId}`)}>
            К разбору
          </button>
        </Card>
      ) : (
        <>
          {/* --------------------------------------------------- исход */}
          <Card className="p-5 flex flex-col gap-4">
            <Label>Чем кончилось</Label>
            <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
              <div className="flex-1">
                <span className="label">было</span>
                <p className="text-[0.95rem] mt-1 text-muted">{c.outcomeBefore}</p>
              </div>
              <span className="text-faint text-xl" aria-hidden="true">→</span>
              <div className="flex-1">
                <span className="label">стало</span>
                <p className="text-[0.95rem] mt-1">{c.outcomeAfter}</p>
              </div>
            </div>
            <div>
              <Verdict verdict={data.debrief.outcome.verdict} />
            </div>
            <p className="text-sm text-muted max-w-[62ch]">
              {c.outcomeChanged
                ? 'Исход изменился. Значит, решение, которое вы поменяли, действительно на него влияло.'
                : 'Исход тот же. Значит, решающее решение осталось прежним — и менять стоило именно его.'}
            </p>
          </Card>

          {/* ----------------------------------------------- показатели */}
          <Card className="p-5">
            <Label className="mb-4">Сравнение стратегий</Label>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="pb-3 font-normal"><span className="label">показатель</span></th>
                    <th className="pb-3 font-normal text-right">
                      <span className="label">попытка {previous ?? '—'}</span>
                    </th>
                    <th className="pb-3 font-normal text-right">
                      <span className="label">попытка {attempt}</span>
                    </th>
                    <th className="pb-3 font-normal text-right"><span className="label">разница</span></th>
                  </tr>
                </thead>
                <tbody>
                  {c.scales.map((s) => (
                    <tr key={s.id} className="border-t border-hair">
                      <td className="py-3">
                        <span className="flex items-center gap-2">
                          <span style={{ color: `rgb(${toneVar(s.id)})` }}>
                            <ScaleIcon id={s.id} size={15} />
                          </span>
                          {s.title}
                        </span>
                      </td>
                      <td className="py-3 text-right num text-muted">{s.before}</td>
                      <td
                        className="py-3 text-right num font-semibold text-base"
                        style={{ color: `rgb(${toneVar(s.id)})` }}
                      >
                        {s.after}
                      </td>
                      <td className={`py-3 text-right num ${s.delta >= 0 ? 'text-good' : 'text-danger'}`}>
                        {sign(s.delta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* -------------------------------------- изменённые решения */}
          <section className="flex flex-col gap-3">
            <Label>Что вы сделали по-другому</Label>
            {c.changedDecisions.length ? (
              c.changedDecisions.map((x) => (
                <Card key={x.step} className="p-4 flex flex-col gap-3">
                  <div>
                    <Label>Шаг {x.step}</Label>
                    <p className="text-sm text-muted mt-1 max-w-[62ch]">{x.situation}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="border-l-2 border-hair pl-3">
                      <span className="label">было</span>
                      <p className="text-sm text-muted line-through decoration-faint/60">{x.before}</p>
                    </div>
                    <div className="border-l-2 border-accent pl-3">
                      <span className="label text-accent">стало</span>
                      <p className="text-[0.95rem]">{x.after}</p>
                    </div>
                  </div>
                </Card>
              ))
            ) : (
              <Panel className="p-4">
                <p className="text-sm text-muted max-w-[62ch]">
                  Ключевые решения совпали с прошлой попыткой. Разница в показателях,
                  если она есть, пришла от шагов, которые не считаются развилками.
                </p>
              </Panel>
            )}
          </section>
        </>
      )}

      <div className="flex flex-wrap gap-3 border-t border-hair pt-5">
        <button className="btn btn-primary" onClick={() => go(`/debrief/${sessionId}`)}>
          <IconReplay size={15} /> Разбор этой попытки
        </button>
        <button className="btn" onClick={() => go('/')}>К смене</button>
      </div>
    </div>
  )
}
