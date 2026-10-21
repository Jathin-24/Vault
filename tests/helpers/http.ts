/**
 * Minimal HTTP client for integration tests: real fetch + a cookie jar, so
 * every request behaves like a browser session (the app authenticates via the
 * Supabase session cookie, chunked by @supabase/ssr into possibly several
 * Set-Cookie headers — the jar preserves all of them).
 */
export interface TestResponse {
  status: number;
  headers: Headers;
  /** Response body as text. */
  text: string;
  /** Response body as raw bytes (downloads must be byte-exact). */
  bytes: Uint8Array;
  /** Parse the body as JSON, with a helpful error if it is not JSON. */
  json<T = unknown>(): T;
}

export interface RequestOptions {
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

export class TestClient {
  private readonly baseUrl: string;
  private readonly cookies = new Map<string, string>();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  snapshotCookies(): Record<string, string> {
    return Object.fromEntries(this.cookies);
  }

  clearCookies(): void {
    this.cookies.clear();
  }

  private captureCookies(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value) this.cookies.delete(name); // expired cookie
      else this.cookies.set(name, value);
    }
  }

  async request(
    method: string,
    apiPath: string,
    options: RequestOptions = {}
  ): Promise<TestResponse> {
    const headers: Record<string, string> = {
      "user-agent": "trustvault-integration-tests",
      ...options.headers,
    };
    if (this.cookies.size > 0) {
      headers.cookie = [...this.cookies]
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    }

    let body: BodyInit | undefined;
    if (options.form) {
      body = options.form; // fetch sets the multipart boundary itself
    } else if (options.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.json);
    }

    const res = await fetch(`${this.baseUrl}${apiPath}`, {
      method,
      headers,
      body,
      redirect: "manual",
    });
    this.captureCookies(res);

    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(bytes);

    return {
      status: res.status,
      headers: res.headers,
      text,
      bytes,
      json<T>(): T {
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new Error(`Expected JSON, got HTTP ${res.status}: ${text.slice(0, 300)}`);
        }
      },
    };
  }

  get(apiPath: string, headers?: Record<string, string>): Promise<TestResponse> {
    return this.request("GET", apiPath, { headers });
  }

  post(apiPath: string, json?: unknown, headers?: Record<string, string>): Promise<TestResponse> {
    return this.request("POST", apiPath, { json, headers });
  }

  patch(apiPath: string, json?: unknown, headers?: Record<string, string>): Promise<TestResponse> {
    return this.request("PATCH", apiPath, { json, headers });
  }

  del(apiPath: string, headers?: Record<string, string>): Promise<TestResponse> {
    return this.request("DELETE", apiPath, { headers });
  }

  /** Multipart upload to the versions route ('file' field). */
  upload(
    docId: string,
    filename: string,
    content: Uint8Array,
    mime: string
  ): Promise<TestResponse> {
    const form = new FormData();
    // Copy onto a fresh ArrayBuffer: BlobPart requires ArrayBuffer-backed
    // views, and a Shared ArrayBuffer-backed one is refused by the type.
    const copy = new Uint8Array(content);
    form.append("file", new File([copy], filename, { type: mime }));
    return this.request("POST", `/api/documents/${docId}/versions`, { form });
  }
}

/** A client with NO cookies — proves the 401 layer. */
export function anonymous(baseUrl: string): TestClient {
  return new TestClient(baseUrl);
}
