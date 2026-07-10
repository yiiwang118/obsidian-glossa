import type { Skill } from './skills';

export type SkillIssueSeverity = 'error' | 'warning';

export interface SkillValidationIssue {
  severity: SkillIssueSeverity;
  field: string;
  message: string;
}

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TRIGGER_LANGUAGE = /\b(?:use when|when the user|for requests?|trigger)\b|(?:用于|适用于|当用户|触发)/i;

export function validateSkillName(name: unknown): SkillValidationIssue[] {
  if (typeof name !== 'string' || !name.trim()) {
    return [{ severity: 'error', field: 'name', message: 'Name is required.' }];
  }
  const normalized = name.trim();
  const issues: SkillValidationIssue[] = [];
  if (normalized.length > 64) issues.push({ severity: 'error', field: 'name', message: 'Name must be at most 64 characters.' });
  if (!SKILL_NAME.test(normalized)) {
    issues.push({ severity: 'error', field: 'name', message: 'Use lowercase kebab-case without leading, trailing, or repeated hyphens.' });
  }
  return issues;
}

export function validateSkillDefinition(
  skill: Skill,
  availableToolNames?: ReadonlySet<string>,
): SkillValidationIssue[] {
  const issues = validateSkillName(skill.name);
  const description = skill.description.trim();
  if (!description || description === '(no description)') {
    issues.push({ severity: 'error', field: 'description', message: 'Description is required and must explain what the skill does.' });
  } else if (description.length < 24) {
    issues.push({ severity: 'warning', field: 'description', message: 'Description is too short to support reliable discovery.' });
  }
  if (!skill.whenToUse && !skill.triggers?.length && !skill.paths?.length && !TRIGGER_LANGUAGE.test(description)) {
    issues.push({ severity: 'warning', field: 'when_to_use', message: 'Add concrete activation cues via when_to_use, triggers, paths, or the description.' });
  }

  const body = skill.body.trim();
  if (!body) {
    issues.push({ severity: 'error', field: 'body', message: 'Skill body is empty.' });
  } else {
    if (!/^#\s+Workflow\b/im.test(body)) issues.push({ severity: 'warning', field: 'body', message: 'Add a # Workflow section with executable steps.' });
    if (!/^#\s+Done when\b/im.test(body)) issues.push({ severity: 'warning', field: 'body', message: 'Add a # Done when section with verification criteria.' });
    if (body.length > 80_000) issues.push({ severity: 'warning', field: 'body', message: 'Body exceeds the runtime injection cap of 80,000 characters.' });
  }

  for (const pattern of skill.paths ?? []) {
    if (pattern.startsWith('/') || pattern.split('/').includes('..')) {
      issues.push({ severity: 'error', field: 'paths', message: `Unsafe vault-relative path pattern: ${pattern}` });
    }
  }
  if (availableToolNames) {
    for (const name of [...(skill.requiredTools ?? []), ...(skill.allowedTools ?? [])]) {
      if (!availableToolNames.has(name)) {
        issues.push({ severity: 'error', field: 'tools', message: `Unknown or unavailable tool: ${name}` });
      }
    }
  }
  return issues;
}
