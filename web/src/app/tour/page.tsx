import { redirect } from "next/navigation";

/** The guided tour moved to /demo; keep old links working. */
export default function Page() {
  redirect("/demo");
}
