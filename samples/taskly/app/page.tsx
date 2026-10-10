import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 pt-16 text-center">
      <h1 className="text-5xl font-bold tracking-tight">Simple tasks for busy people</h1>
      <p className="mx-auto mt-5 max-w-xl text-lg text-slate-600">
        Taskly keeps your to-do list small, fast and out of your way.
      </p>
      <Link href="/signup" className="btn-primary mt-8 px-6 py-3 text-base">
        Get started
      </Link>
    </main>
  );
}
