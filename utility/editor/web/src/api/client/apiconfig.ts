export interface ApiConfig {
  apiBaseUrl: string;
  timeout: number;
  defaultHeaders: Record<string, string>;
}

export function createApiConfig(config?: Partial<ApiConfig>): ApiConfig {
  const defaultConfig: ApiConfig = {
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
