import type { Metadata } from "next";
import { SettlementView } from "@/components/app/views/SettlementView";

export const metadata: Metadata = { title: "Settlement" };

export default function Page() {
  return <SettlementView />;
}
