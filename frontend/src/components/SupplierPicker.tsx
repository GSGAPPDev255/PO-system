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
  company?: string | null;                       // scope: only this company's suppliers
  onChange: (code: string) => void;              // updates supplier_ref_code
  onSelect?: (supplier: Supplier) => void;       // optional: when a row is picked
  disabled?: boolean;
  allowCreate?: boolean;                         // show "+ Add new supplier" option
  placeholder?: string;
  label?: string;
  style?: React.CSSProperties;
}

// Supplier lists are scoped per company, so cache one list per company slug.
const cache = new Map<string, Supplier[]>();
const cachePromise = new Map<string, Promise<Supplier[]>>();

async function loadSuppliers(company: string): Promise<Supplier[]> {
  if (cache.has(company)) return cache.get(company)!;
  if (cachePromise.has(company)) return cachePromise.get(company)!;
  const promise = (async () => {
    const { data, error } = await supabase
      .from('suppliers')
      .select('code, short_name, name, contact_email, payment_group')
      .eq('is_active', true)
      .eq('company', company)
      .order('name', { ascending: true });
    if (error) {
      console.error('Failed to load suppliers:', error.message);
      return [];
    }
    const list = (data ?? []) as Supplier[];
    cache.set(company, list);
    return list;
  })();
  cachePromise.set(company, promise);
  return promise;
}

function bustCache(company: string) {
  cache.delete(company);
  cachePromise.delete(company);
}

export default function SupplierPicker({
  value,
  company,
  onChange,
  onSelect,
  disabled,
  allowCreate = false,
  placeholder = 'Type code or name…',
  label,
  style,
}: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [query, setQuery]         = useState(value ?? '');
  const [open, setOpen]           = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Create-new form state
  const [creating, setCreating]     = useState(false);
  const [newCode, setNewCode]       = useState('');
  const [newName, setNewName]       = useState('');
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError]   = useState<string | null>(null);

  useEffect(() => { setQuery(value ?? ''); }, [value]);
  useEffect(() => {
    if (company) void loadSuppliers(company).then(setSuppliers);
    else setSuppliers([]);
  }, [company]);

  // Close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
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
    setCreating(false);
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

  function openCreateForm() {
    setCreating(true);
    setNewCode(query.trim().toUpperCase());
    setNewName('');
    setCreateError(null);
    setOpen(false);
  }

  function cancelCreate() {
    setCreating(false);
    setNewCode('');
    setNewName('');
    setCreateError(null);
  }

  async function handleCreate() {
    const code = newCode.trim().toUpperCase();
    const name = newName.trim();
    if (!code || !name) {
      setCreateError('Both code and name are required.');
      return;
    }
    if (!company) {
      setCreateError('No company set for this invoice — cannot add a supplier.');
      return;
    }
    setCreateSaving(true);
    setCreateError(null);

    const { data, error } = await supabase
      .from('suppliers')
      .insert({ code, name, company, is_active: true })
      .select('code, short_name, name, contact_email, payment_group')
      .single();

    if (error) {
      setCreateError(
        error.code === '23505'
          ? `Code "${code}" already exists for this company — search for it above.`
          : error.message,
      );
      setCreateSaving(false);
      return;
    }

    // Bust this company's cache and reload
    bustCache(company);
    const updated = await loadSuppliers(company);
    setSuppliers(updated);

    pick(data as Supplier);
    setCreating(false);
    setNewCode('');
    setNewName('');
    setCreateSaving(false);
  }

  const showCreateOption = allowCreate && !disabled && !!company && open && query.trim().length >= 1;

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
          if (creating) cancelCreate();
        }}
        onKeyDown={handleKey}
        style={inpStyle(disabled)}
      />

      {/* Search results dropdown */}
      {open && !disabled && (filtered.length > 0 || showCreateOption || query.trim().length >= 1) && (
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

          {/* No results hint */}
          {filtered.length === 0 && query.trim().length >= 1 && !showCreateOption && (
            <div style={{ ...rowStyle, color: 'var(--ink-faint)', fontStyle: 'italic' }}>
              No suppliers match "{query}"
            </div>
          )}
          {filtered.length === 0 && query.trim().length >= 1 && showCreateOption && (
            <div style={{ ...rowStyle, color: 'var(--ink-faint)', fontStyle: 'italic', borderBottom: 'none' }}>
              No suppliers match "{query}"
            </div>
          )}

          {/* Create new option */}
          {showCreateOption && (
            <div
              style={createRowStyle}
              onMouseDown={(e) => { e.preventDefault(); openCreateForm(); }}
            >
              <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}>+ Add new supplier</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-muted)' }}>
                "{query.trim()}"
              </span>
            </div>
          )}

          {/* Empty state when no query */}
          {query.trim().length < 1 && (
            <div style={{ ...rowStyle, color: 'var(--ink-faint)', fontStyle: 'italic' }}>
              Type a code or supplier name to search…
            </div>
          )}
        </div>
      )}

      {/* Inline create form — shown below the picker when creating */}
      {creating && (
        <div style={createFormStyle}>
          <div style={createFormKicker}>§ New supplier</div>
          {createError && (
            <div style={createErrorStyle}>{createError}</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={createLblStyle}>Supplier code *</label>
              <input
                style={createInputStyle}
                value={newCode}
                placeholder="e.g. KEW003"
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                autoFocus
              />
            </div>
            <div>
              <label style={createLblStyle}>Supplier name *</label>
              <input
                style={createInputStyle}
                value={newName}
                placeholder="e.g. P & J Ellis Ltd"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); if (e.key === 'Escape') cancelCreate(); }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              style={createBtnStyle}
              disabled={createSaving}
              onMouseDown={(e) => { e.preventDefault(); void handleCreate(); }}
            >
              {createSaving ? 'Saving…' : 'Add supplier →'}
            </button>
            <button
              style={cancelBtnStyle}
              onMouseDown={(e) => { e.preventDefault(); cancelCreate(); }}
            >
              Cancel
            </button>
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

const createRowStyle: React.CSSProperties = {
  padding: '10px 12px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  background: 'rgba(0,180,216,0.04)',
  borderTop: '1px solid var(--line)',
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

const createFormStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0, right: 0,
  background: 'var(--paper-bright)',
  border: '1px solid var(--accent)',
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
  zIndex: 50,
  padding: '14px 16px',
};

const createFormKicker: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--accent)',
  textTransform: 'uppercase',
  letterSpacing: '0.15em',
  marginBottom: 10,
};

const createErrorStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--danger)',
  background: 'rgba(244,63,94,0.07)',
  border: '1px solid rgba(244,63,94,0.2)',
  borderRadius: 5,
  padding: '6px 10px',
  marginBottom: 10,
};

const createLblStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--ink-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.15em',
  marginBottom: 4,
};

const createInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'var(--font-mono)',
  background: 'var(--paper)',
  border: '1px solid var(--line)',
  borderRadius: 5,
  color: 'var(--ink)',
  outline: 'none',
  boxSizing: 'border-box',
};

const createBtnStyle: React.CSSProperties = {
  padding: '7px 14px',
  fontSize: 12,
  fontWeight: 600,
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 5,
  cursor: 'pointer',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '7px 14px',
  fontSize: 12,
  fontWeight: 600,
  background: 'transparent',
  color: 'var(--ink-muted)',
  border: '1px solid var(--line)',
  borderRadius: 5,
  cursor: 'pointer',
};
