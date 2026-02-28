"use client";

import { use, useState } from "react";
import Link from "next/link";
import { usePolling, useObserverState, timeAgo } from "@/lib/hooks";
import { getAgents, type AgentConfig } from "@/lib/api";
import { updateObserverConfig } from "@/lib/observer-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ObservationRenderer } from "@/components/observation-renderer";
import {
  Brain, ArrowLeft, Eye, RefreshCw, Loader2,
  MessageSquare, Lightbulb, Save, ChevronDown, ChevronUp,
  CheckCircle2, AlertCircle,
} from "lucide-react";

export default function ObserverDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: agentId } = use(params);
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 10000);
  const { data: observer, loading, refresh } = useObserverState(agentId);

  const agent = agents?.[agentId];
  const agentName = agent?.name ?? agentId;

  const state = observer?.state;
  const config = observer?.config;
  const buffer = observer?.buffer;

  const isActive = state?.last_observed_at
    ? Date.now() - new Date(state.last_observed_at).getTime() < 30_000
    : false;

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/observer"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-3">
          <Brain className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold tracking-tight">{agentName}</h1>
          {config && (
            <Badge
              variant={config.observer_enabled ? (isActive ? "default" : "secondary") : "outline"}
            >
              {!config.observer_enabled ? "disabled" : isActive ? "observing..." : "idle"}
            </Badge>
          )}
        </div>
        {state?.last_observed_at && (
          <span className="text-xs text-muted-foreground ml-auto">
            Last observed {timeAgo(new Date(state.last_observed_at).getTime())}
          </span>
        )}
      </div>

      {loading && !observer && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {observer && (
        <>
          {/* Progress Bars */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ProgressCard
              label="Message Buffer"
              icon={<MessageSquare className="h-4 w-4" />}
              current={buffer?.token_count ?? 0}
              max={config?.token_threshold ?? 50_000}
              unit="tokens"
              active={isActive}
            />
            <ProgressCard
              label="Observations"
              icon={<Eye className="h-4 w-4" />}
              current={state?.total_tokens_observed ?? 0}
              max={config?.reflection_threshold ?? 40_000}
              unit="tokens observed"
              active={isActive}
            />
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MiniStat label="Observations" value={state?.observation_count ?? 0} icon={<Eye className="h-3.5 w-3.5" />} />
            <MiniStat label="Reflections" value={state?.reflection_count ?? 0} icon={<RefreshCw className="h-3.5 w-3.5" />} />
            <MiniStat label="Buffer Messages" value={buffer?.message_count ?? 0} icon={<MessageSquare className="h-3.5 w-3.5" />} />
            <MiniStat label="Total Tokens" value={state?.total_tokens_observed ?? 0} icon={<Brain className="h-3.5 w-3.5" />} />
          </div>

          {/* Current Task */}
          {state?.current_task && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-yellow-500" />
                  Current Task
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground">{state.current_task}</p>
              </CardContent>
            </Card>
          )}

          {/* Suggested Response */}
          {state?.suggested_response && (
            <SuggestedResponseCard text={state.suggested_response} />
          )}

          {/* Observations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                Observations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[500px] overflow-y-auto">
                <ObservationRenderer text={state?.observations_text ?? ""} />
              </div>
            </CardContent>
          </Card>

          {/* Configuration */}
          <ConfigCard
            agentId={agentId}
            tokenThreshold={config?.token_threshold ?? 50_000}
            reflectionThreshold={config?.reflection_threshold ?? 40_000}
            observerEnabled={config?.observer_enabled ?? false}
            onSaved={refresh}
          />
        </>
      )}
    </div>
  );
}

function ProgressCard({
  label,
  icon,
  current,
  max,
  unit,
  active,
}: {
  label: string;
  icon: React.ReactNode;
  current: number;
  max: number;
  unit: string;
  active: boolean;
}) {
  const pct = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const barColor = pct > 60 ? "bg-blue-500" : "bg-emerald-500";

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="text-muted-foreground">{icon}</span>
            {label}
            {active && (
              <div className="h-1.5 w-1.5 bg-primary animate-pulse-dot" />
            )}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {current.toLocaleString()} / {max.toLocaleString()} {unit}
          </span>
        </div>
        <div className="h-2 w-full bg-secondary overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          {pct.toFixed(0)}% of threshold
        </p>
      </CardContent>
    </Card>
  );
}

function MiniStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          {icon}
          <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
        </div>
        <span className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</span>
      </CardContent>
    </Card>
  );
}

function SuggestedResponseCard({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-emerald-500" />
            Suggested Response
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="h-6 text-xs gap-1"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Collapse" : "Expand"}
          </Button>
        </CardTitle>
      </CardHeader>
      {expanded && (
        <CardContent>
          <p className="text-sm text-foreground whitespace-pre-wrap">{text}</p>
        </CardContent>
      )}
    </Card>
  );
}

function ConfigCard({
  agentId,
  tokenThreshold,
  reflectionThreshold,
  observerEnabled,
  onSaved,
}: {
  agentId: string;
  tokenThreshold: number;
  reflectionThreshold: number;
  observerEnabled: boolean;
  onSaved: () => void;
}) {
  const [tokenVal, setTokenVal] = useState(String(tokenThreshold));
  const [reflectVal, setReflectVal] = useState(String(reflectionThreshold));
  const [enabled, setEnabled] = useState(observerEnabled);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateObserverConfig(agentId, {
        token_threshold: parseInt(tokenVal, 10) || tokenThreshold,
        reflection_threshold: parseInt(reflectVal, 10) || reflectionThreshold,
        observer_enabled: enabled,
      });
      onSaved();
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 5000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Token Threshold
            </label>
            <Input
              type="number"
              value={tokenVal}
              onChange={(e) => setTokenVal(e.target.value)}
              className="text-sm"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Buffer tokens before triggering observation
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Reflection Threshold
            </label>
            <Input
              type="number"
              value={reflectVal}
              onChange={(e) => setReflectVal(e.target.value)}
              className="text-sm"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Observation tokens before triggering reflection
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setEnabled(!enabled)}
            className={`relative h-5 w-9 rounded-full transition-colors ${enabled ? "bg-primary" : "bg-secondary"}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${enabled ? "translate-x-4" : ""}`}
            />
          </button>
          <span className="text-sm">Observer {enabled ? "enabled" : "disabled"}</span>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save Configuration
          </Button>
          {status === "saved" && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
              Saved
            </span>
          )}
          {status === "error" && (
            <span className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {errorMsg}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
