import type { Metadata } from "next";
import { TradeView } from "@/components/app/views/TradeView";

export const metadata: Metadata = { title: "Trade" };

export default function Page() {
  return <TradeView />;
}
