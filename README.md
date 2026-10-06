# Quiz de Qualificação — Digital Moon

Quiz para qualificar incorporadoras, loteadoras e imobiliárias que querem um plano de marketing para o lançamento. As respostas são salvas no Supabase e o contato é criado no GoHighLevel com a tag `novo lead quiz`.

## Estrutura

| Arquivo | O que é |
|---|---|
| `index.html` | O quiz (página única, sem build) |
| `logo.png` | Logo da Digital Moon |
| `supabase/migrations/` | Cria a tabela `quiz_leads` |
| `supabase/functions/quiz-lead/` | Edge Function que valida, salva e envia ao GoHighLevel |

## Fluxo do quiz

1. Nome
2. E-mail
3. WhatsApp
4. Em qual desses você se encaixa? (Incorporadora / Loteadora / Imobiliária / Corretor autônomo)
   - **Corretor autônomo** → desqualificado
   - **Imobiliária** → pergunta extra: trabalha com imóveis na planta?
     - Só usados ou de terceiros → desqualificado
5. Nome da empresa
6. Momento do lançamento
7. VGV
8. Estrutura do time de marketing

Leads qualificados veem o botão "Chamar no WhatsApp". Desqualificados veem uma tela de agradecimento.

A pontuação (momento + VGV + time, máx. 70) define a temperatura: **quente** ≥ 50, **morno** ≥ 30, **frio** abaixo disso.

## Como colocar no ar

### 1. Supabase

Com a [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase link --project-ref <id-do-projeto>
supabase db push
supabase functions deploy quiz-lead --no-verify-jwt
```

A função roda com `--no-verify-jwt` porque é chamada pelo site público; ela valida os dados por conta própria.

### 2. GoHighLevel

1. Em **Settings → Private Integrations**, crie uma integração com permissão de ler e escrever contatos e de ler campos personalizados. Copie o token.
2. Copie o **Location ID** da subconta.
3. No Supabase, em **Edge Functions → Secrets**, cadastre:
   - `GHL_TOKEN`: o token da integração
   - `GHL_LOCATION_ID`: o ID da subconta
   - `ALLOWED_ORIGIN` (opcional): o domínio do quiz, ex.: `https://quiz.digitalmoonbr.com`
4. (Opcional) Crie campos personalizados de contato com estas chaves para ter as respostas em campos próprios:
   `quiz_perfil`, `quiz_trabalha_planta`, `quiz_momento`, `quiz_vgv`, `quiz_time_marketing`, `quiz_qualificado`, `quiz_motivo_desqualificacao`, `quiz_temperatura`, `quiz_score`.
   Sem eles, as respostas ficam numa nota no contato.

Cada lead chega ao GHL com as tags `novo lead quiz`, `quiz qualificado` ou `quiz desqualificado`, e `quiz quente` / `quiz morno` / `quiz frio`. Use o gatilho **"Tag adicionada"** nas automações.

### 3. Site

No topo do `<script>` em `index.html`, preencha:

```js
const CONFIG = {
  supabaseUrl: 'https://wdadntbtxnreknkwiajp.supabase.co',
  whatsapp: '5512981125332'
};
```

Enquanto `supabaseUrl` estiver vazio, o quiz roda em **modo prévia**: mostra um selo no topo e não envia nada.

O site é estático: pode ser publicado no GitHub Pages, Vercel, Netlify ou na hospedagem atual.

## Onde ver as respostas

- **Supabase** → Table Editor → `quiz_leads`: todas as respostas, a temperatura, a origem (UTMs) e o status do envio ao GHL (`ghl_status`).
- **GoHighLevel** → no contato: tags, nota com as respostas e campos personalizados.
