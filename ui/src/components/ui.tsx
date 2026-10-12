import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { authorName, comments, setAuthor, useComments } from '../comments';
import { setTheme, useTheme, type Theme } from '../theme';
import { dismissToast, useToasts } from '../toast';
import { Icon, type IconName } from './icons';
import { APP_NAME } from '../appConfig';

// Building blocks shared by every page: menus, the app header, the name chip,
// the theme switch and toasts.

/** Button that opens a popover; closes on outside click, Esc, or a pick. */
export function Menu({
  label,
  icon,
  title,
  align = 'right',
  className = '',
  children,
}: {
  label?: ReactNode;
  icon?: IconName;
  title: string;
  align?: 'left' | 'right';
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      ref.current?.querySelector<HTMLButtonElement>('.menu-trigger')?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div className={`menu ${className}`} ref={ref}>
      <button className={`btn menu-trigger${open ? ' on' : ''}${label ? '' : ' icon-only'}`} aria-haspopup="true" aria-expanded={open} aria-controls={id} title={title} aria-label={label ? undefined : title} onClick={() => setOpen((o) => !o)}>
        {icon && <Icon name={icon} />}
        {label}
        {label && <Icon name="chevronDown" size={14} className="caret" />}
      </button>
      {open && (
        <div className={`popover ${align}`} id={id} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function ThemeMenu() {
  const theme = useTheme();
  const opts: [Theme, string, IconName][] = [
    ['auto', 'System', 'monitor'],
    ['light', 'Light', 'sun'],
    ['dark', 'Dark', 'moon'],
  ];
  const cur = opts.find((o) => o[0] === theme)!;
  return (
    <Menu icon={cur[2]} title={`Theme: ${cur[1]}`}>
      {(close) => (
        <>
          <div className="popover-label">Theme</div>
          {opts.map(([t, label, icon]) => (
            <button
              key={t}
              role="menuitemradio"
              aria-checked={theme === t}
              className="item"
              onClick={() => {
                setTheme(t);
                close();
              }}
            >
              <Icon name={icon} />
              {label}
              {theme === t && <Icon name="check" className="item-end" />}
            </button>
          ))}
        </>
      )}
    </Menu>
  );
}

/** Who you are posting as. With Cloudflare Access it's your login and fixed. */
export function IdentityChip() {
  const me = useComments((s) => s.me);
  const name = useComments((s) => authorName(s));
  if (me.verified && me.email)
    return (
      <span className="identity" title="Signed in through Cloudflare Access">
        <span className="avatar">{me.email[0].toUpperCase()}</span>
        <span className="identity-name">{me.email}</span>
      </span>
    );
  return (
    <Menu
      className="identity-menu"
      title={name ? `Posting as ${name}` : 'Set your name'}
      label={
        <>
          <span className={`avatar${name ? '' : ' none'}`}>{name ? name[0].toUpperCase() : <Icon name="user" size={13} />}</span>
          <span className="identity-name">{name || 'Set your name'}</span>
        </>
      }
    >
      {(close) => <NameForm onDone={close} />}
    </Menu>
  );
}

/** Name to post under, remembered in this browser. */
export function NameForm({ onDone }: { onDone?: () => void }) {
  const [v, setV] = useState(() => comments.get().author);
  return (
    <form
      className="identity-form"
      onSubmit={(e) => {
        e.preventDefault();
        setAuthor(v.trim());
        onDone?.();
      }}
    >
      <label className="field">
        <span>Your name</span>
        <input autoFocus value={v} maxLength={60} placeholder="Shown on your comments" onChange={(e) => setV(e.target.value)} />
      </label>
      <p className="hint-text">Stored in this browser only. Until the board sits behind a login, names are not checked.</p>
      <div className="row-actions">
        <button className="btn primary" type="submit" disabled={!v.trim()}>
          Save
        </button>
      </div>
    </form>
  );
}

/** 'Trail Mix' -> 'TM', 'acme' -> 'AC' */
export const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
};

/** Header of the dashboard and issues pages. */
export function AppHeader({ openIssues, children }: { openIssues?: number; children?: ReactNode }) {
  return (
    <header className="app-header">
      <Link to="/" className="brand" aria-label={`${APP_NAME} screen review, all canvases`}>
        <span className="brand-mark" aria-hidden="true">
          {initials(APP_NAME)}
        </span>
        <span className="brand-name">
          {APP_NAME} <small>everyscreen</small>
        </span>
      </Link>
      <nav className="app-nav" aria-label="Main">
        <NavLink to="/" end>
          Canvases
        </NavLink>
        <NavLink to="/issues">
          Issues
          {openIssues ? <span className="nav-count">{openIssues}</span> : null}
        </NavLink>
      </nav>
      <div className="grow" />
      {children}
      <IdentityChip />
      <ThemeMenu />
    </header>
  );
}

export function Toasts() {
  const list = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <Icon name={t.tone === 'error' ? 'alert' : 'help'} />
          <span>
            {t.text}
            {t.link && (
              <>
                {' '}
                <Link to={t.link.to} onClick={() => dismissToast(t.id)}>
                  {t.link.label}
                </Link>
              </>
            )}
          </span>
          <button className="btn ghost icon-only" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Badge for a status. */
export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`badge st-${status}`}>{label}</span>;
}
/** Badge for a severity (issues only). */
export function SeverityBadge({ severity, label }: { severity: string; label: string }) {
  return (
    <span className={`badge sev sev-${severity}`}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}
