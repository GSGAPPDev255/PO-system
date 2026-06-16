import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Props {
  companySlug: string;
  companyName: string;
}

interface ImportResult {
  total: number;
  skipped: number;
}

// Minimal RFC-4180 CSV parser.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export default function NominalCodeImport({ companySlug, companyName }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCount = async () => {
    const { count: c } = await supabase
      .from('nominal_codes')
      .select('unicode', { count: 'exact', head: true })
      .eq('company', companySlug);
    setCount(c ?? 0);
  };

  useEffect(() => { void loadCount(); }, [companySlug]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;

    setBusy(true);
    setError(null);
    setResult(null);
    setProgress('Reading file…');
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length < 2) throw new Error('CSV looks empty.');
      rows.shift(); // header: Account Name, Acct Code, Cost Centre, Dept, Approver1, Approver2, In use, UniCode, Notes

      const byUni = new Map<string, {
        company: string; unicode: string; account_name: string | null; acct_code: string | null;
        cost_centre: string | null; dept: string | null; approver1: string | null;
        approver2: string | null; in_use: boolean; notes: string | null;
      }>();
      let skipped = 0;
      for (const r of rows) {
        const v = r.map(x => (x ?? '').trim());
        const [accountName, acctCode, costCentre, dept, app1, app2, inUse, unicode, notes] = v;
        if (!unicode) { skipped++; continue; }
        byUni.set(unicode, {
          company: companySlug, unicode,
          account_name: accountName || null, acct_code: acctCode || null,
          cost_centre: costCentre || null, dept: dept || null,
          approver1: app1 || null, approver2: app2 || null,
          in_use: inUse ? /^true$/i.test(inUse) : true,
          notes: notes || null,
        });
      }
      const list = [...byUni.values()];
      if (list.length === 0) throw new Error('No valid rows (need a UniCode column).');

      const CHUNK = 500;
      for (let i = 0; i < list.length; i += CHUNK) {
        setProgress(`Importing ${Math.min(i + CHUNK, list.length)} / ${list.length}…`);
        const { error: upErr } = await supabase
          .from('nominal_codes')
          .upsert(list.slice(i, i + CHUNK), { onConflict: 'company,unicode' });
        if (upErr) throw upErr;
      }

      setResult({ total: list.length, skipped });
      setProgress('');
      await loadCount();
    } catch (err) {
      setError((err as Error).message);
      setProgress('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <span style={styles.label}>Nominal codes</span>
        <span style={styles.count}>{count == null ? '…' : `${count.toLocaleString()} on file`}</span>
      </div>
      <p style={styles.hint}>
        Import {companyName}'s chart of accounts — CSV with columns{' '}
        <code>Account Name, Acct Code, Cost Centre, Dept, Approver1, Approver2, In use, UniCode, Notes</code>.
        UniCode is the unique key; existing codes are updated.
      </p>
      <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={onFile} />
      <button className="btn" style={styles.btn} disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? (progress || 'Importing…') : '⬆ Import nominal codes (CSV)'}
      </button>
      {result && (
        <div style={styles.ok}>
          ✓ Imported {result.total.toLocaleString()} nominal codes for {companyName}
          {result.skipped > 0 ? ` (${result.skipped} blank rows skipped)` : ''}.
        </div>
      )}
      {error && <div style={styles.err}>⚠️ {error}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { borderTop: '1px solid var(--line)', padding: '14px 20px 4px' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  label: { fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.16em' },
  count: { fontSize: 11.5, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)' },
  hint: { margin: '0 0 10px', fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.5 },
  btn: {
    padding: '8px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
    background: 'var(--accent-3)', color: '#fff', border: 'none', borderRadius: 6,
  },
  ok: {
    marginTop: 10, fontSize: 12.5, color: 'var(--success, #0a0)',
    background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)',
    borderRadius: 6, padding: '8px 12px',
  },
  err: {
    marginTop: 10, fontSize: 12.5, color: 'var(--danger, #c00)',
    background: 'rgba(244,63,94,0.07)', border: '1px solid rgba(244,63,94,0.2)',
    borderRadius: 6, padding: '8px 12px',
  },
};
