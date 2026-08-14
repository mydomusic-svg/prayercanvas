"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ProcessButton({ prayerId }: { prayerId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/prayers/${prayerId}/process`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Processing failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleClick}
        disabled={loading}
        className="rounded-full bg-sage-600 px-5 py-2 text-sm text-white transition hover:bg-sage-700 disabled:opacity-50"
      >
        {loading ? "Transcribing & analyzing…" : "Transcribe & Analyze"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
