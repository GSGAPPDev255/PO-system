/**
 * email-intake: Polls the finance M365 mailbox via MS Graph API.
 *
 * For each unread email:
 *  1. Classify intent with Gemini (new invoice / reminder / credit note / statement / skip)
 *  2. Detect duplicate files already in the system
 *  3. Route accordingly — only create a PO for genuine new invoices
 *  4. Trigger gemini-processor for extraction on new invoices
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// -- CORS ------------------------------------------------------------------
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
};

// -- Supabase admin client --------------------------------------------------
const supabaseUrl      = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin    = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

// -- MS Graph token (client credentials) -----------------------------------
let _cachedToken: { token: string; expiresAt: number } | null = null;

async function getGraphToken(): Promise<string> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - 60_000) return _cachedToken.token;

  const tenantId      = Deno.env.get('AZURE_TENANT_ID')!;
  const clientId      = Deno.env.get('AZURE_CLIENT_ID')!;
  const clientSecret  = Deno.env.get('AZURE_CLIENT_SECRET')!;

  const params = new URLSearchParams({
    grant_type: 'client_credentials', client_id: clientId,
    client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default',
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    { method: 'POST', body: params },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph token fetch failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  _cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _cachedToken.token;
}

async function graphGet<T>(path: string): Promise<T> {
  const token = await getGraphToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph GET ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function markMessageRead(mailbox: string, messageId: string) {
  const token = await getGraphToken();
  await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${messageId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ isRead: true }),
  });
}

// -- Gemini email classifier ------------------------------------------------
const GEMINI_MODEL    = 'gemini-1.5-flash-8b';
const GEMINI_BASE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const EMAIL_CLASSIFY_PROMPT = `You are a finance assistant analysing incoming emails to a company's finance department.

Read the email subject and body text, then return ONLY valid JSON (no markdown):

{
  "intent": "new_invoice" | "payment_reminder" | "credit_note" | "statement" | "remittance_advice" | "query" | "skip",
  "requires_action": true | false,
  "invoice_references": [],
  "supplier_name": string or null,
  "amount_mentioned": number or null,
  "currency": string or null,
  "urgency": "normal" | "urgent" | "overdue",
  "is_duplicate_send": true | false,
  "summary": "one sentence, max 100 chars"
}

Intent definitions:
- new_invoice: a new bill/invoice requesting payment for goods or services
- payment_reminder: chasing payment for an invoice already sent (words like "reminder", "overdue", "outstanding", "please pay", "second notice", "chasing")
- credit_note: a credit note reducing an outstanding balance
- statement: an account statement listing multiple invoices
- remittance_advice: notification that payment has been made by the sender
- query: a question about an invoice, account, or previous payment
- skip: spam, auto-replies, unsubscribe emails, marketing, or clearly not finance-related

Rules:
- If the email has an attachment AND says things like "please find attached", "attached invoice", "invoice enclosed" → new_invoice
- If the email says "this is a reminder", "payment is overdue", "we have not received payment" → payment_reminder
- If the email is from a no-reply or automated system sending a statement → statement
- is_duplicate_send = true only if the email explicitly says "resending", "re-sending", or "sent again"
- invoice_references: extract any invoice numbers, PO numbers, or reference codes mentioned`;

interface EmailClassification {
  intent: 'new_invoice' | 'payment_reminder' | 'credit_note' | 'statement' | 'remittance_advice' | 'query' | 'skip';
  requires_action: boolean;
  invoice_references: string[];
  supplier_name: string | null;
  amount_mentioned: number | null;
  currency: string | null;
  urgency: 'normal' | 'urgent' | 'overdue';
  is_duplicate_send: boolean;
  summary: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .substring(0, 3000); // cap at 3000 chars for Gemini
}

async function classifyEmail(subject: string, bodyText: string): Promise<EmailClassification> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')!;

  const prompt = `Subject: ${subject}\n\nBody:\n${bodyText}`;

  const res = await fetch(`${GEMINI_BASE_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: EMAIL_CLASSIFY_PROMPT }, { text: prompt }] }],
      generationConfig: { temperature: 0, response_mime_type: 'application/json' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini classify failed: ${res.status} ${body}`);
  }

  const raw = await res.json();
  const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  try {
    return JSON.parse(text) as EmailClassification;
  } catch {
    // Fallback: treat as new_invoice if classification fails
    return {
      intent: 'new_invoice', requires_action: true, invoice_references: [],
      supplier_name: null, amount_mentioned: null, currency: null,
      urgency: 'normal', is_duplicate_send: false,
      summary: 'Classification failed — treated as new invoice',
    };
  }
}

// -- Supported attachment MIME types ----------------------------------------
const SUPPORTED_MIME_TYPES: Record<string, boolean> = {
  'application/pdf': true,
  'image/jpeg': true,
  'image/jpg': true,
  'image/png': true,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
  'application/vnd.ms-excel': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'application/msword': true,
};

interface GraphMessage {
  id: string;
  subject: string;
  from: { emailAddress: { address: string; name: string } };
  receivedDateTime: string;
  hasAttachments: boolean;
  body: { contentType: string; content: string };
}

interface GraphAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  contentBytes: string;
}

// -- Main handler -----------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const financeMailbox = Deno.env.get('FINANCE_MAILBOX')!;

  const results: {
    processed: number;
    skipped: number;
    duplicates: number;
    reminders: number;
    errors: string[];
    classifications: Array<{ subject: string; intent: string; summary: string }>;
  } = { processed: 0, skipped: 0, duplicates: 0, reminders: 0, errors: [], classifications: [] };

  try {
    const { value: messages } = await graphGet<{ value: GraphMessage[] }>(
      `/users/${encodeURIComponent(financeMailbox)}/messages?$filter=isRead eq false&$top=50&$select=id,subject,from,receivedDateTime,hasAttachments,body`,
    );

    for (const message of messages) {
      try {
        // Extract plain text from body for classification
        const bodyText = message.body?.contentType === 'html'
          ? stripHtml(message.body.content)
          : (message.body?.content ?? '').substring(0, 3000);

        // Classify the email with Gemini
        const classification = await classifyEmail(message.subject ?? '', bodyText);

        results.classifications.push({
          subject: message.subject ?? '(no subject)',
          intent: classification.intent,
          summary: classification.summary,
        });

        // Skip emails that need no action
        if (classification.intent === 'skip' ||
            classification.intent === 'remittance_advice' ||
            classification.intent === 'statement' ||
            !classification.requires_action) {
          await markMessageRead(financeMailbox, message.id);
          results.skipped++;
          continue;
        }

        // Payment reminder — log against existing PO if we can find it, don't create a new one
        if (classification.intent === 'payment_reminder') {
          let existingPoId: string | null = null;

          // Try to find an existing PO matching any referenced invoice number
          if (classification.invoice_references.length > 0) {
            for (const ref of classification.invoice_references) {
              const { data: match } = await supabaseAdmin
                .from('purchase_orders')
                .select('id, status')
                .ilike('transaction_reference', ref)
                .limit(1)
                .single();
              if (match) { existingPoId = match.id; break; }
            }
          }

          // Also try matching by supplier name if no ref match
          if (!existingPoId && classification.supplier_name) {
            const { data: match } = await supabaseAdmin
              .from('purchase_orders')
              .select('id, status')
              .ilike('supplier_name', `%${classification.supplier_name}%`)
              .in('status', ['pending_finance_review', 'pending_approval'])
              .order('created_at', { ascending: false })
              .limit(1)
              .single();
            if (match) existingPoId = match.id;
          }

          await supabaseAdmin.from('audit_log').insert({
            purchase_order_id: existingPoId ?? null,
            action: 'reminder_sent',
            actor_email: message.from.emailAddress.address,
            actor_display: message.from.emailAddress.name || message.from.emailAddress.address,
            metadata: {
              type: 'incoming_payment_reminder',
              email_subject: message.subject,
              email_from: message.from.emailAddress.address,
              invoice_references: classification.invoice_references,
              urgency: classification.urgency,
              summary: classification.summary,
              amount_mentioned: classification.amount_mentioned,
            },
          });

          await markMessageRead(financeMailbox, message.id);
          results.reminders++;
          continue;
        }

        // For new_invoice / credit_note — process attachments
        if (!message.hasAttachments) {
          await markMessageRead(financeMailbox, message.id);
          results.skipped++;
          continue;
        }

        const { value: attachments } = await graphGet<{ value: GraphAttachment[] }>(
          `/users/${encodeURIComponent(financeMailbox)}/messages/${message.id}/attachments`,
        );

        const invoiceAttachments = attachments.filter((a) => SUPPORTED_MIME_TYPES[a.contentType]);

        if (invoiceAttachments.length === 0) {
          await markMessageRead(financeMailbox, message.id);
          results.skipped++;
          continue;
        }

        for (const attachment of invoiceAttachments) {
          // Duplicate detection: same filename from same sender already in the system
          const { data: existingFile } = await supabaseAdmin
            .from('invoice_files')
            .select('id')
            .eq('original_name', attachment.name)
            .eq('email_from', message.from.emailAddress.address)
            .limit(1)
            .maybeSingle();

          if (existingFile) {
            results.duplicates++;
            console.log(`Duplicate skipped: ${attachment.name} from ${message.from.emailAddress.address}`);
            continue;
          }

          const poId        = crypto.randomUUID();
          const year        = new Date().getFullYear();
          const month       = String(new Date().getMonth() + 1).padStart(2, '0');
          const storagePath = `${year}/${month}/${poId}/${attachment.name}`;

          // Decode base64 attachment
          const bytes = Uint8Array.from(atob(attachment.contentBytes), (c) => c.charCodeAt(0));

          // Upload to Supabase Storage
          const { error: storageError } = await supabaseAdmin.storage
            .from('invoices')
            .upload(storagePath, bytes, { contentType: attachment.contentType, upsert: false });

          if (storageError) {
            results.errors.push(`Storage upload failed for ${attachment.name}: ${storageError.message}`);
            continue;
          }

          // Insert invoice_files record
          const { data: fileRecord, error: fileError } = await supabaseAdmin
            .from('invoice_files')
            .insert({
              id: crypto.randomUUID(),
              storage_path: storagePath,
              bucket_name: 'invoices',
              original_name: attachment.name,
              mime_type: attachment.contentType,
              file_size_bytes: attachment.size,
              email_from: message.from.emailAddress.address,
              email_date: message.receivedDateTime,
              email_subject: message.subject,
            })
            .select()
            .single();

          if (fileError || !fileRecord) {
            results.errors.push(`invoice_files insert failed: ${fileError?.message}`);
            continue;
          }

          // Insert draft purchase_order — include email classification context
          const { data: poRecord, error: poError } = await supabaseAdmin
            .from('purchase_orders')
            .insert({
              id: poId,
              invoice_file_id: fileRecord.id,
              status: 'pending_finance_review',
              // Pre-fill supplier name if Gemini identified it from the email
              supplier_name: classification.supplier_name ?? null,
            })
            .select()
            .single();

          if (poError || !poRecord) {
            results.errors.push(`purchase_orders insert failed: ${poError?.message}`);
            continue;
          }

          // Audit log — include email classification metadata
          await supabaseAdmin.from('audit_log').insert({
            purchase_order_id: poId,
            action: 'created',
            actor_email: 'system@email-intake',
            actor_display: 'Email Intake (System)',
            new_values: {
              email_from: message.from.emailAddress.address,
              email_subject: message.subject,
              attachment_name: attachment.name,
            },
            metadata: {
              email_classification: classification.intent,
              email_summary: classification.summary,
              email_urgency: classification.urgency,
              invoice_references_from_email: classification.invoice_references,
              amount_from_email: classification.amount_mentioned,
              currency_from_email: classification.currency,
              is_credit_note: classification.intent === 'credit_note',
            },
          });

          // Trigger invoice processor asynchronously for invoice/data extraction
          fetch(`${supabaseUrl}/functions/v1/invoice-processor`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${serviceRoleKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              purchase_order_id: poId,
              invoice_file_id: fileRecord.id,
              storage_path: storagePath,
              mime_type: attachment.contentType,
            }),
          }).catch((e) => console.error('Failed to trigger invoice-processor:', e));

          results.processed++;
        }

        await markMessageRead(financeMailbox, message.id);

      } catch (msgErr) {
        results.errors.push(`Message ${message.id}: ${(msgErr as Error).message}`);
        // Still try to mark as read to avoid infinite reprocessing loops
        try { await markMessageRead(financeMailbox, message.id); } catch { /* ignore */ }
      }
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
