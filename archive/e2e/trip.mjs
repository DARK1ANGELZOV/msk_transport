/**
 * Прохождение смены в настоящем браузере.
 *
 * Сквозные проверки API говорят, что сервер считает смену правильно.
 * Этот сценарий проверяет другое: что её можно пройти руками — инструктаж,
 * четыре инцидента, перегоны между ними и разбор в конце. Именно этот путь
 * показывают на защите, и именно он должен ломаться первым, если что-то
 * разъехалось в интерфейсе.
 *
 *   node e2e/trip.mjs            (сервер должен быть запущен)
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

/**
 * Видимый текст страницы в нижнем регистре.
 *
 * Интерфейс поднимает заголовки и подписи в прописные средствами CSS,
 * и `innerText` возвращает их уже прописными. Сравнивать с учётом регистра
 * здесь — верный способ написать тест, который врёт.
 */
const text = async () => (await page.evaluate(() => document.body.innerText)).toLowerCase()
const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  console.log(`  ${name}.png`)
}

/** Нажимает кнопку по видимому тексту. */
async function click(label) {
  const done = await page.evaluate((l) => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').trim().toLowerCase().includes(l.toLowerCase()))
    if (!btn) return false
    btn.click()
    return true
  }, label)
  if (!done) throw new Error(`кнопка «${label}» не найдена`)
  await wait(350)
}

let failed = 0
const check = (ok, name, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    ${detail}`}`)
  if (!ok) failed += 1
}

// --------------------------------------------------------------------- вход

await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle0' })
await page.type('input[autocomplete="username"]', 'demo')
await page.type('input[type="password"]', PASSWORD)
await page.click('button.btn-primary')
await page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 8000 })

// ------------------------------------------------------------------ смена

await page.goto(`${BASE}/#/trip/trip-701`, { waitUntil: 'networkidle0' })
await wait(600)
const briefing = await text()
check(/заступить на смену/.test(briefing), 'инструктаж перед сменой открывается')
check(/км/.test(briefing) && /перегон/.test(briefing), 'в инструктаже видны километры и перегоны')
console.log('Снимки:')
await shot('11-trip-briefing')

await click('Заступить на смену')

const seen = { legs: 0, gaps: 0 }
const kms = []
let guard = 0

while (guard++ < 120) {
  const body = await text()

  // Конец смены проверяем первым: на разборе тоже есть слова «перегон»
  // и «инцидент N из M», и без этого порядка тест принял бы его за перегон.
  if (page.url().includes('debrief') || /смена закрыта/.test(body)) break

  if (/без происшествий/.test(body) && /перегон/.test(body)) {
    seen.gaps += 1
    if (seen.gaps === 1) await shot('12-trip-gap')
    await click('Инцидент')
    continue
  }

  // Запоминаем километр, чтобы убедиться, что смена идёт по маршруту вперёд.
  const km = (body.match(/(\d+,\d)\s*км/) || [])[1]
  if (km) kms.push(Number(km.replace(',', '.')))

  const picked = await page.evaluate(() => {
    // Варианты диалога от отмечаемых пунктов отличает aria-pressed:
    // и те и другие начинаются с цифры, но пункт списка — переключатель.
    const btn = [...document.querySelectorAll('main button:not([aria-pressed])')]
      .find((b) => /^\s*\d\s/.test(b.innerText) && b.innerText.length > 20)
    if (btn) {
      btn.click()
      return 'choice'
    }
    // Узлы с множественным выбором: сначала отмечаем.
    const items = [...document.querySelectorAll('main button[aria-pressed]')]
    if (items.length) {
      for (const el of items.slice(0, 3)) el.click()
      return 'multi'
    }
    return null
  })

  // Подтверждать нужно отдельным тиком: React обновляет разметку не сразу,
  // и кнопка «Выполнить» в момент отметки ещё отключена.
  if (picked === 'multi') {
    await wait(200)
    await page.evaluate(() => {
      const go = [...document.querySelectorAll('main button')]
        .find((b) => b.innerText.toLowerCase().startsWith('выполнить') && !b.disabled)
      go?.click()
    })
  }

  if (process.env.TRACE) {
    const head = (await text()).split('\n').filter(Boolean).slice(-3).join(' | ')
    console.log(`  [${guard}] ${picked ?? 'ничего'} :: ${head.slice(0, 110)}`)
  }
  if (picked) {
    if (/инцидент \d+ закрыт/.test(await text())) seen.legs += 1
    await wait(400)
    continue
  }
  await wait(400)
}

if (!page.url().includes('debrief')) {
  // Не дошли — печатаем, на чём застряли: без этого отладка вслепую.
  console.log('Застряли. Экран:')
  console.log((await text()).slice(0, 400))
  if (errors.length) console.log('Ошибки страницы:', [...new Set(errors)].slice(0, 3))
  console.log('Кнопки:', await page.evaluate(
    () => [...document.querySelectorAll('main button')].map((b) => b.innerText.slice(0, 40))
  ))
}
await page.waitForFunction(() => location.hash.includes('debrief'), { timeout: 20000 })
await wait(1200)

const debrief = await text()
check(seen.gaps >= 3, 'между инцидентами показан перегон', `перегонов: ${seen.gaps}`)
check(
  kms.length > 3 && kms.at(-1) > kms[0],
  'смена идёт по маршруту вперёд',
  `километры: ${kms[0]} → ${kms.at(-1)}`
)
check(/как прошла смена/.test(debrief), 'разбор смены открылся')
check(/что несли с собой/.test(debrief), 'в разборе есть перегоны между инцидентами')
check(/пол усталости/.test(debrief), 'видно накопление усталости')
await shot('13-trip-debrief')

await browser.close()

if (errors.length) {
  console.log('')
  console.log('Ошибки в консоли браузера:')
  for (const e of [...new Set(errors)]) console.log(`  ${e}`)
  failed += 1
}

console.log('')
console.log(failed ? `Провалено: ${failed}` : 'Смена проходится целиком.')
process.exit(failed ? 1 : 0)
