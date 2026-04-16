export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  text: string;
  model: string;
  tokensUsed?: {
    input: number;
    output: number;
  };
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  chat(messages: ChatMessage[]): Promise<ChatResponse>;
  stream(messages: ChatMessage[], onChunk: (text: string) => void): Promise<ChatResponse>;
}
