import { useEffect, useMemo, useRef, useState } from 'react';

const TOKEN_KEY = 'clipbridge_token';
const HISTORY_KEY = 'clipbridge_history_v1';
const THEME_KEY = 'clipbridge_theme';
const MAX_HISTORY = 50;
const SWIPE_MAX = 148; // px: two 74px action buttons

function byTime(items) {
  return [...items].sort((a, b) => a.at - b.at).slice(-MAX_HISTORY);
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? byTime(parsed) : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(byTime(items)));
}

function getTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const k = params.get('k');
  if (k) {
    localStorage.setItem(TOKEN_KEY, k);
    params.delete('k');
    const next = `${window.location.protocol}//${window.location.host}${window.location.pathname}${params.toString() ? '?' + params : ''}`;
    window.history.replaceState(null, '', next);
  }
  return localStorage.getItem(TOKEN_KEY);
}

function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  return 'dark';
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
  const [justSentId, setJustSentId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(loadTheme);
  const taRef = useRef(null);
  const chatRef = useRef(null);
  const appRef = useRef(null);
  const menuRef = useRef(null);
  const touchRef = useRef({ id: null, x: 0, y: 0, dx: 0 });
  const justSentTimer = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    if (taRef.current) taRef.current.focus();
  }, [token]);

  // Close swipe rows when tapping elsewhere (bubble clicks stopPropagation).
  useEffect(() => {
    const onDoc = () => setOpenSwipeId(null);
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  // Close the top menu on any outside tap. Use capture so stopPropagation
  // on bubbles or the composer cannot keep the menu open.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (e) => {
      const wrap = menuRef.current;
      if (wrap && wrap.contains(e.target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [menuOpen]);

  const flash = (kind, message) => {
    setStatus({ kind, message });
    window.setTimeout(() => setStatus(null), 2600);
  };

  const flashBubble = (id) => {
    if (justSentTimer.current) window.clearTimeout(justSentTimer.current);
    setJustSentId(id);
    justSentTimer.current = window.setTimeout(() => {
      setJustSentId(null);
      justSentTimer.current = null;
    }, 750);
  };

  const send = async (payload) => {
    if (!token || sending) return;
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
        const next = byTime([...deduped, entry]);
        saveHistory(next);
        return next;
      });
      setText('');
      flashBubble(entry.id);
    } catch {
      flash('error', 'Network error — is the server running?');
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    // Reject whitespace-only sends, but keep intentional blank lines in the payload.
    if (!text.trim()) return;
    send(text);
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

  // Load an entry into the composer for editing. Replaces any draft; does not send.
  const editEntry = (entryText) => {
    setOpenSwipeId(null);
    setText(entryText);
    window.requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const len = entryText.length;
      try {
        ta.setSelectionRange(len, len);
      } catch {
        /* ignore */
      }
    });
  };

  const clearAll = () => {
    setHistory([]);
    saveHistory([]);
    setConfirm(null);
    setMenuOpen(false);
  };

  const disconnect = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
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
    const groups = { Earlier: [], Yesterday: [], Today: [] };
    for (const h of byTime(history)) {
      if (h.at >= startOfToday) groups.Today.push(h);
      else if (h.at >= startOfYesterday) groups.Yesterday.push(h);
      else groups.Earlier.push(h);
    }
    return ['Earlier', 'Yesterday', 'Today'].map((label) => [label, groups[label]]);
  }, [history]);

  useEffect(() => {
    const chat = chatRef.current;
    if (!chat) return undefined;

    const scrollToEnd = () => {
      chat.scrollTop = chat.scrollHeight;
    };

    // Immediate scroll for the new history entry.
    scrollToEnd();

    // After layout (new bubble, just-sent styles, composer resize from a
    // cleared draft), scroll again so the newest bubble is fully visible,
    // including chat padding. Double rAF waits for paint; a short timeout
    // covers any late height settle. Keyboard sync keeps its own scroll.
    let cancelled = false;
    let timeoutId = 0;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (cancelled) return;
        scrollToEnd();
        const rows = chat.querySelectorAll('.swipe-row');
        const last = rows[rows.length - 1];
        if (last) last.scrollIntoView({ block: 'end', inline: 'nearest' });
        timeoutId = window.setTimeout(() => {
          if (!cancelled) scrollToEnd();
        }, 50);
      });
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [history, token]);

  // Pin the shell to the visual viewport with position:fixed so header, chat,
  // and composer shrink together above the soft keyboard (iOS home-screen PWA).
  // Only rewrite top/height when they actually change, and only pin the chat
  // to the bottom when the shell height changes (keyboard open/close). Typing
  // can fire visualViewport scroll with the same size; do not scroll then.
  useEffect(() => {
    const vv = window.visualViewport;

    const scrollChatToEnd = () => {
      const chat = chatRef.current;
      if (chat) chat.scrollTop = chat.scrollHeight;
    };

    const sync = () => {
      const app = appRef.current;
      let heightChanged = false;

      if (app) {
        if (vv) {
          const nextTop = `${vv.offsetTop}px`;
          const nextHeight = `${vv.height}px`;
          if (app.style.top !== nextTop) {
            app.style.top = nextTop;
          }
          if (app.style.height !== nextHeight) {
            app.style.height = nextHeight;
            heightChanged = true;
          }
        } else if (app.style.top !== '0px' || app.style.height !== '') {
          app.style.top = '0px';
          app.style.height = '';
          heightChanged = true;
        }
      }
      // Mobile browsers scroll the layout viewport when focusing an input;
      // pin it so the shell offset stays correct.
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);

      if (!heightChanged) return;
      scrollChatToEnd();
      // Layout may settle one frame after the viewport resize.
      window.requestAnimationFrame(scrollChatToEnd);
    };

    sync();
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    return () => {
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      const app = appRef.current;
      if (app) {
        app.style.top = '';
        app.style.height = '';
      }
    };
  }, []);

  // Grow the composer with the draft until it reaches the header. After that,
  // the box scrolls and older lines leave at the top. Chat flex shrinks when
  // the textarea grows; preserve distance-from-bottom so the last bubble stays
  // glued to the composer (no top gap, no force-scroll on every keystroke).
  const fitComposerRef = useRef(() => {});
  fitComposerRef.current = () => {
    const app = appRef.current;
    const ta = taRef.current;
    const chat = chatRef.current;
    if (!app || !ta) return;
    const composer = ta.closest('.composer');
    const bar = composer?.querySelector('.composer-bar');
    const header = app.querySelector('.top');
    const composerStyle = composer ? getComputedStyle(composer) : null;
    const pad =
      (parseFloat(composerStyle?.paddingTop) || 0) +
      (parseFloat(composerStyle?.paddingBottom) || 0);
    const barStyle = bar ? getComputedStyle(bar) : null;
    const barHeight = bar
      ? bar.offsetHeight + (parseFloat(barStyle.marginTop) || 0)
      : 0;
    const headerHeight = header ? header.offsetHeight : 0;
    const max = Math.max(72, app.clientHeight - headerHeight - pad - barHeight);

    // Anchor the thread before the measure dance; height:0 briefly expands
    // .chat and browsers may nudge scrollTop.
    const fromBottom = chat
      ? chat.scrollHeight - chat.scrollTop - chat.clientHeight
      : 0;

    ta.style.minHeight = '0px';
    ta.style.height = '0px';
    const needed = ta.scrollHeight;
    ta.style.minHeight = '';
    const next = Math.min(Math.max(needed, 72), max);
    ta.style.height = `${next}px`;
    ta.style.overflowY = needed > max ? 'auto' : 'hidden';
    if (needed > max && ta.selectionStart === ta.value.length) {
      ta.scrollTop = ta.scrollHeight;
    }

    if (chat) {
      // Re-apply fromBottom after measuring so a same-line keystroke does not
      // leave a gap. Do not assign scrollTop = scrollHeight on text changes.
      chat.scrollTop = chat.scrollHeight - chat.clientHeight - fromBottom;
    }
  };

  // Listeners only when token is present; do not rebind on every keystroke.
  useEffect(() => {
    if (!token) return undefined;

    const fit = () => fitComposerRef.current();
    fit();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    window.addEventListener('resize', fit);
    return () => {
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
    };
  }, [token]);

  // Refit when the draft changes. Height updates shrink .chat via flex;
  // fitComposer preserves distance-from-bottom instead of scrolling to end.
  useEffect(() => {
    if (!token) return;
    fitComposerRef.current();
  }, [token, text]);

  if (!token) {
    return (
      <div className="app" ref={appRef}>
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
    <div className="app" ref={appRef}>
      <header className="top">
        <div className="brand">
          <span className="dot" />
          ClipBridge
        </div>
        <div className="top-actions">
          <div className="menu-wrap" ref={menuRef}>
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
                  className="dropdown-item"
                  role="switch"
                  aria-checked={theme === 'dark'}
                  onClick={() => {
                    setMenuOpen(false);
                    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
                  }}>
                  {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                </button>
                <button
                  className="dropdown-item danger"
                  disabled={history.length === 0}
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirm({ type: 'all' });
                  }}>
                  Delete all
                </button>
                <button className="dropdown-item" onClick={disconnect}>
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="chat" ref={chatRef}>
        {history.length === 0 && (
          <p className="empty">Nothing sent yet. Your last {MAX_HISTORY} sends will show up here.</p>
        )}

        {grouped.map(([label, items]) =>
          items.length ? (
            <div className="group" key={label}>
              <div className="group-label">{label}</div>
              <ul>
                {items.map((h) => {
                  const open = openSwipeId === h.id;
                  const offset = open ? -SWIPE_MAX : 0;
                  return (
                    <li key={h.id} className={open ? 'swipe-row open' : 'swipe-row'}>
                      <div className="swipe-actions" aria-hidden="true">
                        <button
                          className="swipe-btn edit"
                          onClick={(e) => {
                            e.stopPropagation();
                            editEntry(h.text);
                          }}>
                          Edit
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
                        style={offset ? { transform: `translateX(${offset}px)` } : undefined}
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
                        <div className={justSentId === h.id ? 'bubble just-sent' : 'bubble'}>
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
          rows={1}
          enterKeyHint="enter"
        />
        <div className="composer-bar">
          <span className="hint">{text.trim() ? `${text.trim().length} chars` : 'ready'}</span>
          <button type="submit" disabled={sending || !text.trim()}>
            Send
          </button>
        </div>
      </form>

      {status?.kind === 'error' && <div className={`toast ${status.kind}`}>{status.message}</div>}

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
