import type { Endpoint } from '../types';
import { bi } from '../utils/i18n';
import { cliModelLabel } from '../providers/cli_catalog';
import type { PopupItem } from './popup';

export function cliModelItems(ep: Endpoint, select: (model: string) => void | Promise<void>): PopupItem[] {
  const items: PopupItem[] = [{ label: bi('Use CLI default', '跟随 CLI 默认模型'), checked: !ep.model, onSelect: () => select('') }];
  const models = ep.cliModels ?? [];
  const selected = ep.model ? models.find(m => m.id === ep.model) ?? models.find(m => m.resolvedModel === ep.model) : undefined;
  for (const model of models) items.push({
    label: model.resolvedModel || model.label,
    hint: model.id !== model.resolvedModel && model.resolvedModel ? model.id : undefined,
    searchText: `${model.id} ${model.label} ${model.description ?? ''} ${model.resolvedModel ?? ''}`,
    section: bi('Available models', '可用模型'),
    checked: selected?.id === model.id,
    onSelect: () => select(model.id),
  });
  if (ep.model && !models.some(m => m.id === ep.model || m.resolvedModel === ep.model)) items.push({
    label: cliModelLabel(ep), hint: bi('Custom', '自定义'), checked: true,
    section: bi('Current model', '当前模型'), onSelect: () => select(ep.model ?? ''),
  });
  return items;
}
