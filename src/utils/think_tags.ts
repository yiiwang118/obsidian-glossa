/** Reasoning that a model writes into its answer text instead of a separate
 *  field: `<think>…</think>` (DeepSeek R1, Qwen 3, MiniMax M2 and most local
 *  servers), or `<thinking>` / `<reasoning>`. Only blocks at the start of the
 *  answer are treated as reasoning, so prose that mentions a tag later stays
 *  text. Tags may arrive split across stream chunks. */
const OPEN_TAGS = ['<think>', '<thinking>', '<reasoning>'];

export interface ThinkSplit {
  text: string;
  reasoning: string;
}

export class ThinkTagSplitter {
  private pending = '';
  private mode: 'start' | 'reasoning' | 'text' = 'start';
  private closeTag = '';
  /** A reasoning block was closed; whitespace before the answer is dropped. */
  private sawBlock = false;

  push(delta: string): ThinkSplit {
    const out: ThinkSplit = { text: '', reasoning: '' };
    if (!delta) return out;
    if (this.mode === 'text') { out.text = delta; return out; }
    this.pending += delta;
    this.drain(out, false);
    return out;
  }

  /** End of the answer: whatever is left is emitted as it stands. */
  flush(): ThinkSplit {
    const out: ThinkSplit = { text: '', reasoning: '' };
    this.drain(out, true);
    if (this.pending) {
      if (this.mode === 'reasoning') out.reasoning += this.pending;
      else out.text += this.mode === 'start' && this.sawBlock ? this.pending.trimStart() : this.pending;
      this.pending = '';
    }
    return out;
  }

  private drain(out: ThinkSplit, final: boolean) {
    for (;;) {
      if (this.mode === 'start') {
        const body = this.pending.trimStart();
        if (!body) return;
        const open = OPEN_TAGS.find(tag => body.startsWith(tag));
        if (open) {
          this.mode = 'reasoning';
          this.closeTag = `</${open.slice(1)}`;
          this.pending = body.slice(open.length);
          continue;
        }
        // A partial opening tag: wait for the next chunk.
        if (!final && OPEN_TAGS.some(tag => tag.startsWith(body))) return;
        this.mode = 'text';
        out.text += this.sawBlock ? body : this.pending;
        this.pending = '';
        return;
      }
      if (this.mode === 'reasoning') {
        const end = this.pending.indexOf(this.closeTag);
        if (end >= 0) {
          out.reasoning += this.pending.slice(0, end);
          this.pending = this.pending.slice(end + this.closeTag.length);
          this.sawBlock = true;
          // Another reasoning block, or whitespace before the answer, may follow.
          this.mode = 'start';
          continue;
        }
        // Keep a possible partial closing tag for the next chunk.
        let keep = 0;
        if (!final) {
          for (let size = Math.min(this.closeTag.length - 1, this.pending.length); size > 0; size--) {
            if (this.closeTag.startsWith(this.pending.slice(-size))) { keep = size; break; }
          }
        }
        out.reasoning += this.pending.slice(0, this.pending.length - keep);
        this.pending = this.pending.slice(this.pending.length - keep);
        return;
      }
      out.text += this.pending;
      this.pending = '';
      return;
    }
  }
}

/** Split a complete answer (non-streaming responses). */
export function splitThinkTags(text: string): ThinkSplit {
  const splitter = new ThinkTagSplitter();
  const first = splitter.push(text);
  const rest = splitter.flush();
  return { text: first.text + rest.text, reasoning: first.reasoning + rest.reasoning };
}
