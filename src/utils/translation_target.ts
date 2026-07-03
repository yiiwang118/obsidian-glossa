export type TranslationTarget = 'Chinese' | 'English';
export type UiLanguage = 'en' | 'zh';

type SourceLanguage = 'en' | 'zh' | 'unknown';

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

function normalizeLanguageSample(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1 ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1 ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, ' ')
    .replace(/^\s*[-*+]\s+/gm, ' ')
    .replace(/[#>*_~|()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}
