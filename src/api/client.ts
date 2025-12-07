import { generateNcrHeaders } from "../auth/hmac.js";
import { config } from "../config/index.js";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestOptions {
  method: HttpMethod;
  path: string;
  body?: unknown;
}

interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

/**
 * Base NCR API client with HMAC authentication
 */
export class NcrClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.ncr.apiGateway;
  }

  async request<T>(options: RequestOptions): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${options.path}`;
    const contentType = "application/json";

    const headers = generateNcrHeaders({
      method: options.method,
      url,
      contentType,
    });

    try {
      const response = await fetch(url, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const text = await response.text();
      let data: T | undefined;

      try {
        data = text ? JSON.parse(text) : undefined;
      } catch {
        // Response is not JSON
      }

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: text || `HTTP ${response.status}`,
        };
      }

      return {
        ok: true,
        status: response.status,
        data,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // Convenience methods
  get<T>(path: string) {
    return this.request<T>({ method: "GET", path });
  }

  post<T>(path: string, body: unknown) {
    return this.request<T>({ method: "POST", path, body });
  }

  put<T>(path: string, body: unknown) {
    return this.request<T>({ method: "PUT", path, body });
  }

  patch<T>(path: string, body: unknown) {
    return this.request<T>({ method: "PATCH", path, body });
  }

  delete<T>(path: string) {
    return this.request<T>({ method: "DELETE", path });
  }
}

// Singleton instance
export const ncrClient = new NcrClient();
