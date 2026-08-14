"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } =
      mode === "sign_in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">
        {mode === "sign_in" ? "Log in" : "Create an account"}
      </h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-base"
        />
        <input
          type="password"
          autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
          placeholder="Password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-base"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-neutral-900 px-6 py-2 text-white transition hover:bg-neutral-700 disabled:opacity-50"
        >
          {loading ? "Please wait…" : mode === "sign_in" ? "Log in" : "Sign up"}
        </button>
      </form>

      <button
        onClick={() => setMode(mode === "sign_in" ? "sign_up" : "sign_in")}
        className="text-sm text-neutral-500 underline"
      >
        {mode === "sign_in"
          ? "Need an account? Sign up"
          : "Already have an account? Log in"}
      </button>
    </main>
  );
}
