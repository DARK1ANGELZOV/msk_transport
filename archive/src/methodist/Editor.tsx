import { useEffect, useMemo, useState } from 'react'

import {
  COMPETENCIES, MULTI_TYPES, TERMINAL_TYPES, analyze, validate,
  type Choice, type CompetencyId, type Element, type Scenario, type ScenarioNode
} from '../../engine/index.js'
import { api } from '../lib/api'
import { errorText } from '../App'
import { go } from '../lib/router'
import { Card, ErrorNote, Label, Section, Spinner } from '../ui/kit'

import { GraphMap } from './Graph'

/**
 * Редактор сценариев.
 *
 * Главный аргумент внедрения: сценарии устаревают вместе с регламентами,
 * и если для нового кейса нужен фронтендер, продукт умирает на двенадцатом.
 * Здесь методист правит граф мышкой, видит проверку до публикации и может
 * тут же пройти собственный сценарий.
 *
 * Проверка выполняется тем же модулем, что и на сервере при импорте, —
 * опубликовать то, что сервер не примет, нельзя в принципе.
 */
/** Строка методиста → словарь варианта. Пустые и повторы отбрасываются. */
function parseKeywords(raw: string): string[] {
  const seen = new Set<string>()
  for (const part of raw.split(/[,;\n]+/)) {
    const w = part.trim().toLowerCase()
    if (w) seen.add(w)
  }
  return [...seen]
}

export function Editor({ id }: { id: string }) {
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')
  const [showJson, setShowJson] = useState(false)

  useEffect(() => {
    api.methodistScenario(id)
      .then((r) => {
        setScenario(r.scenario)
        setSelected(r.scenario.entry)
      })
      .catch((e) => setError(errorText(e)))
  }, [id])

  const report = useMemo(() => (scenario ? validate(scenario) : null), [scenario])
  const analysis = useMemo(() => {
    if (!scenario || !report?.ok) return null
    // В редакторе версия не меняется на каждое нажатие клавиши, поэтому
    // расчёт идёт мимо кеша — иначе потолок замер бы на первом значении.
    try {
      return analyze(scenario, { cache: false })
    } catch {
      return null
    }
  }, [scenario, report])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!scenario) return <Spinner text="Открываем сценарий" />

  const node = scenario.nodes[selected]

  function patchNode(nodeId: string, patch: Partial<ScenarioNode>) {
    setScenario((s) => s && ({
      ...s,
      nodes: { ...s.nodes, [nodeId]: { ...s.nodes[nodeId], ...patch } }
    }))
    setSaved('')
  }

  function addNode(type: ScenarioNode['type']) {
    const nodeId = `n-${Math.random().toString(36).slice(2, 7)}`
    const fresh: ScenarioNode = type === 'outcome'
      ? { type, verdict: 'partial', text: 'Новый финал.', summary: '' }
      : { type: 'dialog', text: 'Новый узел.', limitSec: 12, onTimeout: scenario!.entry, choices: [] }
    setScenario((s) => s && ({ ...s, nodes: { ...s.nodes, [nodeId]: fresh } }))
    setSelected(nodeId)
    setSaved('')
  }

  async function publish() {
    setBusy(true)
    setSaved('')
    try {
      const r = await api.publishScenario(scenario)
      setScenario(r.scenario)
      setSaved(`Опубликована версия ${r.scenario.version}`)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const problems = new Set(
    (report?.errors ?? [])
      .map((m) => m.match(/«([^»]+)»/)?.[1] ?? '')
      .filter((n) => n in scenario.nodes)
  )

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Label>Редактор · {scenario.id} · версия {scenario.version}</Label>
          <h1 className="font-display text-3xl uppercase tracking-wide leading-none mt-1">
            {scenario.title}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => go(`/play/${scenario.id}?mode=practice`)}>
            Предпросмотр
          </button>
          <button className="btn" onClick={() => setShowJson((v) => !v)}>
            {showJson ? 'Скрыть JSON' : 'JSON'}
          </button>
          <button
            className="btn btn-primary"
            onClick={publish}
            disabled={busy || !report?.ok}
            title={report?.ok ? 'Создаст новую версию' : 'Сначала исправьте ошибки'}
          >
            {busy ? 'Публикуем' : 'Опубликовать'}
          </button>
        </div>
      </section>

      <ValidationPanel report={report} analysis={analysis} saved={saved} />

      <Section
        eyebrow="Граф"
        title="Карта сценария"
        action={
          <div className="flex gap-2">
            <button className="btn" onClick={() => addNode('dialog')}>+ узел</button>
            <button className="btn" onClick={() => addNode('outcome')}>+ финал</button>
          </div>
        }
      >
        <GraphMap
          scenario={scenario}
          selected={selected}
          onSelect={setSelected}
          problems={problems}
        />
        <p className="text-sm text-faint">
          Зелёным подсвечен эталонный путь по СОП, пунктиром — ветки по таймауту,
          красным — узлы с ошибками. Раскладка считается автоматически по расстоянию
          от стартового узла.
        </p>
      </Section>

      {node ? (
        <NodeEditor
          scenario={scenario}
          nodeId={selected}
          node={node}
          onPatch={(patch) => patchNode(selected, patch)}
        />
      ) : null}

      {showJson ? (
        <Section eyebrow="Обмен" title="Сценарий целиком">
          <textarea
            className="w-full h-80 bg-surface border border-hair p-3 font-mono text-xs"
            value={JSON.stringify(scenario, null, 2)}
            onChange={(e) => {
              try {
                setScenario(JSON.parse(e.target.value))
                setError('')
              } catch {
                setError('JSON не разбирается — правка не применена')
              }
            }}
            spellCheck={false}
          />
          <p className="text-sm text-faint">
            Формат открытый: сценарии выгружаются и загружаются файлами и лежат в репозитории
            у заказчика. Вендорного замка нет.
          </p>
        </Section>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------

function ValidationPanel({
  report, analysis, saved
}: {
  report: ReturnType<typeof validate> | null
  analysis: ReturnType<typeof analyze> | null
  saved: string
}) {
  if (!report) return null
  return (
    <div
      className={`card p-4 flex flex-col gap-3 border-l-2 ${
        report.ok ? 'border-l-good' : 'border-l-danger'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <Label>Проверка</Label>
        <span className={`text-sm ${report.ok ? 'text-good' : 'text-danger'}`}>
          {report.ok ? 'Ошибок нет — можно публиковать' : `Ошибок: ${report.errors.length}`}
        </span>
        <span className="label">узлов {report.nodes}</span>
        {analysis ? (
          <>
            <span className="label">потолок {analysis.maxScore}</span>
            <span className="label">пол {analysis.minScore}</span>
            <span className="label">путей перебрано {analysis.paths}</span>
          </>
        ) : null}
        {saved ? <span className="text-sm text-good">{saved}</span> : null}
      </div>

      {report.errors.length ? (
        <ul className="text-sm text-danger flex flex-col gap-1 list-disc pl-5">
          {report.errors.map((m) => <li key={m}>{m}</li>)}
        </ul>
      ) : null}
      {report.warnings.length ? (
        <ul className="text-sm text-warn flex flex-col gap-1 list-disc pl-5">
          {report.warnings.map((m) => <li key={m}>{m}</li>)}
        </ul>
      ) : null}
      {analysis?.truncated ? (
        <p className="text-sm text-warn">
          Граф слишком ветвистый: перебор путей ограничен, потолок оценён приблизительно.
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

function NodeEditor({
  scenario, nodeId, node, onPatch
}: {
  scenario: Scenario
  nodeId: string
  node: ScenarioNode
  onPatch: (patch: Partial<ScenarioNode>) => void
}) {
  const nodeIds = Object.keys(scenario.nodes)
  const isTerminal = TERMINAL_TYPES.has(node.type)
  const isMulti = MULTI_TYPES.has(node.type)

  function patchChoice(index: number, patch: Partial<Choice>) {
    const choices = [...(node.choices ?? [])]
    choices[index] = { ...choices[index], ...patch }
    onPatch({ choices })
  }

  function patchElement(key: 'blocks' | 'items', index: number, patch: Partial<Element>) {
    const list = [...(node[key] ?? [])]
    list[index] = { ...list[index], ...patch }
    onPatch({ [key]: list } as Partial<ScenarioNode>)
  }

  return (
    <Section eyebrow={`Узел ${nodeId}`} title={node.type === 'outcome' ? 'Финал' : 'Решение'}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 flex flex-col gap-3">
          <Field label="Кто говорит">
            <input
              className="input"
              value={node.speaker ?? ''}
              onChange={(e) => onPatch({ speaker: e.target.value })}
            />
          </Field>
          <Field label="Текст">
            <textarea
              className="input h-24"
              value={node.text ?? ''}
              onChange={(e) => onPatch({ text: e.target.value })}
            />
          </Field>
          {!isTerminal ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Лимит, секунд">
                <input
                  className="input num"
                  type="number"
                  min={0}
                  value={node.limitSec ?? 0}
                  onChange={(e) => onPatch({ limitSec: Number(e.target.value) })}
                />
              </Field>
              <Field label="Ветка по таймауту">
                <NodeSelect
                  ids={nodeIds}
                  value={node.onTimeout ?? ''}
                  onChange={(v) => onPatch({ onTimeout: v })}
                />
              </Field>
            </div>
          ) : (
            <Field label="Вердикт">
              <select
                className="input"
                value={node.verdict ?? 'partial'}
                onChange={(e) => onPatch({ verdict: e.target.value as ScenarioNode['verdict'] })}
              >
                <option value="good">good — хороший исход</option>
                <option value="partial">partial — с потерями</option>
                <option value="bad">bad — инцидент</option>
              </select>
            </Field>
          )}
          {isMulti ? (
            <Field label="Следующий узел">
              <NodeSelect ids={nodeIds} value={node.next ?? ''} onChange={(v) => onPatch({ next: v })} />
            </Field>
          ) : null}
          <Field label="Подсказка (скрывается в экзамене)">
            <input
              className="input"
              value={node.hint ?? ''}
              onChange={(e) => onPatch({ hint: e.target.value })}
            />
          </Field>
        </Card>

        <Card className="p-4 flex flex-col gap-3">
          <Label>Разбор</Label>
          <Field label="Пункт СОП">
            <input
              className="input num"
              value={node.sop ?? ''}
              onChange={(e) => onPatch({ sop: e.target.value })}
            />
          </Field>
          <Field label="Объяснение">
            <textarea
              className="input h-20"
              value={node.feedback ?? ''}
              onChange={(e) => onPatch({ feedback: e.target.value })}
            />
          </Field>
          <Field label="Комментарий наставника">
            <textarea
              className="input h-20"
              value={node.mentorNote ?? ''}
              onChange={(e) => onPatch({ mentorNote: e.target.value })}
            />
          </Field>
          {isTerminal ? (
            <Field label="Вывод рейса">
              <textarea
                className="input h-20"
                value={node.summary ?? ''}
                onChange={(e) => onPatch({ summary: e.target.value })}
              />
            </Field>
          ) : null}
        </Card>
      </div>

      {!isTerminal && !isMulti ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Label>Варианты · {node.choices?.length ?? 0}</Label>
            <button
              className="btn"
              onClick={() => onPatch({
                choices: [...(node.choices ?? []), {
                  id: `c-${Math.random().toString(36).slice(2, 6)}`,
                  text: 'Новый вариант',
                  costSec: 10,
                  effects: {},
                  next: scenario.entry
                }]
              })}
            >
              + вариант
            </button>
          </div>
          {(node.choices ?? []).map((c, i) => (
            <Card key={c.id} className="p-4 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className="num text-xs text-faint pt-2">{c.id}</span>
                <textarea
                  className="input flex-1 h-16"
                  value={c.text}
                  onChange={(e) => patchChoice(i, { text: e.target.value })}
                />
                <button
                  className="btn"
                  onClick={() => onPatch({ choices: (node.choices ?? []).filter((_, j) => j !== i) })}
                >
                  Удалить
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Цена, секунд рейса">
                  <input
                    className="input num"
                    type="number"
                    value={c.costSec ?? 0}
                    onChange={(e) => patchChoice(i, { costSec: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Ведёт в узел">
                  <NodeSelect ids={nodeIds} value={c.next} onChange={(v) => patchChoice(i, { next: v })} />
                </Field>
                <Field label="Пункт СОП">
                  <input
                    className="input num"
                    value={c.sop ?? ''}
                    onChange={(e) => patchChoice(i, { sop: e.target.value })}
                  />
                </Field>
              </div>

              <EffectsEditor
                effects={c.effects ?? {}}
                declared={scenario.competencies ?? []}
                onChange={(effects) => patchChoice(i, { effects })}
              />

              <Field label="Объяснение при разборе">
                <textarea
                  className="input h-16"
                  value={c.feedback ?? ''}
                  onChange={(e) => patchChoice(i, { feedback: e.target.value })}
                />
              </Field>

              <Field label="Как это скажут своими словами · через запятую">
                <textarea
                  className="input h-16"
                  value={(c.keywords ?? []).join(', ')}
                  placeholder="доложить, кнопка связи, лнп, вызвать медиков, скорая"
                  onChange={(e) => patchChoice(i, { keywords: parseKeywords(e.target.value) })}
                />
                <p className="label mt-1 normal-case tracking-normal">
                  Слово должно указывать на действие, а не на ситуацию: «посмотреть»
                  подойдёт и к осмотру пассажира, и к взгляду в телефон — и утянет
                  на себя невнятные ответы. Проверить словарь: npm run bench:intent
                </p>
              </Field>
            </Card>
          ))}
        </div>
      ) : null}

      {isMulti ? (
        <div className="flex flex-col gap-3">
          <Label>
            Элементы · порядок в «правильном порядке»: {(node.correctOrder ?? []).join(' → ') || 'не задан'}
          </Label>
          {(['blocks', 'items'] as const).map((key) =>
            (node[key] ?? []).map((el, i) => (
              <Card key={el.id} className="p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <span className="num text-xs text-faint pt-2">{el.id}</span>
                  <textarea
                    className="input flex-1 h-14"
                    value={el.text}
                    onChange={(e) => patchElement(key, i, { text: e.target.value })}
                  />
                  <div className="w-28">
                    <Field label="Секунд">
                      <input
                        className="input num"
                        type="number"
                        value={el.costSec ?? 0}
                        onChange={(e) => patchElement(key, i, { costSec: Number(e.target.value) })}
                      />
                    </Field>
                  </div>
                </div>
                <EffectsEditor
                  effects={el.effects ?? {}}
                  declared={scenario.competencies ?? []}
                  onChange={(effects) => patchElement(key, i, { effects })}
                />
              </Card>
            ))
          )}
        </div>
      ) : null}
    </Section>
  )
}

// ---------------------------------------------------------------------------

function EffectsEditor({
  effects, declared, onChange
}: {
  effects: NonNullable<Choice['effects']>
  declared: CompetencyId[]
  onChange: (e: NonNullable<Choice['effects']>) => void
}) {
  const scales: { id: 'safety' | 'loyalty' | 'carMood' | 'stress'; title: string }[] = [
    { id: 'safety', title: 'Безопасность' },
    { id: 'loyalty', title: 'Пассажир' },
    { id: 'carMood', title: 'Вагон' },
    { id: 'stress', title: 'Стресс' }
  ]
  const comps = COMPETENCIES.filter((c) => declared.includes(c.id))

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {scales.map((s) => (
          <Field key={s.id} label={s.title}>
            <input
              className="input num"
              type="number"
              value={effects[s.id] ?? 0}
              onChange={(e) => onChange({ ...effects, [s.id]: Number(e.target.value) })}
            />
          </Field>
        ))}
      </div>
      {comps.length ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {comps.map((c) => (
            <Field key={c.id} label={c.short}>
              <input
                className="input num"
                type="number"
                value={effects.competency?.[c.id] ?? 0}
                onChange={(e) => onChange({
                  ...effects,
                  competency: { ...effects.competency, [c.id]: Number(e.target.value) }
                })}
              />
            </Field>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

function NodeSelect({
  ids, value, onChange
}: { ids: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— не задан —</option>
      {ids.map((id) => <option key={id} value={id}>{id}</option>)}
    </select>
  )
}
