import { Fragment } from 'react';
import type { OcrExtraction, PurchaseOrder } from '../../lib/supabase';

interface OcrComparisonPanelProps {
  ocr: OcrExtraction | null;
  po: PurchaseOrder;
}

const FIELD_MAP: { label: string; ocrKey: string; poKey: keyof PurchaseOrder }[] = [
  { label: 'Supplier Name',     ocrKey: 'supplier_name',   poKey: 'supplier_name' },
  { label: 'Invoice Number',    ocrKey: 'invoice_number',  poKey: 'transaction_reference' },
  { label: 'Invoice Date',      ocrKey: 'invoice_date',    poKey: 'transaction_date' },
  { label: 'Description',       ocrKey: 'description',     poKey: 'description' },
  { label: 'Net Amount',        ocrKey: 'net_amount',      poKey: 'net_amount' },
  { label: 'VAT Amount',        ocrKey: 'vat_amount',      poKey: 'vat_amount' },
  { label: 'Gross Amount',      ocrKey: 'gross_amount',    poKey: 'gross_amount' },
  { label: 'Account Number',    ocrKey: 'account_number',  poKey: 'account_number' },
  { label: 'Supplier Ref',      ocrKey: 'supplier_ref',    poKey: 'supplier_ref' },
  { label: 'Due Date',          ocrKey: 'due_date',        poKey: 'due_date' },
];

export default function OcrComparisonPanel({ ocr, po }: OcrComparisonPanelProps) {
  if (!ocr) {
    return (
      <div style={styles.card}>
        <div style={styles.kicker}>§ AI Extraction</div>
        <p style={styles.emptyMsg}>No extraction data available yet.</p>
      </div>
    );
  }

  const fields = ocr.extracted_fields as Record<string, unknown>;

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>§ AI Extraction</div>
          <h3 style={styles.title}>AI Read · Finance Verified</h3>
        </div>
        <div style={styles.metaPill}>
          <span style={styles.metaModel}>Claude Haiku</span>
          <span style={styles.metaDot}>·</span>
          <span style={styles.metaMs}>{ocr.processing_ms}ms</span>
        </div>
      </div>

      <div style={styles.grid}>
        <div style={styles.colHeader}>Field</div>
        <div style={styles.colHeader}>AI Extracted</div>
        <div style={styles.colHeader}>Finance Value</div>

        {FIELD_MAP.map(({ label, ocrKey, poKey }, idx) => {
          const ocrVal = fields[ocrKey];
          const financeVal = po[poKey];
          const differs = ocrVal != null && financeVal != null &&
            String(ocrVal) !== String(financeVal);
          const last = idx === FIELD_MAP.length - 1;

          return (
            <Fragment key={label}>
              <div style={{ ...styles.cell, ...styles.cellLabel, ...(last ? styles.cellLast : {}) }}>
                {label}
              </div>
              <div style={{
                ...styles.cell,
                ...styles.cellMono,
                ...(last ? styles.cellLast : {}),
              }}>
                {ocrVal != null ? String(ocrVal) : <span style={styles.emDash}>—</span>}
              </div>
              <div style={{
                ...styles.cell,
                ...styles.cellMono,
                ...(differs ? styles.cellEdited : {}),
                ...(last ? styles.cellLast : {}),
              }}>
                {financeVal != null ? String(financeVal) : <span style={styles.emDash}>—</span>}
                {differs && <span style={styles.editedTag}>edited</span>}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '20px 22px',
    marginBottom: 16,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
    gap: 16,
    flexWrap: 'wrap',
  },
  kicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    color: 'var(--accent)',
    fontWeight: 500,
    letterSpacing: '0.14em',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  title: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 22,
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.015em',
  },
  metaPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 10px',
    background: 'var(--paper)',
    border: '1px solid var(--line)',
    borderRadius: 999,
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    color: 'var(--ink-muted)',
  },
  metaModel: { fontWeight: 600 },
  metaDot: { color: 'var(--ink-faint)' },
  metaMs: { color: 'var(--ink-faint)' },
  emptyMsg: {
    margin: 0,
    fontSize: 13,
    color: 'var(--ink-muted)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '150px 1fr 1fr',
    border: '1px solid var(--line)',
    borderRadius: 7,
    overflow: 'hidden',
  },
  colHeader: {
    padding: '9px 12px',
    background: 'var(--paper)',
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--ink-faint)',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    borderBottom: '1px solid var(--line)',
  },
  cell: {
    padding: '9px 12px',
    fontSize: 12.5,
    borderBottom: '1px solid var(--line)',
    lineHeight: 1.4,
    color: 'var(--ink)',
  },
  cellLabel: {
    color: 'var(--ink-muted)',
    fontWeight: 500,
    background: 'var(--paper)',
  },
  cellMono: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--ink-soft)',
  },
  cellEdited: {
    background: 'var(--accent-soft)',
    color: 'var(--accent-text)',
    fontWeight: 600,
  },
  cellLast: { borderBottom: 'none' },
  emDash: { color: 'var(--ink-faint)', fontFamily: 'var(--font-display)' },
  editedTag: {
    marginLeft: 8,
    fontSize: 9,
    fontFamily: 'var(--font-sans)',
    color: 'var(--accent)',
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    fontWeight: 700,
  },
};
