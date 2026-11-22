import React from "react";
import { Icon, IconName } from "./ui";

export type NavItem = {
  id: string;
  label: string;
  icon: IconName;
  badge?: number;
};

export default function AppShell({
  nav,
  active,
  onNavigate,
  children,
}: {
  accountName: string;
  roleLabel: string;
  nav: NavItem[];
  active: string;
  onNavigate: (id: string) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <main className="app-main">{children}</main>
      <nav className="bottom-nav">
        {nav.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${active === item.id ? "active" : ""}`}
            onClick={() => onNavigate(item.id)}
          >
            <Icon name={item.icon} size={18} />
            {item.badge ? <span className="nav-badge">{item.badge > 9 ? "9+" : item.badge}</span> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}
