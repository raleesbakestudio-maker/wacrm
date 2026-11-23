"use client";

/**
 * Per-node configuration form, dispatched by node_type.
 *
 * One component, ten branches. Each branch renders the inputs that
 * map onto the node's `config` JSONB shape (text + buttons for
 * send_buttons, prompt + var_key for collect_input, etc.) and forwards
 * edits up via `onUpdateConfig`.
 *
 * Why this lives in src/components/flows/forms/ instead of next to
 * the list editor: PR 2 (canvas editing) needs to mount the same
 * form in a side panel when a user clicks a node on the canvas.
 * Keeping the per-node forms here means there's exactly one place
 * where each form's behaviour and validation lives — drift between
 * "what the list editor shows" and "what the canvas side panel
 * shows" becomes impossible.
 *
 * `showAdvanced` is the disclosure that surfaces internal
 * identifiers (node_key, button reply_id, list row reply_id) — owned
 * by the host (NodeCard / SideSheet) so the toggle is rendered
 * outside this form alongside whatever delete/cancel buttons that
 * host wants. The form just reads the boolean and conditionally
 * renders the advanced rows.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  MessageCircle,
  Paperclip,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { createClient } from "@/lib/supabase/client";
import { slugify, type BuilderNode } from "../shared";
import { DelayConfigRow, NextNodeRow, NodeKeySelect, TextRow } from "./fields";

interface NodeConfigFormProps {
  node: BuilderNode;
  allNodes: BuilderNode[];
  showAdvanced: boolean;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}

export function NodeConfigForm({
  node,
  allNodes,
  showAdvanced,
  onUpdateConfig,
}: NodeConfigFormProps) {
  const cfg = node.config;
  switch (node.node_type) {
    case "start":
      return (
        <NextNodeRow
          value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
          allNodes={allNodes}
          currentKey={node.node_key}
          onChange={(v) => onUpdateConfig({ next_node_key: v })}
          label="Advances to"
        />
      );

    case "send_message":
      return (
        <SendMessageForm
          cfg={cfg as SendMessageCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      );

    case "send_buttons":
      return (
        <SendButtonsForm
          cfg={cfg as SendButtonsCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          showAdvanced={showAdvanced}
        />
      );

    case "send_list":
      return (
        <SendListForm
          cfg={cfg as SendListCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          showAdvanced={showAdvanced}
        />
      );

    case "send_media":
      return (
        <SendMediaForm
          cfg={cfg as SendMediaCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      );

    case "collect_input":
      return (
        <>
          <TextRow
            label="Prompt sent to the customer"
            value={(cfg as { prompt_text?: string }).prompt_text ?? ""}
            onChange={(v) => onUpdateConfig({ prompt_text: v })}
            rows={2}
          />
          <div>
            <label className="mb-1 block text-xs text-slate-400">
              Variable key (stored in flow_runs.vars; alphanumeric + underscore)
            </label>
            <Input
              value={(cfg as { var_key?: string }).var_key ?? ""}
              onChange={(e) =>
                onUpdateConfig({
                  var_key: e.target.value.replace(/[^a-zA-Z0-9_]/g, ""),
                })
              }
              placeholder="e.g. name, email, company"
              className="bg-slate-800 font-mono text-xs"
            />
            <p className="mt-1 text-[10px] text-slate-500">
              Interpolate in downstream prompts and handoff notes with{" "}
              <code className="rounded bg-slate-800 px-1">
                {"{{vars."}
                {(cfg as { var_key?: string }).var_key || "name"}
                {"}}"}
              </code>
              .
            </p>
          </div>
          <NextNodeRow
            value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(v) => onUpdateConfig({ next_node_key: v })}
            label="After capturing, advance to"
          />
        </>
      );

    case "condition":
      return (
        <ConditionForm
          cfg={cfg as ConditionCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      );

    case "set_tag":
      return (
        <SetTagForm
          cfg={cfg as SetTagCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      );

    case "handoff":
      return (
        <TextRow
          label="Internal note (for the agent picking up)"
          value={(cfg as { note?: string }).note ?? ""}
          onChange={(v) => onUpdateConfig({ note: v })}
          rows={2}
        />
      );

    case "trigger_flow":
      return (
        <TriggerFlowForm
          cfg={cfg as TriggerFlowCfg}
          onUpdateConfig={onUpdateConfig}
        />
      );

    case "end":
      return (
        <p className="text-xs text-slate-500">
          Terminal node. When the runner reaches this node the run is marked
          complete. No config needed.
        </p>
      );
  }
}

// ============================================================
// send_message
// ============================================================

interface SendMessageCfg {
  text?: string;
  next_node_key?: string;
  delay_value?: number;
  delay_unit?: "seconds" | "minutes" | "hours";
}

function renderWhatsAppPreview(rawText: string) {
  if (!rawText || !rawText.trim()) {
    return (
      <span className="italic text-emerald-200/50">
        Type your message above to see preview here...
      </span>
    );
  }

  // Tokenize for {{var}}, *bold*, _italic_, ~strike~
  const tokens = rawText.split(
    /(\{\{[^}]+\}\}|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g,
  );

  return tokens.map((token, i) => {
    if (token.startsWith("{{") && token.endsWith("}}")) {
      const varKey = token.slice(2, -2).trim();
      const label =
        varKey === "name" || varKey === "contact.name"
          ? "Raliya Shabeer"
          : varKey === "first_name" || varKey === "contact.first_name"
            ? "Raliya"
            : varKey === "phone" || varKey === "contact.phone"
              ? "+91 98765 43210"
              : `[${varKey}]`;
      return (
        <span
          key={i}
          className="mx-0.5 inline-block rounded border border-amber-400/40 bg-amber-400/25 px-1 py-0.5 text-[11px] font-medium text-amber-200"
          title={`Dynamic variable: ${token}`}
        >
          {label}
        </span>
      );
    }
    if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      return (
        <strong key={i} className="font-bold text-white">
          {token.slice(1, -1)}
        </strong>
      );
    }
    if (token.startsWith("_") && token.endsWith("_") && token.length > 2) {
      return (
        <em key={i} className="italic text-emerald-100">
          {token.slice(1, -1)}
        </em>
      );
    }
    if (token.startsWith("~") && token.endsWith("~") && token.length > 2) {
      return (
        <del key={i} className="text-emerald-200/70 line-through">
          {token.slice(1, -1)}
        </del>
      );
    }
    return <span key={i}>{token}</span>;
  });
}

function SendMessageForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: SendMessageCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const text = cfg.text ?? "";

  // Collect any variables captured by collect_input nodes in this flow
  const collectedVars = useMemo(() => {
    const list: string[] = [];
    for (const n of allNodes) {
      if (n.node_type === "collect_input") {
        const vk = (n.config as { var_key?: string })?.var_key;
        if (vk && vk.trim() && !list.includes(vk.trim())) {
          list.push(vk.trim());
        }
      }
    }
    return list;
  }, [allNodes]);

  const insertAtCursor = useCallback(
    (tag: string) => {
      const el = textareaRef.current;
      if (!el) {
        onUpdateConfig({ text: text + tag });
        return;
      }
      const start = el.selectionStart ?? text.length;
      const end = el.selectionEnd ?? text.length;
      const updated = text.slice(0, start) + tag + text.slice(end);
      onUpdateConfig({ text: updated });

      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + tag.length, start + tag.length);
      }, 0);
    },
    [text, onUpdateConfig],
  );

  const wrapSelection = useCallback(
    (wrapper: string) => {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = text.slice(start, end) || "text";
      const wrapped = `${wrapper}${selected}${wrapper}`;
      const updated = text.slice(0, start) + wrapped + text.slice(end);
      onUpdateConfig({ text: updated });

      setTimeout(() => {
        el.focus();
        el.setSelectionRange(
          start + wrapper.length,
          start + wrapper.length + selected.length,
        );
      }, 0);
    },
    [text, onUpdateConfig],
  );

  return (
    <div className="space-y-4">
      {/* 1. Header & Textarea */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-200">
            WhatsApp Message Text
          </label>
          <span className="text-[11px] text-slate-400">
            {text.length} characters
          </span>
        </div>

        {/* Formatting & Emoji toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-t-lg border border-b-0 border-slate-700 bg-slate-800/90 px-2.5 py-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Format:
          </span>
          <button
            type="button"
            onClick={() => wrapSelection("*")}
            className="rounded px-1.5 py-0.5 text-xs font-bold text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
            title="Bold (*text*)"
          >
            B
          </button>
          <button
            type="button"
            onClick={() => wrapSelection("_")}
            className="rounded px-1.5 py-0.5 text-xs italic text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
            title="Italic (_text_)"
          >
            I
          </button>
          <button
            type="button"
            onClick={() => wrapSelection("~")}
            className="rounded px-1.5 py-0.5 text-xs line-through text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
            title="Strikethrough (~text~)"
          >
            S
          </button>
          <button
            type="button"
            onClick={() => wrapSelection("```")}
            className="rounded px-1.5 py-0.5 font-mono text-[11px] text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
            title="Monospace (```text```)"
          >
            {"</>"}
          </button>

          <span className="mx-1 h-3.5 w-px bg-slate-700" />

          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Emoji:
          </span>
          {["👋", "🎂", "🍰", "✨", "🙏", "✅", "❤️"].map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => insertAtCursor(` ${emoji} `)}
              className="rounded px-1 py-0.5 text-xs transition-transform hover:scale-125"
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* WhatsApp multiline message editor */}
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onUpdateConfig({ text: e.target.value })}
          rows={5}
          placeholder="Type your WhatsApp message here... (use Enter for new line)"
          className="min-h-[120px] rounded-t-none border-slate-700 bg-slate-900 font-sans text-xs leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-emerald-500"
        />
      </div>

      {/* 2. Variables Section */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-200">
            Insert Dynamic Variables
          </span>
          <span className="text-[10px] text-slate-400">
            Auto-replaced per student
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => insertAtCursor("{{name}}")}
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/25 active:scale-95"
            title="Inserts student's full name"
          >
            <span className="font-bold text-amber-400">+</span> 👤 Name (<code>{"{{name}}"}</code>)
          </button>

          <button
            type="button"
            onClick={() => insertAtCursor("{{first_name}}")}
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/25 active:scale-95"
            title="Inserts student's first name only"
          >
            <span className="font-bold text-amber-400">+</span> 🏷️ First Name (<code>{"{{first_name}}"}</code>)
          </button>

          <button
            type="button"
            onClick={() => insertAtCursor("{{phone}}")}
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/25 active:scale-95"
            title="Inserts student's WhatsApp phone number"
          >
            <span className="font-bold text-amber-400">+</span> 📱 Phone (<code>{"{{phone}}"}</code>)
          </button>

          {collectedVars.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertAtCursor(`{{vars.${v}}}`)}
              className="inline-flex items-center gap-1 rounded-md border border-teal-500/40 bg-teal-500/15 px-2.5 py-1 text-xs font-medium text-teal-300 transition-colors hover:bg-teal-500/25 active:scale-95"
              title={`Inserts captured variable ${v}`}
            >
              <span className="font-bold text-teal-400">+</span> 📥 Captured (<code>{`{{vars.${v}}}`}</code>)
            </button>
          ))}
        </div>
      </div>

      {/* 3. Live WhatsApp Message Bubble Preview */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
            <MessageCircle className="h-3.5 w-3.5" />
            <span>WhatsApp Message Preview</span>
          </div>
          <span className="text-[10px] text-slate-500">Live preview</span>
        </div>

        {/* WhatsApp Chat Wallpaper Preview Box */}
        <div className="rounded-xl border border-slate-800 bg-[#0b141a] p-3.5 shadow-inner">
          <div className="flex justify-end">
            {/* Outgoing WhatsApp chat bubble */}
            <div className="relative max-w-[90%] rounded-2xl rounded-tr-none bg-[#005c4b] px-3.5 py-2.5 text-white shadow-md">
              <div className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-[#e9edef]">
                {renderWhatsAppPreview(text)}
              </div>
              <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-emerald-200/70">
                <span>10:30 AM</span>
                <span className="font-bold text-[#53bdeb]">✓✓</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Delay Before Sending */}
      <DelayConfigRow
        delayValue={cfg.delay_value}
        delayUnit={cfg.delay_unit}
        onChange={(patch) => onUpdateConfig(patch)}
      />

      {/* 5. Next Node */}
      <NextNodeRow
        value={cfg.next_node_key ?? ""}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label="After sending, advances to"
      />
    </div>
  );
}

// ============================================================
// send_buttons
// ============================================================

interface SendButtonsCfg {
  text?: string;
  footer_text?: string;
  buttons?: Array<{ reply_id: string; title: string; next_node_key: string }>;
  delay_value?: number;
  delay_unit?: "seconds" | "minutes" | "hours";
}

function SendButtonsForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  showAdvanced,
}: {
  cfg: SendButtonsCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  showAdvanced: boolean;
}) {
  const buttons = cfg.buttons ?? [];
  const updateButton = (
    idx: number,
    patch: Partial<NonNullable<SendButtonsCfg["buttons"]>[number]>,
  ) => {
    onUpdateConfig({
      buttons: buttons.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    });
  };
  const addButton = () =>
    onUpdateConfig({
      buttons: [
        ...buttons,
        {
          reply_id: `btn_${buttons.length + 1}`,
          title: "Option",
          next_node_key: "",
        },
      ],
    });
  const removeButton = (idx: number) =>
    onUpdateConfig({ buttons: buttons.filter((_, i) => i !== idx) });

  return (
    <>
      <TextRow
        label="Body text"
        value={cfg.text ?? ""}
        onChange={(v) => onUpdateConfig({ text: v })}
        rows={3}
      />
      <TextRow
        label="Footer (optional, 60 chars)"
        value={cfg.footer_text ?? ""}
        onChange={(v) => onUpdateConfig({ footer_text: v })}
      />
      <DelayConfigRow
        delayValue={cfg.delay_value}
        delayUnit={cfg.delay_unit}
        onChange={(patch) => onUpdateConfig(patch)}
      />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs text-slate-400">
            Buttons (1–3) — each one routes to a different next node
          </label>
        </div>
        <div className="flex flex-col gap-3">
          {buttons.map((b, i) => (
            <div
              key={i}
              className={cn(
                "grid grid-cols-1 gap-2 rounded-md border border-slate-800 bg-slate-800/40 p-3",
                showAdvanced
                  ? "md:grid-cols-[1fr_2fr_2fr_auto]"
                  : "md:grid-cols-[2fr_2fr_auto]",
              )}
            >
              {showAdvanced && (
                <Input
                  value={b.reply_id}
                  onChange={(e) =>
                    updateButton(i, {
                      reply_id: slugify(e.target.value, `btn_${i + 1}`),
                    })
                  }
                  placeholder="reply_id"
                  className="bg-slate-800 font-mono text-xs"
                />
              )}
              <Input
                value={b.title}
                onChange={(e) => updateButton(i, { title: e.target.value })}
                placeholder="Visible title (≤20 chars)"
                className="bg-slate-800"
                maxLength={20}
              />
              <NodeKeySelect
                value={b.next_node_key || null}
                nodes={allNodes}
                excludeKey={currentKey}
                onChange={(v) => updateButton(i, { next_node_key: v ?? "" })}
                placeholder="Next node…"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeButton(i)}
                className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        {buttons.length < 3 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={addButton}
            className="mt-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Add button
          </Button>
        )}
      </div>
    </>
  );
}

// ============================================================
// send_list
// ============================================================

interface SendListCfg {
  text?: string;
  button_label?: string;
  footer_text?: string;
  sections?: Array<{
    title?: string;
    rows: Array<{
      reply_id: string;
      title: string;
      description?: string;
      next_node_key: string;
    }>;
  }>;
  delay_value?: number;
  delay_unit?: "seconds" | "minutes" | "hours";
}

function SendListForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  showAdvanced,
}: {
  cfg: SendListCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  showAdvanced: boolean;
}) {
  const sections = cfg.sections ?? [];
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);

  const updateSection = (
    sIdx: number,
    patch: Partial<NonNullable<SendListCfg["sections"]>[number]>,
  ) => {
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx ? { ...s, ...patch } : s,
      ),
    });
  };
  const addSection = () =>
    onUpdateConfig({
      sections: [
        ...sections,
        {
          title: "",
          rows: [
            {
              reply_id: `row_${totalRows + 1}`,
              title: `Option ${totalRows + 1}`,
              next_node_key: "",
            },
          ],
        },
      ],
    });
  const removeSection = (sIdx: number) =>
    onUpdateConfig({ sections: sections.filter((_, i) => i !== sIdx) });
  const updateRow = (
    sIdx: number,
    rIdx: number,
    patch: Partial<
      NonNullable<SendListCfg["sections"]>[number]["rows"][number]
    >,
  ) => {
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx
          ? {
              ...s,
              rows: s.rows.map((r, j) => (j === rIdx ? { ...r, ...patch } : r)),
            }
          : s,
      ),
    });
  };
  const addRow = (sIdx: number) =>
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx
          ? {
              ...s,
              rows: [
                ...s.rows,
                {
                  reply_id: `row_${totalRows + 1}`,
                  title: `Option ${totalRows + 1}`,
                  next_node_key: "",
                },
              ],
            }
          : s,
      ),
    });
  const removeRow = (sIdx: number, rIdx: number) =>
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx ? { ...s, rows: s.rows.filter((_, j) => j !== rIdx) } : s,
      ),
    });

  return (
    <>
      <TextRow
        label="Body text"
        value={cfg.text ?? ""}
        onChange={(v) => onUpdateConfig({ text: v })}
        rows={3}
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextRow
          label="Tap-to-expand button label (≤20 chars)"
          value={cfg.button_label ?? ""}
          onChange={(v) => onUpdateConfig({ button_label: v })}
        />
        <TextRow
          label="Footer (optional, 60 chars)"
          value={cfg.footer_text ?? ""}
          onChange={(v) => onUpdateConfig({ footer_text: v })}
        />
      </div>

      <DelayConfigRow
        delayValue={cfg.delay_value}
        delayUnit={cfg.delay_unit}
        onChange={(patch) => onUpdateConfig(patch)}
      />

      <div className="mt-2">
        <label className="mb-2 block text-xs text-slate-400">
          Rows (1–10 total across all sections)
        </label>
        {sections.map((section, sIdx) => (
          <div
            key={sIdx}
            className="mb-3 rounded-md border border-slate-800 bg-slate-800/40 p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <Input
                value={section.title ?? ""}
                onChange={(e) =>
                  updateSection(sIdx, { title: e.target.value })
                }
                placeholder={`Section ${sIdx + 1} title (optional)`}
                className="bg-slate-800 text-xs"
              />
              {sections.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSection(sIdx)}
                  className="shrink-0 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  aria-label="Remove section"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {section.rows.map((row, rIdx) => (
              <div
                key={rIdx}
                className={cn(
                  "mb-2 grid grid-cols-1 gap-2",
                  showAdvanced
                    ? "md:grid-cols-[1fr_2fr_2fr_auto]"
                    : "md:grid-cols-[2fr_2fr_auto]",
                )}
              >
                {showAdvanced && (
                  <Input
                    value={row.reply_id}
                    onChange={(e) =>
                      updateRow(sIdx, rIdx, {
                        reply_id: slugify(
                          e.target.value,
                          `row_${rIdx + 1}`,
                        ),
                      })
                    }
                    placeholder="reply_id"
                    className="bg-slate-800 font-mono text-xs"
                  />
                )}
                <Input
                  value={row.title}
                  onChange={(e) =>
                    updateRow(sIdx, rIdx, { title: e.target.value })
                  }
                  placeholder="Row title (≤24)"
                  className="bg-slate-800"
                  maxLength={24}
                />
                <NodeKeySelect
                  value={row.next_node_key || null}
                  nodes={allNodes}
                  excludeKey={currentKey}
                  onChange={(v) =>
                    updateRow(sIdx, rIdx, { next_node_key: v ?? "" })
                  }
                  placeholder="Next node…"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRow(sIdx, rIdx)}
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {totalRows < 10 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addRow(sIdx)}
                className="mt-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Add row
              </Button>
            )}
          </div>
        ))}
        {/* WhatsApp's interactive-list spec caps sections at 10. Group rows
            by category (Billing / Support / Sales etc.) to give customers a
            scannable menu. */}
        {sections.length < 10 && (
          <Button variant="outline" size="sm" onClick={addSection}>
            <Plus className="h-3.5 w-3.5" />
            Add section
          </Button>
        )}
      </div>
    </>
  );
}

// ============================================================
// condition
// ============================================================

interface ConditionCfg {
  subject?: "var" | "tag" | "contact_field";
  subject_key?: string;
  operator?: "equals" | "contains" | "present" | "absent";
  value?: string;
  true_next?: string;
  false_next?: string;
}

interface UserTag {
  id: string;
  name: string;
  color?: string;
}

function useUserTags() {
  const [tags, setTags] = useState<UserTag[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTags = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/tags");
      if (!res.ok) return;
      const json = (await res.json()) as { tags?: UserTag[] };
      setTags(json.tags ?? []);
    } catch {
      // Tags endpoint absent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const createTag = useCallback(
    async (name: string, color?: string): Promise<UserTag | null> => {
      if (!name.trim()) return null;
      try {
        const res = await fetch("/api/tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), color: color || "#10b981" }),
        });
        if (!res.ok) {
          toast.error("Failed to create tag");
          return null;
        }
        const json = (await res.json()) as { tag?: UserTag; created?: boolean };
        if (json.tag) {
          setTags((prev) => {
            if (prev.some((t) => t.id === json.tag!.id)) return prev;
            return [...prev, json.tag!].sort((a, b) => a.name.localeCompare(b.name));
          });
          toast.success(
            json.created
              ? `Tag "${json.tag.name}" created and synced to CRM`
              : `Tag "${json.tag.name}" selected`
          );
          return json.tag;
        }
        return null;
      } catch {
        toast.error("Network error while creating tag");
        return null;
      }
    },
    []
  );

  return { tags, loading, createTag, refreshTags: fetchTags };
}

function InlineTagCreator({
  createTag,
  onCreated,
  onCancel,
}: {
  createTag: (name: string, color?: string) => Promise<UserTag | null>;
  onCreated: (tag: UserTag) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#10b981");
  const [saving, setSaving] = useState(false);

  const colors = [
    "#10b981",
    "#3b82f6",
    "#f59e0b",
    "#8b5cf6",
    "#ef4444",
    "#ec4899",
    "#06b6d4",
  ];

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    const tag = await createTag(name.trim(), color);
    setSaving(false);
    if (tag) {
      onCreated(tag);
    }
  }

  return (
    <div className="rounded-md border border-slate-700 bg-slate-900/90 p-2.5 space-y-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New tag name…"
        className="h-8 bg-slate-800 text-xs"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleSave();
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
      />
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`h-4 w-4 rounded-full transition-transform ${
                color === c
                  ? "scale-125 ring-2 ring-white ring-offset-1 ring-offset-slate-900"
                  : "opacity-70 hover:opacity-100"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="h-7 px-2 text-xs text-slate-400 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving || !name.trim()}
            onClick={handleSave}
            className="h-7 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-500"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save Tag"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConditionForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: ConditionCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const { tags, createTag } = useUserTags();
  const [showCreateTag, setShowCreateTag] = useState(false);

  const subject = cfg.subject ?? "var";
  const operator = cfg.operator ?? "equals";
  const showValue = operator === "equals" || operator === "contains";

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs text-slate-400">If</label>
          <Select
            value={subject}
            onValueChange={(v) =>
              onUpdateConfig({ subject: v as ConditionCfg["subject"] })
            }
          >
            <SelectTrigger className="bg-slate-800">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="var">Captured variable</SelectItem>
              <SelectItem value="tag">Contact has tag</SelectItem>
              <SelectItem value="contact_field">Contact field</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs text-slate-400">
              {subject === "var"
                ? "var name"
                : subject === "tag"
                  ? "CRM Tag"
                  : "Field"}
            </label>
            {subject === "tag" && (
              <button
                type="button"
                onClick={() => setShowCreateTag(!showCreateTag)}
                className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
              >
                {showCreateTag ? "Cancel" : "+ New Tag"}
              </button>
            )}
          </div>
          {subject === "tag" ? (
            showCreateTag ? (
              <InlineTagCreator
                createTag={createTag}
                onCreated={(tag) => {
                  onUpdateConfig({ subject_key: tag.id });
                  setShowCreateTag(false);
                }}
                onCancel={() => setShowCreateTag(false)}
              />
            ) : tags.length > 0 ? (
              <Select
                value={cfg.subject_key ?? ""}
                onValueChange={(v) => onUpdateConfig({ subject_key: v })}
              >
                <SelectTrigger className="bg-slate-800">
                  <SelectValue placeholder="Pick a tag…" />
                </SelectTrigger>
                <SelectContent>
                  {tags.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: t.color || "#10b981" }}
                        />
                        <span>{t.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={cfg.subject_key ?? ""}
                onChange={(e) =>
                  onUpdateConfig({ subject_key: e.target.value })
                }
                placeholder="tag UUID (or click + New Tag above)"
                className="bg-slate-800 font-mono text-xs"
              />
            )
          ) : subject === "contact_field" ? (
            <Select
              value={cfg.subject_key ?? ""}
              onValueChange={(v) => onUpdateConfig({ subject_key: v })}
            >
              <SelectTrigger className="bg-slate-800">
                <SelectValue placeholder="Pick a field…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">name</SelectItem>
                <SelectItem value="email">email</SelectItem>
                <SelectItem value="phone">phone</SelectItem>
                <SelectItem value="company">company</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={cfg.subject_key ?? ""}
              onChange={(e) =>
                onUpdateConfig({ subject_key: e.target.value })
              }
              placeholder={subject === "var" ? "e.g. email" : "tag UUID"}
              className="bg-slate-800 font-mono text-xs"
            />
          )}
        </div>
      </div>

      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          showValue ? "md:grid-cols-2" : "",
        )}
      >
        <div>
          <label className="mb-1 block text-xs text-slate-400">Operator</label>
          <Select
            value={operator}
            onValueChange={(v) =>
              onUpdateConfig({ operator: v as ConditionCfg["operator"] })
            }
          >
            <SelectTrigger className="bg-slate-800">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="present">is present</SelectItem>
              <SelectItem value="absent">is absent</SelectItem>
              <SelectItem value="equals">equals</SelectItem>
              <SelectItem value="contains">contains</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {showValue && (
          <div>
            <label className="mb-1 block text-xs text-slate-400">Value</label>
            <Input
              value={cfg.value ?? ""}
              onChange={(e) => onUpdateConfig({ value: e.target.value })}
              className="bg-slate-800"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <NextNodeRow
          value={cfg.true_next ?? ""}
          allNodes={allNodes}
          currentKey={currentKey}
          onChange={(v) => onUpdateConfig({ true_next: v })}
          label="If true → advance to"
        />
        <NextNodeRow
          value={cfg.false_next ?? ""}
          allNodes={allNodes}
          currentKey={currentKey}
          onChange={(v) => onUpdateConfig({ false_next: v })}
          label="If false → advance to"
        />
      </div>
    </>
  );
}

// ============================================================
// set_tag
// ============================================================

interface SetTagCfg {
  mode?: "add" | "remove";
  tag_id?: string;
  tag_name?: string;
  tag_ids?: string[];
  next_node_key?: string;
}

function SetTagForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: SetTagCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const { tags, createTag } = useUserTags();
  const [showCreateTag, setShowCreateTag] = useState(false);

  const selectedTag = tags.find((t) => t.id === cfg.tag_id);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-slate-400">Action</label>
          <Select
            value={cfg.mode ?? "add"}
            onValueChange={(v) =>
              onUpdateConfig({ mode: v as SetTagCfg["mode"] })
            }
          >
            <SelectTrigger className="bg-slate-800">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="add">Add tag</SelectItem>
              <SelectItem value="remove">Remove tag</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs text-slate-400">CRM Tag</label>
            <button
              type="button"
              onClick={() => setShowCreateTag(!showCreateTag)}
              className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
            >
              {showCreateTag ? "Cancel" : "+ New Tag"}
            </button>
          </div>
          {showCreateTag ? (
            <InlineTagCreator
              createTag={createTag}
              onCreated={(tag) => {
                onUpdateConfig({
                  tag_id: tag.id,
                  tag_name: tag.name,
                  tag_ids: [tag.id],
                });
                setShowCreateTag(false);
              }}
              onCancel={() => setShowCreateTag(false)}
            />
          ) : tags.length > 0 ? (
            <Select
              value={cfg.tag_id ?? ""}
              onValueChange={(v) => {
                const picked = tags.find((t) => t.id === v);
                onUpdateConfig({
                  tag_id: v,
                  tag_name: picked?.name ?? "",
                  tag_ids: [v],
                });
              }}
            >
              <SelectTrigger className="bg-slate-800">
                <SelectValue placeholder="Pick a CRM tag…">
                  {selectedTag ? (
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{
                          backgroundColor: selectedTag.color || "#10b981",
                        }}
                      />
                      <span>{selectedTag.name}</span>
                    </div>
                  ) : cfg.tag_name ? (
                    <span>{cfg.tag_name}</span>
                  ) : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: t.color || "#10b981" }}
                      />
                      <span>{t.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={cfg.tag_id ?? ""}
              onChange={(e) => onUpdateConfig({ tag_id: e.target.value })}
              placeholder="Tag UUID (or click + New Tag above)"
              className="bg-slate-800 font-mono text-xs"
            />
          )}
        </div>
      </div>
      <NextNodeRow
        value={cfg.next_node_key ?? ""}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label="Then advance to"
      />
    </>
  );
}

// ============================================================
// send_media
// ============================================================

interface SendMediaCfg {
  media_type?: "image" | "video" | "document" | "audio";
  media_url?: string;
  caption?: string;
  filename?: string;
  next_node_key?: string;
  delay_value?: number;
  delay_unit?: "seconds" | "minutes" | "hours";
}

// Mirrors the bucket's allowed_mime_types from migration 016 + 022. Kept in
// sync with the storage policy so the picker rejects unsupported files
// before they hit the network rather than failing with a confusing
// Supabase RLS / mime-type error.
const MEDIA_ACCEPT: Record<NonNullable<SendMediaCfg["media_type"]>, string> = {
  image: "image/png,image/jpeg,image/webp",
  video: "video/mp4,video/3gpp",
  audio: "audio/mpeg,audio/mp4,audio/ogg,audio/aac,audio/wav,audio/x-m4a,audio/*",
  document:
    "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain",
};

const FLOW_MEDIA_BUCKET = "flow-media";
// 16 MB — matches the bucket file_size_limit set in migration 016.
const FLOW_MEDIA_MAX_BYTES = 16 * 1024 * 1024;

function SendMediaForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: SendMediaCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const mediaType = cfg.media_type ?? "image";
  const isDocument = mediaType === "document";
  const displayName =
    cfg.filename ||
    (cfg.media_url ? cfg.media_url.split("/").pop() ?? "" : "");

  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > FLOW_MEDIA_MAX_BYTES) {
        toast.error(
          `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — limit is 16 MB.`,
        );
        return;
      }
      setUploading(true);
      try {
        const supabase = createClient();
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();
        if (userErr || !user) {
          throw new Error("Not signed in.");
        }
        // Resolve the caller's account_id so the path is account-
        // scoped rather than user-scoped. The 020 migration's RLS
        // policy allows any account member to write under
        // `account-<account_id>/...`, so a flow's media survives a
        // teammate leaving the account (which was a data-integrity
        // hole in the original 016 storage policies).
        const { data: profile, error: profileErr } = await supabase
          .from("profiles")
          .select("account_id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (profileErr || !profile?.account_id) {
          throw new Error("Could not resolve your account.");
        }
        // Path convention matches migration 020's RLS policy: first
        // segment is `account-<uuid>`. Timestamp + random suffix
        // prevents collisions between two builders open at once.
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
        const safeBase =
          file.name
            .replace(/\.[^.]+$/, "")
            .replace(/[^a-zA-Z0-9_-]+/g, "_")
            .slice(0, 40) || "file";
        const path = `account-${profile.account_id}/${Date.now()}-${safeBase}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(FLOW_MEDIA_BUCKET)
          .upload(path, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type,
          });
        if (upErr) throw new Error(upErr.message);
        const {
          data: { publicUrl },
        } = supabase.storage.from(FLOW_MEDIA_BUCKET).getPublicUrl(path);
        // Patch all fields in one call so the form doesn't re-render
        // with a half-uploaded state.
        onUpdateConfig({
          media_url: publicUrl,
          filename: file.name,
        });
        toast.success("File uploaded.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed.";
        toast.error(msg);
      } finally {
        setUploading(false);
      }
    },
    [onUpdateConfig],
  );

  const handleClear = () => {
    onUpdateConfig({ media_url: "", filename: "" });
  };

  return (
    <>
      <div>
        <label className="mb-1 block text-xs text-slate-400">Media type</label>
        <Select
          value={mediaType}
          onValueChange={(v) => {
            // Changing type clears the existing file — the bucket
            // accepts different MIME sets per type and a previously
            // uploaded PDF can't be sent as an image.
            onUpdateConfig({
              media_type: v as NonNullable<SendMediaCfg["media_type"]>,
              media_url: "",
              filename: "",
            });
          }}
        >
          <SelectTrigger className="bg-slate-800">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="image">Image (PNG, JPEG, WebP)</SelectItem>
            <SelectItem value="video">Video (MP4, 3GP)</SelectItem>
            <SelectItem value="audio">Voice / Audio (MP3, OGG, M4A, WAV)</SelectItem>
            <SelectItem value="document">
              Document (PDF, Word, Excel, PowerPoint, TXT)
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="mb-1 block text-xs text-slate-400">File</label>
        {cfg.media_url ? (
          <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
            <a
              href={cfg.media_url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate text-slate-200 hover:text-cyan-300"
              title={displayName || cfg.media_url}
            >
              {displayName || cfg.media_url}
            </a>
            <button
              type="button"
              onClick={handleClear}
              className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
              aria-label="Remove file"
              disabled={uploading}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-slate-700 bg-slate-900 px-3 py-4 text-xs text-slate-400 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" />
                Click to upload (max 16 MB)
              </>
            )}
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={MEDIA_ACCEPT[mediaType]}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            // Reset so picking the same file twice still fires onChange.
            e.target.value = "";
          }}
        />
      </div>

      {mediaType === "audio" && cfg.media_url && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-2.5">
          <label className="mb-1.5 block text-[11px] font-medium text-slate-400">
            Voice Note Preview:
          </label>
          <audio src={cfg.media_url} controls className="h-8 w-full" />
        </div>
      )}

      {mediaType !== "audio" && (
        <TextRow
          label="Caption (optional, shown under the media)"
          value={cfg.caption ?? ""}
          onChange={(v) => onUpdateConfig({ caption: v })}
          rows={2}
        />
      )}

      {isDocument && (
        <div>
          <label className="mb-1 block text-xs text-slate-400">
            Filename shown to the customer (documents only)
          </label>
          <Input
            value={cfg.filename ?? ""}
            onChange={(e) => onUpdateConfig({ filename: e.target.value })}
            placeholder="invoice.pdf"
            className="bg-slate-800 text-xs"
          />
        </div>
      )}

      <DelayConfigRow
        delayValue={cfg.delay_value}
        delayUnit={cfg.delay_unit}
        onChange={(patch) => onUpdateConfig(patch)}
      />

      <NextNodeRow
        value={cfg.next_node_key ?? ""}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label="After sending, advance to"
      />
    </>
  );
}

// ============================================================
// trigger_flow
// ============================================================

interface FlowOption {
  id: string;
  name: string;
  status: string;
}

interface TriggerFlowCfg {
  target_flow_id?: string;
  target_flow_name?: string;
  add_tag_ids?: string[];
  add_tag_names?: string[];
  remove_tag_ids?: string[];
  remove_tag_names?: string[];
}

function useFlowList(): { flows: FlowOption[]; loading: boolean } {
  const [flows, setFlows] = useState<FlowOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/flows").catch(() => null);
        if (!res || !res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const json = (await res.json()) as { flows?: FlowOption[] };
        if (!cancelled) {
          setFlows(json.flows ?? []);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { flows, loading };
}

function TriggerFlowForm({
  cfg,
  onUpdateConfig,
}: {
  cfg: TriggerFlowCfg;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const { flows, loading: flowsLoading } = useFlowList();
  const { tags, createTag } = useUserTags();
  const [showCreateAddTag, setShowCreateAddTag] = useState(false);

  const availableFlows = flows.filter((f) => f.status !== "archived");
  const addTagIds = cfg.add_tag_ids ?? [];
  const removeTagIds = cfg.remove_tag_ids ?? [];

  const availableToAddTags = tags.filter((t) => !addTagIds.includes(t.id));
  const availableToRemoveTags = tags.filter((t) => !removeTagIds.includes(t.id));

  function handleAddTag(tagId: string) {
    if (!tagId) return;
    const picked = tags.find((t) => t.id === tagId);
    const newIds = [...addTagIds, tagId];
    const newNames = [
      ...(cfg.add_tag_names ?? []),
      picked ? picked.name : tagId.slice(0, 8),
    ];
    onUpdateConfig({
      add_tag_ids: newIds,
      add_tag_names: newNames,
    });
  }

  function handleRemoveAddTag(tagId: string) {
    const idx = addTagIds.indexOf(tagId);
    const newIds = addTagIds.filter((id) => id !== tagId);
    const newNames = (cfg.add_tag_names ?? []).filter((_, i) => i !== idx);
    onUpdateConfig({
      add_tag_ids: newIds,
      add_tag_names: newNames,
    });
  }

  function handleAddRemoveTag(tagId: string) {
    if (!tagId) return;
    const picked = tags.find((t) => t.id === tagId);
    const newIds = [...removeTagIds, tagId];
    const newNames = [
      ...(cfg.remove_tag_names ?? []),
      picked ? picked.name : tagId.slice(0, 8),
    ];
    onUpdateConfig({
      remove_tag_ids: newIds,
      remove_tag_names: newNames,
    });
  }

  function handleRemoveRemoveTag(tagId: string) {
    const idx = removeTagIds.indexOf(tagId);
    const newIds = removeTagIds.filter((id) => id !== tagId);
    const newNames = (cfg.remove_tag_names ?? []).filter((_, i) => i !== idx);
    onUpdateConfig({
      remove_tag_ids: newIds,
      remove_tag_names: newNames,
    });
  }

  return (
    <div className="space-y-4">
      {/* 1. Target Flow Selection */}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-300">
          Target Flow (Select flow to jump to)
        </label>
        {flowsLoading ? (
          <div className="flex h-9 items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Loading flows…</span>
          </div>
        ) : availableFlows.length > 0 ? (
          <Select
            value={cfg.target_flow_id ?? ""}
            onValueChange={(flowId) => {
              const matched = availableFlows.find((f) => f.id === flowId);
              onUpdateConfig({
                target_flow_id: flowId,
                target_flow_name: matched ? matched.name : "",
              });
            }}
          >
            <SelectTrigger className="bg-slate-800">
              <SelectValue placeholder="Pick a target flow…" />
            </SelectTrigger>
            <SelectContent>
              {availableFlows.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-200">{f.name}</span>
                    {f.status === "active" ? (
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                        Active
                      </span>
                    ) : (
                      <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
                        Draft
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={cfg.target_flow_id ?? ""}
            onChange={(e) =>
              onUpdateConfig({
                target_flow_id: e.target.value,
              })
            }
            placeholder="Target Flow ID (UUID)"
            className="bg-slate-800 font-mono text-xs"
          />
        )}
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          When this node is reached, the current flow completes and seamlessly launches the selected flow.
        </p>
      </div>

      {/* 2. Tags on Transition Header & Box */}
      <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 p-3 space-y-3">
        <div className="border-b border-slate-800 pb-2">
          <h4 className="text-xs font-semibold text-slate-200">
            Sync Tags on Transition (ഫ്ലോ മാറുമ്പോൾ ടാഗുകൾ)
          </h4>
          <p className="text-[11px] text-slate-400">
            ഈ ഫ്ലോയിൽ നിന്ന് അടുത്ത ഫ്ലോയിലേക്ക് മാറുമ്പോൾ ഓട്ടോമാറ്റിക് ആയി ടാഗുകൾ ചേർക്കുകയോ ഒഴിവാക്കുകയോ ചെയ്യാം.
          </p>
        </div>

        {/* Add Tags */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
              <span>+ Add Tags (ചേർക്കേണ്ട ടാഗുകൾ)</span>
            </label>
            <button
              type="button"
              onClick={() => setShowCreateAddTag(!showCreateAddTag)}
              className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
            >
              {showCreateAddTag ? "Cancel" : "+ New CRM Tag"}
            </button>
          </div>

          {showCreateAddTag && (
            <InlineTagCreator
              createTag={createTag}
              onCreated={(tag) => {
                handleAddTag(tag.id);
                setShowCreateAddTag(false);
              }}
              onCancel={() => setShowCreateAddTag(false)}
            />
          )}

          {/* Selected Add Tags Chips */}
          {addTagIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 rounded-md border border-slate-700/60 bg-slate-800/60 p-2">
              {addTagIds.map((tid, idx) => {
                const tagObj = tags.find((t) => t.id === tid);
                const tagName =
                  tagObj?.name || cfg.add_tag_names?.[idx] || tid.slice(0, 8);
                return (
                  <span
                    key={tid}
                    className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-300"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: tagObj?.color || "#10b981" }}
                    />
                    <span>+{tagName}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveAddTag(tid)}
                      className="text-emerald-400/80 hover:text-emerald-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Add Tag Select Dropdown */}
          {availableToAddTags.length > 0 ? (
            <Select
              value=""
              onValueChange={(v) => {
                if (typeof v === "string" && v) handleAddTag(v);
              }}
            >
              <SelectTrigger className="h-8 bg-slate-800 text-xs">
                <SelectValue placeholder="+ Select tag to add on transition…" />
              </SelectTrigger>
              <SelectContent>
                {availableToAddTags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: t.color || "#10b981" }}
                      />
                      <span>{t.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-[11px] text-slate-500">
              {tags.length === 0
                ? "No CRM tags yet. Click '+ New CRM Tag' above to create one."
                : "All available tags added."}
            </p>
          )}
        </div>

        {/* Remove Tags */}
        <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
          <label className="text-xs font-medium text-rose-400 flex items-center gap-1.5">
            <span>- Remove Tags (ഒഴിവാക്കേണ്ട ടാഗുകൾ)</span>
          </label>

          {/* Selected Remove Tags Chips */}
          {removeTagIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 rounded-md border border-slate-700/60 bg-slate-800/60 p-2">
              {removeTagIds.map((tid, idx) => {
                const tagObj = tags.find((t) => t.id === tid);
                const tagName =
                  tagObj?.name || cfg.remove_tag_names?.[idx] || tid.slice(0, 8);
                return (
                  <span
                    key={tid}
                    className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/20 px-2.5 py-0.5 text-xs font-medium text-rose-300"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: tagObj?.color || "#ef4444" }}
                    />
                    <span>-{tagName}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveRemoveTag(tid)}
                      className="text-rose-400/80 hover:text-rose-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Remove Tag Select Dropdown */}
          {availableToRemoveTags.length > 0 ? (
            <Select
              value=""
              onValueChange={(v) => {
                if (typeof v === "string" && v) handleAddRemoveTag(v);
              }}
            >
              <SelectTrigger className="h-8 bg-slate-800 text-xs">
                <SelectValue placeholder="- Select tag to remove on transition…" />
              </SelectTrigger>
              <SelectContent>
                {availableToRemoveTags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: t.color || "#ef4444" }}
                      />
                      <span>{t.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-[11px] text-slate-500">
              {tags.length === 0
                ? "No CRM tags to remove."
                : "All tags selected."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
