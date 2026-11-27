-- manifest: Corrige as policies do módulo financeiro por operação, valida vínculo da comanda na organização do item e impede DELETE de item em comanda fechada.
-- Não edita a migration 0619. A provisionadora atualizada é reaplicável e a
-- correção abaixo só roda quando o módulo já existe.

create or replace function public.fn_financeiro_guard_sale_item_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $guard$
declare v_status text;
begin
  -- A cascata da remoção de uma organização/comanda é responsabilidade da FK.
  if pg_trigger_depth() > 1 then return old; end if;
  select s.status into v_status
    from public.sales s
   where s.id = old.sale_id and s.organization_id = old.organization_id
   for update;
  if not found or v_status <> 'open' then
    raise exception using errcode = '42501', message = 'sale_item_delete_requires_open_sale';
  end if;
  return old;
end
$guard$;
revoke execute on function public.fn_financeiro_guard_sale_item_delete() from public, anon, authenticated, service_role;

create or replace function public.fn_financeiro_provisionar()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
-- ─── a comanda ───────────────────────────────────────────────────────────────
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Número visível, por organização. `bigint` e não `serial`: a sequência é
  -- própria de cada tenant (ver `fn_proximo_numero_de_comanda`), e um serial
  -- global vazaria o volume de um cliente para outro.
  number bigint not null,

  contact_id uuid references public.contacts(id) on delete set null,
  -- Quem atendeu. `set null` porque a pessoa pode sair da equipe e a venda
  -- continua tendo acontecido.
  attendant_user_id uuid references auth.users(id) on delete set null,
  appointment_id uuid references public.calendar_appointments(id) on delete set null,

  status text not null default 'open'
    check (status in ('open', 'finalized', 'cancelled')),

  -- Desconto da COMANDA, separado do desconto de item. Fidelidade e comissão
  -- incidem sobre o item, nunca sobre este — senão um desconto de caixa
  -- reduziria o prêmio de quem atendeu.
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  total_cents bigint not null default 0,
  currency text not null default 'BRL' check (char_length(currency) = 3),

  payment_method_id uuid references public.payment_methods(id) on delete restrict,

  notes text,
  finalized_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  -- Estornada: a comanda continua finalizada e ganha o contra-lançamento.
  reversed_at timestamptz,
  reverse_reason text,

  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Finalizar exige forma de pagamento: é ela que diz em que conta o dinheiro
  -- cai. Sem isso, a entrada não teria destino — e o CHECK diz isso no schema,
  -- não numa validação que alguém pode esquecer de chamar.
  constraint sales_finalizada_tem_forma
    check (status <> 'finalized' or payment_method_id is not null)
);

create unique index if not exists sales_org_numero_key on public.sales (organization_id, number);
create index if not exists sales_org_status_idx on public.sales (organization_id, status, created_at desc);
create index if not exists sales_org_contato_idx on public.sales (organization_id, contact_id);
create index if not exists sales_appointment_idx on public.sales (appointment_id)
  where appointment_id is not null;

-- ─── o item ──────────────────────────────────────────────────────────────────
create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- `cascade` aqui e só aqui: item não existe fora da comanda, e comanda não é
  -- apagada (cancela). O cascade só dispara se a ORGANIZAÇÃO inteira sair.
  sale_id uuid not null references public.sales(id) on delete cascade,

  -- O que foi feito. `event_type_id` porque, neste produto, o catálogo de
  -- serviços JÁ é `calendar_event_types` — criar uma tabela de serviços ao lado
  -- seria a segunda fonte da mesma verdade.
  event_type_id uuid references public.calendar_event_types(id) on delete restrict,
  -- Congelado na inclusão: o nome muda, a linha da venda não.
  description text not null,

  attendant_user_id uuid references auth.users(id) on delete set null,

  quantity integer not null default 1 check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  total_cents bigint not null,

  -- ⚠️ RESOLVIDA NA INCLUSÃO e gravada aqui. A finalização não recalcula:
  -- mudar a regra amanhã não mexe no que já foi combinado ontem.
  commission_percent numeric(5, 2) not null default 0
    check (commission_percent >= 0 and commission_percent <= 100),

  created_at timestamptz not null default now()
);

create index if not exists sale_items_sale_idx on public.sale_items (sale_id);
create index if not exists sale_items_org_idx on public.sale_items (organization_id, created_at desc);

-- ─── a regra de comissão ─────────────────────────────────────────────────────
--
-- Precedência: (pessoa + serviço) → (pessoa) → (serviço). A mais específica
-- vence, e é por isso que as três colunas são nullable com um índice único por
-- combinação — não há linha "curinga" mágica, há ausência.
create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  attendant_user_id uuid references auth.users(id) on delete cascade,
  event_type_id uuid references public.calendar_event_types(id) on delete cascade,

  percent numeric(5, 2) not null check (percent >= 0 and percent <= 100),

  created_at timestamptz not null default now(),

  -- Pelo menos um dos dois: uma regra sem pessoa E sem serviço seria a regra
  -- "de tudo", que é o default da organização e mora em outro lugar.
  constraint commission_rules_tem_alvo
    check (attendant_user_id is not null or event_type_id is not null)
);

-- `coalesce` no índice: NULL não colide com NULL numa UNIQUE, e sem isto duas
-- regras "só para a Ana" passariam as duas, em silêncio.
create unique index if not exists commission_rules_alvo_key on public.commission_rules (
  organization_id,
  coalesce(attendant_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(event_type_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

-- ─── a comissão gerada ───────────────────────────────────────────────────────
create table if not exists public.commissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_item_id uuid not null references public.sale_items(id) on delete cascade,
  attendant_user_id uuid not null references auth.users(id) on delete restrict,

  percent numeric(5, 2) not null,
  amount_cents bigint not null,

  status text not null default 'pending' check (status in ('pending', 'paid', 'reversed')),
  paid_at timestamptz,
  reversed_at timestamptz,

  created_at timestamptz not null default now()
);

create unique index if not exists commissions_item_key on public.commissions (sale_item_id);
create index if not exists commissions_org_pessoa_idx
  on public.commissions (organization_id, attendant_user_id, status);

-- ─── o livro-razão da fidelidade ─────────────────────────────────────────────
--
-- LEDGER, não saldo. O saldo do cliente é `sum(points)` e nunca uma coluna:
-- guardar o saldo faria o primeiro estorno divergir em silêncio.
create table if not exists public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,

  -- Assinado: ganhar é positivo, resgatar é negativo. Uma coluna de "tipo" ao
  -- lado seria a segunda forma de dizer o mesmo sinal.
  points integer not null,
  reason text not null,

  sale_id uuid references public.sales(id) on delete set null,
  sale_item_id uuid references public.sale_items(id) on delete set null,

  -- Idempotência do ganho: finalizar a mesma comanda duas vezes não dá ponto
  -- em dobro. A UNIQUE parcial é a garantia, não a boa intenção de quem chama.
  idempotency_key text,

  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists loyalty_ledger_idem_key
  on public.loyalty_ledger (organization_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists loyalty_ledger_contato_idx
  on public.loyalty_ledger (organization_id, contact_id, created_at desc);
-- 0354 — a regra de comissão entra no catálogo, e para isso INATIVA em vez de
-- sumir: o percentual já aplicado está congelado no item, então apagar perderia
-- a resposta a "por que aquela comanda saiu com este percentual".
alter table public.commission_rules
  add column if not exists name text not null default 'Regra de comissão';

alter table public.commission_rules
  add column if not exists is_active boolean not null default true;

comment on column public.commission_rules.is_active is
  'Regra em vigor. Inativa em vez de apagar: o percentual já aplicado está congelado no item, e o que se perderia é a resposta a "por que aquela comanda saiu com este percentual".';

create index if not exists commission_rules_org_ativas_idx
  on public.commission_rules (organization_id, event_type_id, attendant_user_id)
  where is_active;

-- 0352 — uma comanda por agendamento. PARCIAL nas duas condições: comanda avulsa
-- é a maioria e não se exclui de comanda de agendamento, e comanda cancelada
-- deixa de valer (sem isto, cancelar por engano trancaria o agendamento para
-- sempre, sem conserto pela tela).
create unique index if not exists sales_agendamento_unico_idx
  on public.sales (organization_id, appointment_id)
  where appointment_id is not null and status <> 'cancelled';

-- Os comentários das tabelas da comanda moram AQUI, e não no bloco do RLS do
-- núcleo: `comment on table` no baseline recriaria as tabelas num banco onde o
-- módulo não está instalado — que é exatamente o que a D2 proíbe.
comment on table public.sales is
  'A comanda. Cancela, nunca apaga. `number` é sequencial por organização e não reinicia.';
comment on table public.loyalty_ledger is
  'Livro-razão de fidelidade. O saldo do cliente é sum(points) — NUNCA uma coluna.';

-- A FK que o caixa perdeu (`financial_entries.sale_id → sales.id`, `on delete set
-- null`) SAIU do corpo desta função: `financial_entries` é tabela do NÚCLEO, e o
-- molde da onda 10 (`tests/invariants/provisionadora-de-modulo.test.ts`) não deixa
-- o corpo de uma provisionadora alterar tabela do núcleo — a regra é o inverso,
-- "FK do módulo para o núcleo", e vale para a FK nascer na tabela do módulo
-- (`sale_items.sale_id → sales.id` está aqui embaixo).
--
-- A criação dela agora é rotina própria, `fn_financeiro_ligar_caixa_a_comanda()`,
-- definida no fim desta migration: a provisionadora CHAMA a rotina (a FK continua
-- nascendo no provisionamento) e o topo também, já na passada do kit onde a
-- comanda já existe. Em ambos, o `not exists` passou a olhar QUALQUER FK de
-- `financial_entries.sale_id → sales` em vez de um nome fixo — a 0351 trazia
-- `financeiro_sale_id_fkey` e a main traz `financial_entries_sale_id_fkey`, e
-- conferir um nome só criaria a segunda FK (item 5 do PR #1907).

  -- ── RLS das cinco tabelas, declarada por ESTA função (#1906 + D5) ──────────
  -- A rotina 0325 (`fn_proteger_tabelas_de_organizacao`) só enxerga tabela com
  -- RLS DESLIGADA: ligando aqui a decisão do módulo prevalece, e o `revoke` de
  -- `anon` vem junto porque é a MESMA rotina que o faria — se ela não enxerga a
  -- tabela, ela não faz por nós.
  --
  -- Cada `create policy` deste corpo ocupa DUAS linhas de propósito (issue
  -- #1906): a conferência antiga do `update.sh` (v1.39.0 a v1.63.0) casava o
  -- nome da policy e o `on public.` na MESMA linha e abortava a atualização
  -- de quem tem o módulo instalado. É a quebra entre as duas linhas que tira
  -- a regra do olhar daquela varredura sem tirar a regra da tabela.
  --
  -- A versão anterior usava policies `_write FOR ALL`: o papel `agent+`
  -- aparecia em WITH CHECK, que não autoriza DELETE. Agora cada operação tem
  -- policy própria, com USING/WITH CHECK coerentes, vínculo sale-item/comanda
  -- na mesma organização e remoção de item limitada a comanda aberta.
  alter table public.sales enable row level security;
  revoke all on public.sales from anon;
  drop policy if exists tenant_isolation_sales_all on public.sales;
  drop policy if exists tenant_isolation_sales_read on public.sales;
  create policy tenant_isolation_sales_read
  on public.sales for select
    using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
  drop policy if exists tenant_isolation_sales_write on public.sales;
  drop policy if exists tenant_isolation_sales_insert on public.sales;
  create policy tenant_isolation_sales_insert
  on public.sales for insert
    with check ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))));
  drop policy if exists tenant_isolation_sales_update on public.sales;
  create policy tenant_isolation_sales_update
  on public.sales for update
    using ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))))
    with check ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))));
  drop policy if exists tenant_isolation_sales_delete on public.sales;
  create policy tenant_isolation_sales_delete
  on public.sales for delete
    using (public.fn_is_platform_admin_full());
  alter table public.sale_items enable row level security;
  revoke all on public.sale_items from anon;
  drop policy if exists tenant_isolation_sale_items_all on public.sale_items;
  drop policy if exists tenant_isolation_sale_items_read on public.sale_items;
  create policy tenant_isolation_sale_items_read
  on public.sale_items for select
    using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
  drop policy if exists tenant_isolation_sale_items_write on public.sale_items;
  drop policy if exists tenant_isolation_sale_items_insert on public.sale_items;
  create policy tenant_isolation_sale_items_insert
  on public.sale_items for insert
    with check ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))) and exists (select 1 from public.sales s where s.id = sale_items.sale_id and s.organization_id = sale_items.organization_id));
  drop policy if exists tenant_isolation_sale_items_update on public.sale_items;
  create policy tenant_isolation_sale_items_update
  on public.sale_items for update
    using ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))) and exists (select 1 from public.sales s where s.id = sale_items.sale_id and s.organization_id = sale_items.organization_id))
    with check ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))) and exists (select 1 from public.sales s where s.id = sale_items.sale_id and s.organization_id = sale_items.organization_id));
  drop policy if exists tenant_isolation_sale_items_delete on public.sale_items;
  create policy tenant_isolation_sale_items_delete
  on public.sale_items for delete
    using ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))) and exists (select 1 from public.sales s where s.id = sale_items.sale_id and s.organization_id = sale_items.organization_id and s.status = 'open'));
  alter table public.commission_rules enable row level security;
  revoke all on public.commission_rules from anon;
  drop policy if exists tenant_isolation_commission_rules_all on public.commission_rules;
  drop policy if exists tenant_isolation_commission_rules_read on public.commission_rules;
  create policy tenant_isolation_commission_rules_read
  on public.commission_rules for select
    using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
  drop policy if exists tenant_isolation_commission_rules_write on public.commission_rules;
  drop policy if exists tenant_isolation_commission_rules_insert on public.commission_rules;
  create policy tenant_isolation_commission_rules_insert
  on public.commission_rules for insert
    with check ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))));
  drop policy if exists tenant_isolation_commission_rules_update on public.commission_rules;
  create policy tenant_isolation_commission_rules_update
  on public.commission_rules for update
    using ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))))
    with check ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))));
  drop policy if exists tenant_isolation_commission_rules_delete on public.commission_rules;
  create policy tenant_isolation_commission_rules_delete
  on public.commission_rules for delete
    using ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))));
  alter table public.commissions enable row level security;
  revoke all on public.commissions from anon;
  drop policy if exists tenant_isolation_commissions_all on public.commissions;
  drop policy if exists tenant_isolation_commissions_read on public.commissions;
  create policy tenant_isolation_commissions_read
  on public.commissions for select
    using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
  drop policy if exists tenant_isolation_commissions_write on public.commissions;
  drop policy if exists tenant_isolation_commissions_insert on public.commissions;
  create policy tenant_isolation_commissions_insert
  on public.commissions for insert
    with check ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))));
  drop policy if exists tenant_isolation_commissions_update on public.commissions;
  create policy tenant_isolation_commissions_update
  on public.commissions for update
    using ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))))
    with check ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))));
  drop policy if exists tenant_isolation_commissions_delete on public.commissions;
  create policy tenant_isolation_commissions_delete
  on public.commissions for delete
    using ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))));
  alter table public.loyalty_ledger enable row level security;
  revoke all on public.loyalty_ledger from anon;
  drop policy if exists tenant_isolation_loyalty_ledger_all on public.loyalty_ledger;
  drop policy if exists tenant_isolation_loyalty_ledger_read on public.loyalty_ledger;
  create policy tenant_isolation_loyalty_ledger_read
  on public.loyalty_ledger for select
    using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
  drop policy if exists tenant_isolation_loyalty_ledger_write on public.loyalty_ledger;
  drop policy if exists tenant_isolation_loyalty_ledger_insert on public.loyalty_ledger;
  create policy tenant_isolation_loyalty_ledger_insert
  on public.loyalty_ledger for insert
    with check ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))));
  drop policy if exists tenant_isolation_loyalty_ledger_update on public.loyalty_ledger;
  create policy tenant_isolation_loyalty_ledger_update
  on public.loyalty_ledger for update
    using ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))))
    with check ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))));
  drop policy if exists tenant_isolation_loyalty_ledger_delete on public.loyalty_ledger;
  create policy tenant_isolation_loyalty_ledger_delete
  on public.loyalty_ledger for delete
    using ((public.fn_is_platform_admin_full() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'agent'))));

  -- Serializa o DELETE com a finalização e revalida o estado após obter lock.
  drop trigger if exists sale_items_delete_only_open on public.sale_items;
  create trigger sale_items_delete_only_open
    before delete on public.sale_items
    for each row execute function public.fn_financeiro_guard_sale_item_delete();

  -- D5: a proteção na MESMA transação. Sem esta linha a tabela nasce com a anon
  -- key podendo ler tudo — `baseline.sql:4748` dá, por
  -- `alter default privileges`, privilégio total a `anon` no que nasce depois.
  perform public.fn_proteger_modulo_provisionado();

  -- ── A comanda alcançada por SEÇÃO, não por passo escrito na cascata ────────
  -- `notes`, `cancel_reason` e `reverse_reason` são texto da pessoa, e a comanda
  -- é alcançada por `contact_id`. O que a D8 (migration 0485) cobra é a SEÇÃO
  -- declarada em `modulo_secoes_lgpd`: daí em diante a redação acontece no
  -- gatilho `trg_lgpd_secoes_de_modulo`, nos DOIS caminhos de anonimização (a
  -- cascata e a virada `is_anonymized` de `fn_lgpd_anonymize_contact`), e sem o
  -- núcleo nomear `sales` — o `update sales set` fixo saiu da cascata por isto.
  perform public.fn_financeiro_declarar_secoes_lgpd();

  -- A FK do caixa, que o molde não deixa o corpo criar (núcleo alterando núcleo):
  -- sai daqui para a rotina própria que a migration define no fim, com o mesmo
  -- guarda de `to_regclass` e a conferência de qualquer FK já existente.
  perform public.fn_financeiro_ligar_caixa_a_comanda();
end
$f$;
revoke execute on function public.fn_financeiro_provisionar() from public, anon, authenticated;
grant execute on function public.fn_financeiro_provisionar() to service_role;

comment on function public.fn_financeiro_provisionar() is
  'Provisiona o módulo financeiro/comanda de forma idempotente; aplica RLS por operação e protege a remoção de itens de comandas abertas.';

do $financeiro$
begin
  if to_regclass('public.sales') is not null
     and to_regclass('public.sale_items') is not null
     and exists (select 1 from public.modulos_instalados where modulo = 'financeiro') then
    perform public.fn_financeiro_provisionar();
  end if;
end
$financeiro$;
