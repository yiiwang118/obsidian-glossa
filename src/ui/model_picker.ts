import type { Endpoint } from '../types';
import { bi } from '../utils/i18n';
import type { PopupItem, PopupOptions } from './popup';

export function modelPickerOptions(): PopupOptions {
  return {
    searchPlaceholder: bi('Search models or providers…', '搜索模型或服务商…'),
    emptyText: bi('No matching models', '没有匹配的模型'),
  };
}

export function modelPickerItems(
  endpoints: Endpoint[],
  selectedEndpointId: string,
  selectedModel: string,
  onSelect: (endpoint: Endpoint, model: string) => void | Promise<void>,
): PopupItem[] {
  return endpoints.flatMap(endpoint => {
    const models = [...new Set([
      endpoint.id === selectedEndpointId ? selectedModel : '',
      endpoint.model ?? '', ...(endpoint.availableModels ?? []),
    ].map(model => model.trim()).filter(Boolean))];
    return (models.length ? models : ['']).map(model => ({
      label: model || bi('Default model', '默认模型'),
      section: endpoint.label,
      searchText: `${endpoint.id} ${endpoint.kind} ${model}`,
      checked: endpoint.id === selectedEndpointId && model === selectedModel,
      onSelect: () => onSelect(endpoint, model),
    }));
  });
}
