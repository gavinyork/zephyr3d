import { eventBus } from '../../core/eventbus';
import type { ApiConfig } from './apiconfig';
import { createApiConfig } from './apiconfig';

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
  timeout?: number;
}

interface RequestData<T = null> {
  code: number;
  message: string;
  data: T;
}

export class ApiClient {
  private _config: ApiConfig;
  constructor(config?: Partial<ApiConfig>) {
    this._config = createApiConfig(config);
  }
  get config() {
    return this._config;
  }
  private async request(endpoint: string, baseUrl: string, options: RequestOptions = {}): Promise<Response> {
    const { params, timeout = this.config.timeout, ...fetchOptions } = options;
    baseUrl = baseUrl.startsWith('http')
      ? baseUrl
      : window.location.origin + baseUrl;
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    const url = new URL(normalizedEndpoint, normalizedBaseUrl);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }
    const headers = new Headers({
      ...this.config.defaultHeaders,
      ...fetchOptions.headers
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    /*
    const token = localStorage.getItem('token');
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    */
    try {
      const response = await fetch(url.toString(), {
        ...fetchOptions,
        headers,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        await this.handleHttpError(response);
      }
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      this.handleNetworkError(error);
      return null;
    }
  }
  private async handleRequestError<T>(data: RequestData<T>) {
    eventBus.dispatchEvent('error', data ? `Request failed: ${data.message}` : `No data`);
  }
  private async handleHttpError(response: Response) {
    const errorData = await response.json().catch(() => ({}));
    switch (response.status) {
      case 401:
        eventBus.dispatchEvent('error', 'Request failed: Unauthorized');
        break;
      case 403:
        eventBus.dispatchEvent('error', 'Request failed: Forbidden');
        break;
      case 404:
        eventBus.dispatchEvent('error', 'Request failed: Resource not found');
        break;
      case 429:
        eventBus.dispatchEvent('error', 'Request failed: Too many requests');
        break;
      default:
        eventBus.dispatchEvent('error', errorData.message || 'Server error');
    }
  }
  private handleNetworkError(error: unknown) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        eventBus.dispatchEvent('error', 'Request failed: Request was cancelled');
      } else {
        eventBus.dispatchEvent('error', `Request failed: ${error.message}`);
      }
    } else {
      eventBus.dispatchEvent('error', `Request failed: ${error}`);
    }
  }
  async asset(endpoint: string, type: 'json'|'text'|'blob'|'arraybuffer', options: RequestOptions = {}) {
    const res = await this.request(endpoint, this._config.assetBaseUrl, {
      ...options,
      method: 'GET'
    });
    switch (type) {
      case 'json':
        return res.json();
      case 'text':
        return res.text();
      case 'blob':
        return res.blob();
      case 'arraybuffer':
        return res.arrayBuffer();
      default:
        throw new Error(`Unsupported response type: ${type}`);
    }
  }
  async get<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const res = await this.request(endpoint, this._config.apiBaseUrl, {
      ...options,
      method: 'GET'
    });
    const data: RequestData<T> = await res.json();
    if (!data || data.code !== 0) {
      this.handleRequestError(data);
      return null;
    }
    return data.data;
  }

  async post<T>(endpoint: string, body?: any, options: RequestOptions = {}): Promise<T> {
    const res = await this.request(endpoint, this._config.apiBaseUrl, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined
    });
    const data: RequestData<T> = await res.json();
    if (!data || data.code !== 0) {
      this.handleRequestError(data);
      return null;
    }
    return data.data;
  }

  async uploadFile<T>(endpoint: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await this.request(endpoint, this._config.apiBaseUrl, {
      method: 'POST',
      body: formData,
      headers: {
        Accept: 'application/json'
      }
    });
    const data: RequestData<T> = await res.json();
    if (!data || data.code !== 0) {
      this.handleRequestError(data);
      return null;
    }
    return data.data;
  }
}
