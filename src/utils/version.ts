/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Dynamic plugin and host-app boundaries validate these values at runtime. */
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
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/only-throw-error, @typescript-eslint/no-unused-vars -- Re-enable review lint rules after dynamic boundary module. */
