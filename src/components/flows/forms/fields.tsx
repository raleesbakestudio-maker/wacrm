"use client";

/**
 * Reusable field components shared across every per-node form.
 *
 * `NodeKeySelect` — picks a node from the flow's node list, rendered
 * with the source node's icon so the dropdown reads as
 * "destination = ◇ menu" rather than an opaque slug.
 *
 * `NextNodeRow` — wraps NodeKeySelect with a label; the most common
 * per-node form row ("after this node, advance to…").
 *
 * `TextRow` — wraps Input or Textarea behind a label. Pure UI sugar
 * to keep per-node forms uncluttered.
 *
 * Lives in src/components/flows/forms/ so both the list view's
 * collapsed-card editor and the canvas view's side-panel editor
 * (introduced in this PR) mount the exact same form components.
 */

import { Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { NODE_META, type BuilderNode } from "../shared";

export function TextRow({
  label,
  value,
  onChange,
  rows = 1,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-400">{label}</label>
      {rows > 1 ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          className="bg-slate-800"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-slate-800"
        />
      )}
    </div>
  );
}

export function NextNodeRow({
  value,
  allNodes,
  currentKey,
  onChange,
  label,
}: {
  value: string;
  allNodes: BuilderNode[];
  currentKey: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-400">{label}</label>
      <NodeKeySelect
        value={value || null}
        nodes={allNodes}
        excludeKey={currentKey}
        onChange={(v) => onChange(v ?? "")}
        placeholder="Pick a next node…"
      />
    </div>
  );
}

export function DelayConfigRow({
  delayValue = 0,
  delayUnit = "seconds",
  onChange,
}: {
  delayValue?: number;
  delayUnit?: "seconds" | "minutes" | "hours";
  onChange: (patch: {
    delay_value: number;
    delay_unit: "seconds" | "minutes" | "hours";
  }) => void;
}) {
  const numVal =
    typeof delayValue === "number" ? delayValue : Number(delayValue) || 0;
  const unit = delayUnit || "seconds";

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
          <Clock className="h-3.5 w-3.5 text-amber-400" />
          <span>Delay before sending</span>
        </label>
        <span className="text-[10px] text-slate-500">
          {numVal > 0 ? `${numVal} ${unit}` : "Instant (0s)"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Input
            type="number"
            min={0}
            max={unit === "hours" ? 72 : unit === "minutes" ? 1440 : 60}
            value={numVal === 0 ? "" : numVal}
            onChange={(e) => {
              const parsed = Math.max(0, parseInt(e.target.value, 10) || 0);
              onChange({ delay_value: parsed, delay_unit: unit });
            }}
            placeholder="0 (no delay)"
            className="bg-slate-800 text-xs"
          />
        </div>
        <div>
          <Select
            value={unit}
            onValueChange={(v) =>
              onChange({
                delay_value: numVal,
                delay_unit: v as "seconds" | "minutes" | "hours",
              })
            }
          >
            <SelectTrigger className="bg-slate-800 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="seconds">Seconds (സെക്കൻഡ്)</SelectItem>
              <SelectItem value="minutes">Minutes (മിനിറ്റ്)</SelectItem>
              <SelectItem value="hours">Hours (മണിക്കൂർ)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="mt-1.5 text-[10px] text-slate-400">
        {numVal === 0
          ? "Sends immediately without waiting."
          : unit === "seconds"
            ? `Waits ${numVal}s before sending (feels like real typing).`
            : `Waits ${numVal} ${unit} before sending this message.`}
      </p>
    </div>
  );
}

export function NodeKeySelect({
  value,
  nodes,
  excludeKey,
  onChange,
  placeholder,
  className,
}: {
  value: string | null;
  nodes: BuilderNode[];
  excludeKey?: string;
  onChange: (v: string | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const options = nodes.filter((n) => n.node_key !== excludeKey);
  return (
    <Select
      value={value ?? "__none__"}
      onValueChange={(v) => onChange(v === "__none__" ? null : v)}
    >
      <SelectTrigger className={cn("bg-slate-800", className)}>
        <SelectValue placeholder={placeholder ?? "—"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">— None —</SelectItem>
        {options.map((n) => {
          const Icon = NODE_META[n.node_type].icon;
          return (
            <SelectItem key={n.node_key} value={n.node_key}>
              <span className="inline-flex items-center gap-1.5">
                <Icon
                  className={cn("h-3 w-3", NODE_META[n.node_type].color)}
                />
                {n.node_key}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
