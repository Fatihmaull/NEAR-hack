import Link from "next/link";

/** The product name set as type. No drawn logo exists yet, so none is invented. */
export function Wordmark({ href = "/", tone = "ink", className = "" }: { href?: string; tone?: "ink" | "white"; className?: string }) {
  return (
    <Link href={href} className={`inline-flex min-h-[44px] items-center text-[22px] font-semibold tracking-[-0.03em] ${tone === "white" ? "text-white" : "text-ink"} ${className}`}>
      Paron
      <span className="sr-only">, home</span>
    </Link>
  );
}
