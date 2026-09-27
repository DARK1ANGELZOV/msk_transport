/**
 * Снимки экранов через локальный Chrome.
 *
 * Нужны для двух вещей: проверить, что интерфейс действительно собирается
 * в то, что задумано, и приложить кадры к сдаче. Puppeteer подключается
 * из соседнего проекта, если он там уже стоит: тянуть браузер в зависимости
 * ради снимков не хочется.
 *
 *   node e2e/shots.mjs            (сервер должен быть запущен)
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const BASE = process.env.BASE || 'http://localhost:8787'
const OUT = process.env.SHOTS_DIR || 'tmp/shots'
const PASSWORD = process.env.SEED_PASSWORD || 'krechet-2028'

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => fs.existsSync(p))

const REQUIRE_PATHS = [
  process.cwd(),
  path.resolve(process.cwd(), '../chistiy_bereg')
]

function loadPuppeteer() {
  for (const base of REQUIRE_PATHS) {
    try {
      return createRequire(path.join(base, 'noop.js'))('puppeteer-core')
    } catch {
      // Пробуем следующий каталог.
    }
  }
  return null
}

const puppeteer = loadPuppeteer()
if (!puppeteer || !CHROME) {
  console.log('Снимки пропущены: нет puppeteer-core или локального Chrome.')
  console.log('Это не ошибка сборки — тесты и приложение работают без них.')
  process.exit(0)
}

fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
})

const errors = []

async function shot(page, name, width = 1440, height = 950) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 })
  await new Promise((r) => setTimeout(r, 450))
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  console.log(`  ${name}.png`)
}

async function login(page, who) {
  // Сессия живёт в куке, поэтому перед сменой роли выходим по-настоящему.
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle0' })
  await page.evaluate(() =>
    fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
  )
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle0' })
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 8000 })
  await page.type('input[autocomplete="username"]', who)
  await page.type('input[type="password"]', PASSWORD)
  await page.click('button.btn-primary')
  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 8000 })
}

const page = await browser.newPage()
page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})

console.log('Снимки:')

await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle0' })
await shot(page, '01-login')

await login(page, 'demo')
await shot(page, '02-home')

await page.goto(`${BASE}/#/profile`, { waitUntil: 'networkidle0' })
await shot(page, '03-profile')

await page.goto(`${BASE}/#/rating`, { waitUntil: 'networkidle0' })
await shot(page, '04-rating')

// Игровой экран: заходим в сценарий и делаем один ход.
await page.goto(`${BASE}/#/play/med-01?mode=practice`, { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 600))
await shot(page, '05-play', 900, 1000)

// Разбор последнего рейса из истории.
await page.goto(`${BASE}/#/profile`, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  const row = [...document.querySelectorAll('button')]
    .find((b) => /разбор|\d+\s*%/.test(b.textContent ?? '') && b.textContent?.includes('%'))
  row?.click()
})
await new Promise((r) => setTimeout(r, 1200))
if (!page.url().includes('debrief')) {
  console.log('  (разбор не открылся из профиля — снимаем через API)')
  const id = await page.evaluate(async () => {
    const r = await fetch('/api/profile', { credentials: 'same-origin' }).then((x) => x.json())
    return r.history?.find((h) => h.status === 'scored')?.id ?? ''
  })
  if (id) {
    await page.goto(`${BASE}/#/debrief/${id}`, { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 900))
  }
}
await shot(page, '06-debrief')

await login(page, 'method')
await page.goto(`${BASE}/#/methodist`, { waitUntil: 'networkidle0' })
await shot(page, '07-methodist')

await page.goto(`${BASE}/#/methodist/med-01`, { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 700))
await shot(page, '08-editor')

await login(page, 'boss')
await page.goto(`${BASE}/#/manager`, { waitUntil: 'networkidle0' })
await shot(page, '09-manager')

// Светлая тема — она обязана быть рабочей, а не «инвертированной».
await page.evaluate(() => localStorage.setItem('ekipazh-theme', 'light'))
await page.reload({ waitUntil: 'networkidle0' })
await shot(page, '10-manager-light')

await browser.close()

if (errors.length) {
  console.log('')
  console.log('Ошибки в консоли браузера:')
  for (const e of [...new Set(errors)]) console.log(`  ${e}`)
  process.exit(1)
}
console.log('')
console.log(`Готово. Снимки в ${OUT}`)
