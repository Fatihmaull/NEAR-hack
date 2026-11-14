import type { Metadata } from "next";
import { DemoTour } from "@/components/demo/DemoTour";

export const metadata: Metadata = {
  title: "60-second demo",
  description: "Five steps: agents fund themselves, hedge a GPU price spike, liquidate a vault and slash a provider. Ends with a receipt you can verify.",
};

export default function Page() {
  return <DemoTour />;
}
