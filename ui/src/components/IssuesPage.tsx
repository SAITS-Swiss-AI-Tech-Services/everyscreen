import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { isOpen, SEVERITY_LABEL, STATUS_LABEL, timeAgo, type Severity, type Thread } from '../comments';
import { downloadCsv, fileSlug, toCsv } from '../csv';
import type { BoardSummary } from '../types';
import { Icon } from './icons';
import { deviceLine } from './TopBar';
import { AppHeader, SeverityBadge, StatusBadge } from './ui';
import { APP_NAME } from '../appConfig';

const API = `${import.meta.env.BASE_URL}api`;
const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export const threadLink = (t: Pick<Thread, 'boardId' | 'id'>) => `/b/${encodeURIComponent(t.boardId)}?thread=${t.id}`;

// filter values allowed in the URL; anything else falls back to the default
const KINDS = ['issue', 'comment', 'all'] as const;
const STATUSES = ['open', 'done', 'all'] as const;
const SEVERITY_FILTER = ['any', 'critical', 'high', 'medium', 'low', 'none'] as const;
const SORTS = ['updated', 'severity', 'newest', 'id'] as const;
const pick = <T extends readonly string[]>(v: string | null, allowed: T, def: T[number]): T[number] => (v && (allowed as readonly string[]).includes(v) ? v : def);

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `${r.status} ${r.statusText}`);
  return data as T;
}

function Filter({ label, value, def, onChange, children }: { label: string; value: string; def: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className={`filter${value !== def ? ' set' : ''}`}>
      <span>{label}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

/** /issues — every issue (and optionally comment) across all canvases. */
export function IssuesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  // filters live in the URL so a filtered list can be shared
  const kind = pick(params.get('kind'), KINDS, 'issue');
  const status = pick(params.get('status'), STATUSES, 'open');
  const severity = pick(params.get('severity'), SEVERITY_FILTER, 'any');
  const sort = pick(params.get('sort'), SORTS, 'updated');
  const assignee = params.get('assignee') ?? 'any';
  const board = params.get('board') ?? 'active';
  const q = params.get('q') ?? '';
  const setParam = (key: string, value: string, def: string) => {
    const next = new URLSearchParams(params);
    if (value === def) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    document.title = `Issues · ${APP_NAME}`;
    let live = true;
    const load = () =>
      Promise.all([getJson<{ threads: Thread[] }>(`${API}/threads`), getJson<{ boards: BoardSummary[] }>(`${API}/boards`)])
        .then(([t, b]) => {
          if (!live) return;
          setThreads(t.threads);
          setBoards(b.boards);
          setError(null);
        })
        .catch((e: Error) => live && setError(e.message));
    load();
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 20000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const boardMap = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);
  const missing = useMemo(() => [...new Set((threads ?? []).filter((t) => !boardMap.has(t.boardId)).map((t) => t.boardId))], [threads, boardMap]);
  const assignees = useMemo(() => [...new Set((threads ?? []).map((t) => t.assignee).filter((a): a is string => !!a))].sort(), [threads]);
  // a canvas id in the URL that no longer exists still filters (its threads remain)
  const boardKnown = board === 'active' || board === 'all' || boardMap.has(board) || missing.includes(board);
  const boardFilter = boards.length && !boardKnown ? 'active' : board;

  const rows = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = (threads ?? []).filter((t) => {
      const b = boardMap.get(t.boardId);
      // active: canvases that exist and aren't archived (as on the dashboard)
      if (boardFilter === 'active' && (!b || b.archived)) return false;
      if (boardFilter !== 'active' && boardFilter !== 'all' && t.boardId !== boardFilter) return false;
      if (kind !== 'all' && t.kind !== kind) return false;
      if (status === 'open' && !isOpen(t)) return false;
      if (status === 'done' && isOpen(t)) return false;
      if (severity !== 'any' && (t.severity ?? 'none') !== severity) return false;
      if (assignee === 'none' ? !!t.assignee : assignee !== 'any' && t.assignee !== assignee) return false;
      if (terms.length) {
        const hay = [t.title, t.excerpt, t.screenTitle, t.assignee, t.author, '#' + t.id, t.boardId, b?.title, b?.source.release].join(' ').toLowerCase();
        if (!terms.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    return list.sort((a, b) =>
      sort === 'severity'
        ? (SEV_RANK[a.severity ?? ''] ?? 9) - (SEV_RANK[b.severity ?? ''] ?? 9) || b.updatedAt.localeCompare(a.updatedAt)
        : sort === 'newest'
          ? b.createdAt.localeCompare(a.createdAt)
          : sort === 'id'
            ? a.id - b.id
            : b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [threads, boardMap, boardFilter, kind, status, severity, assignee, sort, q]);

  const openIssues = (threads ?? []).filter((t) => t.kind === 'issue' && isOpen(t) && boardMap.get(t.boardId) && !boardMap.get(t.boardId)!.archived).length;
  const download = () => {
    const head = ['id', 'kind', 'status', 'severity', 'title', 'first message', 'screen', 'canvas id', 'canvas', 'app release', 'device', 'assignee', 'author', 'replies', 'created', 'updated', 'link'];
    const body = rows.map((t) => {
      const b = boardMap.get(t.boardId);
      return [t.id, t.kind, t.status, t.severity, t.title, t.excerpt, t.screenTitle, t.boardId, b?.title, b?.source.release ?? t.release, deviceLine(b?.device ?? null), t.assignee, t.author, Math.max(0, t.messageCount - 1), t.createdAt, t.updatedAt, location.origin + threadLink(t)];
    });
    downloadCsv(toCsv(head, body), `${fileSlug(APP_NAME)}-issues-${new Date().toISOString().slice(0, 10)}.csv`);
  };
  const noun = kind === 'comment' ? 'comments' : kind === 'all' ? 'issues and comments' : 'issues';
  const filtered = boardFilter !== 'active' || kind !== 'issue' || status !== 'open' || severity !== 'any' || assignee !== 'any' || !!q;

  return (
    <div className="page">
      <AppHeader openIssues={openIssues} />
      <main className="page-main">
        <div className="page-inner">
          <div className="page-head">
            <div className="grow">
              <h1>Issues</h1>
              <p>Everything reviewers have flagged, across every canvas. Filters are kept in the link, so a filtered list can be shared.</p>
            </div>
            <button className="btn" onClick={download} disabled={!rows.length}>
              <Icon name="download" />
              Export CSV
            </button>
          </div>

          <div className="toolbar">
            <div className="search-input">
              <Icon name="search" size={15} />
              <input className="input" type="search" placeholder="Text, #id, screen, person, release" aria-label="Search issues" value={q} onChange={(e) => setParam('q', e.target.value, '')} />
            </div>
            <Filter label="Canvas" value={boardFilter} def="active" onChange={(v) => setParam('board', v, 'active')}>
              <option value="active">Active canvases</option>
              <option value="all">All, incl. archived</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                  {b.archived ? ' (archived)' : ''}
                </option>
              ))}
              {missing.map((id) => (
                <option key={id} value={id}>
                  {id} (canvas deleted)
                </option>
              ))}
            </Filter>
            <Filter label="Type" value={kind} def="issue" onChange={(v) => setParam('kind', v, 'issue')}>
              <option value="issue">Issues</option>
              <option value="comment">Comments</option>
              <option value="all">Both</option>
            </Filter>
            <Filter label="Status" value={status} def="open" onChange={(v) => setParam('status', v, 'open')}>
              <option value="open">Open / in progress</option>
              <option value="done">Resolved / won't fix</option>
              <option value="all">Any</option>
            </Filter>
            <Filter label="Severity" value={severity} def="any" onChange={(v) => setParam('severity', v, 'any')}>
              <option value="any">Any</option>
              {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABEL[s]}
                </option>
              ))}
              <option value="none">None</option>
            </Filter>
            <Filter label="Assignee" value={assignee} def="any" onChange={(v) => setParam('assignee', v, 'any')}>
              <option value="any">Anyone</option>
              <option value="none">Unassigned</option>
              {assignees.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
              {assignee !== 'any' && assignee !== 'none' && !assignees.includes(assignee) && <option value={assignee}>{assignee}</option>}
            </Filter>
            <Filter label="Sort" value={sort} def="updated" onChange={(v) => setParam('sort', v, 'updated')}>
              <option value="updated">Recently active</option>
              <option value="severity">Severity</option>
              <option value="newest">Newest</option>
              <option value="id">Number</option>
            </Filter>
            {filtered && (
              <button className="btn ghost sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                <Icon name="x" size={14} />
                Reset
              </button>
            )}
            <span className="result-count">
              {rows.length} of {threads?.length ?? 0}
            </span>
          </div>

          {error && <div className="banner-error">Couldn't load issues: {error}</div>}
          {!threads && !error && <div className="empty">Loading…</div>}
          {threads && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="num-col">#</th>
                    <th>Title</th>
                    <th>Status</th>
                    <th className="hide-col">Severity</th>
                    <th className="hide-col">Screen</th>
                    <th className="hide-col">Canvas</th>
                    <th className="hide-col">Assignee</th>
                    <th className="hide-col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const b = boardMap.get(t.boardId);
                    const link = threadLink(t);
                    return (
                      <tr key={t.id} className={isOpen(t) ? '' : 'done'} onClick={(e) => !(e.target as HTMLElement).closest('a') && navigate(link)}>
                        <td className="num-col">{t.id}</td>
                        <td>
                          <div className="t-title">
                            <span className={`kind-dot ${t.kind} sev-${t.severity ?? 'none'}${isOpen(t) ? '' : ' done'}`} title={t.kind === 'issue' ? 'Issue' : 'Comment'}>
                              <Icon name={t.kind === 'issue' ? 'flag' : 'message'} size={12} />
                            </span>
                            <div style={{ minWidth: 0 }}>
                              <Link to={link}>{t.title ?? t.excerpt}</Link>
                              <div className="t-sub">
                                {t.title && t.excerpt ? `${t.excerpt} · ` : ''}
                                {t.author}, {timeAgo(t.createdAt)}
                                {t.messageCount > 1 ? ` · ${t.messageCount - 1} repl${t.messageCount === 2 ? 'y' : 'ies'}` : ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={t.status} label={STATUS_LABEL[t.status]} />
                        </td>
                        <td className="hide-col">{t.severity ? <SeverityBadge severity={t.severity} label={SEVERITY_LABEL[t.severity]} /> : <span className="muted">—</span>}</td>
                        <td className="hide-col">{t.screenTitle}</td>
                        <td className="hide-col t-canvas">
                          <div title={[b?.title ?? t.boardId, b?.source.release ?? t.release, deviceLine(b?.device ?? null)].filter(Boolean).join(' · ')}>{b?.title ?? t.boardId}</div>
                          {!b ? <span className="badge warn">canvas deleted</span> : b.archived ? <span className="badge">archived</span> : null}
                        </td>
                        <td className="hide-col">{t.assignee ?? <span className="muted">—</span>}</td>
                        <td className="hide-col nowrap" title={new Date(t.updatedAt).toLocaleString()}>
                          {timeAgo(t.updatedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!rows.length && (
                <div className="empty">
                  <b>{threads.length ? `No ${noun} match these filters` : 'No issues yet'}</b>
                  {threads.length ? (
                    <button className="link-btn" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                      Reset filters
                    </button>
                  ) : (
                    'Open a canvas and press C to pin one.'
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
