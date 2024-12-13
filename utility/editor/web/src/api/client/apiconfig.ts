export interface ApiConfig {
  assetBaseUrl: string;
  apiBaseUrl: string;
  timeout: number;
  defaultHeaders: Record<string, string>;
}

export function createApiConfig(config?: Partial<ApiConfig>): ApiConfig {
  const defaultConfig: ApiConfig = {
    assetBaseUrl: '/assets',
    apiBaseUrl: '/api',
    timeout: 30000,
    defaultHeaders: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
  };
  return {
    ...defaultConfig,
    ...config,
    defaultHeaders: {
      ...defaultConfig.defaultHeaders,
      ...config?.defaultHeaders
    }
  };
}

export const defaultApiConfig = createApiConfig();
