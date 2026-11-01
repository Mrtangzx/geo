import { z } from "zod";
import { normalizePageUrl } from "./page-validation";

const textCondition = z.object({ kind: z.enum(["text_present", "text_absent", "readable_body"]), text: z.string().trim().min(1).max(8000) }).strict();
export const taskConditionSchema = z.union([
  textCondition,
  z.object({ kind: z.literal("http_status"), equals: z.number().int().min(100).max(599) }).strict(),
  z.object({ kind: z.literal("robots_allows"), path: z.string().startsWith("/").max(2048) }).strict(),
  z.object({ kind: z.enum(["no_noindex", "public_third_party_page_changed", "customer_confirmed_material_required"]) }).strict(),
]);
export const taskDraftSchema = z.object({
  expectedRevision: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  targetUrl: z.string().transform((value) => normalizePageUrl(value).href),
  position: z.string().trim().min(1).max(500),
  proposedText: z.string().trim().max(8000).nullable(),
  conditions: z.array(taskConditionSchema).min(1).max(12),
}).strict();
export const taskActionSchema = z.object({
  action: z.enum(["approve", "declare", "verify", "manual_verify", "cancel"]),
  expectedRevision: z.number().int().positive(),
  declaredPublishedAt: z.iso.datetime().optional(),
  releaseId: z.string().uuid().optional(),
  source: z.enum(["synthetic_fixture", "live_public"]).optional(),
  snapshotId: z.string().max(100).optional(),
  beforeSnapshotId: z.string().max(100).optional(),
  reason: z.string().trim().min(8).max(2000).optional(),
  method: z.literal("independent_snapshot_comparison").optional(),
}).strict();
