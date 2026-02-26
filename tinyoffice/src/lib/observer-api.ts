const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3777";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface ObserverState {
  observations_text: string;
  total_tokens_observed: number;
  observation_count: number;
  reflection_count: number;
  last_observed_at: string | null;
  current_task: string;
  suggested_response: string;
}

export interface ObserverConfig {
  token_threshold: number;
  reflection_threshold: number;
  observer_enabled: boolean;
  provider: string;
}

export interface ObserverBuffer {
  message_count: number;
  token_count: number;
}

export interface ObserverResponse {
  state: ObserverState;
  config: ObserverConfig;
  buffer: ObserverBuffer;
}

// ── API Functions ─────────────────────────────────────────────────────────

export async function getObserverState(
  agentId: string
): Promise<ObserverResponse> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/observer`);
}

export async function updateObserverConfig(
  agentId: string,
  config: Partial<ObserverConfig>
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/agents/${encodeURIComponent(agentId)}/observer/config`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}
