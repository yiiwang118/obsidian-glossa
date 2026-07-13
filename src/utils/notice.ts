
import { Notice } from 'obsidian';
import { setStyle } from './dom';

/**
 * Drop-in for new Notice() with: shorter default timeout (1.6s) + a close × so users
 * can dismiss immediately.
 */
export function quickNotice(text: string, timeoutMs = 1600): Notice {
  const n = new Notice(text, timeoutMs);
  // Add a close × on the right
  try {
    const x = activeWindow.createSpan();
    x.textContent = '✕';
    setStyle(x, { marginLeft: '10px' });
    setStyle(x, { cursor: 'pointer' });
    setStyle(x, { opacity: '0.55' });
    setStyle(x, { fontSize: '11px' });
    x.onclick = (e) => { e.stopPropagation(); n.hide(); };
    n.messageEl.appendChild(x);
  } catch { /* ignore */ }
  return n;
}
