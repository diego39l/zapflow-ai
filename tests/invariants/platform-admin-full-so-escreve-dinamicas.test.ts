/**
 * 0533 — as 9 policies DINÂMICAS da #2115 que a lista de 47 não via.
 *
 * Os laços `format()` de 0350 (`financial_accounts`, `payment_methods`,
 * `account_plans`; with check manager) e 0351 (`sales`, `sale_items`,
 * `commission_rules`, `commissions`, `financial_entries`, `loyalty_ledger`;
 * with check agent) criavam `tenant_isolation_%I_all` com
 * `fn_is_platform_admin()`, que ignora o scope do JWT: `support_readonly`
 * escrevia em dinheiro. A conta global de `platform-admin-full-so-escreve`
 * achou as 9. Viraram o par de `recurring_entries`: `_read` com a pura,
 * `_write` com `_full`.
 *
 * Mede em Postgres REAL:
 *   · CATÁLOGO: cada cláusula de escrita usa `_full` e preserva o escopo
 *     da organização, com `_write` no núcleo legado e políticas por operação
 *     nas tabelas da comanda. `_read` mantém a função de leitura.
 *   · COMPORTAMENTO em `sale_items`: suporte lê, mas não insere, altera ou
 *     exclui item aberto. As mesmas operações passam com `full`.
 *   · COMPORTAMENTO em `financial_accounts`: `support_readonly` lê, faz UPDATE
 *     em 0 linhas; `full` faz em 1 (controle positivo).
 *
 * Previsão escrita antes de rodar (sabotagem): devolvida a pura ao `_write` de
 * um dos laços, o catálogo acusa as tabelas dele; no laço de 0350, a sonda
 * devolve 1 em vez de 0.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { countAs, seedGov, sql, writeCountAs } from "./gov-helpers";

const ORG = "cccccccc-2115-4000-8000-000000000301";
const FULL = "cccccccc-2115-4000-8000-000000000310";
const READONLY = "cccccccc-2115-4000-8000-000000000311";
const CONTA = "cccccccc-2115-4000-8000-000000000302";

const COMANDA = "cccccccc-2115-4000-8000-000000000303";
const ITEM = "cccccccc-2115-4000-8000-000000000304";

const LEGADAS = ["financial_accounts", "payment_methods", "account_plans", "financial_entries"];
const POR_OPERACAO = ["sales", "sale_items", "commission_rules", "commissions", "loyalty_ledger"];

type Policy = {
  policyname: string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
};

function conferirEscrita(clausula: string | null, rotulo: string, papel?: string) {
  expect(clausula, rotulo).toMatch(/\bfn_is_platform_admin_full\(\)/);
  expect(clausula, rotulo).not.toMatch(/\bfn_is_platform_admin\s*\(/);
  if (papel) {
    expect(clausula, rotulo).toMatch(/\bfn_user_org_ids\(\)/);
    expect(clausula, rotulo).toContain(`'${papel}'`);
    expect(clausula, rotulo).toContain("fn_role_at_least(");
  }
}

beforeAll(() => {
  // #1907 — o módulo financeiro INSTALADO antes de medir: as cinco tabelas da comanda
  // (`sales`, `sale_items`, `commission_rules`, `commissions`, `loyalty_ledger`) saíram do
  // `baseline.sql` e as policies dinâmicas de 0351 nascem em `fn_financeiro_provisionar()`
  // (ADR-0002 D2/D3). A chamada é pré-condição da leitura do catálogo.
  sql("select public.fn_financeiro_provisionar();");
  seedGov();
  sql(`
    delete from public.financial_accounts where organization_id = '${ORG}';
    delete from public.organizations where id = '${ORG}';
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'org-2115-din', 'Org 2115 dinâmicas', 'Org 2115 dinâmicas');
    insert into auth.users (id, email) values
      ('${FULL}', 'full-2115-din@invariant.test'),
      ('${READONLY}', 'readonly-2115-din@invariant.test')
    on conflict (id) do nothing;
    delete from public.platform_admins where user_id in ('${FULL}', '${READONLY}');
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason) values
      ('${FULL}', '${FULL}', 'full', false, 'invariante 2115 dinâmicas'),
      ('${READONLY}', '${FULL}', 'support_readonly', false, 'invariante 2115 dinâmicas');
    insert into public.financial_accounts (id, organization_id, name)
      values ('${CONTA}', '${ORG}', 'Conta 2115 dinâmicas');
    insert into public.sales (id, organization_id, number, status)
      values ('${COMANDA}', '${ORG}', 1, 'open');
  `);
});

describe("0533 — support_readonly não escreve nas 9 dinâmicas de 0350/0351", () => {
  it.each([...LEGADAS, ...POR_OPERACAO])(
    "%s mantém leitura e escrita nos escopos previstos",
    (tabela) => {
      const prefixo = `tenant_isolation_${tabela}_`;
      const policies = JSON.parse(
        sql(`
      select coalesce(json_agg(p order by p.policyname), '[]')
        from pg_policies p
       where p.schemaname = 'public' and p.tablename = '${tabela}'
         and p.permissive = 'PERMISSIVE';
    `),
      ) as Policy[];
      expect(
        sql(`select relrowsecurity from pg_class where oid = 'public.${tabela}'::regclass;`),
      ).toBe("t");

      const leitura = policies.find((p) => p.policyname === prefixo + "read");
      expect(leitura).toMatchObject({ cmd: "SELECT", with_check: null });
      expect(leitura?.qual).toMatch(/\bfn_is_platform_admin\(\)/);
      expect(leitura?.qual).toMatch(/\bfn_user_org_ids\(\)/);

      const escrita = policies.filter((p) => p.cmd !== "SELECT");
      if (tabela === "financial_entries") {
        expect(escrita.map((p) => [p.policyname, p.cmd])).toEqual([
          [prefixo + "insert", "INSERT"],
          [prefixo + "update", "UPDATE"],
        ]);
        const [insercao, atualizacao] = escrita as [Policy, Policy];
        expect(insercao.qual).toBeNull();
        for (const clausula of [insercao.with_check, atualizacao.qual, atualizacao.with_check]) {
          expect(clausula).toMatch(/\bfn_is_platform_admin_full\(\)/);
          expect(clausula).not.toMatch(/\bfn_is_platform_admin\s*\(/);
          expect(clausula).toMatch(/fn_role_at_least\(organization_id, 'agent'/);
        }
        expect(sql(`
          select has_table_privilege('authenticated', 'public.financial_entries', 'DELETE')
              or has_table_privilege('service_role', 'public.financial_entries', 'DELETE');
        `)).toBe("f");
        return;
      }
      if (LEGADAS.includes(tabela)) {
        expect(escrita.map((p) => [p.policyname, p.cmd])).toEqual([[prefixo + "write", "ALL"]]);
        const [policy] = escrita as [Policy];
        conferirEscrita(policy.qual, "USING legado");
        expect(policy.qual).toMatch(/\bfn_user_org_ids\(\)/);
        conferirEscrita(
          policy.with_check,
          "WITH CHECK legado",
          tabela === "financial_entries" ? "agent" : "manager",
        );
        return;
      }

      expect(escrita.map((p) => [p.policyname, p.cmd])).toEqual([
        [prefixo + "delete", "DELETE"],
        [prefixo + "insert", "INSERT"],
        [prefixo + "update", "UPDATE"],
      ]);
      const [remocao, insercao, atualizacao] = escrita as [Policy, Policy, Policy];
      expect(insercao.qual).toBeNull();
      expect(remocao.with_check).toBeNull();
      conferirEscrita(insercao.with_check, "INSERT WITH CHECK", "agent");
      conferirEscrita(atualizacao.qual, "UPDATE USING", "agent");
      conferirEscrita(atualizacao.with_check, "UPDATE WITH CHECK", "agent");
      conferirEscrita(remocao.qual, "DELETE USING", tabela === "sales" ? undefined : "agent");

      if (tabela === "sales") {
        expect(remocao.qual).toMatch(/^\(?\s*(public\.)?fn_is_platform_admin_full\(\)\s*\)?$/);
      }
      if (tabela === "sale_items") {
        for (const clausula of [
          insercao.with_check,
          atualizacao.qual,
          atualizacao.with_check,
          remocao.qual,
        ]) {
          expect(clausula).toMatch(/s\.id = sale_items\.sale_id/);
          expect(clausula).toMatch(/s\.organization_id = sale_items\.organization_id/);
        }
        expect(remocao.qual).toMatch(/s\.status = 'open'/);
      }
    },
  );

  it("sale_items: suporte apenas lê e full pode inserir, alterar e excluir item aberto", () => {
    const inserir = `insert into public.sale_items
      (id, organization_id, sale_id, description, quantity, unit_price_cents, total_cents)
      values ('${ITEM}', '${ORG}', '${COMANDA}', 'Item sintético', 1, 100, 100)`;
    const alterar = `update public.sale_items set description = 'Alterado' where id = '${ITEM}'`;
    const excluir = `delete from public.sale_items where id = '${ITEM}'`;
    const contar = `select count(*) from public.sale_items where id = '${ITEM}'`;

    expect(writeCountAs(READONLY, inserir)).toBe(0);
    expect(writeCountAs(FULL, inserir)).toBe(1);
    expect(countAs(READONLY, contar)).toBe(1);
    expect(writeCountAs(READONLY, alterar)).toBe(0);
    expect(writeCountAs(FULL, alterar)).toBe(1);
    expect(writeCountAs(READONLY, excluir)).toBe(0);
    expect(writeCountAs(FULL, excluir)).toBe(1);
    expect(countAs(READONLY, contar)).toBe(0);
  });

  it("financial_accounts: support_readonly LÊ; UPDATE 0 como support_readonly; 1 como full", () => {
    expect(
      countAs(READONLY, `select count(*) from public.financial_accounts where id = '${CONTA}';`),
    ).toBe(1);
    expect(
      writeCountAs(
        READONLY,
        `update public.financial_accounts set name = 'hackeado' where id = '${CONTA}'`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        FULL,
        `update public.financial_accounts set name = 'escrito pelo full' where id = '${CONTA}'`,
      ),
    ).toBe(1);
  });
});
