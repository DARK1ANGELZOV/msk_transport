import { type FormEvent, useEffect, useRef, useState } from 'react'

import { ENGINE } from '../../engine/index.js'
import { Label } from '../ui/kit'
import type { LegState } from './useLeg'

const KEY = 'ekipazh-speech'

/**
 * Режим «своими словами» запоминается между рейсами: это привычка,
 * а не настройка одного прохождения.
 */
export function useSpeechMode(): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(KEY, on ? '1' : '0')
    } catch {
      // Приватное окно: режим просто не запомнится.
    }
  }, [on])
  return [on, () => setOn((v) => !v)]
}

/**
 * Свободная реплика вместо кнопок.
 *
 * Четыре кнопки не тренируют речь: половина работы проводника в том, чтобы
 * найти нужные слова за восемь секунд. Здесь он их и произносит, а тренажёр
 * относит сказанное к одному из размеченных вариантов графа — своим
 * распознавателем, офлайн и детерминированно.
 *
 * Непонятая реплика не наказывает баллами: пассажир просто переспрашивает,
 * и это стоит секунд рейса. Ровно как в жизни.
 */
export function Speech({ leg, onGiveUp }: { leg: LegState; onGiveUp: () => void }) {
  const [text, setText] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)

  // Новый узел — чистое поле и фокус в нём: под таймером не до мыши.
  useEffect(() => {
    setText('')
    field.current?.focus()
  }, [leg.cursor])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    const verdict = leg.say(text)
    if (!verdict.choice) setText('')
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Label>Скажите своими словами</Label>

      <textarea
        ref={field}
        className="input h-20 text-[0.95rem] leading-snug"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit(e)
          }
        }}
        placeholder="Например: доложу начальнику поезда и попрошу медиков на станцию"
        aria-label="Что вы говорите или делаете"
        spellCheck={false}
      />

      {leg.misheard ? (
        <div className="border-l-2 border-warn pl-3 flex flex-col gap-1" role="status" aria-live="polite">
          <Label>Пассажир переспрашивает · +{ENGINE.RETRY_SEC} с рейса</Label>
          <p className="text-sm">{leg.misheard.reason}</p>
          <p className="text-sm text-faint">Вы сказали: «{leg.misheard.said}»</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={!text.trim()}>
          Сказать
        </button>
        <button type="button" className="btn" onClick={onGiveUp}>
          Показать варианты
        </button>
        <span className="label">
          Enter — сказать
          {leg.retriesHere ? ` · переспросили ${leg.retriesHere}` : ''}
        </span>
      </div>
    </form>
  )
}
