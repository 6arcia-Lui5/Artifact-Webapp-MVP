import { Outlet } from "react-router";
import Navbar from "./Navbar";

export default function AppLayout() {
  return (
    <>
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 py-8">
        <Outlet />
      </main>
    </>
  );
}
