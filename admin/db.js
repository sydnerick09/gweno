/**
 * Admin data store — connects to the SAME Supabase Postgres app_state row the main
 * Gweno site uses (one JSONB blob). Reads reload before each request and writes flush
 * after, so the admin app and the member app stay in sync. Falls back to a local file
 * only when DATABASE_URL is unset (dev).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

const EMPTY = {
  users: [], sessions: [], resetTokens: [], attempts: {}, resetRequests: {},
  submissions: [], campaigns: [], redemptions: [], support: [], deposits: [], devices: [],
  adminSessions: [], investments: [], investmentRates: {},
};

function loadFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) return structuredClone(EMPTY);
    const raw = fs.readFileSync(DB_FILE, 'utf8').trim();
    if (!raw) return structuredClone(EMPTY);
    return { ...structuredClone(EMPTY), ...JSON.parse(raw) };
  } catch (err) {
    console.error('[admin] DB load failed, starting fresh:', err.message);
    return structuredClone(EMPTY);
  }
}

let state = loadFile();
let pool = null;
let writeTimer = null;
let writePromise = Promise.resolve();

function usingPostgres() {
  const url = process.env.DATABASE_URL || '';
  return !!url && !url.includes('[YOUR-PASSWORD]');
}

function makePool() {
  const { Pool } = require('pg');
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1, idleTimeoutMillis: 10000, connectionTimeoutMillis: 12000,
    allowExitOnIdle: true, keepAlive: true,
  });
}

async function init() {
  if (!usingPostgres()) {
    console.log('[admin] storage: local file (dev). Set DATABASE_URL to share the live Supabase DB.');
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      pool = makePool();
      await pool.query('CREATE TABLE IF NOT EXISTS app_state (id int PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now())');
      const { rows } = await pool.query('SELECT data FROM app_state WHERE id = 1');
      if (rows.length) state = { ...structuredClone(EMPTY), ...rows[0].data };
      else { state = loadFile(); await pool.query('INSERT INTO app_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [state]); }
      console.log('[admin] storage: Supabase Postgres (shared with the main site)');
      return;
    } catch (err) {
      if (pool) { try { await pool.end(); } catch (_) {} pool = null; }
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 400 * attempt)); continue; }
      state = loadFile();
      console.error(`[admin] Supabase connection failed after ${attempt} tries (${err.message}).`);
    }
  }
}

async function ensurePool() {
  if (pool || !usingPostgres()) return;
  try { pool = makePool(); await pool.query('SELECT 1'); }
  catch (_) { if (pool) { try { await pool.end(); } catch (_) {} pool = null; } }
}

function persist() {
  if (pool) {
    const snapshot = state;
    writePromise = writePromise.catch(() => {})
      .then(() => pool.query('UPDATE app_state SET data = $1, updated_at = now() WHERE id = 1', [snapshot]))
      .catch((err) => console.error('[admin] DB write failed:', err.message));
    return;
  }
  if (writeTimer) return;
  writeTimer = setTimeout(() => { writeTimer = null; fs.writeFile(DB_FILE, JSON.stringify(state, null, 2), () => {}); }, 100);
}

async function flush() { try { await writePromise; } catch (_) {} }

async function reload() {
  await ensurePool();
  if (!pool) return;
  try {
    const { rows } = await pool.query('SELECT data FROM app_state WHERE id = 1');
    if (rows.length) state = { ...structuredClone(EMPTY), ...rows[0].data };
  } catch (err) { console.error('[admin] DB reload failed:', err.message); }
}

module.exports = { init, get: () => state, save: persist, flush, reload, ensurePool };
