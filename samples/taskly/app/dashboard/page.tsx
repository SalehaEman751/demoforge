"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  clearUser,
  getTasks,
  getUser,
  saveTasks,
  type Task,
  type User,
} from "../../lib/storage";
import { isRenamedVariant } from "../../lib/variant";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [addLabel, setAddLabel] = useState("Add task");

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace("/signup");
      return;
    }
    setAddLabel(isRenamedVariant() ? "Add item" : "Add task"); // seeded failure, see README
    setUser(u);
    setTasks(getTasks());
  }, [router]);

  if (!user) return null;

  function update(next: Task[]) {
    setTasks(next);
    saveTasks(next);
  }

  function onAdd(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) {
      setError("Please type a task first.");
      return;
    }
    // Task text is the checkbox's accessible name, so keep it unique.
    if (tasks.some((x) => x.text.toLowerCase() === t.toLowerCase())) {
      setError("That task is already on your list.");
      return;
    }
    setError("");
    setText("");
    update([...tasks, { id: crypto.randomUUID(), text: t, done: false }]);
  }

  function onLogout() {
    clearUser();
    router.push("/signup");
  }

  return (
    <main className="mx-auto max-w-2xl px-6 pb-8 pt-2">
      <div className="flex items-center justify-between gap-4">
        <h1 className="truncate text-2xl font-bold">Welcome, {user.email}</h1>
        <button type="button" onClick={onLogout} className="btn-ghost shrink-0">
          Log out
        </button>
      </div>

      <section className="card mt-5 p-6">
        <h2 className="text-lg font-semibold">Your tasks</h2>
        <form onSubmit={onAdd} noValidate className="mt-4 flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="new-task" className="mb-1 block text-sm font-medium">
              New task
            </label>
            <input
              id="new-task"
              type="text"
              placeholder="What needs doing?"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="field"
            />
          </div>
          <button type="submit" className="btn-primary">
            {addLabel}
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {tasks.length === 0 ? (
          <p className="mt-6 rounded-lg bg-accent-soft px-4 py-6 text-center text-slate-600">
            No tasks yet
          </p>
        ) : (
          <ul className="mt-5 max-h-64 divide-y divide-slate-100 overflow-y-auto">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3 py-3">
                <input
                  id={`task-${task.id}`}
                  type="checkbox"
                  checked={task.done}
                  onChange={() =>
                    update(tasks.map((x) => (x.id === task.id ? { ...x, done: !x.done } : x)))
                  }
                  className="h-5 w-5 rounded border-slate-300 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                />
                <label
                  htmlFor={`task-${task.id}`}
                  className={`flex-1 break-words ${task.done ? "text-slate-400 line-through" : ""}`}
                >
                  {task.text}
                </label>
                <button
                  type="button"
                  aria-label={`Delete ${task.text}`}
                  onClick={() => update(tasks.filter((x) => x.id !== task.id))}
                  className="btn-ghost px-3 py-1 text-red-700"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
