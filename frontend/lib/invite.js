import { api } from './api';

// Makes a one-time sign-in link for a person and shares it (phone share sheet, else clipboard).
// The token sits after `#`, so it never reaches any server log or analytics.
export async function shareLoginLink(person) {
  const { token } = await api(`/api/users/${person.id}/login-link`, { method: 'POST' });
  const url = `${window.location.origin}/login#k=${token}`;
  const text = `Hi ${person.name.split(' ')[0]}, open this link to sign in to OpsHub (works once, valid 7 days):`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'OpsHub sign-in', text, url });
      return 'Sign-in link shared.';
    } catch (e) {
      if (e && e.name === 'AbortError') return '';
    }
  }
  await navigator.clipboard.writeText(`${text} ${url}`);
  return `Sign-in link for ${person.name} copied. Paste it in WhatsApp or email.`;
}
