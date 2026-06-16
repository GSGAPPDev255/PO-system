import type { NominalLine } from '../../lib/supabase';
import NominalCodePicker, { type NominalCode } from '../NominalCodePicker';

interface NominalLineEditorProps {
  lineNumber: 1 | 2;
  value: Partial<NominalLine>;
  onChange: (updates: Partial<NominalLine>) => void;
  readOnly?: boolean;
  company?: string | null;       // scopes the UniCode picker
  requireUniCode?: boolean;      // mark UniCode mandatory + flag when empty
}

export default function NominalLineEditor({
  lineNumber, value, onChange, readOnly = false, company, requireUniCode = false,
}: NominalLineEditorProps) {
  const uniCodeMissing = requireUniCode && !String(value.transaction_analysis_code ?? '').trim();
  const f = (key: keyof NominalLine, label: string, type: 'text' | 'number' = 'text') => (
    <div style={styles.field} key={key}>
      <label style={styles.label}>{label}</label>
      <input
        type={type}
        style={{
          ...styles.input,
          ...(type === 'number' ? { fontFamily: 'var(--font-mono)', fontSize: 12.5 } : {}),
          ...(readOnly ? styles.inputReadOnly : {}),
        }}
        value={String(value[key] ?? '')}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => onChange({ [key]: type === 'number' ? parseFloat(e.target.value) || null : e.target.value || null })}
      />
    </div>
  );

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.lineTag}>Line {lineNumber.toString().padStart(2, '0')}</span>
        <span style={styles.rule} />
      </div>
      <div style={styles.grid}>
        {/* UniCode picker — fills Cost Centre (Acct Code) and Department (Account Name) */}
        <div style={{ ...styles.field, gridColumn: '1 / -1' }} key="unicode">
          <label style={styles.label}>
            UniCode{requireUniCode ? ' *' : ''}
          </label>
          <NominalCodePicker
            value={String(value.transaction_analysis_code ?? '')}
            company={company}
            disabled={readOnly}
            invalid={uniCodeMissing}
            onChange={(code) => onChange({ transaction_analysis_code: code || null })}
            onSelect={(c: NominalCode) => onChange({
              transaction_analysis_code: c.unicode,
              nominal_cost_centre: c.acct_code ?? null,
              nominal_department: c.account_name ?? null,
            })}
          />
          {uniCodeMissing && (
            <span style={styles.warn}>Required — pick the UniCode from the list</span>
          )}
        </div>
        {f('transaction_value', 'Transaction Value', 'number')}
        {f('nominal_account_number', 'Account Number')}
        {f('nominal_cost_centre', 'Cost Centre')}
        {f('nominal_department', 'Department')}
        {f('nominal_analysis_narrative', 'Narrative')}
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
  warn: {
    fontSize: 10.5,
    color: 'var(--danger)',
    marginTop: 2,
  },
};
