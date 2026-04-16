export type Severity = 'critical' | 'error' | 'warning' | 'info';

export type Category =
  | 'security'
  | 'performance'
  | 'correctness'
  | 'maintainability'
  | 'style'
  | 'other';

export interface Finding {
  id: string;
  severity: Severity;
  category: Category;
  line?: number;
  title: string;
  description: string;
  suggestion: string;
}

export interface ReviewRequest {
  code: string;
  filename?: string;
  language?: string;
  rules?: string[];
}

export interface ReviewResult {
  summary: string;
  score: number;
  findings: Finding[];
  language: string;
  provider: string;
  model: string;
  tokensUsed?: {
    input: number;
    output: number;
  };
}
