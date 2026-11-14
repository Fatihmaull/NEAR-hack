import type { Metadata } from "next";
import { TestnetView } from "@/components/app/views/TestnetView";

export const metadata: Metadata = { title: "Live testnet" };

export default function Page() {
  return <TestnetView />;
}
