/** A exclusão do rascunho usa a RPC auditada. Pagar só altera pendentes. */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { FINANCIAL_DELETE_REQUEST_ID_HEADER, ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const idSchema = z.uuid();

const alterarSchema = z.object({
  /** O único caminho de mudança: pendente vira pago. Nunca o contrário. */
  pay: z.literal(true),
});

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const lido = alterarSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", "Só é possível marcar como pago.", 422, { requestId });
  }

  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success)
    return fail("validation_failed", "Identificador de lançamento inválido.", 422, { requestId });

  const supabase = await createClient();
  const orgId = authz.org.orgId;
  const agora = new Date().toISOString();
  const { data: pago, error } = await supabase
    .from("financial_entries")
    .update({ status: "paid", paid_at: agora, updated_at: agora })
    .eq("organization_id", orgId)
    .eq("id", id.data)
    .eq("status", "pending")
    .is("paid_at", null)
    .select("amount_cents, direction")
    .maybeSingle();
  if (error)
    return fail("internal_error", "Não foi possível registrar o pagamento.", 500, { requestId });

  if (!pago) {
    // Uma segunda tentativa só recebe confirmação se o registro continua pago.
    const { data: atual, error: leitura } = await supabase
      .from("financial_entries")
      .select("status")
      .eq("organization_id", orgId)
      .eq("id", id.data)
      .maybeSingle();
    if (leitura)
      return fail("internal_error", "Não foi possível consultar o pagamento.", 500, { requestId });
    if (!atual) return fail("not_found", "Lançamento não encontrado.", 404, { requestId });
    if (atual.status === "paid")
      return ok({ id: id.data, status: "paid", ja_pago: true }, { requestId });
    return fail("state_conflict", "O lançamento não pôde ser marcado como pago.", 409, {
      requestId,
    });
  }

  await audit({
    action: "financeiro.lancamento_pago",
    organizationId: orgId,
    resourceType: "financial_entry",
    resourceId: id.data,
    requestId,
    metadata: { amount_cents: pago.amount_cents, direction: pago.direction },
  });

  return ok({ id: id.data, status: "paid" }, { requestId });
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<Response> {
  const correlacao = idSchema.safeParse(req.headers.get(FINANCIAL_DELETE_REQUEST_ID_HEADER));
  const requestId = correlacao.success ? correlacao.data : randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) {
    supportDenied.headers.set("X-Request-Id", requestId);
    return supportDenied;
  }

  const authz = await requireRole("agent", { requestId, resource: "financeiro" });
  if (!authz.ok) return authz.response;

  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success)
    return fail("validation_failed", "Identificador de lançamento inválido.", 422, { requestId });

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("fn_v4e_descartar_lancamento", {
      p_org: authz.org.orgId,
      p_lancamento: id.data,
      p_request_id: requestId,
    });
    if (!error && data === id.data.toLowerCase())
      return ok({ id: data, removed: true }, { requestId });
    if (error?.code === "PT404")
      return fail("not_found", "Lançamento não encontrado.", 404, { requestId });
    if (error?.code === "PT409") {
      return fail(
        "state_conflict",
        "Este lançamento possui histórico financeiro protegido e não pode ser excluído.",
        409,
        { requestId },
      );
    }
    if (error?.code === "42501") {
      if (error.message === "descarte_financeiro_mfa_required") {
        return fail("mfa_required", "Confirme o segundo fator para excluir o lançamento.", 403, {
          requestId,
        });
      }
      return fail("forbidden", "Sem permissão para excluir o lançamento.", 403, { requestId });
    }
  } catch {
    // Uma interrupção de transporte pode ocorrer após o commit.
  }
  return fail(
    "internal_error",
    "Não foi possível confirmar a exclusão. Consulte o lançamento antes de tentar novamente.",
    500,
    { requestId },
  );
}
