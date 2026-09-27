import { useEffect, useState } from 'react'

/**
 * Маршрутизация на хэше.
 *
 * Библиотека здесь была бы лишней: экранов пять, вложенности нет, история
 * браузера работает сама. Всё, что нужно, — знать текущий путь и уметь
 * его сменить.
 */
export const path = () => window.location.hash.replace(/^#/, '') || '/'

export const go = (to: string) => {
  window.location.hash = to
}

export function useRoute() {
  const [route, setRoute] = useState(path)
  useEffect(() => {
    const onChange = () => {
      setRoute(path())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

/** Разбор пути вида /play/s_abc на части. */
export const parts = (route: string) => route.split('/').filter(Boolean)
