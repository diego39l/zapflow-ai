import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requireSupportWrite: vi.fn(),
  moduloLigado: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  audit: vi.fn(),
  filters: [] as Array<[string, unknown]>,
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: deps.requireRole }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: deps.requireSupportWrite }));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: deps.moduloLigado }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: deps.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: deps.createClient }));
vi.mock("@/lib/audit", () => ({ audit: deps.audit }));

import { DELETE } from "./route";

const ORG_A = "a1000000-0000-4000-8000-000000000001";
const ORG_B = "b1000000-0000-4000-8000-000000000001";
const SALE_A = "a1000000-0000-4000-8000-000000000002";
const SALE_B = "b1000000-0000-4000-8000-000000000002";
const ITEM_B = "b1000000-0000-4000-8000-000000000003";

function request(): Request {
  return new Request("http://localhost/api/v1/financeiro/comandas/item", { method: "DELETE" });
}

describe("DELETE item de comanda — escopo da organização autorizada", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deps.filters.length = 0;
    deps.moduloLigado.mockResolvedValue(true);
    deps.requireSupportWrite.mockResolvedValue(null);
    deps.requireRole.mockResolvedValue({
      ok: true,
      user: { id: "agent-org-a" },
      org: { orgId: ORG_A },
    });
    deps.createAdminClient.mockReturnValue({});
    deps.createClient.mockResolvedValue({
      from: (table: string) => {
        const filters: Array<[string, unknown]> = [];
        const query = {
          select: () => query,
          delete: () => query,
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            deps.filters.push([column, value]);
            return query;
          },
          maybeSingle: async () => {
            const organization = filters.find(([column]) => column === "organization_id")?.[1];
            const id = filters.find(([column]) => column === "id")?.[1];
            if (table === "sales") {
              if (organization === ORG_A && id === SALE_A) {
                return { data: { id: SALE_A, status: "open", number: 13 }, error: null };
              }
              if (organization === ORG_A) return { data: null, error: null };
              return { data: { id: SALE_B, status: "open", number: 14 }, error: null };
            }
            if (organization === ORG_A) return { data: null, error: null };
            return { data: { id: ITEM_B }, error: null };
          },
        };
        return query;
      },
    });
  });

  it("não resolve a comanda B quando o guard autorizou A", async () => {
    const response = await DELETE(request() as never, {
      params: Promise.resolve({ id: SALE_B, itemId: ITEM_B }),
    });

    expect(response.status).toBe(404);
    expect(deps.filters).toContainEqual(["organization_id", ORG_A]);
    expect(deps.audit).not.toHaveBeenCalled();
  });

  it("não exclui item B anexado a uma rota com organização A", async () => {
    const response = await DELETE(request() as never, {
      params: Promise.resolve({ id: SALE_A, itemId: ITEM_B }),
    });

    expect(response.status).toBe(404);
    expect(deps.filters.filter(([column, value]) => column === "organization_id" && value === ORG_A)).toHaveLength(2);
    expect(deps.audit).not.toHaveBeenCalled();
    expect(ORG_A).not.toBe(ORG_B);
  });
});
