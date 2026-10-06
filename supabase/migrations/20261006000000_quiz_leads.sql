-- Respostas do quiz de qualificação (qualificacao/index.html).
-- O site não grava direto aqui: ele chama a Edge Function `quiz-lead`,
-- que valida, salva com a service role e envia o contato ao GoHighLevel.

create table if not exists public.quiz_leads (
  id                      uuid primary key default gen_random_uuid(),
  created_at              timestamptz not null default now(),

  -- contato
  nome                    text not null,
  email                   text not null,
  telefone                text not null,

  -- qualificação
  perfil                  text not null,  -- Incorporadora / Loteadora / Imobiliária / Corretor autônomo
  trabalha_planta         text,           -- só para Imobiliária
  empresa                 text,
  momento                 text,
  vgv                     text,
  time_marketing          text,
  qualificado             boolean not null,
  motivo_desqualificacao  text,
  score                   int not null default 0,
  temperatura             text not null,  -- quente / morno / frio / desqualificado

  -- origem
  utm_source              text,
  utm_medium              text,
  utm_campaign            text,
  utm_content             text,
  utm_term                text,
  referrer                text,

  -- integração GoHighLevel
  ghl_contact_id          text,
  ghl_status              text            -- ok / sem_credenciais / erro: ...
);

create index if not exists quiz_leads_created_at_idx on public.quiz_leads (created_at desc);

-- RLS ligado e sem políticas: ninguém acessa pela chave pública.
-- Só a Edge Function (service role) e o painel do Supabase leem e gravam.
alter table public.quiz_leads enable row level security;
