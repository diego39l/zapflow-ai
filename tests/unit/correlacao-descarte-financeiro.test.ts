// @vitest-environment node
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

import { FINANCIAL_DELETE_REQUEST_ID_HEADER } from "@/lib/api/wrappers";
import { proxy } from "@/proxy";

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:1",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-de-teste",
  },
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: {} } }) } }),
}));

const url = "http://127.0.0.1/api/v1/financeiro/lancamentos/d5000000-0000-4000-8000-000000000001";
const externo = "d5000000-0000-4000-8000-000000000002";
const reservado = "d5000000-0000-4000-8000-000000000003";
const repassado = (nome: string) => "x-middleware-request-" + nome;

it.each([undefined, "externo-arbitrario", externo])(
  "gera e encaminha o mesmo ID mesmo quando X-Request-Id é %s",
  async (id) => {
    const headers = id
      ? { "x-request-id": id, [FINANCIAL_DELETE_REQUEST_ID_HEADER]: reservado }
      : undefined;
    const res = await proxy(new NextRequest(url, { method: "DELETE", headers }));
    const rid = res.headers.get("x-request-id");
    expect(rid).toMatch(/^[0-9a-f-]{36}$/);
    expect(rid).not.toBe(id);
    expect(rid).not.toBe(reservado);
    expect(res.headers.get(repassado("x-request-id"))).toBe(rid);
    expect(res.headers.get(repassado(FINANCIAL_DELETE_REQUEST_ID_HEADER))).toBe(rid);
    expect(res.headers.get(FINANCIAL_DELETE_REQUEST_ID_HEADER)).toBeNull();
  },
);

it("preserva a correlação existente do PATCH e descarta o cabeçalho reservado do cliente", async () => {
  const headers = { "x-request-id": externo, [FINANCIAL_DELETE_REQUEST_ID_HEADER]: reservado };
  const res = await proxy(new NextRequest(url, { method: "PATCH", headers }));
  expect(res.headers.get("x-request-id")).toBe(externo);
  expect(res.headers.get(repassado(FINANCIAL_DELETE_REQUEST_ID_HEADER))).toBeNull();
});
