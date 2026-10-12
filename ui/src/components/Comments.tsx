import { useEffect, useState } from 'react';
import type { Board } from '../board';
import {
  authorName,
  closeThread,
  comments,
  createThread,
  deleteMessage,
  deleteThread,
  discardDraft,
  editMessage,
  fetchThread,
  isOpen,
  openThread,
  reply,
  setCompose,
  SEVERITY_LABEL,
  startDraft,
  STATUS_LABEL,
  timeAgo,
  updateThread,
  useComments,
  type Draft,
  type Kind,
  type Message,
  type Severity,
  type Status,
  type Thread,
  type ThreadDetail,
} from '../comments';
import type { ScreenData } from '../types';
import { Icon } from './icons';
import { threadLink } from './IssuesPage';
import { NameForm } from './ui';

const EMPTY: Thread[] = [];
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const useAuthor = () => useComments((s) => authorName(s));

/** Where a pin sits, in words. */
function pinWhere(p: Pick<Draft, 'x' | 'y' | 'mediaFile' | 'mediaTime'>) {
  const parts = [p.x != null ? 'Pinned on the screen' : 'About the whole screen'];
  if (p.mediaFile) parts.push(`on ${p.mediaFile.split('/').pop()}`);
  if (p.mediaTime != null) parts.push(`at ${fmtTime(p.mediaTime)}`);
  return parts.join(' ');
}

function useError() {
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  return { error, run };
}

/** Shown in place of the post buttons until the viewer has a name. */
function NameNeeded() {
  return (
    <div className="name-needed">
      <NameForm />
    </div>
  );
}

function KindSwitch({ value, onChange, disabled }: { value: Kind; onChange: (k: Kind) => void; disabled?: boolean }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Kind">
      {(['comment', 'issue'] as const).map((k) => (
        <button key={k} role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} disabled={disabled} onClick={() => onChange(k)}>
          {k === 'comment' ? 'Comment' : 'Issue'}
        </button>
      ))}
    </div>
  );
}

function Composer({ board, n, draft }: { board: Board; n: ScreenData; draft: Draft }) {
  const c = useComments((s) => s.compose);
  const [busy, setBusy] = useState(false);
  const author = useAuthor();
  const { error, run } = useError();
  const canPost = !!c.body.trim() && !!author && !busy && (c.kind === 'comment' || !!c.title.trim());
  const post = async () => {
    if (!canPost) return;
    setBusy(true);
    await run(() => createThread(n, draft, { kind: c.kind, title: c.title.trim(), severity: c.kind === 'issue' ? c.severity : null, assignee: c.assignee.trim(), body: c.body }, board.file.source));
    setBusy(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post();
    if (e.key === 'Escape') {
      e.stopPropagation();
      discardDraft();
    }
  };
  return (
    <div className="composer" onKeyDown={onKey}>
      <div className="composer-head">
        <b>New {c.kind}</b>
        <KindSwitch value={c.kind} onChange={(kind) => setCompose({ kind })} />
      </div>
      <div className="pin-where">
        <Icon name="pin" size={13} />
        {pinWhere(draft)}
        {draft.x != null && <span className="muted">· click the screen again to move it</span>}
      </div>
      {c.kind === 'issue' && (
        <>
          <label className="field">
            <span>Title</span>
            <input value={c.title} maxLength={200} onChange={(e) => setCompose({ title: e.target.value })} placeholder="Short summary of the problem" autoFocus />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Severity</span>
              <select value={c.severity} onChange={(e) => setCompose({ severity: e.target.value as Severity })}>
                {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Assignee</span>
              <input value={c.assignee} maxLength={60} onChange={(e) => setCompose({ assignee: e.target.value })} placeholder="Optional" />
            </label>
          </div>
        </>
      )}
      <textarea
        className="input"
        value={c.body}
        maxLength={5000}
        rows={4}
        aria-label={c.kind === 'issue' ? 'Description' : 'Comment'}
        placeholder={c.kind === 'issue' ? 'What is wrong, and what should happen instead?' : 'Write a comment…'}
        autoFocus={c.kind === 'comment'}
        onChange={(e) => setCompose({ body: e.target.value })}
      />
      {!author && <NameNeeded />}
      {error && <div className="error-text">{error}</div>}
      <div className="actions">
        <button className="btn primary" disabled={!canPost} onClick={post}>
          Post {c.kind}
        </button>
        <button className="btn" onClick={() => discardDraft()}>
          Cancel
        </button>
        <span className="grow" />
        <span className="muted small">
          <span className="kbd">Ctrl</span> + <span className="kbd">Enter</span>
        </span>
      </div>
    </div>
  );
}

function MessageItem({ m, first, onChange }: { m: Message; first: boolean; onChange: (d: ThreadDetail) => void }) {
  const author = useAuthor();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(m.body);
  const { error, run } = useError();
  if (m.type === 'event')
    return (
      <li className="event">
        <b>{m.author}</b> {m.body} · {timeAgo(m.createdAt)}
      </li>
    );
  const mine = !!author && m.author === author;
  return (
    <li className="msg">
      <div className="msg-head">
        <span className="avatar" aria-hidden="true">
          {m.author[0]?.toUpperCase()}
        </span>
        <b>{m.author}</b>
        <span className="muted" title={new Date(m.createdAt).toLocaleString()}>
          {timeAgo(m.createdAt)}
          {m.editedAt ? ' · edited' : ''}
        </span>
        {mine && !editing && (
          <span className="msg-actions">
            <button
              className="link-btn"
              onClick={() => {
                setV(m.body);
                setEditing(true);
              }}
            >
              Edit
            </button>
            {!first && (
              <button className="link-btn danger" onClick={() => confirm('Delete this message?') && run(async () => onChange(await deleteMessage(m.id)))}>
                Delete
              </button>
            )}
          </span>
        )}
      </div>
      {editing ? (
        <>
          <textarea className="input" value={v} rows={3} maxLength={5000} aria-label="Edit message" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEditing(false))} />
          <div className="actions">
            <button
              className="btn primary sm"
              disabled={!v.trim()}
              onClick={async () => {
                if (await run(async () => onChange(await editMessage(m.id, v)))) setEditing(false);
              }}
            >
              Save
            </button>
            <button className="btn sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="msg-body">{m.body}</div>
      )}
      {error && <div className="error-text">{error}</div>}
    </li>
  );
}

function CopyLink({ t }: { t: Thread }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn ghost sm"
      title="Link that opens this canvas with this thread"
      onClick={() =>
        navigator.clipboard
          ?.writeText(location.origin + threadLink(t))
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          })
          .catch(() => {})
      }
    >
      <Icon name={done ? 'check' : 'link'} size={14} />
      {done ? 'Copied' : 'Copy link'}
    </button>
  );
}

function ThreadView({ board, t }: { board: Board; t: Thread }) {
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [replyText, setReplyText] = useState('');
  const [title, setTitle] = useState(t.title ?? '');
  const [assignee, setAssignee] = useState(t.assignee ?? '');
  const author = useAuthor();
  const { error, run } = useError();
  useEffect(() => {
    let live = true;
    fetchThread(t.id)
      .then((d) => live && setDetail(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [t.id, t.updatedAt]);
  useEffect(() => {
    setTitle(t.title ?? '');
    setAssignee(t.assignee ?? '');
  }, [t.title, t.assignee]);

  const patch = (p: Parameters<typeof updateThread>[1]) => run(async () => setDetail(await updateThread(t.id, p)));
  const send = async (resolve = false) => {
    if (!replyText.trim() && !resolve) return;
    // post the reply first; if resolving then fails, the reply is kept and the
    // text cleared, so a retry doesn't post it twice
    const text = replyText;
    const ok = await run(async () => {
      if (text.trim()) {
        setDetail(await reply(t.id, text));
        setReplyText('');
      }
      if (resolve) setDetail(await updateThread(t.id, { status: 'resolved' }));
    });
    if (ok) setReplyText('');
  };
  const release = board.file.source.release;
  const firstComment = detail?.messages.find((m) => m.type === 'comment');
  const screen = board.byId.get(t.screenId);
  const canEdit = !!author;
  const isAuthor = !!author && author === t.author;

  return (
    <div className="thread">
      <button className="link-btn back" onClick={closeThread}>
        <Icon name="arrowLeft" size={13} /> All comments on this screen
      </button>
      <div className="thread-head">
        <span className="trow-id">#{t.id}</span>
        <KindSwitch value={t.kind} disabled={!canEdit} onChange={(k) => patch(k === 'issue' ? { kind: k, severity: t.severity ?? 'medium' } : { kind: k })} />
        <span className="grow" />
        <select
          className={`select status-select st-${t.status}`}
          aria-label="Status"
          value={t.status}
          onChange={(e) => patch({ status: e.target.value as Status })}
          disabled={!canEdit}
          title={canEdit ? 'Status' : 'Set your name to change the status'}
        >
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      {t.kind === 'issue' ? (
        <>
          <label className="field">
            <span>Title</span>
            <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== (t.title ?? '') && patch({ title })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} disabled={!canEdit} />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Severity</span>
              <select value={t.severity ?? ''} onChange={(e) => patch({ severity: (e.target.value || null) as Severity | null })} disabled={!canEdit}>
                <option value="">None</option>
                {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Assignee</span>
              <input value={assignee} maxLength={60} placeholder="Nobody" onChange={(e) => setAssignee(e.target.value)} onBlur={() => assignee !== (t.assignee ?? '') && patch({ assignee })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} disabled={!canEdit} />
            </label>
          </div>
        </>
      ) : (
        t.title && <div className="thread-title">{t.title}</div>
      )}
      <div className="thread-meta">
        Opened by {t.author} · {timeAgo(t.createdAt)}
        {t.release && t.release !== release ? <span className="warn"> · on {t.release} (canvas shows {release})</span> : null}
      </div>
      <div className="pin-where">
        <Icon name="pin" size={13} />
        {pinWhere(t)}
        {t.mediaTime != null && (
          <button className="link-btn" onClick={() => openThread(t, screen)}>
            jump there
          </button>
        )}
      </div>

      <ul className="messages">
        {detail ? detail.messages.map((m) => <MessageItem key={m.id} m={m} first={m.id === firstComment?.id} onChange={setDetail} />) : <li className="muted" style={{ padding: '10px 0' }}>Loading…</li>}
      </ul>

      <textarea
        className="input"
        value={replyText}
        rows={3}
        maxLength={5000}
        aria-label="Reply"
        placeholder="Reply…"
        onChange={(e) => setReplyText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
          if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
        }}
      />
      {!author && <NameNeeded />}
      {error && <div className="error-text">{error}</div>}
      <div className="actions">
        <button className="btn primary" disabled={!replyText.trim() || !author} onClick={() => send()}>
          Reply
        </button>
        {isOpen(t) ? (
          <button className="btn" disabled={!author} onClick={() => send(true)}>
            <Icon name="check" size={14} />
            {replyText.trim() ? 'Reply & resolve' : 'Resolve'}
          </button>
        ) : (
          <button className="btn" disabled={!author} onClick={() => patch({ status: 'open' })}>
            Reopen
          </button>
        )}
        <span className="grow" />
        <CopyLink t={t} />
        {isAuthor && (
          <button className="btn ghost sm icon-only danger" title={`Delete ${t.kind} #${t.id}`} aria-label={`Delete ${t.kind} #${t.id}`} onClick={() => confirm(`Delete ${t.kind} #${t.id} and all its replies?`) && run(() => deleteThread(t.id))}>
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function ThreadRow({ t, n }: { t: Thread; n: ScreenData }) {
  return (
    <li>
      <button className={`trow${isOpen(t) ? '' : ' done'}`} onClick={() => openThread(t, n)}>
        <span className={`kind-dot ${t.kind} sev-${t.severity ?? 'none'}${isOpen(t) ? '' : ' done'}`} aria-label={t.kind}>
          <Icon name={t.kind === 'issue' ? 'flag' : 'message'} size={12} />
        </span>
        <span className="trow-main">
          <span className="trow-title">{t.title ?? t.excerpt}</span>
          <span className="trow-meta">
            <span className="trow-id">#{t.id}</span>
            <span>{t.kind === 'issue' ? `Issue${t.severity ? ' · ' + SEVERITY_LABEL[t.severity] : ''}` : 'Comment'}</span>
            <span>{STATUS_LABEL[t.status]}</span>
            <span>{t.author}</span>
            <span>{timeAgo(t.updatedAt)}</span>
            {t.messageCount > 1 && <span>{`${t.messageCount - 1} repl${t.messageCount === 2 ? 'y' : 'ies'}`}</span>}
            {t.x == null && <span>not pinned</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

/** Comments tab of the side panel for one screen. */
export function ScreenComments({ board, n }: { board: Board; n: ScreenData }) {
  const threads = useComments((s) => s.byScreen.get(n.id) ?? EMPTY);
  const draft = useComments((s) => (s.draft?.screenId === n.id ? s.draft : null));
  const openId = useComments((s) => s.openId);
  const placing = useComments((s) => s.placing);
  const error = useComments((s) => s.error);
  const [showDone, setShowDone] = useState(false);
  if (draft) return <Composer key={n.id} board={board} n={n} draft={draft} />;
  const open = threads.find((t) => t.id === openId);
  if (open) return <ThreadView key={open.id} board={board} t={open} />;
  const active = threads.filter(isOpen);
  const done = threads.filter((t) => !isOpen(t));
  return (
    <div className="screen-comments">
      {error && <div className="error-text">Comments unavailable: {error}</div>}
      <div className="actions">
        <button className={`btn${placing ? ' on' : ''}`} aria-pressed={placing} onClick={() => comments.set({ placing: !placing })}>
          <Icon name="pin" size={14} />
          {placing ? 'Click the screen to pin…' : 'Pin a comment'}
        </button>
        <button className="btn" onClick={() => startDraft(n, null, null)}>
          Comment on whole screen
        </button>
      </div>
      {!threads.length && (
        <div className="empty">
          <b>No comments yet</b>
          Pin one on the screen (<span className="kbd">C</span>) or comment on the screen as a whole.
        </div>
      )}
      {active.length > 0 && (
        <ul className="tlist">
          {active.map((t) => (
            <ThreadRow key={t.id} t={t} n={n} />
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <>
          <button className="link-btn small" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
            {showDone ? 'Hide' : 'Show'} {done.length} resolved
          </button>
          {showDone && (
            <ul className="tlist">
              {done.map((t) => (
                <ThreadRow key={t.id} t={t} n={n} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
