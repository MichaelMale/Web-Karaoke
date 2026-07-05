// Scoreboard: persisted in localStorage, rendered as a ranked table.

import { config } from './config.js';

export function addScore({ singer, song, artist, grade, total }) {
  const scores = config.scores;
  scores.push({ singer, song, artist, grade, total, at: Date.now() });
  scores.sort((a, b) => b.total - a.total);
  config.scores = scores.slice(0, 100);
}

export function clearScores() { config.scores = []; }

export function renderScoreboard(tbody, emptyEl) {
  const scores = config.scores;
  tbody.innerHTML = '';
  emptyEl.hidden = scores.length > 0;

  scores.forEach((s, i) => {
    const tr = document.createElement('tr');
    if (i < 3) tr.classList.add(`top${i + 1}`);
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td></td>
      <td></td>
      <td class="grade">${escape(s.grade)}</td>
      <td class="num">${s.total.toLocaleString()}</td>
      <td class="when">${new Date(s.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</td>`;
    tr.children[1].textContent = s.singer;
    tr.children[2].textContent = `${s.song} — ${s.artist}`;
    tbody.appendChild(tr);
  });
}

function escape(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
