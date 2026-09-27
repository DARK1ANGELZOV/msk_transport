import { useCallback, useEffect, useState } from 'react'

import { api, ApiError, type User } from './lib/api'
import { flush, queueSize } from './lib/offline'
import { go, useRoute } from './lib/router'
import { Spinner, ThemeToggle } from './ui/kit'

import { Login } from './screens/Login'
import { Home } from './screens/Home'
import { Profile } from './screens/Profile'
import { Leaderboard } from './screens/Leaderboard'
import { DebriefRouter } from './screens/DebriefRouter'
import { Play } from './game/Play'
import { Trip } from './game/Trip'
import { Methodist } from './methodist/Methodist'
import { Editor } from './methodist/Editor'
import { Manager } from './manager/Manager'

const NAV: Record<User['role'], { to: string; title: string }[]> = {
  conductor: [
    { to: '/', title: 'Рейсы' },
    { to: '/profile', title: 'Профиль' },
    { to: '/rating', title: 'Рейтинг' }
  ],
  methodist: [
    { to: '/methodist', title: 'Сценарии' },
    { to: '/', title: 'Проходить' },
    { to: '/rating', title: 'Рейтинг' }
  ],
  manager: [
    { to: '/manager', title: 'Готовность' },
    { to: '/methodist', title: 'Сценарии' },
    { to: '/rating', title: 'Рейтинг' }
  ]
}

export function App() {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const route = useRoute()

  const [queued, setQueued] = useState(0)

  useEffect(() => {
    api.me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true))
  }, [])

  /**
   * Рейсы, сыгранные без сети, уходят на сервер при первой возможности:
   * при входе в приложение и когда браузер сообщил о появлении связи.
   * Без этого очередь была бы просто местом, где результат тихо пропадает.
   */
  useEffect(() => {
    if (!user) return undefined
    const send = () => {
      setQueued(queueSize())
      flush().then((sent) => {
        if (sent) setQueued(queueSize())
      })
    }
    send()
    addEventListener('online', send)
    return () => removeEventListener('online', send)
  }, [user])

  const logout = useCallback(() => {
    api.logout().finally(() => {
      setUser(null)
      go('/')
    })
  }, [])

  if (!ready) {
    return (
      <div className="min-h-dvh grid place-items-center">
        <Spinner text="Соединение" />
      </div>
    )
  }

  if (!user) return <Login onLogin={setUser} />

  // Игровые экраны занимают всё окно: шапка отвлекает от таймера.
  if (route.name === 'play') {
    return <Play scenarioId={route.id} mode={route.mode} />
  }
  if (route.name === 'trip') {
    return <Trip tripId={route.id} />
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="border-b border-hair bg-surface sticky top-0 z-20">
        <div className="max-w-content mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <a
            href="#/"
            className="font-display uppercase tracking-[0.08em] text-lg leading-none"
            onClick={(e) => { e.preventDefault(); go('/') }}
          >
            Экипаж <span className="text-accent">400</span>
          </a>

          <nav className="flex items-center gap-1" aria-label="Разделы">
            {NAV[user.role].map((item) => {
              const active =
                (item.to === '/' && route.name === 'home') ||
                (item.to !== '/' && location.hash.startsWith(`#${item.to}`))
              return (
                <a
                  key={item.to}
                  href={`#${item.to}`}
                  onClick={(e) => { e.preventDefault(); go(item.to) }}
                  className={`font-mono text-xs uppercase tracking-[0.1em] px-3 py-2 border-b-2 transition-colors ${
                    active ? 'border-accent text-ink' : 'border-transparent text-faint hover:text-ink'
                  }`}
                >
                  {item.title}
                </a>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right leading-tight hidden sm:block">
              <div className="text-sm">{user.name}</div>
              <div className="label">{user.brigade || user.depot}</div>
            </div>
            <ThemeToggle />
            <button className="btn" onClick={logout}>Выйти</button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-content w-full mx-auto px-4 sm:px-6 py-8 flex flex-col gap-10">
        {queued ? (
          <p className="text-sm text-warn border-l-2 border-warn pl-3" role="status">
            Рейсов ждут отправки: {queued}. Они уйдут на сервер, как только появится связь.
          </p>
        ) : null}
        <Screen route={route} user={user} />
      </main>

      <footer className="border-t border-hair mt-6">
        <div className="max-w-content mx-auto px-4 sm:px-6 py-4 label">
          Тренажёр поездной бригады ВСМ · формулировки СОП в сценариях — допущение команды
        </div>
      </footer>
    </div>
  )
}

function Screen({ route, user }: { route: ReturnType<typeof useRoute>; user: User }) {
  switch (route.name) {
    case 'profile':
      return <Profile />
    case 'leaderboard':
      return <Leaderboard />
    case 'debrief':
      return <DebriefRouter runId={route.runId} />
    case 'methodist':
      return <Methodist />
    case 'editor':
      return <Editor id={route.id} />
    case 'manager':
      return user.role === 'manager' ? <Manager /> : <NoAccess />
    default:
      return <Home user={user} />
  }
}

function NoAccess() {
  return <p className="text-sm text-danger">Этот раздел доступен только руководителю депо.</p>
}

/** Разбор ошибки запроса в человеческую строку — используется всеми экранами. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'неизвестная ошибка'
}
