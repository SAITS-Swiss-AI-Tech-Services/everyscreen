import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { createContext, memo, useContext, useEffect, useRef, type CSSProperties } from 'react';
import { groupTitle, hueOf, isUnreached, mediaUrl, type Board } from '../board';
import { isOpen, useComments, visiblePins, type Thread } from '../comments';
import { pauseQuietly, registerVideo, schedulePlayback } from '../playback';
import { ui, useUi } from '../store';
import type { Media, ScreenData } from '../types';
import { Icon, mediaIcon } from './icons';

export const BoardContext = createContext<Board | null>(null);
const useBoard = () => useContext(BoardContext)!;

export type ScreenNodeType = Node<{ screen: ScreenData }, 'screen'>;
export type PillNodeType = Node<{ screen: ScreenData }, 'pill'>;
export type RegionNodeType = Node<{ title: string; subtitle: string; hue: string }, 'region'>;
export type SectionNodeType = Node<{ text: string; hue: string }, 'section'>;

// Edges are drawn from precomputed paths, but React Flow still wants a handle
// on each end.
const Handles = () => (
  <>
    <Handle type="target" position={Position.Left} isConnectable={false} className="rf-handle" />
    <Handle type="source" position={Position.Right} isConnectable={false} className="rf-handle" />
  </>
);

const KIND_NOTES: Partial<Record<ScreenData['kind'], string>> = {
  redirect: 'Redirect only: renders nothing',
  helper: 'Helper file that expo-router also registers as a route',
  system: 'Shown for unknown URLs',
  dev: 'Developer test screen',
  drawer: 'In-place screen (not a route)',
  sheet: 'Pop-up sheet or dialog (not a route)',
  flow: 'Flow recording',
};

function Placeholder({ n, note }: { n: ScreenData; note?: string }) {
  const board = useBoard();
  const body = (
    <>
      <div className="ph-group">{groupTitle(board, n.group) + (n.section ? ' / ' + n.section : '')}</div>
      <div className="ph-title">{n.title}</div>
      <div className="ph-route mono">{n.route ?? n.id}</div>
      {KIND_NOTES[n.kind] && <div className="ph-note">{KIND_NOTES[n.kind]}</div>}
      {isUnreached(board, n) && <div className="ph-note">No navigation in the code leads here</div>}
      <div className="ph-fill" />
      <div className="ph-badge">{note ?? 'No capture yet'}</div>
      {n.component && <div className="ph-meta mono">{n.component}</div>}
      {n.file && <div className="ph-meta mono">{n.file}</div>}
    </>
  );
  if (n.kind === 'drawer' || n.kind === 'sheet') {
    return (
      <div className="ph sheet-ph">
        <div className="sheet">{body}</div>
      </div>
    );
  }
  return <div className="ph">{body}</div>;
}

function Video({ id, m, selected }: { id: string; m: Media; selected: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const small = useUi((s) => s.small);
  useEffect(() => registerVideo(id, ref.current!), [id, m.src]);
  // A comment being written on this clip, or a thread opened on it, holds the
  // clip still at its timestamp.
  // only while that thread is open: a seek left over from an earlier thread
  // must not freeze the clip, or jump it back when the frame remounts
  const seek = useComments((s) => (s.seek?.screenId === id && s.seek.threadId === s.openId ? s.seek : null));
  const hold = useComments((s) => (s.draft?.screenId === id && s.draft.mediaTime != null) || (s.seek?.screenId === id && s.seek.threadId === s.openId));
  useEffect(() => {
    const el = ref.current;
    if (!el || !seek) return;
    const go = () => {
      el.currentTime = seek.time;
      pauseQuietly(el);
    };
    if (el.readyState >= 1) go();
    else {
      el.preload = 'auto';
      el.addEventListener('loadedmetadata', go, { once: true });
      el.load();
    }
  }, [seek]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (hold) {
      el.dataset.hold = '1';
      pauseQuietly(el);
    } else {
      delete el.dataset.hold;
      schedulePlayback();
    }
  }, [hold]);
  return (
    <video
      ref={ref}
      src={mediaUrl(m.src)}
      poster={mediaUrl(small ? (m.posterThumb ?? m.poster) : m.poster)}
      muted
      loop
      playsInline
      preload="none"
      controls={selected}
      className={selected ? 'live' : ''}
    />
  );
}

function MediaView({ n, m, selected }: { n: ScreenData; m: Media; selected: boolean }) {
  const small = useUi((s) => s.small);
  const tiny = useUi((s) => s.tiny);
  const exporting = useUi((s) => s.exporting);
  // PNG export: a clip exports as its poster, a mockup (iframe) can't be captured
  if (exporting) {
    const thumb = exporting === 'thumb';
    if (m.type === 'image') return <img src={mediaUrl(thumb && m.thumb ? m.thumb : m.src)} alt="" draggable={false} />;
    if (m.type === 'video') {
      const poster = thumb ? (m.posterThumb ?? m.poster) : m.poster;
      return poster ? <img src={mediaUrl(poster)} alt="" draggable={false} /> : <Placeholder n={n} note={`Clip: ${m.label}`} />;
    }
    return <Placeholder n={n} note={`HTML mockup: ${m.label}`} />;
  }
  if (m.type === 'image') return <img src={mediaUrl(small && m.thumb ? m.thumb : m.src)} alt="" draggable={false} decoding="async" />;
  if (m.type === 'video') return <Video id={n.id} m={m} selected={selected} />;
  if (tiny) return <Placeholder n={n} note="HTML mockup (zoom in)" />;
  return <iframe src={mediaUrl(m.src)} title={m.label} sandbox="allow-scripts" loading="lazy" className={selected ? 'live' : ''} />;
}


const EMPTY: Thread[] = [];

/** Comment / issue pins over the screen, numbered per screen in creation order. */
function Pins({ id, mediaFile }: { id: string; mediaFile: string | null }) {
  const threads = useComments((s) => s.byScreen.get(id) ?? EMPTY);
  const showResolved = useComments((s) => s.showResolved);
  const draft = useComments((s) => (s.draft?.screenId === id ? s.draft : null));
  const openId = useComments((s) => (s.openId != null && s.byScreen.get(id)?.some((t) => t.id === s.openId) ? s.openId : null));
  const pins = visiblePins(threads, mediaFile, showResolved);
  if (!pins.length && !(draft && draft.x != null)) return null;
  return (
    <div className="pins">
      {pins.map((t) => (
        <button
          key={t.id}
          data-thread={t.id}
          className={`pin nodrag ${t.kind} sev-${t.severity ?? 'none'}${isOpen(t) ? '' : ' done'}${t.id === openId ? ' active' : ''}`}
          style={{ left: `${t.x! * 100}%`, top: `${t.y! * 100}%` }}
          title={`${t.kind === 'issue' ? 'Issue' : 'Comment'} #${t.id}: ${t.title ?? t.excerpt ?? ''}`}
          aria-label={`${t.kind === 'issue' ? 'Issue' : 'Comment'} #${t.id}`}
        >
          {t.id}
        </button>
      ))}
      {draft && draft.x != null && <div className="pin draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y! * 100}%` }} />}
    </div>
  );
}

/** Count of open threads, shown as a bubble on the frame's corner. */
function CommentBadge({ id }: { id: string }) {
  const summary = useComments((s) => {
    const open = (s.byScreen.get(id) ?? EMPTY).filter(isOpen);
    if (!open.length) return '';
    const issues = open.filter((t) => t.kind === 'issue');
    const worst = ['critical', 'high', 'medium', 'low'].find((sev) => issues.some((t) => t.severity === sev)) ?? (issues.length ? 'none' : '');
    return `${open.length}|${issues.length ? 'issue' : 'comment'}|${worst}`;
  });
  if (!summary) return null;
  const [count, kind, worst] = summary.split('|');
  return (
    <div className={`cbadge ${kind} sev-${worst || 'none'}`} title={`${count} open ${kind === 'issue' ? 'issue(s)/comment(s)' : 'comment(s)'}`}>
      {count}
    </div>
  );
}

export const ScreenNode = memo(function ScreenNode({ data }: NodeProps<ScreenNodeType>) {
  const n = data.screen;
  const board = useBoard();
  const status = useUi((s) => (s.selected === n.id ? 'sel' : s.selected && !s.linked.has(n.id) ? 'dim' : ''));
  const idx = useUi((s) => s.mediaIdx[n.id] ?? 0);
  const m = n.media[idx];
  const selected = status === 'sel';
  return (
    <div className={`screen kind-${n.kind} ${status}`} style={{ '--g': hueOf(n.group) } as CSSProperties}>
      <Handles />
      <div className="s-head">
        <div className="s-title">{n.title}</div>
        <div className="s-route mono">{n.route ?? (n.kind === 'drawer' ? 'in place · ' + n.id.slice(7) : n.kind === 'sheet' ? (n.component ?? n.id) : n.id)}</div>
      </div>
      <div className="phone">
        <div className="scr">
          {m ? <MediaView n={n} m={m} selected={selected} /> : <Placeholder n={n} />}
          <Pins id={n.id} mediaFile={m?.file ?? null} />
        </div>
        <CommentBadge id={n.id} />
      </div>
      <div className="strip">
        {n.media.map((md, i) => (
          <button
            key={md.file}
            className={i === idx ? 'cur nodrag' : 'nodrag'}
            title={md.file}
            onClick={(e) => {
              e.stopPropagation();
              ui.setMedia(n.id, i);
            }}
          >
            <Icon name={mediaIcon[md.type]} size={16} /> {md.label}
          </button>
        ))}
        {n.kind !== 'screen' && n.kind !== 'flow' && <span className="chip">{n.kind}</span>}
        {n.params.length > 0 && <span className="chip">params: {n.params.join(', ')}</span>}
        {isUnreached(board, n) && <span className="chip warn">unreached</span>}
      </div>
    </div>
  );
});

export const PillNode = memo(function PillNode({ data }: NodeProps<PillNodeType>) {
  const n = data.screen;
  const board = useBoard();
  const status = useUi((s) => (s.selected === n.id ? 'sel' : s.selected && !s.linked.has(n.id) ? 'dim' : ''));
  return (
    <div className={`pill ${status}`}>
      <Handles />
      <b>⚙ {n.title}</b>
      <span>{board.outE.get(n.id)?.length ?? 0} outgoing · guards, tab bar, overlays</span>
    </div>
  );
});

export const RegionNode = memo(function RegionNode({ data, width }: NodeProps<RegionNodeType>) {
  return (
    <div className="region" style={{ '--g': data.hue, '--rw': `${width}px` } as CSSProperties}>
      <div className="region-title">
        {data.title}
        <small>{data.subtitle}</small>
      </div>
    </div>
  );
});

export const SectionNode = memo(function SectionNode({ data }: NodeProps<SectionNodeType>) {
  return (
    <div className="section-label" style={{ '--g': data.hue } as CSSProperties}>
      {data.text}
    </div>
  );
});

export const nodeTypes = { screen: ScreenNode, pill: PillNode, region: RegionNode, section: SectionNode };
