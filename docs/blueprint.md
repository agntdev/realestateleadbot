# RealEstateLeadBot — Bot specification

**Archetype:** crm

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

Collects property leads (name, phone, intent, note) from public users, confirms submissions, notifies owner via Telegram, and provides private lead management UI for the owner to view, mark, and archive leads.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Public users (Telegram)
- Real estate agent/owner

## Success criteria

- User receives confirmation after lead submission
- Owner receives instant Telegram notification for new leads
- Owner can view and modify lead status via /leads command

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with lead submission button
- **/leads** (command, actor: owner, command: /leads) — Access private lead list (owner-only)

## Flows

### Lead submission
_Trigger:_ /start

1. Show purpose + Submit lead button
2. Request name
3. Request phone
4. Request intent (Buy/Rent/Sell/Other)
5. Request note
6. Show confirmation with Edit/Confirm buttons

_Data touched:_ Lead

### Owner lead management
_Trigger:_ /leads

1. Show paginated lead list with status
2. Allow status changes (New/Done)
3. Allow archive/delete actions

_Data touched:_ Lead

## Owner-supplied settings

The OWNER provides these; they are collected in chat and injected into the environment at deploy. Read each one from the environment where it is used (`ctx.env.<KEY>` / `env.<KEY>` on Cloudflare Workers; `process.env.<KEY>` only as a Node/harness fallback — never the sole read). Do NOT invent your own way of learning the value, do NOT ask for it in a bot message, and do NOT hardcode a default.

- **ADMIN_CHAT_ID** — Telegram user ID for lead notifications and management
  - this is the OWNER's own chat id; the platform already knows it. Read `ADMIN_CHAT_ID` via `ctx.env` (prefer toolkit `adminChatId` / `requireOwner`) — never ask a user, never treat whoever writes first as the admin, never invent claim-admin or open manage for everyone.
  - may be UNSET at runtime: the bot must still start, and the feature needing ADMIN_CHAT_ID must say so plainly instead of failing.

Your behavioral specs run WITHOUT these values, so no spec may depend on one.

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

An entity that merely NAMES an owner-supplied setting above (an admin chat, an API account) is not something to store or discover — read it from the environment.

- **Lead** _(retention: persistent)_ — Property lead with status tracking
  - fields: id, name, phone, intent, note, status, timestamp, submitter_telegram_id
- **Owner** _(retention: persistent)_ — Single admin user with access to lead list
  - fields: telegram_id

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- View lead list (/leads)
- Mark lead as New/Done
- Archive/delete leads

## Notifications

- Instant Telegram message to owner for each new lead with action buttons

## Permissions & privacy

- Leads stored persistently with submitter Telegram ID (optional)
- Only owner can access /leads and modify lead status

## Edge cases

- User edits lead after confirmation (restarts collection)
- Owner pagination for >50 leads
- Invalid phone formats (free-text field accepts any input)

## Required tests

- End-to-end lead submission with confirmation workflow
- Owner receives notification with action buttons
- Lead status changes persist across sessions

## Assumptions

- No external CRM integration needed
- Lead editing restarts collection flow
- Default lead list shows last 50 entries
