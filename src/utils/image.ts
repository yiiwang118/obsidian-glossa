/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Dynamic plugin, model, and vault payloads are validated at runtime boundaries. */
export type ImageInspectMode = 'auto' | 'describe' | 'ocr' | 'ui' | 'chart' | 'detail' | 'color';

export interface ImageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageSamplePoint {
  x: number;
  y: number;
  label?: string;
}

export interface ImagePixelSample {
  x: number;
  y: number;
  label?: string;
  rgba: [number, number, number, number];
  hex: string;
}

export interface ImageInspectionOptions {
  mode?: ImageInspectMode | string;
  region?: unknown;
  samplePoints?: unknown;
}

export interface ImageInspectionResult {
  mode: ImageInspectMode;
  mime: string;
  byteLength: number;
  width?: number;
  height?: number;
  aspectRatio?: string;
  region?: ImageRegion;
  pixelSamples: ImagePixelSample[];
  warnings: string[];
  recommendations: string[];
  image: {
    mime: string;
    data: string;
    label: string;
  };
}

const DEFAULT_MIME = 'image/png';
const MAX_SAMPLE_POINTS = 16;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

export function normalizeImageInspectMode(mode: unknown): ImageInspectMode {
  const raw = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
  if (raw === 'text' || raw === 'read_text') return 'ocr';
  if (raw === 'interface' || raw === 'layout' || raw === 'web') return 'ui';
  if (raw === 'figure' || raw === 'plot' || raw === 'graph') return 'chart';
  if (raw === 'crop' || raw === 'zoom') return 'detail';
  if (raw === 'pixel' || raw === 'pixels' || raw === 'colour') return 'color';
  if (raw === 'describe' || raw === 'ocr' || raw === 'ui' || raw === 'chart' || raw === 'detail' || raw === 'color') return raw;
  return 'auto';
}

export function normalizeImageRegion(input: unknown, width?: number, height?: number): ImageRegion | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  const rawX = finiteNumber(obj.x);
  const rawY = finiteNumber(obj.y);
  const rawW = finiteNumber(obj.width ?? obj.w);
  const rawH = finiteNumber(obj.height ?? obj.h);
  if (rawX === null || rawY === null || rawW === null || rawH === null) return undefined;
  if (rawW <= 0 || rawH <= 0) return undefined;

  if (!width || !height) {
    return {
      x: Math.max(0, Math.round(rawX)),
      y: Math.max(0, Math.round(rawY)),
      width: Math.max(1, Math.round(rawW)),
      height: Math.max(1, Math.round(rawH)),
    };
  }

  const x = Math.max(0, Math.min(width - 1, Math.round(rawX)));
  const y = Math.max(0, Math.min(height - 1, Math.round(rawY)));
  const right = Math.max(x + 1, Math.min(width, Math.round(rawX + rawW)));
  const bottom = Math.max(y + 1, Math.min(height, Math.round(rawY + rawH)));
  return { x, y, width: right - x, height: bottom - y };
}

export function normalizeImageSamplePoints(input: unknown, width?: number, height?: number): ImageSamplePoint[] {
  if (!Array.isArray(input)) return [];
  const out: ImageSamplePoint[] = [];
  for (const item of input.slice(0, MAX_SAMPLE_POINTS)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const rawX = finiteNumber(obj.x);
    const rawY = finiteNumber(obj.y);
    if (rawX === null || rawY === null) continue;
    const x = width ? Math.max(0, Math.min(width - 1, Math.round(rawX))) : Math.max(0, Math.round(rawX));
    const y = height ? Math.max(0, Math.min(height - 1, Math.round(rawY))) : Math.max(0, Math.round(rawY));
    const label = typeof obj.label === 'string' ? obj.label.slice(0, 80) : undefined;
    out.push({ x, y, label });
  }
  return out;
}

export async function inspectImageArrayBuffer(data: ArrayBuffer | Uint8Array, mime: string, opts: ImageInspectionOptions = {}): Promise<ImageInspectionResult> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const mode = normalizeImageInspectMode(opts.mode);
  const safeMime = mime || DEFAULT_MIME;
  const warnings: string[] = [];
  let width: number | undefined;
  let height: number | undefined;
  let imageData = '';
  let imageMime = safeMime;
  let imageLabel = 'full image';
  let region: ImageRegion | undefined;
  let pixelSamples: ImagePixelSample[] = [];

  try {
    const img = await decodeImage(bytes, safeMime);
    width = img.naturalWidth || img.width;
    height = img.naturalHeight || img.height;
    region = normalizeImageRegion(opts.region, width, height);
    const samplePoints = normalizeImageSamplePoints(opts.samplePoints, width, height);

    if (samplePoints.length > 0 || region || mode === 'color') {
      const canvas = activeDocument.createElement('canvas');
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        pixelSamples = samplePoints.map(p => samplePixel(ctx, p));
        if (region) {
          const cropped = cropCanvas(ctx, region);
          imageData = cropped.data;
          imageMime = cropped.mime;
          imageLabel = `crop x=${region.x} y=${region.y} w=${region.width} h=${region.height}`;
        }
      } else {
        warnings.push('Could not create a canvas context for crop or pixel inspection.');
      }
    }

    if (safeMime === 'image/gif' && region) {
      warnings.push('GIF crop uses the browser-decoded frame, not the full animation.');
    }
  } catch (e: any) {
    warnings.push(`Could not decode image dimensions locally: ${e?.message ?? e}`);
    region = normalizeImageRegion(opts.region);
  }

  if (!imageData) imageData = bytesToBase64(bytes);

  return {
    mode,
    mime: safeMime,
    byteLength: bytes.byteLength,
    width,
    height,
    aspectRatio: width && height ? formatAspectRatio(width, height) : undefined,
    region,
    pixelSamples,
    warnings,
    recommendations: imageRecommendations(mode, !!region, pixelSamples.length > 0),
    image: {
      mime: imageMime,
      data: imageData,
      label: imageLabel,
    },
  };
}

export function formatImageInspectionMarkdown(label: string, res: ImageInspectionResult): string {
  const lines = [
    `Image: ${label}`,
    '',
    '### Image inspection',
    `- Mode: ${res.mode}`,
    `- Type: ${res.mime}; size: ${humanSize(res.byteLength)}`,
  ];
  if (res.width && res.height) {
    lines.push(`- Dimensions: ${res.width} x ${res.height}px${res.aspectRatio ? ` (${res.aspectRatio})` : ''}`);
  }
  if (res.region) {
    lines.push(`- Region sent to model: x=${res.region.x}, y=${res.region.y}, width=${res.region.width}, height=${res.region.height}`);
  } else {
    lines.push('- Region sent to model: full image');
  }
  if (res.pixelSamples.length) {
    lines.push('- Pixel samples:');
    for (const p of res.pixelSamples) {
      lines.push(`  - ${p.label ? `${p.label} ` : ''}(${p.x},${p.y}): ${p.hex} rgba(${p.rgba.join(',')})`);
    }
  }
  if (res.recommendations.length) {
    lines.push('- Recommended approach:');
    for (const rec of res.recommendations) lines.push(`  - ${rec}`);
  }
  if (res.warnings.length) {
    lines.push('- Warnings:');
    for (const warning of res.warnings) lines.push(`  - ${warning}`);
  }
  return lines.join('\n');
}

function samplePixel(ctx: CanvasRenderingContext2D, point: ImageSamplePoint): ImagePixelSample {
  const data = ctx.getImageData(point.x, point.y, 1, 1).data;
  const rgba: [number, number, number, number] = [data[0], data[1], data[2], data[3]];
  return {
    ...point,
    rgba,
    hex: rgbToHex(data[0], data[1], data[2]),
  };
}

function cropCanvas(ctx: CanvasRenderingContext2D, region: ImageRegion): { mime: string; data: string } {
  const canvas = activeDocument.createElement('canvas');
  canvas.width = region.width;
  canvas.height = region.height;
  const cropCtx = canvas.getContext('2d');
  if (!cropCtx) throw new Error('Could not create crop canvas context.');
  const imageData = ctx.getImageData(region.x, region.y, region.width, region.height);
  cropCtx.putImageData(imageData, 0, 0);
  const dataUri = canvas.toDataURL('image/png');
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Could not encode cropped image.');
  return { mime: match[1], data: match[2] };
}

function decodeImage(bytes: Uint8Array, mime: string): Promise<HTMLImageElement> {
  const win = activeDocument.defaultView ?? window;
  const blob = new Blob([bytes.slice()], { type: mime || DEFAULT_MIME });
  const url = win.URL.createObjectURL(blob);
  const img = activeDocument.createElement('img');
  return new Promise((resolve, reject) => {
    const cleanup = () => win.URL.revokeObjectURL(url);
    img.onload = () => { cleanup(); resolve(img); };
    img.onerror = () => { cleanup(); reject(new Error('browser image decoder failed')); };
    img.src = url;
  });
}

function imageRecommendations(mode: ImageInspectMode, hasRegion: boolean, hasSamples: boolean): string[] {
  const rec: string[] = [];
  if (mode === 'ocr') {
    rec.push('Read the visible text from the image first; if text is small or crowded, request a cropped region and inspect that crop before answering.');
  } else if (mode === 'ui') {
    rec.push('Inspect layout, state, overlap, disabled/enabled controls, and approximate coordinates of relevant UI elements.');
  } else if (mode === 'chart') {
    rec.push('Identify title, axes, legend, units, trends, and visible annotations before drawing conclusions.');
  } else if (mode === 'detail') {
    rec.push(hasRegion ? 'Focus on the supplied crop; avoid making claims about unseen parts of the full image.' : 'For fine details, call view_image again with a pixel region to crop and enlarge the target area.');
  } else if (mode === 'color') {
    rec.push(hasSamples ? 'Use the sampled pixel values for color claims instead of relying only on visual impression.' : 'For exact color checks, provide sample_points so the tool can report RGB/hex values.');
  } else {
    rec.push('Start with whole-image understanding, then request a crop or pixel samples if precision matters.');
  }
  return rec;
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

function formatAspectRatio(width: number, height: number): string {
  const g = gcd(width, height);
  return `${Math.round(width / g)}:${Math.round(height / g)}`;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.floor(a));
  let y = Math.abs(Math.floor(b));
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !isFinite(value)) return null;
  return value;
}

function humanSize(b: number): string {
  if (b < 1024) return b + 'B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + 'KB';
  return (b / (1024 * 1024)).toFixed(1) + 'MB';
}
