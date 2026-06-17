import type { VatLine } from '../../lib/supabase';

interface VatLineEditorProps {
  lineNumber: 1 | 2;
  value: Partial<VatLine>;
  onChange: (updates: Partial<VatLine>) => void;
  readOnly?: boolean;
}

export default function VatLineEditor({
  lineNumber, value, onChange, readOnly = false,
}: VatLineEditorProps) {
  const inputStyle = (mono: boolean): React.CSSProperties => ({
    ...styles.input,
    ...(mono ? { fontFamily: 'var(--font-mono)', fontSize: 12.5 } : {}),
    ...(readOnly ? styles.inputReadOnly : {}),
  });

  const num = (key: keyof VatLine, label: string) => (
    <div style={styles.field} key={key}>
      <label style={styles.label}>{label}</label>
      <input
        type="number"
        style={inputStyle(true)}
        value={String(value[key] ?? '')}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => onChange({ [key]: parseFloat(e.target.value) || null })}
      />
    </div>
  );

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.lineTag}>VAT {lineNumber.toString().padStart(2, '0')}</span>
        <span style={styles.rule} />
      </div>
      <div style={styles.grid}>
        {num('tax_rate', 'Tax Rate (%)')}
        <div style={styles.field}>
          <label style={styles.label}>VAT Code (Sage)</label>
          <select
            style={{ ...inputStyle(true), ...(!readOnly ? {} : styles.inputReadOnly) }}
            value={String(value.vat_code ?? '')}
            disabled={readOnly}
            onChange={(e) => onChange({ vat_code: e.target.value || null })}
          >
            <option value="">—</option>
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </div>
        {num('goods_value_before_discount', 'Goods Value Before Discount')}
        {num('tax_on_goods_value', 'Tax on Goods Value')}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: '1px dashed var(--line-strong)',
    borderRadius: 8,
    padding: '16px 18px',
    marginBottom: 12,
    background: 'var(--paper)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  lineTag: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    color: 'var(--accent)',
    fontWeight: 600,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
  },
  rule: { flex: 1, height: 1, background: 'var(--line)' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 18px' },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: {
    fontSize: 10,
    color: 'var(--ink-faint)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
  },
  input: {
    padding: '8px 11px',
    border: '1px solid var(--line-strong)',
    borderRadius: 6,
    fontSize: 13,
    background: 'var(--paper-bright)',
    color: 'var(--ink)',
    outline: 'none',
    transition: 'border-color 0.15s var(--ease)',
  },
  inputReadOnly: {
    background: 'transparent',
    color: 'var(--ink-soft)',
    cursor: 'default',
  },
};
