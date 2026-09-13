"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import HeroBanner from "../hero-banner";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  // ADULT ACCOUNTS ONLY. Accounts are for grown-ups; the cartoon voices
  // exist so a video an adult makes is fun for a child to WATCH, not so
  // children sign up. A self-declared checkbox is not verification, but it
  // is the standard bar for a service that is not directed to children,
  // and it makes the intent explicit both to the user and on the record.
  // If this ever becomes a service children sign up for, this checkbox is
  // nowhere near enough — COPPA would require verifiable parental consent.
  const [isAdult, setIsAdult] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (mode === "sign_up" && !isAdult) {
      setLoading(false);
      setError("You need to confirm you are 18 or older to create an account.");
      return;
    }

    const { error } =
      mode === "sign_in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              data: displayName.trim()
                ? { display_name: displayName.trim() }
                : undefined,
            },
          });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <>
      <HeroBanner variant="slim">
        <Image
          src="/logo-mark.png"
          alt=""
          width={40}
          height={40}
          className="h-9 w-9"
          priority
        />
      </HeroBanner>
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">
        {mode === "sign_in" ? "Log in" : "Create an account"}
      </h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {mode === "sign_up" && (
          <label className="flex flex-col gap-1 text-sm text-sage-600">
            Display name
            <input
              type="text"
              placeholder="e.g. Pastor John"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="rounded-lg border border-sage-300 px-4 py-2 text-base text-sage-900"
            />
            <span className="text-xs text-sage-400">
              This is the name others will see — you can leave it blank to
              use your email instead.
            </span>
          </label>
        )}
        {mode === "sign_up" && (
          <label className="flex items-start gap-3 text-sm text-sage-600">
            <input
              type="checkbox"
              checked={isAdult}
              onChange={(e) => setIsAdult(e.target.checked)}
              // Big enough to hit with a thumb. The default checkbox is
              // about 13px, which is half the 44px minimum a phone wants.
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-sage-300 accent-sage-600"
            />
            <span>
              I am 18 or older, and I agree to the{" "}
              <a href="/terms" className="underline" target="_blank">
                Terms
              </a>{" "}
              and{" "}
              <a href="/privacy" className="underline" target="_blank">
                Privacy Policy
              </a>
              .
            </span>
          </label>
        )}
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-sage-300 px-4 py-2 text-base"
        />
        <input
          type="password"
          autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
          placeholder="Password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-sage-300 px-4 py-2 text-base"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-sage-600 px-6 py-2 text-white transition hover:bg-sage-700 disabled:opacity-50"
        >
          {loading ? "Please wait…" : mode === "sign_in" ? "Log in" : "Sign up"}
        </button>
      </form>

      <button
        onClick={() => setMode(mode === "sign_in" ? "sign_up" : "sign_in")}
        className="text-sm text-sage-500 underline"
      >
        {mode === "sign_in"
          ? "Need an account? Sign up"
          : "Already have an account? Log in"}
      </button>
      </main>
    </>
  );
}
