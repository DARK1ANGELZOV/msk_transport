import { type FormEvent, useEffect, useState } from 'react'

import { api, type User } from '../lib/api'
import { errorText } from '../App'
import { ErrorNote, ThemeToggle } from '../ui/kit'

/**
 * Вход.
 *
 * Демонстрационные учётки показаны прямо на экране — намеренно: жюри должно
 * кликать само, а не спрашивать пароль. В установке у заказчика этот блок
 * не появится: он показывается, только когда сервер сообщил, что база
 * заполнена демонстрационными данными.
 *
 * Пароль ниже — не секрет: им `npm run seed` заводит демонстрационные учётки,
 * и он напечатан в README и в выводе самой команды. Подставляется только
 * тогда, когда сервер подтвердил, что база заполнена именно им; если установка
 * задала свой SEED_PASSWORD, поле остаётся пустым.
 */
const DEFAULT_DEMO_PASSWORD = 'krechet-2028'

const DEMO = [
  { login: 'demo', role: 'Проводник', hint: 'проходит рейсы, видит профиль и рейтинг' },
  { login: 'method', role: 'Методист', hint: 'редактирует сценарии, видит статистику по узлам' },
  { login: 'boss', role: 'Руководитель', hint: 'видит готовность бригад к допуску' }
]

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [seeded, setSeeded] = useState(false)
  const [defaultPassword, setDefaultPassword] = useState(false)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((r) => {
        setSeeded(Boolean(r?.seeded))
        setDefaultPassword(Boolean(r?.demoDefaultPassword))
      })
      .catch(() => setSeeded(false))
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api.login(login.trim(), password)
      onLogin(r.user)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh grid lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden lg:flex flex-col justify-between p-10 bg-surface border-r border-hair">
        <div className="font-display uppercase tracking-[0.08em] text-lg">
          Экипаж <span className="text-accent">400</span>
        </div>

        <div className="flex flex-col gap-6 max-w-md">
          <div className="font-display text-[7rem] leading-[0.8] text-accent num">111</div>
          <p className="label -mt-4">метров в секунду</p>
          <p className="text-lg leading-snug">
            На четырёхстах километрах в час поезд проходит сто одиннадцать метров в секунду.
            Рейс Москва — Петербург — два часа пятнадцать минут. У проводника ВСМ нет времени
            решить потом.
          </p>
          <p className="text-sm text-muted border-l-2 border-accent pl-4">
            Тренажёр переносит авиационную методику подготовки экипажей на поездную бригаду:
            рейс проходится целиком, ошибка не прерывает тренировку, а учит разбор после прибытия.
          </p>
        </div>

        <p className="label">
          Тренировочная среда. Реальные регламенты подставляются при внедрении.
        </p>
      </section>

      <section className="flex flex-col justify-center p-6 sm:p-10 gap-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl uppercase tracking-wide leading-none">Вход</h1>
            <p className="text-sm text-muted mt-2">Табельный логин и пароль, выданные в депо.</p>
          </div>
          <ThemeToggle />
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4 max-w-sm w-full">
          <label className="flex flex-col gap-1.5">
            <span className="label">Логин</span>
            <input
              className="bg-surface border border-line px-3 py-2 text-ink"
              value={login}
              autoComplete="username"
              onChange={(e) => setLogin(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Пароль</span>
            <input
              className="bg-surface border border-line px-3 py-2 text-ink"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <button className="btn btn-primary self-start" disabled={busy}>
            {busy ? 'Проверяем' : 'Войти'}
          </button>
        </form>

        {seeded ? (
          <div className="flex flex-col gap-3 max-w-sm">
            <div className="label">Демонстрационные учётки</div>
            <div className="flex flex-col divide-y divide-hair border border-hair">
              {DEMO.map((d) => (
                <button
                  key={d.login}
                  type="button"
                  className="text-left px-3 py-2.5 hover:bg-raised transition-colors"
                  onClick={() => {
                    setLogin(d.login)
                    if (defaultPassword) setPassword(DEFAULT_DEMO_PASSWORD)
                  }}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm">{d.role}</span>
                    <span className="num text-xs text-faint">{d.login}</span>
                  </div>
                  <div className="text-xs text-faint">{d.hint}</div>
                </button>
              ))}
            </div>
            <p className="text-xs text-faint">
              {defaultPassword
                ? 'Нажатие подставляет логин и демонстрационный пароль. '
                : 'Нажатие подставляет логин; пароль задан переменной SEED_PASSWORD. '}
              У заказчика учётные записи заводятся заново — пароля по умолчанию в системе нет.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  )
}
