'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/format';
import { useRoleGuard } from '@/components/ui';

const EMPTY = { name: '', email: '', password: '' };

export default function TeamPage() {
  const allowed = useRoleGuard(['dept_head']);
  const { user } = useAuth();
  const [members, setMembers] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await api('/api/users');
      setMembers(d.users.filter((u) => u.department_id === user.department_id));
    } catch (err) {
      setError(err.message);
    }
  }, [user.department_id]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  // Arriving from the "+ Add" menu: jump to the form.
  useEffect(() => {
    if (allowed && window.location.hash === '#add-member' && nameRef.current) {
      nameRef.current.scrollIntoView({ block: 'center' });
      nameRef.current.focus();
    }
  }, [allowed, members.length]);

  if (!allowed) return null;

  async function add(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api('/api/users', { method: 'POST', body: form });
      setNotice(`${form.name} was added to ${user.department_name}. Share the email and temporary password with them.`);
      setForm(EMPTY);
      await load();
      nameRef.current?.focus();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My team · {user.department_name}</h1>
          <p>Add people to your department and see who is on your team.</p>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 14 }} role="alert">{error}</div>}
      {notice && <div className="alert alert-ok" style={{ marginBottom: 14 }}>{notice}</div>}

      <div className="card" id="add-member">
        <div className="card-head">
          <h2>Add a team member</h2>
          <span className="muted small">They join {user.department_name} as an Employee.</span>
        </div>
        <form className="grid cols-2" onSubmit={add}>
          <div className="field">
            <label htmlFor="tn">Full name</label>
            <input id="tn" ref={nameRef} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="te">Email</label>
            <input id="te" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="tp">Temporary password</label>
            <input id="tp" type="password" autoComplete="new-password" minLength={8} className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add to my team'}</button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Team ({members.length})</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.name}</strong>
                    {m.email && <div className="muted small">{m.email}</div>}
                  </td>
                  <td>{ROLE_LABEL[m.role]}</td>
                  <td style={{ textAlign: 'right' }}>
                    {m.id !== user.id && (
                      <Link className="btn btn-sm" href={`/worklog?user=${m.id}`}>View worklog</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          To rename, move or deactivate someone, ask your Super Admin.
        </p>
      </div>
    </>
  );
}
