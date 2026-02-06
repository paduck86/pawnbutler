// PawnButler Browser Automation Types

export interface BrowserConfig {
  headless: boolean;
  maxPages: number;
  defaultTimeout: number;
  screenshotOnNavigate: boolean;
  blockDownloads: boolean;
  blockPopups: boolean;
}

export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  headless: true,
  maxPages: 3,
  defaultTimeout: 30_000,
  screenshotOnNavigate: true,
  blockDownloads: true,
  blockPopups: true,
};

export interface PageInfo {
  id: string;
  url: string;
  title: string;
  createdAt: number;
}

export interface NavigateResult {
  url: string;
  title: string;
  status: number | null;
}

export interface ClickResult {
  selector: string;
  clicked: boolean;
}

export interface TypeResult {
  selector: string;
  typed: boolean;
}

export interface ScrollResult {
  direction: 'up' | 'down';
  scrolled: boolean;
}

export interface ScreenshotResult {
  base64: string;
  width: number;
  height: number;
}

export interface ExtractResult {
  title: string;
  url: string;
  text: string;
  links: { text: string; href: string }[];
}

export interface SnapshotResult {
  title: string;
  url: string;
  summary: string;
  headings: string[];
  links: { text: string; href: string }[];
  forms: { action: string; fields: string[] }[];
}

export interface EvaluateResult {
  script: string;
  result: unknown;
}

export interface WaitForResult {
  selector: string;
  found: boolean;
  elapsed: number;
}

export type BrowserActionLog = {
  timestamp: number;
  action: string;
  url?: string;
  selector?: string;
  details?: string;
};
