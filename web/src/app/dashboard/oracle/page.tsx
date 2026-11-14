import type { Metadata } from "next";
import { OracleView } from "@/components/app/views/OracleView";

export const metadata: Metadata = { title: "Oracle" };

export default function Page() {
  return <OracleView />;
}
