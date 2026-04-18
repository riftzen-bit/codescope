export const Channels = {
  // Review
  REVIEW_RUN: 'review:run',
  REVIEW_STREAM: 'review:stream',
  REVIEW_STREAM_CHUNK: 'review:stream:chunk',
  REVIEW_STREAM_DONE: 'review:stream:done',
  REVIEW_STREAM_ERROR: 'review:stream:error',
  REVIEW_CANCEL: 'review:cancel',

  // API Keys
  KEYS_SAVE: 'keys:save',
  KEYS_GET: 'keys:get',
  KEYS_DELETE: 'keys:delete',
  KEYS_LIST: 'keys:list',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_SET_PROVIDER: 'settings:setProvider',
  SETTINGS_SET_MODEL: 'settings:setModel',
  SETTINGS_SET_OLLAMA_URL: 'settings:setOllamaUrl',
  SETTINGS_RESET: 'settings:reset',
  SETTINGS_IMPORT: 'settings:import',

  // App
  APP_SELECT_FOLDER: 'app:selectFolder',
  APP_READ_FILES: 'app:readFiles',
  APP_READ_PROJECT_FILES: 'app:readProjectFiles',
  APP_EXPORT_REVIEW: 'app:exportReview',

  APP_CONFIRM: 'app:confirm',
  APP_WATCH_PROJECT: 'app:watchProject',
  APP_UNWATCH_PROJECT: 'app:unwatchProject',
  APP_PROJECT_FILES_CHANGED: 'app:projectFilesChanged',

  // Ollama
  OLLAMA_TEST: 'ollama:test',

  // Claude Code
  CLAUDE_CODE_TEST: 'claude-code:test',

  // Projects
  PROJECT_ADD: 'project:add',
  PROJECT_REMOVE: 'project:remove',
  PROJECT_LIST: 'project:list',
  // History
  HISTORY_LIST: 'history:list',
  HISTORY_GET: 'history:get',
  HISTORY_ADD: 'history:add',
  HISTORY_DELETE: 'history:delete',
  HISTORY_CLEAR: 'history:clear',
} as const;
