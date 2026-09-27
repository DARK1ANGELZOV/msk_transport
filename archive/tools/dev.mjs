/**
 * Разработка одной командой: поднимает API и Vite вместе.
 *
 * Без внешних зависимостей вроде concurrently.
 */
import { spawn } from 'node:child_process'

const isWin = process.platform === 'win32'

const procs = [
  {
    name: 'api',
    cmd: process.execPath,
    args: [
      '--disable-warning=ExperimentalWarning',
      '--watch',
      'server/index.js'
    ]
  },
  {
    name: 'web',
    cmd: process.execPath,
    args: [
      'node_modules/vite/bin/vite.js',
      '--host',
      '0.0.0.0'
    ]
  }
].map(({ name, cmd, args }) => {
  const p = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    cwd: process.cwd(),
    windowsHide: false
  })

  const tag = (line) => `[${name}] ${line}`

  p.stdout.on('data', (d) => {
    const output = String(d)
      .split('\n')
      .filter(Boolean)
      .map(tag)
      .join('\n')

    if (output) process.stdout.write(output + '\n')
  })

  p.stderr.on('data', (d) => {
    const output = String(d)
      .split('\n')
      .filter(Boolean)
      .map(tag)
      .join('\n')

    if (output) process.stderr.write(output + '\n')
  })

  p.on('error', (err) => {
    console.error(`[${name}] ошибка запуска:`, err)
    stop()
  })

  p.on('exit', (code, signal) => {
    console.log(
      `[${name}] завершился с кодом ${code}` +
      (signal ? ` (signal ${signal})` : '')
    )

    if (!stopping) stop()
  })

  return p
})

let stopping = false

function stop() {
  if (stopping) return
  stopping = true

  for (const p of procs) {
    if (!p.killed) {
      p.kill()
    }
  }

  process.exit(0)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

console.log('API: http://localhost:8787 · интерфейс: http://localhost:5173')
console.log('База пуста? Заполните демо-данными: npm run seed')