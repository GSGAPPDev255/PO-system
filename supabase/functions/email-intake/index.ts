/**
 * email-intake: Polls all active finance mailboxes from the `mailboxes` DB table.
 * Companies and mailboxes are managed via the Admin Panel — no hardcoding.
 *
 * For each unread email:
 *  1. Classify intent with Gemini
 *  2. Prefer PDF/Word/Excel over images when selecting the invoice attachment
 *  3. Detect duplicate files
 *  4. Create ONE PO per email for genuine new invoices
 *
 * NOTE: invoice-processor is NOT auto-triggered.
 * Finance staff trigger it manually from the Invoice Review page.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

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

/** SHA-256 hex digest of raw bytes — used for content-based duplicate detection */
async function sha256hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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

// All supported MIME types for invoice attachments
const SUPPORTED_MIME_TYPES: Record<string, boolean> = {
  'application/pdf': true, 'image/jpeg': true, 'image/png': true,
  'image/gif': true, 'image/webp': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
  'application/msword': true, 'application/vnd.ms-excel': true,
};

// Document types preferred over images — PDFs/Word/Excel are almost always the invoice
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

interface MailboxRow {
  id: string;
  email: string;
  label: string;
  folder_id: string | null;
  folder_name: string | null;
  company: { slug: string; name: string };
}

interface ProcessResult {
  processed: number; skipped: number; duplicates: number; reminders: number; attachments_skipped: number;
  errors: string[];
  classifications: Array<{ mailbox: string; company: string; subject: string; intent: string; summary: string }>;
}

async function processMailbox(
  mailboxEmail: string,
  companySlug: string,
  results: ProcessResult,
  folderId?: string | null,
): Promise<void> {
  // Use the configured folder if set, otherwise fall back to the default Inbox.
  // Graph path: /mailFolders/{id}/messages  OR  /mailFolders/inbox/messages
  const folderSegment = folderId ? `mailFolders/${encodeURIComponent(folderId)}` : 'mailFolders/inbox';

  let messages: GraphMessage[];
  try {
    const { value } = await graphGet<{ value: GraphMessage[] }>(
      `/users/${encodeURIComponent(mailboxEmail)}/${folderSegment}/messages?$filter=isRead eq false&$top=50&$select=id,subject,from,receivedDateTime,hasAttachments,body`,
    );
    messages = value;
  } catch (err) {
    results.errors.push(`[${mailboxEmail}] ${(err as Error).message}`);
    return;
  }

  for (const message of messages) {
    try {
      const bodyText = message.body?.contentType === 'html'
        ? stripHtml(message.body.content)
        : (message.body?.content ?? '').substring(0, 3000);

      const classification = await classifyEmail(message.subject ?? '', bodyText);
      results.classifications.push({
        mailbox: mailboxEmail, company: companySlug,
        subject: message.subject ?? '(no subject)',
        intent: classification.intent,
        summary: classification.summary,
      });

      if (classification.intent === 'skip' ||
          classification.intent === 'remittance_advice' ||
          classification.intent === 'statement' ||
          !classification.requires_action) {
        await markMessageRead(mailboxEmail, message.id);
        results.skipped++;
        continue;
      }

      if (classification.intent === 'payment_reminder') {
        let existingPoId: string | null = null;
        if (classification.invoice_references.length > 0) {
          for (const ref of classification.invoice_references) {
            const { data: match } = await supabaseAdmin
              .from('purchase_orders').select('id')
              .ilike('transaction_reference', ref).limit(1).maybeSingle();
            if (match) { existingPoId = match.id; break; }
          }
        }
        if (!existingPoId && classification.supplier_name) {
          const { data: match } = await supabaseAdmin
            .from('purchase_orders').select('id')
            .ilike('supplier_name', `%${classification.supplier_name}%`)
            .eq('company', companySlug)
            .in('status', ['pending_finance_review', 'pending_approval'])
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (match) existingPoId = match.id;
        }
        await supabaseAdmin.from('audit_log').insert({
          purchase_order_id: existingPoId ?? null,
          action: 'reminder_sent',
          actor_email: message.from.emailAddress.address,
          actor_display: message.from.emailAddress.name || message.from.emailAddress.address,
          metadata: { type: 'incoming_payment_reminder', email_subject: message.subject, company: companySlug, urgency: classification.urgency, summary: classification.summary },
        });
        await markMessageRead(mailboxEmail, message.id);
        results.reminders++;
        continue;
      }

      if (!message.hasAttachments) {
        await markMessageRead(mailboxEmail, message.id);
        results.skipped++;
        continue;
      }

      const { value: attachments } = await graphGet<{ value: GraphAttachment[] }>(
        `/users/${encodeURIComponent(mailboxEmail)}/messages/${message.id}/attachments`,
      );

      const invoiceAttachments = attachments?.filter((a: GraphAttachment) => SUPPORTED_MIME_TYPES[a.contentType]) || [];
      if (invoiceAttachments.length === 0) {
        await markMessageRead(mailboxEmail, message.id);
        results.skipped++;
        continue;
      }

      // Prefer PDF/Word/Excel over images — avoids picking up logos or signature
      // images when the real invoice is a document. Falls back to first image only
      // if no document-type attachment exists.
      const bestAttachment =
        invoiceAttachments.find((a) => DOCUMENT_MIME_TYPES[a.contentType]) ??
        invoiceAttachments[0];
      if (invoiceAttachments.length > 1) {
        results.attachments_skipped += invoiceAttachments.length - 1;
      }

      for (const attachment of [bestAttachment]) {
        // Decode bytes first — needed for both hash check and storage upload
        const bytes = Uint8Array.from(atob(attachment.contentBytes), (c) => c.charCodeAt(0));
        const fileHash = await sha256hex(bytes);

        // ── Hash-based duplicate detection ──────────────────────────────────────
        // Catches identical files regardless of filename, sender, or subject.
        // Covers: resent invoices, forwarded invoices, chaser with same PDF attached.
        const { data: existingFile } = await supabaseAdmin
          .from('invoice_files')
          .select('id')
          .eq('file_hash', fileHash)
          .limit(1)
          .maybeSingle();

        if (existingFile) {
          // Find the PO linked to this file so we can log the chase against it
          const { data: existingPO } = await supabaseAdmin
            .from('purchase_orders')
            .select('id')
            .eq('invoice_file_id', existingFile.id)
            .limit(1)
            .maybeSingle();

          await supabaseAdmin.from('audit_log').insert({
            purchase_order_id: existingPO?.id ?? null,
            action: 'duplicate_received',
            actor_email: 'system@email-intake',
            actor_display: 'Email Intake (System)',
            new_values: {
              email_from: message.from.emailAddress.address,
              email_subject: message.subject,
            },
            metadata: {
              type: 'duplicate_attachment',
              duplicate_of_file_id: existingFile.id,
              file_hash: fileHash,
            },
          });

          results.duplicates++;
          continue;
        }
        // ────────────────────────────────────────────────────────────────────────

        const poId = crypto.randomUUID();
        const year = new Date().getFullYear();
        const month = String(new Date().getMonth() + 1).padStart(2, '0');
        const storagePath = `${year}/${month}/${poId}/${attachment.name}`;

        const { error: storageError } = await supabaseAdmin.storage
          .from('invoices').upload(storagePath, bytes, { contentType: attachment.contentType, upsert: false });

        if (storageError) {
          results.errors.push(`Storage upload failed: ${storageError.message}`);
          continue;
        }

        const { data: fileRecord, error: fileError } = await supabaseAdmin
          .from('invoice_files').insert({
            storage_path: storagePath, bucket_name: 'invoices',
            original_name: attachment.name, mime_type: attachment.contentType,
            file_size_bytes: attachment.size, email_from: message.from.emailAddress.address,
            email_date: message.receivedDateTime, email_subject: message.subject,
            file_hash: fileHash,
          }).select().single();

        if (fileError || !fileRecord) {
          results.errors.push(`invoice_files insert failed: ${fileError?.message}`);
          continue;
        }

        const { data: poRecord, error: poError } = await supabaseAdmin
          .from('purchase_orders').insert({
            id: poId,
            invoice_file_id: fileRecord.id,
            status: 'pending_finance_review',
            company: companySlug,
            supplier_name: classification.supplier_name ?? null,
            email_subject: message.subject ?? null,
            email_from: message.from.emailAddress.address ?? null,
            email_date: message.receivedDateTime ?? null,
          }).select().single();

        if (poError || !poRecord) {
          results.errors.push(`purchase_orders insert failed: ${poError?.message}`);
          continue;
        }

        await supabaseAdmin.from('audit_log').insert({
          purchase_order_id: poId, action: 'created',
          actor_email: 'system@email-intake', actor_display: 'Email Intake (System)',
          new_values: { email_from: message.from.emailAddress.address, email_subject: message.subject, attachment: attachment.name, company: companySlug },
          metadata: { classification_intent: classification.intent, classification_summary: classification.summary, company: companySlug },
        });

        // invoice-processor is NOT auto-triggered here.
        // Finance staff use the 'Extract Data with AI' button on the Invoice Review page.

        results.processed++;
      }

      await markMessageRead(mailboxEmail, message.id);
    } catch (err) {
      results.errors.push(`[${mailboxEmail}] ${(err as Error).message}`);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const results: ProcessResult = {
    processed: 0, skipped: 0, duplicates: 0, reminders: 0, attachments_skipped: 0, errors: [], classifications: [],
  };

  // Load active mailboxes dynamically from the database
  const { data: mailboxRows, error: mailboxErr } = await supabaseAdmin
    .from('mailboxes')
    .select('id, email, label, folder_id, folder_name, company:companies(slug, name)')
    .eq('is_active', true);

  if (mailboxErr || !mailboxRows || mailboxRows.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No active mailboxes found', detail: mailboxErr?.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  for (const row of mailboxRows as unknown as MailboxRow[]) {
    await processMailbox(row.email, row.company.slug, results, row.folder_id);
  }

  return new Response(JSON.stringify({ ...results, mailboxes_polled: mailboxRows.length }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
