export type FactStatus = "confirmed" | "needs_confirmation";

export interface CompetitorInput {
  name: string;
  websiteUrl: string;
}

export interface FactInput {
  id?: string;
  statement: string;
  sourceUrl: string;
  sourceRef?: string;
  status: FactStatus;
}

export interface ProjectInput {
  name: string;
  aliases: string[];
  websiteUrl: string;
  product: string;
  targetCustomers: string;
  competitors: CompetitorInput[];
  facts: FactInput[];
  isSynthetic: boolean;
}

export interface ProjectFact extends FactInput {
  id: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface Project extends Omit<ProjectInput, "facts"> {
  id: string;
  workspaceId: string;
  version: number;
  facts: ProjectFact[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectVersion {
  version: number;
  createdAt: string;
  snapshot: Project;
}

export interface ApiError {
  error: string;
  code?: string;
  issues?: { path: string; message: string }[];
}
