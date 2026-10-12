// Shape of boards/<id>/board.json, written by tools/build.mjs.

export type MediaType = 'image' | 'video' | 'html';

export interface Media {
  type: MediaType;
  label: string;
  /** Path of the source file, relative to the project root. */
  file: string;
  /** URL relative to the media root (see mediaUrl). */
  src: string;
  thumb?: string;
  poster?: string;
  posterThumb?: string;
}

export type NodeKind = 'screen' | 'redirect' | 'helper' | 'system' | 'dev' | 'drawer' | 'sheet' | 'layout' | 'flow';

export interface ScreenData {
  id: string;
  slug: string;
  route: string | null;
  url: string | null;
  deepLink: string | null;
  file: string | null;
  group: string;
  section: string | null;
  title: string;
  component: string | null;
  kind: NodeKind;
  dynamic?: boolean;
  params: string[];
  flags: string[];
  media: Media[];
  /** Flow recordings only: the screens the clip walks through. */
  screens?: string[];
}

export type Certainty = 'certain' | 'guessed' | 'inferred';

export interface EdgeData {
  from: string;
  to: string;
  kind: string;
  certainty: Certainty;
  via?: string[];
  sites: string[];
  note?: string;
}

export interface Group {
  id: string;
  title: string;
  navigator: string;
  layoutFile?: string | null;
  parent?: string | null;
}

export interface Flow {
  id: string;
  title: string;
  group: string | null;
  screens: string[];
  media: Media[];
}

export interface Device {
  model: string | null;
  os: string | null;
  resolution: string | null;
}

export interface BoardStats {
  screens: number;
  captured: number;
  withClips: number;
  mockupOnly: number;
  flows: number;
  edges: number;
}

/** boards/<id>/board.json: one snapshot of the app. */
export interface BoardFile {
  id: string;
  title: string;
  demo: boolean;
  createdAt: string;
  generatedAt: string;
  capturedAt: string | null;
  device: Device | null;
  stats: BoardStats;
  /** dirty: built from a working tree with uncommitted changes (a custom build). */
  source: { repo?: string; commit?: string | null; release?: string | null; branch?: string | null; dirty?: boolean; scheme?: string };
  groups: Group[];
  screens: ScreenData[];
  edges: EdgeData[];
  flows: Flow[];
}

/** A board as listed by GET /api/boards (board.json summary + dashboard edits + thread counts). */
export interface BoardSummary {
  id: string;
  title: string;
  notes: string | null;
  archived: boolean;
  demo: boolean;
  createdAt: string;
  generatedAt: string;
  capturedAt: string | null;
  device: Device | null;
  stats: Partial<BoardStats>;
  source: { repo?: string; commit?: string | null; release?: string | null; branch?: string | null; dirty?: boolean };
  preview: string[];
  threads: {
    total: number;
    openIssues: number;
    openComments: number;
    resolved: number;
    bySeverity: Record<string, number>;
    lastActivity: string | null;
  };
}
