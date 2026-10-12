import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { CATS, catOf, groupTitle, hueOf, type Board, type Cat } from '../board';
import { comments, isOpen, useComments } from '../comments';
import { EXPORT_OPTIONS, type ExportKind } from '../exportPng';
import type { ScreenData } from '../types';
import { Icon } from './icons';
import { IdentityChip, initials, Menu, ThemeMenu } from './ui';
import { APP_NAME } from '../appConfig';

export type LinkMode = 'flow' | 'all' | 'off';
export type WheelMode = 'zoom' | 'pan';
export type SideTab = 'outline' | 'issues';

interface Props {
  board: Board;
  linkMode: LinkMode;
  onLinkMode: (m: LinkMode) => void;
  catOn: Record<Cat, boolean>;
  onToggleCat: (c: Cat) => void;
  wheelMode: WheelMode;
  onWheelMode: (m: WheelMode) => void;
  onExport: (kind: ExportKind) => void;
  onPick: (id: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  side: SideTab | null;
  onSide: (tab: SideTab | null) => void;
}

export const deviceLine = (d: { model: string | null; os: string | null; resolution: string | null } | null) => (d ? [d.model, d.os, d.resolution].filter(Boolean).join(' · ') || null : null);

function Search({ board, onPick, inputRef }: { board: Board; onPick: (id: string) => void; inputRef: Props['searchRef'] }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const hits = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [] as ScreenData[];
    return board.nodes
      .filter((n) => {
        const hay = [n.title, n.id, n.route, n.component, n.file, n.section, groupTitle(board, n.group)].join(' ').toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, 14);
  }, [board, q]);
  const pick = (i: number) => {
    const n = hits[i];
    if (!n) return;
    setOpen(false);
    inputRef.current?.blur();
    onPick(n.id);
  };
  return (
    <div className="board-search">
      <div className="search-input">
        <Icon name="search" size={15} />
        <input
          ref={inputRef}
          className="input"
          type="search"
          placeholder="Search screens, routes, files"
          aria-label="Search screens"
          role="combobox"
          aria-expanded={open && !!q.trim()}
          aria-controls="screen-search-results"
          autoComplete="off"
          spellCheck={false}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, Math.min(hits.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
            } else if (e.key === 'Enter') pick(active);
            else if (e.key === 'Escape') {
              setQ('');
              inputRef.current?.blur();
            }
          }}
        />
        <span className="kbd">/</span>
      </div>
      {open && q.trim() && (
        <div className="results" id="screen-search-results" role="listbox">
          {hits.length ? (
            hits.map((n, i) => (
              <button key={n.id} role="option" aria-selected={i === active} className={'res' + (i === active ? ' active' : '')} onMouseDown={(e) => (e.preventDefault(), pick(i))} tabIndex={-1}>
                <i className="res-dot" style={{ '--g': hueOf(n.group) } as React.CSSProperties} />
                <span>
                  {n.title}
                  <small>{n.route ?? n.id}</small>
                </span>
              </button>
            ))
          ) : (
            <div className="res-empty">No screens match “{q.trim()}”</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Link display and wheel settings (in the View menu, or More on phones). */
function ViewOptions(p: Props) {
  const counts = useMemo(() => {
    const c = {} as Record<Cat, number>;
    for (const e of p.board.edges) c[catOf(e)] = (c[catOf(e)] ?? 0) + 1;
    return c;
  }, [p.board]);
  return (
    <>
      <div className="popover-label">Arrows between screens</div>
      <div className="popover-block">
        <div className="seg" role="radiogroup" aria-label="Arrows between screens">
          {(
            [
              ['flow', 'Flow', 'Arrows between neighbouring screens; hover or click a screen for all its links'],
              ['all', 'All', 'Every link at once'],
              ['off', 'Off', 'No arrows until you hover or click a screen'],
            ] as const
          ).map(([m, label, title]) => (
            <button key={m} role="radio" aria-checked={p.linkMode === m} className={p.linkMode === m ? 'on' : ''} title={title} onClick={() => p.onLinkMode(m)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="popover-label">Link types</div>
      {CATS.map((c) => (
        <button key={c.id} role="menuitemcheckbox" aria-checked={p.catOn[c.id]} className={'item' + (p.catOn[c.id] ? '' : ' off')} style={{ '--c': c.color } as React.CSSProperties} onClick={() => p.onToggleCat(c.id)}>
          <i className="swatch" />
          {c.label}
          <span className="item-end">{counts[c.id] ?? 0}</span>
        </button>
      ))}
      <div className="popover-sep" />
      <div className="popover-label">Mouse wheel</div>
      <div className="popover-block">
        <div className="seg" role="radiogroup" aria-label="Mouse wheel">
          {(['zoom', 'pan'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={p.wheelMode === m} className={p.wheelMode === m ? 'on' : ''} onClick={() => p.onWheelMode(m)}>
              {m === 'zoom' ? 'Zooms' : 'Pans (trackpad)'}
            </button>
          ))}
        </div>
        <div className="hint-text">Ctrl + wheel or pinch always zooms.</div>
      </div>
    </>
  );
}

function ExportItems({ onExport, close }: { onExport: (k: ExportKind) => void; close: () => void }) {
  return (
    <>
      <div className="popover-label">Download PNG</div>
      {EXPORT_OPTIONS.map((o) => (
        <button
          key={o.kind}
          className="item"
          onClick={() => {
            close();
            onExport(o.kind);
          }}
        >
          <Icon name="image" />
          <span>
            {o.label}
            <small>{o.hint}</small>
          </span>
        </button>
      ))}
    </>
  );
}

export function TopBar(p: Props) {
  const { board } = p;
  const src = board.file.source;
  const placing = useComments((s) => s.placing);
  const openIssues = useComments((s) => s.threads.filter((t) => t.kind === 'issue' && isOpen(t)).length);
  const frames = board.nodes.filter((n) => n.kind !== 'layout' && n.kind !== 'flow');
  const captured = frames.filter((n) => n.media.some((m) => m.type !== 'html')).length;
  const sub = [deviceLine(board.file.device) ?? 'No device yet', `${captured}/${frames.length} captured`].join(' · ');
  const toggleSide = (tab: SideTab) => p.onSide(p.side === tab ? null : tab);

  return (
    <header className="board-bar">
      <Link to="/" className="brand" aria-label="All canvases" title="All canvases">
        <span className="brand-mark" aria-hidden="true">
          {initials(APP_NAME)}
        </span>
      </Link>
      <nav className="crumb" aria-label="Breadcrumb">
        <Link className="crumb-root hide-sm" to="/">
          Canvases
        </Link>
        <Icon name="chevronRight" size={14} className="hide-sm" />
        <div className="crumb-title" title={`${[src.release, src.commit?.slice(0, 7)].filter(Boolean).join(' · ')} · generated ${new Date(board.file.generatedAt).toLocaleString()}`}>
          <b>{board.file.title}</b>
          <span className="hide-sm">{sub}</span>
        </div>
      </nav>
      <Search board={board} onPick={p.onPick} inputRef={p.searchRef} />
      <div className="grow" />
      <button className={`btn hide-sm${p.side === 'outline' ? ' on' : ''}`} aria-pressed={p.side === 'outline'} onClick={() => toggleSide('outline')} title="Outline of every screen">
        <Icon name="sidebar" />
        <span className="hide-md">Outline</span>
      </button>
      <button className={`btn${placing ? ' on' : ''}`} aria-pressed={placing} onClick={() => comments.set({ placing: !placing })} title="Comment tool (C): click a screen to pin a comment or issue">
        <Icon name="pin" />
        <span className="hide-sm">Comment</span>
      </button>
      <button className={`btn${p.side === 'issues' ? ' on' : ''}`} aria-pressed={p.side === 'issues'} onClick={() => toggleSide('issues')} title="Issues and comments on this canvas">
        <Icon name="flag" />
        <span className="hide-sm">Issues</span>
        <span className={openIssues ? 'count hot' : 'count'} aria-label={`${openIssues} open issues`}>
          {openIssues}
        </span>
      </button>
      <span className="bar-sep hide-sm" />
      <Menu className="hide-sm" icon="eye" label={<span className="hide-md">View</span>} title="Arrows, link types, mouse wheel">
        {() => <ViewOptions {...p} />}
      </Menu>
      <Menu className="hide-sm" icon="download" title="Download as PNG">
        {(close) => <ExportItems onExport={p.onExport} close={close} />}
      </Menu>
      <span className="hide-sm">
        <IdentityChip />
      </span>
      <span className="hide-sm">
        <ThemeMenu />
      </span>
      <Menu className="show-sm" icon="more" title="More">
        {(close) => (
          <>
            <button
              className="item"
              onClick={() => {
                close();
                toggleSide('outline');
              }}
            >
              <Icon name="sidebar" />
              Outline of screens
            </button>
            <div className="popover-sep" />
            <ViewOptions {...p} />
            <div className="popover-sep" />
            <ExportItems onExport={p.onExport} close={close} />
          </>
        )}
      </Menu>
    </header>
  );
}
