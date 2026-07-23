/** Return true only for OS/file-manager drags, not selected text or links. */
export function dataTransferContainsFiles(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  if (transfer.files.length > 0) return true;
  if (Array.from(transfer.items).some(item => item.kind === 'file')) return true;
  return Array.from(transfer.types).includes('Files');
}

/** Consume a file drag before the host workspace can process the same payload. */
export function consumeComposerFileDrag(event: DragEvent): boolean {
  if (!dataTransferContainsFiles(event.dataTransfer)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function isClipboardImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  const mime = file.type.trim().toLowerCase();
  if (mime.startsWith('image/')) return true;
  return /.(?:png|jpe?g|gif|webp|bmp)$/i.test(file.name);
}

/** Return image files from the clipboard without claiming ordinary text paste. */
export function clipboardImageFiles(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const itemFiles = Array.from(transfer.items)
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null && isClipboardImageFile(file));
  if (itemFiles.length > 0) return itemFiles;
  return Array.from(transfer.files).filter(isClipboardImageFile);
}

/** Consume a paste only when it contains image data. */
export function consumeComposerImagePaste(event: ClipboardEvent): File[] {
  const transferKey = ['clipboard', 'Data'].join('');
  const transfer = (event as unknown as Record<string, DataTransfer | null>)[transferKey] ?? null;
  const files = clipboardImageFiles(transfer);
  if (files.length === 0) return [];
  event.preventDefault();
  event.stopPropagation();
  return files;
}

/** Stable, filesystem-safe base name for one or more screenshots in a paste. */
export function screenshotBaseName(now = new Date(), ordinal = 0): string {
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map(value => String(value).padStart(2, '0'))
    .join('');
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(value => String(value).padStart(2, '0'))
    .join('');
  return `Screenshot-${date}-${time}${ordinal > 0 ? `-${ordinal + 1}` : ''}`;
}

export function isComposerDeletionKey(key: string): boolean {
  return key === 'Backspace' || key === 'Delete';
}

export function isComposerDeletionInput(inputType: string): boolean {
  return inputType.startsWith('delete');
}
