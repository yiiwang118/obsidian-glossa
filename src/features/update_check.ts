import { requestUrl } from 'obsidian';
import { compareSemver, normalizeVersion } from '../utils/version';

const LATEST_RELEASE_URL = 'https://api.github.com/repos/yiiwang118/obsidian-glossa/releases/latest';
const OBSIDIAN_PLUGIN_URL = 'https://obsidian.md/plugins?id=glossa';
export const GLOSSA_RELEASES_URL = 'https://github.com/yiiwang118/obsidian-glossa/releases';
export const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  obsidianUrl: string;
  releaseName: string;
  body: string;
  notes: string[];
  checkedAt: number;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
}

export async function fetchLatestUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  const res = await requestUrl({
    url: LATEST_RELEASE_URL,
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    throw: false,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`GitHub release check failed (${res.status})`);
  }
  const release = res.json as GitHubRelease;
  if (!release || release.draft || release.prerelease || !release.tag_name) return null;
  const latestVersion = normalizeVersion(release.tag_name);
  if (compareSemver(latestVersion, currentVersion) <= 0) return null;
  return {
    currentVersion: normalizeVersion(currentVersion),
    latestVersion,
    releaseUrl: release.html_url || `${GLOSSA_RELEASES_URL}/tag/${release.tag_name}`,
    obsidianUrl: OBSIDIAN_PLUGIN_URL,
    releaseName: release.name || release.tag_name,
    body: release.body || '',
    notes: extractReleaseNotes(release.body || ''),
    checkedAt: Date.now(),
  };
}

function extractReleaseNotes(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const notes: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.+)/) || line.match(/^\d+\.\s+(.+)/);
    if (!m) continue;
    const clean = m[1].replace(/\s+/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
    if (clean) notes.push(clean.slice(0, 180));
    if (notes.length >= 5) break;
  }
  return notes;
}
