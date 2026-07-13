type AnyValue = ReturnType<typeof JSON.parse>;

interface Window {
  require?: (moduleId: string) => unknown;
  createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: DomElementInfo | string,
    callback?: (element: HTMLElementTagNameMap[K]) => void,
  ): HTMLElementTagNameMap[K];
  createDiv(options?: DomElementInfo | string, callback?: (element: HTMLDivElement) => void): HTMLDivElement;
  createSpan(options?: DomElementInfo | string, callback?: (element: HTMLSpanElement) => void): HTMLSpanElement;
}
type ProcessEnvMap = Record<string, string | undefined>;
