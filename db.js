/**
 * Data store with two backends:
 *   - Supabase Postgres  when DATABASE_URL is set (state kept in a JSONB row)
 *   - Local JSON file    otherwise (data/store.json) — zero-config for demos
 *
 * The whole app-state object is loaded once and persisted on save(). Swapping to
 * fully-relational tables later doesn't change this module's get()/save() API.
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
    console.error('DB load failed, starting fresh:', err.message);
    return structuredClone(EMPTY);
  }
}

let state = loadFile();   // synchronous default so get() works before init()
let pool = null;
let writeTimer = null;
let writePromise = Promise.resolve(); // serialised DB writes; flush() awaits the latest

function usingPostgres() {
  const url = process.env.DATABASE_URL || '';
  return !!url && !url.includes('[YOUR-PASSWORD]');
}

// Connect to Supabase (if configured) and load the persisted state. Call once at startup.
async function init() {
  if (!usingPostgres()) {
    console.log('[gweno] storage: local file (data/store.json). Set DATABASE_URL to use Supabase.');
    return;
  }
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    await pool.query('CREATE TABLE IF NOT EXISTS app_state (id int PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now())');
    const { rows } = await pool.query('SELECT data FROM app_state WHERE id = 1');
    if (rows.length) {
      state = { ...structuredClone(EMPTY), ...rows[0].data };
    } else {
      state = loadFile(); // first run against Supabase: seed from whatever is local
      await pool.query('INSERT INTO app_state (id, data) VALUES (1, $1)', [state]);
    }
    console.log('[gweno] storage: Supabase Postgres');
  } catch (err) {
    // Don't take the app down if Supabase is unreachable — fall back to the file.
    if (pool) { try { await pool.end(); } catch (_) {} pool = null; }
    state = loadFile();
    console.error(`[gweno] Supabase connection failed (${err.message}). Using local file for now.`);
  }
}

function persist() {
  if (pool) {
    // Serverless-safe: issue the write immediately and chain it so writes never
    // overlap. flush() (called before a response is sent) awaits the latest one,
    // so nothing is lost when the function is frozen after responding.
    writePromise = writePromise
      .catch(() => {})
      .then(() => pool.query('UPDATE app_state SET data = $1, updated_at = now() WHERE id = 1', [state]))
      .catch((err) => console.error('DB write failed:', err.message));
    return;
  }
  // Local file backend: debounce so bursts don't hammer disk.
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    fs.writeFile(DB_FILE, JSON.stringify(state, null, 2), (err) => {
      if (err) console.error('DB write failed:', err.message);
    });
  }, 100);
}

// Wait for any pending write to reach the database (used before responding on serverless).
async function flush() { try { await writePromise; } catch (_) {} }

// Re-read the persisted state from Postgres. On serverless each instance keeps its
// own in-memory copy, so we reload before handling an API request to stay current.
async function reload() {
  if (!pool) return;
  try {
    const { rows } = await pool.query('SELECT data FROM app_state WHERE id = 1');
    if (rows.length) state = { ...structuredClone(EMPTY), ...rows[0].data };
  } catch (err) {
    console.error('DB reload failed:', err.message);
  }
}

module.exports = { init, get: () => state, save: persist, flush, reload };
