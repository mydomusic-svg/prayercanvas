// Shared chrome for /privacy and /terms.
//
// Deliberately plain: legal text is read by people looking for one specific
// answer, usually on a phone, often while mildly annoyed. Generous line
// height, a readable measure, real headings they can scan.

export const LAST_UPDATED = "13 September 2026";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="font-serif text-3xl text-sage-900">{title}</h1>
      <p className="mt-2 text-xs text-sage-500">Last updated {updated}</p>
      <div className="mt-8">{children}</div>
    </main>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 font-serif text-xl text-sage-900">{children}</h2>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 leading-relaxed text-sage-700">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mt-4 space-y-2 pl-5 leading-relaxed text-sage-700 [&>li]:list-disc">
      {children}
    </ul>
  );
}

export function LI({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}
