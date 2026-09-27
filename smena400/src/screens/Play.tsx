import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import {
  api, ApiError, type ActionView, type ResultView, type Scales, type Screen
} from '../lib/api'
import { go } from '../lib/router'
import { sign } from '../lib/format'
import { ErrorNote, Label, ScaleRow, Spinner, Timer, Verdict } from '../ui/kit'

/**
 * Экран ситуации — главный экран продукта.
 *
 * Композиция подчинена одному правилу: под таймером должен быть **один**
 * фокус. Поэтому сверху идёт узкая полоса состояния (где вы и что со шкалами),
 * затем то, что произошло от прошлого решения, затем сама ситуация, и только
 * потом — действия. Ничего, что можно прочитать потом, наверх не выносится.
 *
 * Клиент здесь принципиально глуп: он не знает ни эффектов действий,
 * ни переходов, ни того, сколько шагов осталось. Он рисует то, что прислал
 * сервер, и отправляет намерение обратно.
 */
export function Play({ sessionId }: { sessionId: string }) {
  const [screen, setScreen] = useState<Screen | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<{ said: string; text: string } | null>(null)
  const [mode, setMode] = useState<'actions' | 'speech'>('actions')

  useEffect(() => {
    api.screen(sessionId)
      .then((r) => setScreen(r.screen))
      .catch((e) => setError(e.message))
  }, [sessionId])

  /** Любой ход идёт через сервер: клиент не меняет состояние сам. */
  const send = useCallback(
    async (fn: () => Promise<{ screen: Screen }>) => {
      if (busy) return
      setBusy(true)
      setError('')
      try {
        const r = await fn()
        setScreen(r.screen)
        setReply(null)
      } catch (e) {
        const err = e as ApiError
        // Отказ движка — часть игры, а не сбой: показываем причину и остаёмся.
        setError(err.message)
        if (err.code === 'not-expired' || err.code === 'not-allowed') {
          api.screen(sessionId).then((r) => setScreen(r.screen)).catch(() => {})
        }
      } finally {
        setBusy(false)
      }
    },
    [busy, sessionId]
  )

  const act = (actionId: string) => send(() => api.act(sessionId, { actionId }))
  const order = (ids: string[]) => send(() => api.act(sessionId, { order: ids }))

  /**
   * Время вышло.
   *
   * Клиент только сообщает об этом. Решение принимает сервер по своим часам:
   * если он считает, что время ещё есть, ход не выполнится.
   */
  const expire = useCallback(() => {
    send(() => api.act(sessionId, { timeout: true })).catch(() => {})
  }, [send, sessionId])

  const say = async (text: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const r = await api.say(sessionId, text)
      if (r.understood === false) {
        // Пассажир переспрашивает — это реплика собеседника, а не ошибка ввода.
        setReply({ said: r.said ?? text, text: r.reply ?? '' })
      } else if (r.screen) {
        setScreen(r.screen)
        setReply(null)
      }
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  const quit = () => {
    api.quit(sessionId).finally(() => go('/'))
  }

  if (error && !screen) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 flex flex-col gap-4 items-start">
        <ErrorNote>{error}</ErrorNote>
        <button className="btn" onClick={() => go('/')}>К списку ситуаций</button>
      </div>
    )
  }
  if (!screen || !screen.state) {
    return <div className="mx-auto w-full max-w-2xl px-4 py-10"><Spinner text="Входим в ситуацию" /></div>
  }

  const st = screen.state
  const finished = screen.status !== 'active'
  const deltas = sumDeltas(screen.lastResult)

  return (
    <div className="flex-1 flex flex-col">
      {/* Полоса состояния: где мы и что со шкалами. Ничего лишнего. */}
      <div className="sticky top-0 z-10 bg-ground border-b border-hair">
        <div className="mx-auto w-full max-w-2xl px-4 py-2.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="label truncate">{st.zone ?? screen.scenario.title}</span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="label">попытка {screen.attempt}</span>
              {!finished && (
                <button className="btn btn-ghost text-xs px-2 py-1 min-h-0" onClick={quit}>
                  Выйти
                </button>
              )}
            </div>
          </div>
          <ScaleRow scales={screen.scales} deltas={deltas} compact />
          {st.timer && !finished && (
            <Timer
              key={`${st.id}-${screen.step}`}
              totalSec={st.timer.totalSec}
              remainingMs={st.timer.remainingMs}
              onExpire={expire}
            />
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 py-5 flex flex-col gap-5 flex-1">
        {screen.lastResult && <Happened result={screen.lastResult} />}

        {st.info && !finished && (
          <div className="border-l-2 border-accent pl-3 py-0.5">
            <Label className="text-accent">Новая информация</Label>
            <p className="text-sm mt-1 max-w-[62ch]">{st.info}</p>
          </div>
        )}

        <section className="flex flex-col gap-2 animate-rise" key={st.id}>
          {st.speaker && <Label>{st.speaker}</Label>}
          <p className="text-lg leading-snug max-w-[56ch]">{st.text}</p>
        </section>

        {finished ? (
          <Finish screen={screen} sessionId={sessionId} />
        ) : st.kind === 'sequence' && screen.sequence ? (
          <Sequence items={screen.sequence.items} busy={busy} onSubmit={order} />
        ) : (
          <>
            {mode === 'speech' && st.freeText ? (
              <Speech
                busy={busy}
                reply={reply}
                onSay={say}
                onShowActions={() => setMode('actions')}
              />
            ) : (
              <Actions
                actions={screen.actions}
                busy={busy}
                onPick={act}
                onSpeak={st.freeText ? () => setMode('speech') : null}
              />
            )}
          </>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </div>
  )
}

/** Сумма изменений шкал за прошлый ход — вместе с созревшими последствиями. */
function sumDeltas(result: ResultView | null): Partial<Scales> {
  if (!result) return {}
  const out: Partial<Scales> = { ...result.effects }
  for (const e of result.events) {
    for (const k of ['loyalty', 'safety'] as const) {
      if (e.effects?.[k]) out[k] = (out[k] ?? 0) + (e.effects[k] as number)
    }
  }
  return out
}

/**
 * Что произошло от прошлого решения.
 *
 * Отложенное последствие показывается отдельно и помечается: человек должен
 * заметить, что это пришло не из текущего шага. Откуда именно — он узнает
 * в разборе, и это сознательно: связь, которую пришлось искать, запоминается
 * лучше, чем подписанная.
 */
function Happened({ result }: { result: ResultView }) {
  const has = result.consequence || result.events.length
  if (!has) return null

  return (
    <div className="flex flex-col gap-3">
      {result.consequence && (
        <div className={`border-l-2 pl-3 py-0.5 ${result.timedOut ? 'border-danger' : 'border-hair'}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <Label className={result.timedOut ? 'text-danger' : ''}>
              {result.timedOut ? 'Вы не успели' : 'Что произошло'}
            </Label>
            <Deltas effects={result.effects} />
          </div>
          <p className="text-sm text-muted mt-1 max-w-[62ch]">{result.consequence}</p>
        </div>
      )}

      {result.events.map((e, i) => (
        <div key={i} className="border-l-2 border-warn pl-3 py-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="text-warn">
              {e.delayed ? 'Последствие прежнего решения' : 'Обстановка изменилась'}
            </Label>
            <Deltas effects={e.effects} />
          </div>
          <p className="text-sm text-muted mt-1 max-w-[62ch]">{e.note}</p>
        </div>
      ))}
    </div>
  )
}

function Deltas({ effects }: { effects: Partial<Scales> }) {
  const items = (['loyalty', 'safety'] as const).filter((k) => effects[k])
  if (!items.length) return null
  return (
    <span className="flex gap-2">
      {items.map((k) => (
        <span
          key={k}
          className={`num text-xs ${(effects[k] as number) > 0 ? 'text-good' : 'text-danger'}`}
        >
          {k === 'loyalty' ? 'лояльность' : 'безопасность'} {sign(effects[k] as number)}
        </span>
      ))}
    </span>
  )
}

function Actions({
  actions, busy, onPick, onSpeak
}: {
  actions: ActionView[]
  busy: boolean
  onPick: (id: string) => void
  onSpeak: (() => void) | null
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>Что вы делаете</Label>
      {actions.map((a, i) => (
        <button
          key={a.id}
          className="action"
          disabled={busy}
          onClick={() => onPick(a.id)}
        >
          <span className="num text-xs text-faint pt-0.5 shrink-0">{i + 1}</span>
          <span className="flex-1 min-w-0">
            <span className="block text-[0.95rem] leading-snug">{a.label}</span>
            {a.kind === 'escalate' && (
              <span className="label mt-1 block text-accent">эскалация</span>
            )}
            {a.note && <span className="label mt-1 block">{a.note}</span>}
          </span>
        </button>
      ))}
      {onSpeak && (
        <button className="btn btn-ghost self-start text-sm mt-1" onClick={onSpeak} disabled={busy}>
          Ответить своими словами
        </button>
      )}
    </div>
  )
}

/**
 * Свободная реплика.
 *
 * Человек формулирует так, как сказал бы вслух, — ему не нужно знать
 * ни идентификаторов, ни ключевых слов. Если сказанное не удалось
 * соотнести ни с одним доступным действием, пассажир переспрашивает.
 * Это поведение собеседника, а не сообщение об ошибке ввода.
 */
function Speech({
  busy, reply, onSay, onShowActions
}: {
  busy: boolean
  reply: { said: string; text: string } | null
  onSay: (text: string) => void
  onShowActions: () => void
}) {
  const [text, setText] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    field.current?.focus()
  }, [])

  useEffect(() => {
    if (reply) setText('')
  }, [reply])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = text.trim()
    if (v) onSay(v)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Label>Скажите своими словами</Label>
      <textarea
        ref={field}
        className="input h-20 leading-snug"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) submit(e)
        }}
        placeholder="Например: доложу начальнику поезда и попрошу медиков на станцию"
        aria-label="Что вы говорите или делаете"
        spellCheck={false}
        disabled={busy}
      />

      {reply && (
        <div className="border-l-2 border-warn pl-3 py-0.5" role="status">
          <Label className="text-warn">Вас переспрашивают</Label>
          <p className="text-sm mt-1">{reply.text}</p>
          <p className="text-sm text-faint mt-1">Вы сказали: «{reply.said}»</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={busy || !text.trim()}>Сказать</button>
        <button type="button" className="btn" onClick={onShowActions} disabled={busy}>
          Показать варианты
        </button>
        <span className="label">Enter — сказать</span>
      </div>
    </form>
  )
}

/**
 * Последовательность действий.
 *
 * Порядок задаётся нажатиями: первый выбранный пункт — первое действие.
 * Важнее всего именно он, потому что приоритизация — это и есть выбор
 * того, что делаешь первым.
 */
function Sequence({
  items, busy, onSubmit
}: {
  items: { id: string; label: string }[]
  busy: boolean
  onSubmit: (ids: string[]) => void
}) {
  const [picked, setPicked] = useState<string[]>([])

  const toggle = (id: string) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Расставьте по порядку · нажимайте в той очерёдности, в которой будете делать</Label>
      {items.map((it) => {
        const at = picked.indexOf(it.id)
        return (
          <button
            key={it.id}
            className={`action ${at >= 0 ? 'border-accent' : ''}`}
            onClick={() => toggle(it.id)}
            disabled={busy}
            aria-pressed={at >= 0}
          >
            <span
              className={`num text-xs pt-0.5 shrink-0 w-4 ${at >= 0 ? 'text-accent' : 'text-faint'}`}
            >
              {at >= 0 ? at + 1 : '·'}
            </span>
            <span className="flex-1 text-[0.95rem] leading-snug">{it.label}</span>
          </button>
        )
      })}
      <div className="flex flex-wrap gap-3 mt-1">
        <button
          className="btn btn-primary"
          disabled={busy || picked.length !== items.length}
          onClick={() => onSubmit(picked)}
        >
          Выполнить в этом порядке
        </button>
        {picked.length > 0 && (
          <button className="btn" onClick={() => setPicked([])} disabled={busy}>
            Сбросить
          </button>
        )}
      </div>
    </div>
  )
}

/** Финал: итог ситуации и переход к разбору. */
function Finish({ screen, sessionId }: { screen: Screen; sessionId: string }) {
  const st = screen.state!
  return (
    <div className="flex flex-col gap-5 animate-rise">
      {st.verdict && <Verdict verdict={st.verdict} />}
      {st.summary && (
        <p className="text-sm text-muted max-w-[62ch] border-l-2 border-hair pl-3">
          {st.summary}
        </p>
      )}
      <ScaleRow scales={screen.scales} />
      <div className="flex flex-wrap gap-3">
        <button className="btn btn-primary" onClick={() => go(`/debrief/${sessionId}`)}>
          Разбор
        </button>
        <button className="btn" onClick={() => go('/')}>К списку ситуаций</button>
      </div>
    </div>
  )
}
