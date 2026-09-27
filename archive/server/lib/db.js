/**
 * Хранилище: SQLite через встроенный в Node модуль `node:sqlite`.
 *
 * Почему именно так. Нужны транзакции, уникальные ключи и агрегаты по узлам
 * графа — на JSONL это писалось бы руками и разъезжалось бы при первой же
 * гонке. При этом ставить внешнюю зависимость с нативной сборкой в контур
 * заказчика ради одной базы не хочется: `node:sqlite` идёт в комплекте
 * с Node 22.5+, поэтому у сервера по-прежнему ноль зависимостей,
 * а база — настоящая, с WAL и внешними ключами.
 *
 * Файл базы лежит в томе, переносится копированием и открывается любым
 * клиентом SQLite при разборе инцидента.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data')
fs.mkdirSync(DATA_DIR, { recursive: true })

const FILE = process.env.DB_FILE || path.join(DATA_DIR, 'ekipazh.sqlite')

export const db = new DatabaseSync(FILE)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    login         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL,
    depot         TEXT NOT NULL DEFAULT '',
    brigade       TEXT NOT NULL DEFAULT '',
    tab_number    TEXT NOT NULL DEFAULT '',
    salt          TEXT NOT NULL,
    hash          TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS scenarios (
    id           TEXT NOT NULL,
    version      INTEGER NOT NULL,
    status       TEXT NOT NULL,
    title        TEXT NOT NULL,
    summary      TEXT NOT NULL DEFAULT '',
    mode         TEXT NOT NULL DEFAULT 'leg',
    difficulty   INTEGER NOT NULL DEFAULT 3,
    competencies TEXT NOT NULL DEFAULT '[]',
    json         TEXT NOT NULL,
    author_id    TEXT,
    created_at   INTEGER NOT NULL,
    published_at INTEGER,
    PRIMARY KEY (id, version)
  );

  CREATE TABLE IF NOT EXISTS runs (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scenario_id      TEXT NOT NULL,
    scenario_version INTEGER NOT NULL,
    mode             TEXT NOT NULL,
    status           TEXT NOT NULL,
    started_at       INTEGER,
    finished_at      INTEGER,
    score            INTEGER NOT NULL DEFAULT 0,
    max_score        INTEGER NOT NULL DEFAULT 0,
    score_pct        INTEGER NOT NULL DEFAULT 0,
    safety           INTEGER, loyalty INTEGER, car_mood INTEGER, stress_peak INTEGER,
    trip_sec         INTEGER, lost_sec INTEGER,
    sop_matched      INTEGER, sop_total INTEGER,
    verdict          TEXT,
    competency       TEXT NOT NULL DEFAULT '{}',
    achievements     TEXT NOT NULL DEFAULT '[]',
    path             TEXT NOT NULL DEFAULT '{}',
    rejected         TEXT NOT NULL DEFAULT '[]',
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS runs_user ON runs(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS runs_scenario ON runs(scenario_id, scenario_version);

  CREATE TABLE IF NOT EXISTS user_achievements (
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL,
    run_id         TEXT,
    at             INTEGER NOT NULL,
    PRIMARY KEY (user_id, achievement_id)
  );

  CREATE TABLE IF NOT EXISTS srs (
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scenario_id    TEXT NOT NULL,
    box            INTEGER NOT NULL DEFAULT 0,
    due_at         INTEGER NOT NULL,
    last_score_pct INTEGER NOT NULL DEFAULT 0,
    last_at        INTEGER NOT NULL,
    PRIMARY KEY (user_id, scenario_id)
  );

  CREATE TABLE IF NOT EXISTS node_stats (
    scenario_id TEXT NOT NULL,
    version     INTEGER NOT NULL,
    node_id     TEXT NOT NULL,
    choice_id   TEXT NOT NULL,
    count       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (scenario_id, version, node_id, choice_id)
  );

  CREATE TABLE IF NOT EXISTS duels (
    id          TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL,
    from_user   TEXT NOT NULL,
    to_user     TEXT NOT NULL,
    from_run    TEXT,
    to_run      TEXT,
    comment     TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    closed_at   INTEGER
  );

  CREATE TABLE IF NOT EXISTS assignments (
    id          TEXT PRIMARY KEY,
    target_type TEXT NOT NULL,
    target      TEXT NOT NULL,
    scenario_id TEXT NOT NULL,
    due_at      INTEGER,
    created_by  TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    at     INTEGER NOT NULL,
    actor  TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  );
`)

export const uid = (prefix = '') => prefix + crypto.randomBytes(9).toString('base64url')
export const now = () => Date.now()

const J = (v, fallback) => {
  try {
    return JSON.parse(v)
  } catch {
    return fallback
  }
}

/**
 * Служебные пометки об установке.
 *
 * Нужны, чтобы интерфейс не гадал о состоянии базы: например, показывать ли
 * блок демонстрационных учёток. Никаких секретов здесь не хранится.
 */
export const meta = {
  get: (key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null,
  set: (key, value) =>
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value))
}

/** Одна точка записи в журнал действий: кто, что и когда сделал. */
export function audit(actor, action, detail = '') {
  db.prepare('INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)')
    .run(now(), String(actor ?? ''), String(action), String(detail).slice(0, 500))
}

// ---------------------------------------------------------------- люди

export const users = {
  byLogin: (login) => db.prepare('SELECT * FROM users WHERE login = ?').get(login),
  byId: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
  all: () => db.prepare('SELECT * FROM users ORDER BY role, name').all(),
  byRole: (role) => db.prepare('SELECT * FROM users WHERE role = ? ORDER BY name').all(role),
  create(u) {
    db.prepare(`
      INSERT INTO users (id, login, name, role, depot, brigade, tab_number, salt, hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(u.id, u.login, u.name, u.role, u.depot ?? '', u.brigade ?? '', u.tabNumber ?? '',
      u.salt, u.hash, now())
    return users.byId(u.id)
  },
  touch: (id) => db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), id)
}

/** Наружу уходит всё, кроме соли и хеша. */
export const publicUser = (u) => u && ({
  id: u.id, login: u.login, name: u.name, role: u.role,
  depot: u.depot, brigade: u.brigade, tabNumber: u.tab_number
})

// ------------------------------------------------------------ сценарии

export const scenarios = {
  published: () =>
    db.prepare(`
      SELECT s.* FROM scenarios s
      JOIN (SELECT id, MAX(version) AS v FROM scenarios WHERE status = 'published' GROUP BY id) m
        ON s.id = m.id AND s.version = m.v
      ORDER BY s.difficulty, s.id
    `).all().map(rowToScenario),

  /** Все версии всех сценариев — список для методиста. */
  allVersions: () =>
    db.prepare('SELECT id, version, status, title, summary, difficulty, created_at, published_at FROM scenarios ORDER BY id, version DESC')
      .all(),

  latest(id) {
    const row = db.prepare('SELECT * FROM scenarios WHERE id = ? ORDER BY version DESC LIMIT 1').get(id)
    return row ? rowToScenario(row) : null
  },

  publishedById(id) {
    const row = db.prepare(`
      SELECT * FROM scenarios WHERE id = ? AND status = 'published'
      ORDER BY version DESC LIMIT 1
    `).get(id)
    return row ? rowToScenario(row) : null
  },

  exact(id, version) {
    const row = db.prepare('SELECT * FROM scenarios WHERE id = ? AND version = ?').get(id, version)
    return row ? rowToScenario(row) : null
  },

  /** Публикация всегда создаёт новую версию: опубликованное не меняется под теми, кто уже играет. */
  save(scenario, authorId, status = 'published') {
    const prev = db.prepare('SELECT MAX(version) AS v FROM scenarios WHERE id = ?').get(scenario.id)
    const version = (prev?.v ?? 0) + 1
    const doc = { ...scenario, version, status }
    db.prepare(`
      INSERT INTO scenarios (id, version, status, title, summary, mode, difficulty,
                             competencies, json, author_id, created_at, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      doc.id, version, status, doc.title, doc.summary ?? '', doc.mode ?? 'leg',
      doc.difficulty ?? 3, JSON.stringify(doc.competencies ?? []), JSON.stringify(doc),
      authorId ?? null, now(), status === 'published' ? now() : null
    )
    return doc
  }
}

function rowToScenario(row) {
  const doc = J(row.json, null)
  if (!doc) return null
  doc.version = row.version
  doc.status = row.status
  return doc
}

// -------------------------------------------------------------- рейсы

export const runs = {
  insert(r) {
    db.prepare(`
      INSERT INTO runs (id, user_id, scenario_id, scenario_version, mode, status,
        started_at, finished_at, score, max_score, score_pct,
        safety, loyalty, car_mood, stress_peak, trip_sec, lost_sec,
        sop_matched, sop_total, verdict, competency, achievements, path, rejected, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      r.id, r.userId, r.scenarioId, r.scenarioVersion, r.mode, r.status,
      r.startedAt ?? null, r.finishedAt ?? null, r.score, r.maxScore, r.scorePct,
      r.safety ?? null, r.loyalty ?? null, r.carMood ?? null, r.stressPeak ?? null,
      r.tripSec ?? null, r.lostSec ?? null, r.sopMatched ?? null, r.sopTotal ?? null,
      r.verdict ?? '', JSON.stringify(r.competencyPct ?? {}),
      JSON.stringify(r.achievements ?? []), JSON.stringify(r.path ?? {}),
      JSON.stringify(r.rejected ?? []), now()
    )
  },

  byId: (id) => rowToRun(db.prepare('SELECT * FROM runs WHERE id = ?').get(id)),

  ofUser: (userId, limit = 50) =>
    db.prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit).map(rowToRun),

  countOfUser: (userId) =>
    db.prepare("SELECT COUNT(*) AS n FROM runs WHERE user_id = ? AND status = 'scored'").get(userId)?.n ?? 0,

  daysOfUser: (userId) =>
    db.prepare('SELECT DISTINCT created_at FROM runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 400')
      .all(userId).map((r) => r.created_at)
}

function rowToRun(row) {
  if (!row) return null
  return {
    id: row.id, userId: row.user_id, scenarioId: row.scenario_id,
    scenarioVersion: row.scenario_version, mode: row.mode, status: row.status,
    startedAt: row.started_at, finishedAt: row.finished_at,
    score: row.score, maxScore: row.max_score, scorePct: row.score_pct,
    safety: row.safety, loyalty: row.loyalty, carMood: row.car_mood,
    stressPeak: row.stress_peak, tripSec: row.trip_sec, lostSec: row.lost_sec,
    sopMatched: row.sop_matched, sopTotal: row.sop_total, verdict: row.verdict,
    competencyPct: J(row.competency, {}), achievements: J(row.achievements, []),
    path: J(row.path, {}), rejected: J(row.rejected, []), createdAt: row.created_at
  }
}

// -------------------------------------------------------- достижения

export const achievements = {
  ofUser: (userId) =>
    db.prepare('SELECT achievement_id, at FROM user_achievements WHERE user_id = ? ORDER BY at')
      .all(userId).map((r) => ({ id: r.achievement_id, at: r.at })),

  grant(userId, ids, runId) {
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, run_id, at) VALUES (?, ?, ?, ?)'
    )
    const fresh = []
    for (const id of ids) {
      const before = db.prepare(
        'SELECT 1 AS x FROM user_achievements WHERE user_id = ? AND achievement_id = ?'
      ).get(userId, id)
      stmt.run(userId, id, runId, now())
      if (!before) fresh.push(id)
    }
    return fresh
  },

  countOfUser: (userId) =>
    db.prepare('SELECT COUNT(*) AS n FROM user_achievements WHERE user_id = ?').get(userId)?.n ?? 0
}

// -------------------------------------------------- интервальное повторение

export const srs = {
  ofUser: (userId) =>
    db.prepare('SELECT * FROM srs WHERE user_id = ?').all(userId).map((r) => ({
      scenarioId: r.scenario_id, box: r.box, dueAt: r.due_at,
      lastScorePct: r.last_score_pct, lastAt: r.last_at
    })),

  upsert(userId, scenarioId, box, dueAt, scorePct) {
    db.prepare(`
      INSERT INTO srs (user_id, scenario_id, box, due_at, last_score_pct, last_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, scenario_id) DO UPDATE SET
        box = excluded.box, due_at = excluded.due_at,
        last_score_pct = excluded.last_score_pct, last_at = excluded.last_at
    `).run(userId, scenarioId, box, dueAt, scorePct, now())
  }
}

// ------------------------------------------------- статистика по графу

export const nodeStats = {
  bump(scenarioId, version, entries) {
    const stmt = db.prepare(`
      INSERT INTO node_stats (scenario_id, version, node_id, choice_id, count)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(scenario_id, version, node_id, choice_id)
      DO UPDATE SET count = count + 1
    `)
    for (const e of entries) {
      if (e.timeout) {
        stmt.run(scenarioId, version, e.node, '(таймаут)')
        continue
      }
      if (!e.picked?.length) {
        stmt.run(scenarioId, version, e.node, '(нет)')
        continue
      }
      // У одиночного выбора отмеченный вариант один — он и есть ветка.
      // У множественного каждый отмеченный элемент считается отдельно:
      // методисту важно знать, какой пункт чаще всего забывают, а не какой
      // случайно оказался первым в списке.
      for (const el of e.picked) stmt.run(scenarioId, version, e.node, el.id)
    }
  },

  forScenario: (scenarioId, version) =>
    db.prepare(`
      SELECT node_id, choice_id, count FROM node_stats
      WHERE scenario_id = ? AND version = ? ORDER BY node_id, count DESC
    `).all(scenarioId, version)
}

// -------------------------------------------------------------- дуэли

export const duels = {
  create(d) {
    db.prepare(`
      INSERT INTO duels (id, scenario_id, from_user, to_user, from_run, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(d.id, d.scenarioId, d.fromUser, d.toUser, d.fromRun ?? null, now())
  },
  forUser: (userId) =>
    db.prepare(`
      SELECT * FROM duels WHERE from_user = ? OR to_user = ? ORDER BY created_at DESC LIMIT 50
    `).all(userId, userId),
  close(id, toRun, comment) {
    db.prepare('UPDATE duels SET to_run = ?, comment = ?, closed_at = ? WHERE id = ?')
      .run(toRun, String(comment ?? '').slice(0, 800), now(), id)
  },
  reviewedBy: (userId) =>
    db.prepare("SELECT COUNT(*) AS n FROM duels WHERE to_user = ? AND comment <> ''").get(userId)?.n ?? 0
}

// ------------------------------------------------------------ рейтинг

/**
 * Сезон рейтинга — календарный месяц.
 *
 * Обнуление раз в месяц нужно не для красоты: без него верхние строчки
 * навсегда занимают те, кто пришёл первым, и у новичка нет причин играть.
 */
export const seasonOf = (ts = now()) => new Date(ts).toISOString().slice(0, 7)

export const leaderboard = {
  /**
   * Личный зачёт. В публичной таблице показываются только суммирующиеся
   * величины: сколько рейсов, средний процент, серия, ачивки. Ни одной
   * строки о том, что у человека провалено, — это видит он сам и наставник.
   */
  personal(season, limit = 50) {
    const from = Date.parse(`${season}-01T00:00:00Z`)
    const to = new Date(from)
    to.setUTCMonth(to.getUTCMonth() + 1)
    return db.prepare(`
      SELECT u.id, u.name, u.depot, u.brigade,
             COUNT(r.id) AS runs,
             ROUND(AVG(r.score_pct)) AS avg_pct,
             MAX(r.score_pct) AS best_pct,
             SUM(r.score) AS total
      FROM runs r JOIN users u ON u.id = r.user_id
      WHERE r.status = 'scored' AND r.created_at >= ? AND r.created_at < ?
      GROUP BY u.id
      ORDER BY total DESC, avg_pct DESC
      LIMIT ?
    `).all(from, to.getTime(), limit)
  },

  /** Командный зачёт — основной. Проводники работают бригадами. */
  brigades(season, limit = 30) {
    const from = Date.parse(`${season}-01T00:00:00Z`)
    const to = new Date(from)
    to.setUTCMonth(to.getUTCMonth() + 1)
    return db.prepare(`
      SELECT u.depot, u.brigade,
             COUNT(DISTINCT u.id) AS people,
             COUNT(r.id) AS runs,
             ROUND(AVG(r.score_pct)) AS avg_pct,
             SUM(r.score) AS total
      FROM runs r JOIN users u ON u.id = r.user_id
      WHERE r.status = 'scored' AND r.created_at >= ? AND r.created_at < ?
            AND u.brigade <> ''
      GROUP BY u.depot, u.brigade
      ORDER BY avg_pct DESC, runs DESC
      LIMIT ?
    `).all(from, to.getTime(), limit)
  }
}

export function isEmpty() {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get()?.n ?? 0) === 0
}
