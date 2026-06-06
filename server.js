/**
 * server.js — Spatial AI Explorer Auth Backend
 * Stack: Node.js + Express + PostgreSQL (pg) + bcrypt + JWT
 *
 * Endpoints:
 *   POST /api/auth/register
 *   POST /api/auth/login
 *   POST /api/auth/verify-2fa
 *   POST /api/auth/forgot-password
 *   POST /api/auth/refresh
 *   GET  /api/auth/me          (protected)
 *   POST /api/auth/logout
 *
 * Run:  node server.js
 * Env:  copy .env.example → .env and fill values
 */

import express                from 'express';
import cors                   from 'cors';
import helmet                 from 'helmet';
import rateLimit              from 'express-rate-limit';
import cookieParser           from 'cookie-parser';
import bcrypt                 from 'bcryptjs';
import jwt                    from 'jsonwebtoken';
import { v4 as uuidv4 }       from 'uuid';
import path                   from 'path';
import { fileURLToPath }      from 'url';

// ── PostgreSQL pool ──────────────────────────────────────────────
import pkg from 'pg';
const { Pool } = pkg;

import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ════════════════════════════════════════════════════════════════
//  DATABASE POOL
// ════════════════════════════════════════════════════════════════
const pool = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  port:     parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'spatial_ai',
  user:     process.env.PG_USER     || 'postgres',
  password: process.env.PG_PASSWORD || '',
  ssl: process.env.PG_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// ════════════════════════════════════════════════════════════════
//  DB BOOTSTRAP  — run once on startup
// ════════════════════════════════════════════════════════════════
async function initDB() {
  // EXTENSION for UUID generation (PostgreSQL ≥ 13 has gen_random_uuid() built in)
  await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

  // ── users table ────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      name           TEXT        NOT NULL,
      email          TEXT        NOT NULL UNIQUE,
      password_hash  TEXT,                          -- null for OAuth-only users
      avatar_url     TEXT,
      provider       TEXT        DEFAULT 'email',   -- 'email' | 'google' | 'github'
      provider_id    TEXT,
      email_verified BOOLEAN     DEFAULT FALSE,
      twofa_enabled  BOOLEAN     DEFAULT FALSE,
      twofa_secret   TEXT,
      role           TEXT        DEFAULT 'user',    -- 'user' | 'admin'
      last_login_at  TIMESTAMPTZ,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── refresh tokens table ───────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT        NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── otp codes (for 2FA / password reset) ──────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash  TEXT        NOT NULL,
      purpose    TEXT        NOT NULL,   -- '2fa' | 'reset'
      expires_at TIMESTAMPTZ NOT NULL,
      used       BOOLEAN     DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── sessions table (optional extended audit) ───────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── indexes ────────────────────────────────────────────────────
  await query(`CREATE INDEX IF NOT EXISTS idx_users_email       ON users(email)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_refresh_user      ON refresh_tokens(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_otp_user          ON otp_codes(user_id)`);

  console.log('[DB] Tables ready ✓');
}

// ════════════════════════════════════════════════════════════════
//  EXPRESS APP
// ════════════════════════════════════════════════════════════════
const app = express();

// ── Security headers ───────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // handled by HTML meta tags
}));

// ── CORS ───────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());

// ── Serve static frontend ───────────────────────────────────────
app.use(express.static(path.join(__dirname, '.'), {
  index: 'index.html',
  extensions: ['html'],
}));

// ── Rate limiters ──────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests — try again in 15 minutes.' },
});

const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { message: 'Too many attempts — try again in an hour.' },
});

// ════════════════════════════════════════════════════════════════
//  JWT HELPERS
// ════════════════════════════════════════════════════════════════
const JWT_SECRET          = process.env.JWT_SECRET          || 'change-me-to-a-long-random-secret';
const JWT_REFRESH_SECRET  = process.env.JWT_REFRESH_SECRET  || 'change-me-refresh-secret';
const ACCESS_TTL          = '15m';   // short-lived
const REFRESH_TTL_DAYS    = 30;

function signAccess(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

function signRefresh(payload) {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: `${REFRESH_TTL_DAYS}d` });
}

function verifyAccess(token) {
  return jwt.verify(token, JWT_SECRET);
}

function verifyRefresh(token) {
  return jwt.verify(token, JWT_REFRESH_SECRET);
}

// ── Auth middleware ────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Unauthorised' });
  try {
    req.user = verifyAccess(token);
    next();
  } catch {
    res.status(401).json({ message: 'Token expired or invalid' });
  }
}

// ── Cookie helper ──────────────────────────────────────────────
function setRefreshCookie(res, token) {
  res.cookie('sai_refresh', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
    maxAge:   REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
    path:     '/api/auth',
  });
}

// ── OTP helper ─────────────────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
}

// Simulated email send (replace with nodemailer / SendGrid / Resend)
async function sendEmail({ to, subject, text }) {
  console.log(`[Email] → ${to} | Subject: ${subject}\n${text}`);
  // TODO: replace with real email provider:
  // import nodemailer from 'nodemailer';
  // const transporter = nodemailer.createTransport({ ... });
  // await transporter.sendMail({ from: 'noreply@yzonic.com', to, subject, text });
}

// ════════════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════════════

// ── POST /api/auth/register ─────────────────────────────────────
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validate
    if (!name || typeof name !== 'string' || name.trim().length < 2)
      return res.status(400).json({ message: 'Name must be at least 2 characters.' });

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRe.test(email))
      return res.status(400).json({ message: 'Invalid email address.' });

    if (!password || password.length < 8)
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });

    // Check duplicate
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length)
      return res.status(409).json({ message: 'An account with that email already exists.' });

    // Hash password
    const hash = await bcrypt.hash(password, 12);

    // Insert user
    const { rows } = await query(
      `INSERT INTO users (name, email, password_hash, provider)
       VALUES ($1, $2, $3, 'email')
       RETURNING id, name, email, role, created_at`,
      [name.trim(), email.toLowerCase(), hash]
    );
    const user = rows[0];

    // Issue tokens
    const accessToken  = signAccess({ sub: user.id, email: user.email, role: user.role });
    const refreshToken = signRefresh({ sub: user.id });
    const refreshHash  = await bcrypt.hash(refreshToken, 10);
    const expiresAt    = new Date(Date.now() + REFRESH_TTL_DAYS * 86400000);

    await query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshHash, expiresAt]
    );

    // Log session
    await query(
      'INSERT INTO sessions (user_id, ip_address, user_agent) VALUES ($1, $2, $3)',
      [user.id, req.ip, req.headers['user-agent']]
    );

    setRefreshCookie(res, refreshToken);

    return res.status(201).json({
      token: accessToken,
      name:  user.name,
      email: user.email,
      role:  user.role,
    });

  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ message: 'Server error — please try again.' });
  }
});

// ── POST /api/auth/login ────────────────────────────────────────
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: 'Email and password required.' });

    const { rows } = await query(
      'SELECT id, name, email, password_hash, role, twofa_enabled FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (!rows.length)
      return res.status(401).json({ message: 'Invalid email or password.' });

    const user = rows[0];

    if (!user.password_hash)
      return res.status(401).json({ message: 'This account uses social login. Please use Google or GitHub.' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ message: 'Invalid email or password.' });

    // Update last login
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    // If 2FA is enabled, issue a short-lived pre-auth token and send OTP
    if (user.twofa_enabled) {
      const otp  = generateOTP();
      const hash = await bcrypt.hash(otp, 10);
      const exp  = new Date(Date.now() + 10 * 60 * 1000); // 10 min

      await query(
        `INSERT INTO otp_codes (user_id, code_hash, purpose, expires_at)
         VALUES ($1, $2, '2fa', $3)`,
        [user.id, hash, exp]
      );

      await sendEmail({
        to:      user.email,
        subject: 'Your Spatial AI verification code',
        text:    `Your one-time code is: ${otp}\n\nExpires in 10 minutes. Do not share it.`
      });

      // Return a short-lived partial token (no full auth scope)
      const partial = signAccess({ sub: user.id, email: user.email, role: user.role, partial: true });
      return res.json({ twofa_required: true, token: partial });
    }

    // Full login
    const accessToken  = signAccess({ sub: user.id, email: user.email, role: user.role });
    const refreshToken = signRefresh({ sub: user.id });
    const refreshHash  = await bcrypt.hash(refreshToken, 10);
    const expiresAt    = new Date(Date.now() + REFRESH_TTL_DAYS * 86400000);

    await query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshHash, expiresAt]
    );
    await query(
      'INSERT INTO sessions (user_id, ip_address, user_agent) VALUES ($1, $2, $3)',
      [user.id, req.ip, req.headers['user-agent']]
    );

    setRefreshCookie(res, refreshToken);

    return res.json({
      token: accessToken,
      name:  user.name,
      email: user.email,
      role:  user.role,
    });

  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ message: 'Server error — please try again.' });
  }
});

// ── POST /api/auth/verify-2fa ───────────────────────────────────
app.post('/api/auth/verify-2fa', authLimiter, async (req, res) => {
  try {
    const { token, code } = req.body;
    if (!token || !code) return res.status(400).json({ message: 'Token and code required.' });

    let payload;
    try { payload = verifyAccess(token); } catch { return res.status(401).json({ message: 'Session expired. Please sign in again.' }); }

    if (!payload.partial) return res.status(400).json({ message: 'Invalid 2FA flow.' });

    // Fetch latest unused OTP
    const { rows } = await query(
      `SELECT id, code_hash FROM otp_codes
       WHERE user_id = $1 AND purpose = '2fa' AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [payload.sub]
    );
    if (!rows.length) return res.status(401).json({ message: 'Code expired or not found. Request a new one.' });

    const match = await bcrypt.compare(code, rows[0].code_hash);
    if (!match) return res.status(401).json({ message: 'Incorrect code.' });

    // Mark OTP used
    await query('UPDATE otp_codes SET used = TRUE WHERE id = $1', [rows[0].id]);

    // Issue full tokens
    const accessToken  = signAccess({ sub: payload.sub, email: payload.email, role: payload.role });
    const refreshToken = signRefresh({ sub: payload.sub });
    const refreshHash  = await bcrypt.hash(refreshToken, 10);
    const expiresAt    = new Date(Date.now() + REFRESH_TTL_DAYS * 86400000);

    await query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [payload.sub, refreshHash, expiresAt]
    );

    setRefreshCookie(res, refreshToken);
    return res.json({ token: accessToken });

  } catch (err) {
    console.error('[verify-2fa]', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ── POST /api/auth/forgot-password ─────────────────────────────
app.post('/api/auth/forgot-password', strictLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required.' });

    // Always return OK to prevent user enumeration
    const { rows } = await query('SELECT id, name FROM users WHERE email = $1', [email.toLowerCase()]);
    if (rows.length) {
      const user = rows[0];
      const otp  = generateOTP();
      const hash = await bcrypt.hash(otp, 10);
      const exp  = new Date(Date.now() + 30 * 60 * 1000); // 30 min

      await query(
        `INSERT INTO otp_codes (user_id, code_hash, purpose, expires_at)
         VALUES ($1, $2, 'reset', $3)`,
        [user.id, hash, exp]
      );

      await sendEmail({
        to:      email,
        subject: 'Reset your Spatial AI password',
        text:    `Hi ${user.name},\n\nYour password reset code is: ${otp}\n\nThis expires in 30 minutes.`
      });
    }

    return res.json({ message: 'If that email exists, a reset code has been sent.' });

  } catch (err) {
    console.error('[forgot-password]', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ── POST /api/auth/refresh ─────────────────────────────────────
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies.sai_refresh;
    if (!refreshToken) return res.status(401).json({ message: 'No refresh token.' });

    let payload;
    try { payload = verifyRefresh(refreshToken); } catch { return res.status(401).json({ message: 'Refresh token expired.' }); }

    // Validate token exists in DB (rotation check)
    const { rows } = await query(
      'SELECT id, token_hash FROM refresh_tokens WHERE user_id = $1 AND expires_at > NOW()',
      [payload.sub]
    );
    let found = false;
    for (const row of rows) {
      if (await bcrypt.compare(refreshToken, row.token_hash)) { found = true; break; }
    }
    if (!found) return res.status(401).json({ message: 'Refresh token invalid.' });

    // Fetch user
    const { rows: users } = await query('SELECT id, email, role FROM users WHERE id = $1', [payload.sub]);
    if (!users.length) return res.status(401).json({ message: 'User not found.' });

    const user = users[0];
    const newAccess  = signAccess({ sub: user.id, email: user.email, role: user.role });
    const newRefresh = signRefresh({ sub: user.id });
    const newHash    = await bcrypt.hash(newRefresh, 10);
    const expiresAt  = new Date(Date.now() + REFRESH_TTL_DAYS * 86400000);

    // Rotate — delete old, insert new
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [user.id]);
    await query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, newHash, expiresAt]
    );

    setRefreshCookie(res, newRefresh);
    return res.json({ token: newAccess });

  } catch (err) {
    console.error('[refresh]', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────────
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, name, email, avatar_url, role, email_verified, twofa_enabled, created_at FROM users WHERE id = $1',
      [req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ message: 'User not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[me]', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ── POST /api/auth/logout ──────────────────────────────────────
app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.sub]);
    res.clearCookie('sai_refresh', { path: '/api/auth' });
    res.json({ message: 'Logged out.' });
  } catch (err) {
    console.error('[logout]', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ── 404 fallback ────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ message: 'API route not found.' });
  }
  // SPA fallback
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Global error handler ───────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[server]', err.message);
  res.status(500).json({ message: 'Internal server error.' });
});

// ════════════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════════════
const PORT = parseInt(process.env.PORT || '3000');

async function start() {
  try {
    await initDB();
    app.listen(PORT, () => {
      console.log(`\n🚀 Spatial AI server running on http://localhost:${PORT}`);
      console.log(`   Auth API:  http://localhost:${PORT}/api/auth`);
      console.log(`   Frontend:  http://localhost:${PORT}/index.html\n`);
    });
  } catch (err) {
    console.error('[startup] Fatal error:', err);
    process.exit(1);
  }
}

start();