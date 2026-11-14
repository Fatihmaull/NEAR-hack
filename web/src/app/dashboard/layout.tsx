import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Paron dashboard" },
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
