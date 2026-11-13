import { useEffect } from "react";
import { installWaitTips } from "@/lib/discovery/wait-tips/controller";

export default function WaitTipsHost() {
  useEffect(() => installWaitTips(), []);
  return null;
}
