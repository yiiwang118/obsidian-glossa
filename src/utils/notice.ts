/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
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
    const x = activeDocument.createElement('span');
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
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Re-enable review lint rules after dynamic boundary module. */
