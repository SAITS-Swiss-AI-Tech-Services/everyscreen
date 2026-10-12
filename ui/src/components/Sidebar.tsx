import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { groupTitle, hueOf, type Board } from '../board';
import { comments, isOpen, SEVERITY_LABEL, STATUS_LABEL, timeAgo, useComments, type Severity, type Thread } from '../comments';
import { downloadCsv, fileSlug, toCsv } from '../csv';
import type { Layout } from '../layout';
import { prefs, useUi } from '../store';
import type { ScreenData } from '../types';
import { Icon } from './icons';
import { threadLink } from './IssuesPage';
import type { SideTab } from './TopBar';
import { APP_NAME } from '../appConfig';

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const EMPTY: Thread[] = [];

/** Left sidebar of a canvas: an outline of every screen, and its issues. */
export function Sidebar({ board, layout, tab, onTab, onGo, onOpen }: { board: Board; layout: Layout; tab: SideTab; onTab: (t: SideTab | null) => void; onGo: (id: string) => void; onOpen: (t: Thread) => void }) {
  const openIssues = useComments((s) => s.threads.filter((t) => t.kind === 'issue' && isOpen(t)).length);
  return (
    <aside className="side float" aria-label="Canvas sidebar">
      <div className="side-head">
        <div className="side-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'outline'} className={tab === 'outline' ? 'on' : ''} onClick={() => onTab('outline')}>
            <Icon name="list" size={15} />
            Outline
          </button>
          <button role="tab" aria-selected={tab === 'issues'} className={tab === 'issues' ? 'on' : ''} onClick={() => onTab('issues')}>
            <Icon name="flag" size={15} />
            Issues
            <span className={openIssues ? 'count hot' : 'count'}>{openIssues}</span>
          </button>
        </div>
        <button className="btn ghost sm icon-only" aria-label="Close sidebar" title="Close sidebar" onClick={() => onTab(null)}>
          <Icon name="x" />
        </button>
      </div>
      {tab === 'outline' ? <Outline board={board} layout={layout} onGo={onGo} /> : <IssuesList board={board} onOpen={onOpen} />}
    </aside>
  );
}

function Outline({ board, layout, onGo }: { board: Board; layout: Layout; onGo: (id: string) => void }) {
  const selected = useUi((s) => s.selected);
  const byScreen = useComments((s) => s.byScreen);
  const [closed, setClosed] = useState<Record<string, boolean>>(() => prefs.get('outline.closed', {}));
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    // same order as on the board: regions left to right, frames row by row
    return layout.regions.map((r) => {
      const items = board.nodes
        .filter((n) => n.group === r.gid && layout.pos.has(n.id))
        .sort((a, b) => layout.pos.get(a.id)!.y - layout.pos.get(b.id)!.y || layout.pos.get(a.id)!.x - layout.pos.get(b.id)!.x);
      return { gid: r.gid, items };
    });
  }, [board, layout]);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (n: ScreenData) => !terms.length || terms.every((t) => [n.title, n.route, n.id].join(' ').toLowerCase().includes(t));
  const toggle = (gid: string) =>
    setClosed((c) => {
      const next = { ...c, [gid]: !c[gid] };
      prefs.set('outline.closed', next);
      return next;
    });

  return (
    <>
      <div className="side-tools">
        <div className="search-input">
          <Icon name="filter" size={14} />
          <input className="input" type="search" placeholder="Filter screens" aria-label="Filter screens" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="side-body">
        {groups.map(({ gid, items }) => {
          const shown = items.filter(match);
          if (terms.length && !shown.length) return null;
          const open = terms.length > 0 || !closed[gid];
          let lastSection: string | null | undefined;
          return (
            <div key={gid} className="outline-group">
              <button className={`outline-head${open ? ' open' : ''}`} aria-expanded={open} onClick={() => toggle(gid)} style={{ '--g': hueOf(gid) } as React.CSSProperties}>
                <Icon name="chevronRight" size={14} className="chev" />
                <i className="swatch" />
                {groupTitle(board, gid)}
                <span className="n">{items.filter((n) => n.kind !== 'layout').length}</span>
              </button>
              {open &&
                shown.map((n) => {
                  const threads = (byScreen.get(n.id) ?? EMPTY).filter(isOpen);
                  const issues = threads.filter((t) => t.kind === 'issue').length;
                  const sectionRow = n.section && n.section !== lastSection && !terms.length ? <div className="outline-section">{n.section}</div> : null;
                  lastSection = n.section;
                  const captured = n.media.some((m) => m.type !== 'html');
                  return (
                    <div key={n.id}>
                      {sectionRow}
                      <button className={`outline-item${selected === n.id ? ' sel' : ''}`} aria-current={selected === n.id ? 'true' : undefined} onClick={() => onGo(n.id)} title={n.route ?? n.id}>
                        <i className={`cap${captured ? ' on' : ''}`} aria-label={captured ? 'Captured' : 'No capture yet'} />
                        <span className="t">{n.kind === 'layout' ? `${n.title} (layout)` : n.title}</span>
                        {threads.length > 0 && <span className={`n${issues ? ' issue' : ''}`} title={`${threads.length} open (${issues} issues)`}>{threads.length}</span>}
                      </button>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
      <div className="outline-legend">
        <span>
          <i className="on" /> captured
        </span>
        <span>
          <i /> no capture yet
        </span>
      </div>
    </>
  );
}

function IssuesList({ board, onOpen }: { board: Board; onOpen: (t: Thread) => void }) {
  const threads = useComments((s) => s.threads);
  const showResolved = useComments((s) => s.showResolved);
  const boardId = useComments((s) => s.boardId);
  const [kind, setKind] = useState<'issue' | 'comment' | 'all'>(() => prefs.get('drawer.kind', 'all'));
  const [status, setStatus] = useState<'open' | 'done' | 'all'>(() => prefs.get('drawer.status', 'open'));
  const [severity, setSeverity] = useState<Severity | 'any'>('any');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'updated' | 'severity' | 'screen'>(() => prefs.get('drawer.sort', 'updated'));

  const rows = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = threads.filter((t) => {
      if (kind !== 'all' && t.kind !== kind) return false;
      if (status === 'open' && !isOpen(t)) return false;
      if (status === 'done' && isOpen(t)) return false;
      if (severity !== 'any' && t.severity !== severity) return false;
      if (terms.length) {
        const hay = [t.title, t.excerpt, t.screenTitle, t.assignee, t.author, '#' + t.id].join(' ').toLowerCase();
        if (!terms.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    return list.sort((a, b) =>
      sort === 'severity'
        ? (SEV_RANK[a.severity ?? ''] ?? 9) - (SEV_RANK[b.severity ?? ''] ?? 9) || b.updatedAt.localeCompare(a.updatedAt)
        : sort === 'screen'
          ? a.screenTitle.localeCompare(b.screenTitle) || a.id - b.id
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [threads, kind, status, severity, q, sort]);

  const persist = <T,>(key: string, set: (v: T) => void) => (v: T) => {
    set(v);
    prefs.set('drawer.' + key, v);
  };
  const download = () => {
    const head = ['id', 'kind', 'status', 'severity', 'title', 'first message', 'screen', 'route', 'group', 'assignee', 'author', 'replies', 'release', 'created', 'updated', 'link'];
    const body = rows.map((t) => {
      const n = board.byId.get(t.screenId);
      return [t.id, t.kind, t.status, t.severity, t.title, t.excerpt, t.screenTitle, n?.route ?? t.screenId, n ? groupTitle(board, n.group) : '', t.assignee, t.author, Math.max(0, t.messageCount - 1), t.release, t.createdAt, t.updatedAt, location.origin + threadLink(t)];
    });
    downloadCsv(toCsv(head, body), `${fileSlug(APP_NAME)}-${boardId}-${kind === 'all' ? 'feedback' : kind + 's'}-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <>
      <div className="side-tools">
        <div className="search-input">
          <Icon name="search" size={14} />
          <input className="input" type="search" placeholder="Text, screen, person, #id" aria-label="Filter issues" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="row">
          <select className="select" aria-label="Kind" value={kind} onChange={(e) => persist('kind', setKind)(e.target.value as typeof kind)}>
            <option value="all">Issues + comments</option>
            <option value="issue">Issues</option>
            <option value="comment">Comments</option>
          </select>
          <select className="select" aria-label="Status" value={status} onChange={(e) => persist('status', setStatus)(e.target.value as typeof status)}>
            <option value="open">Open</option>
            <option value="done">Resolved / won't fix</option>
            <option value="all">Any status</option>
          </select>
          <select className="select" aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as Severity | 'any')}>
            <option value="any">Any severity</option>
            {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABEL[s]}
              </option>
            ))}
          </select>
          <select className="select" aria-label="Sort" value={sort} onChange={(e) => persist('sort', setSort)(e.target.value as typeof sort)}>
            <option value="updated">Recently active</option>
            <option value="severity">By severity</option>
            <option value="screen">By screen</option>
          </select>
        </div>
      </div>
      <div className="side-body">
        <ul className="tlist">
          {rows.map((t) => (
            <li key={t.id}>
              <button className={`trow${isOpen(t) ? '' : ' done'}`} onClick={() => onOpen(t)}>
                <span className={`kind-dot ${t.kind} sev-${t.severity ?? 'none'}${isOpen(t) ? '' : ' done'}`} aria-label={t.kind}>
                  <Icon name={t.kind === 'issue' ? 'flag' : 'message'} size={12} />
                </span>
                <span className="trow-main">
                  <span className="trow-title">{t.title ?? t.excerpt}</span>
                  <span className="trow-meta">
                    <span className="trow-id">#{t.id}</span>
                    <span>{t.screenTitle}</span>
                    <span>{STATUS_LABEL[t.status]}</span>
                    {t.severity && <span>{SEVERITY_LABEL[t.severity]}</span>}
                    {t.assignee && <span>→ {t.assignee}</span>}
                    <span>{timeAgo(t.updatedAt)}</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!rows.length && (
          <div className="empty">
            <b>{threads.length ? 'Nothing matches' : 'No feedback yet'}</b>
            {threads.length ? 'Try other filters.' : 'Press C and click a screen to pin a comment or issue.'}
          </div>
        )}
      </div>
      <div className="side-foot">
        <label className="check">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => {
              comments.set({ showResolved: e.target.checked });
              prefs.set('showResolved', e.target.checked);
            }}
          />
          Resolved pins
        </label>
        <span className="grow" />
        <button className="btn sm ghost" onClick={download} disabled={!rows.length} title="Download these rows as CSV">
          <Icon name="download" size={14} />
          CSV
        </button>
        <Link className="btn sm ghost" to={`/issues?board=${encodeURIComponent(boardId ?? '')}&kind=all`} title="Open the full issues table">
          Table
          <Icon name="external" size={13} />
        </Link>
      </div>
    </>
  );
}
