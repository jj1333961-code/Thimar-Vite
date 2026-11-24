import React from "react";
import { BrandMark, Icon, IconName } from "./ui";

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
  const initial = accountName.trim().charAt(0) || "ث";
  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="thimar-topbar-brand" aria-label="ثمار">
          <BrandMark size={42} />
          <div>
            <div className="thimar-wordmark">ثمار</div>
            <div className="thimar-tagline">تنمو بالعلم وتزهر بالعمل</div>
          </div>
        </div>
        <div className="thimar-user-area">
          <div className="thimar-user-copy">
            <strong>{accountName}</strong>
            <span>{roleLabel}</span>
          </div>
          <div className="thimar-avatar" aria-hidden="true">{initial}</div>
        </div>
      </header>
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
            <Icon name={item.icon} size={21} />
            <span className="nav-label">{item.label}</span>
            {item.badge ? <span className="nav-badge">{item.badge > 9 ? "9+" : item.badge}</span> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}
