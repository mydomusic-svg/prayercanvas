"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ShareButton({ prayerId }: { prayerId: string }) {
  const supabase = createClient();
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function createShareLink() {
    setLoading(true);
    const { data, error } = await supabase
      .from("share_links")
      .insert({ prayer_id: prayerId })
      .select()
      .single();
    setLoading(false);

    if (!error && data) {
      setLink(`${window.location.origin}/p/${data.token}`);
    }
  }

  if (link) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-sage-50 px-4 py-2 text-sm">
        <span className="truncate">{link}</span>
        <button
          onClick={() => navigator.clipboard.writeText(link)}
          className="shrink-0 text-sage-600 underline"
        >
          Copy
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={createShareLink}
      disabled={loading}
      className="rounded-full border border-sage-300 px-4 py-1.5 text-sm text-sage-700 transition hover:bg-sage-50 disabled:opacity-50"
    >
      {loading ? "Creating link…" : "Get Public Link"}
    </button>
  );
}
