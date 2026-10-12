# OpenAI setup for CACU

OpenAI is the selected AI provider. CACU uses the OpenAI API through the official, pinned `openai` SDK and Responses API. ChatGPT is the chat product; the application requires an OpenAI Platform project API key and API billing. Do not use a ChatGPT password, session cookie or subscription token.

## Required account and credentials

1. Sign in at [OpenAI Platform](https://platform.openai.com/), create a CACU project and configure API billing. Review the project's model access, usage/spend controls and alerts. Provider alerts alone are not the application's per-user or tenant abuse controls.
2. Create a project API key in [API keys](https://platform.openai.com/api-keys), preferably owned by an application service account with the permissions required for Responses. Store it privately; never paste it into this chat or commit it.
3. Choose a text model available to that project, supporting the Responses API, and record its exact model ID from the [model catalog](https://developers.openai.com/api/docs/models). There is no silent model default/fallback. The adapter uses `max_output_tokens`; model access and token budgets must be checked with the synthetic test rather than assumed from a ChatGPT plan.
4. Add these values to the ignored repository-root `.env`, your requested local configuration source:

```dotenv
OPENAI_API_KEY=your-project-api-key
OPENAI_MODEL=your-approved-model-id
```

Use real values in your private file. `.env.example` contains placeholders only. Existing Gemini/Anthropic keys do not configure this adapter. The old Google default has been replaced; it does not serve as a fallback.

## Vercel setup

In the **Next.js frontend project**, open Settings → Environment Variables. Add `OPENAI_API_KEY` as a server-only secret and `OPENAI_MODEL` for the intended Preview/Production environment. Never use `NEXT_PUBLIC_OPENAI_API_KEY`. Use separate staging and production keys/projects where appropriate. Do not put these keys in the Python accounting/upload backend for this integration.

Vercel does not obtain local `.env` values merely because the repository contains `.env.example`; populate deployment settings privately and redeploy the reviewed commit. Next.js local `.env.local` or shell variables can override `.env`; remove stale overrides if the configured model/key appears unchanged. No environment values or hosted deployment were changed by this implementation.

## Verify configuration and connectivity

From `C:\Users\olayiwolao\CACU_NEW`:

```powershell
npm.cmd run ai:check
```

This checks configuration presence/placeholders only, without a network call or displaying the key. Once API billing/model access are configured, run:

```powershell
npm.cmd run ai:check -- --live
```

The explicit `--live` test sends one synthetic request, may incur API charges, and sends no CACU records. It prints only success/failure. Missing configuration, inaccessible models, expired/revoked keys, billing limits and network errors must be resolved in the relevant account settings. The application transport bounds requests to 4,000 characters for each prompt/instructions, 1,000 output tokens, a 20-second timeout, zero automatic retries and 8,000 output characters. Model reasoning can consume output-token budget; incomplete responses fail closed. Limits are operational defaults, not commercial plan entitlements.

Requests use `store:false`, no provider conversation ID, tools, automatic actions or browser DOM text. This reduces Responses application-state storage; it does **not** establish Zero Data Retention or remove all provider abuse-monitoring retention. Review [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) before authorizing business data.

## General-guidance activation

A follow-up now connects the transport to an authenticated general-guidance action with shared PostgreSQL request limits and an isolated chat UI. Follow [guarded AI chat staging setup](guarded-ai-chat.md) for the migration, database approved-model/enabled setting, server `CACU_AI_ENABLED` switch and acceptance tests. Missing credentials or database settings still prevent live use. No activation was performed here.

Only the verified business category is supplied as tenant context. No financial or employee records or page text are read, and each question is independent. HR documents and accounting-policy drafts remain unavailable; financial analysis, commercial AI quotas and paid eligibility remain pending separate review. Provider selection and chat code are implemented, while live account/setup/acceptance and rollout still require the external steps above.

Sources: [OpenAI developer quickstart](https://developers.openai.com/api/docs/quickstart), [text generation](https://developers.openai.com/api/docs/guides/text), [production setup](https://developers.openai.com/api/docs/guides/production-best-practices).

Validation: 94 frontend tests passed after adding the adapter, plus the two operator checks passed in the targeted suite; TypeScript and focused lint passed. Provider calls were mocked. The production build passed. Live connectivity remains unverified until private configuration is supplied.
