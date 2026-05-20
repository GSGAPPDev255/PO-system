/**
 * email-intake: Polls all finance M365 mailboxes via MS Graph API.
 *
 * Mailboxes:
 *   purchases@kewhouseschool.com    -> kew_house
 *   purchases@gardenerschools.com   -> gardener_schools
 *   purchases@maidavaleschool.com   -> maida_vale
 *
 * For each unread email:
 *  1. Classify intent with Gemini
 *  2. Detect duplicate files
 *  3. Create PO for genuine new invoices
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

const MAILBOXES = [
  { email: 'purchases@kewhouseschool.com',   company: 'kew_house',        label: 'Kew House School' },
  { email: 'purchases@gardenerschools.com',  company: 'gardener_schools', label: 'Gardener Schools' },
  { email: 'purchases@maidavaleschool.com',  company: 'maida_vale',       label: 'Maida Vale School' },
] as const;

type CompanyEntity = 'kew_house' | 'gardener_schools' | 'maida_vale';

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

const SUPPORTED_MIME_TYPES: Record<string, boolean> = {
  'application/pdf': true, 'image/jpeg': true, 'image/png': true,
  'image/gif': true, 'image/webp': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
  'application/msword': true, 'application/vnd.ms-excel': true,
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

interface ProcessResult {
  processed: number; skipped: number; duplicates: number; reminders: number; attachments_skipped: number;
  errors: string[];
  classifications: Array<{ mailbox: string; company: string; subject: string; intent: string; summary: string }>;
}

async function processMailbox(
  mailbox: string,
  company: CompanyEntity,
  results: ProcessResult,
): Promise<void> {
  let messages: GraphMessage[];
  try {
    const { value } = await graphGet<{ value: GraphMessage[] }>(
      `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$filter=isRead eq false&$top=50&$select=id,subject,from,receivedDateTime,hasAttachments,body`,
    );
    messages = value;
  } catch (err) {
    results.errors.push(`[${mailbox}] ${(err as Error).message}`);
    return;
  }

  for (const message of messages) {
    try {
      const bodyText = message.body?.contentType === 'html'
        ? stripHtml(message.body.content)
        : (message.body?.content ?? '').substring(0, 3000);

      const classification = await classifyEmail(message.subject ?? '', bodyText);
      results.classifications.push({
        mailbox, company,
        subject: message.subject ?? '(no subject)',
        intent: classification.intent,
        summary: classification.summary,
      });

      if (classification.intent === 'skip' ||
          classification.intent === 'remittance_advice' ||
          classification.intent === 'statement' ||
          !classification.requires_action) {
        await markMessageRead(mailbox, message.id);
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
            .eq('company', company)
            .in('status', ['pending_finance_review', 'pending_approval'])
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (match) existingPoId = match.id;
        }
        await supabaseAdmin.from('audit_log').insert({
          purchase_order_id: existingPoId ?? null,
          action: 'reminder_sent',
          actor_email: message.from.emailAddress.address,
          actor_display: message.from.emailAddress.name || message.from.emailAddress.address,
          metadata: { type: 'incoming_payment_reminder', email_subject: message.subject, company, urgency: classification.urgency, summary: classification.summary },
        });
        await markMessageRead(mailbox, message.id);
        results.reminders++;
        continue;
      }

      if (!message.hasAttachments) {
        await markMessageRead(mailbox, message.id);
        results.skipped++;
        continue;
      }

      const { value: attachments } = await graphGet<{ value: GraphAttachment[] }>(
        `/users/${encodeURIComponent(mailbox)}/messages/${message.id}/attachments`,
      );

      const invoiceAttachments = attachments?.filter((a: GraphAttachment) => SUPPORTED_MIME_TYPES[a.contentType]) || [];
      if (invoiceAttachments.length === 0) {
        await markMessageRead(mailbox, message.id);
        results.skipped++;
        continue;
      }

      // Only process the FIRST supported attachment per email to avoid creating POs
      // for logos, signatures, and other non-invoice images. If an email has multiple
      // legitimate invoices, they should be sent separately.
      const firstInvoiceAttachment = invoiceAttachments[0];
      if (invoiceAttachments.length > 1) {
        results.attachments_skipped += invoiceAttachments.length - 1;
      }

      for (const attachment of [firstInvoiceAttachment]) {
        const { data: existingFile } = await supabaseAdmin
          .from('invoice_files').select('id')
          .eq('original_name', attachment.name)
          .eq('email_from', message.from.emailAddress.address)
          .limit(1).maybeSingle();

        if (existingFile) {
          results.duplicates++;
          continue;
        }

        const poId = crypto.randomUUID();
        const year = new Date().getFullYear();
        const month = String(new Date().getMonth() + 1).padStart(2, '0');
        const storagePath = `${year}/${month}/${poId}/${attachment.name}`;

        const bytes = Uint8Array.from(atob(attachment.contentBytes), (c) => c.charCodeAt(0));
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
            company,
            supplier_name: classification.supplier_name ?? null,
          }).select().single();

        if (poError || !poRecord) {
          results.errors.push(`purchase_orders insert failed: ${poError?.message}`);
          continue;
        }

        await supabaseAdmin.from('audit_log').insert({
          purchase_order_id: poId, action: 'created',
          actor_email: 'system@email-intake', actor_display: 'Email Intake (System)',
          new_values: { email_from: message.from.emailAddress.address, email_subject: message.subject, attachment: attachment.name, company },
          metadata: { classification_intent: classification.intent, classification_summary: classification.summary, company },
        });

        // invoice-processor is NOT auto-triggered here.
        // Finance staff use the 'Extract Data with AI' button on the Invoice Review page.

        results.processed++;
      }

      await markMessageRead(mailbox, message.id);
    } catch (err) {
      results.errors.push(`[${mailbox}] ${(err as Error).message}`);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const results: ProcessResult = {
    processed: 0, skipped: 0, duplicates: 0, reminders: 0, attachments_skipped: 0, errors: [], classifications: [],
  };

  for (const { email, company } of MAILBOXES) {
    await processMailbox(email, company, results);
  }

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
