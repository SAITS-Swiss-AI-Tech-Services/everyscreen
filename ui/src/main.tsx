import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { loadMe } from './comments';
import { Dashboard } from './components/Dashboard';
import { Icon } from './components/icons';
import { IssuesPage } from './components/IssuesPage';
import { AppHeader, Toasts } from './components/ui';
// Bundled fonts (no requests to font CDNs). DM Sans's optical-size axis keeps
// small labels open and legible.
import '@fontsource-variable/dm-sans/opsz.css';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import './theme';

// The canvas (React Flow) is most of the bundle; the dashboard doesn't need it.
const BoardPage = lazy(() => import('./App').then((m) => ({ default: m.BoardPage })));

// who is posting: the Cloudflare Access login when the server verifies one
loadMe();

function NotFound() {
  return (
    <div className="page">
      <AppHeader />
      <main className="page-main">
        <div className="empty" style={{ paddingTop: 96 }}>
          <b>Page not found</b>
          <p>
            <Link className="btn" to="/">
              <Icon name="grid" /> All canvases
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/issues" element={<IssuesPage />} />
        <Route
          path="/b/:boardId"
          element={
            <Suspense fallback={<div className="loading">Loading canvas…</div>}>
              <BoardPage />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toasts />
    </BrowserRouter>
  </StrictMode>,
);
