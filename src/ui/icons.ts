/* Inline SVG icons (Lucide-style). */

const svg = (path: string, extras = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extras}>${path}</svg>`;

/* ============================================================
   Glossa mark — the user-authored cloud-moon-sparkles glyph.
   Two-tone cyan→blue→purple gradient burned into the stroke so the
   icon stays in brand colour in brand surfaces (tab, role badge,
   empty-state hero), independent of light/dark theme. viewBox cropped tight to the
   artwork so Obsidian's icon system renders it crisply at 16-24px.
   `glossa-mark-grad` is the SVG-internal gradient id; modern browsers
   resolve url(#…) lookups within the same SVG fragment, so repeated
   inline copies in the chat transcript don't collide.
   ============================================================ */
const GLOSSA_MARK_PATHS = `<path d="M120.2 131.7 C112.4 125.1 108.2 115.8 109.1 105.6 C110.4 91.1 121.7 80.6 136.2 79.9 C140.7 64.6 154.3 55.1 171.5 54.2 C178.1 53.9 184.1 54.9 189.8 57.1 M226.9 72.5 C235.1 77.6 239.8 86.3 239.2 96.2 C246.2 100.6 249.8 108.5 249 117 C247.9 130.3 236.8 140.4 222.7 140.4 C218.5 149.6 209.8 155.7 199.5 155.8 C190.5 156 182.8 151.9 178.1 145.3 C172.8 150.8 165.5 153.8 157.7 153.4 C150.7 153.1 144.7 150.6 139.9 146.3"/><path d="M175.8 73.3 C160.9 79.1 151.1 94.2 153.4 110.6 C156.3 131.2 175.5 145.4 196.1 142.4 C205.7 141.1 214.1 136.2 220 129 C216.7 130.6 213.1 131.7 209.2 132.2 C189.2 135.1 170.8 121.2 168 101.3 C166.5 90.8 169.7 80.8 175.8 73.3Z"/><circle cx="140.1" cy="143.8" r="15.9"/><circle cx="118.8" cy="168.3" r="7.6"/><path d="M208.9 52 C210.8 61.1 214.5 64.8 223.6 66.7 C214.5 68.6 210.8 72.3 208.9 81.4 C207 72.3 203.3 68.6 194.2 66.7 C203.3 64.8 207 61.1 208.9 52Z"/><path d="M195.5 84.5 C197 91.1 199.7 93.9 206.2 95.4 C199.7 96.9 197 99.6 195.5 106.2 C194 99.6 191.3 96.9 184.7 95.4 C191.3 93.9 194 91.1 195.5 84.5Z"/>`;

export const GLOSSA_MARK_SVG = `<svg viewBox="98 38 154 154" xmlns="http://www.w3.org/2000/svg" fill="none"><defs><linearGradient id="glossa-mark-grad" x1="104" y1="172" x2="238" y2="52" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#10c8f4"/><stop offset="0.48" stop-color="#2f86ff"/><stop offset="1" stop-color="#654cf3"/></linearGradient></defs><g stroke="url(#glossa-mark-grad)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${GLOSSA_MARK_PATHS}</g></svg>`;

/* Same mark, but monochrome. Used only for Obsidian's ribbon so it matches
   the host app's other sidebar icons and inherits theme color via currentColor. */
export const GLOSSA_RIBBON_SVG = `<svg viewBox="98 38 154 154" xmlns="http://www.w3.org/2000/svg" fill="none"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${GLOSSA_MARK_PATHS}</g></svg>`;

/* ============================================================
   Aurora orb — empty-state hero (v2: echoes the brand mark)
   ------------------------------------------------------------
   Composition:
     • Soft cyan→blue→purple radial halo (same colour story as the
       Glossa mark's stroke gradient, just diffused)
     • The brand mark itself, rendered at the centre with its native
       cyan→blue→purple linearGradient stroke
   This replaces the earlier solid violet sphere — that one clashed
   with the cyan-blue-purple identity of the icon and gave the empty
   state a disconnected feel.
   Two wrapper `<g>`s isolate the breath animations from the inner
   `transform` math: the outer wrap scales while the inner mark keeps
   its translate-scale-translate positioning intact (CSS would replace
   the entire SVG transform otherwise, breaking the mark's position).
   ============================================================ */
export const AURORA_ORB_SVG = `<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" fill="none">
  <defs>
    <radialGradient id="g-orb-halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#654cf3" stop-opacity="0.40"/>
      <stop offset="38%"  stop-color="#2f86ff" stop-opacity="0.22"/>
      <stop offset="78%"  stop-color="#10c8f4" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#10c8f4" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="g-orb-mark-grad" x1="20" y1="108" x2="108" y2="20" gradientUnits="userSpaceOnUse">
      <stop offset="0"    stop-color="#10c8f4"/>
      <stop offset="0.48" stop-color="#2f86ff"/>
      <stop offset="1"    stop-color="#654cf3"/>
    </linearGradient>
    <filter id="g-orb-soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.2"/>
    </filter>
  </defs>
  <g class="g-orb-halo-wrap">
    <circle class="g-orb-halo" cx="64" cy="64" r="62" fill="url(#g-orb-halo)" filter="url(#g-orb-soft)"/>
  </g>
  <g class="g-orb-mark-wrap">
    <g class="g-orb-mark"
       stroke="url(#g-orb-mark-grad)"
       stroke-width="11"
       stroke-linecap="round"
       stroke-linejoin="round"
       transform="translate(64 64) scale(0.50) translate(-175 -115)">
      <path d="M120.2 131.7 C112.4 125.1 108.2 115.8 109.1 105.6 C110.4 91.1 121.7 80.6 136.2 79.9 C140.7 64.6 154.3 55.1 171.5 54.2 C178.1 53.9 184.1 54.9 189.8 57.1 M226.9 72.5 C235.1 77.6 239.8 86.3 239.2 96.2 C246.2 100.6 249.8 108.5 249 117 C247.9 130.3 236.8 140.4 222.7 140.4 C218.5 149.6 209.8 155.7 199.5 155.8 C190.5 156 182.8 151.9 178.1 145.3 C172.8 150.8 165.5 153.8 157.7 153.4 C150.7 153.1 144.7 150.6 139.9 146.3"/>
      <path d="M175.8 73.3 C160.9 79.1 151.1 94.2 153.4 110.6 C156.3 131.2 175.5 145.4 196.1 142.4 C205.7 141.1 214.1 136.2 220 129 C216.7 130.6 213.1 131.7 209.2 132.2 C189.2 135.1 170.8 121.2 168 101.3 C166.5 90.8 169.7 80.8 175.8 73.3Z"/>
      <circle cx="140.1" cy="143.8" r="15.9"/>
      <circle cx="118.8" cy="168.3" r="7.6"/>
      <path d="M208.9 52 C210.8 61.1 214.5 64.8 223.6 66.7 C214.5 68.6 210.8 72.3 208.9 81.4 C207 72.3 203.3 68.6 194.2 66.7 C203.3 64.8 207 61.1 208.9 52Z"/>
      <path d="M195.5 84.5 C197 91.1 199.7 93.9 206.2 95.4 C199.7 96.9 197 99.6 195.5 106.2 C194 99.6 191.3 96.9 184.7 95.4 C191.3 93.9 194 91.1 195.5 84.5Z"/>
    </g>
  </g>
</svg>`;

export const ICON = {
  plus: svg(`<path d="M12 5v14M5 12h14"/>`),
  cog: svg(`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`),
  history: svg(`<path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/><path d="M12 7v5l4 2"/>`),
  more: svg(`<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>`),
  image: svg(`<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>`),
  paperclip: svg(`<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>`),
  upload: svg(`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`),
  send: svg(`<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>`),
  file: svg(`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`),
  folder: svg(`<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`),
  tag: svg(`<path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>`),
  link: svg(`<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`),
  globe: svg(`<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`),
  selection: svg(`<path d="M9 4v16M15 4v16M3 9h2M3 15h2M19 9h2M19 15h2"/>`),
  quote: svg(`<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>`),
  pin: svg(`<path d="m12 17 .01 5M9 3l.094.07a4 4 0 0 1 1.45 1.453L13 9l-3 .54a3 3 0 0 0-2.43 2.47L7 14h10l-.57-2a3 3 0 0 0-2.43-2.47L11 9l2.456-4.477A4 4 0 0 1 14.906 3.07L15 3z"/>`),
  // Role badge inside every assistant message — same glyph as the brand mark.
  bot: GLOSSA_MARK_SVG,
  user: svg(`<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`),
  stop: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
  wrench: svg(`<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>`),
  copy: svg(`<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`),
  refresh: svg(`<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>`),
  arrowDown: svg(`<polyline points="6 9 12 15 18 9"/>`),
  arrowRight: svg(`<polyline points="9 18 15 12 9 6"/>`),
  insert: svg(`<path d="M12 5v14M5 12h14"/><path d="M3 19h18"/>`),
  apply: svg(`<polyline points="20 6 9 17 4 12"/>`),
  trash: svg(`<polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>`),
  sparkles: svg(`<path d="M12 3l1.9 5.7L19 10l-5.1 1.3L12 17l-1.9-5.7L5 10l5.1-1.3z"/>`),
  x: svg(`<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`),
  check: svg(`<polyline points="20 6 9 17 4 12"/>`),
  zap: svg(`<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`),
  brain: svg(`<path d="M12 2a3 3 0 0 0-3 3v0a3 3 0 0 0-3 3 3 3 0 0 0-3 3 3 3 0 0 0 1 2.2A3 3 0 0 0 4 17a3 3 0 0 0 3 3 3 3 0 0 0 3 3h0a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3z"/><path d="M12 2a3 3 0 0 1 3 3v0a3 3 0 0 1 3 3 3 3 0 0 1 3 3 3 3 0 0 1-1 2.2A3 3 0 0 1 20 17a3 3 0 0 1-3 3 3 3 0 0 1-3 3h0"/>`),
  /* Single-circle spinner ring — CSS spins it via animation. Used by
     the streaming indicator pip and the in-flight Notice. */
  spinnerRing: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>`,
  /* File/folder icon used for "checkpoint snapshot" badges. */
  folderFile: svg(`<path d="M21 8a2 2 0 0 0-2-2h-4l-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8z"/><path d="M7 14h10"/><path d="M7 18h6"/>`),
  /* Chunky chevron-down for collapse toggles (heavier stroke than arrowDown). */
  chevronDown: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  /* Undo (refresh-arrow) — slightly smaller than `refresh`, paired with text in buttons. */
  undo: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>`,
  /* Thick check used inside the code-block copy button. Bigger stroke
     than `check` so it reads at 12px against a dark button bg. */
  checkThick: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  /* Thinner plus for the inline attach button. */
  plusThin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`,
};
