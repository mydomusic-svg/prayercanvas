"use client";

import { useState } from "react";

export default function CheckoutButton({
  plan,
  label,
  billingEnabled,
  className = "",
}: {
  plan: "monthly" | "yearly" | "per_send";
  label: string;
  billingEnabled: boolean;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  if (!billingEnabled) {
    return (
      <button
        disabled
        className={`cursor-not-allowed rounded-full border border-sage-300 px-6 py-3 text-sage-400 ${className}`}
        title="Coming soon"
      >
        Coming soon
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={handleClick}
        disabled={loading}
        className={`rounded-full bg-sage-600 px-6 py-3 text-white transition hover:bg-sage-700 disabled:opacity-50 ${className}`}
      >
        {loading ? "Redirecting…" : label}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
