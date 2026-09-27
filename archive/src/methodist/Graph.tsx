import { useMemo } from 'react'

import { TERMINAL_TYPES, edgesOf, type Scenario } from '../../engine/index.js'

/**
 * Карта графа.
 *
 * Раскладка считается сама — по расстоянию от стартового узла. Координаты
 * намеренно не хранятся в сценарии: это учебный материал, а не схема, и
 * методист не должен следить за тем, чтобы после добавления узла ничего
 * не наехало друг на друга. Эталонный путь подсвечен: он и есть «как надо».
 */
const COL = 190
const ROW = 78

interface Placed {
  id: string
  x: number
  y: number
  depth: number
  terminal: boolean
  onRef: boolean
}

export function useLayout(scenario: Scenario) {
  return useMemo(() => {
    const depth = new Map<string, number>([[scenario.entry, 0]])
    const queue = [scenario.entry]
    while (queue.length) {
      const id = queue.shift() as string
      const node = scenario.nodes[id]
      if (!node) continue
      for (const next of edgesOf(node)) {
        if (!scenario.nodes[next] || depth.has(next)) continue
        depth.set(next, (depth.get(id) ?? 0) + 1)
        queue.push(next)
      }
    }
    // Узлы, до которых не дошли (граф сломан) — в отдельную колонку справа.
    const maxDepth = Math.max(0, ...depth.values())
    for (const id of Object.keys(scenario.nodes)) {
      if (!depth.has(id)) depth.set(id, maxDepth + 1)
    }

    const byDepth = new Map<number, string[]>()
    for (const [id, d] of [...depth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!byDepth.has(d)) byDepth.set(d, [])
      byDepth.get(d)?.push(id)
    }

    const ref = new Set(scenario.reference ?? [])
    const placed: Placed[] = []
    for (const [d, ids] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
      ids.forEach((id, i) => {
        placed.push({
          id,
          x: 24 + d * COL,
          y: 24 + i * ROW,
          depth: d,
          terminal: TERMINAL_TYPES.has(scenario.nodes[id]?.type),
          onRef: ref.has(id)
        })
      })
    }

    const width = 48 + (Math.max(...placed.map((p) => p.depth)) + 1) * COL
    const height = 48 + Math.max(...[...byDepth.values()].map((v) => v.length)) * ROW
    return { placed, width, height }
  }, [scenario])
}

export function GraphMap({
  scenario, selected, onSelect, problems
}: {
  scenario: Scenario
  selected: string
  onSelect: (id: string) => void
  problems?: Set<string>
}) {
  const { placed, width, height } = useLayout(scenario)
  const pos = new Map(placed.map((p) => [p.id, p]))
  const refPairs = new Set(
    (scenario.reference ?? []).slice(0, -1).map((id, i) => `${id}→${(scenario.reference ?? [])[i + 1]}`)
  )

  return (
    <div className="card overflow-auto max-h-[26rem]">
      <svg width={width} height={height} className="block" role="img" aria-label="Карта сценария">
        {placed.map((p) => {
          const node = scenario.nodes[p.id]
          return edgesOf(node).map((next) => {
            const to = pos.get(next)
            if (!to) return null
            const isRef = refPairs.has(`${p.id}→${next}`)
            const isTimeout = node.onTimeout === next
            const x1 = p.x + 150
            const y1 = p.y + 18
            const x2 = to.x
            const y2 = to.y + 18
            const mid = (x1 + x2) / 2
            return (
              <path
                key={`${p.id}-${next}`}
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={isRef ? 'rgb(var(--c-good))' : 'rgb(var(--c-line))'}
                strokeWidth={isRef ? 1.8 : 1}
                strokeDasharray={isTimeout ? '3 3' : undefined}
              />
            )
          })
        })}

        {placed.map((p) => {
          const node = scenario.nodes[p.id]
          const active = p.id === selected
          const bad = problems?.has(p.id)
          return (
            <g
              key={p.id}
              transform={`translate(${p.x} ${p.y})`}
              className="cursor-pointer"
              onClick={() => onSelect(p.id)}
            >
              <rect
                width="150"
                height="36"
                rx="2"
                fill={active ? 'rgb(var(--c-accent) / .14)' : 'rgb(var(--c-surface))'}
                stroke={
                  bad ? 'rgb(var(--c-danger))'
                    : active ? 'rgb(var(--c-accent))'
                      : p.onRef ? 'rgb(var(--c-good))' : 'rgb(var(--c-line))'
                }
                strokeWidth={active || bad ? 1.8 : 1}
              />
              <text x="8" y="15" className="text-[9px] font-mono" fill="rgb(var(--c-faint))">
                {p.id}
              </text>
              <text x="8" y="28" className="text-[10px]" fill="rgb(var(--c-ink))">
                {(node?.type === 'outcome' ? node.verdict : node?.type) ?? '?'}
                {node?.limitSec ? ` · ${node.limitSec} с` : ''}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
