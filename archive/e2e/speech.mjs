/**
 * Свободный разговор в настоящем браузере.
 *
 * Проверяется главное свойство режима: проводник отвечает своими словами,
 * распознаватель относит сказанное к варианту графа, сервер приходит к тому же
 * выводу и принимает прохождение. Если бы клиент и сервер расходились хоть
 * на одном узле, рейс ушёл бы в спорные — и этот тест это заметил бы.
 *
 *   node e2e/speech.mjs          (сервер должен быть запущен)
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

function loadPuppeteer() {
  for (const base of [process.cwd(), path.resolve(process.cwd(), '../chistiy_bereg')]) {
    try {
      return createRequire(path.join(base, 'noop.js'))('puppeteer-core')
    } catch {
      // следующий каталог
    }
  }
  return null
}

const puppeteer = loadPuppeteer()
if (!puppeteer || !CHROME) {
  console.log('Пропущено: нет puppeteer-core или локального Chrome.')
  process.exit(0)
}

fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage']
})
const page = await browser.newPage()
await page.setViewport({ width: 1000, height: 1100 })

const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const text = async () => (await page.evaluate(() => document.body.innerText)).toLowerCase()
const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  console.log(`  ${name}.png`)
}

let failed = 0
const check = (ok, name, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    ${detail}`}`)
  if (!ok) failed += 1
}

/** Говорит фразу в поле свободного ответа. */
async function say(phrase) {
  // Поле очищает сам компонент: после понятой реплики узел перемонтируется,
  // после непонятой — текст сбрасывается. Трогать value руками нельзя:
  // React об этом не узнает и перезапишет своим состоянием.
  await page.waitForSelector('main textarea', { timeout: 5000 })
  await page.click('main textarea')
  await page.type('main textarea', phrase, { delay: 5 })
  await page.keyboard.press('Enter')
  await wait(700)
}

// --------------------------------------------------------------------- вход

await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle0' })
await page.type('input[autocomplete="username"]', 'demo')
await page.type('input[type="password"]', PASSWORD)
await page.click('button.btn-primary')
await page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 8000 })

// Режим «своими словами» — привычка, живёт в браузере.
await page.evaluate(() => localStorage.setItem('ekipazh-speech', '1'))
await page.goto(`${BASE}/#/play/med-01?mode=practice`, { waitUntil: 'networkidle0' })
await wait(700)

check(
  Boolean(await page.$('main textarea')),
  'на узле диалога вместо кнопок поле свободного ответа'
)
console.log('Снимки:')
await shot('14-speech')

// ------------------------------------------------- непонятая реплика

await say('ну как-то так')
const afterNonsense = await text()
check(/переспрашивает/.test(afterNonsense), 'непонятную реплику пассажир переспрашивает')
check(/\+3 с рейса/.test(afterNonsense), 'переспрос стоит секунд рейса')
await shot('15-speech-retry')

// ------------------------------------------------------ понятая реплика

await say('доложу начальнику поезда и попрошу медиков на станцию')
await wait(500)
const afterGood = await text()
check(
  /пассажир не приходит в себя/.test(afterGood),
  'после понятой реплики рейс перешёл к следующему узлу',
  afterGood.split(/\n+/).filter(Boolean).slice(-4).join(' | ').slice(0, 160)
)

// Доигрываем до конца: остальные узлы — как получится.
let guard = 0
while (guard++ < 40) {
  const body = await text()
  if (/инцидент закрыт/.test(body) || page.url().includes('debrief')) break

  if (await page.$('main textarea')) {
    await say('объявлю по составу нет ли среди пассажиров врача')
    // Если не поняли дважды подряд — переходим на кнопки, чтобы не топтаться.
    if (/переспрашивает/.test(await text())) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('main button')]
          .find((x) => x.innerText.toLowerCase().includes('показать варианты'))
        b?.click()
      })
      await wait(400)
    }
    continue
  }

  const acted = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('main button:not([aria-pressed])')]
      .find((b) => /^\s*\d\s/.test(b.innerText) && b.innerText.length > 20)
    if (btn) {
      btn.click()
      return true
    }
    const items = [...document.querySelectorAll('main button[aria-pressed="false"]')]
    if (items.length) {
      for (const el of items.slice(0, 3)) el.click()
      return 'multi'
    }
    return false
  })
  if (acted === 'multi') {
    await wait(200)
    await page.evaluate(() => {
      const go = [...document.querySelectorAll('main button')]
        .find((b) => b.innerText.toLowerCase().startsWith('выполнить') && !b.disabled)
      go?.click()
    })
  }
  await wait(450)
}

await wait(1500)
const finished = await text()
check(!/результат отклонён/.test(finished), 'сервер принял прохождение со свободными репликами')
check(/результат/.test(finished) || page.url().includes('debrief'), 'инцидент дошёл до результата')

// -------------------------------------------------------------- разбор

await page.evaluate(() => {
  const b = [...document.querySelectorAll('main button')]
    .find((x) => x.innerText.toLowerCase().includes('разбор'))
  b?.click()
})
await page.waitForFunction(() => location.hash.includes('debrief'), { timeout: 15000 })
await wait(1200)

await page.evaluate(() => {
  for (const d of document.querySelectorAll('details')) d.open = true
})
await wait(300)
const debrief = await text()
check(/почему так распознано/.test(debrief), 'разбор объясняет, почему реплика так распознана')
check(/«доложу начальнику поезда/.test(debrief), 'в разборе видно, что именно было сказано')
await shot('16-speech-debrief')

await browser.close()

if (errors.length) {
  console.log('')
  console.log('Ошибки в консоли браузера:')
  for (const e of [...new Set(errors)]) console.log(`  ${e}`)
  failed += 1
}

console.log('')
console.log(failed ? `Провалено: ${failed}` : 'Свободный разговор работает от реплики до разбора.')
process.exit(failed ? 1 : 0)
