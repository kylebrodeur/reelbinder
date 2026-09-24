import { useEffect } from "react";
import { installStudioWebmcp } from "@/lib/webmcp/webmcp-registration";

export function WebmcpBridge() {
  useEffect(() => installStudioWebmcp(), []);
  return null;
}
