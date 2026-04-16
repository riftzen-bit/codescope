import type { AIProvider } from '../providers/types.js';
import type { ReviewRequest, ReviewResult } from './types.js';
import { SYSTEM_PROMPT, buildUserMessage } from './prompts.js';
import { detectLanguage, parseReviewResponse } from './parser.js';

export class ReviewEngine {
  constructor(private provider: AIProvider) {}

  async review(request: ReviewRequest): Promise<ReviewResult> {
    const language = request.language ?? detectLanguage(request.code, request.filename);
    const userMessage = buildUserMessage(request.code, language, request.filename, request.rules);

    const response = await this.provider.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ]);

    return parseReviewResponse(
      response.text,
      this.provider.name,
      response.model,
      language,
      response.tokensUsed,
    );
  }

  async reviewStream(
    request: ReviewRequest,
    onChunk: (text: string) => void,
  ): Promise<ReviewResult> {
    const language = request.language ?? detectLanguage(request.code, request.filename);
    const userMessage = buildUserMessage(request.code, language, request.filename, request.rules);

    const response = await this.provider.stream(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      onChunk,
    );

    return parseReviewResponse(
      response.text,
      this.provider.name,
      response.model,
      language,
      response.tokensUsed,
    );
  }
}
