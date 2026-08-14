"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// A plain browser confirm() is too easy to reflexively click through for
// something this permanent — deleting the account wipes every prayer video
// a person has made, with no recovery. Requiring them to type DELETE
// forces a moment of actually reading what they're about to do.
export default function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const supabase = createClient();
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirmText.trim().toUpperCase() === "DELETE";

  async function handleDelete() {
    if (!canDelete) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Account deletion failed");
      }
      // The account (and its session) is gone server-side — clear the local
      // session too so the client doesn't hold a stale/invalid token.
      await supabase.auth.signOut();
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-sage-900">Delete account</h2>
        <p className="mt-2 text-sm text-sage-600">
          This permanently deletes your account and every prayer video you&apos;ve
          created. There&apos;s no way to undo this or recover your videos
          afterward.
        </p>
        <p className="mt-3 text-sm text-sage-600">
          Type <span className="font-semibold">DELETE</span> to confirm.
        </p>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          autoFocus
          className="mt-2 w-full rounded-lg border border-sage-300 px-4 py-2 text-base"
        />

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={deleting}
            className="rounded-full border border-sage-300 px-4 py-1.5 text-sm text-sage-700 transition hover:bg-sage-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!canDelete || deleting}
            className="rounded-full bg-red-600 px-4 py-1.5 text-sm text-white transition hover:bg-red-500 disabled:opacity-40"
          >
            {deleting ? "Deleting…" : "Delete my account"}
          </button>
        </div>
      </div>
    </div>
  );
}
