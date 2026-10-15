'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useNotifications } from '@/lib/notifications';
import { dateStr, daysAgoStr, fmtDateTime, fmtDay, ROLE_LABEL } from '@/lib/format';
import { Progress, useRoleGuard } from '@/components/ui';

const COLOR_DONE = '#15803d';
const COLOR_PENDING = '#cbd3e3';
const COLOR_BAR = '#4338ca';

function DeptPie({ dept }) {
  const data = [
    { name: 'Completed', value: dept.completed },
    { name: 'Pending', value: dept.pending },
  ];
  return (
    <div className="pie-cell">
      <h3>{dept.name}</h3>
      {dept.total === 0 ? (
        <div className="pie-box" style={{ display: 'grid', placeItems: 'center' }}>
          <span className="muted small">No goals in range</span>
        </div>
      ) : (
        <div className="pie-box">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" innerRadius={42} outerRadius={64} startAngle={90} endAngle={-270} stroke="none">
                <Cell fill={COLOR_DONE} />
                <Cell fill={COLOR_PENDING} />
              </Pie>
              <Tooltip formatter={(v, n) => [`${v} goals`, n]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pie-center">{dept.completion_pct}%</div>
        </div>
      )}
      <div className="muted small">
        {dept.completed} done · {dept.pending} pending
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const allowed = useRoleGuard(['super_admin', 'dept_head']);
  const { user } = useAuth();
  const { socket } = useNotifications();
  const isAdmin = user.role === 'super_admin';

  const [from, setFrom] = useState(daysAgoStr(6));
  const [to, setTo] = useState(dateStr());
  const [deptId, setDeptId] = useState('');
  const [userId, setUserId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [people, setPeople] = useState([]);
  const [data, setData] = useState(null);
  const [feed, setFeed] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!allowed) return;
    Promise.all([api('/api/departments'), api('/api/users')])
      .then(([d, u]) => {
        setDepartments(d.departments);
        setPeople(u.users.filter((x) => x.role !== 'super_admin'));
      })
      .catch((e) => setError(e.message));
  }, [allowed]);

  const query = useMemo(() => {
    const qs = new URLSearchParams({ from, to });
    if (isAdmin && deptId) qs.set('dept_id', deptId);
    if (userId) qs.set('user_id', userId);
    return qs.toString();
  }, [from, to, deptId, userId, isAdmin]);

  const load = useCallback(async () => {
    try {
      const [o, f] = await Promise.all([api(`/api/analytics/overview?${query}`), api(`/api/analytics/feed?${query}`)]);
      setData(o);
      setFeed(f.items);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  // Live updates: refetch (debounced) whenever goals or EOD notes change anywhere in scope.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!socket) return undefined;
    let timer = null;
    const onActivity = () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadRef.current(), 600);
    };
    socket.on('activity', onActivity);
    return () => {
      clearTimeout(timer);
      socket.off('activity', onActivity);
    };
  }, [socket]);

  if (!allowed) return null;

  const employeeOptions = people.filter((p) => {
    if (isAdmin) return !deptId || String(p.department_id) === deptId;
    return p.department_id === user.department_id;
  });

  const preset = (days) => {
    setFrom(daysAgoStr(days));
    setTo(dateStr());
  };

  const s = data && data.summary;
  const barData = data ? data.departments.map((d) => ({ name: d.name, 'Completion %': d.completion_pct, completed: d.completed, total: d.total })) : [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Control Room</h1>
          <p>
            {isAdmin ? 'Business health across all departments' : `Progress of the ${user.department_name || ''} team`}, live.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row">
          <div className="field">
            <label htmlFor="from">From</label>
            <input id="from" type="date" className="input" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="to">To</label>
            <input id="to" type="date" className="input" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </div>
          {isAdmin && (
            <div className="field">
              <label htmlFor="dept">Department</label>
              <select
                id="dept"
                className="select inline-select"
                value={deptId}
                onChange={(e) => {
                  setDeptId(e.target.value);
                  setUserId('');
                }}
              >
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="emp">Employee</label>
            <select id="emp" className="select inline-select" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Everyone</option>
              {employeeOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ alignSelf: 'flex-end' }}>
            <button className="btn btn-sm" onClick={() => preset(0)}>Today</button>
            <button className="btn btn-sm" onClick={() => preset(6)}>7 days</button>
            <button className="btn btn-sm" onClick={() => preset(29)}>30 days</button>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }} role="alert">{error}</div>}
      {loading && <div className="card empty">Loading…</div>}

      {data && (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <div className="card kpi">
              <div className="label">Goals in range</div>
              <div className="value">
                {s.total}
                {s.cancelled > 0 && <span className="muted small"> (+{s.cancelled} cancelled)</span>}
              </div>
            </div>
            <div className="card kpi ok">
              <div className="label">Completed</div>
              <div className="value">
                {s.completion_pct}% <span className="muted small">({s.completed})</span>
              </div>
            </div>
            <div className="card kpi">
              <div className="label">Pending</div>
              <div className="value">{s.pending}</div>
            </div>
            <div className={`card kpi ${s.blocked_over_24h ? 'danger' : ''}`}>
              <div className="label">Blocked &gt; 24h</div>
              <div className="value">{s.blocked_over_24h}</div>
            </div>
          </div>

          {data.blocked_tasks.length > 0 && (
            <div className="card" style={{ borderColor: '#f0b8b8', background: '#fff8f8', marginBottom: 16 }}>
              <div className="card-head">
                <h2 style={{ color: 'var(--danger)' }}>⚠ Blocked for more than 24 hours</h2>
              </div>
              {data.blocked_tasks.map((t) => (
                <div className="blocked-item" key={t.id}>
                  <div className="grow">
                    <strong>{t.title}</strong>
                    <div className="muted small">
                      {t.user_name}
                      {t.department ? ` · ${t.department}` : ''} · blocked {t.hours_blocked}h (since {fmtDateTime(t.blocked_at)})
                    </div>
                  </div>
                  <Link
                    className="btn btn-sm"
                    href={`/messages?to_user=${t.user_id}&ref=${encodeURIComponent(t.title)}`}
                  >
                    Tag {t.user_name.split(' ')[0]}
                  </Link>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <h2>Departmental performance</h2>
              <div className="legend">
                <span><i style={{ background: COLOR_DONE }} />Completed</span>
                <span><i style={{ background: COLOR_PENDING }} />Pending</span>
              </div>
            </div>
            <div className="grid auto">
              {data.departments.map((d) => (
                <DeptPie key={d.id} dept={d} />
              ))}
            </div>
          </div>

          {data.departments.length > 1 && (
            <div className="card">
              <div className="card-head">
                <h2>Which department is most productive?</h2>
                <span className="muted small">Share of goals completed</span>
              </div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(v, n, p) => [`${v}% (${p.payload.completed}/${p.payload.total} goals)`, 'Completed']}
                    />
                    <Bar dataKey="Completion %" fill={COLOR_BAR} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="grid cols-2" style={{ marginTop: 16, alignItems: 'start' }}>
            <div className="card" style={{ marginTop: 0 }}>
              <div className="card-head">
                <h2>Employee productivity</h2>
              </div>
              {data.employees.length === 0 ? (
                <div className="empty">No employees match these filters.</div>
              ) : (
                <div className="stack">
                  {data.employees.map((e) => (
                    <div key={e.id}>
                      <div className="row between small" style={{ marginBottom: 4 }}>
                        <span>
                          <strong>{e.name}</strong>{' '}
                          <span className="muted">
                            {e.department ? `· ${e.department}` : ''} {e.role === 'dept_head' ? `· ${ROLE_LABEL.dept_head}` : ''}
                          </span>
                        </span>
                        <span className="muted">
                          {e.total ? `${e.completed}/${e.total} · ${e.completion_pct}%` : 'no goals'}
                          {e.blocked > 0 && <span style={{ color: 'var(--danger)' }}> · {e.blocked} blocked</span>}
                        </span>
                      </div>
                      <Progress pct={e.completion_pct} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card" style={{ marginTop: 0 }}>
              <div className="card-head">
                <h2>Daily activity feed</h2>
                <span className="muted small">End-of-Day notes, newest first</span>
              </div>
              {feed.length === 0 ? (
                <div className="empty">No End-of-Day notes in this range.</div>
              ) : (
                <div className="feed">
                  {feed.map((n) => (
                    <div className="feed-item" key={n.id}>
                      <div className="row between small">
                        <span>
                          <strong>{n.user_name}</strong> <span className="muted">· {n.department}</span>
                        </span>
                        <span className="muted">{fmtDay(n.note_date)}</span>
                      </div>
                      <div style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{n.note}</div>
                      <div className="muted small">
                        {n.goals_total ? `${n.goals_completed}/${n.goals_total} goals completed` : 'No goals logged'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
