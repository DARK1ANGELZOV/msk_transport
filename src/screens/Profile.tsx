import { useEffect, useState } from 'react'

import { api, type ProfileResponse } from '../lib/api'
import { errorText } from '../App'
import { plural, relativeDay } from '../lib/format'
import { go } from '../lib/router'
import { BarRow, Empty, ErrorNote, Icon, Label, Radar, Section, Spinner } from '../ui/kit'

/**
 * Профиль сотрудника.
 *
 * Публично из этого экрана не уходит ничего: слабые места видит сам человек
 * и его наставник. Рейтинг показывает только суммирующиеся величины —
 * геймификация, которая унижает, отключается коллективом за месяц.
 */
export function Profile() {
  const [p, setProfile] = useState<ProfileResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.profile().then(setProfile).catch((e) => setError(errorText(e)))
  }, [])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!p) return <Spinner />

  const known = p.competencies.filter((c) => typeof p.competency[c.id] === 'number')
  const owned = p.achievements.filter((a) => a.owned)
  const locked = p.achievements.filter((a) => !a.owned)

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <Label>{p.user.depot} · {p.user.brigade || 'без бригады'} · таб. {p.user.tabNumber}</Label>
          <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-wide leading-none mt-1">
            {p.user.name}
          </h1>
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <Stat label="Рейсов" value={String(p.runs)} />
          <Stat label="Серия" value={plural(p.streak, 'день', 'дня', 'дней')} />
          <Stat label="Лучший" value={`${p.bestPct} %`} />
          <Stat label="Достижений" value={`${owned.length} / ${p.achievements.length}`} />
        </dl>
      </section>

      <Section eyebrow="Измерение" title="Профиль компетенций">
        <div className="grid gap-8 md:grid-cols-[minmax(0,22rem)_1fr] items-start">
          <Radar values={p.competency} axes={known} />
          <div className="flex flex-col gap-2.5">
            {known.length ? (
              known.map((c) => <BarRow key={c.id} title={c.title} value={p.competency[c.id] ?? 0} />)
            ) : (
              <Empty>Пройдите первый рейс — профиль появится сразу после разбора.</Empty>
            )}
            <p className="text-sm text-faint mt-2 max-w-[60ch]">
              Свежие рейсы весят больше старых: навык, подтверждённый вчера, значит больше,
              чем подтверждённый полгода назад. Компетенции, которых нет ни в одном
              пройденном сценарии, не показываются вовсе.
            </p>
          </div>
        </div>
      </Section>

      {p.next.length ? (
        <Section eyebrow="Дальше" title="Что система предлагает пройти">
          <div className="flex flex-col divide-y divide-hair border-t border-hair">
            {p.next.map((r) => (
              <button
                key={r.scenarioId}
                className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-left hover:bg-raised transition-colors px-2 -mx-2"
                onClick={() => go(`/play/${r.scenarioId}?mode=practice`)}
              >
                <span className="text-sm flex-1 min-w-[12rem]">{r.title}</span>
                <span className="text-sm text-muted">{r.reason}</span>
                <span className="label w-20 text-right">начать →</span>
              </button>
            ))}
          </div>
          <p className="text-sm text-faint">
            Порядок определяется двумя правилами: просроченное повторение важнее нового
            материала, а среди нового первым идёт то, что закрывает слабое место.
          </p>
        </Section>
      ) : null}

      <Section eyebrow="Достижения" title={`Получено ${owned.length} из ${p.achievements.length}`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...owned, ...locked].map((a) => (
            <div
              key={a.id}
              className={`card p-4 flex gap-3 items-start ${a.owned ? '' : 'opacity-55'}`}
            >
              <span className={a.owned ? 'text-accent' : 'text-faint'}>
                <Icon name={a.icon} className="w-6 h-6" />
              </span>
              <div className="flex flex-col gap-1 min-w-0">
                <div className="font-display uppercase tracking-wide text-sm leading-tight">
                  {a.title}
                </div>
                <div className="text-xs text-muted leading-snug">{a.condition}</div>
                {a.owned && a.at ? (
                  <div className="label mt-0.5">{relativeDay(a.at)}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <p className="text-sm text-faint">
          Условие каждого достижения видно до получения — тогда это цель, а не сюрприз.
          Ничего не выдаётся «за участие»: все условия проверяются по фактическим числам рейса.
        </p>
      </Section>

      {p.history.length ? (
        <Section eyebrow="История" title="Все рейсы">
          <div className="flex flex-col divide-y divide-hair border-t border-hair">
            {p.history.map((h) => (
              <button
                key={h.id}
                className="py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-left hover:bg-raised transition-colors px-2 -mx-2"
                onClick={() => go(`/debrief/${h.id}`)}
              >
                <span className="num text-xs text-faint w-20">{relativeDay(h.at)}</span>
                <span className="text-sm flex-1 min-w-[10rem]">{h.title}</span>
                <span className="label">{h.mode === 'exam' ? 'экзамен' : 'тренировка'}</span>
                {h.status === 'disputed' ? (
                  <span className="num text-xs text-danger w-14 text-right">спорный</span>
                ) : (
                  <span className={`num text-sm w-14 text-right ${h.scorePct >= 70 ? 'text-good' : 'text-warn'}`}>
                    {h.scorePct} %
                  </span>
                )}
              </button>
            ))}
          </div>
          {p.disputed ? (
            <p className="text-sm text-faint">
              Спорных прохождений: {p.disputed}. Такие рейсы не попали в рейтинг, потому что
              сервер не смог проиграть путь по своей копии графа — они сохранены и видны методисту.
            </p>
          ) : null}
        </Section>
      ) : null}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="label">{label}</dt>
      <dd className="num text-xl leading-tight">{value}</dd>
    </div>
  )
}
