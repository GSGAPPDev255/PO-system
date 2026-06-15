/**
 * poll-mailbox: Admin-only, single-mailbox poll for the Admin Panel.
 *
 * Lets an admin TEST or FORCE-POLL one specific mailbox on demand — without
 * touching the global email-intake cron and without affecting other mailboxes.
 *
 * Body: { mailbox_id: string, dry_run?: boolean }
 *   - dry_run = true  → classify + report what WOULD happen. Does NOT create
 *                       POs, download attachments, or mark anything read.
 *   - dry_run = false → full processing identical to email-intake (creates POs
 *                       for genuine new invoices, marks messages read).
 *
 * Unlike the cron, this polls the mailbox even if it is Paused (is_active=false)
 * so you can test a mailbox before switching it on.
 *
 * Self-contained — no _shared imports (MCP bundler limitation).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── MS Graph ──────────────────────────────────────────────────────────────────
let _cachedToken: { token: string; expiresAt: number } | null = null;

async function getGraphToken(): Promise<string> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - 60_000) return _cachedToken.token;
  const tenantId = Deno.env.get('AZURE_TENANT_ID')!;
  const clientId = Deno.env.get('AZURE_CLIENT_ID')!;
  const clientSecret = Deno.env.get('AZURE_CLIENT_SECRET')!;
  const params = new URLSearchParams({
    grant_type: 'client_credentials', client_id: clientId,
    client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default',
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    { method: 'POST', body: params },
  );
  if (!res.ok) throw new Error(`Graph token failed: ${res.status}`);
  const { access_token, expires_in } = await res.json() as { access_token: string; expires_in: number };
  _cachedToken = { token: access_token, expiresAt: Date.now() + expires_in * 1000 };
  return access_token;
}

async function graphGet<T>(path: string): Promise<T> {
  const token = await getGraphToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Graph API error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

async function markMessageRead(mailbox: string, messageId: string): Promise<void> {
  try {
    const token = await getGraphToken();
    await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${messageId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRead: true }),
    });
  } catch (e) {
    console.error('Failed to mark read:', e);
  }
}

// ── Gemini classification ───────────────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

interface EmailClassification {
  intent: 'new_invoice' | 'payment_reminder' | 'credit_note' | 'statement' | 'skip' | 'remittance_advice';
  requires_action: boolean;
  invoice_references: string[];
  supplier_name: string | null;
  amount_mentioned: number | null;
  currency: string | null;
  urgency: 'normal' | 'high';
  summary: string;
}

const FALLBACK: EmailClassification = {
  intent: 'new_invoice', requires_action: true, invoice_references: [],
  supplier_name: null, amount_mentioned: null, currency: null,
  urgency: 'normal', summary: 'Gemini unavailable — treated as new invoice',
};

async function classifyEmail(subject: string, body: string): Promise<EmailClassification> {
  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY')!;
    const res = await fetch(`${GEMINI_BASE}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Classify for invoice system:\n\nSubject: ${subject}\nBody: ${body.substring(0, 2000)}\n\nReturn JSON only: {"intent": "new_invoice"|"payment_reminder"|"credit_note"|"statement"|"skip"|"remittance_advice", "requires_action": boolean, "invoice_references": [strings], "supplier_name": string|null, "amount_mentioned": number|null, "currency": string|null, "urgency": "normal"|"high", "summary": string}` }] }],
        generationConfig: { temperature: 0, response_mime_type: 'application/json' },
      }),
    });
    if (!res.ok) return FALLBACK;
    const data = await res.json() as Record<string, unknown>;
    const text = (data?.candidates?.[0] as Record<string, unknown>)?.content?.parts?.[0]?.text ?? '{}';
    return JSON.parse(text as string) as EmailClassification;
  } catch {
    return FALLBACK;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').substring(0, 3000);
}

const SUPPORTED_MIME_TYPES: Record<string, boolean> = {
  'application/pdf': true, 'image/jpeg': true, 'image/png': true,
  'image/gif': true, 'image/webp': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
  'application/msword': true, 'application/vnd.ms-excel': true,
};
const DOCUMENT_MIME_TYPES: Record<string, boolean> = {
  'application/pdf': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
  'application/msword': true,
  'application/vnd.ms-excel': true,
};

interface GraphMessage {
  id: string;
  subject?: string;
  from: { emailAddress: { address: string; name?: string } };
  receivedDateTime: string;
  hasAttachments: boolean;
  body?: { contentType: string; content: string };
}
interface GraphAttachment {
  id: string; name: string; contentType: string; size: number; contentBytes: string;
}

interface PollResult {
  mailbox: string;
  company: string;
  folder: string;
  dry_run: boolean;
  unread_found: number;
  processed: number;
  skipped: number;
  duplicates: number;
  reminders: number;
  would_process: number;
  errors: string[];
  messages: Array<{ subject: string; from: string; intent: string; has_attachments: boolean; action: string; summary: string }>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // ── Auth: admin only ────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return json({ error: 'Unauthorized: missing Authorization header' }, 401);

  const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !userData?.user) return json({ error: 'Unauthorized: token rejected' }, 401);

  const { data: callerProfile } = await supabaseAdmin
    .from('profiles').select('role').eq('id', userData.user.id).single();
  if (callerProfile?.role !== 'admin') {
    return json({ error: 'Forbidden: admin role required', your_role: callerProfile?.role }, 403);
  }

  // ── Body ──────────────────────────────────────────────────────────────────
  let body: { mailbox_id?: string; dry_run?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const mailboxId = (body.mailbox_id ?? '').trim();
  const dryRun = body.dry_run === true;
  if (!mailboxId) return json({ error: 'mailbox_id is required' }, 400);

  // ── Load the one mailbox (even if paused) ───────────────────────────────────
  const { data: mb, error: mbErr } = await supabaseAdmin
    .from('mailboxes')
    .select('id, email, label, folder_id, folder_name, is_active, company:companies(slug, name)')
    .eq('id', mailboxId)
    .single();

  if (mbErr || !mb) return json({ error: 'Mailbox not found', detail: mbErr?.message }, 404);

  const mailboxEmail = mb.email as string;
  const company = (mb.company as unknown as { slug: string; name: string }) ?? { slug: '', name: '' };
  const folderId = mb.folder_id as string | null;
  const folderName = (mb.folder_name as string | null) ?? 'Inbox';

  const result: PollResult = {
    mailbox: mailboxEmail,
    company: company.name,
    folder: folderName,
    dry_run: dryRun,
    unread_found: 0,
    processed: 0, skipped: 0, duplicates: 0, reminders: 0, would_process: 0,
    errors: [],
    messages: [],
  };

  const folderSegment = folderId ? `mailFolders/${encodeURIComponent(folderId)}` : 'mailFolders/inbox';

  let messages: GraphMessage[];
  try {
    const { value } = await graphGet<{ value: GraphMessage[] }>(
      `/users/${encodeURIComponent(mailboxEmail)}/${folderSegment}/messages?$filter=isRead eq false&$top=50&$select=id,subject,from,receivedDateTime,hasAttachments,body`,
    );
    messages = value;
  } catch (err) {
    result.errors.push((err as Error).message);
    return json(result, 200);
  }

  result.unread_found = messages.length;

  for (const message of messages) {
    try {
      const bodyText = message.body?.contentType === 'html'
        ? stripHtml(message.body.content)
        : (message.body?.content ?? '').substring(0, 3000);

      const classification = await classifyEmail(message.subject ?? '', bodyText);

      const record = {
        subject: message.subject ?? '(no subject)',
        from: message.from.emailAddress.address,
        intent: classification.intent,
        has_attachments: message.hasAttachments,
        action: '',
        summary: classification.summary,
      };

      const isNonAction =
        classification.intent === 'skip' ||
        classification.intent === 'remittance_advice' ||
        classification.intent === 'statement' ||
        !classification.requires_action;

      if (isNonAction) {
        record.action = 'skip';
        result.skipped++;
        if (!dryRun) await markMessageRead(mailboxEmail, message.id);
        result.messages.push(record);
        continue;
      }

      if (classification.intent === 'payment_reminder') {
        record.action = 'reminder';
        result.reminders++;
        if (!dryRun) {
          let existingPoId: string | null = null;
          if (classification.invoice_references.length > 0) {
            for (const ref of classification.invoice_references) {
              const { data: match } = await supabaseAdmin
                .from('purchase_orders').select('id')
                .ilike('transaction_reference', ref).limit(1).maybeSingle();
              if (match) { existingPoId = match.id; break; }
            }
          }
          await supabaseAdmin.from('audit_log').insert({
            purchase_order_id: existingPoId ?? null,
            action: 'reminder_sent',
            actor_email: message.from.emailAddress.address,
            actor_display: message.from.emailAddress.name || message.from.emailAddress.address,
            metadata: { type: 'incoming_payment_reminder', email_subject: message.subject, company: company.slug, urgency: classification.urgency, summary: classification.summary },
          });
          await markMessageRead(mailboxEmail, message.id);
        }
        result.messages.push(record);
        continue;
      }

      if (!message.hasAttachments) {
        record.action = 'skip (no attachment)';
        result.skipped++;
        if (!dryRun) await markMessageRead(mailboxEmail, message.id);
        result.messages.push(record);
        continue;
      }

      // new_invoice with attachments
      if (dryRun) {
        record.action = 'would create PO';
        result.would_process++;
        result.messages.push(record);
        continue;
      }

      // ── Real processing ───────────────────────────────────────────────────
      const { value: attachments } = await graphGet<{ value: GraphAttachment[] }>(
        `/users/${encodeURIComponent(mailboxEmail)}/messages/${message.id}/attachments`,
      );
      const invoiceAttachments = attachments?.filter((a) => SUPPORTED_MIME_TYPES[a.contentType]) || [];
      if (invoiceAttachments.length === 0) {
        record.action = 'skip (no supported attachment)';
        result.skipped++;
        await markMessageRead(mailboxEmail, message.id);
        result.messages.push(record);
        continue;
      }
      const bestAttachment =
        invoiceAttachments.find((a) => DOCUMENT_MIME_TYPES[a.contentType]) ?? invoiceAttachments[0];

      const { data: existingFile } = await supabaseAdmin
        .from('invoice_files').select('id')
        .eq('original_name', bestAttachment.name)
        .eq('email_from', message.from.emailAddress.address)
        .limit(1).maybeSingle();

      if (existingFile) {
        record.action = 'duplicate';
        result.duplicates++;
        await markMessageRead(mailboxEmail, message.id);
        result.messages.push(record);
        continue;
      }

      const poId = crypto.randomUUID();
      const year = new Date().getFullYear();
      const month = String(new Date().getMonth() + 1).padStart(2, '0');
      const storagePath = `${year}/${month}/${poId}/${bestAttachment.name}`;
      const bytes = Uint8Array.from(atob(bestAttachment.contentBytes), (c) => c.charCodeAt(0));

      const { error: storageError } = await supabaseAdmin.storage
        .from('invoices').upload(storagePath, bytes, { contentType: bestAttachment.contentType, upsert: false });
      if (storageError) {
        result.errors.push(`Storage upload failed: ${storageError.message}`);
        result.messages.push(record);
        continue;
      }

      const { data: fileRecord, error: fileError } = await supabaseAdmin
        .from('invoice_files').insert({
          storage_path: storagePath, bucket_name: 'invoices',
          original_name: bestAttachment.name, mime_type: bestAttachment.contentType,
          file_size_bytes: bestAttachment.size, email_from: message.from.emailAddress.address,
          email_date: message.receivedDateTime, email_subject: message.subject,
        }).select().single();
      if (fileError || !fileRecord) {
        result.errors.push(`invoice_files insert failed: ${fileError?.message}`);
        result.messages.push(record);
        continue;
      }

      const { error: poError } = await supabaseAdmin
        .from('purchase_orders').insert({
          id: poId,
          invoice_file_id: fileRecord.id,
          status: 'pending_finance_review',
          company: company.slug,
          supplier_name: classification.supplier_name ?? null,
        }).select().single();
      if (poError) {
        result.errors.push(`purchase_orders insert failed: ${poError.message}`);
        result.messages.push(record);
        continue;
      }

      await supabaseAdmin.from('audit_log').insert({
        purchase_order_id: poId, action: 'created',
        actor_email: 'system@poll-mailbox', actor_display: 'Manual poll (Admin)',
        new_values: { email_from: message.from.emailAddress.address, email_subject: message.subject, attachment: bestAttachment.name, company: company.slug },
        metadata: { classification_intent: classification.intent, classification_summary: classification.summary, company: company.slug, source: 'poll-mailbox' },
      });

      record.action = 'created PO';
      result.processed++;
      await markMessageRead(mailboxEmail, message.id);
      result.messages.push(record);
    } catch (err) {
      result.errors.push(`[${message.subject ?? 'msg'}] ${(err as Error).message}`);
    }
  }

  return json(result, 200);
});
