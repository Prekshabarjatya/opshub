'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateStr, fmtTime, ROLE_LABEL } from '@/lib/format';
import { Progress, StatusSelect } from '@/components/ui';

export default function WorklogPage() {
  const { user } = useAuth();
  const today = dateStr();
  const [date, setDate] = useState(today);
  const [people, setPeople] = useState([]);
  const [viewUserId, setViewUserId] = useState(''); // '' = me
  const [goals, setGoals] = useState([]);
  const [newTitle, setNewTitle] = useState('');
  const [note, setNote] = useState('');
  const [noteSavedAt, setNoteSavedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');

  // Deep link from My Team: /worklog?user=ID
  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get('user');
    if (u && /^\d+$/.test(u)) setViewUserId(u);
  }, []);

  const isSelf = viewUserId === '';
  const canPickPeople = user.role !== 'employee';

  useEffect(() => {
    if (!canPickPeople) return;
    api('/api/users')
      .then((d) => {
        const list = d.users.filter(
          (u) =>
            u.id !== user.id &&
            u.role !== 'super_admin' &&
            (user.role === 'super_admin' || u.department_id === user.department_id)
        );
        setPeople(list);
      })
      .catch(() => {});
  }, [canPickPeople, user]);

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    const q = `date=${date}${isSelf ? '' : `&user_id=${viewUserId}`}`;
    try {
      const [g, e] = await Promise.all([api(`/api/goals?${q}`), api(`/api/eod?${q}`)]);
      setGoals(g.goals);
      setNote(e.note ? e.note.note : '');
      setNoteSavedAt(e.note ? e.note.updated_at : null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [date, viewUserId, isSelf]);

  useEffect(() => {
    load();
  }, [load]);

  async function addGoal(e) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setBusy(true);
    setError('');
    try {
      const d = await api('/api/goals', {
        method: 'POST',
        body: { title, goal_date: date, user_id: isSelf ? undefined : Number(viewUserId) },
      });
      setGoals((g) => [...g, d.goal]);
      setNewTitle('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(goal, status) {
    const prev = goals;
    setGoals((gs) => gs.map((g) => (g.id === goal.id ? { ...g, status } : g)));
    try {
      const d = await api(`/api/goals/${goal.id}`, { method: 'PATCH', body: { status } });
      setGoals((gs) => gs.map((g) => (g.id === goal.id ? d.goal : g)));
    } catch (err) {
      setGoals(prev);
      setError(err.message);
    }
  }

  // Goals can be edited or cancelled, never deleted.
  function startEdit(goal) {
    setEditingId(goal.id);
    setEditTitle(goal.title);
  }

  async function saveEdit(goal) {
    const title = editTitle.trim();
    if (!title) return;
    if (title === goal.title) {
      setEditingId(null);
      return;
    }
    try {
      const d = await api(`/api/goals/${goal.id}`, { method: 'PATCH', body: { title } });
      setGoals((gs) => gs.map((g) => (g.id === goal.id ? d.goal : g)));
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveNote(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api('/api/eod', { method: 'PUT', body: { note_date: date, note } });
      setNoteSavedAt(d.note.updated_at);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const stats = useMemo(() => {
    // Cancelled goals are kept for the record but do not count toward progress.
    const active = goals.filter((g) => g.status !== 'cancelled');
    const done = active.filter((g) => g.status === 'completed').length;
    return {
      done,
      total: active.length,
      cancelled: goals.length - active.length,
      pct: active.length ? Math.round((done / active.length) * 100) : 0,
    };
  }, [goals]);

  const viewedPerson = people.find((p) => String(p.id) === viewUserId);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{isSelf ? 'My daily worklog' : `${viewedPerson ? viewedPerson.name : 'Team member'}'s worklog`}</h1>
          <p>Plan your goals in the morning, track their status, and sum up the day in your End-of-Day note.</p>
        </div>
        <div className="row">
          {canPickPeople && (
            <select
              className="select inline-select"
              value={viewUserId}
              onChange={(e) => setViewUserId(e.target.value)}
              aria-label="Whose worklog"
            >
              <option value="">My worklog</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({ROLE_LABEL[p.role]}
                  {user.role === 'super_admin' && p.department_name ? `, ${p.department_name}` : ''})
                </option>
              ))}
            </select>
          )}
          <input
            type="date"
            className="input"
            style={{ width: 'auto' }}
            value={date}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Date"
          />
          {date !== today && (
            <button className="btn" onClick={() => setDate(today)}>
              Today
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 14 }} role="alert">{error}</div>}

      {isSelf && date === today && !loading && goals.length === 0 && (
        <div className="alert alert-warn" style={{ marginBottom: 14 }}>
          Good morning! You have not set any goals for today yet. Add them below.
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Goals</h2>
          <span className="muted small">
            {stats.done} of {stats.total} completed
            {stats.cancelled > 0 && ` · ${stats.cancelled} cancelled`}
          </span>
        </div>
        <Progress pct={stats.pct} />

        <form className="row" style={{ margin: '16px 0 6px' }} onSubmit={addGoal}>
          <input
            className="input grow"
            placeholder={isSelf ? 'Add a goal for this day…' : 'Assign a goal…'}
            value={newTitle}
            maxLength={300}
            onChange={(e) => setNewTitle(e.target.value)}
            aria-label="New goal"
          />
          <button className="btn btn-primary" disabled={busy || !newTitle.trim()}>
            Add goal
          </button>
        </form>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : goals.length === 0 ? (
          <div className="empty">No goals for this day.</div>
        ) : (
          goals.map((g) => (
            <div className={`goal ${g.status === 'cancelled' ? 'cancelled' : ''}`} key={g.id}>
              {editingId === g.id ? (
                <form
                  className="row grow"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveEdit(g);
                  }}
                >
                  <input
                    className="input grow"
                    value={editTitle}
                    maxLength={300}
                    autoFocus
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setEditingId(null)}
                    aria-label="Edit goal"
                  />
                  <button className="btn btn-primary btn-sm" disabled={!editTitle.trim()}>Save</button>
                  <button type="button" className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <div className={`goal-title ${g.status === 'completed' ? 'done' : ''}`}>{g.title}</div>
                  <StatusSelect value={g.status} onChange={(s) => changeStatus(g, s)} />
                  <div className="goal-meta">
                    Created {fmtTime(g.created_at)}
                    {g.completed_at && <div>Completed {fmtTime(g.completed_at)}</div>}
                    {g.status === 'blocked' && g.blocked_at && <div>Blocked since {fmtTime(g.blocked_at)}</div>}
                    {g.status === 'cancelled' && <div>Cancelled {fmtTime(g.updated_at)}</div>}
                  </div>
                  <button className="btn btn-sm" onClick={() => startEdit(g)} aria-label={`Edit ${g.title}`}>
                    Edit
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>End-of-Day report</h2>
          {noteSavedAt && <span className="muted small">Last saved {fmtTime(noteSavedAt)}</span>}
        </div>
        {isSelf ? (
          <form className="stack" onSubmit={saveNote}>
            <textarea
              className="textarea"
              placeholder="What did you achieve today? Any hurdles?"
              value={note}
              maxLength={5000}
              onChange={(e) => setNote(e.target.value)}
              aria-label="End of day note"
            />
            <div className="row">
              <button className="btn btn-primary" disabled={busy || !note.trim()}>
                {noteSavedAt ? 'Update report' : 'Submit report'}
              </button>
            </div>
          </form>
        ) : note ? (
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{note}</p>
        ) : (
          <div className="empty">No End-of-Day report submitted for this day.</div>
        )}
      </div>
    </>
  );
}
