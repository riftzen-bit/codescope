import {
  AnthropicIcon,
  OpenAIIcon,
  GoogleIcon,
  OllamaIcon,
  ClaudeCodeIcon,
} from '../Icons';
import type { ProviderConfig } from './types';

/**
 * Model catalog — shown in Settings and used as the source of truth for the
 * default model in `settings/store.ts`.
 *
 * UPDATE CADENCE: hand-edit this list whenever any vendor ships a new model
 * or deprecates one of the IDs below. At minimum, audit every release cycle
 * (target: once per month). The IDs here are sent verbatim to the vendor
 * SDKs — a stale ID returns `model_not_found` at runtime with no UI
 * affordance for the user to recover, so treat drift as a bug, not a cleanup
 * chore.
 *
 * When removing a model ID, also update `DEFAULT_SETTINGS.providers` in
 * `electron/main/settings/store.ts` if that model was the default; a
 * default pointing at a dead ID breaks first-run for every new install.
 *
 * Future work: fetch the live list from each provider's /models endpoint
 * when an API key is configured, and fall back to this static catalog only
 * when the network call fails or the provider is keyless.
 */
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    placeholder: 'sk-ant-api03-…',
    hasKey: true,
    description: 'Claude models for code review',
    color: '#D97706',
    Icon: AnthropicIcon,
    models: [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Fast, balanced' },
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', description: 'Most capable' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'Fastest, lightweight' },
    ],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    placeholder: 'sk-proj-…',
    hasKey: true,
    description: 'GPT models for code review',
    color: '#10B981',
    Icon: OpenAIIcon,
    models: [
      { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Most capable' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'Fast, cost-effective' },
      { id: 'o3', label: 'o3', description: 'Deep reasoning' },
      { id: 'o4-mini', label: 'o4-mini', description: 'Fast reasoning' },
      { id: 'gpt-4.1', label: 'GPT-4.1', description: '1M context, instruction following' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', description: 'Fast, budget-friendly' },
    ],
  },
  google: {
    id: 'google',
    label: 'Google',
    placeholder: 'AIzaSy…',
    hasKey: true,
    description: 'Gemini models for code review',
    color: '#3B82F6',
    Icon: GoogleIcon,
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Best reasoning and coding' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast, cost-effective' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', description: 'Budget-friendly' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', description: 'Advanced reasoning (preview)' },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', description: 'Frontier-class (preview)' },
    ],
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama',
    placeholder: 'http://localhost:11434',
    hasKey: false,
    description: 'Local models, no key required',
    color: '#8B5CF6',
    Icon: OllamaIcon,
    models: [
      { id: 'llama3.2', label: 'Llama 3.2', description: 'Latest Llama' },
      { id: 'codellama', label: 'Code Llama', description: 'Optimized for code' },
      { id: 'mistral', label: 'Mistral', description: 'Fast, efficient' },
      { id: 'deepseek-coder', label: 'DeepSeek Coder', description: 'Code specialist' },
    ],
  },
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    placeholder: 'Paste token from Claude Code setup',
    hasKey: false,
    description: 'Claude Code CLI for code review',
    color: '#D97706',
    Icon: ClaudeCodeIcon,
    models: [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Fast, balanced' },
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', description: 'Most capable' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'Fastest, lightweight' },
    ],
  },
};

export const CLOUD_PROVIDERS = Object.values(PROVIDER_CONFIGS).filter((cfg) => cfg.hasKey);

export const LOCAL_PROVIDERS = Object.values(PROVIDER_CONFIGS).filter((cfg) => !cfg.hasKey);
