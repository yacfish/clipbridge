import { useEffect, useMemo, useRef, useState } from 'react';

const TOKEN_KEY = 'clipbridge_token';
const HISTORY_KEY = 'clipbridge_history_v1';
const MAX_HISTORY = 50;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
}

function getTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const k = params.get('k);
  if (k) {
    localStorage.setItem(TOKEN_KEY, k);
    params.delete('k);
    const next = `${window.location.protocol)//${window.location.host}${window.location.pathname}${params.toString() ? '?' + params : ''}`;
    window.history.replaceState(null, '', next);
  }
  return localStorage.getItem(TOKEN_KEY);
}

export default function App() {
  const [token, setToken] = useState(() => getTokenFromUrl());
  const [text, setText] = useState('');
  const [history, setHistory] = useState(() => loadHistory());
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const taRef = useRef(null);

  useEffect(() => {
    if (taRef.current) {
      taRef.current.focus();
    }
  }, [token]);

  const flash = (kind, message) => {
    setStatus({ kind, message });
    window.setTimeout(() => setStatus(null), 2600);
  };

  const send = async (payload) => {
    if (!token) return;
    setSending(true);
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          flash('error', 'Token rejected — paste it again below.');
        } else {
          flash('error', data.error || `Send failed (${res.status})`);
        }
        return;
      }
      const entry = { id: data.id, text: payload, at: Date.now() };
      setHistory((prev) => {
        const deduped = prev.filter((h) => h.text !== payload);
        const next = [entry, ...deduped].slice(0, MAX_HISTORY);
        saveHistory(next);
        return next;
      });
      setText('');
      flash('ok', 'Sent — on the computer clipboard now.');
    } catch (err) {
      flash('error', 'Network error — is the server running?');
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    send(t);
  };

  const removeOne = (id) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h.id !== id);
      saveHistory(next);
      return next;
    });
    setConfirm(null);
  };

  const clearAll = () => {
    setHistory([]);
    saveHistory([]);
    setConfirm(null);
  };

  const grouped = useMemo(() => {
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const groups = { Today: [], Yesterday: [], Earlier: [] };
    for (const h of history) {
      if (h.at >= startOfToday) groups.Today.push(h);
      else if (h.at >= startOfYesterday) groups.Yesterday.push(h);
      else groups.Earlier.push(h);
    }
    return groups;
  }, [history]);

  if (!token) {
    return (
      <div className="app">
        <header className="top">
          <div className="brand">
            <span className="dot" />
            ClipBridge
          </div>
        </header>
        <main className="setup">
          <h1>Paste your token</h1>
          <p>Open the bookmark the server printed on first run — it contains <code>?k=…</code>. The token is saved in this browser and stripped from the address bar.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = new FormData(e.currentTarget).get('token')?.toString().trim();
              if (!v) return;
              localStorage.setItem(TOKEN_KEY, v);
              setToken(v);
            }}
          >
            <input name="token" type="text" placeholder="token from the server" autoComplete="off" spellCheck={false} />
            <button type="submit">Save</button>
          </form>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="dot" />
          ClipBridge
        </div>
        <button
          className="ghost"
          onClick={() => {
            localStorage.removeItem(TOKEN_KEY);
            setToken(null);
          }}
        >
          Sign out
        </button>
      </header>

      <main>
        <form className="composer" onSubmit={onSubmit}>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type or paste text…"
            rows={5}
            enterKeyHint="send"
          />
          <div className="composer-bar">
            <span className="hint">{text.trim() ? `${text.trim().length} chars` : 'ready'}</span>
            <button type="submit" disabled={sending || !text.trim()}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>

        {status && <div className={`toast ${status.kind}`}>{status.message}</div>}

        <section className="history">
          <div className="history-head">
            <h2>History</h2>
            {history.length > 0 && (
              <button className="ghost danger" onClick={() => setConfirm({ type: 'all' })}
              >
                Clear all
              </button>
            )}
          </div>

          {history.length === 0 && (
            <p className="empty">Nothing sent yet. Your last {MAX_HISTORY} sends will show up here.</p>
          )}

          {Object.entries(grouped).map(([label, items]) =>
            items.length ? (
              <div className="group" key={label}>
                <div className="group-label">{label}</div>
                <ul>
                  {items.map((h) => (
                    <li key={h.id}>
                      <button className="entry" onClick={() => send(h.text)} disabled={sending}>
                        <span className="entry-text">{h.text}</span>
                        <span className="entry-meta">resend</span>
                      </button>
                      <button
                        className="icon-btn"
                        aria-label="Delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirm({ type: 'one', id: h.id });
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null
          )}
        </section>
      </main>

      {confirm && (
        <div className="modal-backdrop" onClick={() => setConfirm(null)} role="presentation">
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>{confirm.type === 'all' ? 'Clear all history?' : 'Delete this entry?'}</h3>
            <p>
              {confirm.type === 'all'
                ? 'This removes every saved send from this browser. It cannot be undone.'
                : 'This entry will be gone from the list.'}
            </p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setConfirm(null)} autoFocus>
                Cancel
              </button>
              <button
                className="danger"
                onClick={() => (confirm.type === 'all' ? clearAll() : removeOne(confirm.id))}
              >
                {confirm.type === 'all' ? 'Clear all' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
