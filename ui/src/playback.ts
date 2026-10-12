// Decides which mounted clips play. Only the frames React Flow renders (the
// visible ones) mount a <video>, and at most MAX_PLAYING of those play:
// the selected screen first, then the hovered one, then (when zoomed in far
// enough to see them) the ones nearest the middle of the view.

const MAX_PLAYING = 4;
const AUTOPLAY_ZOOM = 0.3;

export interface PlaybackContext {
  selected: string | null;
  hovered: string | null;
  zoom: number;
  /** World coordinates of the middle of the view. */
  center: { x: number; y: number };
  centerOf: (id: string) => { x: number; y: number } | undefined;
}

const videos = new Map<string, HTMLVideoElement>();
let context: () => PlaybackContext | null = () => null;
let raf = 0;

export function setPlaybackContext(fn: () => PlaybackContext | null) {
  context = fn;
}

// A pause the viewer made (native controls) sticks until they play the clip
// again; the scheduler tags its own play()/pause() calls so the events it
// causes aren't mistaken for the viewer's.
export function registerVideo(id: string, el: HTMLVideoElement) {
  videos.set(id, el);
  const onPause = () => {
    if (el.dataset.sched === 'pause') delete el.dataset.sched;
    else if (!el.dataset.hold) el.dataset.userPaused = '1';
  };
  const onPlay = () => {
    if (el.dataset.sched === 'play') delete el.dataset.sched;
    else delete el.dataset.userPaused;
  };
  el.addEventListener('pause', onPause);
  el.addEventListener('play', onPlay);
  schedulePlayback();
  return () => {
    el.removeEventListener('pause', onPause);
    el.removeEventListener('play', onPlay);
    if (videos.get(id) === el) videos.delete(id);
    el.pause();
  };
}

/** Pause for the app (comment holds, seeks), not counted as the viewer's pause. */
export function pauseQuietly(el: HTMLVideoElement) {
  if (el.paused) return;
  el.dataset.sched = 'pause';
  el.pause();
}

export const getVideo = (id: string) => videos.get(id);

export function schedulePlayback() {
  if (!raf) raf = requestAnimationFrame(run);
}

function run() {
  raf = 0;
  const c = context();
  if (!c) return;
  const ranked = [...videos].map(([id, el]) => {
    let pri = Infinity;
    if (id === c.selected) pri = -2;
    else if (id === c.hovered) pri = -1;
    else if (c.zoom >= AUTOPLAY_ZOOM) {
      const p = c.centerOf(id);
      if (p) pri = Math.hypot(p.x - c.center.x, p.y - c.center.y);
    }
    if (el.dataset.hold || el.dataset.userPaused) pri = Infinity;
    return { el, pri };
  });
  ranked.sort((a, b) => a.pri - b.pri);
  ranked.forEach(({ el, pri }, i) => {
    if (el.dataset.hold || el.dataset.userPaused) return;
    if (i < MAX_PLAYING && pri !== Infinity) {
      if (el.paused) {
        el.dataset.sched = 'play';
        el.play().catch(() => delete el.dataset.sched);
      }
    } else pauseQuietly(el);
  });
}
