import React from "react";
import { Icon, IconName } from "./ui";

export type NavItem = {
  id: string;
  label: string;
  icon: IconName;
  badge?: number;
};

export default function AppShell({
  accountName,
  roleLabel,
  nav,
  active,
  onNavigate,
  onLogout,
  onOpenSettings,
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
  void accountName;
  void roleLabel;
  void onLogout;
  void onOpenSettings;
  return (
    <div className="app-shell">
      <main className="app-main">{children}</main>
      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        {nav.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${active === item.id ? "active" : ""}`}
            onClick={() => onNavigate(item.id)}
            aria-current={active === item.id ? "page" : undefined}
            aria-label={item.label}
            title={item.label}
          >
            <span className="nav-icon">
              <Icon name={item.icon} size={21} />
            </span>
            <span className="nav-label">{item.label}</span>
            {item.badge ? <span className="nav-badge">{item.badge > 9 ? "9+" : item.badge}</span> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}
