import type { SessionCheckpoint } from '../agent/checkpoint';
import { bi } from '../utils/i18n';
import { el } from '../utils/dom';

export function renderEditSummary(
  parent: HTMLElement,
  checkpoint: SessionCheckpoint,
  actions: { open: (path: string) => void; undo: (paths?: string[]) => Promise<void>; busy: () => boolean },
): HTMLElement | null {
  const files = checkpoint.snapshots.filter(snapshot => snapshot.after?.change);
  if (!files.length) return null;
  const card = el('section', { className: 'nc-edit-summary', parent });
  const header = el('div', { className: 'nc-edit-summary-header', parent: card });
  const title = el('strong', { text: bi(`Changes this turn · ${files.length} files`, `本轮修改 · ${files.length} 个文件`), parent: header });
  title.setAttribute('role', 'heading');
  title.setAttribute('aria-level', '3');
  const active = files.filter(file => !file.restoredAt);
  const buttons: HTMLButtonElement[] = [];
  let undoing = false;
  const undoButton = (container: HTMLElement, label: string, paths?: string[]) => {
    const button = el('button', { className: 'nc-edit-summary-undo', type: 'button', text: label, parent: container });
    buttons.push(button);
    button.onclick = () => {
      if (undoing || actions.busy()) return;
      undoing = true;
      buttons.forEach(item => { item.disabled = true; });
      void actions.undo(paths).catch(error => {
        el('div', { text: bi('Undo failed: ', '撤销失败：') + String(error), parent: card, attrs: { role: 'alert' } });
      }).finally(() => {
        undoing = false;
        buttons.forEach(item => { item.disabled = actions.busy(); });
      });
    };
    button.disabled = actions.busy();
  };
  if (active.length && !active.some(file => file.undoBlocked)) undoButton(header, bi('Undo all', '撤销全部'));
  else if (!active.length) el('span', { className: 'nc-edit-summary-status', text: bi('Undone', '已撤销'), parent: header });

  for (const file of files) {
    const change = file.after?.change;
    if (!change) continue;
    const row = el('div', { className: `nc-edit-summary-file${file.restoredAt ? ' is-undone' : ''}`, parent: card });
    const name = el('button', { className: 'nc-edit-summary-path', type: 'button', text: file.path, parent: row, title: file.path });
    name.onclick = () => actions.open(file.path);
    // Deleted files have no current document to open, until they are restored.
    name.disabled = (change.kind === 'deleted' && !file.restoredAt) || (change.kind === 'created' && !!file.restoredAt);
    const meta = el('div', { className: 'nc-edit-summary-meta', parent: row });
    const operation = change.kind === 'created' ? bi('Created', '新建') : change.kind === 'deleted' ? bi('Deleted', '删除') : bi('Modified', '修改');
    el('span', { text: operation, parent: meta });
    if (change.adds !== null && change.dels !== null) {
      if (change.adds) el('span', { className: 'nc-edit-summary-add', text: `+${change.adds}`, parent: meta });
      if (change.dels) el('span', { className: 'nc-edit-summary-del', text: `−${change.dels}`, parent: meta });
      if (!change.adds && !change.dels) el('span', { text: change.kind === 'modified' ? bi('Format changed', '格式变更') : bi('0 lines', '0 行'), parent: meta });
    } else el('span', { text: bi('No line count', '未统计行数'), parent: meta, title: bi('Exact line counts are unavailable', '未计算完整增删行数') });
    if (file.restoredAt) el('span', { text: bi('Undone', '已撤销'), parent: meta });
    else if (file.undoBlocked) el('span', { text: bi('Use file recovery', '请用文件恢复'), parent: meta, title: bi('This change cannot be restored from a text snapshot alone', '此类变更无法仅通过文本快照完整恢复') });
    else undoButton(meta, bi('Undo', '撤销'), [file.path]);
  }
  return card;
}
