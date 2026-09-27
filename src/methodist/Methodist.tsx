import { useEffect, useState } from 'react'

import { api, type GraphStats, type ScenarioVersionRow } from '../lib/api'
import { errorText } from '../App'
import { relativeDay } from '../lib/format'
import { go } from '../lib/router'
import { Card, Empty, ErrorNote, Label, Meter, Section, Spinner } from '../ui/kit'

/**
 * Кабинет методиста: список сценариев и статистика по узлам графа.
 *
 * Второй блок — самостоятельная ценность для заказчика. Если больше половины
 * бригады на одном узле уходит не туда, проблема не в людях, а в регламенте
 * или в инструктаже. Ни один тест такого не показывает: он говорит,
 * сколько человек ответили неверно, но не на каком именно решении.
 */
export function Methodist() {
  const [rows, setRows] = useState<ScenarioVersionRow[] | null>(null)
  const [stats, setStats] = useState<GraphStats | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [error, setError] = useState('')

  useEffect(() => {
    api.methodistScenarios()
      .then((r) => {
        setRows(r.versions)
        const first = r.versions[0]?.id
        if (first) setSelected(first)
      })
      .catch((e) => setError(errorText(e)))
  }, [])

  useEffect(() => {
    if (!selected) return
    setStats(null)
    api.graphStats(selected).then(setStats).catch(() => setStats(null))
  }, [selected])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!rows) return <Spinner />

  // Показываем последнюю версию каждого сценария, старые прячем в подпись.
  const latest = new Map<string, ScenarioVersionRow>()
  for (const r of rows) if (!latest.has(r.id)) latest.set(r.id, r)
  const versionsOf = (id: string) => rows.filter((r) => r.id === id).length

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Label>Учебный центр ВСМ</Label>
          <h1 className="font-display text-3xl uppercase tracking-wide leading-none mt-1">
            Сценарии
          </h1>
        </div>
        <p className="text-sm text-muted max-w-md">
          Опубликованная версия неизменяема: правки создают новую, и те, кто уже проходит
          сценарий, доигрывают на старой. Статистика собирается по версиям.
        </p>
      </section>

      <Section eyebrow="Библиотека" title={`Сценариев ${latest.size}`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...latest.values()].map((r) => (
            <Card key={r.id} className="p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-display text-base uppercase tracking-wide leading-tight">
                  {r.title}
                </h3>
                <span className="num text-xs text-faint">v{r.version}</span>
              </div>
              <p className="text-sm text-muted flex-1">{r.summary}</p>
              <div className="label">
                {versionsOf(r.id) > 1 ? `версий: ${versionsOf(r.id)} · ` : ''}
                {r.published_at ? `опубликован ${relativeDay(r.published_at)}` : 'черновик'}
              </div>
              <div className="flex gap-2">
                <button className="btn" onClick={() => go(`/methodist/${r.id}`)}>Редактор</button>
                <button
                  className={`btn ${selected === r.id ? 'border-accent text-accent' : ''}`}
                  onClick={() => setSelected(r.id)}
                >
                  Статистика
                </button>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {selected ? (
        <Section
          eyebrow="Аналитика по графу"
          title={stats ? stats.scenario.title : 'Загрузка'}
        >
          {!stats ? <Spinner text="Считаем" /> : (
            <>
              {stats.problems.length ? (
                <div className="card border-l-2 border-l-danger p-4 flex flex-col gap-2">
                  <Label>Узлы-провалы</Label>
                  <p className="text-sm">
                    На этих решениях по эталону идёт меньше половины бригады. Это повод
                    посмотреть не на людей, а на формулировку регламента и на инструктаж.
                  </p>
                  <ul className="flex flex-col gap-1 list-none p-0 m-0">
                    {stats.problems.map((p) => (
                      <li key={p.node} className="text-sm flex gap-3">
                        <span className="num text-danger w-10">{p.correctShare} %</span>
                        <span className="text-muted">{p.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  Узлов, где ошибается больше половины бригады, нет.
                </p>
              )}

              {stats.nodes.length ? (
                <div className="flex flex-col gap-4">
                  {stats.nodes.map((n) => (
                    <Card key={n.node} className="p-4 flex flex-col gap-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <span className="num text-xs text-faint">{n.node}</span>
                        {n.correctShare !== null ? (
                          <span className={`num text-sm ${n.correctShare < 50 ? 'text-danger' : 'text-good'}`}>
                            по эталону {n.correctShare} %
                          </span>
                        ) : (
                          <span className="label">множественный выбор</span>
                        )}
                      </div>
                      <p className="text-sm text-muted">{n.text}</p>
                      <div className="flex flex-col gap-2">
                        {n.choices.map((c) => (
                          <div key={c.id} className="grid grid-cols-[1fr_6rem_2.5rem] items-center gap-3 text-sm">
                            <span className="truncate" title={c.text}>{c.text}</span>
                            <Meter value={c.share} tone="ink" height="h-1.5" />
                            <span className="num text-xs text-faint text-right">{c.share} %</span>
                          </div>
                        ))}
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <Empty>По этой версии сценария ещё нет прохождений.</Empty>
              )}
            </>
          )}
        </Section>
      ) : null}
    </>
  )
}
