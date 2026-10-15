'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useNotifications } from '@/lib/notifications';
import { fmtDateTime } from '@/lib/format';

function Composer({ onSent }) {
  const { user } = useAuth();
  const params = useSearchParams();
  const isAdmin = user.role === 'super_admin';

  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [targetType, setTargetType] = useState(isAdmin ? 'all' : 'dept');
  const [targetId, setTargetId] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentInfo, setSentInfo] = useState('');

  useEffect(() => {
    Promise.all([api('/api/departments'), api('/api/users')])
      .then(([d, u]) => {
        setDepartments(d.departments);
        setUsers(u.users.filter((x) => x.id !== user.id));
      })
      .catch((e) => setError(e.message));
  }, [user.id]);

  // Prefill from the Control Room ("Tag employee" on a blocked task).
  useEffect(() => {
    const to = params.get('to_user');
    if (to) {
      setTargetType('user');
      setTargetId(to);
      const ref = params.get('ref');
      if (ref) setBody(`Re: "${ref}": can you share an update on what is blocking this and what you need?`);
    }
  }, [params]);

  async function send(e) {
    e.preventDefault();
    setError('');
    setSentInfo('');
    setBusy(true);
    try {
      const d = await api('/api/messages', {
        method: 'POST',
        body: { target_type: targetType, target_id: targetType === 'all' ? undefined : Number(targetId), body },
      });
      setBody('');
      setSentInfo(`Sent to ${d.recipients} ${d.recipients === 1 ? 'person' : 'people'}.`);
      onSent();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const needsTarget = targetType !== 'all';

  return (
    <div className="card">
      <div className="card-head">
        <h2>{isAdmin ? 'New broadcast' : 'New message'}</h2>
      </div>
      <form className="stack" onSubmit={send}>
        <div className="row">
          <div className="field">
            <label htmlFor="ttype">Send to</label>
            <select
              id="ttype"
              className="select inline-select"
              value={targetType}
              onChange={(e) => {
                setTargetType(e.target.value);
                setTargetId('');
              }}
            >
              {isAdmin && <option value="all">Everyone</option>}
              <option value="dept">A department (@Dept)</option>
              <option value="user">A person (@Name)</option>
            </select>
          </div>
          {needsTarget && (
            <div className="field grow">
              <label htmlFor="tid">{targetType === 'dept' ? 'Department' : 'Person'}</label>
              <select id="tid" className="select" value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
                <option value="">Select…</option>
                {targetType === 'dept'
                  ? departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        @{d.name} ({d.member_count})
                      </option>
                    ))
                  : users.map((u) => (
                      <option key={u.id} value={u.id}>
                        @{u.name}
                        {u.department_name ? ` · ${u.department_name}` : ''}
                      </option>
                    ))}
              </select>
            </div>
          )}
        </div>
        <textarea
          className="textarea"
          placeholder="Type your message…"
          value={body}
          maxLength={5000}
          onChange={(e) => setBody(e.target.value)}
          aria-label="Message"
          required
        />
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {sentInfo && <div className="alert alert-ok">{sentInfo}</div>}
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !body.trim() || (needsTarget && !targetId)}>
            {busy ? 'Sending…' : 'Send'}
          </button>
          {!isAdmin && <span className="muted small">Messages to a department notify everyone in it.</span>}
        </div>
      </form>
    </div>
  );
}

function History({ refreshKey }) {
  const { user } = useAuth();
  const { items: notifItems } = useNotifications();
  const [q, setQ] = useState('');
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(
    async (query, before) => {
      try {
        const qs = new URLSearchParams();
        if (query) qs.set('q', query);
        if (before) qs.set('before', before);
        const d = await api(`/api/messages?${qs.toString()}`);
        setMessages((prev) => (before ? [...prev, ...d.messages] : d.messages));
        setHasMore(d.has_more);
        setError('');
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Debounced search; also reloads after sending and when a new notification arrives.
  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, refreshKey, notifItems.length, load]);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Message history</h2>
        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder="Search messages or senders…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search messages"
        />
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {loading ? (
        <div className="empty">Loading…</div>
      ) : messages.length === 0 ? (
        <div className="empty">{q ? 'No messages match your search.' : 'No messages yet.'}</div>
      ) : (
        <>
          {messages.map((m) => (
            <div className="msg" key={m.id}>
              <div className="msg-head">
                <strong>{m.sender_id === user.id ? 'You' : m.sender_name || 'Former employee'}</strong>
                {m.sender_department && m.sender_id !== user.id && <span className="muted small">{m.sender_department}</span>}
                <span className="muted">→</span>
                <span className={`chip ${m.target_type === 'all' ? 'all' : ''}`}>{m.target_label}</span>
                <span className="muted small" style={{ marginLeft: 'auto' }}>
                  {fmtDateTime(m.created_at)}
                </span>
              </div>
              <div className="msg-body">{m.body}</div>
            </div>
          ))}
          {hasMore && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="btn" onClick={() => load(q.trim(), messages[messages.length - 1].id)}>
                Load older
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function MessagesPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Messages</h1>
          <p>Broadcast to everyone, tag a department, or message a colleague directly.</p>
        </div>
      </div>
      <Suspense fallback={<div className="card empty">Loading…</div>}>
        <Composer onSent={() => setRefreshKey((k) => k + 1)} />
      </Suspense>
      <History refreshKey={refreshKey} />
    </>
  );
}
