"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import DeleteAccountModal from "./delete-account-modal";

// There was previously no sign-out control anywhere in the app — closing
// the tab was the only way to end a session. This is a small dropdown off
// the header showing the signed-in email with a Sign Out action.
export default function AccountMenu({ email }: { email: string | null }) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  const initial = (email || "?").charAt(0).toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={email ?? undefined}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-200 text-sm font-medium text-neutral-700 transition hover:bg-neutral-300"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-56 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg">
          {email && (
            <p className="truncate px-3 py-1.5 text-xs text-neutral-500">{email}</p>
          )}
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full rounded-md px-3 py-1.5 text-left text-sm text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              setShowDeleteModal(true);
            }}
            className="w-full rounded-md px-3 py-1.5 text-left text-sm text-red-600 transition hover:bg-red-50"
          >
            Delete account
          </button>
        </div>
      )}
      {showDeleteModal && (
        <DeleteAccountModal onClose={() => setShowDeleteModal(false)} />
      )}
    </div>
  );
}
