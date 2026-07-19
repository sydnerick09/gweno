/** Minimal .env loader (no dependency). Required FIRST in server.js. */
const fs = require('fs');
const path = require('path');
try {
  const file = path.join(__dirname, '.env');
  if (fs.existsSync(file)) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) return;
      let [, key, val] = m;
      val = val.trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = val;
    });
  }
} catch (err) {
  console.error('[admin] .env load failed:', err.message);
}
