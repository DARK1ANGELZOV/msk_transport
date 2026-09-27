/**
 * Очередь прохождений на случай отсутствия сети.
 *
 * Проводник учится в дороге и в депо, где связь есть не всегда, — и внутри
 * собственного поезда в тоннеле тоже. Терять из-за этого результат нельзя:
 * рейс складывается в очередь браузера и уходит на сервер, когда сеть
 * появится. Оценку всё равно посчитает сервер — на клиенте лежит только путь.
 */
import type { RunPath } from '../../engine/index.js'

const KEY = 'ekipazh-queue'

export interface QueuedRun {
  scenarioId: string
  scenarioVersion: number
  mode: string
  path: RunPath
  queuedAt: number
}

function read(): QueuedRun[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    // Приватное окно, очищенные данные, запрет на хранение — очередь просто пуста.
    return []
  }
}

function write(list: QueuedRun[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-40)))
  } catch {
    // Переполнение или запрет: молча теряем очередь, но не роняем интерфейс.
  }
}

export function enqueue(run: Omit<QueuedRun, 'queuedAt'>) {
  write([...read(), { ...run, queuedAt: Date.now() }])
}

export const queueSize = () => read().length

/**
 * Отправляет накопленное. Возвращает, сколько ушло.
 * Неудачные записи остаются в очереди: повторим при следующем запуске.
 */
export async function flush(): Promise<number> {
  const list = read()
  if (!list.length) return 0
  const left: QueuedRun[] = []
  let sent = 0
  for (const item of list) {
    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item)
      })
      if (res.ok) sent += 1
      else if (res.status >= 500 || res.status === 429) left.push(item)
      // 4xx кроме 429 — запись не примут никогда: держать её в очереди бессмысленно.
    } catch {
      left.push(item)
    }
  }
  write(left)
  return sent
}
