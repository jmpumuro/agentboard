export class ApiError extends Error {
    constructor(public code: string, message: string, public details?: any) { super(message); }
}
export async function api<T = any>(path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    const response = await fetch(path.startsWith('/mcp') ? path : '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', ...extra }, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.status === 204)
        return undefined as T;
    const value = await response.json();
    if (!response.ok)
        throw new ApiError(value.error?.code || 'internal', value.error?.message || 'Request failed', value.error?.details);
    return value;
}
