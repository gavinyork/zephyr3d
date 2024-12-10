import { eventBus } from '../../core/eventbus';
import type { ApiConfig } from './apiconfig';
import { createApiConfig } from './apiconfig';

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
  timeout?: number;
}

interface RequestData<T> {
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
  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { params, timeout = this.config.timeout, ...fetchOptions } = options;
    const baseUrl = this._config.apiBaseUrl.startsWith('http')
      ? this._config.apiBaseUrl
      : window.location.origin + this._config.apiBaseUrl;
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
      const data: RequestData<T> = await response.json();
      if (!data || data.code !== 0) {
        this.handleRequestError(data);
        return null;
      }
      return data.data;
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
  async get<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'GET'
    });
  }

  async post<T>(endpoint: string, data?: any, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined
    });
  }

  async put<T>(endpoint: string, data?: any, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined
    });
  }

  async delete<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'DELETE'
    });
  }

  // 用于上传文件的专用方法
  async uploadFile<T>(endpoint: string, file: File, onProgress?: (progress: number) => void): Promise<T> {
    const formData = new FormData();
    formData.append('file', file);

    return this.request<T>(endpoint, {
      method: 'POST',
      body: formData,
      // 不设置 Content-Type，让浏览器自动设置
      headers: {
        Accept: 'application/json'
      }
    });
  }
}
