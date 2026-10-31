import type { ApiError } from "@/lib/contracts";

export class ApiFailure extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiFailure";
  }
}

export async function projectApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload as ApiError | null;
    const details = error?.issues?.map((issue) => issue.message).join("；");
    throw new ApiFailure(
      details || error?.error || "资料服务暂时不可用，请稍后重试。",
      response.status,
    );
  }
  if (payload === null) throw new ApiFailure("服务返回了无法读取的数据，请重试。", 502);
  return payload as T;
}

export function formatProjectDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
