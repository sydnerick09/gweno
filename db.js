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
  magicTokens: [], magicRequests: {},
  submissions: [], campaigns: [], redemptions: [], support: [], deposits: [], devices: [],
  adminSessions: [], investments: [], investmentRates: {}, broadcasts: [],
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

// Serverless-friendly pool: one short-lived connection per instance so many concurrent
// Vercel instances don't exhaust the Supabase pooler (which was refusing some connections
// and dropping those instances to the read-only file store — the cause of the 401 loops).
function makePool() {
  const { Pool } = require('pg');
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 12000,
    allowExitOnIdle: true,
    keepAlive: true,
  });
}

// Connect to Supabase (if configured) and load the persisted state. Call once at startup.
// Retries so a slow cold-start connection doesn't silently drop us to the file store.
async function init() {
  if (!usingPostgres()) {
    console.log('[gweno] storage: local file (data/store.json). Set DATABASE_URL to use Supabase.');
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      pool = makePool();
      await pool.query('CREATE TABLE IF NOT EXISTS app_state (id int PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now())');
      const { rows } = await pool.query('SELECT data FROM app_state WHERE id = 1');
      if (rows.length) {
        state = { ...structuredClone(EMPTY), ...rows[0].data };
      } else {
        state = loadFile(); // first run against Supabase: seed from whatever is local
        await pool.query('INSERT INTO app_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [state]);
      }
      console.log('[gweno] storage: Supabase Postgres');
      return;
    } catch (err) {
      if (pool) { try { await pool.end(); } catch (_) {} pool = null; }
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 400 * attempt)); continue; }
      // Only after retries: fall back to the file so the app still serves reads.
      state = loadFile();
      console.error(`[gweno] Supabase connection failed after ${attempt} tries (${err.message}). Using local file for now.`);
    }
  }
}

// Reconnect on demand: an instance whose cold-start connect failed can recover on a
// later request instead of staying stuck on the read-only file store.
async function ensurePool() {
  if (pool || !usingPostgres()) return;
  try { pool = makePool(); await pool.query('SELECT 1'); }
  catch (_) { if (pool) { try { await pool.end(); } catch (_) {} pool = null; } }
}

function persist() {
  if (pool) {
    // Snapshot the state NOW (at save-time). A later reload() may reassign `state`,
    // but this write must persist what the handler just changed — otherwise a
    // just-created session could be clobbered. flush() awaits the latest write so
    // nothing is lost when the function freezes after responding.
    const snapshot = state;
    writePromise = writePromise
      .catch(() => {})
      .then(() => pool.query('UPDATE app_state SET data = $1, updated_at = now() WHERE id = 1', [snapshot]))
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
  await ensurePool();      // recover this instance's connection if it dropped
  if (!pool) return;
  try {
    const { rows } = await pool.query('SELECT data FROM app_state WHERE id = 1');
    if (rows.length) state = { ...structuredClone(EMPTY), ...rows[0].data };
  } catch (err) {
    console.error('DB reload failed:', err.message);
  }
}

module.exports = { init, get: () => state, save: persist, flush, reload, ensurePool };
