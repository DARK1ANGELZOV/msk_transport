import { useState, type FormEvent } from 'react'

import { api } from '../lib/api'
import { Card, ErrorNote, Label } from '../ui/kit'

/**
 * Вход.
 *
 * Пароля нет и не будет: тренажёр решает задачу обучения, а не учёта
 * персонала, и сложная авторизация тут только мешала бы. Имя нужно ровно
 * затем, чтобы смена была чьей-то: человек возвращается в свою историю
 * прохождений, а не в общую.
 */
export function Login({ onDone }: { onDone: (name: string) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = name.trim()
    if (!v) return
    setBusy(true)
    api.setName(v)
      .then((me) => onDone(me.name ?? v))
      .catch((err) => {
        setError(err.message)
        setBusy(false)
      })
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <span className="font-display font-bold tracking-tight text-3xl">СМЕНА</span>
            <span className="font-display font-bold tracking-tight text-3xl text-accent">400</span>
          </div>
          <h1 className="text-xl leading-snug">
            Не угадай правильный ответ.<br />Прими правильное решение.
          </h1>
          <p className="text-sm text-muted max-w-[46ch]">
            Тренажёр принятия решений для проводников высокоскоростных поездов.
            Рабочие ситуации из банка «Ситуации на борту», ограниченное время
            и последствия, которые приходят не всегда сразу.
          </p>
        </header>

        <Card className="p-5">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <Label>Как к вам обращаться</Label>
              <input
                className="input mt-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Имя или табельный номер"
                autoFocus
                maxLength={60}
                aria-label="Имя"
              />
            </div>
            <p className="text-xs text-faint">
              Пароль не нужен. Имя хранится только на этом стенде и нужно затем,
              чтобы история прохождений была вашей.
            </p>
            {error && <ErrorNote>{error}</ErrorNote>}
            <button className="btn btn-primary" disabled={busy || !name.trim()}>
              {busy ? 'Входим…' : 'Заступить на смену'}
            </button>
          </form>
        </Card>
      </div>
    </div>
  )
}
