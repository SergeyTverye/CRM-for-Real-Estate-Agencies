

export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  details?: Record<string, unknown>;
  correlationId?: string;
}

export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

export async function apiCall<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: isForm || body === undefined ? undefined : { "content-type": "application/json" },
      body: isForm ? (body as FormData) : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiCallError(0, { code: "NETWORK_ERROR", message: "Сервер недоступен. Проверьте подключение и повторите." });
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: ApiErrorBody } | null)?.error ?? { code: `HTTP_${res.status}`, message: "Ошибка запроса" };
    throw new ApiCallError(res.status, err);
  }
  return data as T;
}
