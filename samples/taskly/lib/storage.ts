export type User = { email: string };
export type Task = { id: string; text: string; done: boolean };

const USER_KEY = "taskly:user";
const TASKS_KEY = "taskly:tasks";

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep working in memory */
  }
}

export const getUser = (): User | null => {
  const u = read<User>(USER_KEY);
  return u && typeof u.email === "string" ? u : null;
};
export const saveUser = (user: User): void => write(USER_KEY, user);
export const clearUser = (): void => {
  try {
    window.localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
};

export const getTasks = (): Task[] => {
  const t = read<Task[]>(TASKS_KEY);
  return Array.isArray(t) ? t : [];
};
export const saveTasks = (tasks: Task[]): void => write(TASKS_KEY, tasks);
