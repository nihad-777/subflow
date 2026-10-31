// Customer view (the portal teammate can reuse or restyle this).
import { useState } from 'react';
import { api, qs } from '../lib/api';
import { date, money, methodLabel } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import type { Paged, Payment } from '../lib/types';
import { Badge, Empty, ErrorBanner, PageHeader, Pagination, TableSkeleton } from '../components/ui';

export default function MyPaymentsPage() {
  const [page, setPage] = useState(1);
  const list = useAsync(() => api.get<Paged<Payment>>(`/me/payments${qs({ page })}`), [page]);
  return (
    <div>
      <PageHeader title="My payments" />
      <ErrorBanner error={list.error} onRetry={list.reload} />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50"><tr><th className="th">Date</th><th className="th">Invoice</th><th className="th">Method</th><th className="th text-right">Amount</th><th className="th">Status</th></tr></thead>
          {list.loading && !list.data ? <TableSkeleton cols={5} /> : (
            <tbody>
              {list.data?.items.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="td">{date(p.paymentDate)}</td><td className="td">{p.invoiceNumber}</td><td className="td">{methodLabel(p.method)}</td>
                  <td className="td text-right tabular-nums">{money(p.amount)}</td>
                  <td className="td">{p.status === 'POSTED' ? <Badge tone="green">Received</Badge> : <Badge>Voided</Badge>}</td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
        {list.data?.items.length === 0 && <Empty title="No payments yet" />}
        {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      </div>
    </div>
  );
}
