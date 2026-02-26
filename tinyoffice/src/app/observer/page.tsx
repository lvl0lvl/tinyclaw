"use client";

import Link from "next/link";
import { usePolling, timeAgo } from "@/lib/hooks";
import { getAgents, type AgentConfig } from "@/lib/api";
import { getObserverState, type ObserverResponse } from "@/lib/observer-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Eye, RefreshCw, Activity } from "lucide-react";
import { useState, useEffect } from "react";

export default function ObserverPage() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 5000);
  const agentEntries = agents ? Object.entries(agents) : [];

  // Aggregate stats from all observer states
  const [observerStates, setObserverStates] = useState<Record<string, ObserverResponse>>({});

  useEffect(() => {
    if (!agents) return;

    const fetchAll = async () => {
      const results: Record<string, ObserverResponse> = {};
      for (const [id] of Object.entries(agents)) {
        try {
          results[id] = await getObserverState(id);
        } catch {
          // Agent may not have observer state
        }
      }
      setObserverStates(results);
    };

    fetchAll();
    const timer = setInterval(fetchAll, 5000);
    return () => clearInterval(timer);
  }, [agents]);

  const totalObservations = Object.values(observerStates).reduce(
    (sum, s) => sum + s.state.observation_count, 0
  );
  const totalReflections = Object.values(observerStates).reduce(
    (sum, s) => sum + s.state.reflection_count, 0
  );
  const enabledCount = Object.values(observerStates).filter(
    (s) => s.config.observer_enabled
  ).length;

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Brain className="h-6 w-6 text-primary" />
          Observer
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Context observation state across agents
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Eye className="h-4 w-4" />}
          label="Observations"
          value={totalObservations}
          sub="total across agents"
        />
        <StatCard
          icon={<RefreshCw className="h-4 w-4" />}
          label="Reflections"
          value={totalReflections}
          sub="total across agents"
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Observer Enabled"
          value={enabledCount}
          sub={`of ${agentEntries.length} agent${agentEntries.length !== 1 ? "s" : ""}`}
        />
      </div>

      {/* Agent Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {agentEntries.map(([id, agent]) => {
          const obs = observerStates[id];
          return (
            <AgentObserverCard key={id} agentId={id} agent={agent} observer={obs} />
          );
        })}
        {agentEntries.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-full">
            No agents configured
          </p>
        )}
      </div>
    </div>
  );
}

function AgentObserverCard({
  agentId,
  agent,
  observer,
}: {
  agentId: string;
  agent: AgentConfig;
  observer?: ObserverResponse;
}) {
  const enabled = observer?.config.observer_enabled ?? false;
  const lastObs = observer?.state.last_observed_at;
  const isActive = lastObs
    ? Date.now() - new Date(lastObs).getTime() < 30_000
    : false;

  const bufferTokens = observer?.buffer.token_count ?? 0;
  const threshold = observer?.config.token_threshold ?? 50_000;
  const bufferPct = threshold > 0 ? Math.min((bufferTokens / threshold) * 100, 100) : 0;

  return (
    <Link href={`/observer/${agentId}`}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center bg-secondary text-[10px] font-bold uppercase">
                {agent.name.slice(0, 2)}
              </div>
              <span>{agent.name}</span>
            </div>
            <Badge
              variant={enabled ? (isActive ? "default" : "secondary") : "outline"}
            >
              {!enabled ? "disabled" : isActive ? "active" : "idle"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Buffer progress bar */}
          <div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>Buffer</span>
              <span>{bufferTokens.toLocaleString()} / {threshold.toLocaleString()} tokens</span>
            </div>
            <div className="h-1.5 w-full bg-secondary overflow-hidden">
              <div
                className={`h-full transition-all ${bufferPct > 60 ? "bg-blue-500" : "bg-emerald-500"}`}
                style={{ width: `${bufferPct}%` }}
              />
            </div>
          </div>

          {/* Stats row */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{observer?.state.observation_count ?? 0} observations</span>
            <span>{observer?.state.reflection_count ?? 0} reflections</span>
          </div>

          {/* Last observed */}
          {lastObs && (
            <p className="text-[10px] text-muted-foreground">
              Last observed {timeAgo(new Date(lastObs).getTime())}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{icon}</span>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {label}
          </span>
        </div>
        <div className="mt-3">
          <span className="text-3xl font-bold tabular-nums">{value}</span>
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        </div>
      </CardContent>
    </Card>
  );
}
