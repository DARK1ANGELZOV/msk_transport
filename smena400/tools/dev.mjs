/**
 * Разработка одной командой: API и фронтенд рядом.
 *
 *   npm run dev
 *
 * Фронтенд живёт на 5173 и ходит в API на 5400 через прокси Vite, поэтому
 * в коде клиента нет ни одного абсолютного адреса сервера.
 */
import { spawn } from 'node:child_process'

const procs = []

const run = (name, cmd, args) => {
  const p = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  p.on('exit', (code) => {
    if (code) console.error(`[${name}] завершился с кодом ${code}`)
    stop()
  })
  procs.push(p)
  return p
}

const stop = () => {
  for (const p of procs) if (!p.killed) p.kill()
  process.exit(0)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

console.log('СМЕНА 400 — режим разработки')
console.log('  клиент   http://localhost:5173')
console.log('  API      http://localhost:5400')
console.log('')

run('api', process.execPath, ['--disable-warning=ExperimentalWarning', '--watch', 'server/index.js'])
run('web', 'npx', ['vite', '--host', '0.0.0.0'])
