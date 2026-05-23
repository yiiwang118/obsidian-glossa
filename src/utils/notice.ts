import { Notice } from 'obsidian';

/**
 * Drop-in for new Notice() with: shorter default timeout (1.6s) + a close × so users
 * can dismiss immediately.
 */
export function quickNotice(text: string, timeoutMs = 1600): Notice {
  const n = new Notice(text, timeoutMs);
  // Add a close × on the right
  try {
    const x = document.createElement('span');
    x.textContent = '✕';
    x.style.marginLeft = '10px';
    x.style.cursor = 'pointer';
    x.style.opacity = '0.55';
    x.style.fontSize = '11px';
    x.onclick = (e) => { e.stopPropagation(); n.hide(); };
    n.noticeEl.appendChild(x);
  } catch {}
  return n;
}
