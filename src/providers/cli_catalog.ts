import { REASONING_EFFORT_OPTIONS, reasoningOptionsForEndpoint, type CliModelInfo, type Endpoint, type ReasoningEffort } from '../types';

export function cliRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function label(value: unknown): string { return typeof value === 'string' ? value.replace(/[\r\n\0]/g, ' ').trim().slice(0, 400) : ''; }
function effort(value: unknown): value is ReasoningEffort { return typeof value === 'string' && value !== 'off' && REASONING_EFFORT_OPTIONS.includes(value as ReasoningEffort); }

export function parseCliModels(kind: Endpoint['kind'], rows: unknown): CliModelInfo[] {
  if (!Array.isArray(rows)) return [];
  const models = new Map<string, CliModelInfo>();
  for (const raw of rows.slice(0, 200)) {
    const row = cliRecord(raw);
    if (row.hidden === true) continue;
    const meta = cliRecord(row._meta);
    const id = label(kind === 'codex-cli' ? row.model || row.id : kind === 'grok-cli' ? row.modelId : row.value);
    if (!id || id.length > 200 || /\s/.test(id)) continue;
    const values = kind === 'codex-cli' ? row.supportedReasoningEfforts : kind === 'grok-cli' ? meta.reasoningEfforts : row.supportedEffortLevels;
    const efforts = Array.isArray(values) ? values.map((v: unknown) => kind === 'codex-cli' ? cliRecord(v).reasoningEffort : kind === 'grok-cli' ? cliRecord(v).value : v).filter(effort) : [];
    models.set(id, { id, label: label(row.displayName || row.name) || id, efforts: [...new Set(efforts)],
      ...(label(row.resolvedModel) ? { resolvedModel: label(row.resolvedModel) } : {}),
      ...(label(row.description) ? { description: label(row.description) } : {}),
      ...(effort(row.defaultReasoningEffort) && efforts.includes(row.defaultReasoningEffort) ? { defaultEffort: row.defaultReasoningEffort } : {}),
      isDefault: row.isDefault === true || id === 'default',
    });
  }
  return [...models.values()];
}

/** Preserve a compatible preference; otherwise let the CLI choose its default. */
export function reconcileCliEffort(ep: Endpoint): void {
  if (ep.customReasoningEffort) return;
  if (ep.kind !== 'custom-api' && !reasoningOptionsForEndpoint(ep).includes(ep.reasoningEffort ?? 'off')) ep.reasoningEffort = 'off';
}

export function cliModelLabel(ep: Endpoint): string {
  if (!ep.model) return '';
  const info = ep.cliModels?.find(m => m.id === ep.model || m.resolvedModel === ep.model);
  return info?.resolvedModel || info?.label || ep.model || '';
}
