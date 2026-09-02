"use client";

import { useState, type ToggleEvent } from "react";
import { useAppState, type AuditEvent, type AuditStatus } from "@/lib/client/store";
import { clockLabel } from "./format";
import { Icon, Tag, type IconName } from "./ui";

const VISIBLE_ROWS = 30;

const STATUS: Record<AuditStatus, { label: string; icon: IconName; className: string }> = {
  started: { label: "Started", icon: "clock", className: "text-ink-2" },
  ok: { label: "OK", icon: "check", className: "text-accent-ink" },
  error: { label: "Error", icon: "cross", className: "text-alert-ink" },
  cancelled: { label: "Cancelled", icon: "minus", className: "text-ink-2" },
};

/**
 * Every tool call on the page, newest first, whether a person or a browser
 * agent made it. Collapsed by default until an agent shows up.
 */
export function ToolAuditLog() {
  const { audit } = useAppState();
  const hasAgentActivity = audit.some((e) => e.source === "agent");
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? hasAgentActivity;
  const rows = audit.slice(0, VISIBLE_ROWS);

  function onToggle(e: ToggleEvent<HTMLDetailsElement>) {
    setManual(e.currentTarget.open);
  }

  return (
    <details className="disclosure card" open={open} onToggle={onToggle} data-audit-count={audit.length}>
      <summary className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 font-medium">
          <Icon name="chevron" size={14} className="disclosure-chevron" />
          Agent activity
        </span>
        <span className="text-xs text-ink-2">
          {audit.length === 0 ? "No events" : `${audit.length} event${audit.length === 1 ? "" : "s"}`}
          {audit.length > VISIBLE_ROWS ? `, latest ${VISIBLE_ROWS}` : ""}
        </span>
      </summary>
      <div className="border-t border-line">
        {rows.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-2">Nothing yet. Every tool call on this page, by you or a browser agent, appears here.</p>
        ) : (
          <ol className="max-h-[70vh] divide-y divide-line overflow-y-auto">
            {rows.map((event) => (
              <AuditRow key={event.id} event={event} />
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}

function AuditRow({ event }: { event: AuditEvent }) {
  const status = STATUS[event.status];
  return (
    <li className="px-4 py-3 text-sm" data-audit-source={event.source} data-audit-status={event.status}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <time dateTime={event.at} className="text-xs tabular-nums text-ink-2">
          {clockLabel(event.at)}
        </time>
        <Tag size="sm" tone={event.source === "agent" ? "sandbox" : "neutral"} icon={<Icon name={event.source === "agent" ? "agent" : "person"} size={11} />}>
          {event.source === "agent" ? "agent" : "you"}
        </Tag>
        <code className="font-mono text-xs text-ink">{event.tool}</code>
        <span className={`ml-auto inline-flex items-center gap-1 text-xs font-medium ${status.className}`}>
          <Icon name={status.icon} size={12} />
          {status.label}
        </span>
      </div>
      <p className="mt-0.5 text-ink-2">{event.purpose}</p>
      {event.message ? <p className="mt-0.5 text-ink">{event.message}</p> : null}
      {event.requestId ? <p className="mt-0.5 break-all font-mono text-[11px] text-ink-3">req {event.requestId}</p> : null}
    </li>
  );
}
