import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface NominalCode {
  unicode: string;
  account_name: string | null;
  acct_code: string | null;
  cost_centre: string | null;
  dept: string | null;
}

interface Props {
  value: string;                              // current UniCode
  company?: string | null;                    // scope: this company's codes
  onChange: (unicode: string) => void;
  onSelect?: (code: NominalCode) => void;
  disabled?: boolean;
  invalid?: boolean;                          // red border when required & empty
}

// Cache one list per company slug.
const cache = new Map<string, NominalCode[]>();
const cachePromise = new Map<string, Promise<NominalCode[]>>();

async function loadCodes(company: string): Promise<NominalCode[]> {
  if (cache.has(company)) return cache.get(company)!;
  if (cachePromise.has(company)) return cachePromise.get(company)!;
  const promise = (async () => {
    const { data, error } = await supabase
      .from('nominal_codes')
      .select('unicode, account_name, acct_code, cost_centre, dept')
      .eq('company', company)
      .eq('in_use', true)
      .order('unicode', { ascending: true });
    if (error) { console.error('Failed to load nominal codes:', error.message); return []; }
    const list = (data ?? []) as NominalCode[];
    cache.set(company, list);
    return list;
  })();
  cachePromise.set(company, promise);
  return promise;
}

export default function NominalCodePicker({
  value, company, onChange, onSelect, disabled, invalid,
}: Props) {
  const [codes, setCodes] = useState<NominalCode[]>([]);
  const [query, setQuery] = useState(value ?? '');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value ?? ''); }, [value]);
  useEffect(() => {
    if (company) void loadCodes(company).then(setCodes);
    else setCodes([]);
  }, [company]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return codes.slice(0, 50);
    return codes.filter(c =>
      c.unicode.toLowerCase().includes(q) ||
      (c.account_name?.toLowerCase().includes(q) ?? false) ||
      (c.acct_code?.toLowerCase().includes(q) ?? false),
    ).slice(0, 50);
  }, [query, codes]);

  function pick(c: NominalCode) {
    onChange(c.unicode);
    onSelect?.(c);
    setQuery(c.unicode);
    setOpen(false);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && filtered[activeIdx]) { e.preventDefault(); pick(filtered[activeIdx]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={query}
        disabled={disabled}
        readOnly={disabled}
        placeholder={company ? 'Search UniCode or account…' : 'No company'}
        onFocus={() => !disabled && setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); setActiveIdx(0); }}
        onKeyDown={handleKey}
        style={{ ...inpStyle, ...(invalid ? invalidStyle : {}), ...(disabled ? roStyle : {}) }}
      />
      {open && !disabled && filtered.length > 0 && (
        <div style={menuStyle}>
          {filtered.map((c, i) => (
            <div
              key={c.unicode}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              onMouseEnter={() => setActiveIdx(i)}
              style={{ ...rowStyle, background: i === activeIdx ? 'var(--paper)' : 'transparent' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 600, color: 'var(--accent-text)', flexShrink: 0 }}>
                {c.unicode.split('-')[0]}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.account_name}
              </span>
            </div>
          ))}
        </div>
      )}
      {open && !disabled && company && filtered.length === 0 && query.trim().length > 0 && (
        <div style={menuStyle}>
          <div style={{ ...rowStyle, color: 'var(--ink-faint)', fontStyle: 'italic' }}>
            No code matches "{query}"
          </div>
        </div>
      )}
    </div>
  );
}

const inpStyle: React.CSSProperties = {
  width: '100%', padding: '8px 11px', border: '1px solid var(--line-strong)',
  borderRadius: 6, fontSize: 12.5, fontFamily: 'var(--font-mono)',
  background: 'var(--paper-bright)', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box',
};
const invalidStyle: React.CSSProperties = { borderColor: 'var(--danger)', background: 'var(--danger-soft)' };
const roStyle: React.CSSProperties = { background: 'transparent', color: 'var(--ink-soft)', cursor: 'default' };
const menuStyle: React.CSSProperties = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
  background: 'var(--paper-bright)', border: '1px solid var(--line)', borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,0.10)', maxHeight: 300, overflowY: 'auto', zIndex: 50,
};
const rowStyle: React.CSSProperties = {
  padding: '8px 11px', cursor: 'pointer', borderBottom: '1px solid var(--line)',
  display: 'flex', alignItems: 'center', gap: 10,
};
