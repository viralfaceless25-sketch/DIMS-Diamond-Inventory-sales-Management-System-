'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { homeFor, useAuth } from '@/lib/auth';
import { ACCENT } from '@/lib/theme';

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // If already logged in, skip the form.
  useEffect(() => {
    if (loading || !user) return;
    router.replace(homeFor(user));
  }, [user, loading, router]);

  async function onSubmit() {
    setError('');
    setSubmitting(true);
    try {
      const u = await login(email.trim(), password);
      router.replace(homeFor(u));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0e0d', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28, justifyContent: 'center' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 18px 'Inter'", color: '#0a0e0d' }}>D</div>
          <div style={{ font: "700 20px 'Inter'", color: '#fff' }}>Diamond ERP</div>
        </div>

        <div style={{ background: '#111a17', border: '1px solid #182420', borderRadius: 14, padding: 28 }}>
          <div style={{ font: "600 15px 'Inter'", color: '#fff', marginBottom: 4 }}>Sign in</div>
          <div style={{ font: "400 12.5px 'Inter'", color: 'oklch(55% 0.01 150)', marginBottom: 22 }}>
            Inventory staff and sales reps use the same login.
          </div>

          <label style={labelStyle}>Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
            placeholder="you@maitri.nyc"
            autoComplete="email"
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 16 }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
            placeholder="••••••••"
            autoComplete="current-password"
            style={inputStyle}
          />

          {error && (
            <div style={{ marginTop: 14, font: "500 12px 'Inter'", color: 'oklch(70% 0.17 30)', background: 'oklch(70% 0.17 30 / 0.12)', border: '1px solid oklch(70% 0.17 30 / 0.3)', borderRadius: 8, padding: '9px 12px' }}>
              {error}
            </div>
          )}

          <button
            onClick={onSubmit}
            disabled={submitting || !email || !password}
            style={{
              marginTop: 22,
              width: '100%',
              padding: '11px',
              borderRadius: 9,
              border: 'none',
              cursor: submitting || !email || !password ? 'default' : 'pointer',
              background: submitting || !email || !password ? '#1c2924' : ACCENT,
              color: submitting || !email || !password ? 'oklch(55% 0.01 150)' : '#0a0e0d',
              font: "600 13.5px 'Inter'",
              transition: 'background 0.12s',
            }}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </div>

      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  font: "600 11px 'Inter'",
  color: 'oklch(60% 0.01 150)',
  marginBottom: 7,
  letterSpacing: '0.02em',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0d1412',
  border: '1px solid #1e2b26',
  borderRadius: 9,
  padding: '10px 13px',
  color: '#fff',
  font: "400 13.5px 'Inter'",
  outline: 'none',
};
