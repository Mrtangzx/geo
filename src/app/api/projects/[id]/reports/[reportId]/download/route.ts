import { getLocalContext } from "@/server/context";
import { handleApi } from "@/server/errors";
import { getReport } from "@/server/reports";
import { exportReportHtml } from "@/server/report-export";
import { projectIdSchema } from "@/server/validation";
import { AppError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; reportId: string }> };

export async function GET(request: Request, context: Context) {
  return handleApi(async () => {
    const params = await context.params;
    const id = projectIdSchema.parse(params.id), reportId = projectIdSchema.parse(params.reportId);
    const { workspaceId } = await getLocalContext();
    const report = await getReport(workspaceId, id, reportId);
    const format = new URL(request.url).searchParams.get("format") ?? "html";
    if (!["html", "json"].includes(format)) throw new AppError(400, "EXPORT_FORMAT_INVALID", "请选择 HTML 或 JSON 报告。");
    return new Response(format === "json" ? JSON.stringify(report, null, 2) : exportReportHtml(report), { headers: {
      "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="geo-report-v${report.version}-${report.id}.${format}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    } });
  });
}
