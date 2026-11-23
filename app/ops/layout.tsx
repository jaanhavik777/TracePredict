import type { ReactNode } from "react";
import "./ops.css";
export const metadata = { title: "Security Ops | TracePredict" };
export default function OpsLayout({ children }: { children: ReactNode }) {
  return <div className="ops-surface">{children}</div>;
}
