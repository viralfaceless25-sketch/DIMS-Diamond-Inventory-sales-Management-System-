const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
]);

function isSafeDocument(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || !DOCUMENT_MIME_TYPES.has(mimeType)) return false;
  if (mimeType === 'application/pdf') {
    return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  if (mimeType === 'image/png') {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    return buffer.length >= signature.length
      && buffer.subarray(0, signature.length).equals(signature);
  }
  return buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff;
}

function safeDownloadName(name, fallback = 'document') {
  const base = String(name || '')
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1) || String(fallback || 'document');
  const safe = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/"/g, '')
    .replace(/:/g, ' ')
    .replace(/[<>|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return safe || String(fallback || 'document').slice(0, 180);
}

module.exports = {
  DOCUMENT_MIME_TYPES,
  isSafeDocument,
  safeDownloadName,
};
