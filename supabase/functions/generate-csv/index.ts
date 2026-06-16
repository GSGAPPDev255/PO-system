/**
 * generate-csv: Validates approved POs and generates a Sage 200 PI import CSV.
 * Stores the CSV in Supabase Storage, creates a csv_exports record,
 * and marks each PO as 'exported'.
 *
 * Self-contained — no _shared imports (MCP bundler limitation).
 * POST body: { purchase_order_ids: string[] }
 * Requires: finance user auth token.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
};

// ── Supabase admin client ─────────────────────────────────────────────────────
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return { user: null, error: new Error('Missing Authorization header') };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return { user: data?.user ?? null, error };
}

// ── Sage 200 PI import — exact 46-column header order ────────────────────────
// Source: GSG_PI_Upload_Claude.csv template (row 1)
const SAGE_HEADERS = [
  'AccountNumber',
  'CBAccountNumber',
  'DaysDiscountValid',
  'DiscountValue',
  'DiscountPercentage',
  'DueDate',
  'GoodsValueInAccountCurrency',
  'PurControlValueInBaseCurrency',
  'DocumentToBaseCurrencyRate',
  'DocumentToAccountCurrencyRate',
  'PostedDate',
  'QueryCode',
  'TransactionReference',
  'SecondReference',
  'Source',
  'SYSTraderTranType',
  'TransactionDate',
  'UniqueReferenceNumber',
  'UserNumber',
  'TaxValue',
  'SYSTraderGenerationReasonType',
  'GoodsValueInBaseCurrency',
  'NominalAnalysisTransactionValue/1',
  'NominalAnalysisNominalAccountNumber/1',
  'NominalAnalysisNominalCostCentre/1',
  'NominalAnalysisNominalDepartment/1',
  'NominalAnalysisNominalAnalysisNarrative/1',
  'NominalAnalysisTransactionAnalysisCode/1',
  'NominalAnalysisTransactionValue/2',
  'NominalAnalysisNominalAccountNumber/2',
  'NominalAnalysisNominalCostCentre/2',
  'NominalAnalysisNominalDepartment/2',
  'NominalAnalysisNominalAnalysisNarrative/2',
  'TaxAnalysisTaxRate/1',
  'TaxAnalysisGoodsValueBeforeDiscount/1',
  'TaxAnalysisDiscountValue/1',
  'TaxAnalysisDiscountPercentage/1',
  'TaxAnalysisTaxOnGoodsValue/1',
  'TaxAnalysisTaxRate/2',
  'TaxAnalysisGoodsValueBeforeDiscount/2',
  'TaxAnalysisDiscountValue/2',
  'TaxAnalysisDiscountPercentage/2',
  'TaxAnalysisTaxOnGoodsValue/2',
  'ChequeCurrencyName',
  'ChequeToBankExchangeRate',
  'ChequeValueInChequeCurrency',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a date string as DD/MM/YYYY (Sage requirement). */
function formatDate(d: string | null | undefined): string {
  if (!d) return '';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    const day = String(dt.getUTCDate()).padStart(2, '0');
    const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const year = dt.getUTCFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return '';
  }
}

/** Format a numeric value as 2 d.p. string, or blank if null/NaN. */
function formatAmount(n: unknown): string {
  if (n == null || n === '') return '';
  const num = Number(n);
  if (isNaN(num)) return '';
  return num.toFixed(2);
}

/** Wrap a CSV cell in quotes if it contains commas, quotes or newlines. */
function csvCell(value: unknown): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validatePo(
  po: Record<string, unknown>,
  nominalLines: Record<string, unknown>[],
  vatLines: Record<string, unknown>[],
): ValidationResult {
  const errors: string[] = [];
  const TOLERANCE = 0.02; // 2p rounding tolerance

  const net = Number(po.net_amount ?? 0);
  const vat = Number(po.vat_amount ?? 0);
  const gross = Number(po.gross_amount ?? 0);

  if (gross <= 0) errors.push('Gross amount must be greater than 0');

  // Net + VAT = Gross
  if (Math.abs(net + vat - gross) > TOLERANCE) {
    errors.push(`Net (${net.toFixed(2)}) + VAT (${vat.toFixed(2)}) ≠ Gross (${gross.toFixed(2)})`);
  }

  // Nominal lines total should equal net (only checked when lines exist)
  if (nominalLines.length > 0) {
    const nominalSum = nominalLines.reduce((s, l) => s + Number(l.transaction_value ?? 0), 0);
    if (Math.abs(nominalSum - net) > TOLERANCE) {
      errors.push(`Nominal lines total (${nominalSum.toFixed(2)}) ≠ Net (${net.toFixed(2)})`);
    }
  }

  // VAT analysis total should equal vat amount (only checked when lines exist)
  if (vatLines.length > 0) {
    const vatSum = vatLines.reduce((s, l) => s + Number(l.tax_on_goods_value ?? 0), 0);
    if (Math.abs(vatSum - vat) > TOLERANCE) {
      errors.push(`VAT analysis total (${vatSum.toFixed(2)}) ≠ VAT (${vat.toFixed(2)})`);
    }
  }

  // Required fields
  if (!po.supplier_name) errors.push('Supplier Name is required');
  if (!po.transaction_date) errors.push('Transaction Date is required');

  return { valid: errors.length === 0, errors };
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const { user, error: authError } = await getUserFromRequest(req);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let purchase_order_ids: string[];
  try {
    const body = await req.json();
    purchase_order_ids = body.purchase_order_ids;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!purchase_order_ids?.length) {
    return new Response(JSON.stringify({ error: 'purchase_order_ids array required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Fetch approved POs — only the PO fields are needed; no joins required
    const { data: pos, error: posError } = await supabaseAdmin
      .from('purchase_orders')
      .select('*')
      .in('id', purchase_order_ids)
      .in('status', ['approved', 'approved_ready_export']);

    if (posError) throw new Error(`Failed to fetch POs: ${posError.message}`);
    if (!pos?.length) throw new Error('No approved POs found with the given IDs');

    const validationSummary: Record<string, ValidationResult> = {};
    const csvRows: string[][] = [];
    // PostedDate = today (the date we are generating the export for Sage)
    const exportDateIso = new Date().toISOString();

    for (const po of pos) {
      const { data: nominalLines } = await supabaseAdmin
        .from('nominal_lines')
        .select('*')
        .eq('purchase_order_id', po.id)
        .order('line_number');

      const { data: vatLines } = await supabaseAdmin
        .from('vat_lines')
        .select('*')
        .eq('purchase_order_id', po.id)
        .order('line_number');

      const nl = (nominalLines ?? []) as Record<string, unknown>[];
      const vl = (vatLines ?? []) as Record<string, unknown>[];

      const validation = validatePo(po as Record<string, unknown>, nl, vl);
      validationSummary[po.id] = validation;
      if (!validation.valid) continue;

      const n1 = nl.find((l) => l.line_number === 1);
      const n2 = nl.find((l) => l.line_number === 2);
      const v1 = vl.find((l) => l.line_number === 1);
      const v2 = vl.find((l) => l.line_number === 2);

      // Sage narrative format (matches GSG_PI_Upload_Original.csv): the supplier
      // account code, zero-padded to 8 digits, then " - ", then the description.
      // e.g. account 733 + "Zioxi …" → "00000733 - Zioxi …"
      const acct8 = String(po.account_number ?? '').trim().padStart(8, '0');
      const narrative = (text: unknown): string => {
        const t = String(text ?? '').trim();
        if (!t) return '';
        // Don't double-prefix if the text already starts with the padded code.
        return t.startsWith(acct8) ? t : `${acct8} - ${t}`;
      };

      // ── Build the 46-column Sage 200 PI row ────────────────────────────────
      // Column order matches SAGE_HEADERS exactly.
      // Mapping source: GSG_PI_Upload_Claude.csv rows 2 & 3.
      const row: string[] = [
        //  1. AccountNumber — supplier's Sage account code
        po.account_number ?? '',
        //  2. CBAccountNumber — blank
        '',
        //  3. DaysDiscountValid — blank
        '',
        //  4. DiscountValue — blank
        '',
        //  5. DiscountPercentage — blank
        '',
        //  6. DueDate — DD/MM/YYYY
        formatDate(po.due_date as string),
        //  7. GoodsValueInAccountCurrency — gross invoice total
        formatAmount(po.gross_amount),
        //  8. PurControlValueInBaseCurrency — gross invoice total (GBP = account currency)
        formatAmount(po.gross_amount),
        //  9. DocumentToBaseCurrencyRate — 1 (GBP only)
        '1',
        // 10. DocumentToAccountCurrencyRate — 1 (GBP only)
        '1',
        // 11. PostedDate — invoice posting date (falls back to export date)
        formatDate((po.posting_date as string) || exportDateIso),
        // 12. QueryCode — blank
        '',
        // 13. TransactionReference — invoice number
        po.transaction_reference ?? '',
        // 14. SecondReference — PO second reference (e.g. school/source code RPPS, KGPS)
        po.second_reference ?? '',
        // 15. Source — 2 (Purchase Invoice)
        '2',
        // 16. SYSTraderTranType — 4 (Purchase Invoice)
        '4',
        // 17. TransactionDate — invoice date, DD/MM/YYYY
        formatDate(po.transaction_date as string),
        // 18. UniqueReferenceNumber — blank
        '',
        // 19. UserNumber — blank
        '',
        // 20. TaxValue — VAT amount
        formatAmount(po.vat_amount),
        // 21. SYSTraderGenerationReasonType — 0
        '0',
        // 22. GoodsValueInBaseCurrency — NET goods value (matches original Sage file)
        formatAmount(po.net_amount),
        // 23. NominalAnalysisTransactionValue/1 — nominal line 1 value (defaults to net)
        formatAmount(n1?.transaction_value ?? po.net_amount),
        // 24. NominalAnalysisNominalAccountNumber/1 — nominal account code
        (n1?.nominal_account_number as string) ?? '',
        // 25. NominalAnalysisNominalCostCentre/1 — cost centre
        (n1?.nominal_cost_centre as string) ?? '',
        // 26. NominalAnalysisNominalDepartment/1 — department
        (n1?.nominal_department as string) ?? '',
        // 27. NominalAnalysisNominalAnalysisNarrative/1 — "{acct} - {description}"
        narrative((n1?.nominal_analysis_narrative as string) || po.description),
        // 28. NominalAnalysisTransactionAnalysisCode/1 — analysis code from line 1
        (n1?.transaction_analysis_code as string) ?? '',
        // 29. NominalAnalysisTransactionValue/2 — nominal line 2 value (blank if none)
        formatAmount(n2?.transaction_value),
        // 30. NominalAnalysisNominalAccountNumber/2 — nominal account code line 2
        (n2?.nominal_account_number as string) ?? '',
        // 31. NominalAnalysisNominalCostCentre/2 — cost centre line 2
        (n2?.nominal_cost_centre as string) ?? '',
        // 32. NominalAnalysisNominalDepartment/2 — department line 2
        (n2?.nominal_department as string) ?? '',
        // 33. NominalAnalysisNominalAnalysisNarrative/2 — "{acct} - {narrative}"
        n2 ? narrative(n2?.nominal_analysis_narrative) : '',
        // 34. TaxAnalysisTaxRate/1 — Sage tax code from VAT line 1 (0/1/2…)
        (v1?.vat_code as string) ?? '',
        // 35. TaxAnalysisGoodsValueBeforeDiscount/1 — NET goods (matches original Sage file)
        formatAmount(v1?.goods_value_before_discount ?? po.net_amount),
        // 36. TaxAnalysisDiscountValue/1 — blank
        '',
        // 37. TaxAnalysisDiscountPercentage/1 — blank
        '',
        // 38. TaxAnalysisTaxOnGoodsValue/1 — VAT amount
        formatAmount(v1?.tax_on_goods_value ?? po.vat_amount),
        // 39. TaxAnalysisTaxRate/2 — Sage tax code from VAT line 2
        (v2?.vat_code as string) ?? '',
        // 40. TaxAnalysisGoodsValueBeforeDiscount/2 — NET goods, VAT line 2
        formatAmount(v2?.goods_value_before_discount),
        // 41. TaxAnalysisDiscountValue/2 — blank
        '',
        // 42. TaxAnalysisDiscountPercentage/2 — blank
        '',
        // 43. TaxAnalysisTaxOnGoodsValue/2 — VAT amount, line 2
        formatAmount(v2?.tax_on_goods_value),
        // 44. ChequeCurrencyName — blank
        '',
        // 45. ChequeToBankExchangeRate — blank
        '',
        // 46. ChequeValueInChequeCurrency — blank
        '',
      ];

      csvRows.push(row);
    }

    // ── Report validation failures before generating anything ─────────────────
    const failedIds = Object.entries(validationSummary)
      .filter(([, v]) => !v.valid)
      .map(([id, v]) => ({ id, errors: v.errors }));

    if (failedIds.length > 0) {
      return new Response(
        JSON.stringify({ error: 'Validation failed', failures: failedIds }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (csvRows.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid records to export' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Build CSV ──────────────────────────────────────────────────────────────
    const csvContent = [
      SAGE_HEADERS.join(','),
      ...csvRows.map((row) => row.map(csvCell).join(',')),
    ].join('\r\n');

    const csvBytes = new TextEncoder().encode(csvContent);

    // ── Upload to Supabase Storage ─────────────────────────────────────────────
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const storagePath = `exports/${timestamp}_sage200_${csvRows.length}records.csv`;

    const { error: storageError } = await supabaseAdmin.storage
      .from('csv-exports')
      .upload(storagePath, csvBytes, {
        contentType: 'text/csv',
        upsert: false,
      });

    if (storageError) throw new Error(`CSV storage upload failed: ${storageError.message}`);

    // ── Create csv_exports record ──────────────────────────────────────────────
    const { data: exportRecord, error: exportError } = await supabaseAdmin
      .from('csv_exports')
      .insert({
        storage_path: storagePath,
        bucket_name: 'csv-exports',
        record_count: csvRows.length,
        validation_summary: validationSummary,
        generated_by_id: user.id,
      })
      .select()
      .single();

    if (exportError) throw new Error(`Failed to create export record: ${exportError.message}`);

    const now = new Date().toISOString();
    const validIds = pos
      .filter((po) => validationSummary[po.id]?.valid)
      .map((po) => po.id);

    // ── Mark POs as exported ───────────────────────────────────────────────────
    await supabaseAdmin
      .from('purchase_orders')
      .update({
        status: 'exported',
        exported_at: now,
        exported_by_id: user.id,
        csv_export_id: exportRecord.id,
      })
      .in('id', validIds);

    // ── Audit log ──────────────────────────────────────────────────────────────
    const { data: actorProfile } = await supabaseAdmin
      .from('profiles')
      .select('email, display_name')
      .eq('id', user.id)
      .single();

    for (const id of validIds) {
      await supabaseAdmin.from('audit_log').insert({
        purchase_order_id: id,
        action: 'exported',
        actor_id: user.id,
        actor_email: actorProfile?.email ?? user.email,
        actor_display: actorProfile?.display_name,
        new_values: {
          status: 'exported',
          csv_export_id: exportRecord.id,
          storage_path: storagePath,
        },
      });
    }

    // ── Signed download URL (1 hour) ───────────────────────────────────────────
    const { data: signedUrl } = await supabaseAdmin.storage
      .from('csv-exports')
      .createSignedUrl(storagePath, 3600);

    return new Response(
      JSON.stringify({
        success: true,
        export_id: exportRecord.id,
        record_count: csvRows.length,
        download_url: signedUrl?.signedUrl,
        storage_path: storagePath,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[generate-csv] Error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
