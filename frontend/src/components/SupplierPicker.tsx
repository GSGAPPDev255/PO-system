import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface Supplier {
  code: string;
  short_name: string | null;
  name: string;
  contact_email: string | null;
  payment_group: string | null;
}

interface Props {
  value: string;                                 // current supplier_ref_code
  onChange: (code: string) => void;              // updates supplier_ref_code
  onSelect?: (supplier: Supplier) => void;       // optional: when a row is picked
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  style?: React.CSSProperties;
}

// Shared in-memory cache so we only fetch the list once per session.
let cache: Supplier[] | null = null;
let cachePromise: Promise<Supplier[]> | null = null;

async function loadSuppliers(): Promise<Supplier[]> {
  if (cache) return cache;
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    const { data, error } = await supabase
      .from('suppliers')
      .select('code, short_name, name, contact_email, payment_group')
      .eq('is_active', true)
      .order('name', { ascending: true });
    if (error) {
      console.error('Failed to load suppliers:', error.message);
      return [];
    }
    cache = (data ?? []) as Supplier[];
    return cache;
  })();
  return cachePromise;
}

export default function SupplierPicker({
  value,
  onChange,
  onSelect,
  disabled,
  placeholder = 'Type code or name…',
  label,
  style,
}: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [query, setQuery]         = useState(value ?? '');
  const [open, setOpen]           = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value ?? ''); }, [value]);
  useEffect(() => { void loadSuppliers().then(setSuppliers); }, []);

  // Close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.length < 1) return [];
    const matches = suppliers.filter(s =>
      s.code.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      (s.short_name?.toLowerCase().includes(q) ?? false),
    );
    return matches.slice(0, 50);
  }, [query, suppliers]);

  function pick(s: Supplier) {
    onChange(s.code);
    onSelect?.(s);
    setQuery(s.code);
    setOpen(false);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[activeIdx]) {
      e.preventDefault();
      pick(filtered[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...style }}>
      {label && <label style={lblStyle}>{label}</label>}
      <input
        type="text"
        value={query}
        disabled={disabled}
        readOnly={disabled}
        placeholder={placeholder}
        onFocus={() => !disabled && setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
          setActiveIdx(0);
        }}
        onKeyDown={handleKey}
        style={inpStyle(disabled)}
      />
      {open && !disabled && filtered.length > 0 && (
        <div style={menuStyle}>
          {filtered.map((s, i) => (
            <div
              key={s.code}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                ...rowStyle,
                background: i === activeIdx ? 'var(--paper)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-text)', fontSize: 12, flexShrink: 0 }}>
                  {s.code}
                </span>
                <span style={{ fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name}
                </span>
              </div>
              {s.payment_group && s.payment_group !== 'supplier' && (
                <span style={tagStyle}>{s.payment_group}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {open && !disabled && filtered.length === 0 && (
        <div style={menuStyle}>
          <div style={{ ...rowStyle, color: 'var(--ink-faint)', fontStyle: 'italic' }}>
            {query.trim().length < 1
              ? 'Type a code or supplier name to search…'
              : `No suppliers match "${query}"`}
          </div>
        </div>
      )}
    </div>
  );
}

const lblStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--ink-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
  marginBottom: 6,
};

function inpStyle(disabled?: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: '10px 12px',
    fontSize: 13,
    fontFamily: 'var(--font-mono)',
    background: disabled ? 'var(--paper)' : 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 6,
    color: 'var(--ink)',
    outline: 'none',
    boxSizing: 'border-box',
    cursor: disabled ? 'default' : 'text',
  };
}

const menuStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0, right: 0,
  background: 'var(--paper-bright)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
  maxHeight: 320,
  overflowY: 'auto',
  zIndex: 50,
};

const rowStyle: React.CSSProperties = {
  padding: '9px 12px',
  cursor: 'pointer',
  borderBottom: '1px solid var(--line)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
};

const tagStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--accent-text)',
  background: 'var(--accent-soft, rgba(0,180,216,0.12))',
  padding: '2px 7px',
  borderRadius: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  flexShrink: 0,
};
