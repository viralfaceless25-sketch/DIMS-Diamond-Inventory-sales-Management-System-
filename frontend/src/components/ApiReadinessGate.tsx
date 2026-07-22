'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { waitForApiReady } from '@/lib/readiness';
import { ACCENT } from '@/lib/theme';

type Status = 'checking' | 'ready' | 'timeout';

export function ApiReadinessGate({
  apiUrl,
  children,
}: {
  apiUrl: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isPublicDownload = pathname.startsWith('/download');
  const [status, setStatus] = useState<Status>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (isPublicDownload) return;
    let active = true;
    setStatus('checking');
    waitForApiReady(apiUrl).then((result) => {
      if (active) setStatus(result);
    });
    return () => {
      active = false;
    };
  }, [apiUrl, attempt, isPublicDownload]);

  if (isPublicDownload || status === 'ready') return children;

  return (
    <main style={styles.page}>
      <section style={styles.card} aria-live="polite">
        <div style={styles.mark}>D</div>
        <h1 style={styles.title}>Diamond Inventory</h1>
        {status === 'checking' ? (
          <>
            <div style={styles.spinner} aria-hidden="true" />
            <p style={styles.message}>Waking up the inventory server...</p>
            <p style={styles.detail}>The free server can take up to a minute after being idle.</p>
          </>
        ) : (
          <>
            <p style={styles.message}>The inventory server did not respond.</p>
            <p style={styles.detail}>Check your internet connection, then try again.</p>
            <button type="button" style={styles.button} onClick={() => setAttempt((value) => value + 1)}>
              Retry
            </button>
          </>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    background: '#0a0e0d',
    color: '#f4f7f5',
    padding: 24,
    fontFamily: "Inter, system-ui, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: 420,
    padding: '36px 30px',
    textAlign: 'center',
    border: '1px solid #1e2b26',
    borderRadius: 16,
    background: '#111a17',
  },
  mark: {
    width: 44,
    height: 44,
    margin: '0 auto 14px',
    display: 'grid',
    placeItems: 'center',
    borderRadius: 11,
    background: ACCENT,
    color: '#0a0e0d',
    fontWeight: 800,
    fontSize: 19,
  },
  title: { margin: 0, fontSize: 20, fontWeight: 750 },
  spinner: {
    width: 28,
    height: 28,
    margin: '28px auto 18px',
    border: '3px solid #26352f',
    borderTopColor: ACCENT,
    borderRadius: '50%',
    animation: 'server-wake-spin 0.9s linear infinite',
  },
  message: { margin: '26px 0 7px', fontSize: 14, fontWeight: 650 },
  detail: { margin: 0, color: '#91a39b', fontSize: 12.5, lineHeight: 1.5 },
  button: {
    marginTop: 22,
    padding: '10px 24px',
    border: 0,
    borderRadius: 9,
    background: ACCENT,
    color: '#0a0e0d',
    fontWeight: 700,
    cursor: 'pointer',
  },
};
