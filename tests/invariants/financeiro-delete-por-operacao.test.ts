import { beforeAll, describe, expect, it } from "vitest";

import { countAs, seedGov, sql, writeCountAs } from "./gov-helpers";

const ORG_A = "d1000000-0000-4000-8000-000000000001";
const ORG_B = "d1000000-0000-4000-8000-000000000002";
const AGENT_A = "d1000000-0000-4000-8000-000000000010";
const VIEWER_B = "d1000000-0000-4000-8000-000000000011";
const AGENT_B = "d1000000-0000-4000-8000-000000000012";
const PLATFORM_FULL = "d1000000-0000-4000-8000-000000000013";
const SUPPORT_READONLY = "d1000000-0000-4000-8000-000000000014";
const SUPPORT_SESSION = "d1000000-0000-4000-8000-000000000015";
const PAYMENT_B = "d1000000-0000-4000-8000-000000000020";

const SALE_B_VIEWER = "d1000000-0000-4000-8000-000000000101";
const SALE_B_AGENT = "d1000000-0000-4000-8000-000000000102";
const SALE_B_FINAL = "d1000000-0000-4000-8000-000000000103";
const SALE_B_PLATFORM = "d1000000-0000-4000-8000-000000000104";
const SALE_B_SUPPORT = "d1000000-0000-4000-8000-000000000105";
const ITEM_B_VIEWER = "d1000000-0000-4000-8000-000000000201";
const ITEM_B_AGENT = "d1000000-0000-4000-8000-000000000202";
const ITEM_B_FINAL = "d1000000-0000-4000-8000-000000000203";
const ITEM_B_PLATFORM = "d1000000-0000-4000-8000-000000000204";
const ITEM_B_SUPPORT = "d1000000-0000-4000-8000-000000000205";

function claimsForSupport(): string {
  return `{"sub":"${SUPPORT_READONLY}","session_id":"${SUPPORT_SESSION}","aal":"aal1"}`;
}

function deleteCountWithSupportClaims(itemId: string): number {
  const out = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '${claimsForSupport()}', false);
    with deleted as (
      delete from public.sale_items where id = '${itemId}' returning 1
    ) select count(*) from deleted;
  `);
  const value = out.split("\n").at(-1);
  if (!value || !/^\d+$/.test(value)) throw new Error(`unexpected psql output: ${out}`);
  return Number(value);
}

function countWithSupportClaims(itemId: string): number {
  const out = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '${claimsForSupport()}', false);
    select count(*) from public.sale_items where id = '${itemId}';
  `);
  const value = out.split("\n").at(-1);
  if (!value || !/^\d+$/.test(value)) throw new Error(`unexpected psql output: ${out}`);
  return Number(value);
}

beforeAll(() => {
  seedGov();
  sql("select public.fn_financeiro_provisionar();");
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values
        ('${ORG_A}', 'financeiro-rls-a', 'Financeiro RLS A', 'Financeiro A'),
        ('${ORG_B}', 'financeiro-rls-b', 'Financeiro RLS B', 'Financeiro B')
      on conflict (id) do nothing;
    insert into auth.users (id, email) values
      ('${AGENT_A}', 'financeiro-agent-a@invariant.test'),
      ('${VIEWER_B}', 'financeiro-viewer-b@invariant.test'),
      ('${AGENT_B}', 'financeiro-agent-b@invariant.test'),
      ('${PLATFORM_FULL}', 'financeiro-platform-full@invariant.test'),
      ('${SUPPORT_READONLY}', 'financeiro-support-readonly@invariant.test')
      on conflict (id) do nothing;
    insert into public.user_organizations (organization_id, user_id, role, accepted_at) values
      ('${ORG_A}', '${AGENT_A}', 'agent', now()),
      ('${ORG_B}', '${VIEWER_B}', 'viewer', now()),
      ('${ORG_B}', '${AGENT_B}', 'agent', now())
      on conflict do nothing;
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason) values
      ('${PLATFORM_FULL}', '${PLATFORM_FULL}', 'full', false, 'invariante financeiro'),
      ('${SUPPORT_READONLY}', '${PLATFORM_FULL}', 'full', false, 'invariante financeiro support')
      on conflict (user_id) do update set revoked_at = null, scope = 'full', mfa_required = false;
    insert into auth.sessions (id, user_id, aal)
      values ('${SUPPORT_SESSION}', '${SUPPORT_READONLY}', 'aal1')
      on conflict (id) do nothing;
    insert into public.payment_methods (id, organization_id, name)
      values ('${PAYMENT_B}', '${ORG_B}', 'Forma sintética RLS')
      on conflict (id) do nothing;

    insert into public.sales (id, organization_id, number, status, payment_method_id, finalized_at)
      values
        ('${SALE_B_VIEWER}', '${ORG_B}', 9101, 'open', null, null),
        ('${SALE_B_AGENT}', '${ORG_B}', 9102, 'open', null, null),
        ('${SALE_B_FINAL}', '${ORG_B}', 9103, 'finalized', '${PAYMENT_B}', now()),
        ('${SALE_B_PLATFORM}', '${ORG_B}', 9104, 'open', null, null),
        ('${SALE_B_SUPPORT}', '${ORG_B}', 9105, 'open', null, null)
      on conflict (id) do nothing;
    insert into public.sale_items (id, organization_id, sale_id, description, quantity, unit_price_cents, total_cents)
      values
        ('${ITEM_B_VIEWER}', '${ORG_B}', '${SALE_B_VIEWER}', 'item viewer sintético', 1, 100, 100),
        ('${ITEM_B_AGENT}', '${ORG_B}', '${SALE_B_AGENT}', 'item agent sintético', 1, 100, 100),
        ('${ITEM_B_FINAL}', '${ORG_B}', '${SALE_B_FINAL}', 'item finalizado sintético', 1, 100, 100),
        ('${ITEM_B_PLATFORM}', '${ORG_B}', '${SALE_B_PLATFORM}', 'item plataforma sintético', 1, 100, 100),
        ('${ITEM_B_SUPPORT}', '${ORG_B}', '${SALE_B_SUPPORT}', 'item suporte sintético', 1, 100, 100)
      on conflict (id) do nothing;

    select public.fn_start_support(
      '${SUPPORT_READONLY}', '${SUPPORT_SESSION}', '${ORG_B}', null, 'support_readonly', 3600
    );
  `);
});

describe("RLS financeiro: escrita por operação e organização", () => {
  it("viewer não exclui item da própria organização", () => {
    expect(writeCountAs(VIEWER_B, `delete from public.sale_items where id = '${ITEM_B_VIEWER}'`)).toBe(0);
    expect(countAs(VIEWER_B, `select count(*) from public.sale_items where id = '${ITEM_B_VIEWER}'`)).toBe(1);
  });

  it("agent de A não lê nem exclui item conhecido de B", () => {
    expect(countAs(AGENT_A, `select count(*) from public.sale_items where id = '${ITEM_B_AGENT}'`)).toBe(0);
    expect(writeCountAs(AGENT_A, `delete from public.sale_items where id = '${ITEM_B_AGENT}'`)).toBe(0);
    expect(countAs(AGENT_B, `select count(*) from public.sale_items where id = '${ITEM_B_AGENT}'`)).toBe(1);
  });

  it("agent autorizado exclui item de comanda aberta", () => {
    expect(writeCountAs(AGENT_B, `delete from public.sale_items where id = '${ITEM_B_AGENT}'`)).toBe(1);
    expect(countAs(AGENT_B, `select count(*) from public.sale_items where id = '${ITEM_B_AGENT}'`)).toBe(0);
  });

  it("item de comanda finalizada não pode ser excluído diretamente", () => {
    expect(writeCountAs(AGENT_B, `delete from public.sale_items where id = '${ITEM_B_FINAL}'`)).toBe(0);
    expect(countAs(AGENT_B, `select count(*) from public.sale_items where id = '${ITEM_B_FINAL}'`)).toBe(1);
  });

  it("platform_admin_full mantém acesso autorizado a item aberto", () => {
    expect(writeCountAs(PLATFORM_FULL, `delete from public.sale_items where id = '${ITEM_B_PLATFORM}'`)).toBe(1);
    expect(countAs(PLATFORM_FULL, `select count(*) from public.sale_items where id = '${ITEM_B_PLATFORM}'`)).toBe(0);
  });

  it("support_readonly continua lendo e não exclui", () => {
    expect(countWithSupportClaims(ITEM_B_SUPPORT)).toBe(1);
    expect(deleteCountWithSupportClaims(ITEM_B_SUPPORT)).toBe(0);
    expect(countWithSupportClaims(ITEM_B_SUPPORT)).toBe(1);
  });

  it("não aceita item cuja organization_id não corresponda à comanda", () => {
    const itemId = "d1000000-0000-4000-8000-000000000299";
    expect(
      writeCountAs(
        AGENT_A,
        `insert into public.sale_items (id, organization_id, sale_id, description, quantity, unit_price_cents, total_cents) values ('${itemId}', '${ORG_A}', '${SALE_B_VIEWER}', 'vínculo cruzado sintético', 1, 100, 100)`,
      ),
    ).toBe(0);
  });
});
