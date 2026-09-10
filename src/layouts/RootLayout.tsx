import { Link, Outlet } from "@tanstack/react-router";

export function RootLayout() {
  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
      <nav className="flex justify-center gap-4 p-4">
        <Link
          to="/"
          className="font-medium text-indigo-500 hover:text-indigo-600 dark:hover:text-cyan-400"
        >
          Home
        </Link>
        <Link
          to="/about"
          className="font-medium text-indigo-500 hover:text-indigo-600 dark:hover:text-cyan-400"
        >
          About
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}
