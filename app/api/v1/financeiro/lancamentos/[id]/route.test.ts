import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { FINANCIAL_DELETE_REQUEST_ID_HEADER } from "@/lib/api/wrappers";

const h = vi.hoisted(() => ({
  audit: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  authz: vi.fn(),
  support: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.authz }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.support }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: h.from, rpc: h.rpc }),
}));

import { DELETE, PATCH } from "./route";

const ID = "d5000000-0000-4000-8000-000000000001";
const ORG = "d5000000-0000-4000-8000-000000000002";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const req = (method: "DELETE" | "PATCH") =>
  new NextRequest("http://localhost/api/v1/financeiro/lancamentos/" + ID, {
    method,
    ...(method === "PATCH" ? { body: JSON.stringify({ pay: true }) } : {}),
  });

function consulta(data: unknown, error: unknown = null) {
  const q = {
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  h.from.mockReturnValueOnce(q);
  return q;
}

beforeEach(() => {
  vi.resetAllMocks();
  h.support.mockResolvedValue(null);
  h.authz.mockResolvedValue({ ok: true, org: { orgId: ORG } });
});

it("descarta pela RPC com organização autorizada e correlaciona sem duplicar auditoria", async () => {
  h.rpc.mockResolvedValue({ data: ID, error: null });
  const res = await DELETE(req("DELETE"), ctx());
  expect(res.status).toBe(200);
  expect(h.rpc).toHaveBeenCalledWith("fn_v4e_descartar_lancamento", {
    p_org: ORG,
    p_lancamento: ID,
    p_request_id: res.headers.get("X-Request-Id"),
  });
  expect(h.from).not.toHaveBeenCalled();
  expect(h.audit).not.toHaveBeenCalled();
});

it("usa somente o identificador interno do proxy para a RPC e para a resposta", async () => {
  h.rpc.mockResolvedValue({ data: ID, error: null });
  const pedido = req("DELETE");
  pedido.headers.set("X-Request-Id", ID);
  pedido.headers.set(FINANCIAL_DELETE_REQUEST_ID_HEADER, ORG);
  const res = await DELETE(pedido, ctx());
  expect(res.headers.get("X-Request-Id")).toBe(ORG);
  expect(h.rpc).toHaveBeenCalledWith(
    "fn_v4e_descartar_lancamento",
    expect.objectContaining({ p_request_id: ORG }),
  );
});

it("gera um ID novo quando só existe o cabeçalho público", async () => {
  h.rpc.mockResolvedValue({ data: ID, error: null });
  const pedido = req("DELETE");
  pedido.headers.set("X-Request-Id", ID);
  const res = await DELETE(pedido, ctx());
  expect(res.headers.get("X-Request-Id")).not.toBe(ID);
  expect(h.rpc).toHaveBeenCalledWith(
    "fn_v4e_descartar_lancamento",
    expect.objectContaining({ p_request_id: res.headers.get("X-Request-Id") }),
  );
});

it.each([
  ["PT404", "lancamento_nao_encontrado", 404, "not_found"],
  ["PT409", "historico_financeiro_protegido", 409, "state_conflict"],
  ["42501", "descarte_financeiro_nao_autorizado", 403, "forbidden"],
  ["42501", "descarte_financeiro_mfa_required", 403, "mfa_required"],
  ["XX000", "detalhe interno", 500, "internal_error"],
])("traduz erro da RPC %s %s", async (code, message, status, apiCode) => {
  h.rpc.mockResolvedValue({ data: null, error: { code, message } });
  const res = await DELETE(req("DELETE"), ctx());
  expect(res.status).toBe(status);
  expect((await res.json()).error.code).toBe(apiCode);
  expect(h.audit).not.toHaveBeenCalled();
});

it("mantém recusa de suporte e valida o UUID antes de chamar a RPC", async () => {
  h.support.mockResolvedValueOnce(new Response(null, { status: 403 }));
  expect((await DELETE(req("DELETE"), ctx())).status).toBe(403);
  expect((await DELETE(req("DELETE"), ctx("inválido"))).status).toBe(422);
  expect(h.rpc).not.toHaveBeenCalled();
});

it("trata remoção sem confirmação como resultado desconhecido", async () => {
  h.rpc.mockResolvedValue({ data: null, error: null });
  expect((await DELETE(req("DELETE"), ctx())).status).toBe(500);
  h.rpc.mockRejectedValue(new Error("conexão interrompida"));
  expect((await DELETE(req("DELETE"), ctx())).status).toBe(500);
  expect(h.audit).not.toHaveBeenCalled();
});

it("audita somente pagamento que alterou uma linha pendente da organização", async () => {
  const q = consulta({ amount_cents: 100, direction: "in" });
  const res = await PATCH(req("PATCH"), ctx());
  expect(res.status).toBe(200);
  expect(q.eq.mock.calls).toEqual([
    ["organization_id", ORG],
    ["id", ID],
    ["status", "pending"],
  ]);
  expect(q.is).toHaveBeenCalledWith("paid_at", null);
  expect(h.audit).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      organizationId: ORG,
      resourceId: ID,
      action: "financeiro.lancamento_pago",
    }),
  );
});

it.each([
  [null, 404],
  [{ status: "pending" }, 409],
  [{ status: "paid" }, 200],
])("sem linha alterada, confirma o estado e não audita (%o)", async (estado, status) => {
  consulta(null);
  const leitura = consulta(estado);
  const res = await PATCH(req("PATCH"), ctx());
  expect(res.status).toBe(status);
  if (status === 200) expect((await res.json()).data.ja_pago).toBe(true);
  expect(leitura.eq).toHaveBeenCalledWith("organization_id", ORG);
  expect(h.audit).not.toHaveBeenCalled();
});
