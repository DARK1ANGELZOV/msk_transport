import { useEffect, useState } from 'react'

import { api, type Meta, type Progress as Data } from '../lib/api'
import { go } from '../lib/router'
import { plural } from '../lib/format'
import { Card, CompetencyBar, ErrorNote, Label, Spinner } from '../ui/kit'

/**
 * Прогресс.
 *
 * Сознательно скромный экран. Профиль, уровни и рейтинги легко превращают
 * тренажёр в соревнование за цифру, а задача продукта — чтобы человек
 * возвращался в ситуацию и пробовал иначе. Поэтому здесь только два вопроса:
 * что вы проходили и что в этих решениях проявилось.
 */
export function Progress({ name }: { name: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api.progress(), api.meta()])
      .then(([p, m]) => {
        setData(p)
        setMeta(m)
      })
      .catch((e) => setError(e.message))
  }, [])

  if (error) {
    return <div className="mx-auto w-full max-w-3xl px-4 py-10"><ErrorNote>{error}</ErrorNote></div>
  }
  if (!data) return <div className="mx-auto w-full max-w-3xl px-4 py-10"><Spinner /></div>

  const touched = data.competency.filter((c) => c.touched)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Label>Профиль · {name}</Label>
        <h1 className="text-2xl font-bold leading-tight">
          {data.runs
            ? `${data.runs} ${plural(data.runs, 'прохождение', 'прохождения', 'прохождений')}`
            : 'Пока ни одного прохождения'}
        </h1>
        {!data.runs && (
          <p className="text-sm text-muted max-w-[62ch]">
            Выберите ситуацию и пройдите её. После разбора здесь появится,
            что именно проявилось в ваших решениях.
          </p>
        )}
      </header>

      <section className="flex flex-col gap-3">
        <Label>Ситуации</Label>
        {data.scenarios.map((s) => (
          <Card key={s.id}>
            <button
              className="w-full text-left p-4 flex items-center justify-between gap-4 hover:bg-sunken transition-colors"
              onClick={() => go(`/s/${s.id}`)}
            >
              <div className="min-w-0">
                <p className="text-[0.95rem] leading-snug">{s.title}</p>
                <span className="label">
                  {s.attempts
                    ? `${s.attempts} ${plural(s.attempts, 'попытка', 'попытки', 'попыток')}`
                    : 'не пройдена'}
                </span>
              </div>
              {s.attempts > 0 && (
                <div className="flex items-baseline gap-4 shrink-0">
                  <span className="num text-loyalty">{s.lastLoyalty}</span>
                  <span className="num text-safety">{s.lastSafety}</span>
                </div>
              )}
            </button>
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <Label>Компетенции</Label>
        <Card className="p-4 flex flex-col gap-4">
          {data.competency.map((c) => (
            <CompetencyBar
              key={c.id}
              title={c.title}
              hint={
                c.touched
                  ? meta?.competencies.find((m) => m.id === c.id)?.hint
                  : 'ещё не проверялась'
              }
              pct={c.pct}
              touched={c.touched}
            />
          ))}
          <p className="text-xs text-faint max-w-[62ch]">
            {touched.length
              ? 'Считается по вашим решениям во всех пройденных ситуациях. Отдельных тестов на компетенции нет: они проявляются в выборе, а не в ответах на вопросы.'
              : 'Компетенции появятся после первого разбора.'}
          </p>
        </Card>
      </section>

      <div>
        <button className="btn" onClick={() => go('/')}>К смене</button>
      </div>
    </div>
  )
}
