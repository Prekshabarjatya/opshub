'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useNotifications } from '@/lib/notifications';
import { dateStr, fmtDateTime } from '@/lib/format';
import { Progress, StatusBadge, useRoleGuard } from '@/components/ui';

const tagHref = (userId, ref) => `/messages?to_user=${userId}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`;

function Change({ value }) {
  if (value === null || value === undefined) return <span className="muted small">no data last week</span>;
  if (value === 0) return <span className="muted small">same as last week</span>;
  return (
    <span className={`small ${value > 0 ? 'text-ok' : 'text-bad'}`}>
      {value > 0 ? '▲' : '▼'} {Math.abs(value)} pts vs last week
    </span>
  );
}

function PeopleList({ people, empty, detail }) {
  if (!people.length) return <div className="empty">{empty}</div>;
  return (
    <ul className="today-list">
      {people.map((p) => (
        <li key={p.id}>
          <div>
            <Link href={`/worklog?user=${p.id}`} className="strong">{p.name}</Link>
            <div className="muted small">{p.department}{detail ? ` · ${detail(p)}` : ''}</div>
          </div>
          <Link className="btn btn-sm" href={tagHref(p.id)}>Nudge</Link>
        </li>
      ))}
    </ul>
  );
}

function PersonRow({ p, right, children }) {
  return (
    <li>
      <div className="grow">
        <Link href={`/worklog?user=${p.id}`} className="strong">{p.name}</Link>
        <div className="muted small">{p.department || 'No department'}</div>
        {children}
        {p.tasks && p.tasks.length > 0 && (
          <ul className="emp-tasks">
            {p.tasks.map((t) => (
              <li key={t.id} className={t.status === 'cancelled' ? 'cancelled' : ''}>
                <span className={t.status === 'completed' ? 'done' : ''}>{t.title}</span>
                <StatusBadge status={t.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {right}
    </li>
  );
}

function PulseDetail({ kind, data, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [kind]);
  const ppl = data.people;
  let title;
  let body;
  if (kind === 'planned') {
    const not = ppl.filter((p) => p.goals_today === 0);
    const yes = ppl.filter((p) => p.goals_today > 0).sort((a, b) => b.goals_today - a.goals_today);
    title = 'Who planned today';
    body = (
      <div className="grid cols-2 detail-cols">
        <div>
          <h3 className="detail-h">Not planned ({not.length})</h3>
          {not.length ? (
            <ul className="today-list">
              {not.map((p) => <PersonRow key={p.id} p={p} right={<Link className="btn btn-sm" href={tagHref(p.id, 'Please add your goals for today')}>Nudge</Link>} />)}
            </ul>
          ) : <div className="empty">Everyone has planned.</div>}
        </div>
        <div>
          <h3 className="detail-h">Planned ({yes.length})</h3>
          <ul className="today-list">
            {yes.map((p) => <PersonRow key={p.id} p={p} right={<span className="muted small">{p.goals_today} task{p.goals_today > 1 ? 's' : ''}</span>} />)}
          </ul>
        </div>
      </div>
    );
  } else if (kind === 'done') {
    const rows = ppl
      .filter((p) => p.goals_today > 0)
      .map((p) => ({ ...p, pct: Math.round((p.done_today / p.goals_today) * 100) }))
      .sort((a, b) => a.pct - b.pct);
    title = 'Progress by person today';
    body = (
      <ul className="today-list">
        {rows.map((p) => (
          <PersonRow key={p.id} p={p} right={<span className="small strong">{p.done_today}/{p.goals_today}</span>}>
            <div style={{ marginTop: 8 }}><Progress pct={p.pct} /></div>
          </PersonRow>
        ))}
      </ul>
    );
  } else {
    title = 'Completion by department, last 7 days';
    body = (
      <ul className="today-list">
        {[...data.departments].sort((a, b) => (a.week_pct ?? 101) - (b.week_pct ?? 101)).map((d) => (
          <li key={d.id}>
            <div className="grow">
              <div className="row between"><span className="strong">{d.name}</span><span className="small">{d.week_done}/{d.week_total} done · {d.week_pct ?? '-'}%</span></div>
              <div style={{ marginTop: 8 }}><Progress pct={d.week_pct || 0} /></div>
              <Change value={d.change} />
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="card detail-card" ref={ref}>
      <div className="card-head">
        <h2>{title}</h2>
        <button className="btn btn-sm" onClick={onClose}>Close</button>
      </div>
      {body}
    </div>
  );
}

export default function TodayPage() {
  const allowed = useRoleGuard(['super_admin', 'dept_head']);
  const { user } = useAuth();
  const { socket } = useNotifications();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(() => {
    api(`/api/analytics/today?date=${dateStr()}`)
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  // Refresh live when anyone updates a goal or EOD note.
  useEffect(() => {
    if (!socket) return;
    socket.on('activity', load);
    return () => socket.off('activity', load);
  }, [socket, load]);

  if (!allowed) return null;
  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!data)
    return (
      <div className="stack" aria-busy="true">
        <div className="skeleton" style={{ height: 34, width: 260 }} />
        <div className="skeleton" style={{ height: 150 }} />
        <div className="skeleton" style={{ height: 96 }} />
        <div className="skeleton" style={{ height: 220 }} />
      </div>
    );

  const t = data.today;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greet}, {user.name.split(' ')[0]}</h1>
          <p>What needs your attention {user.role === 'dept_head' ? 'in your team ' : ''}today.</p>
        </div>
        <Link className="btn" href="/analytics">Full report</Link>
      </div>

      <div className="card">
        <h2>Needs attention</h2>
        <ul className="insights">
          {data.insights.map((i, n) => (
            <li key={n} className={`insight ${i.tone}`}>{i.text}</li>
          ))}
        </ul>
      </div>

      <div className="grid cols-3 today-pulse">
        <button className={`card kpi kpi-btn ${detail === 'planned' ? 'on' : ''}`} onClick={() => setDetail(detail === 'planned' ? null : 'planned')} aria-expanded={detail === 'planned'}>
          <div className="label">Planned today</div>
          <div className="value">{t.planned}<span className="muted small"> / {t.people} people</span></div>
          <Progress pct={t.people ? Math.round((t.planned / t.people) * 100) : 0} />
        </button>
        <button className={`card kpi kpi-btn ${detail === 'done' ? 'on' : ''}`} onClick={() => setDetail(detail === 'done' ? null : 'done')} aria-expanded={detail === 'done'}>
          <div className="label">Tasks done today</div>
          <div className="value">{t.done}<span className="muted small"> / {t.goals}</span></div>
          <Progress pct={t.goals ? Math.round((t.done / t.goals) * 100) : 0} />
        </button>
        <button className={`card kpi kpi-btn ${detail === 'week' ? 'on' : ''}`} onClick={() => setDetail(detail === 'week' ? null : 'week')} aria-expanded={detail === 'week'}>
          <div className="label">This week completion</div>
          <div className="value">{data.week.pct ?? '–'}%</div>
          <Change value={data.week.change} />
        </button>
      </div>

      {detail && <PulseDetail kind={detail} data={data} onClose={() => setDetail(null)} />}

      <div className="card">
        <div className="card-head">
          <h2>Why work is stuck</h2>
          <span className="muted small">grouped by reason, biggest first</span>
        </div>
        {data.blocker_groups.length === 0 ? (
          <div className="empty">Nothing is blocked right now.</div>
        ) : (
          data.blocker_groups.map((g) => (
            <div key={g.reason} className="blocker-group">
              <button className="blocker-head" onClick={() => setOpen(open === g.reason ? null : g.reason)} aria-expanded={open === g.reason}>
                <span className="strong">{g.reason}</span>
                <span className="muted small">
                  {g.count} task{g.count > 1 ? 's' : ''} · {g.people.length} {g.people.length > 1 ? 'people' : 'person'} · oldest {Math.max(1, Math.round(g.oldest_hours / 24))}d
                </span>
                <span aria-hidden>{open === g.reason ? '▾' : '▸'}</span>
              </button>
              {open === g.reason && (
                <ul className="today-list">
                  {g.items.map((b) => (
                    <li key={b.id}>
                      <div>
                        <div>{b.title}</div>
                        <div className="muted small">{b.user_name} · {b.department} · {Math.round(b.hours_blocked / 24)}d</div>
                      </div>
                      <Link className="btn btn-sm" href={tagHref(b.user_id, b.title)}>Tag {b.user_name.split(' ')[0]}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <h2>No End-of-Day report yet</h2>
            <span className="muted small">{data.no_eod.length} of {t.people}</span>
          </div>
          <PeopleList
            people={data.no_eod}
            empty="Everyone has reported."
            detail={(p) => (p.goals_today ? `${p.done_today}/${p.goals_today} done` : 'no plan today')}
          />
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Gone quiet</h2>
            <span className="muted small">no update in 2+ days</span>
          </div>
          <PeopleList
            people={data.silent}
            empty="Everyone is active."
            detail={(p) => (p.last_update ? `last update ${fmtDateTime(p.last_update)}` : 'never updated')}
          />
        </div>
      </div>

      {data.departments.length > 1 && (
        <div className="card">
          <div className="card-head">
            <h2>Departments this week</h2>
            <span className="muted small">weakest first · last 7 days vs the 7 before</span>
          </div>
          <ul className="today-list">
            {[...data.departments].sort((a, b) => (a.week_pct ?? 101) - (b.week_pct ?? 101)).map((d) => (
              <li key={d.id}>
                <div className="grow">
                  <div className="row between"><span className="strong">{d.name}</span><span>{d.week_pct ?? '–'}%</span></div>
                  <Progress pct={d.week_pct || 0} />
                  <Change value={d.change} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
