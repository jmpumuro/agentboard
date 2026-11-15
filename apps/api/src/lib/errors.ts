import type { ErrorCode } from 'contract';
export class AppError extends Error {
    constructor(public code: ErrorCode, message: string, public details?: unknown) { super(message); }
}
export function fail(code: ErrorCode, message: string, details?: unknown): never { throw new AppError(code, message, details); }
