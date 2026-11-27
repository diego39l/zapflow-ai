-- manifest: Restringe o descarte financeiro à RPC autorizada e reserva sua auditoria transacional.

drop policy if exists tenant_isolation_financial_entries_write on public.financial_entries;
drop policy if exists tenant_isolation_financial_entries_insert on public.financial_entries;
create policy tenant_isolation_financial_entries_insert on public.financial_entries
  for insert to authenticated
  with check (public.fn_is_platform_admin_full() or public.fn_role_at_least(organization_id, 'agent'));
drop policy if exists tenant_isolation_financial_entries_update on public.financial_entries;
create policy tenant_isolation_financial_entries_update on public.financial_entries
  for update to authenticated
  using (public.fn_is_platform_admin_full() or public.fn_role_at_least(organization_id, 'agent'))
  with check (public.fn_is_platform_admin_full() or public.fn_role_at_least(organization_id, 'agent'));

-- DELETE é exclusivamente mediado pela operação auditada para clientes.
revoke delete, truncate on public.financial_entries from public, anon, authenticated, service_role;

create index if not exists financial_entries_reversao_v4d_idx
  on public.financial_entries (reverses_entry_id) where reverses_entry_id is not null;

create or replace function public.fn_v4d_autorizar_descarte(p_org uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_suporte jsonb;
begin
  -- Mesmo escopo da rota atual: a administração de plataforma por si só
  -- não substitui o papel no tenant. O JWT autenticado é a fonte do ator.
  if v_ator is null
     or not coalesce(public.fn_role_at_least(p_org, 'agent'), false)
     or not coalesce(public.fn_org_operante(p_org), false)
     or not coalesce(public.fn_support_write_allowed(p_org), false) then
    raise sqlstate '42501' using message = 'descarte_financeiro_nao_autorizado';
  end if;

  v_suporte := public.fn_support_context();
  if v_suporte is not null and (
       v_suporte->>'access_mode' is distinct from 'full'
       or v_suporte->>'status' is distinct from 'active'
       or v_suporte->>'organization_id' is distinct from p_org::text
     ) then
    raise sqlstate '42501' using message = 'descarte_financeiro_nao_autorizado';
  end if;

  -- mfaEmDivida separa inscrição de prova de sessão. A evidência de
  -- dispositivo confiável só vem de fn_session_mfa_proven.
  -- Um JWT da plataforma não comprova a organização ativa do cookie.
  if not coalesce(public.fn_session_mfa_proven(), false)
     or (v_suporte is null and coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2'
         and exists (select 1 from public.platform_admins pa
                     where pa.user_id=v_ator and pa.revoked_at is null)
         and exists (select 1 from auth.mfa_factors f
                     where f.user_id=v_ator and f.factor_type='totp' and f.status='verified')) then
    raise sqlstate '42501' using message = 'descarte_financeiro_mfa_required';
  end if;

  return v_ator;
end
$$;
revoke execute on function public.fn_v4d_autorizar_descarte(uuid) from public, anon, authenticated, service_role;

create or replace function public.fn_v4d_guard_lancamento()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_honorario boolean;
begin
  if tg_op = 'TRUNCATE' then
    raise sqlstate 'PT409' using message = 'historico_financeiro_protegido';
  end if;

  if tg_op = 'UPDATE' then
    if new.origin is distinct from old.origin
       or new.organization_id is distinct from old.organization_id
       or (old.status = 'paid' and new.status <> 'paid')
       or (old.paid_at is not null and new.paid_at is distinct from old.paid_at)
       or (old.reverses_entry_id is not null and new.reverses_entry_id is distinct from old.reverses_entry_id)
       or (old.origin = 'manual' and (
            (old.sale_id is not null and new.sale_id is distinct from old.sale_id)
            or (old.recurring_entry_id is not null and new.recurring_entry_id is distinct from old.recurring_entry_id)
          )) then
      raise sqlstate 'PT409' using message = 'procedencia_financeira_protegida';
    end if;
    return new;
  end if;

  if old.status <> 'pending' or old.paid_at is not null or old.origin <> 'manual'
     or old.sale_id is not null or old.reverses_entry_id is not null or old.recurring_entry_id is not null
     or exists (select 1 from public.financial_entries f where f.reverses_entry_id = old.id) then
    raise sqlstate 'PT409' using message = 'historico_financeiro_protegido';
  end if;

  -- Honorários é modular. A consulta usa vínculo por ID, mesmo em dados legados
  -- inconsistentes, e nunca depende de uma tabela instalada no QA.
  if pg_catalog.to_regclass('public.honorarios_parcelas') is not null then
    execute 'select exists (select 1 from public.honorarios_parcelas where financial_entry_id = $1)'
      into v_honorario using old.id;
    if v_honorario then
      raise sqlstate 'PT409' using message = 'historico_financeiro_protegido';
    end if;
  end if;
  perform public.fn_v4d_autorizar_descarte(old.organization_id);
  return old;
end
$$;
revoke execute on function public.fn_v4d_guard_lancamento() from public, anon, authenticated, service_role;

drop trigger if exists trg_v4d_lancamento_protegido on public.financial_entries;
create trigger trg_v4d_lancamento_protegido
  before update or delete on public.financial_entries
  for each row execute function public.fn_v4d_guard_lancamento();
drop trigger if exists trg_v4d_lancamento_truncate on public.financial_entries;
create trigger trg_v4d_lancamento_truncate
  before truncate on public.financial_entries
  for each statement execute function public.fn_v4d_guard_lancamento();

create or replace function public.fn_v4d_auditar_descarte()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.api_audit_log
    (organization_id, actor_user_id, acting_as_platform_admin, action, resource_type, resource_id, request_id, bypassed_rls, metadata)
  values (old.organization_id, auth.uid(), public.fn_support_context() is not null, 'financeiro.lancamento_removido',
     'financial_entry', old.id,
    case when pg_catalog.current_setting('jarvis.v4e_request_id', true)
                   ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      then pg_catalog.current_setting('jarvis.v4e_request_id', true) end, true, pg_catalog.jsonb_build_object('amount_cents', old.amount_cents));
  return old;
end
$$;
revoke execute on function public.fn_v4d_auditar_descarte() from public, anon, authenticated, service_role;
drop trigger if exists trg_v4d_lancamento_auditar on public.financial_entries;
create trigger trg_v4d_lancamento_auditar after delete on public.financial_entries
  for each row execute function public.fn_v4d_auditar_descarte();

drop policy if exists audit_log_descarte_financeiro_reservado on public.api_audit_log;
create policy audit_log_descarte_financeiro_reservado
  on public.api_audit_log
  as restrictive
  for insert to anon, authenticated
  with check (action is distinct from 'financeiro.lancamento_removido');

create or replace function public.fn_v4e_descartar_lancamento(p_org uuid, p_lancamento uuid, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_anterior text := pg_catalog.current_setting('jarvis.v4e_request_id', true);
begin
  perform public.fn_v4d_autorizar_descarte(p_org);

  perform 1
    from public.financial_entries f
   where f.id = p_lancamento and f.organization_id = p_org
   for update;
  if not found then
    raise sqlstate 'PT404' using message = 'lancamento_nao_encontrado';
  end if;

  -- O trigger revalida o OLD sob o bloqueio. O lock também serializa a inserção
  -- de referências por FK com o descarte.
  perform pg_catalog.set_config('jarvis.v4e_request_id', coalesce(p_request_id::text, ''), true);
  delete from public.financial_entries where id = p_lancamento and organization_id = p_org;
  if not found then
    raise sqlstate 'PT404' using message = 'lancamento_nao_encontrado';
  end if;
  perform pg_catalog.set_config('jarvis.v4e_request_id', coalesce(v_anterior, ''), true);
  return p_lancamento;
end
$$;
revoke execute on function public.fn_v4e_descartar_lancamento(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- A interface anterior sai da superfície RPC sem remover dependências implicitamente.
drop function if exists public.fn_v4d_descartar_lancamento(uuid, uuid);

grant execute on function public.fn_v4e_descartar_lancamento(uuid, uuid, uuid) to authenticated;
