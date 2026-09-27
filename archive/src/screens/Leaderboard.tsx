import { useEffect, useState } from 'react'

import { api, type LeaderboardResponse } from '../lib/api'
import { errorText } from '../App'
import { plural } from '../lib/format'
import { Empty, ErrorNote, Label, Meter, Section, Spinner, toneFor } from '../ui/kit'

/**
 * Рейтинг.
 *
 * Командный зачёт стоит первым намеренно: проводники работают бригадами,
 * и в депо приживается командная таблица, а личная раскалывает коллектив.
 * Ни в одной из таблиц нет строк о том, что у человека провалено, —
 * только суммирующиеся величины. Сезон обнуляется каждый месяц,
 * иначе верхние строчки навсегда занимают те, кто пришёл первым.
 */
export function Leaderboard() {
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.leaderboard().then(setData).catch((e) => setError(errorText(e)))
  }, [])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!data) return <Spinner />

  const month = new Date(`${data.season}-01T00:00:00Z`)
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Label>Сезон · {month}</Label>
          <h1 className="font-display text-3xl uppercase tracking-wide leading-none mt-1">Рейтинг</h1>
        </div>
        <p className="text-sm text-muted max-w-md">
          Рейтинг обнуляется каждый месяц: у новичка должен быть шанс, у ветерана — повод вернуться.
        </p>
      </section>

      <Section eyebrow="Основной зачёт" title="Бригады">
        {data.brigades.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[36rem]">
              <thead>
                <tr className="border-b border-line">
                  <Th>#</Th>
                  <Th>Бригада</Th>
                  <Th>Депо</Th>
                  <Th right>Людей</Th>
                  <Th right>Рейсов</Th>
                  <Th>Средний результат</Th>
                </tr>
              </thead>
              <tbody>
                {data.brigades.map((b, i) => (
                  <tr key={`${b.depot}·${b.brigade}`} className="border-b border-hair">
                    <Td><span className="num text-faint">{i + 1}</span></Td>
                    <Td>{b.brigade}</Td>
                    <Td><span className="text-muted">{b.depot}</span></Td>
                    <Td right><span className="num">{b.people}</span></Td>
                    <Td right><span className="num">{b.runs}</span></Td>
                    <Td>
                      <div className="flex items-center gap-3 min-w-[10rem]">
                        <Meter value={b.avg_pct} tone={toneFor(b.avg_pct)} height="h-1.5" />
                        <span className="num text-xs w-9 text-right">{b.avg_pct} %</span>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>В этом сезоне ещё нет ни одного зачётного рейса.</Empty>
        )}
      </Section>

      <Section eyebrow="Личный зачёт" title="Проводники">
        {data.personal.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[38rem]">
              <thead>
                <tr className="border-b border-line">
                  <Th>#</Th>
                  <Th>Проводник</Th>
                  <Th>Бригада</Th>
                  <Th right>Рейсов</Th>
                  <Th right>Средний</Th>
                  <Th right>Лучший</Th>
                  <Th right>Ачивок</Th>
                </tr>
              </thead>
              <tbody>
                {data.personal.map((r, i) => (
                  <tr
                    key={r.id}
                    className={`border-b border-hair ${r.mine ? 'bg-accent-soft' : ''}`}
                  >
                    <Td><span className="num text-faint">{i + 1}</span></Td>
                    <Td>
                      {r.name}
                      {r.mine ? <span className="label ml-2">вы</span> : null}
                    </Td>
                    <Td><span className="text-muted">{r.brigade}</span></Td>
                    <Td right><span className="num">{r.runs}</span></Td>
                    <Td right><span className="num">{r.avg_pct} %</span></Td>
                    <Td right><span className="num">{r.best_pct} %</span></Td>
                    <Td right><span className="num">{r.achievements}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Пока пусто.</Empty>
        )}
        <p className="text-sm text-faint max-w-[65ch]">
          В таблице только то, что складывается: количество рейсов, средний и лучший результат,
          достижения. Слабые компетенции видны сотруднику в его профиле и наставнику —
          и больше никому. {plural(data.personal.length, 'участник', 'участника', 'участников')} в сезоне.
        </p>
      </Section>
    </>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`label font-medium py-2 px-2 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td className={`py-2.5 px-2 align-middle ${right ? 'text-right' : ''}`}>{children}</td>
}
