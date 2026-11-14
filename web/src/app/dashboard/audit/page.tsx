import type { Metadata } from "next";
import { AuditView } from "@/components/app/views/AuditView";

export const metadata: Metadata = { title: "Audit receipt" };

export default function Page() {
  return <AuditView />;
}
