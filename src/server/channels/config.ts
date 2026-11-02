import type { ChannelReadiness, ExternalChannel } from "@/lib/channel-contracts";
import { AppError } from "../errors";

export const externalCallsEnabled = () => process.env.GEO_EXTERNAL_PAID_CALLS_ENABLED === "true";
const regions = ["cn-beijing", "ap-southeast-1", "us-east-1", "eu-central-1", "ap-northeast-1"] as const;
type DashScopeRegion = typeof regions[number];

function positiveMinor(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 1_000_000_000 ? amount : null;
}

export function getChannelReadiness(channel: ExternalChannel): ChannelReadiness {
  const dataforseo = channel === "dataforseo_chatgpt_web";
  const analysis = channel === "qwen_analysis";
  const missing: string[] = [];
  const upperBoundMinor = positiveMinor(process.env[dataforseo ? "GEO_DATAFORSEO_UPPER_BOUND_USD_MINOR" : analysis ? "GEO_ANALYSIS_UPPER_BOUND_CNY_MINOR" : "GEO_QWEN_SEARCH_UPPER_BOUND_CNY_MINOR"]);
  const priceReference = process.env[dataforseo ? "GEO_DATAFORSEO_PRICE_REFERENCE" : analysis ? "GEO_ANALYSIS_PRICE_REFERENCE" : "GEO_QWEN_SEARCH_PRICE_REFERENCE"]?.trim() || null;
  if (dataforseo) {
    if (!process.env.DATAFORSEO_LOGIN?.trim() || !process.env.DATAFORSEO_PASSWORD?.trim()) missing.push("DataForSEO服务端账号待配置");
    if (!process.env.GEO_DATAFORSEO_TERMS_REFERENCE?.trim()) missing.push("当前数据保存和商用使用条件的核对记录待配置");
  } else {
    if (!process.env.DASHSCOPE_API_KEY?.trim()) missing.push("百炼服务端密钥待配置");
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(process.env.DASHSCOPE_WORKSPACE_ID ?? "")) missing.push("百炼业务空间ID待配置");
    if (!regions.includes(process.env.DASHSCOPE_REGION as DashScopeRegion)) missing.push("百炼地域待配置");
  }
  if (upperBoundMinor == null) missing.push("可靠的单次费用上限待配置，未知费用不能按零运行");
  if (!priceReference) missing.push("当前价格及上限依据待配置");
  return {
    channel, sourceType: dataforseo ? "consumer_web" : analysis ? "analysis_model" : "api_comparison",
    configured: missing.length === 0, paidCallsEnabled: externalCallsEnabled(), acceptance: "not_verified", missing,
    requestedModel: dataforseo ? null : process.env[analysis ? "GEO_ANALYSIS_MODEL" : "GEO_QWEN_SEARCH_MODEL"]?.trim() || "qwen3.7-plus",
    currency: dataforseo ? "USD" : "CNY", upperBoundMinor, priceReference,
  };
}

/** Private credentials never belong in a browser response or saved request body. */
export function privateDataForSeoAuthorization(): string {
  const login = process.env.DATAFORSEO_LOGIN?.trim(); const password = process.env.DATAFORSEO_PASSWORD?.trim();
  if (!login || !password) throw new AppError(503, "DATAFORSEO_NOT_CONFIGURED", "DataForSEO服务端凭证待配置。");
  return `Basic ${Buffer.from(`${login}:${password}`, "utf8").toString("base64")}`;
}

export function dashScopeEndpoint(): string {
  const workspace = process.env.DASHSCOPE_WORKSPACE_ID;
  const region = process.env.DASHSCOPE_REGION;
  if (!workspace || !/^[a-zA-Z0-9-]{1,64}$/.test(workspace) || !regions.includes(region as DashScopeRegion)) {
    throw new AppError(503, "DASHSCOPE_ENDPOINT_NOT_CONFIGURED", "请配置当前百炼业务空间与地域，不使用任意代理地址。");
  }
  return `https://${workspace}.${region}.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation`;
}

export function assertChannelCanSubmit(channel: ExternalChannel): ChannelReadiness {
  const status = getChannelReadiness(channel);
  if (!status.configured) throw new AppError(503, "CHANNEL_NOT_CONFIGURED", status.missing.join("；"));
  if (!status.paidCallsEnabled) throw new AppError(409, "EXTERNAL_PAID_CALLS_DISABLED", "当前仅使用合成材料，真实付费调用未开启。");
  // Caller must additionally atomically reserve real budget and claim a durable
  // execution intent. This check is deliberately not a network execution API.
  return status;
}
