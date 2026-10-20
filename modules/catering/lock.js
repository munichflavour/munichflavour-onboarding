// Zusätzlicher Passwortschutz für den Catering-Kalkulator, solange er in Entwicklung ist.
// Zugriff hat nur, wer als Admin angemeldet ist UND das Kalkulator-Passwort eingegeben hat (gilt für die Dauer der Sitzung).
//
// Passwort:
//   - Variable CATERING_PASSWORT im Portal-Dienst setzt ein eigenes Passwort (empfohlen, steht dann nicht im Repository).
//   - Ohne Variable gilt ein eingebautes Standardpasswort. Im Code steht davon nur der Hash, nie das Passwort selbst.
//   - Variable CATERING_OHNE_PASSWORT=1 schaltet die Abfrage ganz ab (wenn der Kalkulator fertig ist).
const crypto = require('crypto');

const SALT = 'mf-catering-v1';
const DEFAULT_HASH = '7c27de61ab378c9aac32fafd3e5e9b5c8645c71c69eb490f37e9b1b32462fca9';
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;

const hash = pw => crypto.scryptSync(String(pw), SALT, 32);
const enabled = () => !['1', 'true'].includes(String(process.env.CATERING_OHNE_PASSWORT || '').toLowerCase());

function expected(override) {
  if (override) return Buffer.from(override, 'hex');
  if (process.env.CATERING_PASSWORT) return hash(process.env.CATERING_PASSWORT);
  return Buffer.from(DEFAULT_HASH, 'hex');
}

// Vergleich in konstanter Zeit; überlange oder falsche Eingaben werden abgelehnt
function check(password, override) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 200) return false;
  return crypto.timingSafeEqual(hash(password), expected(override));
}

// Begrenzung der Fehlversuche (je Benutzer und Adresse), damit das Passwort nicht durchprobiert werden kann
function createLimiter() {
  const tries = new Map();
  const key = req => `${req.session.userId}|${req.ip}`;
  return {
    blockedMinutes(req) {
      const e = tries.get(key(req));
      return e && e.lockedUntil > Date.now() ? Math.ceil((e.lockedUntil - Date.now()) / 60000) : 0;
    },
    fail(req) {
      const k = key(req), now = Date.now();
      const e = tries.get(k);
      if (!e || e.start + WINDOW_MS < now) { tries.set(k, { count: 1, start: now, lockedUntil: 0 }); return; }
      e.count += 1;
      if (e.count >= MAX_FAILS) e.lockedUntil = now + WINDOW_MS;
    },
    clear(req) { tries.delete(key(req)); },
  };
}

module.exports = { check, enabled, createLimiter, hash, DEFAULT_HASH };
