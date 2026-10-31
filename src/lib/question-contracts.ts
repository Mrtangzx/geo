export const questionGroups = ["industry_discovery", "solution_comparison", "brand_verification"] as const;
export type QuestionGroup = typeof questionGroups[number];
export const questionSources = ["sales_inquiry", "customer_faq", "search_term", "model_suggestion", "manual"] as const;
export type QuestionSource = typeof questionSources[number];
export const questionPriorities = ["high", "normal", "low"] as const;
export type QuestionPriority = typeof questionPriorities[number];

export const questionGroupLabels: Record<QuestionGroup, string> = {
  industry_discovery: "行业发现",
  solution_comparison: "方案比较",
  brand_verification: "品牌核实",
};
export const questionSourceLabels: Record<QuestionSource, string> = {
  sales_inquiry: "销售咨询", customer_faq: "客户 FAQ", search_term: "已有搜索词",
  model_suggestion: "模型补充", manual: "人工补充",
};

export interface QuestionInput {
  id?: string;
  text: string;
  group: QuestionGroup;
  sourceType: QuestionSource;
  sourceRef: string;
  sourceModel: string | null;
  priority: QuestionPriority;
  isFocus: boolean;
}

export interface BuyerQuestion extends QuestionInput { id: string }

export interface QuestionSet {
  projectId: string;
  workspaceId: string;
  revision: number;
  status: "draft" | "confirmed";
  questions: BuyerQuestion[];
  latestConfirmedVersion: number | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  updatedAt: string | null;
}

export interface QuestionSetVersion {
  projectId: string;
  workspaceId: string;
  version: number;
  sourceRevision: number;
  questions: BuyerQuestion[];
  confirmedAt: string;
  confirmedBy: string;
}

export interface SamplingQuestion {
  questionId: string;
  questionVersion: number;
  text: string;
  group: QuestionGroup;
  priority: QuestionPriority;
  isFocus: boolean;
}
