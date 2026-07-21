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

export function isComposerDeletionKey(key: string): boolean {
  return key === 'Backspace' || key === 'Delete';
}

export function isComposerDeletionInput(inputType: string): boolean {
  return inputType.startsWith('delete');
}
