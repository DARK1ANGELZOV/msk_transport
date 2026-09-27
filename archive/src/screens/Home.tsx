import { useEffect, useState } from 'react'

import { api, type ProfileResponse, type ScenarioCard, type TripCard, type User } from '../lib/api'
import { errorText } from '../App'
import { DIFFICULTY, mmss, plural } from '../lib/format'
import { go } from '../lib/router'
import { BarRow, Empty, ErrorNote, Label, Section, Spinner } from '../ui/kit'

const KIND: Record<string, { title: string; tone: string }> = {
  repeat: { title: 'Повторение', tone: 'text-warn' },
  weakness: { title: 'Слабое место', tone: 'text-danger' },
  'weakness-again': { title: 'Слабое место', tone: 'text-danger' },
  new: { title: 'Новый', tone: 'text-faint' }
}

export function Home({ user }: { user: User }) {
  const [scenarios, setScenarios] = useState<ScenarioCard[] | null>(null)
  const [profile, setProfile] = useState<ProfileResponse | null>(null)
  const [trips, setTrips] = useState<TripCard[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api.scenarios(), api.profile(), api.trips()])
      .then(([s, p, t]) => {
        setScenarios(s.scenarios)
        setProfile(p)
        setTrips(t.trips.filter((x) => x.ready))
      })
      .catch((e) => setError(errorText(e)))
  }, [])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!scenarios || !profile) return <Spinner />

  const next = profile.next[0]
  const nextCard = scenarios.find((s) => s.id === next?.scenarioId)
  const weakest = profile.competencies
    .filter((c) => typeof profile.competency[c.id] === 'number')
    .sort((a, b) => (profile.competency[a.id] ?? 0) - (profile.competency[b.id] ?? 0))
    .slice(0, 3)

  return (
    <>
      <section className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Label>Смена</Label>
            <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-wide leading-none mt-1">
              {user.name.split(' ')[0]}, добро пожаловать на маршрут
            </h1>
          </div>
          <dl className="flex gap-6">
            <Stat label="Рейсов" value={String(profile.runs)} />
            <Stat label="Серия" value={plural(profile.streak, 'день', 'дня', 'дней')} />
            <Stat label="Лучший" value={`${profile.bestPct} %`} />
          </dl>
        </div>
      </section>

      {trips.length ? (
        <Section eyebrow="Основной режим" title="Смена целиком">
          <div className="grid gap-3 sm:grid-cols-2">
            {trips.map((t) => (
              <article
                key={t.id}
                className="card p-5 flex flex-col gap-4 border-l-2 border-l-accent sm:col-span-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-xl">
                    <h3 className="font-display text-2xl uppercase tracking-wide leading-none">
                      {t.title}
                    </h3>
                    <p className="text-sm text-muted mt-2">{t.summary}</p>
                  </div>
                  <button className="btn btn-primary" onClick={() => go(`/trip/${t.id}`)}>
                    Заступить на смену
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 label">
                  <span className="text-ink">{t.legs} инцидента</span>
                  <span>{t.fromKm}–{t.toKm} км</span>
                  <span>{mmss(t.estimatedSec)} чистого времени</span>
                  <span>{t.serviceTitle}</span>
                </div>
                <p className="text-sm text-faint max-w-[65ch]">
                  Между инцидентами поезд едет по-настоящему: вагон частично отходит,
                  стресс частично спадает, а усталость копится. Последствия ранних
                  решений возвращаются к вам позже по маршруту.
                </p>
              </article>
            ))}
          </div>
        </Section>
      ) : null}

      {nextCard && next ? (
        <Section eyebrow="Персонально" title="Что пройти следующим">
          <div className="card p-5 sm:p-6 flex flex-col gap-4 border-l-2 border-l-accent">
            <span className={`font-mono text-[0.68rem] uppercase tracking-[0.14em] ${KIND[next.kind]?.tone}`}>
              {KIND[next.kind]?.title}
            </span>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-xl">
                <h2 className="font-display text-2xl uppercase tracking-wide leading-none">
                  {nextCard.title}
                </h2>
                <p className="text-sm text-muted mt-2">{nextCard.summary}</p>
                <p className="text-sm text-accent mt-2">{next.reason}</p>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-primary" onClick={() => go(`/play/${nextCard.id}?mode=practice`)}>
                  Начать
                </button>
                <button className="btn" onClick={() => go(`/play/${nextCard.id}?mode=exam`)}>
                  Экзамен
                </button>
              </div>
            </div>
          </div>
        </Section>
      ) : null}

      <Section eyebrow="Профиль" title="Где вы слабее всего">
        {weakest.length ? (
          <div className="flex flex-col gap-2.5">
            {weakest.map((c) => (
              <BarRow key={c.id} title={c.title} value={profile.competency[c.id] ?? 0} />
            ))}
            <p className="text-sm text-faint mt-1">
              Профиль считается по всем рейсам, свежие весят больше. Подробности — в разделе «Профиль».
            </p>
          </div>
        ) : (
          <Empty>Пройдите первый рейс — после него появится профиль компетенций.</Empty>
        )}
      </Section>

      <Section eyebrow="Библиотека" title={`Отдельные инциденты · ${scenarios.length}`}>
        <div className="grid gap-3 sm:grid-cols-2">
          {scenarios.map((s) => {
            const done = profile.history.find((h) => h.scenarioId === s.id)
            return (
              <article key={s.id} className="card p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display text-lg uppercase tracking-wide leading-tight">
                    {s.title}
                  </h3>
                  <span className="num text-xs text-faint whitespace-nowrap">
                    {mmss(s.estimatedSec ?? 180)}
                  </span>
                </div>
                <p className="text-sm text-muted flex-1">{s.summary}</p>

                {/*
                  Обстановка рейса вместо абстрактной «сложности»: километр,
                  скорость и до какой станции. Это то, что проводник узнаёт
                  первым, заступая на смену.
                */}
                {s.setting ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 label">
                    <span className="text-ink">{s.setting.km.toFixed(0)} км</span>
                    <span>{s.setting.speedKmh} км/ч</span>
                    {s.setting.stopName ? (
                      <span>
                        {s.setting.stopName} через {mmss(s.setting.toStopSec ?? 0)}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 label">
                  <span>{DIFFICULTY[s.difficulty] ?? 'средний'}</span>
                  {done ? (
                    <span className={done.scorePct >= 70 ? 'text-good' : 'text-warn'}>
                      было {done.scorePct} %
                    </span>
                  ) : null}
                </div>

                <div className="flex gap-2 pt-1">
                  <button className="btn" onClick={() => go(`/play/${s.id}?mode=practice`)}>
                    Тренировка
                  </button>
                  <button className="btn" onClick={() => go(`/play/${s.id}?mode=exam`)}>
                    Экзамен
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </Section>

      {profile.history.length ? (
        <Section eyebrow="История" title="Последние рейсы">
          <div className="flex flex-col divide-y divide-hair border-t border-hair">
            {profile.history.slice(0, 8).map((h) => (
              <button
                key={h.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-left hover:bg-raised transition-colors px-2 -mx-2"
                onClick={() => go(`/debrief/${h.id}`)}
              >
                <span className="text-sm flex-1 min-w-[12rem]">{h.title}</span>
                <span className="label">{h.mode === 'exam' ? 'экзамен' : 'тренировка'}</span>
                {h.status === 'disputed' ? (
                  <span className="num text-xs text-danger">спорный</span>
                ) : (
                  <span className={`num text-sm ${h.scorePct >= 70 ? 'text-good' : 'text-warn'}`}>
                    {h.scorePct} %
                  </span>
                )}
                <span className="label w-20 text-right">разбор →</span>
              </button>
            ))}
          </div>
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
