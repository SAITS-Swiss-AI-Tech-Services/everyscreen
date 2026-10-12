import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { mediaUrl } from '../board';
import { SEVERITY_LABEL, timeAgo, type Severity } from '../comments';
import { prefs } from '../store';
import type { BoardSummary } from '../types';
import { Icon } from './icons';
import { deviceLine } from './TopBar';
import { AppHeader, SeverityBadge } from './ui';
import { APP_NAME } from '../appConfig.ts';

const API = `${import.meta.env.BASE_URL}api`;
const SEVERITIES: (Severity | 'none')[] = ['critical', 'high', 'medium', 'low', 'none'];
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

type Sort = 'newest' | 'issues' | 'name';

async function json<T>(r: Response): Promise<T> {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `${r.status} ${r.statusText}`);
  return data as T;
}

export function useBoards() {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const data = await json<{ boards: BoardSummary[] }>(await fetch(`${API}/boards`, { cache: 'no-store' }));
      setBoards(data.boards);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 30000);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', load);
    };
  }, [load]);
  /** title / notes null: back to the name from board.json / no notes. */
  const update = async (id: string, patch: { title?: string | null; notes?: string | null; archived?: boolean }) => {
    const data = await json<BoardSummary>(await fetch(`${API}/boards/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }));
    setBoards((list) => list?.map((b) => (b.id === id ? data : b)) ?? null);
  };
  return { boards, error, update };
}

function SeverityBadges({ counts }: { counts: Record<string, number> }) {
  const present = SEVERITIES.filter((s) => counts[s]);
  if (!present.length) return null;
  return (
    <>
      {present.map((s) => (
        <SeverityBadge key={s} severity={s} label={`${counts[s]} ${s === 'none' ? 'unrated' : SEVERITY_LABEL[s as Severity].toLowerCase()}`} />
      ))}
    </>
  );
}

function CanvasCard({ b, onUpdate }: { b: BoardSummary; onUpdate: ReturnType<typeof useBoards>['update'] }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(b.title);
  const [notes, setNotes] = useState(b.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const screens = b.stats.screens ?? 0;
  const captured = b.stats.captured ?? 0;
  const pct = screens ? Math.round((captured / screens) * 100) : 0;
  const device = deviceLine(b.device);
  const commitUrl = b.source.repo && b.source.commit ? `https://github.com/${b.source.repo}/commit/${b.source.commit}` : null;
  const href = `/b/${encodeURIComponent(b.id)}`;
  const save = async (patch: Parameters<typeof onUpdate>[1]) => {
    setError(null);
    try {
      await onUpdate(b.id, patch);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const t = b.threads;
  return (
    <article className={`canvas-card${b.archived ? ' archived' : ''}`}>
      <Link to={href} className="cc-preview" aria-label={`Open ${b.title}`} tabIndex={-1}>
        {b.preview.length ? (
          b.preview.map((u) => <img key={u} src={mediaUrl(u)} alt="" loading="lazy" />)
        ) : (
          <div className="cc-preview-empty">
            <b>{screens} screens</b>
            No captures yet
          </div>
        )}
        {t.openIssues > 0 && (
          <span className="badge hot">
            {t.openIssues} open issue{t.openIssues === 1 ? '' : 's'}
          </span>
        )}
      </Link>
      <div className="cc-body">
        {editing ? (
          <div>
            <label className="field">
              <span>Title</span>
              <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>Notes</span>
              <textarea value={notes} maxLength={2000} rows={3} onChange={(e) => setNotes(e.target.value)} placeholder="What this canvas is for, who should review it…" />
            </label>
            {error && <div className="error-text">{error}</div>}
            <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
              <button className="btn primary sm" onClick={() => save({ title: title.trim() || null, notes: notes.trim() || null })}>
                Save
              </button>
              <button className="btn sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="cc-title-row">
              <Link to={href} className="cc-title">
                {b.title}
              </Link>
              {b.demo && <span className="badge accent">demo</span>}
              {b.source.dirty && (
                <span className="badge" title={`Built from ${b.source.branch ?? 'a working tree'} with uncommitted changes, not a published release`}>
                  custom build
                </span>
              )}
              {b.archived && <span className="badge">archived</span>}
            </div>
            {b.notes && <p className="cc-notes">{b.notes}</p>}
          </>
        )}
        <dl className="cc-meta">
          <div>
            <dt>App release</dt>
            <dd className="mono" title={b.source.release ?? undefined}>
              {b.source.release ?? '—'}
            </dd>
          </div>
          <div>
            <dt>Commit</dt>
            <dd className="mono">
              {commitUrl ? (
                <a href={commitUrl} target="_blank" rel="noopener noreferrer">
                  {b.source.commit!.slice(0, 7)}
                </a>
              ) : (
                (b.source.commit?.slice(0, 7) ?? '—')
              )}
            </dd>
          </div>
          <div>
            <dt>Device</dt>
            <dd title={device ?? undefined}>{device ?? <span className="muted">Not captured yet</span>}</dd>
          </div>
          <div>
            <dt>Last capture</dt>
            <dd>{fmtDate(b.capturedAt)}</dd>
          </div>
        </dl>
        <div className="meter" title={`${captured} of ${screens} screens have a screenshot or clip`}>
          <span className="meter-bar">
            <i style={{ width: `${pct}%` }} />
          </span>
          <span>
            {captured}/{screens} captured{b.stats.withClips ? ` · ${b.stats.withClips} clips` : ''}
          </span>
        </div>
        <div className="cc-threads">
          <Link className={t.openIssues ? 'hot' : ''} to={`/issues?board=${encodeURIComponent(b.id)}`} title="List this canvas's issues">
            <b>{t.openIssues}</b> open issue{t.openIssues === 1 ? '' : 's'}
          </Link>
          <SeverityBadges counts={t.bySeverity} />
          <span>
            · <b>{t.openComments}</b> comment{t.openComments === 1 ? '' : 's'}
          </span>
          <span>
            · <b>{t.resolved}</b> resolved
          </span>
        </div>
        <div className="cc-foot">
          <Link className="btn primary sm" to={href}>
            Open canvas
          </Link>
          {!editing && (
            <button
              className="btn sm ghost"
              onClick={() => {
                setTitle(b.title);
                setNotes(b.notes ?? '');
                setEditing(true);
              }}
            >
              <Icon name="edit" size={14} />
              Edit
            </button>
          )}
          <button className="btn sm ghost" onClick={() => save({ archived: !b.archived })}>
            <Icon name="archive" size={14} />
            {b.archived ? 'Unarchive' : 'Archive'}
          </button>
          <span className="grow" />
          <span className="mono" title={`Canvas id · generated ${fmtDate(b.generatedAt)}${t.lastActivity ? ` · last activity ${timeAgo(t.lastActivity)}` : ''}`}>
            {b.id}
          </span>
        </div>
      </div>
    </article>
  );
}

/** / — every canvas, newest first. */
export function Dashboard() {
  const { boards, error, update } = useBoards();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>(() => prefs.get('dash.sort', 'newest'));
  const [showArchived, setShowArchived] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    document.title = `Canvases · ${APP_NAME}`;
  }, []);

  const list = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = (boards ?? []).filter((b) => {
      if (b.archived && !showArchived) return false;
      const hay = [b.title, b.id, b.notes, b.source.release, b.source.commit, deviceLine(b.device)].join(' ').toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    return rows.sort((a, b) =>
      sort === 'issues' ? b.threads.openIssues - a.threads.openIssues || b.generatedAt.localeCompare(a.generatedAt) : sort === 'name' ? a.title.localeCompare(b.title) : b.generatedAt.localeCompare(a.generatedAt),
    );
  }, [boards, q, sort, showArchived]);

  const active = (boards ?? []).filter((b) => !b.archived);
  const archivedCount = (boards ?? []).length - active.length;
  const totals = active.reduce(
    (a, b) => {
      a.issues += b.threads.openIssues;
      a.comments += b.threads.openComments;
      a.screens += b.stats.screens ?? 0;
      a.captured += b.stats.captured ?? 0;
      for (const [s, n] of Object.entries(b.threads.bySeverity)) a.sev[s] = (a.sev[s] ?? 0) + n;
      return a;
    },
    { issues: 0, comments: 0, screens: 0, captured: 0, sev: {} as Record<string, number> },
  );
  const pct = totals.screens ? Math.round((totals.captured / totals.screens) * 100) : 0;

  return (
    <div className="page">
      <AppHeader openIssues={totals.issues} />
      <main className="page-main">
        <div className="page-inner">
          <div className="page-head">
            <div className="grow">
              <h1>Canvases</h1>
              <p>Each canvas is one release of the app, captured on one device.</p>
            </div>
            <button className={`btn${help ? ' on' : ''}`} aria-expanded={help} onClick={() => setHelp((h) => !h)}>
              <Icon name="plus" />
              New canvas
            </button>
          </div>

          {help && (
            <section className="callout">
              <h2>Adding a canvas</h2>
              <p>
                A canvas combines the routes and links of one release of the app's source with the screenshots and clips captured from one device. In the project folder:
              </p>
              <pre>{`git -C <app source> checkout <release tag>
cd app
npm run board -- --board <id> --device "<model>" --os "<OS version>" --resolution <w>x<h>
# put captures in boards/<id>/screens/<screen slug>/, then run the same command again`}</pre>
              <p className="muted">Without --board the id is the release tag. The new canvas shows up here straight away; title and notes can be changed with Edit.</p>
            </section>
          )}

          <dl className="stats">
            <div className="stat">
              <dt>Active canvases</dt>
              <dd>{boards ? active.length : '–'}</dd>
              <div className="stat-foot muted small">{archivedCount ? `${archivedCount} archived` : ''}</div>
            </div>
            <div className={`stat${totals.issues ? ' hot' : ''}`}>
              <dt>Open issues</dt>
              <dd>{boards ? totals.issues : '–'}</dd>
              <div className="stat-foot">
                <SeverityBadges counts={totals.sev} />
              </div>
            </div>
            <div className="stat">
              <dt>Open comments</dt>
              <dd>{boards ? totals.comments : '–'}</dd>
              <div className="stat-foot">
                <Link className="small" to="/issues?kind=all">
                  See all feedback →
                </Link>
              </div>
            </div>
            <div className="stat">
              <dt>Screens captured</dt>
              <dd>
                {pct}%<small>{`${totals.captured} of ${totals.screens}`}</small>
              </dd>
              <div className="stat-foot meter">
                <span className="meter-bar">
                  <i style={{ width: `${pct}%` }} />
                </span>
              </div>
            </div>
          </dl>

          <div className="toolbar">
            <div className="search-input">
              <Icon name="search" size={15} />
              <input className="input" type="search" placeholder="Search by name, release, device" aria-label="Search canvases" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <label className="filter">
              <span>Sort</span>
              <select
                className="select"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as Sort);
                  prefs.set('dash.sort', e.target.value);
                }}
              >
                <option value="newest">Newest first</option>
                <option value="issues">Most open issues</option>
                <option value="name">Name</option>
              </select>
            </label>
            {archivedCount > 0 && (
              <label className="check">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived ({archivedCount})
              </label>
            )}
          </div>

          {error && <div className="banner-error">Couldn't load canvases: {error}</div>}
          {!boards && !error && <div className="empty">Loading…</div>}
          {boards && !list.length && (
            <div className="empty">
              <b>{boards.length ? 'No canvases match' : 'No canvases yet'}</b>
              {boards.length ? 'Try another search.' : 'Use “New canvas” to see how to add one.'}
            </div>
          )}
          <div className="canvas-grid">
            {list.map((b) => (
              <CanvasCard key={b.id} b={b} onUpdate={update} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
