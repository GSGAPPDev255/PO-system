/**
 * invoice-processor: Downloads an invoice file from Supabase Storage,
 * sends it to Claude Haiku for structured extraction, stores the
 * immutable OCR record, and pre-populates the PO with extracted values.
 *
 * Triggered by: email-intake (async POST) or manual trigger.
 * Self-contained — no _shared/ imports (MCP bundler cannot resolve parent paths).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// -- CORS ------------------------------------------------------------------
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
};

// -- Supabase admin client --------------------------------------------------
const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin  = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

// -- Claude API ------------------------------------------------------------
const CLAUDE_MODEL = 'claude-haiku-4-5';
const CLAUDE_BASE  = 'https://api.anthropic.com/v1/messages';

const EXTRACTION_PROMPT = `You are a finance data extraction assistant. Extract structured invoice data from the attached document.

Return ONLY valid JSON (no markdown, no explanation):

{
  "supplier_name": string or null,
  "account_number": string or null,
  "supplier_ref": string or null,
  "invoice_number": string or null,
  "po_number": string or null,
  "description": string (max 75 chars, summarise goods/services) or null,
  "invoice_date": "YYYY-MM-DD" or null,
  "due_date": "YYYY-MM-DD" or null,
  "net_amount": number or null,
  "vat_amount": number or null,
  "gross_amount": number or null,
  "currency": "GBP" or other ISO code or null,
  "vat_rate": number (percentage, e.g. 20) or null,
  "payment_terms": string or null
}

Rules:
- All amounts as plain numbers with 2 decimal places, no currency symbols
- Dates in YYYY-MM-DD format only
- description max 75 characters — summarise what was purchased
- If a field is not present, return null
- account_number = the supplier's customer account reference for this company (not a bank account)
- supplier_ref = the supplier's own reference or order number
- invoice_number = the invoice number on the document`;

interface ExtractedFields {
  supplier_name:  string | null;
  account_number: string | null;
  supplier_ref:   string | null;
  invoice_number: string | null;
  po_number:      string | null;
  description:    string | null;
  invoice_date:   string | null;
  due_date:       string | null;
  net_amount:     number | null;
  vat_amount:     number | null;
  gross_amount:   number | null;
  currency:       string | null;
  vat_rate:       number | null;
  payment_terms:  string | null;
}

async function extractWithClaude(
  fileBytes: Uint8Array,
  mimeType: string,
): Promise<{ fields: ExtractedFields; rawResponse: string; processingMs: number }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')!;
  const start  = Date.now();

  // Convert bytes to base64
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < fileBytes.length; i += chunkSize) {
    binary += String.fromCharCode(...fileBytes.subarray(i, i + chunkSize));
  }
  const base64Data = btoa(binary);

  // Build file content block — PDFs use document type, images use image type
  type FileContent =
    | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }
    | { type: 'image';    source: { type: 'base64'; media_type: string; data: string } };

  let fileContent: FileContent;
  if (mimeType === 'application/pdf') {
    fileContent = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64Data },
    };
  } else {
    fileContent = {
      type: 'image',
      source: { type: 'base64', media_type: mimeType, data: base64Data },
    };
  }

  const payload = {
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [fileContent, { type: 'text', text: EXTRACTION_PROMPT }],
    }],
  };

  const res = await fetch(CLAUDE_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  });

  const processingMs = Date.now() - start;

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error: ${res.status} ${body}`);
  }

  const data = await res.json() as { content?: Array<{ text?: string }> };
  const rawResponse = data?.content?.[0]?.text ?? '{}';

  let fields: ExtractedFields;
  try {
    fields = JSON.parse(rawResponse) as ExtractedFields;
  } catch {
    fields = {
      supplier_name: null, account_number: null, supplier_ref: null,
      invoice_number: null, po_number: null, description: null,
      invoice_date: null, due_date: null, net_amount: null,
      vat_amount: null, gross_amount: null, currency: null,
      vat_rate: null, payment_terms: null,
    };
  }

  return { fields, rawResponse, processingMs };
}

// -- Main handler -----------------------------------------------------------
interface ProcessorPayload {
  purchase_order_id: string;
  invoice_file_id:   string;
  storage_path:      string;
  mime_type:         string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let payload: ProcessorPayload | null = null;

  const bodyText = await req.text();
  if (bodyText.trim()) {
    try {
      payload = JSON.parse(bodyText) as ProcessorPayload;
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // No payload supplied — find the most recent PO without an OCR extraction
  if (!payload?.purchase_order_id) {
    const { data: pending, error: pendingErr } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, invoice_file_id, invoice_files!inner(storage_path, mime_type)')
      .not('invoice_file_id', 'is', null)
      .not('id', 'in', `(SELECT purchase_order_id FROM ocr_extractions)`)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (pendingErr || !pending) {
      return new Response(
        JSON.stringify({ message: 'No unprocessed invoices found.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const file = (pending as Record<string, unknown>).invoice_files as { storage_path: string; mime_type: string };
    payload = {
      purchase_order_id: pending.id as string,
      invoice_file_id:   pending.invoice_file_id as string,
      storage_path:      file.storage_path,
      mime_type:         file.mime_type,
    };
  }

  const { purchase_order_id, invoice_file_id, storage_path, mime_type } = payload;

  try {
    // Download file from Supabase Storage
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from('invoices')
      .download(storage_path);

    if (downloadError || !fileData) {
      throw new Error(`Storage download failed: ${downloadError?.message}`);
    }

    const fileBytes = new Uint8Array(await fileData.arrayBuffer());

    // Extract with Claude Haiku
    const { fields, rawResponse, processingMs } = await extractWithClaude(fileBytes, mime_type);

    // Insert immutable OCR extraction record
    const { error: ocrError } = await supabaseAdmin
      .from('ocr_extractions')
      .insert({
        purchase_order_id,
        invoice_file_id,
        gemini_model:     CLAUDE_MODEL,   // column kept as gemini_model for schema compat
        raw_response:     rawResponse,
        extracted_fields: fields,
        processing_ms:    processingMs,
      });

    if (ocrError) throw new Error(`ocr_extractions insert failed: ${ocrError.message}`);

    // Pre-populate PO fields (only null fields — never overwrite finance edits)
    const poUpdates: Record<string, unknown> = {};
    if (fields.supplier_name)         poUpdates.supplier_name         = fields.supplier_name;
    if (fields.account_number)        poUpdates.account_number        = fields.account_number;
    if (fields.supplier_ref)          poUpdates.supplier_ref          = fields.supplier_ref;
    if (fields.invoice_number)        poUpdates.transaction_reference = fields.invoice_number;
    if (fields.po_number)             poUpdates.second_reference      = fields.po_number;
    if (fields.description)           poUpdates.description           = fields.description?.substring(0, 75);
    if (fields.net_amount    != null) poUpdates.net_amount            = fields.net_amount;
    if (fields.vat_amount    != null) poUpdates.vat_amount            = fields.vat_amount;
    if (fields.gross_amount  != null) poUpdates.gross_amount          = fields.gross_amount;
    if (fields.invoice_date)          poUpdates.transaction_date      = fields.invoice_date;
    if (fields.due_date)              poUpdates.due_date              = fields.due_date;

    if (Object.keys(poUpdates).length > 0) {
      const { data: currentPo } = await supabaseAdmin
        .from('purchase_orders')
        .select('*')
        .eq('id', purchase_order_id)
        .single();

      const filteredUpdates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(poUpdates)) {
        if (currentPo && (currentPo as Record<string, unknown>)[key] == null) {
          filteredUpdates[key] = value;
        }
      }

      if (Object.keys(filteredUpdates).length > 0) {
        await supabaseAdmin
          .from('purchase_orders')
          .update(filteredUpdates)
          .eq('id', purchase_order_id);
      }
    }

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      purchase_order_id,
      action:        'ocr_completed',
      actor_email:   'system@invoice-processor',
      actor_display: `Claude Haiku 4.5 (System)`,
      new_values:    fields,
      metadata:      { processing_ms: processingMs, model: CLAUDE_MODEL },
    });

    return new Response(
      JSON.stringify({ success: true, fields, processing_ms: processingMs }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('invoice-processor error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
