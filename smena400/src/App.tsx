import { useEffect, useState } from 'react'

import { api } from './lib/api'
import { Home } from './screens/Home'
import { Login } from './screens/Login'
import { Briefing } from './screens/Briefing'
import { Play } from './screens/Play'
import { Debrief } from './screens/Debrief'
import { Progress } from './screens/Progress'
import { go, parts, useRoute } from './lib/router'
import { Spinner } from './ui/kit'

/**
 * Оболочка приложения.
 *
 * Шапка намеренно тонкая: на экране ситуации у пользователя должен быть
 * один фокус, и им не может быть навигация. В прохождении шапка прячется
 * совсем — из ситуации выходят кнопкой внутри неё, осознанно.
 */
export function App() {
  const route = useRoute()
  const seg = parts(route)
  const inSituation = seg[0] === 'play'

  const [name, setName] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    api.me()
      .then((me) => setName(me.name))
      .catch(() => setName(null))
      .finally(() => setReady(true))
  }, [])

  if (!ready) {
    return <div className="min-h-dvh grid place-items-center"><Spinner text="Готовим смену" /></div>
  }
  if (!name) {
    return <Login onDone={setName} />
  }

  return (
    <div className="min-h-dvh flex flex-col">
      {!inSituation && (
        <header className="border-b border-hair">
          <div className="mx-auto w-full max-w-3xl px-4 py-3 flex items-center justify-between gap-4">
            <button
              className="flex items-baseline gap-2 text-left"
              onClick={() => go('/')}
              aria-label="К смене"
            >
              <span className="font-display font-bold tracking-tight text-lg">СМЕНА</span>
              <span className="font-display font-bold tracking-tight text-lg text-accent">400</span>
            </button>
            <nav className="flex items-center gap-1">
              <button
                className={`btn btn-ghost text-sm ${seg[0] === 'progress' ? 'text-ink' : ''}`}
                onClick={() => go('/progress')}
              >
                Профиль
              </button>
            </nav>
          </div>
        </header>
      )}

      <main className="flex-1 flex flex-col">
        {seg.length === 0 && <Home name={name} />}
        {seg[0] === 's' && seg[1] && <Briefing scenarioId={seg[1]} />}
        {seg[0] === 'play' && seg[1] && <Play sessionId={seg[1]} />}
        {seg[0] === 'debrief' && seg[1] && <Debrief sessionId={seg[1]} />}
        {seg[0] === 'progress' && <Progress name={name} />}
      </main>
    </div>
  )
}
