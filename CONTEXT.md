# Imagia - Project Context

## What Is Imagia
AI-powered app builder (like replit.com) that generates code from natural language, deploys it to Railway, and generates a full marketing suite (landing pages, social posts, ad copy, email templates, video demos). Includes social media management and LLM instrumentation/cost tracking.

## Architecture
- **Monorepo** with npm workspaces: `packages/backend`, `packages/frontend`, `packages/shared`
- **Backend**: Express 5, PostgreSQL (Knex.js), Redis, Bull queues, SSE progress streaming
- **Frontend**: React 19 + Vite + Tailwind CSS + React Router v7
- **Auth**: Clerk (JWT verification, webhook sync)
- **LLM Strategy**: Multi-model routing via `llmRouter.js`
  - Claude Sonnet (Anthropic) for code generation/iteration
  - Llama 3.3 70B (Fireworks) for scaffolding/config
  - GPT-4o (OpenAI) for marketing copy
  - Each provider has circuit breaker + retry + 2-layer cache
- **Deployment**: Railway (monorepo - web serves frontend + API, worker runs Bull queues, managed Postgres + Redis). Auto-deploys from GitHub `main` branch.
- **Domain Routing**: Cloudflare DNS (wildcard `*.imagia.net`) + Cloudflare Worker (`imagia-proxy`) + Workers KV for subdomain→Railway URL routing. User apps get auto-assigned `<slug>.imagia.net` subdomains. Custom domains via Cloudflare for SaaS (Custom Hostnames API).
- **Cost Tracking**: `costTracker.js` tracks LLM, deployment, storage, and marketing costs per-project
- **Patterns from Pikto repo**: Circuit breakers (opossum), exponential backoff retry, L1/L2 caching, SSE via Redis pub/sub, Winston structured logging, Sentry error tracking, correlation IDs

## Key Design Decisions
- **Chat-first UX**: Users describe apps in chat, code generated behind scenes, code viewable but editing is secondary
- **Secrets Management**: Secret detector scans prompts for env var references, prompts user in a separate secure input box, secrets are encrypted (AES-256-GCM) and NEVER sent to LLMs
- **Per-app context.md**: Each project stores a `context_md` field that summarizes app state, tech stack, key files, and known issues - read at start of each build session to maintain continuity
- **Full instrumentation**: Every LLM call logged to `prompt_logs` table with provider, model, tokens, cost, latency. Deployment and storage costs tracked separately via `costTracker.js`. Per-project cost breakdown in projects.cost_breakdown JSONB field.
- **GitHub integration**: Users can import repos, push generated code, pull latest changes, create new repos
- **File attachments**: Chat supports image/audio/video uploads via multer + message_attachments table

## Database (PostgreSQL)
15 migrations:
1. `users` - Clerk-synced with github_access_token
2. `projects` - Apps with status, cost_breakdown JSONB, deployment info, context_md, GitHub fields
3. `project_versions` - Snapshots at each iteration
4. `project_files` - Generated code files
5. `conversations` + `messages` - Chat history per project
6. `prompt_logs` - Full LLM instrumentation
7. `project_secrets` - Encrypted secrets per project
8. `message_attachments` - File attachments for chat messages (image/audio/video)
9. `deployments` - Railway deployment history with cost tracking
10. `marketing_assets` - Generated marketing collateral (screenshots, video, landing page, social, ads, emails)
11. `github_connections` - GitHub repo links per project with sync status
12. `llm_usage_daily` - Aggregated daily LLM metrics per user/provider/model
13. `social_accounts` - OAuth connections for Twitter, LinkedIn, Instagram, Facebook
14. `scheduled_posts` - Social media posts with scheduling, engagement tracking
15. `project_domains` - Domain assignments (auto subdomains + custom domains) with Cloudflare IDs and SSL status

## Current State (All 5 Phases Complete)

### Phase 1 (Foundation) - DONE
- Backend: server.js, config/, middleware/, db/migrations/ (7), routes/ (8), services/ (8), queues/ (5), utils/ (5)
- Frontend: Vite + React + Tailwind + Clerk, Layout, Dashboard, placeholder pages
- Shared: constants, validation schemas

### Phase 2 (Core App Builder) - DONE
- Prompt templates: appScaffold.js, codeGeneration.js, codeIteration.js
- codeGeneratorService.js, appBuilderService.js (913 lines)
- buildWorker.js with SSE progress
- useChat.js hook with attachments support
- ProjectBuilder.jsx with chat UI, file viewer, secrets, file uploads, delete project with confirmation
- **Multi-engine preview system** (`packages/frontend/src/utils/previewEngines/`):
  - `detectEngine.js` - Detects project type from `app_type` + file analysis, monorepo detection (scans for frontend subdirectories, returns `filePrefix` for path stripping)
  - `reactEngine.js` - In-browser React preview: strips imports, rewrites exports, collects npm deps via esm.sh import maps, transpiles with Babel standalone + Tailwind CDN, renders in iframe. Handles const/let→var dedup, shimmed packages (react-router-dom, next/*), TypeScript type stripping, cross-package identifier dedup
  - `staticEngine.js` - Static HTML preview: finds index.html, inlines local `<link>` CSS and `<script>` JS, adds error boundary
  - `expressEngine.js` - API docs preview: extracts Express routes via regex, parses package.json, generates styled HTML with color-coded HTTP methods, dependency list, file tree
  - `index.js` - Public API: `buildPreview(project, fileList)` → `{ html, engine, engineLabel }`. Fallback chain: React → Static → Express
  - Engine badge colors in PreviewTab toolbar: React (sky), Static (emerald), Express (violet)

### Phase 3 (Deployment + GitHub + Marketing) - DONE
- **Railway deployment**: `railwayService.js` (GraphQL API - create project/service, deploy, poll status, generate domain, custom domains), `deployWorker.js` (Bull worker with 7 stages, SSE progress, auto-assigns `*.imagia.net` subdomain via Cloudflare KV, auto-triggers marketing gen), `routes/deployments.js` (queue deploy, status, history, logs, custom domain, costs)
- **Cloudflare integration**: `cloudflareService.js` (Workers KV for subdomain routing, DNS records, Custom Hostnames for user custom domains), `routes/domains.js` (list domains, add/remove custom domain, SSL status, verify)
- **GitHub integration**: `githubService.js` (Octokit - OAuth, importRepo, pushToGitHub, pullFromGitHub, createRepo, syncStatus; smart-sort import prioritizes frontend files (src/, pages/, components/, JSX) over backend, 200-file limit), `routes/github.js` (connect, callback, list repos, import, push, pull, create-repo, sync-status, disconnect)
- **Screenshot/Video**: `screenshotService.js` (Playwright - desktop full page, mobile, multi-state), `videoService.js` (Playwright video recording with step-by-step demo)
- **Marketing pipeline**: `marketingWorker.js` (generates screenshots, video demo, landing page, social posts for 4 platforms, ad copy for 3 platforms, email templates for 3 types), `routes/marketing.js` (generate, list/get/delete assets, regenerate)
- **Cost tracking**: `costTracker.js` (tracks deployment, compute, storage, LLM costs per-project, user-level cost summary with daily trends)
- **Marketing prompts**: `utils/prompts/marketing.js` (landing page, social posts, ad copy, email templates, demo script)
- **Frontend**: Deploy button in ProjectBuilder header, Domains tab (auto-subdomain display, add/remove custom domains, SSL status), GitHub push/pull/create-repo modal, Marketing Studio page with asset grid/filter/preview/regenerate
- **Routes mounted**: `/api/deployments`, `/api/github`, `/api/marketing`, `/api/domains`

### Phase 4 (Analytics + Prompt History) - DONE
- **Migration 012**: `llm_usage_daily` table - aggregated daily metrics per user/provider/model with upsert
- **Usage Aggregator**: `usageAggregator.js` - hourly cron rolls up `prompt_logs` into `llm_usage_daily`, supports backfill
- **Enhanced Prompts API**: `GET /prompts` now supports search (prompt/response text), model filter, status filter, date range, configurable sorting. `GET /prompts/filters` returns distinct providers/models/task_types/statuses
- **Enhanced Analytics API**: `GET /analytics/llm-costs/by-model` (per-model breakdown with error/cache counts), `GET /analytics/usage-daily` (aggregated daily from llm_usage_daily)
- **Analytics Dashboard**: Full page with summary cards (total cost, requests, tokens, latency), full cost breakdown (LLM + deployment + storage), daily trend bar chart, by-model table, by-provider/task breakdown, time range selector (7d/30d/90d/1y)
- **Prompt History Page**: Paginated table with sortable columns, expandable detail view (full prompt/response/system message/metrics), search, multi-filter (provider/model/task/status), pagination with page numbers

### Phase 5 (Social Media Management) - DONE
- **Migrations 013-014**: `social_accounts` (OAuth tokens encrypted via AES-256-GCM, platform metadata, status tracking) + `scheduled_posts` (content, media_urls, scheduling, engagement JSONB, platform_post_id)
- **socialService.js**: OAuth URL generation + token exchange for Twitter/LinkedIn/Instagram/Facebook, platform profile fetching, token refresh, post publishing via platform APIs (circuit breaker wrapped), engagement polling, content validation with per-platform character limits
- **socialQueue.js**: Bull queue config for social jobs
- **socialWorker.js**: Full implementation with `publish` (post to platform API), `fetch-engagement` (poll metrics), `check-scheduled` (recurring every-minute cron finds due posts and queues them)
- **routes/social.js**: OAuth authorize/callback, GET/DELETE accounts, POST/GET/PATCH/DELETE posts, POST publish, POST engagement refresh, POST validate, GET platforms
- **SocialHub.jsx**: 3-tab layout (Compose, Post Queue, Accounts). Compose: account selector, content textarea with char counter, project picker, datetime scheduler, publish now / schedule / save draft. Post Queue: filterable paginated list with platform badges, status pills, engagement stats, publish/delete actions. Accounts: connected accounts with metadata/followers, OAuth connect buttons for 4 platforms, disconnect.
- **api.js**: 12 new social functions (getSocialPlatforms, getSocialAccounts, getSocialOAuthUrl, socialOAuthCallback, disconnectSocialAccount, createSocialPost, getSocialPosts, updateSocialPost, deleteSocialPost, publishSocialPost, refreshEngagement, validateSocialContent)
- **Environment**: Added TWITTER_CLIENT_ID/SECRET, LINKEDIN_CLIENT_ID/SECRET, FACEBOOK_APP_ID/SECRET, SOCIAL_OAUTH_CALLBACK_URL to config + .env.example
- **Route mounted**: `/api/social`

## Production Infrastructure
- **Railway**: Web service (Express API + frontend SPA), Worker service (all Bull queues), managed PostgreSQL, managed Redis. Auto-deploys from `main` branch via GitHub integration.
- **Cloudflare**: DNS for `imagia.net` (wildcard `*.imagia.net`), Worker `imagia-proxy` proxies traffic to Railway with KV-based routing, free SSL via wildcard cert. Custom domains via Cloudflare for SaaS.
- **Clerk**: Production mode on `clerk.imagia.net` / `accounts.imagia.net`. Webhook at `/api/auth/webhook`.
- **Domain**: https://imagia.net (Cloudflare Worker → Railway)

## Environment Variables Needed
See `.env.example` for full list. Priority: CLERK keys, DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY, FIREWORKS_API_KEY, OPENAI_API_KEY, SECRETS_ENCRYPTION_KEY (32-byte hex), RAILWAY_API_TOKEN, GITHUB_CLIENT_ID + SECRET, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID, CLOUDFLARE_KV_NAMESPACE_ID, TWITTER_CLIENT_ID + SECRET, LINKEDIN_CLIENT_ID + SECRET, FACEBOOK_APP_ID + SECRET

## File Count
~150 source files across 3 packages
