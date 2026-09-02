"use client";

import { useAppState } from "@/lib/client/store";
import { Icon, Tag } from "./ui";

const TOOL_COUNT = 5;

const HOW_TO =
  "WebMCP site tools let a browser agent operate this page through typed tools. Available in the ChatGPT desktop app’s built-in browser, or in Chrome with chrome://flags/#enable-webmcp-testing enabled.";

export function WebMcpIndicator() {
  const status = useAppState().webmcp;
  const label =
    status === "registered"
      ? `Site tools: registered (${TOOL_COUNT})`
      : status === "unsupported"
        ? "Site tools: not available in this browser"
        : status === "error"
          ? "Site tools: error"
          : "Site tools: checking…";
  const tone = status === "registered" ? "accent" : status === "error" ? "alert" : "muted";
  return (
    <Tag tone={tone} icon={<Icon name="tools" size={14} />} title={HOW_TO} data-webmcp={status}>
      {label}
    </Tag>
  );
}
