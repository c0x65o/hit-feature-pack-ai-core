'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useUi } from '@hit/ui-kit';

type RunSummary = {
  correlationId: string;
  createdAt?: string | null;
  pack?: string | null;
  kind?: string | null;
  file?: string | null;
};

type RunsIndexResponse = {
  enabled?: boolean;
  runsDir?: string | null;
  runs?: RunSummary[];
};

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('hit_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchAi<T>(path: string): Promise<T> {
  const res = await fetch(`/api/proxy/ai${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = (body as any)?.detail || (body as any)?.message || res.statusText;
    throw new Error(String(detail || `Request failed: ${res.status}`));
  }
  return res.json();
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function AiTraces() {
  const { Page, Card, Button, DataTable, Alert, Badge } = useUi();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runsDir, setRunsDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAi<RunsIndexResponse>(`/hit/ai/traces?limit=200&offset=0`);
      setRuns(Array.isArray(data?.runs) ? data.runs : []);
      setRunsDir(typeof data?.runsDir === 'string' ? data.runsDir : null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to load AI traces'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const rows = useMemo(() => runs, [runs]);

  const navigate = (path: string) => {
    if (typeof window !== 'undefined') window.location.href = path;
  };

  return (
    <Page
      title="AI Traces"
      description="Admin-only per-run telemetry for the Nexus + pack agents"
      actions={
        <div className="flex gap-2 items-center">
          <Button variant="primary" onClick={refresh} disabled={loading}>
            Refresh
          </Button>
        </div>
      }
    >
      {runsDir && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Trace storage: <span className="font-mono">{runsDir}</span>
        </div>
      )}
      {error && (
        <Alert variant="error" title="Error loading AI traces">
          {error.message}
        </Alert>
      )}
      <Card>
        <DataTable
          loading={loading}
          data={rows as any[]}
          emptyMessage="No traces yet. Traces will appear here as the AI assistant is used."
          searchable
          exportable
          showColumnVisibility
          tableId="admin.ai.traces"
          onRefresh={refresh}
          refreshing={loading}
          searchDebounceMs={400}
          columns={[
            {
              key: 'createdAt',
              label: 'When',
              render: (value: unknown) => (
                <span className="text-sm">{formatWhen(typeof value === 'string' ? value : null)}</span>
              ),
            },
            {
              key: 'correlationId',
              label: 'Correlation ID',
              sortable: true,
              render: (value: unknown) => (
                <span
                  role="button"
                  tabIndex={0}
                  className="font-mono text-blue-600 dark:text-blue-400 hover:underline"
                  onClick={() => navigate(`/admin/ai/traces/${encodeURIComponent(String(value))}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      navigate(`/admin/ai/traces/${encodeURIComponent(String(value))}`);
                    }
                  }}
                >
                  {String(value)}
                </span>
              ),
            },
            {
              key: 'pack',
              label: 'Pack',
              sortable: true,
              render: (value: unknown) =>
                value ? <Badge variant="info">{String(value)}</Badge> : <span className="text-gray-500">—</span>,
            },
            {
              key: 'kind',
              label: 'Kind',
              render: (value: unknown) =>
                value ? <Badge variant="default">{String(value)}</Badge> : <span className="text-gray-500">—</span>,
            },
          ]}
        />
      </Card>
    </Page>
  );
}

export default AiTraces;

