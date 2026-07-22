import release from '@/release.json';

const ACCENT = '#34d399';

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function DownloadPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#0a0e0d', color: '#f8fafc', padding: '48px 20px' }}>
      <section style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 36 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: ACCENT, color: '#07110d', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 21 }}>D</div>
          <div>
            <div style={{ fontSize: 21, fontWeight: 750 }}>Diamond Inventory</div>
            <div style={{ color: '#94a3b8', marginTop: 2, fontSize: 13 }}>Shared inventory for Maitri Diamonds</div>
          </div>
        </div>

        <div style={{ background: '#111a17', border: '1px solid #203129', borderRadius: 18, padding: '34px 32px', boxShadow: '0 24px 70px rgba(0,0,0,.28)' }}>
          <div style={{ color: ACCENT, fontWeight: 700, fontSize: 13, letterSpacing: '.05em', textTransform: 'uppercase' }}>Windows desktop app</div>
          <h1 style={{ fontSize: 32, lineHeight: 1.18, margin: '10px 0 12px' }}>Download and start working</h1>
          <p style={{ color: '#a7b5ae', fontSize: 15, lineHeight: 1.65, margin: '0 0 26px' }}>
            The installer includes everything needed to connect to the shared online inventory. No database, server, Node.js, or developer setup is required on the computer.
          </p>

          <a href={release.downloadUrl} download={release.fileName} style={{ display: 'inline-block', background: ACCENT, color: '#07110d', textDecoration: 'none', padding: '13px 20px', borderRadius: 10, fontWeight: 750 }}>
            Download Diamond Inventory {release.version}
          </a>

          <dl style={{ display: 'grid', gridTemplateColumns: '145px 1fr', gap: '10px 18px', margin: '28px 0 0', color: '#cbd5e1', fontSize: 13 }}>
            <dt style={{ color: '#7f9288' }}>Compatibility</dt><dd style={{ margin: 0 }}>Windows 10 and Windows 11, 64-bit</dd>
            <dt style={{ color: '#7f9288' }}>Download size</dt><dd style={{ margin: 0 }}>{formatBytes(release.sizeBytes)}</dd>
            <dt style={{ color: '#7f9288' }}>Version</dt><dd style={{ margin: 0 }}>{release.version}</dd>
            <dt style={{ color: '#7f9288' }}>SHA-256</dt><dd style={{ margin: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, overflowWrap: 'anywhere' }}>{release.sha256}</dd>
          </dl>
        </div>

        <div style={{ marginTop: 22, border: '1px solid #24332c', borderRadius: 14, padding: '21px 24px', background: '#0e1613' }}>
          <h2 style={{ fontSize: 16, margin: '0 0 9px' }}>If Windows shows “Windows protected your PC”</h2>
          <p style={{ color: '#9aa9a1', fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
            This first release is not code-signed. Select <strong style={{ color: '#dce6e1' }}>More info</strong>, confirm the app name is Diamond Inventory, then select <strong style={{ color: '#dce6e1' }}>Run anyway</strong>. The checksum above lets an administrator verify that the download is unchanged.
          </p>
        </div>
      </section>
    </main>
  );
}
