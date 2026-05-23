"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const navItems = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/employees", label: "Employees", icon: "👥" },
  { href: "/kiosk", label: "Face Kiosk", icon: "📷" },
  { href: "/qr-cards", label: "QR Cards", icon: "📇" },
  { href: "/live", label: "Live", icon: "🔴" },
  { href: "/attendance", label: "Attendance", icon: "📍" },
  { href: "/leaves", label: "Leaves", icon: "📅" },
  { href: "/salary", label: "Salary", icon: "💰" },
  { href: "/reports", label: "Reports", icon: "📈" },
  { href: "/holidays", label: "Holidays", icon: "🎉" },
  { href: "/shifts", label: "Shifts", icon: "🔄" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  return (
    <aside className={`sidebar ${open ? "open" : "closed"}`}>
      <div className="sidebar-header">
        <h2>{open ? "HRMS" : "H"}</h2>
        <button onClick={() => setOpen(!open)} className="toggle-btn">
          {open ? "◀" : "▶"}
        </button>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${active ? "active" : ""}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {open && <span className="nav-label">{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
