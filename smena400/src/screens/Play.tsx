import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import {
  api, ApiError, type ActionView, type ResultView, type ScaleMeta, type Scales, type Screen
} from '../lib/api'
import { go } from '../lib/router'
import { sign } from '../lib/format'
import { Card, ErrorNote, Label, Panel, ScaleRow, Spinner, Timer, Verdict } from '../ui/kit'
import { ScaleIcon, IconAlert, IconCheck, IconShield, IconRadio } from '../ui/brand'

/**
 * Экран ситуации — главный экран продукта.
 *
 * Композиция подчинена одному правилу: под таймером должен быть **один**
 * фокус. Сверху узкая полоса состояния, затем реплика собеседника, затем
 * действия, внизу показатели. Ничего, что можно прочитать потом, наверх
 * не выносится.
 *
 * Отдельная фаза — последствие. После выбора игрок не переносится сразу
 * в следующее состояние: сначала показывается, что именно изменилось
 * и к чему привело решение. Без этой паузы причинно-следственная связь
 * теряется — человек успевает прочитать только новую реплику.
 *
 * Клиент здесь принципиально глуп: он не знает ни эффектов действий,
 * ни переходов, ни того, сколько шагов осталось. Он рисует то, что прислал
 * сервер, и отправляет намерение обратно.
 */
export function Play({ sessionId }: { sessionId: string }) {
  const [screen, setScreen] = useState<Screen | null>(null)
  const [phase, setPhase] = useState<'situation' | 'consequence'>('situation')
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
        if (r.screen.lastResult) setPhase('consequence')
      } catch (e) {
        const err = e as ApiError
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
   * Время вышло. Клиент только сообщает об этом: решение принимает сервер
   * по своим часам, и если он считает, что время ещё есть, ход не выполнится.
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
        setReply({ said: r.said ?? text, text: r.reply ?? '' })
      } else if (r.screen) {
        setScreen(r.screen)
        setReply(null)
        if (r.screen.lastResult) setPhase('consequence')
      }
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  const quit = () => { api.quit(sessionId).finally(() => go('/')) }

  if (error && !screen) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 flex flex-col gap-4 items-start">
        <ErrorNote>{error}</ErrorNote>
        <button className="btn" onClick={() => go('/')}>К смене</button>
      </div>
    )
  }
  if (!screen || !screen.state) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <Spinner text="Входим в ситуацию" />
      </div>
    )
  }

  const st = screen.state
  const finished = screen.status !== 'active'
  const showConsequence = phase === 'consequence' && screen.lastResult

  return (
    <div className="flex-1 flex flex-col">
      {/* ------------------------------------------- шапка ситуации */}
      <div className="sticky top-0 z-10 bg-ground/95 backdrop-blur border-b border-hair">
        <div className="mx-auto w-full max-w-3xl px-4 py-3 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display font-semibold leading-none truncate">
                {screen.scenario.title}
              </h2>
              <span className="label">
                {st.zone ?? screen.scenario.context.car}
                {' · '}шаг {Math.max(1, screen.step + (showConsequence ? 0 : 1))}
                {' · '}попытка {screen.attempt}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!finished && (
                <button className="btn btn-ghost text-xs px-2.5 py-1.5 min-h-0" onClick={quit}>
                  Выйти
                </button>
              )}
            </div>
          </div>

          {st.timer && !finished && !showConsequence && (
            <Timer
              key={`${st.id}-${screen.step}`}
              totalSec={st.timer.totalSec}
              remainingMs={st.timer.remainingMs}
              onExpire={expire}
            />
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-4 py-5 flex flex-col gap-5 flex-1">
        {showConsequence ? (
          <Consequence
            result={screen.lastResult!}
            meta={screen.scaleMeta}
            finished={finished}
            onNext={() => setPhase('situation')}
          />
        ) : (
          <>
            {/* Новая информация часто меняет смысл всей ситуации,
                поэтому у неё отдельный блок, а не строка в тексте. */}
            {st.info && !finished && (
              <Panel className="p-4 flex gap-3">
                <span className="text-accent shrink-0 mt-0.5"><IconAlert size={16} /></span>
                <div>
                  <Label className="text-accent">Новая информация</Label>
                  <p className="text-sm mt-1.5 max-w-[64ch]">{st.info}</p>
                </div>
              </Panel>
            )}

            <div className="flex flex-col gap-3 animate-rise" key={st.id}>
              {st.speaker && (
                <div className="flex items-center gap-2.5">
                  <span
                    className="grid place-items-center rounded-full shrink-0 text-muted"
                    style={{
                      width: 34, height: 34,
                      background: 'rgb(var(--c-raised))',
                      border: '1px solid rgb(var(--c-hair))'
                    }}
                    aria-hidden="true"
                  >
                    <IconRadio size={16} />
                  </span>
                  <span className="text-sm text-muted">{st.speaker}</span>
                </div>
              )}
              <div className="bubble">
                <p className="text-[1.0625rem] leading-relaxed max-w-[58ch]">{st.text}</p>
              </div>
            </div>

            {finished ? (
              <Finish screen={screen} sessionId={sessionId} />
            ) : st.kind === 'sequence' && screen.sequence ? (
              <Sequence items={screen.sequence.items} busy={busy} onSubmit={order} />
            ) : mode === 'speech' && st.freeText ? (
              <Speech busy={busy} reply={reply} onSay={say} onShowActions={() => setMode('actions')} />
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

      {/* --------------------------------- показатели: всегда на виду */}
      {!finished && (
        <div className="sticky bottom-0 bg-ground/95 backdrop-blur border-t border-hair">
          <div className="mx-auto w-full max-w-3xl px-4 py-3">
            <ScaleRow
              meta={screen.scaleMeta}
              scales={screen.scales}
              deltas={showConsequence ? sumDeltas(screen.lastResult) : undefined}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** Сумма изменений показателей за ход — вместе с созревшими последствиями. */
function sumDeltas(result: ResultView | null): Partial<Scales> {
  if (!result) return {}
  const out: Partial<Scales> = { ...result.effects }
  for (const e of result.events) {
    for (const [k, v] of Object.entries(e.effects ?? {})) {
      out[k] = (out[k] ?? 0) + (v as number)
    }
  }
  return out
}

/**
 * Экран последствия.
 *
 * Отдельный шаг, а не строка над новой репликой. Пока человек не увидел,
 * что изменилось от его решения, показывать следующую ситуацию рано:
 * причинно-следственную связь он тогда просто не заметит.
 *
 * Отложенное последствие помечается особо, но без указания причины — её
 * человек найдёт в разборе, и найденная связь запоминается лучше подписанной.
 */
function Consequence({
  result, meta, finished, onNext
}: {
  result: ResultView
  meta: ScaleMeta[]
  finished: boolean
  onNext: () => void
}) {
  return (
    <div className="flex flex-col gap-4 animate-rise">
      <div className="flex items-center gap-2.5">
        <span className={result.timedOut ? 'text-danger' : 'text-good'}>
          {result.timedOut ? <IconAlert size={18} /> : <IconCheck size={18} />}
        </span>
        <h2 className="font-display font-bold tracking-wide uppercase text-sm">
          {result.timedOut ? 'Решение не принято вовремя' : 'Решение принято'}
        </h2>
      </div>

      <Card className="p-5 flex flex-col gap-4">
        {result.actionLabel && (
          <div>
            <Label>Вы выбрали</Label>
            <p className="text-[1.0625rem] leading-snug mt-1.5">«{result.actionLabel}»</p>
          </div>
        )}

        <Deltas effects={result.effects} meta={meta} />

        {result.consequence && (
          <Panel className="p-4">
            <p className="text-[0.975rem] leading-relaxed max-w-[62ch]">{result.consequence}</p>
          </Panel>
        )}

        {/*
          Почему так вышло. Не оценка «правильно / неправильно», а ссылка
          на требование источника, на которое опиралось действие.
        */}
        {result.basis && (
          <div className="flex gap-3 pt-1">
            <span className="shrink-0 mt-0.5" style={{ color: 'rgb(var(--c-safety))' }}>
              <IconShield size={15} />
            </span>
            <div>
              <Label>Основание</Label>
              <p className="text-sm text-muted mt-1 max-w-[64ch]">{result.basis}</p>
            </div>
          </div>
        )}
      </Card>

      {result.grade && (
        <Panel className="p-4">
          <Label className={result.grade === 'correct' ? 'text-good' : 'text-warn'}>
            {result.grade === 'correct'
              ? 'Порядок верный'
              : result.grade === 'partial'
                ? 'Главное сделано первым'
                : 'Порядок не тот'}
          </Label>
          {result.correctOrder && result.grade !== 'correct' && (
            <p className="text-sm text-muted mt-1.5">
              По приоритету: {result.correctOrder.join(' → ')}
            </p>
          )}
        </Panel>
      )}

      {result.events.map((e, i) => (
        <Card key={i} className="p-5 flex flex-col gap-3"
          style={{ borderColor: 'rgb(var(--c-warn) / .45)' }}>
          <Label className="text-warn flex items-center gap-2">
            <IconAlert size={13} />
            {e.delayed ? 'Предыдущее решение повлияло на развитие ситуации' : 'Обстановка изменилась'}
          </Label>
          <p className="text-[0.975rem] leading-relaxed max-w-[62ch]">{e.note}</p>
          <Deltas effects={e.effects} meta={meta} />
        </Card>
      ))}

      <button className="btn btn-primary self-start" onClick={onNext} autoFocus>
        {finished ? 'К результату' : 'Продолжить'}
      </button>
    </div>
  )
}

/**
 * Изменение показателей.
 *
 * Подписи и иконки берутся из описания, пришедшего с сервером: на экране
 * не должно появляться служебных идентификаторов вроде «safety».
 */
function Deltas({ effects, meta }: { effects: Partial<Scales>; meta: ScaleMeta[] }) {
  const items = Object.entries(effects ?? {}).filter(([, v]) => v)
  if (!items.length) return null
  const nameOf = (id: string) => meta.find((m) => m.id === id)?.short ?? id

  return (
    <div className="flex flex-col gap-2">
      {items.map(([k, v]) => {
        const up = (v as number) > 0
        return (
          <div key={k} className="flex items-center gap-3">
            <span className="shrink-0" style={{ color: `rgb(${k === 'safety' ? 'var(--c-safety)' : k === 'loyalty' ? 'var(--c-loyalty)' : k === 'order' ? 'var(--c-order)' : 'var(--c-trust)'})` }}>
              <ScaleIcon id={k} size={16} />
            </span>
            <span className="text-sm flex-1">{nameOf(k)}</span>
            <span className={`num text-base font-semibold ${up ? 'text-good' : 'text-danger'}`}>
              {sign(v as number)}
            </span>
          </div>
        )
      })}
    </div>
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
    <div className="flex flex-col gap-2.5">
      <Label>Что вы делаете</Label>
      {actions.map((a) => (
        <button key={a.id} className="action" disabled={busy} onClick={() => onPick(a.id)}>
          <span className="flex-1 min-w-0">
            <span className="block text-[1rem] leading-snug">{a.label}</span>
            {a.kind === 'escalate' && (
              <span className="label mt-1.5 block text-accent">эскалация</span>
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
 * ни идентификаторов, ни ключевых слов. Если сказанное не удалось соотнести
 * ни с одним доступным действием, собеседник переспрашивает. Это поведение
 * человека напротив, а не сообщение об ошибке ввода.
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

  useEffect(() => { field.current?.focus() }, [])
  useEffect(() => { if (reply) setText('') }, [reply])

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
        className="input h-24 leading-snug text-[0.975rem]"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e) }}
        placeholder="Например: доложу начальнику поезда и попрошу медиков на станцию"
        aria-label="Что вы говорите или делаете"
        spellCheck={false}
        disabled={busy}
      />

      {reply && (
        <Card className="p-4 flex gap-3" style={{ borderColor: 'rgb(var(--c-warn) / .45)' }} role="status">
          <span className="text-warn shrink-0 mt-0.5"><IconAlert size={16} /></span>
          <div>
            <Label className="text-warn">Вас переспрашивают</Label>
            <p className="text-sm mt-1.5">{reply.text}</p>
            <p className="text-sm text-faint mt-1">Вы сказали: «{reply.said}»</p>
          </div>
        </Card>
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
 * Важнее всего именно он, потому что приоритизация — это и есть выбор того,
 * что делаешь первым.
 */
function Sequence({
  items, busy, onSubmit
}: {
  items: { id: string; label: string }[]
  busy: boolean
  onSubmit: (ids: string[]) => void
}) {
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return (
    <div className="flex flex-col gap-2.5">
      <Label>Расставьте по порядку · нажимайте в той очерёдности, в которой будете делать</Label>
      {items.map((it) => {
        const at = picked.indexOf(it.id)
        return (
          <button
            key={it.id}
            className="action"
            onClick={() => toggle(it.id)}
            disabled={busy}
            aria-pressed={at >= 0}
          >
            <span
              className="num text-sm shrink-0 grid place-items-center rounded-full"
              style={{
                width: 24, height: 24,
                background: at >= 0 ? 'rgb(var(--c-accent))' : 'rgb(var(--c-sunken))',
                color: at >= 0 ? '#fff' : 'rgb(var(--c-faint))'
              }}
            >
              {at >= 0 ? at + 1 : '·'}
            </span>
            <span className="flex-1 text-[1rem] leading-snug">{it.label}</span>
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
          <button className="btn" onClick={() => setPicked([])} disabled={busy}>Сбросить</button>
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
      {st.verdict && <div><Verdict verdict={st.verdict} /></div>}
      {st.summary && (
        <Card className="p-5">
          <Label>Почему так вышло</Label>
          <p className="text-sm leading-relaxed mt-2 max-w-[64ch]">{st.summary}</p>
        </Card>
      )}
      <Panel className="p-4">
        <ScaleRow meta={screen.scaleMeta} scales={screen.scales} size="big" />
      </Panel>
      <div className="flex flex-wrap gap-3">
        <button className="btn btn-primary" onClick={() => go(`/debrief/${sessionId}`)}>
          Разбор
        </button>
        <button className="btn" onClick={() => go('/')}>К смене</button>
      </div>
    </div>
  )
}
