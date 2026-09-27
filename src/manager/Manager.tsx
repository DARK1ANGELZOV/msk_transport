import { useEffect, useState } from 'react'

import { competencyTitle } from '../../engine/index.js'
import { api, type ManagerOverview } from '../lib/api'
import { errorText } from '../App'
import { plural, relativeDay } from '../lib/format'
import { Empty, ErrorNote, Label, Section, Spinner } from '../ui/kit'

/**
 * Кабинет начальника резерва.
 *
 * Здесь нет рейтинга: руководителю нужен не список победителей, а ответ
 * на два вопроса — кого можно ставить в рейс и куда идти инструктору.
 * Поэтому главный экран — тепловая карта «бригады × компетенции»
 * и список готовности к допуску.
 */
export function Manager() {
  const [data, setData] = useState<ManagerOverview | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.overview().then(setData).catch((e) => setError(errorText(e)))
  }, [])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!data) return <Spinner />

  const ready = data.people.filter((p) => p.status === 'ready').length
  const near = data.people.filter((p) => p.status === 'near').length

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Label>Депо ВСМ · сводка</Label>
          <h1 className="font-display text-3xl uppercase tracking-wide leading-none mt-1">
            Готовность бригад
          </h1>
        </div>
        <dl className="flex gap-8">
          <div>
            <dt className="label">Проводников</dt>
            <dd className="num text-xl">{data.people.length}</dd>
          </div>
          <div>
            <dt className="label">Допуск</dt>
            <dd className={`num text-xl ${ready ? 'text-good' : 'text-warn'}`}>{ready}</dd>
          </div>
          <div>
            <dt className="label">Почти</dt>
            <dd className="num text-xl text-warn">{near}</dd>
          </div>
          <div>
            <dt className="label">Бригад</dt>
            <dd className="num text-xl">{data.brigades.length}</dd>
          </div>
        </dl>
      </section>

      <Section eyebrow="Тепловая карта" title="Бригады × компетенции">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[46rem]">
            <thead>
              <tr>
                <th className="label text-left py-2 px-2">Бригада</th>
                {data.competencies.map((c) => (
                  <th key={c.id} className="label text-center py-2 px-1" title={c.title}>
                    {c.short}
                  </th>
                ))}
                <th className="label text-right py-2 px-2">Допуск</th>
              </tr>
            </thead>
            <tbody>
              {data.brigades.map((b) => (
                <tr key={b.key} className="border-t border-hair">
                  <td className="py-2 px-2">
                    <div>{b.brigade}</div>
                    <div className="label">{b.depot}</div>
                  </td>
                  {data.competencies.map((c) => <Cell key={c.id} value={b.competency[c.id]} />)}
                  <td className="py-2 px-2 text-right num">
                    <span className={b.ready ? 'text-good' : 'text-faint'}>{b.ready}</span>
                    {b.near ? <span className="text-warn"> +{b.near}</span> : null}
                    <span className="text-faint"> / {b.size}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-faint max-w-[65ch]">
          Красное — куда идти инструктору. Значение считается как среднее по бригаде,
          свежие рейсы весят больше старых. Зелёным в колонке допуска — сотрудники,
          прошедшие порог, янтарным — те, кому осталась одна компетенция.
          Правило допуска: {data.readinessRule}. Это политика перевозчика,
          а не свойство тренажёра: пороги меняются в одном месте.
        </p>
      </Section>

      <Section eyebrow="Поимённо" title="Проводники">
        {data.people.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[46rem]">
              <thead>
                <tr>
                  <th className="label text-left py-2 px-2">Проводник</th>
                  <th className="label text-left py-2 px-2">Бригада</th>
                  <th className="label text-right py-2 px-2">Рейсов</th>
                  <th className="label text-left py-2 px-2">Слабое место</th>
                  <th className="label text-left py-2 px-2">Последний рейс</th>
                  <th className="label text-right py-2 px-2">Статус</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.id} className="border-t border-hair">
                    <td className="py-2 px-2">
                      <div>{p.name}</div>
                      <div className="label">таб. {p.tabNumber}</div>
                    </td>
                    <td className="py-2 px-2 text-muted">{p.brigade}</td>
                    <td className="py-2 px-2 text-right num">{p.runs}</td>
                    <td className="py-2 px-2">
                      {p.weakest ? (
                        <span className="text-muted">
                          {competencyTitle(p.weakest).toLowerCase()}
                          <span className="num text-xs text-faint ml-2">
                            {p.competency[p.weakest]}
                          </span>
                        </span>
                      ) : <span className="text-faint">—</span>}
                    </td>
                    <td className="py-2 px-2 text-muted">
                      {p.lastAt ? relativeDay(p.lastAt) : 'не занимался'}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <span className={
                        p.status === 'ready' ? 'text-good'
                          : p.status === 'near' ? 'text-warn' : 'text-danger'
                      }>
                        {p.status === 'ready' ? 'допуск'
                          : p.status === 'near' ? 'почти' : 'нужна практика'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>В депо ещё не заведены проводники.</Empty>
        )}
        <p className="text-sm text-faint max-w-[65ch]">
          Здесь видно, у кого какая компетенция просела, но не видно подробностей чужих рейсов:
          разбор конкретного прохождения открывает сам сотрудник и его наставник.
          {' '}Всего {plural(data.people.length, 'проводник', 'проводника', 'проводников')}.
        </p>
      </Section>
    </>
  )
}

function Cell({ value }: { value?: number }) {
  if (typeof value !== 'number') {
    return <td className="py-2 px-1 text-center text-faint">—</td>
  }
  const tone = value >= 70 ? 'bg-good' : value >= 50 ? 'bg-warn' : 'bg-danger'
  return (
    <td className="py-2 px-1 text-center">
      <span
        className={`inline-block w-full min-w-[2.6rem] py-1 num text-xs text-ground ${tone}`}
        style={{ opacity: 0.35 + (Math.min(100, value) / 100) * 0.65 }}
      >
        {value}
      </span>
    </td>
  )
}
