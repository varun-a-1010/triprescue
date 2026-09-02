"use client";

import { useEffect } from "react";
import { setWebMcpStatus, useAppState } from "@/lib/client/store";
import { buildTools } from "@/lib/webmcp/tools";

/**
 * Registers the five site tools with document.modelContext for the lifetime
 * of the page. Renders nothing visible. Safe under React Strict Mode: the
 * cleanup aborts (which unregisters), and the re-run registers again.
 */
export function WebMcpRegistry() {
  const status = useAppState().webmcp;

  useEffect(() => {
    const context = document.modelContext;
    if (!context || typeof context.registerTool !== "function") {
      setWebMcpStatus("unsupported");
      return;
    }
    const ac = new AbortController();
    (async () => {
      try {
        for (const tool of buildTools()) {
          if (ac.signal.aborted) return;
          await context.registerTool(tool, { signal: ac.signal });
        }
        if (!ac.signal.aborted) setWebMcpStatus("registered");
      } catch (err) {
        if (ac.signal.aborted) return;
        console.error("[webmcp] tool registration failed", err);
        setWebMcpStatus("error");
      }
    })();
    return () => {
      ac.abort();
    };
  }, []);

  return <span hidden data-webmcp-status={status} />;
}
