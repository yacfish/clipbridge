import { useEffect, useMemo, useRef, useState } from 'react';

const TOKEN_KEY = 'clipbridge_token';
const HISTORY_KEY = 'clipbridge_history_v1';
const MAX_HISTORY = 50;
const SWIPE_MAX = 148; // px: two 74px action buttons

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

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function App() {
  const [token, setToken] = useState(() => getTokenFromUrl());
  const [text, setText] = useState('');
  const [history, setHistory] = useState(() => loadHistory());
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [openSwipeId, setOpenSwipeId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const taRef = useRef(null);
  const touchRef = useRef({ id: null, x: 0, y: 0, dx: 0 });

  useEffect(() => {
    if (taRef.current) taRef.current.focus();
  }, [token]);

  // Close swipe / menu when tapping elsewhere
  useEffect(() => {
    const onDoc = () => {
      setOpenSwipeId(null);
      setMenuOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

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
    } catch {
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
    setOpenSwipeId(null);
    setConfirm(null);
  };

  const clearAll = () => {
    setHistory([]);
    saveHistory([]);
    setConfirm(null);
    setMenuOpen(false);
  };

  // --- swipe handling ---
  const onTouchStart = (e, id) => {
    const t = e.touches[0];
    touchRef.current = { id, x: t.clientX, y: t.clientY, dx: 0 };
  };
  const onTouchMove = (e) => {
    const t = e.touches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
      e.preventDefault(); // stop the page scrolling while swiping
      touchRef.current.dx = dx;
    }
  };
  const onTouchEnd = () => {
    const { id, dx } = touchRef.current;
    if (id == null) return;
    if (dx < -40) setOpenSwipeId(id);
    else if (dx > 40) setOpenSwipeId(null);
    touchRef.current = { id: null, x: 0, y: 0, dx: 0 };
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
          <p>
            Open the bookmark the server printed on first run — it contains <code>?k=…</code>. The
            token is saved in this browser and stripped from the address bar.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = new FormData(e.currentTarget).get('token')?.toString().trim();
              if (!v) return;
              localStorage.setItem(TOKEN_KEY, v);
              setToken(v);
            }}>
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
        <div className="top-actions">
          <div className="menu-wrap">
            <button
              className="icon-btn"
              aria-label="Menu"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}>
              ⋮
            </button>
            {menuOpen && (
              <div className="dropdown" onClick={(e) => e.stopPropagation()}>
                <button
                  className="dropdown-item danger"
                  disabled={history.length === 0}
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirm({ type: 'all' });
                  }}>
                  Delete all
                </button>
              </div>
            )}
          </div>
          <button
            className="ghost"
            onClick={() => {
              localStorage.removeItem(TOKEN_KEY);
              setToken(null);
            }}>
            Sign out
          </button>
        </div>
      </header>

      <main className="chat">
        {history.length === 0 && (
          <p className="empty">Nothing sent yet. Your last {MAX_HISTORY} sends will show up here.</p>
        )}

        {Object.entries(grouped).map(([label, items]) =>
          items.length ? (
            <div className="group" key={label}>
              <div className="group-label">{label}</div>
              <ul>
                {items.map((h) => {
                  const open = openSwipeId === h.id;
                  const offset = open ? -SWIPE_MAX : 0;
                  return (
                    <li key={h.id} className="swipe-row">
                      <div className="swipe-actions" aria-hidden="true">
                        <button
                          className="swipe-btn resend"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenSwipeId(null);
                            send(h.text);
                          }}>
                          Resend
                        </button>
                        <button
                          className="swipe-btn delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenSwipeId(null);
                            setConfirm({ type: 'one', id: h.id });
                          }}>
                          Delete
                        </button>
                      </div>
                      <div
                        className="bubble-wrap"
                        style={{ transform: `translateX(${offset}px)` }
                        onTouchStart={(e) => onTouchStart(e, h.id)}
                        onTouchMove={onTouchMove}
                        onTouchEnd={onTouchEnd}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (openSwipeId === h.id) {
                            setOpenSwipeId(null);
                          } else {
                            send(h.text);
                          }
                        }}>
                        <div className="bubble">
                          <span className="bubble-text">{h.text}</span>
                          <span className="bubble-time">{formatTime(h.at)}</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null
        )}
      </main>

      <form className="composer" onSubmit={onSubmit} onClick={(e) => e.stopPropagation()}>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type or paste text…"
          rows={3}
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

      {confirm && (
        <div className="modal-backdrop" onClick={() => setConfirm(null)} role="presentation">
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>{confirm.type === 'all' ? 'Delete all history?' : 'Delete this entry?'}</h3>
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
                {confirm.type === 'all' ? 'Delete all' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
