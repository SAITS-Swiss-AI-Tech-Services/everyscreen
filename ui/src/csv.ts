// CSV for spreadsheets: quotes fields with separators or line breaks, and keeps
// cells that start like a formula from being run as one.

function cell(v: unknown) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(head: string[], rows: unknown[][]) {
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

export function downloadCsv(text: string, filename: string) {
  // BOM so Excel reads UTF-8 (names, umlauts)
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** 'Trail Mix!' -> 'trail-mix', for download file names. */
export const fileSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'screens';
