import { useState, type FormEvent } from 'react'

import { api } from '../lib/api'
import { Card, ErrorNote, Label } from '../ui/kit'
import {
  IconAlert, IconChart, IconReplay, IconShield, IconTarget, IconTrain, Logo
} from '../ui/brand'

/**
 * Вход.
 *
 * Пароля нет и не будет: тренажёр решает задачу обучения, а не учёта
 * персонала, и сложная авторизация тут только мешала бы. Имя нужно ровно
 * затем, чтобы смена была чьей-то — человек возвращается в свою историю
 * прохождений, а не в общую.
 *
 * Рядом с формой стоит обещание продукта: шесть строк о том, что здесь
 * происходит. Это первое, что видит человек, и оно должно отличать
 * тренажёр от очередного теста.
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
    <div className="min-h-dvh flex flex-col">
      {/* Шапка: логотип и обещание продукта */}
      <div className="border-b border-hair">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <Logo size="lg" />
              <span className="label">Интерактивный тренажёр для проводников ВСМ</span>
            </div>
            <p className="font-display font-semibold text-sm sm:text-base leading-tight text-right text-muted max-w-[22ch]">
              Высокая скорость<br />требует высокого профессионализма
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Feature icon={<IconAlert size={14} />}>Реальные рабочие ситуации</Feature>
            <Feature icon={<IconTarget size={14} />}>Ваши решения влияют на результат</Feature>
            <Feature icon={<IconChart size={14} />}>Независимые показатели состояния</Feature>
            <Feature icon={<IconShield size={14} />}>Нормативная опора у каждой ситуации</Feature>
            <Feature icon={<IconReplay size={14} />}>Возврат к развилке</Feature>
          </div>
        </div>
      </div>

      <div className="flex-1 grid place-items-center px-4 py-10">
        <Card className="w-full max-w-md p-6 flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <span className="text-accent"><IconTrain size={22} /></span>
            <div>
              <h1 className="font-display font-bold text-xl leading-none">
                Профессионализм начинается с решений
              </h1>
              <p className="text-sm text-muted mt-1.5">
                Не угадай правильный ответ. Прими правильное решение.
              </p>
            </div>
          </div>

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
            {error && <ErrorNote>{error}</ErrorNote>}
            <button className="btn btn-primary w-full" disabled={busy || !name.trim()}>
              {busy ? 'Входим…' : 'Заступить на смену'}
            </button>
            <p className="text-xs text-faint leading-relaxed">
              Пароль не нужен. Имя хранится только на этом стенде и нужно затем,
              чтобы история прохождений была вашей.
            </p>
          </form>
        </Card>
      </div>
    </div>
  )
}

function Feature({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="chip">
      <span className="text-accent shrink-0">{icon}</span>
      {children}
    </span>
  )
}
