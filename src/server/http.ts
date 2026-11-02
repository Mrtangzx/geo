import { AppError } from "./errors";

const MAX_BODY_BYTES = 256 * 1024;

export async function readJsonBody(request: Request, maxBodyBytes = MAX_BODY_BYTES): Promise<unknown> {
  const origin = request.headers.get("origin");
  if (origin) {
    // Next may construct request.url with its internal listening hostname. The
    // HTTP Host is the destination the browser actually requested; do not trust
    // forwarding headers to bypass the same-origin check.
    let matchesOrigin = false;
    try {
      const destination = new URL(request.url);
      const host = request.headers.get("host") ?? destination.host;
      const expected = new URL(`${destination.protocol}//${host}`);
      matchesOrigin = !expected.username && !expected.password
        && expected.host.toLowerCase() === host.toLowerCase()
        && new URL(origin).origin === expected.origin;
    } catch {
      // Malformed or opaque origins are not same-origin browser requests.
    }
    if (!matchesOrigin) {
      throw new AppError(403, "ORIGIN_REJECTED", "请求来源不匹配，请从当前应用页面操作。");
    }
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "请使用 JSON 格式提交资料。");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "INVALID_JSON", "提交内容不能为空。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel();
        throw new AppError(413, "REQUEST_TOO_LARGE", "提交内容过大，请减少资料后重试。");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AppError(400, "INVALID_JSON", "提交内容不是有效的 JSON。");
  }
}

export function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
