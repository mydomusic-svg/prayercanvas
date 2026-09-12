"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrCreateShareUrl } from "@/lib/share-link";

/**
 * Copies the prayer's public link.
 *
 * This used to be labelled "Get Public Link", which is a developer's name
 * for it, and it INSERTED a new share_links row on every press — so asking
 * for the link twice gave you two different addresses for the same prayer
 * and split its view count between them. It now returns the one link the
 * prayer already has.
 */
export default function ShareButton({ prayerId }: { prayerId: string }) {
  const supabase = createClient();
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function revealLink() {
    setLoading(true);
    setFailed(false);
    const url = await getOrCreateShareUrl(supabase, prayerId);
    setLoading(false);
    if (!url) {
      setFailed(true);
      return;
    }
    setLink(url);
    // Copy straight away — the reason anyone presses this is to paste it
    // somewhere, and making them press Copy afterwards is a second step for
    // nothing. The button below still copies again if the clipboard was
    // blocked or they came back to it later.
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard denied — the link is on screen to copy by hand.
    }
  }

  async function copyAgain() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setFailed(true);
    }
  }

  if (link) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-sage-50 px-4 py-2 text-sm">
        <span className="truncate">{link}</span>
        <button onClick={copyAgain} className="shrink-0 text-sage-600 underline">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={revealLink}
        disabled={loading}
        className="rounded-full border border-sage-300 px-4 py-1.5 text-sm text-sage-700 transition hover:bg-sage-50 disabled:opacity-50"
      >
        {loading ? "Getting link…" : "Copy link"}
      </button>
      {failed && (
        <p className="text-xs text-red-600">
          Couldn&apos;t create the link — try again in a moment.
        </p>
      )}
    </div>
  );
}
