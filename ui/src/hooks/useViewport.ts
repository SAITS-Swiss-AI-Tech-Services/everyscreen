import { useOnViewportChange, useReactFlow, type Viewport } from '@xyflow/react';
import { useCallback, useEffect, useRef } from 'react';
import { PW, type Rect } from '../layout';
import { schedulePlayback } from '../playback';
import { ui } from '../store';

export const MIN_ZOOM = 0.008;
/** Widths of the floating sidebar / panel (keep in step with --side-w / --panel-w). */
export const SIDE_W = 300;
export const PANEL_W = 400;
export const MAX_ZOOM = 3;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Viewport behaviour on top of React Flow:
 * - smooth wheel zoom: eases toward a goal zoom, keeping the point that was
 *   under the cursor under it (React Flow's own wheel zoom jumps per notch);
 * - zoom-dependent CSS sizes (--inv) updated in ~20% steps and once when
 *   zooming settles, so hundreds of labels and lines aren't restyled per frame;
 * - thumbnail / mockup thresholds and clip playback.
 */
export function useViewport(wrapRef: React.RefObject<HTMLDivElement | null>, wheelMode: 'zoom' | 'pan', sideOpen: React.RefObject<boolean>) {
  const rf = useReactFlow();
  const za = useRef({ goal: null as number | null, sx: 0, sy: 0, wx: 0, wy: 0, raf: 0, t: 0 });
  const scaleK = useRef(-1);
  const settle = useRef(0);
  useEffect(
    () => () => {
      cancelAnimationFrame(za.current.raf);
      za.current.raf = 0;
      za.current.goal = null;
      clearTimeout(settle.current);
    },
    [],
  );

  const stopZoom = useCallback(() => {
    cancelAnimationFrame(za.current.raf);
    za.current.raf = 0;
    za.current.goal = null;
  }, []);

  const applyScale = useCallback(
    (k: number) => {
      scaleK.current = k;
      const el = wrapRef.current;
      if (!el) return;
      el.style.setProperty('--inv', (1 / k).toFixed(4));
      el.classList.toggle('far', k < 0.16);
      const small = PW * k < 170;
      const tiny = PW * k < 90;
      const s = ui.get();
      if (s.small !== small || s.tiny !== tiny) ui.set({ small, tiny });
    },
    [wrapRef],
  );

  const onViewport = useCallback(
    (vp: Viewport) => {
      const zv = document.getElementById('zoomv');
      if (zv) zv.textContent = Math.round(vp.zoom * 100) + '%';
      if (scaleK.current < 0 || Math.abs(Math.log(vp.zoom / scaleK.current)) > 0.2) applyScale(vp.zoom);
      clearTimeout(settle.current);
      settle.current = window.setTimeout(() => {
        const k = rf.getViewport().zoom;
        if (k !== scaleK.current) applyScale(k);
        schedulePlayback();
      }, 150);
    },
    [applyScale, rf],
  );
  useOnViewportChange({ onChange: onViewport });

  // Ease the zoom toward za.goal, keeping world point (wx, wy) at screen
  // point (sx, sy).
  const step = useCallback(
    (now: number) => {
      const z = za.current;
      z.raf = 0;
      if (z.goal == null) return;
      const dt = Math.min(64, now - z.t);
      z.t = now;
      const lk = Math.log(rf.getViewport().zoom);
      const lg = Math.log(z.goal);
      const k = Math.abs(lg - lk) < 0.003 ? z.goal : Math.exp(lk + (lg - lk) * (1 - Math.exp(-dt / 65)));
      rf.setViewport({ x: z.sx - z.wx * k, y: z.sy - z.wy * k, zoom: k });
      if (k !== z.goal) z.raf = requestAnimationFrame(step);
      else z.goal = null;
    },
    [rf],
  );
  const zoomTo = useCallback(
    (sx: number, sy: number, k: number, smooth: boolean) => {
      const vp = rf.getViewport();
      k = clamp(k, MIN_ZOOM, MAX_ZOOM);
      const wx = (sx - vp.x) / vp.zoom;
      const wy = (sy - vp.y) / vp.zoom;
      if (!smooth) {
        stopZoom();
        rf.setViewport({ x: sx - wx * k, y: sy - wy * k, zoom: k });
        return;
      }
      Object.assign(za.current, { goal: k, sx, sy, wx, wy });
      if (!za.current.raf) {
        za.current.t = performance.now();
        za.current.raf = requestAnimationFrame(step);
      }
    },
    [rf, step, stopZoom],
  );

  // Wheel: listens in the capture phase on the wrapper so React Flow's own
  // (d3) wheel handler never sees the event.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.react-flow__minimap, .panel, iframe.live, video.live')) return;
      e.preventDefault();
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      const goal = za.current.goal ?? rf.getViewport().zoom;
      if (e.ctrlKey || e.metaKey) {
        // trackpad pinch: many small events, follow them directly
        zoomTo(sx, sy, goal * Math.exp(-dy * 0.01), za.current.goal != null);
      } else if (wheelMode === 'zoom' && !e.shiftKey) {
        zoomTo(sx, sy, goal * Math.exp(-clamp(dy, -240, 240) * 0.0022), true);
      } else {
        stopZoom();
        const vp = rf.getViewport();
        const [px, py] = e.shiftKey && !dx ? [dy, 0] : [dx, dy];
        rf.setViewport({ x: vp.x - px, y: vp.y - py, zoom: vp.zoom });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [rf, stopZoom, wheelMode, wrapRef, zoomTo]);

  /** Viewport that fits `rect` in the part of the canvas not covered by the
   * sidebar (left) and the screen panel (right, or a bottom sheet on phones). */
  const viewFor = useCallback(
    (rect: Rect, maxZoom: number, padding = 60) => {
      const r = wrapRef.current!.getBoundingClientRect();
      const wide = r.width > 720;
      const panelOpen = !!ui.get().selected;
      const left = wide && sideOpen.current ? SIDE_W + 12 : 0;
      const right = wide && panelOpen ? PANEL_W + 12 : 0;
      const bottom = !wide && panelOpen ? r.height * 0.6 : 0;
      const pad = Math.min(padding, r.width / 10);
      const vw = Math.max(40, r.width - left - right - pad * 2);
      const vh = Math.max(40, r.height - bottom - pad * 2);
      const zoom = clamp(Math.min(vw / rect.w, vh / rect.h, maxZoom), MIN_ZOOM, MAX_ZOOM);
      return { zoom, x: left + pad + (vw - rect.w * zoom) / 2 - rect.x * zoom, y: pad + (vh - rect.h * zoom) / 2 - rect.y * zoom };
    },
    [wrapRef, sideOpen],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const r = wrapRef.current!.getBoundingClientRect();
      zoomTo(r.width / 2, r.height / 2, (za.current.goal ?? rf.getViewport().zoom) * factor, true);
    },
    [rf, wrapRef, zoomTo],
  );

  return { stopZoom, viewFor, zoomBy, zoomTo };
}
