'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useNotifications } from '@/lib/notifications';
import { dateStr, fmtDateTime } from '@/lib/format';
import { Progress, useRoleGuard } from '@/components/ui';

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

export default function TodayPage() {
  const allowed = useRoleGuard(['super_admin', 'dept_head']);
  const { user } = useAuth();
  const { socket } = useNotifications();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

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
        <div className="card kpi">
          <div className="label">Planned today</div>
          <div className="value">{t.planned}<span className="muted small"> / {t.people} people</span></div>
          <Progress pct={t.people ? Math.round((t.planned / t.people) * 100) : 0} />
        </div>
        <div className="card kpi">
          <div className="label">Tasks done today</div>
          <div className="value">{t.done}<span className="muted small"> / {t.goals}</span></div>
          <Progress pct={t.goals ? Math.round((t.done / t.goals) * 100) : 0} />
        </div>
        <div className="card kpi">
          <div className="label">This week completion</div>
          <div className="value">{data.week.pct ?? '–'}%</div>
          <Change value={data.week.change} />
        </div>
      </div>

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
