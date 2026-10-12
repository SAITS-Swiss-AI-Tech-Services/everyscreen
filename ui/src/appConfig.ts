// Settings the server puts into index.html (see src/server/http.ts).
declare global {
  interface Window {
    __EVERYSCREEN__?: { name?: string };
  }
}

/** The app's name from .everyscreen/config.json. */
export const APP_NAME = window.__EVERYSCREEN__?.name || 'Everyscreen';
