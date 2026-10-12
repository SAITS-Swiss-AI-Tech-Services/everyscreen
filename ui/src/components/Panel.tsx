import { useEffect, useState, type ReactNode } from 'react';
import { catColor, catOf, groupTitle, isUnreached, type Board } from '../board';
import { isOpen, useComments } from '../comments';
import { ui, useUi } from '../store';
import type { EdgeData, ScreenData } from '../types';
import { ScreenComments } from './Comments';
import { Icon, mediaIcon } from './icons';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn ghost sm icon-only"
      title={done ? 'Copied' : `Copy ${label}`}
      aria-label={`Copy ${label}`}
      onClick={() =>
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          })
          .catch(() => {})
      }
    >
      <Icon name={done ? 'check' : 'copy'} size={14} />
    </button>
  );
}

function EdgeItem({ board, e, dir, onGo }: { board: Board; e: EdgeData; dir: 'out' | 'in'; onGo: (id: string) => void }) {
  const otherId = dir === 'out' ? e.to : e.from;
  const other = board.byId.get(otherId);
  const details = [
    e.certainty !== 'certain' ? e.certainty : null,
    e.note,
    e.via ? 'via ' + e.via.join(', ') : null,
    e.sites.slice(0, 2).join(', ') + (e.sites.length > 2 ? ` +${e.sites.length - 2}` : ''),
  ]
    .filter(Boolean)
    .join(' · ');
  const color = e.certainty === 'guessed' ? 'var(--e-guessed)' : catColor[catOf(e)];
  return (
    <li>
      <button onClick={() => onGo(otherId)}>
        <span className="k" style={{ color }}>
          {e.kind}
        </span>
        {dir === 'out' ? '→ ' : '← '}
        {other?.title ?? otherId}
        <small className="mono">{details}</small>
      </button>
    </li>
  );
}

/** Right-hand panel for the selected screen: details and comments. */
export function Panel({ board, onGo }: { board: Board; onGo: (id: string) => void }) {
  const selected = useUi((s) => s.selected);
  const mediaIdx = useUi((s) => (selected ? (s.mediaIdx[selected] ?? 0) : 0));
  const [tab, setTab] = useState<'details' | 'comments'>('details');
  // a pin being placed or a thread being opened on this screen shows the comments tab
  const commentFocus = useComments((s) => !!selected && (s.draft?.screenId === selected || (s.openId != null && !!s.byScreen.get(selected)?.some((t) => t.id === s.openId))));
  const openCount = useComments((s) => (selected ? (s.byScreen.get(selected)?.filter(isOpen).length ?? 0) : 0));
  const placing = useComments((s) => s.placing);
  useEffect(() => {
    if (commentFocus || placing) setTab('comments');
  }, [commentFocus, placing, selected]);
  const n = selected ? board.byId.get(selected) : undefined;
  if (!n) return null;

  return (
    <aside className="panel float" aria-label={`Screen: ${n.title}`}>
      <div className="panel-head">
        <div className="top">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{n.title}</h2>
            {(n.route || n.kind === 'drawer' || n.kind === 'sheet') && <div className="route">{n.route ?? (n.kind === 'sheet' ? `pop-up · ${n.component}` : 'in place · ' + n.id.slice(7))}</div>}
          </div>
          <button className="btn ghost sm icon-only" aria-label="Close panel (Esc)" title="Close (Esc)" onClick={() => onGo('')}>
            <Icon name="x" />
          </button>
        </div>
        <div className="panel-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>
            Details
          </button>
          <button role="tab" aria-selected={tab === 'comments'} className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>
            Comments
            {openCount > 0 && <span className="count">{openCount}</span>}
          </button>
        </div>
      </div>
      <div className="panel-body">{tab === 'comments' ? <ScreenComments board={board} n={n} /> : <Details board={board} n={n} mediaIdx={mediaIdx} onGo={onGo} />}</div>
    </aside>
  );
}

function Details({ board, n, mediaIdx, onGo }: { board: Board; n: ScreenData; mediaIdx: number; onGo: (id: string) => void }) {
  const src = board.file.source;
  const gh = src.repo && src.commit && n.file ? `https://github.com/${src.repo}/blob/${src.commit}/${encodeURI(n.file)}` : null;
  const outs = board.outE.get(n.id) ?? [];
  const ins = board.inE.get(n.id) ?? [];
  const flows = board.flowsOf.get(n.id) ?? [];
  const rows: [string, ReactNode][] = [];
  if (n.route) rows.push(['Route', <span className="mono">{n.route}</span>]);
  if (n.deepLink) rows.push(['Deep link', <><span className="mono">{n.deepLink}</span><CopyButton text={n.deepLink} label="deep link" /></>]);
  if (n.file)
    rows.push([
      'File',
      gh ? (
        <a className="mono" href={gh} target="_blank" rel="noopener noreferrer" title="Open on GitHub at this release">
          {n.file}
        </a>
      ) : (
        <span className="mono">{n.file}</span>
      ),
    ]);
  if (n.component) rows.push(['Component', <span className="mono">{n.component}</span>]);
  if (n.params.length) rows.push(['Params', <span className="mono">{n.params.join(', ')}</span>]);

  return (
    <>
      <div className="tags">
        <span className="badge">{groupTitle(board, n.group) + (n.section ? ' / ' + n.section : '')}</span>
        {n.kind !== 'screen' && <span className="badge outline">{n.kind}</span>}
        {n.flags.map((f) => (
          <span key={f} className="badge warn">
            {f}
          </span>
        ))}
        {isUnreached(board, n) && <span className="badge warn">no incoming navigation found</span>}
      </div>
      {rows.length > 0 && (
        <dl className="props">
          {rows.map(([k, v]) => (
            <div key={k} className="row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <h3>Captures ({n.media.length})</h3>
      {n.media.length ? (
        <div className="mlist">
          {n.media.map((m, i) => (
            <button key={m.file} className={i === mediaIdx ? 'cur' : ''} aria-pressed={i === mediaIdx} onClick={() => ui.setMedia(n.id, i)}>
              <Icon name={mediaIcon[m.type]} />
              <span style={{ minWidth: 0 }}>
                {m.label}
                <small>{m.file}</small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="panel-empty">
          No capture yet. Put PNG, MP4 or HTML files in <span className="mono">screens/{n.slug}/</span>
        </div>
      )}

      {n.kind === 'flow' && (
        <>
          <h3>Screens in this recording ({n.screens?.length ?? 0})</h3>
          <ul className="elist">
            {(n.screens ?? [])
              .filter((s) => board.byId.has(s))
              .map((s) => (
                <li key={s}>
                  <button onClick={() => onGo(s)}>{board.byId.get(s)!.title}</button>
                </li>
              ))}
          </ul>
        </>
      )}
      {flows.length > 0 && (
        <>
          <h3>Appears in recordings</h3>
          <ul className="elist">
            {flows.map((f) => (
              <li key={f.id}>
                <button onClick={() => onGo(f.id)}>
                  <Icon name="play" size={12} /> {f.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>
        <span className="dot" style={{ background: 'var(--dir-out)' }} />
        Leads to ({outs.length})
      </h3>
      {outs.length ? (
        <ul className="elist">
          {outs.map((e, i) => (
            <EdgeItem key={i} board={board} e={e} dir="out" onGo={onGo} />
          ))}
        </ul>
      ) : (
        <div className="panel-empty">No outgoing navigation found in code</div>
      )}
      <h3>
        <span className="dot" style={{ background: 'var(--dir-in)' }} />
        Reached from ({ins.length})
      </h3>
      {ins.length ? (
        <ul className="elist">
          {ins.map((e, i) => (
            <EdgeItem key={i} board={board} e={e} dir="in" onGo={onGo} />
          ))}
        </ul>
      ) : (
        <div className="panel-empty">No incoming navigation found in code</div>
      )}
    </>
  );
}
