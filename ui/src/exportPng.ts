import dmSansLatin from '@fontsource-variable/dm-sans/files/dm-sans-latin-opsz-normal.woff2?url';
import monoLatin from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url';
import { toBlob } from 'html-to-image';
import type { Rect } from './layout';

// PNG export of the board. html-to-image clones the React Flow viewport into an
// SVG foreignObject and rasterises it; the caller makes sure every frame is
// rendered first (no culling) and that clips show their posters.

export type ExportKind = 'view' | 'small' | 'large' | 'max';

export const EXPORT_OPTIONS: { kind: ExportKind; label: string; hint: string }[] = [
  { kind: 'view', label: 'Current view', hint: 'What is on screen, at 2× sharpness' },
  { kind: 'small', label: 'Whole canvas · small', hint: '~4,000 px wide; quick, for sharing' },
  { kind: 'large', label: 'Whole canvas · large', hint: '~8,000 px wide; screen titles readable' },
  { kind: 'max', label: 'Whole canvas · max', hint: 'As large as the browser allows (~16,000 px); slow' },
];
const TARGET_WIDTH: Record<Exclude<ExportKind, 'view'>, number> = { small: 4096, large: 8192, max: 16384 };

// Browsers refuse canvases past ~16k px a side or a few hundred megapixels
// (Safari much less); stay under both.
const MAX_SIDE = 16384;
const MAX_AREA = 100e6;

/** Scale (output px per board unit) for an export of `rect`. */
export function exportScale(kind: ExportKind, rect: Rect, viewZoom: number) {
  const wanted = kind === 'view' ? viewZoom * 2 : TARGET_WIDTH[kind] / rect.w;
  return Math.min(wanted, MAX_SIDE / rect.w, MAX_SIDE / rect.h, Math.sqrt(MAX_AREA / (rect.w * rect.h)));
}

function withTimeout<T>(p: Promise<T>, ms: number) {
  return Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);
}

/** Wait until every <img> under root has loaded (or failed), max `ms`. */
async function imagesReady(root: HTMLElement, ms = 30000) {
  const imgs = [...root.querySelectorAll('img')];
  await withTimeout(
    Promise.all(
      imgs.map((img) =>
        img.complete
          ? img.decode().catch(() => {})
          : new Promise<void>((r) => {
              img.addEventListener('load', () => r(), { once: true });
              img.addEventListener('error', () => r(), { once: true });
            }),
      ),
    ),
    ms,
  );
}

/**
 * html-to-image inlines computed styles on HTML elements but not on SVG shapes,
 * and the copy it rasterises has no stylesheet, so arrows styled by CSS class
 * would come out invisible. Copy their computed paint onto SVG attributes for
 * the export; the returned function removes them again.
 */
export function bakeSvgStyles(root: HTMLElement) {
  const added: [Element, string][] = [];
  for (const el of root.querySelectorAll('svg path, svg line, svg polyline, svg polygon, svg circle, svg rect')) {
    const cs = getComputedStyle(el);
    const set = (name: string, value: string | null | undefined) => {
      if (!value || el.hasAttribute(name)) return;
      el.setAttribute(name, value);
      added.push([el, name]);
    };
    set('stroke', cs.stroke);
    set('stroke-width', String(parseFloat(cs.strokeWidth) || 0));
    set('stroke-linecap', cs.strokeLinecap);
    set('stroke-opacity', cs.strokeOpacity);
    set('opacity', cs.opacity);
    set('fill', cs.fill);
    if (cs.strokeDasharray && cs.strokeDasharray !== 'none') set('stroke-dasharray', cs.strokeDasharray.replace(/px/g, ''));
  }
  return () => {
    for (const [el, name] of added) el.removeAttribute(name);
  };
}

// html-to-image doesn't reliably find the bundled fonts in the page's
// stylesheets, so hand it the two it needs as data URLs. The Latin files
// cover German (ä ö ü ß); fetched once per session.
let fontCss: Promise<string> | null = null;
async function dataUrl(url: string) {
  const blob = await (await fetch(url)).blob();
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
function exportFontCss() {
  fontCss ??= Promise.all([dataUrl(dmSansLatin), dataUrl(monoLatin)]).then(
    ([dm, mono]) =>
      `@font-face{font-family:'DM Sans Variable';font-style:normal;font-weight:100 1000;src:url(${dm}) format('woff2')}` +
      `@font-face{font-family:'JetBrains Mono Variable';font-style:normal;font-weight:100 800;src:url(${mono}) format('woff2')}`,
  );
  fontCss.catch(() => (fontCss = null)); // retry next time if it failed
  return fontCss;
}

export async function renderPng(viewportEl: HTMLElement, rect: Rect, scale: number, background: string): Promise<Blob> {
  await imagesReady(viewportEl);
  const width = Math.round(rect.w * scale);
  const height = Math.round(rect.h * scale);
  const blob = await toBlob(viewportEl, {
    width,
    height,
    pixelRatio: 1,
    backgroundColor: background,
    // embed the web fonts, or the image falls back to a system font
    fontEmbedCSS: await exportFontCss(),
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${-rect.x * scale}px, ${-rect.y * scale}px) scale(${scale})`,
    },
    filter: (node) => !(node instanceof HTMLElement && node.classList.contains('rf-handle')),
  });
  if (!blob) throw new Error('the browser could not encode an image this large; try a smaller size');
  return blob;
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
