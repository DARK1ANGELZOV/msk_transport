/**
 * Маршрутизация по хешу.
 *
 * Библиотека роутинга здесь не нужна: экранов десяток, вложенности нет,
 * а хеш переживает раздачу статики любым сервером без настройки перезаписи
 * путей — это важно, потому что приложение разворачивают в чужом контуре
 * и иногда на подпути.
 */
import { useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'play'; id: string; mode: string }
  | { name: 'trip'; id: string }
  | { name: 'debrief'; runId: string }
  | { name: 'profile' }
  | { name: 'leaderboard' }
  | { name: 'methodist' }
  | { name: 'editor'; id: string }
  | { name: 'manager' }

export function parse(hash: string): Route {
  const [path, query] = hash.replace(/^#\/?/, '').split('?')
  const parts = path.split('/').filter(Boolean)
  const params = new URLSearchParams(query ?? '')
  switch (parts[0]) {
    case 'play':
      return { name: 'play', id: parts[1] ?? '', mode: params.get('mode') ?? 'practice' }
    case 'trip':
      return { name: 'trip', id: parts[1] ?? '' }
    case 'debrief':
      return { name: 'debrief', runId: parts[1] ?? '' }
    case 'profile':
      return { name: 'profile' }
    case 'rating':
      return { name: 'leaderboard' }
    case 'methodist':
      return parts[1] ? { name: 'editor', id: parts[1] } : { name: 'methodist' }
    case 'manager':
      return { name: 'manager' }
    default:
      return { name: 'home' }
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash))
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function go(to: string) {
  location.hash = to
  // Переход между экранами не должен оставлять прокрутку от предыдущего.
  scrollTo({ top: 0 })
}
