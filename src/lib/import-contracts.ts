import type { FixturePeriod } from "./sampling-contracts";

export interface EvidenceAttachment {
  id: string; evidenceId: string; filename: string; contentType: "image/png";
  byteLength: number; sha256: string; width: number; height: number;
  uploadedAt: string; uploadedBy: string;
}

export interface ManualProvenance {
  batchId: string; sourceId: string; sourceUrl: string | null; sourceAvailability: "not_checked";
  collectedBy: string; importedBy: string; notes: string;
}

export interface ManualImportInput {
  projectVersion: number; questionVersion: number; period: FixturePeriod;
  format: "json" | "jsonl"; filename: string; content: string;
}
export interface ImportPreviewRow {
  line: number; sourceId: string; questionText: string; platform: string;
  valid: boolean; duplicate: boolean; duplicateEvidenceId: string | null; warnings: string[]; errors: string[];
}
export interface ImportPreview {
  fingerprint: string; rows: ImportPreviewRow[]; total: number; valid: number;
  incomplete: number; duplicates: number; canCommit: boolean;
}
export interface ManualImportBatch {
  id: string; workspaceId: string; projectId: string; projectVersion: number; questionVersion: number;
  period: FixturePeriod; filename: string; format: "json" | "jsonl"; fingerprint: string;
  total: number; created: number; duplicates: number; valid: number; incomplete: number;
  evidenceIds: string[]; importedBy: string; importedAt: string; sourceType: "manual_import"; isSynthetic: boolean;
}
