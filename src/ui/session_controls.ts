import { App, Modal } from 'obsidian';
import type { ChatSession, PendingMessage, SessionGoal } from '../types';
import { newGoal } from '../agent/session_runtime';
import { bi } from '../utils/i18n';
import { el } from '../utils/dom';

export interface SessionControlActions {
  busy: boolean;
  pause: () => void;
  resume: () => void;
  removeGoal: () => void;
  removeMessage: (id: string) => void;
  editMessage: (id: string, text: string) => void;
  sendMessage: (item: PendingMessage) => void;
}

export function renderSessionControls(host: HTMLElement, session: ChatSession, actions: SessionControlActions) {
  host.replaceChildren();
  host.className = 'nc-session-controls';
  host.hidden = !session.goal && !session.inbox?.length;
  const goal = session.goal;
  if (goal) {
    const card = el('section', { className: 'nc-goal-card', parent: host, attrs: { 'aria-label': bi('Persistent task', '持续任务') } });
    const head = el('div', { className: 'nc-goal-heading', parent: card });
    const phases = { active: bi('Running', '运行中'), paused: bi('Paused', '已暂停'), blocked: bi('Needs input', '等待处理'), complete: bi('Complete', '已完成') };
    el('span', { className: `nc-goal-phase ${goal.phase}`, text: phases[goal.phase], parent: head });
    el('span', { text: `${goal.rounds} / ${goal.maxRounds} ${bi('rounds', '轮')}`, parent: head });
    el('p', { className: 'nc-goal-objective', text: goal.objective, parent: card });
    if (goal.progress) el('p', { className: 'nc-goal-progress', text: goal.progress, parent: card });
    if (goal.blocker) el('p', { className: 'nc-goal-blocker', text: goal.blocker, parent: card });
    const footer = el('div', { className: 'nc-goal-actions', parent: card });
    if (goal.phase !== 'complete') {
      const pause = goal.phase === 'active';
      const button = el('button', { text: pause ? bi('Pause', '暂停') : bi('Resume', '继续'), type: 'button', parent: footer });
      button.disabled = !pause && (actions.busy || goal.rounds >= goal.maxRounds);
      button.onclick = pause ? actions.pause : actions.resume;
      if (goal.rounds >= goal.maxRounds) el('span', { text: bi('Round limit reached', '已达到轮次上限'), parent: footer });
    }
    const remove = el('button', { text: bi('Remove card', '移除任务卡'), type: 'button', parent: footer });
    remove.disabled = actions.busy;
    remove.onclick = actions.removeGoal;
  }
  if (session.inbox?.length) {
    const list = el('div', { className: 'nc-inbox', parent: host, attrs: { 'aria-label': bi('Pending messages', '待发送消息') } });
    for (const item of session.inbox) {
      const row = el('div', { className: 'nc-inbox-item', parent: list });
      const meta = el('div', { className: 'nc-inbox-meta', parent: row });
      el('span', { text: item.kind === 'steer' ? bi('Next step', '下一步补充') : bi('Next turn', '下一轮'), parent: meta });
      const edit = el('button', { text: bi('Edit', '编辑'), type: 'button', parent: meta });
      edit.onclick = () => {
        if (row.querySelector('textarea')) return;
        const field = el('textarea', { parent: row, attrs: { 'aria-label': bi('Edit pending message', '编辑待发送消息') } });
        field.value = item.text;
        const save = el('button', { text: bi('Save', '保存'), type: 'button', parent: row });
        save.onclick = () => { if (field.value.trim()) actions.editMessage(item.id, field.value.trim()); };
        field.focus();
      };
      const remove = el('button', { text: '×', type: 'button', parent: meta, attrs: { 'aria-label': bi('Remove pending message', '移除待发送消息') } });
      remove.onclick = () => actions.removeMessage(item.id);
      const text = el('p', { text: item.text, parent: row });
      text.title = item.text;
      if (!actions.busy) {
        const send = el('button', { text: bi('Send', '发送'), type: 'button', parent: row });
        send.onclick = () => actions.sendMessage(item);
      }
    }
  }
}

export function openGoalModal(app: App, onCreate: (goal: SessionGoal) => void) {
  class GoalModal extends Modal {
    onOpen() {
      this.modalEl.addClass('nc-goal-modal');
      const host = this.contentEl;
      el('h3', { text: bi('Create a task', '创建持续任务'), parent: host });
      el('p', { text: bi('Progress is saved locally. Pauses on errors, blockers or the round limit. Resume manually after reopening.', '进度保存在本地。遇到错误、阻塞或轮次上限会暂停；重启后需手动继续。'), parent: host });
      const label = el('label', { text: bi('Objective', '任务目标'), parent: host });
      const input = el('textarea', { parent: label, attrs: { rows: '4', maxlength: '4000' } });
      const budgetLabel = el('label', { text: bi('Maximum rounds (1–20)', '最多运行轮次（1–20）'), parent: host });
      const budget = el('input', { type: 'number', parent: budgetLabel, attrs: { min: '1', max: '20', value: '3' } });
      const create = el('button', { text: bi('Create task', '创建任务'), parent: host, type: 'button' });
      create.onclick = () => { if (!input.value.trim()) { input.focus(); return; } onCreate(newGoal(input.value, Number(budget.value))); this.close(); };
      input.focus();
    }
    onClose() { this.contentEl.empty(); }
  }
  new GoalModal(app).open();
}
