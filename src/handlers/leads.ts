import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem, requireOwner } from "../toolkit/index.js";

type Intent = "Buy" | "Rent" | "Sell" | "Other";
type LeadStatus = "New" | "Done";
interface Lead { id: string; name: string; phone: string; intent: Intent; note: string; status: LeadStatus; timestamp: string; submitter_telegram_id?: number; }
interface LeadDraft { name?: string; phone?: string; intent?: Intent; note?: string; }
type LeadSession = { leadStep?: "name" | "phone" | "note" | "confirm"; leadDraft?: LeadDraft };
interface LeadStoreStub { fetch(input: string, init?: { method?: string; body?: string }): Promise<Response>; }
interface LeadStoreEnv { CHAT_DO?: { idFromName(name: string): unknown; get(id: unknown): LeadStoreStub }; }

const composer = new Composer<Ctx>();
registerMainMenuItem({ label: "Submit a lead", data: "lead:start", order: 10 });

function state(ctx: Ctx): LeadSession { return ctx.session as LeadSession; }
let now = (): Date => new Date();
/** Test seam for timestamp creation; production uses the wall clock. */
export function setLeadClockForTests(clock: () => Date): void { now = clock; }
function clock(): string { return now().toISOString(); }
function makeId(): string { return crypto.randomUUID(); }
function storeFor(ctx: Ctx): LeadStoreStub | undefined {
  const namespace = (ctx as Ctx & { env?: LeadStoreEnv }).env?.CHAT_DO;
  return namespace?.get(namespace.idFromName("real-estate-leads"));
}
async function storeRequest<T>(ctx: Ctx, path: string, init?: { method?: string; body?: string }): Promise<T | undefined> {
  const store = storeFor(ctx);
  if (!store) return undefined;
  try {
    const response = await store.fetch(`https://lead-store${path}`, init);
    if (!response.ok) return undefined;
    const body = (await response.json()) as { ok: boolean; value?: T };
    return body.ok ? body.value : undefined;
  } catch { return undefined; }
}
async function createLead(ctx: Ctx, lead: Lead): Promise<boolean> { return (await storeRequest<boolean>(ctx, "/leads", { method: "POST", body: JSON.stringify(lead) })) === true; }
async function listLeads(ctx: Ctx, page: number): Promise<{ items: Lead[]; total: number } | undefined> { return storeRequest(ctx, `/leads?page=${page}&size=50`); }
async function updateLead(ctx: Ctx, id: string, action: "new" | "done" | "archive"): Promise<boolean> { return (await storeRequest<boolean>(ctx, `/leads/${encodeURIComponent(id)}/${action}`, { method: "POST" })) === true; }
function clearDraft(ctx: Ctx): void { delete state(ctx).leadStep; delete state(ctx).leadDraft; }
function backKeyboard() { return inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]); }
function cancelKeyboard() { return inlineKeyboard([[inlineButton("Cancel", "lead:cancel")]]); }
function intentKeyboard() { return inlineKeyboard([[inlineButton("Buy", "lead:intent:Buy"), inlineButton("Rent", "lead:intent:Rent")], [inlineButton("Sell", "lead:intent:Sell"), inlineButton("Other", "lead:intent:Other")], [inlineButton("Cancel", "lead:cancel")]]); }
function confirmationKeyboard() { return inlineKeyboard([[inlineButton("Confirm", "lead:confirm"), inlineButton("Edit", "lead:edit")], [inlineButton("Cancel", "lead:cancel")]]); }
function leadSummary(draft: Required<LeadDraft>): string { return `Review your lead:\nName: ${draft.name}\nPhone: ${draft.phone}\nIntent: ${draft.intent}\nNote: ${draft.note}`; }
async function askForName(ctx: Ctx, edit: boolean): Promise<void> { state(ctx).leadStep = "name"; state(ctx).leadDraft = {}; if (edit) await ctx.editMessageText("What’s your name?", { reply_markup: cancelKeyboard() }); else await ctx.reply("What’s your name?", { reply_markup: cancelKeyboard() }); }

composer.callbackQuery("lead:start", async (ctx) => { await ctx.answerCallbackQuery(); await askForName(ctx, true); });
composer.callbackQuery("lead:cancel", async (ctx) => { await ctx.answerCallbackQuery(); clearDraft(ctx); await ctx.editMessageText("Lead submission cancelled.", { reply_markup: backKeyboard() }); });
composer.callbackQuery(/^lead:intent:(Buy|Rent|Sell|Other)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const s = state(ctx);
  if (s.leadStep !== "phone" || !s.leadDraft) { await ctx.editMessageText("That draft is no longer available. Start a new lead from the menu.", { reply_markup: backKeyboard() }); return; }
  s.leadDraft.intent = ctx.match[1] as Intent; s.leadStep = "note";
  await ctx.editMessageText("Add a short note about the property or timing.", { reply_markup: cancelKeyboard() });
});
composer.callbackQuery("lead:edit", async (ctx) => { await ctx.answerCallbackQuery(); await askForName(ctx, true); });
composer.on("message:text", async (ctx, next) => {
  const s = state(ctx); const value = ctx.message.text.trim();
  if (!s.leadStep || !value) return next();
  if (s.leadStep === "name") { s.leadDraft = { name: value }; s.leadStep = "phone"; await ctx.reply("What phone number should the agent use?", { reply_markup: cancelKeyboard() }); return; }
  if (s.leadStep === "phone") { if (!s.leadDraft) { clearDraft(ctx); await ctx.reply("That draft is no longer available. Start a new lead from the menu.", { reply_markup: backKeyboard() }); return; } s.leadDraft.phone = value; await ctx.reply("What are you looking to do?", { reply_markup: intentKeyboard() }); return; }
  if (s.leadStep === "note") { const draft = s.leadDraft; if (!draft?.name || !draft.phone || !draft.intent) { clearDraft(ctx); await ctx.reply("That draft is no longer available. Start a new lead from the menu.", { reply_markup: backKeyboard() }); return; } draft.note = value; s.leadStep = "confirm"; await ctx.reply(leadSummary(draft as Required<LeadDraft>), { reply_markup: confirmationKeyboard() }); return; }
  return next();
});
composer.callbackQuery("lead:confirm", async (ctx) => {
  await ctx.answerCallbackQuery(); const s = state(ctx); const draft = s.leadDraft;
  if (s.leadStep !== "confirm" || !draft?.name || !draft.phone || !draft.intent || !draft.note) { await ctx.editMessageText("That draft is no longer available. Start a new lead from the menu.", { reply_markup: backKeyboard() }); return; }
  const lead: Lead = { id: makeId(), name: draft.name, phone: draft.phone, intent: draft.intent, note: draft.note, status: "New", timestamp: clock(), submitter_telegram_id: ctx.from?.id };
  if (!(await createLead(ctx, lead))) { await ctx.editMessageText("Lead storage isn’t available right now. Please try again shortly.", { reply_markup: confirmationKeyboard() }); return; }
  clearDraft(ctx); await ctx.editMessageText("Your lead has been sent. The agent will be in touch.", { reply_markup: backKeyboard() });
  const owner = adminChatId(ctx as never); if (!owner) return;
  try { await ctx.api.sendMessage(owner, `New property lead\nName: ${lead.name}\nPhone: ${lead.phone}\nIntent: ${lead.intent}\nNote: ${lead.note}`, { reply_markup: leadActions(lead) }); } catch { /* saved leads remain valid if Telegram notification fails */ }
});

function leadActions(lead: Lead) { const action = lead.status === "Done" ? "new" : "done"; return inlineKeyboard([[inlineButton(lead.status === "Done" ? "Mark new" : "Mark done", `leads:${action}:${lead.id}`)], [inlineButton("Archive", `leads:archive:${lead.id}`)]]); }
function leadListText(items: Lead[], page: number, total: number): string { if (total === 0) return "No leads yet — new enquiries will appear here."; const first = page * 50 + 1; return `Leads ${first}–${first + items.length - 1} of ${total}\n\n${items.map((lead, i) => `${first + i}. ${lead.name} — ${lead.intent} (${lead.status})`).join("\n")}`; }
function listKeyboard(items: Lead[], page: number, total: number) { const rows = items.map((lead) => [inlineButton(`${lead.name} · ${lead.status}`, `leads:view:${lead.id}`)]); const nav = []; if (page > 0) nav.push(inlineButton("Previous", `leads:page:${page - 1}`)); if ((page + 1) * 50 < total) nav.push(inlineButton("Next", `leads:page:${page + 1}`)); if (nav.length) rows.push(nav); return inlineKeyboard(rows); }
async function showLeads(ctx: Ctx, page: number, edit: boolean): Promise<void> { const result = await listLeads(ctx, page); if (!result) { const message = "Lead storage isn’t available right now. Please try again shortly."; if (edit) await ctx.editMessageText(message, { reply_markup: backKeyboard() }); else await ctx.reply(message, { reply_markup: backKeyboard() }); return; } const body = leadListText(result.items, page, result.total); if (edit) await ctx.editMessageText(body, { reply_markup: listKeyboard(result.items, page, result.total) }); else await ctx.reply(body, { reply_markup: listKeyboard(result.items, page, result.total) }); }
composer.command("leads", async (ctx) => { if (!(await requireOwner(ctx as never))) return; await showLeads(ctx, 0, false); });
composer.callbackQuery(/^leads:page:(\d+)$/, async (ctx) => { if (!(await requireOwner(ctx as never))) return; await ctx.answerCallbackQuery(); await showLeads(ctx, Number(ctx.match[1]), true); });
composer.callbackQuery(/^leads:view:([\w-]+)$/, async (ctx) => { if (!(await requireOwner(ctx as never))) return; await ctx.answerCallbackQuery(); const lead = await storeRequest<Lead>(ctx, `/leads/${encodeURIComponent(ctx.match[1])}`); if (!lead) { await ctx.editMessageText("That lead is no longer available.", { reply_markup: backKeyboard() }); return; } const action = lead.status === "Done" ? "new" : "done"; await ctx.editMessageText(`Name: ${lead.name}\nPhone: ${lead.phone}\nIntent: ${lead.intent}\nNote: ${lead.note}\nStatus: ${lead.status}`, { reply_markup: inlineKeyboard([[inlineButton(lead.status === "Done" ? "Mark new" : "Mark done", `leads:${action}:${lead.id}`)], [inlineButton("Archive", `leads:archive:${lead.id}`)], [inlineButton("Back to leads", "leads:page:0")]]) }); });
composer.callbackQuery(/^leads:archive:([\w-]+)$/, async (ctx) => { if (!(await requireOwner(ctx as never))) return; await ctx.answerCallbackQuery(); await ctx.editMessageText("Archive this lead? You can’t restore it here.", { reply_markup: inlineKeyboard([[inlineButton("Archive lead", `leads:archiveconfirm:${ctx.match[1]}`)], [inlineButton("Keep lead", "leads:page:0")]]) }); });
composer.callbackQuery(/^leads:(done|new|archiveconfirm):([\w-]+)$/, async (ctx) => { if (!(await requireOwner(ctx as never))) return; await ctx.answerCallbackQuery(); const action = ctx.match[1] === "archiveconfirm" ? "archive" : ctx.match[1] as "new" | "done"; if (!(await updateLead(ctx, ctx.match[2], action))) { await ctx.editMessageText("That change couldn’t be saved. Please try again.", { reply_markup: backKeyboard() }); return; } await ctx.editMessageText(action === "archive" ? "Lead archived." : `Lead marked ${action === "done" ? "done" : "new"}.`, { reply_markup: inlineKeyboard([[inlineButton("Back to leads", "leads:page:0")]]) }); });

export default composer;
