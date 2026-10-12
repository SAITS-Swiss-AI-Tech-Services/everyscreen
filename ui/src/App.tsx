import { Background, BackgroundVariant, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, ViewportPortal, type Node, type NodeHandle } from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router';
import { CATS, catOf, deriveBoard, hueOf, MEDIA_BASE, type Board, type Cat } from './board';
import { closeThread, comments, discardDraft, fetchThread, loadThreads, openThread, startDraft, useComments, type Thread } from './comments';
import { EdgeMarkers, edgeTypes, type RoutedEdgeType } from './components/edges';
import { Icon } from './components/icons';
import { BoardContext, nodeTypes } from './components/nodes';
import { Panel } from './components/Panel';
import { Sidebar } from './components/Sidebar';
import { deviceLine, TopBar, type LinkMode, type SideTab, type WheelMode } from './components/TopBar';
import { AppHeader } from './components/ui';
import { bakeSvgStyles, downloadBlob, exportScale, nextFrame, renderPng, type ExportKind } from './exportPng';
import { MAX_ZOOM, MIN_ZOOM, PANEL_W, SIDE_W, useViewport } from './hooks/useViewport';
import { computeLayout, FOOT, HEAD, PW, type Layout, type Rect } from './layout';
import { schedulePlayback, setPlaybackContext } from './playback';
import { prefs, ui, useUi } from './store';
import { useTheme } from './theme';
import { toast } from './toast';
import type { BoardFile } from './types';
import { APP_NAME } from './appConfig';

/** /b/:boardId — one canvas. */
export function BoardPage() {
  const { boardId = '' } = useParams();
  const [file, setFile] = useState<BoardFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setError(null);
    fetch(`${MEDIA_BASE}boards/${encodeURIComponent(boardId)}/board.json`, { cache: 'no-cache' })
      // static hosts answer a missing file with the app's index.html, so anything
      // that isn't JSON means the board doesn't exist
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : Promise.reject(new Error(r.ok || r.status === 404 ? 'not found' : `${r.status} ${r.statusText}`))))
      .then((f: BoardFile) => !cancelled && setFile(f))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  useEffect(() => {
    document.title = file ? `${file.title} · ${APP_NAME}` : `${APP_NAME} · everyscreen`;
  }, [file]);

  if (error)
    return (
      <div className="page">
        <AppHeader />
        <main className="page-main">
          <div className="empty" style={{ paddingTop: 96 }}>
            <b>{error === 'not found' ? `There is no canvas called “${boardId}”` : `Couldn't load canvas “${boardId}”: ${error}`}</b>
            <p>
              <Link className="btn" to="/">
                <Icon name="grid" /> All canvases
              </Link>
            </p>
          </div>
        </main>
      </div>
    );
  if (!file) return <div className="loading">Loading canvas…</div>;
  return (
    <ReactFlowProvider key={boardId}>
      <Canvas file={file} boardId={boardId} />
    </ReactFlowProvider>
  );
}

// Handles React Flow can use without measuring the DOM (frames off screen are
// never rendered, but edges to them still need end points).
const handlesFor = (r: Rect): NodeHandle[] => [
  { type: 'target', position: Position.Left, x: 0, y: r.h / 2, width: 1, height: 1 },
  { type: 'source', position: Position.Right, x: r.w - 1, y: r.h / 2, width: 1, height: 1 },
];
const STATIC = { draggable: false, selectable: false, connectable: false, focusable: false } as const;

function buildNodes(board: Board, layout: Layout): Node[] {
  const nodes: Node[] = [];
  for (const r of layout.regions) {
    const g = board.groups.get(r.gid)!;
    nodes.push({
      ...STATIC,
      id: 'region:' + r.gid,
      type: 'region',
      position: { x: r.x, y: r.y },
      width: r.w,
      height: r.h,
      zIndex: -10,
      className: 'rf-bg',
      data: { title: g.title, subtitle: `${r.gid === 'flows' ? '' : r.gid + ' · '}${g.navigator} · ${r.count} screens`, hue: hueOf(r.gid) },
    });
  }
  layout.sections.forEach((s, i) =>
    nodes.push({
      ...STATIC,
      id: `section:${s.gid}:${i}`,
      type: 'section',
      position: { x: s.x, y: s.y },
      width: 1200,
      height: 60,
      zIndex: -5,
      className: 'rf-bg',
      data: { text: s.text, hue: hueOf(s.gid) },
    }),
  );
  for (const n of board.nodes) {
    const p = layout.pos.get(n.id);
    if (!p) continue;
    nodes.push({
      ...STATIC,
      id: n.id,
      type: n.kind === 'layout' ? 'pill' : 'screen',
      position: { x: p.x, y: p.y },
      width: p.w,
      height: p.h,
      handles: handlesFor(p),
      data: { screen: n },
    });
  }
  return nodes;
}

const SHORTCUTS: [string[], string][] = [
  [['C'], 'Comment tool: click a screen to pin a comment or issue'],
  [['/'], 'Search screens'],
  [['O'], 'Outline of screens'],
  [['I'], 'Issues on this canvas'],
  [['F'], 'Zoom to the selected screen (or double-click it)'],
  [['0'], 'Fit the whole canvas'],
  [['+', '−'], 'Zoom in / out'],
  [['←', '↑', '→', '↓'], 'Pan'],
  [['Esc'], 'Step back: cancel draft, stop commenting, close thread, deselect'],
  [['Ctrl', 'Enter'], 'Post a comment or reply'],
  [['?'], 'This list'],
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog float" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button className="btn ghost sm icon-only" aria-label="Close" autoFocus onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <dl className="shortcuts">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={what} style={{ display: 'contents' }}>
              <dt>
                {keys.map((k) => (
                  <span key={k} className="kbd">
                    {k}
                  </span>
                ))}
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <p className="hint-text">Drag to pan; wheel or pinch to zoom. Shortcuts don't work while the cursor is inside an HTML mockup; click the canvas background first.</p>
      </div>
    </div>
  );
}

function Canvas({ file, boardId }: { file: BoardFile; boardId: string }) {
  const board = useMemo(() => deriveBoard(file), [file]);
  const layout = useMemo(() => computeLayout(board), [board]);
  const nodes = useMemo(() => buildNodes(board, layout), [board, layout]);
  const rf = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [linkMode, setLinkMode] = useState<LinkMode>(() => prefs.get('links', 'flow'));
  const [catOn, setCatOn] = useState<Record<Cat, boolean>>(() => ({ ...Object.fromEntries(CATS.map((c) => [c.id, c.on])), ...prefs.get('cats', {}) }) as Record<Cat, boolean>);
  const [wheelMode, setWheelMode] = useState<WheelMode>(() => prefs.get('wheel', 'zoom'));
  const [side, setSideState] = useState<SideTab | null>(() => prefs.get<SideTab | null>('side', window.innerWidth > 1100 ? 'outline' : null));
  const sideOpen = useRef(!!side);
  sideOpen.current = !!side;
  const setSide = useCallback((t: SideTab | null) => {
    setSideState(t);
    if (window.innerWidth > 720) prefs.set('side', t);
  }, []);
  const [help, setHelp] = useState(false);
  const theme = useTheme();
  const selected = useUi((s) => s.selected);
  const hovered = useUi((s) => s.hovered);
  const [exportState, setExportState] = useState<{ kind: ExportKind; stage: string; error?: string } | null>(null);
  const exporting = !!exportState && !exportState.error;
  const { stopZoom, viewFor, zoomBy } = useViewport(wrapRef, wheelMode, sideOpen);

  // Selection / hover, plus the set of screens connected to them (not dimmed).
  const catOnRef = useRef(catOn);
  catOnRef.current = catOn;
  const setFocus = useCallback(
    (patch: { selected?: string | null; hovered?: string | null }) => {
      const s = { ...ui.get(), ...patch };
      const linked = new Set<string>();
      for (const id of [s.selected, s.hovered]) {
        if (!id) continue;
        for (const e of [...(board.outE.get(id) ?? []), ...(board.inE.get(id) ?? [])]) {
          if (catOnRef.current[catOf(e)]) linked.add(e.from === id ? e.to : e.from);
        }
      }
      ui.set({ ...patch, linked });
      schedulePlayback();
    },
    [board],
  );
  useEffect(() => setFocus({}), [catOn, setFocus]);

  const focusNode = useCallback(
    (id: string, duration = 420) => {
      const p = layout.pos.get(id);
      if (!p) return;
      rf.setViewport(viewFor({ x: p.x - 40, y: p.y - HEAD - 20, w: p.w + 80, h: p.h + HEAD + FOOT + 40 }, 1.1), { duration });
    },
    [layout, rf, viewFor],
  );
  const fitAll = useCallback(
    (duration = 420) => rf.setViewport(viewFor(layout.bounds, 1, 30), { duration }),
    [layout, rf, viewFor],
  );
  /** Select a screen (null: none). Returns false if the viewer chose to keep an unsent draft. */
  const select = useCallback(
    (id: string | null, opts: { fly?: boolean; hash?: boolean } = {}) => {
      const next = id && board.byId.has(id) ? id : null;
      // a draft or open thread belongs to its screen
      const c = comments.get();
      if (c.draft && c.draft.screenId !== next && !discardDraft()) return false;
      const openT = c.threads.find((t) => t.id === c.openId);
      if (openT && openT.screenId !== next) closeThread();
      setFocus({ selected: next });
      if (opts.hash !== false) {
        const url = new URL(location.href);
        url.hash = next ? board.byId.get(next)!.slug : '';
        history.replaceState(null, '', next ? url : url.href.replace(/#$/, ''));
      }
      if (opts.fly && next) focusNode(next);
      return true;
    },
    [board, focusNode, setFocus],
  );

  // Hover previews a screen's links after a short delay, so sweeping the mouse
  // across the board doesn't flash lines everywhere.
  const hoverT = useRef(0);
  const setHover = useCallback(
    (id: string | null) => {
      clearTimeout(hoverT.current);
      if (id === ui.get().hovered) return;
      if (id) hoverT.current = window.setTimeout(() => setFocus({ hovered: id }), 110);
      else setFocus({ hovered: null });
    },
    [setFocus],
  );
  useEffect(() => () => clearTimeout(hoverT.current), []);

  // Initial view: the screen in the URL hash, or everything.
  const fromHash = useCallback(
    (duration: number) => {
      const slug = decodeURIComponent(location.hash.slice(1));
      if (!slug) return false;
      const n = board.bySlug.get(slug);
      if (!n) {
        toast(`There is no screen “${slug}” on this canvas.`, { tone: 'error' });
        history.replaceState(null, '', location.href.split('#')[0]);
        return false;
      }
      select(n.id, { hash: false });
      focusNode(n.id, duration);
      return true;
    },
    [board, focusNode, select],
  );
  const onInit = useCallback(() => {
    if (fromHash(0)) return;
    // on a phone the whole canvas is ~1% zoom: start on the first navigator instead
    const first = layout.regions[0];
    if (window.innerWidth <= 720 && first) rf.setViewport(viewFor({ x: first.x, y: first.y - 400, w: first.w, h: first.h + 400 }, 1, 16));
    else fitAll(0);
  }, [fitAll, fromHash, layout, rf, viewFor]);
  useEffect(() => {
    const onHash = () => fromHash(420);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [fromHash]);
  // leaving the canvas: nothing selected, and media indexes don't carry over to another canvas
  useEffect(() => () => ui.set({ selected: null, hovered: null, linked: new Set(), mediaIdx: {} }), []);

  // Clip playback needs to know where things are.
  useEffect(() => {
    setPlaybackContext(() => {
      const el = wrapRef.current;
      if (!el) return null;
      const vp = rf.getViewport();
      const r = el.getBoundingClientRect();
      const s = ui.get();
      return {
        selected: s.selected,
        hovered: s.hovered,
        zoom: vp.zoom,
        center: { x: (r.width / 2 - vp.x) / vp.zoom, y: (r.height / 2 - vp.y) / vp.zoom },
        centerOf: (id) => {
          const p = layout.pos.get(id);
          return p && { x: p.x + p.w / 2, y: p.y + p.h / 2 };
        },
      };
    });
    return () => setPlaybackContext(() => null);
  }, [layout, rf]);

  // Comments for this board: load now, then keep up with other people's changes.
  useEffect(() => {
    comments.set({ boardId, threads: [], byScreen: new Map(), loaded: false, error: null, openId: null, draft: null, placing: false, seek: null });
    loadThreads();
    const t = setInterval(() => document.visibilityState === 'visible' && loadThreads(), 15000);
    const onFocus = () => loadThreads();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [boardId]);
  const placing = useComments((s) => s.placing);

  // /b/<board>?thread=<id>: open that thread once this board's threads are in.
  const threadsLoaded = useComments((s) => s.loaded && s.boardId === boardId);
  useEffect(() => {
    const c = comments.get();
    if (!threadsLoaded || !c.loaded || c.boardId !== boardId) return;
    const url = new URL(location.href);
    const raw = url.searchParams.get('thread');
    if (raw == null) return;
    url.searchParams.delete('thread');
    history.replaceState(null, '', url);
    const id = Number(raw);
    const t = c.threads.find((x) => x.id === id);
    if (t) {
      if (!board.byId.has(t.screenId)) {
        toast(`#${id} is on screen “${t.screenTitle}”, which this canvas no longer has.`, { tone: 'error' });
        return;
      }
      select(t.screenId, { fly: true });
      openThread(t, board.byId.get(t.screenId));
      return;
    }
    if (c.error) return;
    // not on this canvas: say where it is, if anywhere
    fetchThread(id)
      .then(({ thread }) => toast(`#${id} is on another canvas.`, { link: { to: `/b/${encodeURIComponent(thread.boardId)}?thread=${id}`, label: 'Open it there' } }))
      .catch(() => toast(`There is no issue or comment #${raw}.`, { tone: 'error' }));
  }, [threadsLoaded, boardId, board, select]);
  const openFromList = useCallback(
    (t: Thread) => {
      if (!board.byId.has(t.screenId)) {
        toast(`Screen “${t.screenTitle}” isn't on this canvas any more.`, { tone: 'error' });
        return;
      }
      if (select(t.screenId, { fly: true }) === false) return;
      openThread(t, board.byId.get(t.screenId));
      if (window.innerWidth <= 720) setSide(null);
    },
    [board, select, setSide],
  );
  const goTo = useCallback(
    (id: string) => {
      select(id || null, { fly: !!id });
      if (id && window.innerWidth <= 720) setSide(null);
    },
    [select, setSide],
  );

  // Clicks on a screen: a pin opens its thread; with the comment tool on, a
  // click on the screen drops (or moves) the draft pin; otherwise select.
  const onNodeClick = useCallback(
    (e: React.MouseEvent, n: Node) => {
      if (n.type === 'region' || n.type === 'section') return;
      const target = e.target as HTMLElement;
      const pin = target.closest<HTMLElement>('[data-thread]');
      if (pin) {
        const t = comments.get().threads.find((x) => x.id === Number(pin.dataset.thread));
        if (select(n.id) === false) return;
        if (t) openThread(t, board.byId.get(n.id));
        return;
      }
      const scr = target.closest<HTMLElement>('.scr');
      if (comments.get().placing && n.type === 'screen' && scr) {
        const r = scr.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
        const d = comments.get().draft;
        // a draft on another screen moves here with its text
        if (d && d.screenId !== n.id) comments.set({ draft: null });
        if (select(n.id) === false) return;
        startDraft(board.byId.get(n.id)!, Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000);
        return;
      }
      select(n.id);
    },
    [board, select],
  );

  // Keyboard shortcuts. Browser shortcuts (Ctrl/Cmd/Alt) are left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.matches('input, textarea, select, [contenteditable="true"]')) {
        // Esc leaves a text field (the composer handles its own Esc first)
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const vp = rf.getViewport();
      if (key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (key === '?') setHelp((h) => !h);
      else if (key === 'Escape') {
        if (help) return setHelp(false);
        const c = comments.get();
        if (c.draft) discardDraft();
        else if (c.placing) comments.set({ placing: false });
        else if (c.openId != null) closeThread();
        else select(null);
      } else if (key === 'c') comments.set({ placing: !comments.get().placing });
      else if (key === 'o') setSide(side === 'outline' ? null : 'outline');
      else if (key === 'i') setSide(side === 'issues' ? null : 'issues');
      else if (key === '0') fitAll();
      else if (key === 'f' && ui.get().selected) focusNode(ui.get().selected!);
      else if (key === '+' || key === '=') zoomBy(1.4);
      else if (key === '-') zoomBy(1 / 1.4);
      else if (key.startsWith('Arrow') && !target.closest('.side, .panel, .popover, .results')) {
        e.preventDefault();
        const d = 80;
        rf.setViewport({
          x: vp.x + (key === 'ArrowLeft' ? d : key === 'ArrowRight' ? -d : 0),
          y: vp.y + (key === 'ArrowUp' ? d : key === 'ArrowDown' ? -d : 0),
          zoom: vp.zoom,
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitAll, focusNode, help, rf, select, setSide, side, zoomBy]);

  // Edges for the current link mode, plus the selected / hovered screen's links.
  const edges = useMemo(() => {
    const list: RoutedEdgeType[] = [];
    const add = (id: string, source: string, target: string, d: string, cls: string, marker: string, zIndex?: number) =>
      list.push({ id, source, target, type: 'routed', data: { d, cls }, markerEnd: 'm-' + marker, zIndex, selectable: false, focusable: false });
    if (linkMode === 'all') {
      board.edges.forEach((e, i) => {
        const cat = catOf(e);
        const d = layout.edgePath.get(e);
        if (!catOn[cat] || !d) return;
        const guessed = e.certainty === 'guessed';
        add('a' + i, e.from, e.to, d, `base c-${cat}${guessed ? ' guessed' : ''}`, guessed ? 'guessed' : cat);
      });
    } else if (linkMode === 'flow') {
      for (const g of layout.gutters) {
        if (g.edges.some((e) => catOn[catOf(e)])) add(g.id, g.left, g.right, g.d, `base gut c-${g.cat}`, g.cat);
      }
    }
    const focus = exporting ? [] : [...new Set([selected, hovered].filter((x): x is string => !!x))];
    for (const id of focus) {
      const hov = id !== selected;
      [...(board.outE.get(id) ?? []), ...(board.inE.get(id) ?? [])].forEach((e, i) => {
        const d = layout.edgePath.get(e);
        if (!d || !catOn[catOf(e)]) return;
        const dir = e.from === id ? 'out' : 'in';
        add(`f:${id}:${i}`, e.from, e.to, d, `d-${dir}${hov ? ' hov' : ''}${e.certainty === 'guessed' ? ' guessed' : ''}${catOf(e) === 'inferred' ? ' c-inferred' : ''}`, dir, 1001);
      });
    }
    return list;
  }, [board, layout, linkMode, catOn, selected, hovered, exporting]);

  // PNG export: render every frame with static media, re-size the zoom-
  // dependent labels for the export scale, rasterise, then put it all back.
  const exportPng = useCallback(
    async (kind: ExportKind) => {
      const wrap = wrapRef.current;
      const vpEl = wrap?.querySelector<HTMLElement>('.react-flow__viewport');
      if (!wrap || !vpEl || exportState) return;
      const vp = rf.getViewport();
      const r = wrap.getBoundingClientRect();
      const pad = 160;
      const rect: Rect =
        kind === 'view'
          ? { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: r.width / vp.zoom, h: r.height / vp.zoom }
          : { x: layout.bounds.x - pad, y: layout.bounds.y - pad, w: layout.bounds.w + pad * 2, h: layout.bounds.h + pad * 2 };
      const scale = exportScale(kind, rect, vp.zoom);
      const w = Math.round(rect.w * scale);
      const h = Math.round(rect.h * scale);
      setExportState({ kind, stage: `Rendering ${kind === 'view' ? 'the view' : 'all screens'}…` });
      // thumbnails (240 px) unless frames come out large: full-size captures of
      // every screen would make a whole-canvas export huge and slow
      ui.set({ exporting: PW * scale < 400 ? 'thumb' : 'full' });
      const prevInv = wrap.style.getPropertyValue('--inv');
      const prevFar = wrap.classList.contains('far');
      try {
        // let React Flow mount every node (culling is off while exporting)
        const expected = board.nodes.filter((n) => layout.pos.has(n.id) && n.kind !== 'layout').length;
        const t0 = performance.now();
        while (vpEl.querySelectorAll('.react-flow__node-screen').length < expected && performance.now() - t0 < 8000) await nextFrame();
        await nextFrame();
        wrap.style.setProperty('--inv', (1 / scale).toFixed(4));
        wrap.classList.toggle('far', scale < 0.16);
        setExportState({ kind, stage: `Drawing ${w.toLocaleString()} × ${h.toLocaleString()} px…` });
        await nextFrame();
        await nextFrame();
        const unbake = bakeSvgStyles(vpEl);
        let blob: Blob;
        try {
          blob = await renderPng(vpEl, rect, scale, getComputedStyle(document.body).backgroundColor);
        } finally {
          unbake();
        }
        const date = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        downloadBlob(blob, `${boardId}-${kind === 'view' ? 'view' : 'canvas'}-${date}.png`);
        setExportState(null);
      } catch (e) {
        setExportState({ kind, stage: '', error: (e as Error).message || String(e) });
      } finally {
        wrap.style.setProperty('--inv', prevInv);
        wrap.classList.toggle('far', prevFar);
        ui.set({ exporting: null });
      }
    },
    [board, boardId, exportState, layout, rf],
  );

  const panelOpen = !!selected && board.byId.has(selected);

  return (
    <BoardContext.Provider value={board}>
      <div className="board-app">
        <TopBar
          board={board}
          linkMode={linkMode}
          onLinkMode={(m) => {
            setLinkMode(m);
            prefs.set('links', m);
          }}
          catOn={catOn}
          onToggleCat={(c) =>
            setCatOn((prev) => {
              const next = { ...prev, [c]: !prev[c] };
              prefs.set('cats', next);
              return next;
            })
          }
          wheelMode={wheelMode}
          onWheelMode={(m) => {
            setWheelMode(m);
            prefs.set('wheel', m);
          }}
          onExport={exportPng}
          onPick={(id) => goTo(id)}
          searchRef={searchRef}
          side={side}
          onSide={setSide}
        />
        <main className={`stage${side ? ' side-open' : ''}${panelOpen ? ' panel-open' : ''}`} style={{ '--side-w': `${SIDE_W}px`, '--panel-w': `${PANEL_W}px` } as CSSProperties}>
          <div className={`canvas${selected && !exporting ? ' focus' : ''}${placing ? ' placing' : ''}${exporting ? ' exporting' : ''}`} ref={wrapRef}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onlyRenderVisibleElements={!exporting}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              zoomOnScroll={false}
              panOnScroll={false}
              zoomOnDoubleClick={false}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              nodesFocusable={false}
              edgesFocusable={false}
              colorMode={theme === 'auto' ? 'system' : theme}
              attributionPosition="top-right"
              onInit={onInit}
              onMoveStart={(e) => e && stopZoom()}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={(_, n) => n.type !== 'region' && n.type !== 'section' && focusNode(n.id)}
              onNodeMouseEnter={(_, n) => (n.type === 'screen' || n.type === 'pill') && setHover(n.id)}
              onNodeMouseLeave={() => setHover(null)}
              onPaneClick={() => select(null)}
            >
              <Background variant={BackgroundVariant.Dots} gap={28} size={1.4} />
              {exporting && (
                <ViewportPortal>
                  {/* arrowheads must live inside the exported element */}
                  <EdgeMarkers />
                  <div className="export-caption" style={{ transform: `translate(${layout.bounds.x}px, ${layout.bounds.y - 150}px)` }}>
                    <b>{file.title}</b>
                    <span>
                      {[file.source.release, file.source.commit?.slice(0, 7), deviceLine(file.device), `exported ${new Date().toLocaleString()}`].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                </ViewportPortal>
              )}
              <MiniMap
                position="bottom-left"
                pannable
                zoomable
                ariaLabel="Canvas overview"
                nodeColor={(n) => (n.type === 'region' ? `color-mix(in srgb, ${(n.data as { hue: string }).hue} 18%, transparent)` : n.type === 'section' ? 'transparent' : hueOf((n.data as { screen: { group: string } }).screen.group))}
                nodeBorderRadius={24}
                maskColor="var(--minimap-mask)"
              />
            </ReactFlow>
            <EdgeMarkers />
          </div>
          {placing && (
            <div className="mode-banner" role="status">
              <Icon name="pin" />
              <span>
                Comment mode<span className="hide-sm"> · click a screen to pin</span>
              </span>
              <button className="btn sm" onClick={() => comments.set({ placing: false })}>
                Done <span className="hide-sm">(Esc)</span>
              </button>
            </div>
          )}
          {side && <Sidebar board={board} layout={layout} tab={side} onTab={setSide} onGo={goTo} onOpen={openFromList} />}
          <Panel board={board} onGo={goTo} />
          <div className="zoombar float" role="toolbar" aria-label="Zoom">
            <button className="btn ghost sm icon-only" aria-label="Zoom out (−)" title="Zoom out (−)" onClick={() => zoomBy(1 / 1.4)}>
              <Icon name="minus" />
            </button>
            <span className="zoomv" id="zoomv" aria-live="off">
              –
            </span>
            <button className="btn ghost sm icon-only" aria-label="Zoom in (+)" title="Zoom in (+)" onClick={() => zoomBy(1.4)}>
              <Icon name="plus" />
            </button>
            <button className="btn ghost sm icon-only" aria-label="Fit the whole canvas (0)" title="Fit the whole canvas (0)" onClick={() => fitAll()}>
              <Icon name="fit" />
            </button>
            <button className="btn ghost sm icon-only hide-sm" aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)" onClick={() => setHelp(true)}>
              <Icon name="keyboard" />
            </button>
          </div>
          {help && <Shortcuts onClose={() => setHelp(false)} />}
          {exportState && (
            <div className="export-overlay" role="status">
              <div className="float">
                {exportState.error ? (
                  <>
                    <b>Export failed</b>
                    <p>{exportState.error}</p>
                    <button className="btn" onClick={() => setExportState(null)}>
                      Close
                    </button>
                  </>
                ) : (
                  <>
                    <b>Exporting PNG</b>
                    <p>{exportState.stage}</p>
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </BoardContext.Provider>
  );
}
