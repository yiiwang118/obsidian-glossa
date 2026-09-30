import type { ChatMessage, ChatSession } from '../types';
import type { Skill } from './skills';
import { validateSkillDefinition } from './skill_validation';

export interface LearningExample {
  name: string;
  request: string;
  input: string;
  shouldTrigger: boolean;
  includes: string[];
  excludes: string[];
}

export interface LearningSource {
  sessionId: string;
  turnId: string;
  messageId: string;
  endpointId?: string;
  model?: string;
  tools: { name: string; status: string; skillVersion?: string }[];
}

export interface LearningContent {
  name: string;
  title: string;
  description: string;
  whenToUse: string;
  body: string;
  examples: LearningExample[];
}

export interface ExampleOutcome {
  output: string;
  triggered: boolean;
  failures: string[];
  milliseconds: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LearningEvaluation {
  signature: string;
  baselineId: string | null;
  endpointId: string;
  model: string;
  testedAt: number;
  rows: { name: string; baseline: ExampleOutcome; candidate: ExampleOutcome }[];
}

export interface LearningVersion extends LearningContent {
  id: string;
  createdAt: number;
  correction: string;
  source?: LearningSource;
  evaluation?: LearningEvaluation;
}

export function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}

function textField(value: unknown, label: string, max: number, optional = false): string {
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) {
    throw new Error(`${label}: ${optional ? 'text' : 'non-empty text'} required (max ${max} characters).`);
  }
  return value;
}

export function parseJsonReply(text: string): unknown {
  const clean = text.trim().replace(/^```(?:json)?\s*\n/i, '').replace(/\n```$/, '');
  return JSON.parse(clean) as unknown;
}

export function parseExamples(value: unknown): LearningExample[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 5) throw new Error('Use 3–5 examples, including two positive examples and one negative example.');
  const examples = value.map((raw: unknown) => {
    const entry = objectValue(raw);
    if (typeof entry.shouldTrigger !== 'boolean') throw new Error('Each example needs shouldTrigger.');
    const strings = (field: string): string[] => {
      const list = entry[field];
      if (!Array.isArray(list) || list.length > 12) throw new Error(`${field}: use at most 12 checks.`);
      return list.map((item: unknown) => textField(item, field, 4000));
    };
    const result: LearningExample = {
      name: textField(entry.name, 'Example name', 100),
      request: textField(entry.request, 'Example request', 4000),
      input: textField(entry.input, 'Example input', 8000, true),
      shouldTrigger: entry.shouldTrigger,
      includes: strings('includes'), excludes: strings('excludes'),
    };
    if (!result.includes.length) throw new Error('Each example needs at least one required output fragment.');
    if (result.includes.some(part => result.excludes.some(forbidden => part.includes(forbidden)))) throw new Error('An example requires text that it also forbids.');
    return result;
  });
  if (examples.filter(example => example.shouldTrigger).length < 2 || !examples.some(example => !example.shouldTrigger)) {
    throw new Error('Include two positive examples and one negative example.');
  }
  if (new Set(examples.map(example => example.name)).size !== examples.length) throw new Error('Example names must be unique.');
  return examples;
}

export function parseLearningContent(value: unknown): LearningContent {
  const data = objectValue(value);
  // Only descriptive fields can evolve. Capability grants and executable code
  // are never projected from an untrusted model reply into a runtime Skill.
  const content: LearningContent = {
    name: textField(data.name, 'Name', 64).trim(),
    title: textField(data.title, 'Title', 160).trim(),
    description: textField(data.description, 'Description', 1000).trim(),
    whenToUse: textField(data.whenToUse, 'When to use', 2000).trim(),
    body: textField(data.body, 'Workflow', 16000).trim(),
    examples: parseExamples(data.examples),
  };
  const issues = validateSkillDefinition(learningSkill(content));
  if (issues.length) throw new Error(issues.map(issue => issue.message).join('\n'));
  return content;
}

export function parseLearningEvaluation(value: unknown): LearningEvaluation {
  const data = objectValue(value);
  const number = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid evaluation metric.');
    return value;
  };
  const outcome = (value: unknown): ExampleOutcome => {
    const item = objectValue(value);
    if (typeof item.triggered !== 'boolean' || !Array.isArray(item.failures) || item.failures.length > 30) throw new Error('Invalid example outcome.');
    return {
      output: textField(item.output, 'Output', 24000, true), triggered: item.triggered,
      failures: item.failures.map((entry: unknown) => textField(entry, 'Failure', 5000)),
      milliseconds: number(item.milliseconds),
      inputTokens: item.inputTokens === undefined ? undefined : number(item.inputTokens),
      outputTokens: item.outputTokens === undefined ? undefined : number(item.outputTokens),
    };
  };
  if (!Array.isArray(data.rows) || data.rows.length < 3 || data.rows.length > 5) throw new Error('Invalid evaluation rows.');
  return {
    signature: textField(data.signature, 'Evaluation input', 200000),
    baselineId: data.baselineId === null ? null : textField(data.baselineId, 'Baseline version', 200),
    endpointId: textField(data.endpointId, 'Endpoint', 200), model: textField(data.model, 'Model', 300, true),
    testedAt: number(data.testedAt),
    rows: data.rows.map((raw: unknown) => {
      const row = objectValue(raw);
      return { name: textField(row.name, 'Example name', 100), baseline: outcome(row.baseline), candidate: outcome(row.candidate) };
    }),
  };
}

export function parseLearningSource(value: unknown): LearningSource {
  const data = objectValue(value);
  if (!Array.isArray(data.tools) || data.tools.length > 80) throw new Error('Invalid feedback source.');
  return {
    sessionId: textField(data.sessionId, 'Session', 200), turnId: textField(data.turnId, 'Turn', 200), messageId: textField(data.messageId, 'Message', 200),
    endpointId: data.endpointId === undefined ? undefined : textField(data.endpointId, 'Endpoint', 200, true),
    model: data.model === undefined ? undefined : textField(data.model, 'Model', 300, true),
    tools: data.tools.map((raw: unknown) => {
      const tool = objectValue(raw);
      return { name: textField(tool.name, 'Tool', 200), status: textField(tool.status, 'Status', 30),
        skillVersion: tool.skillVersion === undefined ? undefined : textField(tool.skillVersion, 'Skill version', 200) };
    }),
  };
}

export function learningSkill(content: LearningContent): Skill {
  return {
    name: content.name, title: content.title, description: content.description,
    whenToUse: content.whenToUse, body: content.body, source: 'learned',
    path: '.glossa/learning.json',
  };
}

export function learningMarkdown(content: LearningContent): string {
  return `---\nname: ${content.name}\ntitle: ${JSON.stringify(content.title)}\ndescription: ${JSON.stringify(content.description)}\nwhen_to_use: ${JSON.stringify(content.whenToUse)}\n---\n\n${content.body}\n`;
}

/** Exact serialized input binds validation to the reviewed skill AND examples. */
export function learningSignature(content: LearningContent): string {
  return JSON.stringify([learningMarkdown(content), content.examples]);
}

export function canActivate(content: LearningContent, evaluation: LearningEvaluation | undefined, baselineId: string | null): boolean {
  return !!evaluation && evaluation.signature === learningSignature(content)
    && evaluation.baselineId === baselineId
    && evaluation.rows.length === content.examples.length
    && evaluation.rows.every((row, index) => row.name === content.examples[index].name && row.candidate.failures.length === 0);
}

export function scoreExample(example: LearningExample, reply: unknown, checkTrigger: boolean): Pick<ExampleOutcome, 'output' | 'triggered' | 'failures'> {
  const data = objectValue(reply);
  if (typeof data.applySkill !== 'boolean') throw new Error('Example result must contain applySkill.');
  const output = textField(data.output, 'Example output', 24000, true);
  const failures: string[] = [];
  if (checkTrigger && data.applySkill !== example.shouldTrigger) failures.push(example.shouldTrigger ? 'Skill did not trigger.' : 'Skill triggered outside its scope.');
  for (const expected of example.includes) if (!output.includes(expected)) failures.push(`Missing: ${expected}`);
  for (const forbidden of example.excludes) if (output.includes(forbidden)) failures.push(`Forbidden: ${forbidden}`);
  return { output, triggered: data.applySkill, failures };
}

export function correctionContext(session: ChatSession, message: ChatMessage): { context: string; source: LearningSource } {
  const index = session.messages.findIndex(item => item.id === message.id);
  const turnId = message.turnId ?? message.id;
  const turn = session.messages.filter(item => item.role === 'assistant' && (item.turnId ?? item.id) === turnId);
  const first = session.messages.findIndex(item => item === turn[0]);
  const user = session.messages.slice(0, first >= 0 ? first : index).reverse().find(item => item.role === 'user');
  const model = turn.find(item => item.modelSnapshot)?.modelSnapshot;
  return {
    // Only the visible request and selected reply; attached vault content and
    // tool result bodies are not swept into a learning request.
    context: `User:\n${(user?.displayContent ?? '').slice(0, 6000)}\n\nAssistant:\n${message.content.slice(0, 6000)}`,
    source: {
      sessionId: session.id, turnId, messageId: message.id,
      endpointId: model?.endpointId, model: model?.model,
      tools: turn.flatMap(item => (item.toolEvents ?? []).map(event => ({
        name: event.name, status: event.status, skillVersion: event.skillVersion,
      }))).slice(-80),
    },
  };
}
