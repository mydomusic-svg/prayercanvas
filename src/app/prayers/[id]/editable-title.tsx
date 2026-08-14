"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// The AI-generated title used to be permanent. Click-to-edit lets the user
// fix a title Claude got slightly wrong or personalize it before sharing.
export default function EditableTitle({
  prayerId,
  title,
}: {
  prayerId: string;
  title: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === title) {
      setValue(title);
      setEditing(false);
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("prayers")
      .update({ title: trimmed })
      .eq("id", prayerId);
    setSaving(false);
    setEditing(false);
    if (!error) router.refresh();
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(title);
            setEditing(false);
          }
        }}
        className="w-full rounded-lg border border-sage-300 px-3 py-1 text-2xl font-semibold outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      title="Click to rename"
      className="text-left text-2xl font-semibold decoration-dashed decoration-sage-300 decoration-2 underline-offset-4 hover:underline"
    >
      {title}
    </button>
  );
}
