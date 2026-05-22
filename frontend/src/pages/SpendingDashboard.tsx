import { useState, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';

type SpendRecord = {
  id: string;
  supplier_name: string | null;
  company: string | null;
  gross_amount: number | null;
  net_amount: number | null;
  transaction_date: string | null;
  status: string;
  created_at: string;
};

const SETTLED_STATUSES = ['approved', 'approved_ready_export', 'exported'];
const CHART_ACCENT = ['#00b4d8', '#06d6a0', '#7b61ff', '#f4a261', '#e76f51', '#a8dadc', '#ffb703', '#8ecae6'];

function fmtMoney(n: number) {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtMoneyShort(n: number) {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `£${(n / 1_000).toFixed(0)}k`;
  return `£${n.toFixed(0)}`;
}

// ── Bar Chart (horizontal) ────────────────────────────────────────────────────
function HBarChart({
  data, maxWidth = 420,
}: {
  data: { label: string; value: number; color: string }[];
  maxWidth?: number;
}) {
  if (data.length === 0) return <div style={emptyChart}>No data</div>;
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 120, fontSize: 11.5, fontWeight: 500,
            color: 'var(--ink-soft)', textAlign: 'right',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            flexShrink: 0,
          }} title={d.label}>
            {d.label}
          </div>
          <div style={{ flex: 1, height: 22, background: 'var(--paper)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--line)' }}>
            <div style={{
              width: `${(d.value / max) * 100}%`,
              maxWidth,
              height: '100%',
              background: d.color,
              borderRadius: 4,
              transition: 'width 0.5s cubic-bezier(.22,1,.36,1)',
              minWidth: d.value > 0 ? 4 : 0,
            }} />
          </div>
          <div style={{ width: 68, fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--ink-soft)', textAlign: 'right', flexShrink: 0 }}>
            {fmtMoneyShort(d.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Column Chart ──────────────────────────────────────────────────────────────
function ColChart({ data }: { data: { label: string; value: number }[] }) {
  if (data.length === 0) return <div style={emptyChart}>No data</div>;
  const max = Math.max(...data.map(d => d.value), 1);
  const BAR_W = Math.max(18, Math.min(48, Math.floor(340 / data.length) - 8));
  const HEIGHT = 140;

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <svg
        width={data.length * (BAR_W + 10) + 20}
        height={HEIGHT + 40}
        style={{ display: 'block' }}
      >
        {/* Gridlines */}
        {[0.25, 0.5, 0.75, 1].map(t => {
          const y = HEIGHT - t * HEIGHT;
          return (
            <g key={t}>
              <line x1={0} y1={y} x2={data.length * (BAR_W + 10) + 20} y2={y}
                stroke="var(--line)" strokeWidth={1} strokeDasharray="3 4" />
              <text x={0} y={y - 3} fontSize={8} fill="var(--ink-faint)" fontFamily="var(--font-mono)">
                {fmtMoneyShort(max * t)}
              </text>
            </g>
          );
        })}
        {/* Bars */}
        {data.map((d, i) => {
          const h = (d.value / max) * HEIGHT;
          const x = i * (BAR_W + 10) + 10;
          const y = HEIGHT - h;
          const color = CHART_ACCENT[i % CHART_ACCENT.length];
          return (
            <g key={i}>
              <rect x={x} y={y} width={BAR_W} height={h} fill={color} rx={3} opacity={0.85} />
              <text
                x={x + BAR_W / 2}
                y={HEIGHT + 16}
                fontSize={9}
                textAnchor="middle"
                fill="var(--ink-faint)"
                fontFamily="var(--font-mono)"
              >
                {d.label.length > 6 ? d.label.slice(0, 5) + '…' : d.label}
              </text>
            </g>
          );
        })}
        {/* Baseline */}
        <line x1={0} y1={HEIGHT} x2={data.length * (BAR_W + 10) + 20} y2={HEIGHT}
          stroke="var(--line-strong)" strokeWidth={1} />
      </svg>
    </div>
  );
}

// ── Donut Chart ───────────────────────────────────────────────────────────────
function DonutChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  if (data.length === 0) return <div style={emptyChart}>No data</div>;
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 60, cx = 80, cy = 80, r = 36;
  let cumAngle = -Math.PI / 2;
  const segments = data.map(d => {
    const angle = (d.value / total) * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += angle;
    const x1 = cx + R * Math.cos(startAngle);
    const y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(cumAngle);
    const y2 = cy + R * Math.sin(cumAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    const ix1 = cx + r * Math.cos(startAngle);
    const iy1 = cy + r * Math.sin(startAngle);
    const ix2 = cx + r * Math.cos(cumAngle);
    const iy2 = cy + r * Math.sin(cumAngle);
    return {
      ...d,
      path: `M${x1},${y1} A${R},${R} 0 ${largeArc} 1 ${x2},${y2} L${ix2},${iy2} A${r},${r} 0 ${largeArc} 0 ${ix1},${iy1} Z`,
    };
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <svg width={160} height={160} style={{ flexShrink: 0 }}>
        {segments.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} opacity={0.88} stroke="var(--paper-bright)" strokeWidth={1.5} />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={10} fill="var(--ink-faint)" fontFamily="var(--font-mono)">TOTAL</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)" fontFamily="var(--font-mono)">
          {fmtMoneyShort(total)}
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {data.slice(0, 8).map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)', marginLeft: 'auto', paddingLeft: 8 }}>
              {((d.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const emptyChart: React.CSSProperties = {
  padding: '20px 0',
  color: 'var(--ink-faint)',
  fontStyle: 'italic',
  fontSize: 13,
  fontFamily: 'var(--font-display)',
  textAlign: 'center',
};

// ── Main component ────────────────────────────────────────────────────────────
export default function SpendingDashboard() {
  const [records, setRecords] = useState<SpendRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'3m' | '6m' | '12m' | 'all'>('12m');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('purchase_orders')
          .select('id, supplier_name, company, gross_amount, net_amount, transaction_date, status, created_at')
          .in('status', SETTLED_STATUSES)
          .order('transaction_date', { ascending: true });

        if (error) {
          console.error('Failed to fetch spending data:', error.message, error.details);
        }

        setRecords((data as SpendRecord[] | null) ?? []);
      } catch (err) {
        console.error('Unexpected error fetching spending data:', err);
        setRecords([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (period === 'all') return records;
    const months = period === '3m' ? 3 : period === '6m' ? 6 : 12;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    return records.filter(r => r.transaction_date && new Date(r.transaction_date) >= cutoff);
  }, [records, period]);

  // KPIs
  const totalSpend = useMemo(() => filtered.reduce((s, r) => s + Number(r.gross_amount ?? 0), 0), [filtered]);
  const totalNet   = useMemo(() => filtered.reduce((s, r) => s + Number(r.net_amount ?? 0), 0), [filtered]);
  const invoiceCount = filtered.length;
  const avgInvoice = invoiceCount > 0 ? totalSpend / invoiceCount : 0;
  const uniqueSuppliers = new Set(filtered.map(r => r.supplier_name ?? '').filter(Boolean)).size;

  // Spend by company
  const byCompany = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      const key = r.company ?? 'Unassigned';
      map.set(key, (map.get(key) ?? 0) + Number(r.gross_amount ?? 0));
    }
    return Array.from(map.entries())
      .map(([label, value], i) => ({ label: label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), value, color: CHART_ACCENT[i % CHART_ACCENT.length] }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  // Spend by month
  const byMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      if (!r.transaction_date) continue;
      const d = new Date(r.transaction_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      map.set(key, (map.get(key) ?? 0) + Number(r.gross_amount ?? 0));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, value]) => ({
        label: new Date(label + '-01').toLocaleString('en-GB', { month: 'short', year: '2-digit' }),
        value,
      }));
  }, [filtered]);

  // All suppliers (for table)
  const bySupplierFull = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      const key = r.supplier_name ?? 'Unknown';
      map.set(key, (map.get(key) ?? 0) + Number(r.gross_amount ?? 0));
    }
    return Array.from(map.entries())
      .map(([label, value], i) => ({ label, value, color: CHART_ACCENT[i % CHART_ACCENT.length] }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  // Top 10 suppliers (for chart)
  const bySupplier = useMemo(() => bySupplierFull.slice(0, 10), [bySupplierFull]);

  return (
    <div>
      {/* Masthead */}
      <header style={styles.masthead} className="animate-rise">
        <div>
          <div style={styles.kicker}>
            <span style={styles.kickerRule} />
            Spend Analysis · {new Date().getFullYear()}
          </div>
          <h1 style={styles.pageTitle}>Spending Dashboard</h1>
          <p style={styles.subtitle}>
            Approved and exported invoices — {invoiceCount} record{invoiceCount === 1 ? '' : 's'} analysed
          </p>
        </div>
        {/* Period selector */}
        <div style={styles.periodTabs}>
          {(['3m', '6m', '12m', 'all'] as const).map(p => (
            <button
              key={p}
              style={{ ...styles.periodTab, ...(period === p ? styles.periodTabActive : {}) }}
              onClick={() => setPeriod(p)}
            >
              {p === 'all' ? 'All time' : `Last ${p}`}
            </button>
          ))}
        </div>
      </header>

      {/* KPI strip */}
      <div style={styles.kpiStrip} className="animate-rise delay-1">
        <KpiCard label="Total Spend" value={fmtMoney(totalSpend)} sub={`${fmtMoney(totalNet)} net`} accent />
        <KpiCard label="Invoices" value={String(invoiceCount)} sub="approved / exported" />
        <KpiCard label="Avg Invoice" value={fmtMoney(avgInvoice)} sub="gross average" />
        <KpiCard label="Suppliers" value={String(uniqueSuppliers)} sub="unique suppliers" />
      </div>

      {loading ? (
        <div style={styles.loading}>
          <div style={styles.spinner} />
          <span>Loading spend data…</span>
        </div>
      ) : (
        <div style={styles.grid} className="animate-rise delay-2">
          {/* Monthly spend */}
          <div style={{ ...styles.card, gridColumn: '1 / -1' }}>
            <ChartHeader title="Monthly Spend" sub="Gross invoice totals by transaction date" />
            <ColChart data={byMonth} />
          </div>

          {/* Spend by school */}
          <div style={styles.card}>
            <ChartHeader title="Spend by School" sub="Gross total per company entity" />
            <DonutChart data={byCompany} />
          </div>

          {/* Top suppliers */}
          <div style={styles.card}>
            <ChartHeader title="Top Suppliers" sub={`Top ${bySupplier.length} by gross spend`} />
            <HBarChart data={bySupplier} />
          </div>

          {/* Supplier table */}
          <div style={{ ...styles.card, gridColumn: '1 / -1' }}>
            <ChartHeader title="Supplier Breakdown" sub="All suppliers ranked by total spend" />
            <SupplierTable data={bySupplierFull} total={totalSpend} />
          </div>
        </div>
      )}
    </div>
  );
}

function ChartHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>{title}</div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div style={{ ...styles.kpiCard, ...(accent ? styles.kpiCardAccent : {}) }}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, ...(accent ? { color: 'var(--accent)' } : {}) }}>{value}</div>
      <div style={styles.kpiSub}>{sub}</div>
    </div>
  );
}

function SupplierTable({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  if (data.length === 0) return <div style={emptyChart}>No data</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {['#', 'Supplier', 'Total Spend', '% of Total', 'Avg Invoice'].map((h, i) => (
              <th key={h} style={{
                padding: '10px 14px',
                textAlign: i > 1 ? 'right' : 'left',
                fontSize: 10, fontWeight: 700, color: 'var(--ink-muted)',
                textTransform: 'uppercase', letterSpacing: '0.16em',
                borderBottom: '1px solid var(--line)',
                background: 'var(--paper)',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--line)', background: i % 2 === 1 ? 'rgba(228,221,203,0.15)' : 'transparent' }}>
              <td style={{ padding: '11px 14px', color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{i + 1}</td>
              <td style={{ padding: '11px 14px', fontWeight: 600, color: 'var(--ink)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                  {d.label}
                </div>
              </td>
              <td style={{ padding: '11px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--ink)' }}>{fmtMoney(d.value)}</td>
              <td style={{ padding: '11px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>{((d.value / total) * 100).toFixed(1)}%</td>
              <td style={{ padding: '11px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  masthead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingBottom: 24,
    borderBottom: '1px solid var(--line)',
    marginBottom: 24,
    gap: 20,
    flexWrap: 'wrap',
  },
  kicker: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 12,
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--accent-text)',
    textTransform: 'uppercase',
    letterSpacing: '0.22em',
    marginBottom: 12,
  },
  kickerRule: { width: 24, height: 1, background: 'var(--accent)' },
  pageTitle: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(30px, 4vw, 44px)',
    fontWeight: 400,
    color: 'var(--ink)',
    letterSpacing: '-0.025em',
    lineHeight: 1.02,
  },
  subtitle: {
    margin: '8px 0 0',
    fontSize: 13.5,
    color: 'var(--ink-muted)',
  },

  periodTabs: {
    display: 'flex',
    gap: 4,
    background: 'var(--paper)',
    border: '1px solid var(--line)',
    borderRadius: 8,
    padding: 3,
    flexShrink: 0,
  },
  periodTab: {
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 500,
    border: 'none',
    background: 'transparent',
    color: 'var(--ink-muted)',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'all 0.14s',
  },
  periodTabActive: {
    background: 'var(--ink)',
    color: 'var(--paper)',
    fontWeight: 600,
  },

  kpiStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 14,
    marginBottom: 22,
  },
  kpiCard: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '18px 20px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  kpiCardAccent: {
    background: 'linear-gradient(180deg, #FAF7F0 0%, #F4E8DA 100%)',
    borderColor: 'rgba(181, 78, 28, 0.18)',
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--ink-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.22em',
  },
  kpiValue: {
    fontFamily: 'var(--font-display)',
    fontSize: 30,
    fontWeight: 400,
    color: 'var(--ink)',
    lineHeight: 1.05,
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
  },
  kpiSub: {
    fontSize: 11.5,
    color: 'var(--ink-muted)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
  },

  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  card: {
    background: 'var(--paper-bright)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '22px 24px',
  },

  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    padding: '64px 24px',
    color: 'var(--ink-muted)',
    fontStyle: 'italic',
  },
  spinner: {
    width: 26, height: 26,
    border: '2.5px solid var(--line)',
    borderTopColor: 'var(--accent)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};
