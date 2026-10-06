// Recebe as respostas do quiz, salva em public.quiz_leads e cria/atualiza
// o contato no GoHighLevel com a tag "novo lead quiz".
//
// Secrets (Supabase → Edge Functions → Secrets):
//   GHL_TOKEN        Private Integration Token do GoHighLevel
//   GHL_LOCATION_ID  ID da subconta (location) no GoHighLevel
//   ALLOWED_ORIGIN   (opcional) domínio do quiz, ex.: https://digitalmoonbr.com
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm prontos no ambiente.

import { createClient } from "npm:@supabase/supabase-js@2";

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const TAG_NOVO_LEAD = "novo lead quiz";

// Opções aceitas em cada pergunta de múltipla escolha, com a pontuação de cada uma.
const OPTIONS: Record<string, Record<string, number>> = {
  perfil: {
    "Incorporadora": 0,
    "Loteadora": 0,
    "Imobiliária": 0,
    "Corretor autônomo": 0,
  },
  trabalha_planta: {
    "Sim, principalmente na planta": 0,
    "Planta e usados": 0,
    "Não, só usados/terceiros": 0,
  },
  momento: {
    "Sim, estamos em lançamento": 30,
    "Em pré-lançamento": 30,
    "Lançamos nos próximos 6 meses": 20,
    "Não no momento": 5,
  },
  vgv: {
    "Abaixo de R$ 20 milhões": 5,
    "R$ 20 a 50 milhões": 12,
    "R$ 50 a 100 milhões": 20,
    "R$ 100 a 300 milhões": 27,
    "Acima de R$ 300 milhões": 30,
  },
  time_marketing: {
    "Time próprio": 8,
    "Terceirizado": 10,
    "Ambos": 10,
  },
};

const LABELS: Record<string, string> = {
  perfil: "Perfil",
  trabalha_planta: "Trabalha com imóveis na planta",
  empresa: "Empresa",
  momento: "Momento do lançamento",
  vgv: "VGV",
  time_marketing: "Time de marketing",
};

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const str = (v: unknown, max = 160) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

function temperatura(score: number, qualificado: boolean) {
  if (!qualificado) return "desqualificado";
  if (score >= 50) return "quente";
  if (score >= 30) return "morno";
  return "frio";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  // Honeypot: bots preenchem o campo escondido. Responde ok e descarta.
  if (str(body.website)) return json({ ok: true });

  // ── Validação ──────────────────────────────────────────────────────────────
  const nome = str(body.nome, 120);
  const email = str(body.email, 160)?.toLowerCase() ?? null;
  const digits = String(body.telefone ?? "").replace(/\D/g, "");
  if (!nome || nome.length < 2) return json({ error: "nome inválido" }, 400);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "e-mail inválido" }, 400);
  if (digits.length < 10 || digits.length > 11) return json({ error: "telefone inválido" }, 400);

  const answers: Record<string, string | null> = { empresa: str(body.empresa) };
  for (const key of Object.keys(OPTIONS)) {
    const v = str(body[key]);
    if (v !== null && !(v in OPTIONS[key])) return json({ error: `${key} inválido` }, 400);
    answers[key] = v;
  }
  if (!answers.perfil) return json({ error: "perfil obrigatório" }, 400);

  // A regra de desqualificação é decidida aqui, não no navegador.
  let motivo: string | null = null;
  if (answers.perfil === "Corretor autônomo") motivo = "Corretor autônomo";
  else if (answers.perfil === "Imobiliária" && answers.trabalha_planta === "Não, só usados/terceiros") {
    motivo = "Imobiliária sem imóveis na planta";
  }
  const qualificado = motivo === null;
  if (qualificado) {
    for (const key of ["empresa", "momento", "vgv", "time_marketing"]) {
      if (!answers[key]) return json({ error: `${key} obrigatório` }, 400);
    }
    if (answers.perfil === "Imobiliária" && !answers.trabalha_planta) {
      return json({ error: "trabalha_planta obrigatório" }, 400);
    }
  }

  const score = qualificado
    ? (["momento", "vgv", "time_marketing"] as const)
      .reduce((sum, k) => sum + (answers[k] ? OPTIONS[k][answers[k]!] : 0), 0)
    : 0;
  const temp = temperatura(score, qualificado);

  const row = {
    nome,
    email,
    telefone: digits,
    perfil: answers.perfil,
    trabalha_planta: answers.perfil === "Imobiliária" ? answers.trabalha_planta : null,
    empresa: answers.empresa,
    momento: answers.momento,
    vgv: answers.vgv,
    time_marketing: answers.time_marketing,
    qualificado,
    motivo_desqualificacao: motivo,
    score,
    temperatura: temp,
    utm_source: str(body.utm_source),
    utm_medium: str(body.utm_medium),
    utm_campaign: str(body.utm_campaign),
    utm_content: str(body.utm_content),
    utm_term: str(body.utm_term),
    referrer: str(body.referrer, 500),
  };

  // ── Supabase ───────────────────────────────────────────────────────────────
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: saved, error: dbError } = await db.from("quiz_leads").insert(row).select("id").single();
  if (dbError) {
    console.error("insert quiz_leads", dbError);
    return json({ error: "não foi possível salvar" }, 500);
  }

  // ── GoHighLevel ────────────────────────────────────────────────────────────
  let ghlStatus = "ok";
  let ghlContactId: string | null = null;
  try {
    ghlContactId = await sendToGhl(row);
    if (!ghlContactId) ghlStatus = "sem_credenciais";
  } catch (err) {
    console.error("ghl", err);
    ghlStatus = `erro: ${String(err).slice(0, 300)}`;
  }
  await db.from("quiz_leads").update({ ghl_contact_id: ghlContactId, ghl_status: ghlStatus }).eq("id", saved.id);

  // O lead já está salvo; uma falha no GHL não deve travar a pessoa no quiz.
  return json({ ok: true });
});

type Row = Record<string, string | number | boolean | null>;

async function ghl(path: string, init: RequestInit = {}) {
  const res = await fetch(`${GHL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${Deno.env.get("GHL_TOKEN")}`,
      Version: GHL_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

// Campos personalizados do GHL que o quiz preenche, se existirem na subconta.
// Crie-os em Settings → Custom Fields com estas chaves (fieldKey "contact.<chave>").
const GHL_FIELDS: Record<string, (r: Row) => string | number | null> = {
  quiz_perfil: (r) => r.perfil as string,
  quiz_trabalha_planta: (r) => r.trabalha_planta as string | null,
  quiz_momento: (r) => r.momento as string | null,
  quiz_vgv: (r) => r.vgv as string | null,
  quiz_time_marketing: (r) => r.time_marketing as string | null,
  quiz_qualificado: (r) => (r.qualificado ? "Sim" : "Não"),
  quiz_motivo_desqualificacao: (r) => r.motivo_desqualificacao as string | null,
  quiz_temperatura: (r) => r.temperatura as string,
  quiz_score: (r) => r.score as number,
};

async function sendToGhl(row: Row): Promise<string | null> {
  const locationId = Deno.env.get("GHL_LOCATION_ID");
  if (!Deno.env.get("GHL_TOKEN") || !locationId) return null;

  // Mapeia as chaves acima para os IDs dos campos personalizados da subconta.
  const customFields: { id: string; field_value: string | number }[] = [];
  try {
    const { customFields: defs = [] } = await ghl(`/locations/${locationId}/customFields?model=contact`);
    for (const def of defs as { id: string; fieldKey: string }[]) {
      const key = def.fieldKey?.replace(/^contact\./, "");
      const value = key && GHL_FIELDS[key]?.(row);
      if (value !== undefined && value !== null && value !== "") customFields.push({ id: def.id, field_value: value });
    }
  } catch (err) {
    console.warn("ghl custom fields", err); // segue sem campos personalizados; a nota cobre
  }

  const [firstName, ...rest] = String(row.nome).split(/\s+/);
  const { contact } = await ghl("/contacts/upsert", {
    method: "POST",
    body: JSON.stringify({
      locationId,
      firstName,
      lastName: rest.join(" ") || undefined,
      name: row.nome,
      email: row.email,
      phone: `+55${row.telefone}`,
      companyName: row.empresa || undefined,
      source: "Quiz Digital Moon",
      ...(customFields.length ? { customFields } : {}),
    }),
  });

  // Tags num passo separado: o endpoint de tags só adiciona, sem apagar as que o contato já tem.
  const tags = [TAG_NOVO_LEAD, row.qualificado ? "quiz qualificado" : "quiz desqualificado", `quiz ${row.temperatura}`];
  await ghl(`/contacts/${contact.id}/tags`, { method: "POST", body: JSON.stringify({ tags }) });

  // Nota com todas as respostas, visível no contato mesmo sem campos personalizados.
  const lines = [
    "Respostas do quiz de qualificação",
    "",
    ...Object.keys(LABELS).filter((k) => row[k]).map((k) => `${LABELS[k]}: ${row[k]}`),
    "",
    `Qualificado: ${row.qualificado ? "Sim" : `Não (${row.motivo_desqualificacao})`}`,
    `Temperatura: ${row.temperatura} (${row.score} pts)`,
    ...(row.utm_source ? [`Origem: ${[row.utm_source, row.utm_medium, row.utm_campaign].filter(Boolean).join(" / ")}`] : []),
  ];
  await ghl(`/contacts/${contact.id}/notes`, { method: "POST", body: JSON.stringify({ body: lines.join("\n") }) });

  return contact.id as string;
}
