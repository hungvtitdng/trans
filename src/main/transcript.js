'use strict';

const LAST_CUE_MS = 4000;
const MAX_CUE_MS = 7000;

const pad = (n, w = 2) => String(n).padStart(w, '0');

function formatSrtTime(ms) {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

function formatClock(time) {
  const d = new Date(time);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// entries: [{ id, time (ms epoch), source, translation? }]
// Mỗi cue kéo dài tới câu kế tiếp (tối đa 7 giây), không bao giờ chồng lên cue sau.
function toSrt(entries) {
  if (!entries.length) return '';
  const t0 = entries[0].time;
  return entries
    .map((e, i) => {
      const start = e.time - t0;
      const next = entries[i + 1];
      const end = next ? Math.max(start, Math.min(start + MAX_CUE_MS, next.time - t0)) : start + LAST_CUE_MS;
      const text = e.translation ? `${e.translation}\n${e.source}` : e.source;
      return `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n`;
    })
    .join('\n');
}

function toTxt(entries) {
  return entries
    .map((e) => `[${formatClock(e.time)}] ${e.source}\n→ ${e.translation || '(chưa dịch)'}`)
    .join('\n\n');
}

module.exports = { formatSrtTime, formatClock, toSrt, toTxt };
