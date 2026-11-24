"use server";

import { headers } from "next/headers";
import { after } from "next/server";

import { transporteRecuperacao, PRAZO_RECUPERACAO_MS } from "@/lib/auth/transporte-recuperacao";

import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { createClient } from "@/lib/supabase/server";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/auth/schemas";
import { audit, hashEmail } from "@/lib/audit";
import { authRateLimited, AUTH_LIMITS } from "@/lib/auth/rate-limit";
import { env } from "@/lib/env";
import { semSmtpNaInstalacao } from "@/lib/email/estado";

export type RequestPasswordResetResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "validation_error"
        | "rate_limited"
        | "smtp_not_configured"
        | "request_failed"
        | "provider_timeout"
        | "request_timeout"
        | "invalid_response"
        | "transport_error";
      details?: Record<string, unknown>;
    };

/**
 * Pede o e-mail de redefinição de senha. Resposta neutra quanto à existência
 * do e-mail (o GoTrue responde 200 para e-mail desconhecido — não vaza nada);
 * erros aqui são só de infra (SMTP, rate limit).
 */
export async function requestPasswordReset(
  input: ForgotPasswordInput,
): Promise<RequestPasswordResetResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation_error",
      details: parsed.error.flatten().fieldErrors,
    };
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<RequestPasswordResetResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new DOMException("Prazo da recuperação excedido", "TimeoutError"));
      resolve({ ok: false, error: "request_timeout" });
    }, PRAZO_RECUPERACAO_MS);
  });
  try {
    return await Promise.race([enviarRecuperacao(parsed.data, controller.signal), prazo]);
  } finally {
    clearTimeout(timer);
  }
}

async function enviarRecuperacao(input: ForgotPasswordInput, signal: AbortSignal): Promise<RequestPasswordResetResult> {
  const hdrs = await headers();
  const callback = new URL("/auth/confirm?type=recovery", env.NEXT_PUBLIC_APP_URL);
  const requestId = hdrs.get("x-request-id");
  const ip = ipDoCliente(hdrs);
  const userAgent = hdrs.get("user-agent") ?? null;

  if (signal.aborted) return { ok: false, error: "request_timeout" };
  if (await authRateLimited("reset", input.email, AUTH_LIMITS.reset)) {
    return { ok: false, error: "rate_limited" };
  }
  if (signal.aborted) return { ok: false, error: "request_timeout" };
  // A disponibilidade de SMTP depende somente da instalação, sem enumerar contas.
  if (await semSmtpNaInstalacao()) return { ok: false, error: "smtp_not_configured" };
  if (signal.aborted) return { ok: false, error: "request_timeout" };

  const transporte = transporteRecuperacao(signal);
  const supabase = await createClient(transporte.adaptarFetch);
  if (signal.aborted) return { ok: false, error: "request_timeout" };

  const { error } = await supabase.auth.resetPasswordForEmail(input.email, {
    redirectTo: callback.href,
  });
  if (signal.aborted) return { ok: false, error: "request_timeout" };
  if (error?.status === 429) return { ok: false, error: "rate_limited" };

  const falha = transporte.falha() ??
    (error?.status === 504 ? "provider_timeout" : error ? "request_failed" : null);
  after(() =>
    audit({
      action: falha ? "auth.password_reset_request_failed" : "auth.password_reset_requested",
      metadata: { email_hash: hashEmail(input.email), ...(falha ? { reason: falha } : {}) },
      requestId,
      ip,
      userAgent,
    }),
  );

  return falha ? { ok: false, error: falha } : { ok: true };
}
