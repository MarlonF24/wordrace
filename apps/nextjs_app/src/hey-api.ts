// src/hey-api.ts
import type { CreateClientConfig } from './api-clients/search_agent/client/types.gen';
import { SETTINGS } from './settings';

export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  // Server-side API calls use the Compose service URL in production.
  baseUrl: SETTINGS.searchAgentUrl,
});
