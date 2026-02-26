"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { useState } from "react";

interface ObservationSection {
  date: string;
  items: ObservationItem[];
}

interface ObservationItem {
  priority: "HIGH" | "MED" | "LOW" | null;
  time: string | null;
  text: string;
  children: ObservationItem[];
}

function parseObservations(text: string): ObservationSection[] {
  if (!text.trim()) return [];

  const sections: ObservationSection[] = [];
  let currentSection: ObservationSection = { date: "", items: [] };

  const lines = text.split("\n");
  for (const line of lines) {
    // Date header: "## 2026-02-26" or "### Feb 26, 2026" etc.
    const dateMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (dateMatch) {
      if (currentSection.date || currentSection.items.length > 0) {
        sections.push(currentSection);
      }
      currentSection = { date: dateMatch[1].trim(), items: [] };
      continue;
    }

    // Top-level observation: "* HIGH (14:30) Some observation text"
    const itemMatch = line.match(/^\*\s+(HIGH|MED|LOW)?\s*(?:\((\d{1,2}:\d{2})\))?\s*(.+)$/);
    if (itemMatch) {
      currentSection.items.push({
        priority: (itemMatch[1] as "HIGH" | "MED" | "LOW") ?? null,
        time: itemMatch[2] ?? null,
        text: itemMatch[3].trim(),
        children: [],
      });
      continue;
    }

    // Sub-observation: "  * -> Some detail" or "  - Some detail"
    const subMatch = line.match(/^\s+\*\s+(?:->)?\s*(.+)$/) || line.match(/^\s+-\s+(.+)$/);
    if (subMatch && currentSection.items.length > 0) {
      const parent = currentSection.items[currentSection.items.length - 1];
      parent.children.push({
        priority: null,
        time: null,
        text: subMatch[1].trim(),
        children: [],
      });
      continue;
    }

    // Plain text lines that aren't blank — append to last item or create one
    if (line.trim() && currentSection.items.length > 0) {
      const last = currentSection.items[currentSection.items.length - 1];
      last.text += " " + line.trim();
    }
  }

  if (currentSection.date || currentSection.items.length > 0) {
    sections.push(currentSection);
  }

  return sections;
}

const priorityColors: Record<string, string> = {
  HIGH: "text-red-500 border-red-500/30 bg-red-500/10",
  MED: "text-yellow-500 border-yellow-500/30 bg-yellow-500/10",
  LOW: "text-blue-500 border-blue-500/30 bg-blue-500/10",
};

function ObservationItemView({ item }: { item: ObservationItem }) {
  return (
    <div className="flex items-start gap-2 py-1">
      {item.priority && (
        <Badge variant="outline" className={`text-[9px] px-1 py-0 shrink-0 ${priorityColors[item.priority]}`}>
          {item.priority}
        </Badge>
      )}
      {item.time && (
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {item.time}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">{item.text}</p>
        {item.children.length > 0 && (
          <div className="ml-3 mt-1 border-l border-border/50 pl-3 space-y-0.5">
            {item.children.map((child, i) => (
              <ObservationItemView key={i} item={child} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ObservationRenderer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const sections = parseObservations(text);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!text.trim()) {
    return (
      <p className="text-sm text-muted-foreground">No observations yet</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 text-xs gap-1.5">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {sections.map((section, si) => (
        <div key={si}>
          {section.date && (
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {section.date}
            </h4>
          )}
          <div className="space-y-0.5">
            {section.items.map((item, ii) => (
              <ObservationItemView key={ii} item={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
