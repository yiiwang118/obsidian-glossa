const path = require('path');
exports.run = async (t, load) => {
  const mod = await load(path.resolve(__dirname, '../src/temporary_chat.ts'));
  const options = { language: 'en', model: 'model', modelLabel: 'model', budgetTokens: 64000 };
  const parent = { id: 'main', title: 'Paper', messages: [
    { id: 'u', role: 'user', content: 'PRIVATE EXPANDED ATTACHMENT', displayContent: 'Explain theorem 5', timestamp: 1 },
    { id: 'a', role: 'assistant', content: '<think>PRIVATE THINKING</think>Visible proof', reasoningContent: 'PRIVATE REASONING', toolEvents: [{ result: 'PRIVATE TOOL' }], timestamp: 2 },
    { id: 't', role: 'tool', content: 'PRIVATE TOOL', timestamp: 3 },
  ] };
  const before = JSON.stringify(parent);
  const store = new mod.TemporaryChatStore(), chat = store.forParent(parent, 'api');
  const excerpt = mod.makeChatExcerpt(parent, 'a', 'Selected theorem');
  chat.addExcerpts([excerpt, excerpt]);
  t.eq(chat.pending.length, 1, 'duplicate selection is quoted only once');
  t.eq(chat.pending[0].question, 'Explain theorem 5', 'the visible question behind a quoted reply comes with it');
  t.eq(mod.excerptSourceText(parent.messages[1]), 'Visible proof', 'a whole-reply quote leaves inline reasoning out');
  t.eq(mod.excerptSourceText(parent.messages[0]), 'Explain theorem 5', 'a whole-question quote is what the bubble shows');
  let context = chat.requestMessages('What does it mean?');
  t.ok(JSON.stringify(context.messages).includes('Selected theorem'), 'quoted passage is sent');
  t.ok(!JSON.stringify(context.messages).includes('Visible proof') && !JSON.stringify(context.messages).includes('PRIVATE'), 'default context excludes unquoted history and private fields');
  t.eq(context.messages.map(m => m.role), ['user'], 'a first question is one user message');
  parent.messages.push({ id: 'later', role: 'user', displayContent: 'LATER MESSAGE', content: 'LATER MESSAGE' });
  t.ok(!JSON.stringify(chat.requestMessages('Next').messages).includes('LATER MESSAGE'), 'the main conversation never joins the side context by itself');
  t.eq(store.forParent({ ...parent, title: 'Renamed' }, 'api'), chat, 'reopening the same chat resumes the side discussion');
  t.eq(chat.parentTitle, 'Renamed', 'a resumed discussion follows the main chat title');
  parent.messages.pop();
  t.ok(mod.sideChatTurn('Q', [{ ...excerpt, text: 'a </excerpt> b' }]).includes('a <\\/excerpt> b'), 'quoted text cannot close the tag that marks it as data');

  const requests = [];
  const provider = { async *stream(req) { requests.push(JSON.parse(JSON.stringify(req))); yield { type: 'reasoning', text: 'R' }; yield { type: 'text', text: 'Proof' }; yield { type: 'final', text: 'Proof complete' }; yield { type: 'text', text: 'LATE' }; } };
  await chat.send(provider, 'Explain this step', options);
  t.eq(chat.messages.at(-1).content, 'Proof complete', 'authoritative final answer replaces partial text and rejects late events');
  t.eq(chat.messages.at(-1).status, 'complete', 'completed status recorded');
  t.eq(chat.messages.at(-1).reasoning, 'R', 'streamed reasoning is kept for display');
  t.eq(chat.messages.at(-2).excerpts.map(e => e.text), ['Selected theorem'], 'the quote is attached to the question it was asked with');
  t.eq(chat.pending.length, 0, 'sent quotes leave the composer');
  t.eq(requests[0].tools, [], 'temporary discussion offers no tool execution');
  t.eq(requests[0].maxTokens, undefined, 'no side-chat output cap, so reasoning models are not cut off');
  t.ok(!requests[0].nativeSession && !requests[0].attachedImages, 'main native binding and attachments are not inherited');
  t.ok(requests[0].systemPrompt.includes('target="en"'), 'reply language follows the question');
  t.ok(!/snapshot/i.test(requests[0].systemPrompt), 'the prompt describes only what is actually sent');
  await chat.send(provider, 'Why?', options);
  t.eq(requests[1].messages.map(m => m.role), ['user', 'assistant', 'user'], 'follow-up replays only this side discussion');
  t.ok(requests[1].messages[0].content.includes('Selected theorem') && !requests[1].messages[2].content.includes('Selected theorem'), 'earlier quotes stay with their own question');
  t.ok(!JSON.stringify(requests[1]).includes('"R"'), 'reasoning is never sent back');
  await chat.send(provider, '这一步为什么成立？', options);
  t.ok(requests[2].systemPrompt.includes('target="zh"'), 'a Chinese question gets a Chinese reply even in an English UI');
  t.eq(JSON.stringify(parent), before, 'quoting and three side turns leave the main chat untouched');
  t.ok(store.forParent({ ...parent, id: 'other' }, 'api') !== chat, 'different main chats have separate side contexts');
  t.eq(new mod.TemporaryChatStore().get(chat.id), undefined, 'a new plugin lifetime cannot restore a temporary conversation');

  // Unfinished turns: kept, marked, retryable.
  const cancelled = store.forParent({ ...parent, id: 'cancel' }, 'api');
  const slow = { async *stream() { yield { type: 'text', text: 'Partial' }; cancelled.stop(); yield { type: 'text', text: 'Late' }; } };
  await cancelled.send(slow, 'Question', options);
  t.eq(cancelled.messages.at(-1).status, 'cancelled', 'stop is distinct from successful completion');
  t.eq(cancelled.messages.at(-1).content, 'Partial', 'stop keeps received text without late output');
  const replay = cancelled.requestMessages('Next').messages;
  t.ok(replay[1].content.includes('Partial') && replay[1].content.includes('interrupted'), 'an interrupted answer stays in context, marked as incomplete');
  t.ok(cancelled.canRetry, 'the last exchange can be retried');
  const answered = { async *stream() { yield { type: 'final', text: 'Full answer' }; } };
  await cancelled.retry(answered, options);
  t.eq(cancelled.messages.map(m => m.content), ['Question', 'Full answer'], 'retry replaces the unfinished exchange instead of adding one');
  const bad = { async *stream() { yield { type: 'tool_call', name: 'write_note', args: {} }; } };
  await cancelled.send(bad, 'Write', options);
  t.eq(cancelled.messages.at(-1).status, 'error', 'an unexpected tool request fails without execution');
  const empty = { async *stream() { yield { type: 'text', text: 'Disconnected' }; } };
  await cancelled.send(empty, 'Try again', options);
  t.eq(cancelled.messages.at(-1).status, 'error', 'a missing final frame never becomes success');
  t.eq(cancelled.busy, false, 'a failed request releases send control');
  const thinking = { async *stream() { yield { type: 'reasoning', text: 'long thought' }; yield { type: 'final', text: '', hasReasoning: true }; } };
  await cancelled.send(thinking, 'Think', options);
  t.ok(/reasoning but no answer/.test(cancelled.messages.at(-1).error), 'a reasoning-only reply is reported, not shown as an empty success');
  const cut = { async *stream() { yield { type: 'final', text: 'Half', stopReason: 'max_tokens' }; } };
  await cancelled.send(cut, 'Long', options);
  t.ok(cancelled.messages.at(-1).status === 'complete' && cancelled.messages.at(-1).truncated, 'an answer cut at the output limit is flagged');
  const stalls = { async *stream(req) { await new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(new Error('The user aborted a request.')))); } };
  const realSet = window.setTimeout;
  window.setTimeout = (fn, ms) => realSet(fn, ms >= 600000 ? 0 : ms);
  try { await cancelled.send(stalls, 'Slow', options); } finally { window.setTimeout = realSet; }
  t.ok(cancelled.messages.at(-1).status === 'error' && /10 minutes/.test(cancelled.messages.at(-1).error), 'a timeout is an error, not a user stop');

  // Rejected questions leave everything as it was.
  const rejected = store.forParent({ ...parent, id: 'rejected' }, 'api');
  rejected.addExcerpts([excerpt]); rejected.draft = 'Draft';
  let threw = false;
  try { await rejected.send(provider, 'x'.repeat(8001), options); } catch { threw = true; }
  t.ok(threw && rejected.messages.length === 0 && rejected.pending.length === 1 && rejected.draft === 'Draft', 'an oversized question changes nothing');
  threw = false;
  try { await rejected.send(provider, 'Q', { ...options, budgetTokens: 1 }); } catch { threw = true; }
  t.ok(threw && rejected.messages.length === 0 && rejected.pending.length === 1, 'a question that cannot fit the model is refused before sending');

  // Long discussions drop their oldest turns instead of stopping.
  const long = store.forParent({ ...parent, id: 'long' }, 'api');
  for (let i = 0; i < 4; i++) long.messages.push({ id: `u${i}`, role: 'user', content: `Q${i} ` + 'w '.repeat(400), status: 'complete', excerpts: [] }, { id: `a${i}`, role: 'assistant', content: `A${i}`, status: 'complete' });
  const fitted = long.requestMessages('Latest', [], 500);
  t.eq(fitted.omitted, 2, 'turns beyond the budget are counted');
  t.ok(fitted.messages[0].content.startsWith('[2 earlier turns') && fitted.messages.some(m => m.content.startsWith('Q3')) && !fitted.messages.some(m => m.content.startsWith('Q0')), 'the newest turns are kept and the gap is stated');
  t.eq(fitted.messages.at(-1).content, 'Latest', 'the current question is always last');

  const legacy = { id: 'legacy', messages: [{ id: 'u', role: 'user', content: 'PRIVATE LEGACY PROMPT' }, { id: 'a', role: 'assistant', content: 'Answer' }] };
  t.eq(mod.makeChatExcerpt(legacy, 'a', 'Answer').question, '', 'legacy expanded user prompts are not silently imported');
  const big = mod.makeChatExcerpt(parent, 'a', 'x'.repeat(13000));
  t.ok(big.truncated && big.text.length === 12000, 'an oversized single quote is truncated explicitly');
  const bounded = store.forParent({ ...parent, id: 'bounded' }, 'api');
  t.throws(() => bounded.addExcerpts(Array.from({ length: 9 }, (_, i) => ({ ...excerpt, id: String(i), text: String(i) }))), 'too many quotes rejected atomically');
  t.eq(bounded.pending.length, 0, 'a failed add leaves the composer unchanged');
  bounded.addExcerpts([{ ...big, question: '' }]);
  t.throws(() => bounded.addExcerpts([{ ...big, text: 'y'.repeat(12001) }]), 'per-question quote budget enforced');
  t.eq(bounded.pending.length, 1, 'budget failure does not partially add quotes');
  t.ok(mod.sideChatBudget('claude-opus-5-5', 1000000) === 100000 && mod.sideChatBudget('unknown', 1000000) === 64000 && mod.sideChatBudget('unknown', 20000) === 10000, 'budget follows the model window and the user cap');
  t.eq(mod.sideChatBudget('gpt-4', 1000000), 4096, '8k models reserve half their window instead of raising input budget to 8k');
  t.eq(mod.sideChatBudget('unknown', 4000), 2000, 'small user caps are respected');

  const regenerated = store.forParent({ ...parent, id: 'regeneration' }, 'api');
  await regenerated.send(answered, 'Keep my answer', options);
  const failedRetry = { async *stream() { yield { type: 'text', text: 'Broken replacement' }; yield { type: 'error', error: 'Network failed' }; } };
  await regenerated.retry(failedRetry, options);
  t.eq(regenerated.messages.map(m => m.content), ['Keep my answer', 'Full answer'], 'failed regeneration preserves the previous completed exchange');
  t.ok(regenerated.messages.at(-1).retryError?.includes('Network failed'), 'failed replacement is reported alongside the preserved answer');
  regenerated.draft = 'Next unsent question';
  regenerated.addExcerpts([excerpt]);
  const stoppedRetry = { async *stream() { yield { type: 'text', text: 'New partial' }; regenerated.stop(); yield { type: 'final', text: 'Late' }; } };
  await regenerated.retry(stoppedRetry, options);
  t.eq(regenerated.messages.at(-1).content, 'Full answer', 'stopping regeneration also restores the completed answer');
  t.eq([regenerated.draft, regenerated.pending.length], ['Next unsent question', 1], 'regeneration leaves next-turn draft and quotes alone');
  await regenerated.retry(answered, options);
  t.eq(regenerated.messages.at(-1).retryError, undefined, 'a successful regeneration clears the failure notice');
  const unloadedRetry = { async *stream() { regenerated.dispose(); yield { type: 'final', text: 'Late' }; } };
  await regenerated.retry(unloadedRetry, options);
  t.eq(regenerated.messages.length, 0, 'unload during regeneration cannot resurrect the saved answer');

  const markdown = mod.sideChatMarkdown(chat, 'Paper', new Date(0));
  t.ok(markdown.includes('> Selected theorem') && markdown.includes('Explain this step') && markdown.includes('Proof complete'), 'a saved note contains quotes, questions and answers');
  chat.draft = 'Draft'; chat.omittedTurns = 2;
  chat.clear();
  t.eq([chat.messages.length, chat.pending.length, chat.draft, chat.omittedTurns], [0, 0, '', 0], 'clear removes conversation, quotes, draft and the omitted-turn count');
  t.eq(chat.requestMessages('Q').messages, [{ role: 'user', content: 'Q' }], 'after clearing, a question goes out on its own');
  const disposable = store.forParent({ ...parent, id: 'dispose' }, 'api');
  const destroy = { async *stream() { store.dispose(); yield { type: 'text', text: 'Must not return' }; } };
  await disposable.send(destroy, 'Question', options);
  t.eq(disposable.messages.length, 0, 'plugin unload erases history and rejects in-flight late text');
  t.eq(store.get(disposable.id), undefined, 'unload clears associations');

  const { TemporaryChatView } = await load(path.resolve(__dirname, '../src/ui/temporary_chat_view.ts'), { ItemView: class {} });
  const view = Object.create(TemporaryChatView.prototype);
  view.chat = { id: 'private-id', pending: [{ text: 'SECRET' }], messages: [{ content: 'SECRET' }] };
  t.eq(view.getState(), {}, 'workspace.json cannot persist IDs, quotes or side messages');
};
