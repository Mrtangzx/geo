export interface SelectedPage {
  id: string;
  url: string;
  label: string;
}

export interface PageCollection {
  projectId: string;
  workspaceId: string;
  version: number;
  pages: SelectedPage[];
  updatedAt: string;
}

export interface PageCollectionInput {
  expectedVersion: number;
  pages: { id?: string; url: string; label: string }[];
}

export interface PageRedirect {
  url: string;
  status: number;
  location: string;
  resolvedAddresses: string[];
}

export interface RobotsGroup {
  agents: string[];
  rules: { directive: "allow" | "disallow"; path: string }[];
}

export interface RobotsObservation {
  url: string;
  finalUrl: string | null;
  checkedAt: string | null;
  status: "available" | "not_found" | "unavailable" | "blocked" | "unknown";
  httpStatus: number | null;
  body: string | null;
  groups: RobotsGroup[];
  crawlerAccess: "allowed" | "disallowed" | "unknown";
  crawlerAgent: "GEOReviewBot";
  reason: string | null;
}

export type PageCheckStatus = "running" | "success" | "http_error" | "blocked" | "failed";

export interface PageCaptureResult {
  requestedUrl: string;
  finalUrl: string | null;
  checkedAt: string;
  completedAt: string | null;
  status: PageCheckStatus;
  httpStatus: number | null;
  headers: Record<string, string>;
  contentType: string | null;
  charset: string | null;
  bodyComplete: boolean;
  bodyReadable: "readable" | "empty" | "unsupported" | "unknown";
  title: string | null;
  text: string | null;
  rawBody: string | null;
  bodySha256: string | null;
  bytesRead: number | null;
  resolvedAddresses: string[];
  redirects: PageRedirect[];
  indexControl: {
    meta: { agent: string; content: string }[];
    xRobotsTag: string | null;
    generalNoindex: boolean | null;
  };
  robots: RobotsObservation;
  observations: string[];
  error: { code: string; message: string } | null;
}

export interface PageSnapshot extends PageCaptureResult {
  id: string;
  projectId: string;
  workspaceId: string;
  pageId: string;
  label: string;
  revision: number;
  collectionVersion: number;
  projectVersion: number;
  actorId: string;
  leaseExpiresAt: string;
}

export type PageSnapshotSummary = Omit<PageSnapshot, "rawBody" | "text" | "robots" | "indexControl"> & {
  robots: Omit<RobotsObservation, "body" | "groups">;
  indexControl: Omit<PageCaptureResult["indexControl"], "meta">;
};

export interface PageCollectionResponse {
  collection: PageCollection;
  latestSnapshots: PageSnapshotSummary[];
}
