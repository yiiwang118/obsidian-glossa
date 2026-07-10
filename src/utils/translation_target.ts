
export type TranslationTarget = 'Chinese' | 'English';
export type UiLanguage = 'en' | 'zh';

export type SourceLanguage = 'en' | 'zh' | 'unknown';
export type ResponseLanguage = Exclude<SourceLanguage, 'unknown'>;

export interface ResponseLanguageDecision {
  language: ResponseLanguage;
  source: 'explicit-instruction' | 'current-message' | 'recent-user-message' | 'ui-fallback';
  confidence: 'explicit' | 'high' | 'medium' | 'fallback';
  currentLanguage: SourceLanguage;
  selectionLanguage: SourceLanguage;
}

export interface ResponseLanguageOptions {
  currentText: string;
  recentUserTexts?: readonly string[];
  selectionText?: string;
  uiLanguage: UiLanguage;
}

const EN_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'for',
  'from', 'has', 'have', 'in', 'into', 'is', 'it', 'its', 'more', 'not', 'of',
  'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was', 'were', 'which',
  'with', 'without',
]);

export function inferSelectionTranslationTarget(
  text: string,
  uiLanguage: UiLanguage,
): TranslationTarget {
  const source = inferSelectionLanguage(text);
  if (source === 'zh') return 'English';
  if (source === 'en') return 'Chinese';
  return uiLanguage === 'zh' ? 'Chinese' : 'English';
}

export function inferSelectionLanguage(text: string): SourceLanguage {
  const sample = normalizeLanguageSample(text);
  const cjk = countMatches(sample, /[\u3400-\u9fff]/g);
  const zhPunctuation = countMatches(sample, /[，。！？；：、]/g);
  const latinWords = sample.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];

  let englishStopWords = 0;
  let englishProseWords = 0;
  let englishProseChars = 0;
  let englishModelLikeWords = 0;

  for (const word of latinWords) {
    const lower = word.toLowerCase();
    const hasInternalCap = /[a-z][A-Z]|[A-Z]{2,}/.test(word);
    const isModelLike = hasInternalCap || word.length <= 2;
    if (EN_STOPWORDS.has(lower)) {
      englishStopWords++;
      englishProseWords++;
      englishProseChars += word.length;
    } else if (/^[a-z][a-z'-]{3,}$/.test(word)) {
      englishProseWords++;
      englishProseChars += word.length;
    } else if (isModelLike || /^[A-Z][A-Za-z'-]+$/.test(word)) {
      englishModelLikeWords++;
    }
  }

  const englishSentenceMarks = countMatches(sample, /\b(the|and|of|to|in|for|with|that|which|this|from|into)\b/gi);
  const chineseScore = cjk + zhPunctuation * 8;
  const englishScore = englishStopWords * 12 + englishProseWords * 4 + englishSentenceMarks * 5;
  const languageChars = cjk + englishProseChars;

  if (cjk >= 4 && englishProseChars === 0) return 'zh';
  if (cjk === 0 && (englishStopWords >= 2 || englishProseWords >= 4)) return 'en';
  if (languageChars < 4) return 'unknown';

  // Markdown snippets often contain English model names and URLs around Chinese
  // prose. Treat prose-like lowercase English as signal, but do not let proper
  // nouns such as Mixtral, HuggingFace, Google, Meta, or T5 dominate.
  const chineseDominatesNaturalText = cjk >= 10
    && (cjk / Math.max(1, languageChars) >= 0.24 || chineseScore >= englishScore * 0.68);
  if (chineseDominatesNaturalText) return 'zh';

  const englishDominatesNaturalText = englishProseWords >= 5
    && englishScore >= chineseScore * 1.15
    && englishProseWords >= englishModelLikeWords * 0.35;
  if (englishDominatesNaturalText) return 'en';

  if (cjk >= 16 && cjk >= englishProseChars * 0.35) return 'zh';
  if (englishStopWords >= 4 && englishProseChars >= cjk * 1.4) return 'en';

  return 'unknown';
}

/** Resolve the language of assistant prose without letting an English source
 * attachment override a Chinese request (or vice versa). */
export function inferResponseLanguage(options: ResponseLanguageOptions): ResponseLanguageDecision {
  const currentLanguage = inferSelectionLanguage(options.currentText);
  const selectionLanguage = inferSelectionLanguage(options.selectionText ?? '');
  const explicit = explicitRequestedLanguage(options.currentText);
  if (explicit) {
    return {
      language: explicit,
      source: 'explicit-instruction',
      confidence: 'explicit',
      currentLanguage,
      selectionLanguage,
    };
  }
  if (currentLanguage !== 'unknown') {
    return {
      language: currentLanguage,
      source: 'current-message',
      confidence: 'high',
      currentLanguage,
      selectionLanguage,
    };
  }
  for (const text of options.recentUserTexts ?? []) {
    const priorExplicit = explicitRequestedLanguage(text);
    const priorLanguage = priorExplicit ?? inferSelectionLanguage(text);
    if (priorLanguage === 'unknown') continue;
    return {
      language: priorLanguage,
      source: 'recent-user-message',
      confidence: priorExplicit ? 'high' : 'medium',
      currentLanguage,
      selectionLanguage,
    };
  }
  return {
    language: options.uiLanguage,
    source: 'ui-fallback',
    confidence: 'fallback',
    currentLanguage,
    selectionLanguage,
  };
}

export function buildResponseLanguageHint(decision: ResponseLanguageDecision): string {
  const languageName = decision.language === 'zh' ? 'Chinese' : 'English';
  const sourceLanguage = decision.selectionLanguage === 'unknown'
    ? 'unknown'
    : decision.selectionLanguage === 'zh' ? 'Chinese' : 'English';
  return [
    `<response-language target="${decision.language}" confidence="${decision.confidence}">`,
    `Write the answer and explanatory prose in ${languageName}.`,
    `The selected/attached source language is ${sourceLanguage}; it is source material, not a reply-language instruction.`,
    'Keep code, formulas, file paths, quotations, and proper nouns in their original form unless the user explicitly asks to translate them.',
    '</response-language>',
  ].join('\n');
}

export function sourceLanguageLabel(language: SourceLanguage, uiLanguage: UiLanguage): string {
  if (language === 'zh') return '中文';
  if (language === 'en') return 'EN';
  return uiLanguage === 'zh' ? '语言未定' : 'Language unclear';
}

function explicitRequestedLanguage(text: string): ResponseLanguage | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (/(?:请?用|以|改成|换成|回答用|回复用|输出为|翻译成|翻译为|译成)\s*(?:简体|繁体)?中文|中文\s*(?:回答|回复|解释|输出)|(?:reply|respond|answer|write|translate)(?:\s+this)?\s+(?:in|into|to)\s+(?:simplified\s+|traditional\s+)?chinese\b|\bin\s+chinese\b/i.test(normalized)) {
    return 'zh';
  }
  if (/(?:请?用|以|改成|换成|回答用|回复用|输出为|翻译成|翻译为|译成)\s*(?:英文|英语)|(?:英文|英语)\s*(?:回答|回复|解释|输出)|(?:reply|respond|answer|write|translate)(?:\s+this)?\s+(?:in|into|to)\s+english\b|\bin\s+english\b/i.test(normalized)) {
    return 'en';
  }
  if (/^\/translate\s+(?:chinese|中文)\b/i.test(normalized)) return 'zh';
  if (/^\/translate\s+(?:english|英文|英语)\b/i.test(normalized)) return 'en';
  return null;
}

function normalizeLanguageSample(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1 ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1 ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, ' ')
    .replace(/^\s*\/[a-z][\w-]*(?=\s|$)/gim, ' ')
    .replace(/^\s*[-*+]\s+/gm, ' ')
    .replace(/[#>*_~|()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}
