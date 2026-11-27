-- manifest: Impede excluir organizações com histórico financeiro, preservando seus registros.

create or replace function public.fn_guard_organization_financial_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $guard$
declare
  fonte text;
  tem_historico boolean;
begin
  foreach fonte in array array['sales', 'financial_entries', 'commissions', 'loyalty_ledger']
  loop
    if pg_catalog.to_regclass(pg_catalog.format('public.%I', fonte)) is null then
      continue;
    end if;

    execute pg_catalog.format(
      'select exists (select from public.%I where organization_id = $1)', fonte
    ) into tem_historico using old.id;

    if tem_historico then
      raise exception using
        errcode = 'PT409',
        message = 'organizacao_com_historico_financeiro',
        hint = 'A organização possui histórico financeiro protegido.';
    end if;
  end loop;
  return old;
end;
$guard$;

revoke execute on function public.fn_guard_organization_financial_history()
  from public, anon, authenticated, service_role;

-- A guarda única substitui tanto V4-C quanto a proteção parcial de V4-D.
drop trigger if exists trg_v4d_org_historico on public.organizations;
drop function if exists public.fn_v4d_guard_org();

drop trigger if exists organizations_financial_history_guard on public.organizations;
create trigger organizations_financial_history_guard
before delete on public.organizations
for each row execute function public.fn_guard_organization_financial_history();
