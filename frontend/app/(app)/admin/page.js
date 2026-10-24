'use client';

import { useCallback, useEffect, useState } from 'react';
import { shareLoginLink } from '@/lib/invite';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/format';
import { useRoleGuard } from '@/components/ui';

const EMPTY_FORM = { name: '', email: '', password: '', role: 'employee', department_id: '' };

export default function AdminPage() {
  const allowed = useRoleGuard(['super_admin']);
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deptName, setDeptName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [u, d] = await Promise.all([api('/api/users'), api('/api/departments')]);
      setUsers(u.users);
      setDepartments(d.departments);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  // Arriving from the "+ Add" menu (/admin#add-user or #add-department): jump to that form.
  useEffect(() => {
    if (!allowed || !departments.length) return;
    const id = window.location.hash.slice(1);
    const el = id && document.getElementById(id);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      const input = el.querySelector('input');
      if (input) input.focus({ preventScroll: true });
    }
  }, [allowed, departments.length]);

  if (!allowed) return null;

  async function run(fn, success) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await fn();
      if (success) setNotice(success);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const createUser = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/api/users', {
        method: 'POST',
        body: {
          ...form,
          department_id: form.role === 'super_admin' ? null : Number(form.department_id) || null,
        },
      });
      setForm(EMPTY_FORM);
    }, 'User created.');
  };

  const patchUser = (id, body, msg) => run(() => api(`/api/users/${id}`, { method: 'PATCH', body }), msg);

  const resetPassword = (u) => {
    const pw = window.prompt(`New password for ${u.name} (min 8 characters):`);
    if (pw) patchUser(u.id, { password: pw }, `Password updated for ${u.name}.`);
  };

  const sendLink = (u) =>
    run(async () => {
      const t = await shareLoginLink(u);
      if (t) setNotice(t);
    });

  const deleteUser = (u) => {
    if (!window.confirm(`Permanently delete ${u.name}? Their goals and notes are deleted too. Consider deactivating instead.`)) return;
    run(() => api(`/api/users/${u.id}`, { method: 'DELETE' }), 'User deleted.');
  };

  const createDept = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/api/departments', { method: 'POST', body: { name: deptName } });
      setDeptName('');
    }, 'Department created.');
  };

  const renameDept = (d) => {
    const name = window.prompt('Rename department:', d.name);
    if (name && name.trim() && name.trim() !== d.name) {
      run(() => api(`/api/departments/${d.id}`, { method: 'PATCH', body: { name } }), 'Department renamed.');
    }
  };

  const deleteDept = (d) => {
    if (!window.confirm(`Delete the ${d.name} department?`)) return;
    run(() => api(`/api/departments/${d.id}`, { method: 'DELETE' }), 'Department deleted.');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Administration</h1>
          <p>Manage departments and user access.</p>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 'var(--gap)' }} role="alert">{error}</div>}
      {notice && <div className="alert alert-ok" style={{ marginBottom: 'var(--gap)' }}>{notice}</div>}

      <div className="card" id="add-department">
        <div className="card-head">
          <h2>Departments</h2>
        </div>
        <form className="row" onSubmit={createDept} style={{ marginBottom: 12 }}>
          <input
            className="input grow"
            style={{ maxWidth: 320 }}
            placeholder="New department name"
            value={deptName}
            maxLength={60}
            onChange={(e) => setDeptName(e.target.value)}
            aria-label="New department name"
          />
          <button className="btn btn-primary" disabled={busy || !deptName.trim()}>
            Create department
          </button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Active members</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong></td>
                  <td>{d.member_count}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm" onClick={() => renameDept(d)}>Rename</button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => deleteDept(d)}>Delete</button>
                  </td>
                </tr>
              ))}
              {departments.length === 0 && (
                <tr><td colSpan={3} className="empty">No departments yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" id="add-user">
        <div className="card-head">
          <h2>Add a user</h2>
        </div>
        <form className="grid cols-2" onSubmit={createUser}>
          <div className="field">
            <label htmlFor="un">Full name</label>
            <input id="un" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="ue">Email</label>
            <input id="ue" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="up">Temporary password</label>
            <input id="up" type="password" autoComplete="new-password" minLength={8} className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </div>
          <div className="row">
            <div className="field grow">
              <label htmlFor="ur">Role</label>
              <select id="ur" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {Object.entries(ROLE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            {form.role !== 'super_admin' && (
              <div className="field grow">
                <label htmlFor="ud">Department</label>
                <select id="ud" className="select" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })} required>
                  <option value="">Select…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div>
            <button className="btn btn-primary" disabled={busy}>Create user</button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Users ({users.length})</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Department</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === me.id;
                return (
                  <tr key={u.id} style={u.active ? undefined : { opacity: 0.55 }}>
                    <td>
                      <strong>{u.name}</strong>
                      <div className="muted small">{u.email}</div>
                    </td>
                    <td>
                      <select
                        className="select inline-select"
                        value={u.role}
                        disabled={self || busy}
                        onChange={(e) => patchUser(u.id, { role: e.target.value }, 'Role updated.')}
                        aria-label={`Role for ${u.name}`}
                      >
                        {Object.entries(ROLE_LABEL).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="select inline-select"
                        value={u.department_id || ''}
                        disabled={busy}
                        onChange={(e) => patchUser(u.id, { department_id: e.target.value ? Number(e.target.value) : null }, 'Department updated.')}
                        aria-label={`Department for ${u.name}`}
                      >
                        <option value="">None</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className={`badge ${u.active ? 'badge-completed' : 'badge-todo'}`}>
                        {u.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {u.active && u.role !== 'super_admin' && (
                        <><button className="btn btn-sm btn-primary" onClick={() => sendLink(u)}>Share sign-in link</button>{' '}</>
                      )}
                      <button className="btn btn-sm" onClick={() => resetPassword(u)}>Reset password</button>{' '}
                      {!self && (
                        <>
                          <button className="btn btn-sm" disabled={busy} onClick={() => patchUser(u.id, { active: !u.active }, u.active ? 'User deactivated.' : 'User activated.')}>
                            {u.active ? 'Deactivate' : 'Activate'}
                          </button>{' '}
                          <button className="btn btn-sm btn-danger" onClick={() => deleteUser(u)}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
