import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import clipboardy from 'clipboardy';
import notifier from 'node-notifier';

const execFileAsync = promisify(execFile);

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run a command. Missing binaries return false so callers can try the next one. */
async function runPasteCommand(cmd, args) {
  try {
    await execFileAsync(cmd, args, { timeout: 4000 });
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Paste the clipboard into the focused app. macOS uses the physical V key
 * (key code 9) so Cmd+V still pastes on non-US layouts.
 */
async function pasteClipboard() {
  // Let the pasteboard settle before the keystroke.
  await sleep(120);
  let pasted = false;
  if (process.platform === 'darwin') {
    pasted = await runPasteCommand('osascript', [
      '-e',
      'tell application "System Events" to key code 9 using command down',
    ]);
  } else if (process.platform === 'win32') {
    pasted = await runPasteCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')",
    ]);
  } else {
    pasted = await runPasteCommand('wtype', ['-M', 'ctrl', '-k', 'v', '-m', 'ctrl']);
    if (!pasted) pasted = await runPasteCommand('xdotool', ['key', '--clearmodifiers', 'ctrl+v']);
  }
  if (pasted) return;
  const err = new Error('paste helper missing');
  err.code = 'ENOENT';
  throw err;
}

function pasteFailureMessage(err) {
  const detail = `${err.stderr || ''} ${err.message || ''}`;
  if (/1002|not allowed to send keystrokes|assistive access|-1719/i.test(detail)) {
    return 'Copied. To auto paste, allow Accessibility for the app that launches ClipBridge (System Settings → Privacy & Security → Accessibility).';
  }
  if (err.code === 'ENOENT') {
    if (process.platform === 'linux') {
      return 'Copied, but paste needs wtype (Wayland) or xdotool (X11) on this computer.';
    }
    return 'Copied, but the paste command is not available on this computer.';
  }
  return 'Copied to the clipboard, but the paste keystroke failed.';
}

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
  // Paste before the notification so a banner cannot steal the keystroke.
  let pasteError = null;
  if (req.body?.paste === true) {
    try {
      await pasteClipboard();
    } catch (err) {
      console.error('paste failed:', err.stderr || err.message);
      pasteError = pasteFailureMessage(err);
    }
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
  res.json({ ok: true, id: entry.id, pasteError });
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
