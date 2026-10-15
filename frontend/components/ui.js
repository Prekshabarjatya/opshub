'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { STATUSES, STATUS_LABEL, homeFor } from '@/lib/format';

export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] || status}</span>;
}

export function StatusSelect({ value, onChange, disabled }) {
  return (
    <select
      className="select inline-select"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Goal status"
    >
      {STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

export function Progress({ pct, tone = 'ok' }) {
  return (
    <div className={`bar ${tone === 'accent' ? 'accent' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

// Redirects away when the signed-in role is not allowed on a page. Returns true when access is OK.
export function useRoleGuard(roles) {
  const { user } = useAuth();
  const router = useRouter();
  const allowed = !!user && roles.includes(user.role);
  useEffect(() => {
    if (user && !allowed) router.replace(homeFor(user));
  }, [user, allowed, router]);
  return allowed;
}
