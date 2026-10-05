import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import clipboardy from 'clipboardy';
import notifier from 'node-notifier';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_HISTORY = 200;

const configDir = path.join(os.homedir(), '.config', 'clipbridge');
const tokenPath = path.join(configDir, 'token');

function loadOrCreateToken() {
  if (fs.existsSync(tokenPath)) {
    return fs.readFileSync(tokenPath, 'utf8').trim();
  }
  fs.mkdirSync(configDir, { recursive: true });
  const token = crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(tokenPath, token, { mode: 0o600 });
  return token;
}

const TOKEN = loadOrCreateToken();

const app = express();
app.use(express.json({ limit: '2mb' }));

// Serve the built React app (vite build -> public/)
app.use(express.static(path.join(ROOT, 'public'), { index: false }));

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const query = req.query.k;
  const token = bearer || query;
  if (!token || token !== TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

let history = [];

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/send', auth, async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (!text.trim()) {
    return res.status(400).json({ error: 'empty text' });
  }
  try {
    await clipboardy.write(text);
  } catch (err) {
    console.error('clipboard write failed:', err.message);
    return res.status(500).json({ error: 'clipboard write failed: ' + err.message });
  }
  // UUID so ids stay unique across server restarts (seq reused and collided in the UI).
  const entry = { id: crypto.randomUUID(), text, at: Date.now() };
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.pop();

  const preview = text.length > 80 ? text.slice(0, 77) + '…' : text;
  try {
    notifier.notify({
      title: 'ClipBridge',
      message: preview,
      sound: false,
      timeout: 6,
    });
  } catch {
    // notifications are best-effort
  }
  res.json({ ok: true, id: entry.id });
});

app.get('/api/history', auth, (_req, res) => {
  res.json({ history });
});

// SPA fallback: anything not matched above gets index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

function lanIPs() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

app.listen(PORT, HOST, () => {
  const ips = lanIPs();
  console.log(`ClipBridge listening on http://0.0.0.0:${PORT}`);
  console.log(`Token: ${TOKEN}`);
  console.log(`Token file: ${tokenPath}`);
  for (const ip of ips) {
    console.log(`  LAN:  http://${ip}:${PORT}/?k=${TOKEN}`);
  }
  console.log('  Tailscale: use the machine 100.x.x.x address or MagicDNS name with :8787');
  console.log('Open that URL on your phone, tap Send, and the text lands on this computer clipboard.');
});
