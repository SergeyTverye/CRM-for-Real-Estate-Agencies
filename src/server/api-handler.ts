import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/shared/config/env";
import { desktopLoopbackAllowed } from "@/shared/auth/desktop-loopback";
import { correlationIdFrom, runWithContext, setContextActor } from "@/shared/context";
import { logger } from "@/shared/logging/logger";
import {
  AppError,
  AuthenticationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PasswordChangeRequiredError,
  ReadOnlyInstanceError,
  ValidationError,
  DomainError,
} from "@/shared/errors";
import { resolveSession } from "@/modules/auth/application/session-service";
import { SESSION_COOKIE } from "@/modules/auth/infrastructure/session-token";
import type { Actor } from "@/modules/auth/domain/actor";


export type Access = "public" | "authenticated" | "manager";

export interface ApiOptions {
  access?: Access;
  /** Ð Ð°Ð·Ñ€ÐµÑˆÐ¸Ñ‚ÑŒ Ð·Ð°Ð¿Ñ€Ð¾Ñ Ð¿Ð¾Ð»ÑŒÐ·Ð¾Ð²Ð°Ñ‚ÐµÐ»ÑŽ, Ð¾Ð±ÑÐ·Ð°Ð½Ð½Ð¾Ð¼Ñƒ ÑÐ¼ÐµÐ½Ð¸Ñ‚ÑŒ Ð²Ñ€ÐµÐ¼ÐµÐ½Ð½Ñ‹Ð¹ Ð¿Ð°Ñ€Ð¾Ð»ÑŒ. */
  allowPasswordChange?: boolean;
  allowOnStandby?: boolean;
}

export interface ApiContext<P> {
  req: NextRequest;
  params: P;
  actor: Actor | null;
  correlationId: string;
}

export interface AuthedApiContext<P> extends ApiContext<P> {
  actor: Actor;
}

type RouteCtx<P> = { params: Promise<P> };

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

export function json(data: unknown, status = 200, headers?: HeadersInit): NextResponse {
  return new NextResponse(JSON.stringify(data, jsonReplacer), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw new ForbiddenError("Ð—Ð°Ð¿Ñ€Ð¾Ñ Ð¾Ñ‚ÐºÐ»Ð¾Ð½Ñ‘Ð½: Ð½Ðµ Ð¿Ð¾Ð´Ñ‚Ð²ÐµÑ€Ð¶Ð´Ñ‘Ð½ Ð¸ÑÑ‚Ð¾Ñ‡Ð½Ð¸Ðº (Origin)");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError("Ð—Ð°Ð¿Ñ€Ð¾Ñ Ð¾Ñ‚ÐºÐ»Ð¾Ð½Ñ‘Ð½: Ð½ÐµÐºÐ¾Ñ€Ñ€ÐµÐºÑ‚Ð½Ñ‹Ð¹ Origin");
  }
  if (originHost !== host) throw new ForbiddenError("Ð—Ð°Ð¿Ñ€Ð¾Ñ Ð¾Ñ‚ÐºÐ»Ð¾Ð½Ñ‘Ð½: Ð·Ð°Ð¿Ñ€Ð¾Ñ Ñ Ð´Ñ€ÑƒÐ³Ð¾Ð³Ð¾ ÑÐ°Ð¹Ñ‚Ð°");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertIdParams(params: unknown): void {
  if (!params || typeof params !== "object") return;
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if ((k === "id" || k.endsWith("Id")) && (typeof v !== "string" || !UUID_RE.test(v))) throw new NotFoundError();
  }
}

function mapUnknownError(e: unknown): AppError | null {
  const code = (e as { code?: unknown })?.code;
  if (typeof code === "string") {
    if (code === "P2002") return new ConflictError("UNIQUE_CONFLICT", "Ð—Ð°Ð¿Ð¸ÑÑŒ Ñ Ñ‚Ð°ÐºÐ¸Ð¼Ð¸ Ð´Ð°Ð½Ð½Ñ‹Ð¼Ð¸ ÑƒÐ¶Ðµ ÑÑƒÑ‰ÐµÑÑ‚Ð²ÑƒÐµÑ‚");
    if (code === "P2025") return new NotFoundError();
    if (code === "P2003") return new DomainError("REFERENCE_INVALID", "Ð¡Ð²ÑÐ·Ð°Ð½Ð½Ð°Ñ Ð·Ð°Ð¿Ð¸ÑÑŒ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð° Ð¸Ð»Ð¸ Ð¸ÑÐ¿Ð¾Ð»ÑŒÐ·ÑƒÐµÑ‚ÑÑ");
    if (code === "23514" || /check constraint/i.test(String((e as Error).message)))
      return new DomainError("CONSTRAINT_VIOLATION", "Ð”Ð°Ð½Ð½Ñ‹Ðµ Ð½Ð°Ñ€ÑƒÑˆÐ°ÑŽÑ‚ Ð±Ð¸Ð·Ð½ÐµÑ-Ð¾Ð³Ñ€Ð°Ð½Ð¸Ñ‡ÐµÐ½Ð¸Ðµ");
  }
  return null;
}

export function errorResponse(e: unknown, correlationId: string): NextResponse {
  const appError = e instanceof AppError ? e : mapUnknownError(e);
  if (appError) {
    if (appError.status >= 500) logger.error({ err: e, code: appError.code }, "request failed");
    return json({ error: { ...appError.toJSON(), correlationId } }, appError.status);
  }
  logger.error({ err: e }, "unexpected error");
  return json(
    { error: { code: "INTERNAL_ERROR", message: "Ð’Ð½ÑƒÑ‚Ñ€ÐµÐ½Ð½ÑÑ Ð¾ÑˆÐ¸Ð±ÐºÐ°. Ð¡Ð¾Ð¾Ð±Ñ‰Ð¸Ñ‚Ðµ Ð°Ð´Ð¼Ð¸Ð½Ð¸ÑÑ‚Ñ€Ð°Ñ‚Ð¾Ñ€Ñƒ ÐºÐ¾Ð´ Ð·Ð°Ð¿Ñ€Ð¾ÑÐ°.", correlationId } },
    500,
  );
}

export function api<P = Record<string, never>>(
  options: ApiOptions & { access: "public" },
  handler: (ctx: ApiContext<P>) => Promise<unknown>,
): (req: NextRequest, ctx: RouteCtx<P>) => Promise<Response>;
export function api<P = Record<string, never>>(
  options: ApiOptions & { access?: "authenticated" | "manager" },
  handler: (ctx: AuthedApiContext<P>) => Promise<unknown>,
): (req: NextRequest, ctx: RouteCtx<P>) => Promise<Response>;
export function api<P>(options: ApiOptions, handler: (ctx: AuthedApiContext<P>) => Promise<unknown>) {
  const access: Access = options.access ?? "authenticated";
  return async (req: NextRequest, routeCtx: RouteCtx<P>): Promise<Response> => {
    const correlationId = correlationIdFrom(req.headers.get("x-request-id"));
    const started = Date.now();
    return runWithContext({ correlationId }, async () => {
      let status = 500;
      try {
        if (!desktopLoopbackAllowed(req.headers, req.method)) throw new ForbiddenError("Ð˜ÑÑ‚Ð¾Ñ‡Ð½Ð¸Ðº Ð·Ð°Ð¿Ñ€Ð¾ÑÐ° Ð½Ðµ Ñ€Ð°Ð·Ñ€ÐµÑˆÑ‘Ð½");
        const method = req.method.toUpperCase();
        if (MUTATING.has(method)) {
          assertSameOrigin(req);
          if (getConfig().isReadOnlyInstance && !options.allowOnStandby) throw new ReadOnlyInstanceError();
        }
        const actor = await resolveSession(req.cookies.get(SESSION_COOKIE)?.value);
        if (access !== "public") {
          if (!actor) throw new AuthenticationError();
          if (actor.mustChangePassword && !options.allowPasswordChange) throw new PasswordChangeRequiredError();
          if (access === "manager" && actor.role !== "manager") throw new ForbiddenError();
        }
        if (actor) setContextActor(actor.userId);
        const params = (routeCtx?.params ? await routeCtx.params : {}) as P;
        assertIdParams(params);
        const result = await handler({ req, params, actor: actor as Actor, correlationId });
        const response = result instanceof Response ? result : json(result ?? { ok: true });
        status = response.status;
        response.headers.set("x-request-id", correlationId);
        return response;
      } catch (e) {
        const response = errorResponse(e, correlationId);
        status = response.status;
        response.headers.set("x-request-id", correlationId);
        return response;
      } finally {
        logger.info(
          { event: "http.request", method: req.method, path: req.nextUrl.pathname, status, durationMs: Date.now() - started },
          "request",
        );
      }
    });
  };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) throw new ValidationError("ÐžÐ¶Ð¸Ð´Ð°ÐµÑ‚ÑÑ JSON (Content-Type: application/json)");
  try {
    return await req.json();
  } catch {
    throw new ValidationError("ÐÐµÐºÐ¾Ñ€Ñ€ÐµÐºÑ‚Ð½Ñ‹Ð¹ JSON Ð² Ñ‚ÐµÐ»Ðµ Ð·Ð°Ð¿Ñ€Ð¾ÑÐ°");
  }
}

export function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}

export function isSecureRequest(req: NextRequest): boolean {
  const setting = getConfig().COOKIE_SECURE;
  if (setting === "true") return true;
  if (setting === "false") return false;
  return req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}
