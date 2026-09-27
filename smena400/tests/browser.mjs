/**
 * Проверка в настоящем браузере.
 *
 *   node tests/browser.mjs        (сервер должен быть запущен)
 *
 * Тесты API доказывают, что сервер считает верно. Здесь проверяется то,
 * чего они не видят: что человек может пройти ситуацию руками, что таймер
 * идёт, что свободная реплика работает из поля ввода и что разбор
 * действительно показывает альтернативу.
 *
 * Если puppeteer или локального Chrome нет, проверка пропускается:
 * она полезная, но не обязательная для запуска продукта.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const BASE = process.env.BASE || 'http://localhost:5400'
const OUT = process.env.SHOTS_DIR || 'tmp/shots'

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => fs.existsSync(p))

function loadPuppeteer() {
  for (const base of [process.cwd(), path.resolve(process.cwd(), '..'), path.resolve(process.cwd(), '../../chistiy_bereg')]) {
    try {
      return createRequire(path.join(base, 'noop.js'))('puppeteer-core')
    } catch { /* следующий каталог */ }
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
await page.setViewport({ width: 430, height: 950 }) // телефон: интерфейс mobile-first

const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const text = async () => (await page.evaluate(() => document.body.innerText)).toLowerCase()
const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
  console.log(`  ${name}.png`)
}

let failed = 0
const check = (ok, name, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    ${detail}`}`)
  if (!ok) failed += 1
}

/**
 * Довести ситуацию на один шаг вперёд.
 *
 * Учитывает все три вида ввода: кнопки, свободная реплика (тогда сначала
 * возвращаемся к вариантам) и последовательность.
 */
const advance = (last = false) =>
  page.evaluate((useLast) => {
    // Экран последствия — отдельный шаг: сначала «Дальше».
    const next = [...document.querySelectorAll('button')]
      .find((x) => ['дальше', 'к результату'].includes(x.innerText.trim().toLowerCase()))
    if (next) {
      next.click()
      return 'consequence'
    }
    const speech = [...document.querySelectorAll('button')]
      .find((x) => x.innerText.toLowerCase().includes('показать варианты'))
    if (speech) {
      speech.click()
      return 'speech'
    }
    const list = [...document.querySelectorAll('button.action')]
    if (list.length) {
      const pressed = list.filter((b) => b.getAttribute('aria-pressed') !== null)
      if (pressed.length) {
        for (const b of pressed) b.click()
        return 'sequence'
      }
      list[useLast ? list.length - 1 : 0].click()
      return 'action'
    }
    const go = [...document.querySelectorAll('button')]
      .find((x) => x.innerText.toLowerCase().startsWith('выполнить') && !x.disabled)
    if (go) {
      go.click()
      return 'submit'
    }
    return null
  }, last)

/** Нажать кнопку по куску текста. */
const clickText = (needle) =>
  page.evaluate((n) => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => x.innerText.toLowerCase().includes(n))
    if (b) b.click()
    return Boolean(b)
  }, needle.toLowerCase())

// ------------------------------------------------------------- список

await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle0' })
await wait(600)

// Вход: имя без пароля.
check(Boolean(await page.$('input')), 'экран входа показан')
await page.click('input')
await page.type('input', 'Проводник Тест', { delay: 5 })
check(await clickText('заступить на смену'), 'вход по имени')
await wait(900)

const home = await text()
check(/смена/.test(home), 'главный экран — смена')
check(/продолжить смену|заступить на смену/.test(home), 'есть кнопка продолжения смены')
check(/библиотека ситуаций/.test(home), 'библиотека ситуаций на месте')
check(/ситуации на борту/.test(home), 'источник виден до входа в ситуацию')
console.log('Снимки:')
await shot('01-situations')

// -------------------------------------------------------------- ввод

check(await clickText('пассажиру стало плохо'), 'карточка ситуации нажимается')
await wait(600)
const brief = await text()
check(/обстановка/.test(brief) && /что у вас есть/.test(brief),
  'ввод в ситуацию показывает контекст и ресурсы')

await page.evaluate(() => {
  for (const d of document.querySelectorAll('details')) d.open = true
})
await wait(200)
const briefOpen = await text()
check(/следует из источника/.test(briefOpen) && /игровая интерпретация/.test(briefOpen),
  'норматив и игровая интерпретация разделены прямо в интерфейсе')
await shot('02-briefing')

// ---------------------------------------------------------- ситуация

check(await clickText('войти в ситуацию'), 'вход в ситуацию')
await page.waitForFunction(() => location.hash.includes('/play/'), { timeout: 8000 })
await wait(900)

const play = await text()
check(/лояльность/.test(play) && /безопасность/.test(play), 'обе шкалы на экране')
check(/ с$|\d+ с/m.test(play), 'таймер виден')
check(/что вы делаете/.test(play), 'действия предложены')
await shot('03-situation')

const timerBefore = await page.evaluate(() => {
  const m = document.body.innerText.match(/(\d+) с/)
  return m ? Number(m[1]) : null
})
await wait(2500)
const timerAfter = await page.evaluate(() => {
  const m = document.body.innerText.match(/(\d+) с/)
  return m ? Number(m[1]) : null
})
check(timerBefore !== null && timerAfter !== null && timerAfter < timerBefore,
  'таймер действительно идёт', `${timerBefore} → ${timerAfter}`)

// Первое решение — кнопкой.
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button.action')][0]
  if (b) b.click()
})
await wait(900)
const after = await text()
check(/что произошло|решение не принято вовремя/.test(after),
  'последствие показано отдельным экраном')
check(/дальше/.test(after), 'из последствия есть переход дальше')
await shot('04-consequence')

check(await clickText('дальше'), 'переход к следующей ситуации')
await wait(700)
check(/новая информация/.test(await text()), 'ситуация принесла новую информацию')

// ------------------------------------------------- свободная реплика

check(await clickText('ответить своими словами'), 'режим свободного ответа включается')
await wait(400)
check(Boolean(await page.$('textarea')), 'появилось поле для реплики')

await page.click('textarea')
await page.type('textarea', 'ну как-то так', { delay: 5 })
await page.keyboard.press('Enter')
await wait(800)
check(/переспрашивают/.test(await text()),
  'непонятную реплику собеседник переспрашивает')
await shot('05-reask')

await page.click('textarea')
await page.type('textarea', 'вагон четыре, место 14в, мужчина без сознания, дыхание есть', { delay: 5 })
await page.keyboard.press('Enter')
await wait(1000)
check(!/переспрашивают/.test(await text()), 'понятная реплика распознана')
await clickText('дальше')
await wait(700)

// ------------------------------------------------- последовательность

const seqScreen = await text()
check(/расставьте по порядку/.test(seqScreen), 'состояние с последовательностью открылось')
await page.evaluate(() => {
  for (const b of [...document.querySelectorAll('button.action')]) b.click()
})
await wait(300)
check(await clickText('выполнить в этом порядке'), 'порядок отправлен')
await wait(900)
await shot('06-sequence')
await clickText('дальше')
await wait(600)

// --------------------------------------------------------- до финала

let guard = 0
while (guard++ < 20) {
  if (/ситуация закрыта|вышла из-под контроля|издержками/.test(await text())) break
  const did = await advance()
  if (!did) break
  await wait(did === 'action' || did === 'submit' ? 800 : 350)
}
const finale = await text()
check(/ситуация закрыта|вышла из-под контроля|издержками/.test(finale), 'ситуация дошла до финала')
await shot('07-final')

// ----------------------------------------------------------- разбор

check(await clickText('разбор'), 'переход к разбору')
await page.waitForFunction(() => location.hash.includes('/debrief/'), { timeout: 8000 })
await wait(900)

const deb = await text()
check(/решения, которые определили исход/.test(deb), 'разбор показывает ключевые решения')
check(/если бы выбрали иначе/.test(deb), 'показана альтернативная ветка')
check(/что можно иначе/.test(deb), 'разбор говорит, что можно улучшить')
check(/что проявилось/.test(deb), 'показаны компетенции')
check(!/правильный ответ/.test(deb), 'разбор не говорит «правильный ответ»')
await shot('08-debrief')

// --------------------------------------------- возврат к развилке

check(
  /вернуться сюда и решить иначе/.test(deb),
  'в разборе можно вернуться к конкретной развилке'
)
check(await clickText('вернуться сюда и решить иначе'), 'возврат к развилке нажимается')
await page.waitForFunction(() => location.hash.includes('/play/'), { timeout: 8000 })
await wait(900)
const atFork = await text()
check(/что вы делаете|скажите своими словами|расставьте по порядку/.test(atFork),
  'после возврата снова можно действовать')
await shot('11-rewind')

// -------------------------------- прохождение с развилки другой веткой

check(/попытка 2/.test(await text()), 'возврат открыл новую попытку')

// Другая стратегия: берём последнее действие вместо первого.
guard = 0
while (guard++ < 22) {
  if (/ситуация закрыта|вышла из-под контроля|издержками/.test(await text())) break
  const did = await advance(true)
  if (!did) break
  await wait(did === 'action' || did === 'submit' ? 800 : 350)
}
check(await clickText('разбор'), 'разбор второй попытки')
await page.waitForFunction(() => location.hash.includes('/debrief/'), { timeout: 8000 })
await wait(900)
const deb2 = await text()
check(/есть с чем сравнить|сравнить попытки/.test(deb2), 'разбор предлагает сравнение')
check(await clickText('сравнить попытки'), 'переход к сравнению')
await page.waitForFunction(() => location.hash.includes('/compare/'), { timeout: 8000 })
await wait(800)
const cmp = await text()
check(/чем кончилось/.test(cmp), 'экран сравнения показывает исходы')
check(/что вы сделали по-другому/.test(cmp), 'видно, какие решения изменились')
await shot('09-comparison')

// ---------------------------------------------------------- прогресс

await page.goto(`${BASE}/#/progress`, { waitUntil: 'networkidle0' })
await wait(700)
const prog = await text()
check(/компетенции/.test(prog), 'экран прогресса открывается')
check(/прохождения|прохождений|прохождение/.test(prog), 'прогресс учёл попытки')
await shot('10-progress')

// ------------------------------------------------------- узкий экран

check(
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  'на экране шириной 430 px нет горизонтальной прокрутки'
)

await browser.close()

if (errors.length) {
  console.log('')
  console.log('Ошибки в консоли браузера:')
  for (const e of [...new Set(errors)]) console.log(`  ${e}`)
  failed += 1
}

console.log('')
console.log(failed ? `Провалено: ${failed}` : 'Продукт проходится руками от списка до сравнения попыток.')
process.exit(failed ? 1 : 0)
