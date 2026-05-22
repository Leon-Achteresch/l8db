import { Link, Outlet } from "@tanstack/react-router";

export function RootLayout() {
  return (
    <>
      <nav className="row nav">
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
      </nav>
      <Outlet />
    </>
  );
}
