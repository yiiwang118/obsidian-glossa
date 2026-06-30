export function normalizeVersion(v: string): string {
  return String(v || '').trim().replace(/^v/i, '');
}

export function compareSemver(a: string, b: string): number {
  const pa = normalizeVersion(a).split(/[.-]/);
  const pb = normalizeVersion(b).split(/[.-]/);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const xa = pa[i] ?? '0';
    const xb = pb[i] ?? '0';
    const na = Number.parseInt(xa, 10);
    const nb = Number.parseInt(xb, 10);
    const aNum = Number.isFinite(na) && String(na) === xa;
    const bNum = Number.isFinite(nb) && String(nb) === xb;
    if (aNum && bNum && na !== nb) return na > nb ? 1 : -1;
    if (aNum !== bNum) return aNum ? 1 : -1;
    if (!aNum && !bNum && xa !== xb) return xa > xb ? 1 : -1;
  }
  return 0;
}

