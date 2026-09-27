/**
 * Хранилище.
 *
 * SQLite через встроенный в Node модуль — без внешних зависимостей и без
 * шага генерации схемы. Для продукта такого размера это честнее, чем
 * полноценный ORM: таблиц три, запросов десяток, и все они видны глазами.
 *
 * Что здесь важно по сути: в базе лежит **состояние сессии целиком**, как
 * его посчитал движок. Клиент не присылает состояние и не может его
 * подправить — он присылает только намерение, а состояние читается отсюда.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const FILE = process.env.DB_FILE || 'data/smena400.db'

fs.mkdirSync(path.dirname(FILE), { recursive: true })

export const db = new DatabaseSync(FILE)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS players (
    id           TEXT PRIMARY KEY,
    created_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id               TEXT PRIMARY KEY,
    player_id        TEXT NOT NULL REFERENCES players(id),
    scenario_id      TEXT NOT NULL,
    scenario_version INTEGER NOT NULL,
    attempt_no       INTEGER NOT NULL,
    status           TEXT NOT NULL,          -- active | finished | abandoned
    state            TEXT NOT NULL,          -- сессия движка целиком
    outcome          TEXT,
    verdict          TEXT,
    loyalty          INTEGER,
    safety           INTEGER,
    debrief          TEXT,
    started_at       TEXT NOT NULL,
    finished_at      TEXT
  );

  CREATE INDEX IF NOT EXISTS runs_player ON runs(player_id, scenario_id, attempt_no);
  CREATE INDEX IF NOT EXISTS runs_status ON runs(player_id, status);
`)

const now = () => new Date().toISOString()
const J = (s, fallback = null) => {
  try {
    return JSON.parse(s)
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------- игроки

export const players = {
  /**
   * Игрок заводится молча при первом заходе.
   *
   * Логина в продукте нет сознательно: тренажёр решает задачу обучения,
   * а не учёта персонала, и требование «сложную авторизацию не делать»
   * стоит в задании прямым текстом. Идентификатор живёт в куке
   * и ни к каким персональным данным не привязан.
   */
  ensure(id) {
    const row = db.prepare('SELECT id FROM players WHERE id = ?').get(id)
    if (row) {
      db.prepare('UPDATE players SET last_seen_at = ? WHERE id = ?').run(now(), id)
      return id
    }
    db.prepare('INSERT INTO players (id, created_at, last_seen_at) VALUES (?, ?, ?)')
      .run(id, now(), now())
    return id
  }
}

// ---------------------------------------------------------------- рейсы

export const runs = {
  create({ id, playerId, scenarioId, scenarioVersion, state }) {
    const prev = db
      .prepare('SELECT MAX(attempt_no) AS n FROM runs WHERE player_id = ? AND scenario_id = ?')
      .get(playerId, scenarioId)
    const attempt = (prev?.n ?? 0) + 1
    db.prepare(`
      INSERT INTO runs (id, player_id, scenario_id, scenario_version, attempt_no,
                        status, state, started_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, playerId, scenarioId, scenarioVersion, attempt, JSON.stringify(state), now())
    return { id, attempt }
  },

  byId(id) {
    const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id)
    return row ? hydrate(row) : null
  },

  /** Сохранение хода. Состояние всегда пишется целиком — это дешевле путаницы. */
  save(id, state) {
    db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(JSON.stringify(state), id)
  },

  finish(id, { state, debrief }) {
    db.prepare(`
      UPDATE runs SET status = 'finished', state = ?, outcome = ?, verdict = ?,
                      loyalty = ?, safety = ?, debrief = ?, finished_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(state),
      state.outcome ?? null,
      debrief.outcome.verdict,
      state.scales.loyalty,
      state.scales.safety,
      JSON.stringify(debrief),
      now(),
      id
    )
  },

  /** Брошенные прохождения не удаляются: по ним видно, где люди выходят. */
  abandon(id, state) {
    db.prepare("UPDATE runs SET status = 'abandoned', state = ?, finished_at = ? WHERE id = ?")
      .run(JSON.stringify(state), now(), id)
  },

  /** Активная сессия игрока по сценарию — чтобы не плодить брошенные. */
  activeOf(playerId, scenarioId) {
    const row = db.prepare(`
      SELECT * FROM runs
      WHERE player_id = ? AND scenario_id = ? AND status = 'active'
      ORDER BY started_at DESC LIMIT 1
    `).get(playerId, scenarioId)
    return row ? hydrate(row) : null
  },

  finishedOf(playerId, scenarioId) {
    return db.prepare(`
      SELECT * FROM runs
      WHERE player_id = ? AND scenario_id = ? AND status = 'finished'
      ORDER BY attempt_no ASC
    `).all(playerId, scenarioId).map(hydrate)
  },

  allFinished(playerId) {
    return db.prepare(`
      SELECT * FROM runs WHERE player_id = ? AND status = 'finished'
      ORDER BY finished_at DESC
    `).all(playerId).map(hydrate)
  }
}

function hydrate(row) {
  return {
    id: row.id,
    playerId: row.player_id,
    scenarioId: row.scenario_id,
    scenarioVersion: row.scenario_version,
    attempt: row.attempt_no,
    status: row.status,
    state: J(row.state),
    outcome: row.outcome,
    verdict: row.verdict,
    loyalty: row.loyalty,
    safety: row.safety,
    debrief: row.debrief ? J(row.debrief) : null,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  }
}

export const isEmpty = () =>
  (db.prepare('SELECT COUNT(*) AS n FROM players').get()?.n ?? 0) === 0
