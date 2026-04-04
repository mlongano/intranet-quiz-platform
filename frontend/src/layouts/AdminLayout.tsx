import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, BarChart3, ChevronDown, ChevronRight, FileText, LayoutDashboard, Menu, Users } from "lucide-react";
import ThemeToggle from "../components/ThemeToggle";

interface NavChild {
  label: string;
  path: string;
}

interface NavItem {
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  path: string;
  children?: NavChild[];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard",  Icon: LayoutDashboard, path: "/admin/dashboard" },
  { label: "Questions",  Icon: FileText,         path: "/admin/questions" },
  { label: "Scores",     Icon: BarChart3,        path: "/admin/scores" },
  { label: "Students",   Icon: Users,            path: "/admin/students" },
  {
    label: "Archives",
    Icon: Archive,
    path: "/admin/questions-bank",
    children: [
      { label: "Question Banks", path: "/admin/questions-bank" },
      { label: "Scores Bank",    path: "/admin/scores-bank" },
      { label: "Students Bank",  path: "/admin/students-bank" },
    ],
  },
];

interface AdminLayoutProps {
  activePath: string;
  adminPassword: string;
  children: ReactNode;
  pageTitle?: string;
  headerActions?: ReactNode;
}

export default function AdminLayout({ activePath, adminPassword, children, pageTitle, headerActions }: AdminLayoutProps) {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const navigateTo = (path: string) => navigate(path, { state: { adminPassword } });

  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const item of NAV_ITEMS) {
      if (item.children?.some((c) => activePath === c.path || activePath.startsWith(c.path + "?"))) {
        initial.add(item.label);
      }
    }
    return initial;
  });

  const toggleSection = (label: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <div className="flex min-h-screen bg-surface text-on-surface selection:bg-primary/30">
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-primary/5 blur-[150px] -z-10 rounded-full pointer-events-none" />
      <div className={`fixed top-20 w-[300px] h-[300px] bg-secondary/5 blur-[120px] -z-10 rounded-full pointer-events-none transition-all duration-300 ${sidebarOpen ? "left-64" : "left-16"}`} />

      <aside className={`fixed top-0 left-0 h-screen z-40 flex flex-col bg-surface-container-low border-r border-outline-variant/20 transition-all duration-300 ${sidebarOpen ? "w-64" : "w-16"}`}>
        <div className={`flex items-center gap-3 px-4 py-5 border-b border-outline-variant/20 ${!sidebarOpen ? "justify-center" : ""}`}>
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <LayoutDashboard size={16} className="text-primary" />
          </div>
          {sidebarOpen && (
            <span className="font-headline text-sm font-bold bg-gradient-to-r from-primary to-primary-dim bg-clip-text text-transparent whitespace-nowrap overflow-hidden">
              QuizParty Admin
            </span>
          )}
        </div>
        <nav className="flex-1 py-4 overflow-hidden">
          {NAV_ITEMS.map(({ label, Icon, path, children: subItems }) => {
            const hasChildren = !!subItems?.length;
            const isChildActive = hasChildren && subItems!.some((c) => activePath === c.path || activePath.startsWith(c.path + "?"));
            const isActive = !hasChildren && (activePath === path || activePath.startsWith(path + "?"));
            const isOpen = openSections.has(label);

            return (
              <div key={label}>
                <button
                  title={!sidebarOpen ? label : undefined}
                  onClick={() => {
                    if (hasChildren) {
                      if (sidebarOpen) toggleSection(label);
                      else navigateTo(path);
                    } else {
                      navigateTo(path);
                    }
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 transition-all border-l-4 ${
                    isActive || isChildActive
                      ? "bg-surface-bright text-primary border-primary translate-x-0.5"
                      : "text-on-surface-variant hover:text-primary hover:bg-surface-container-high border-transparent"
                  } ${!sidebarOpen ? "justify-center" : ""}`}
                >
                  <Icon size={18} className="flex-shrink-0" />
                  {sidebarOpen && (
                    <>
                      <span className="text-sm font-medium font-body whitespace-nowrap flex-1 text-left">{label}</span>
                      {hasChildren && (
                        isOpen
                          ? <ChevronDown size={14} className="flex-shrink-0 opacity-60" />
                          : <ChevronRight size={14} className="flex-shrink-0 opacity-60" />
                      )}
                    </>
                  )}
                </button>
                {sidebarOpen && hasChildren && isOpen && (
                  <div className="ml-4 border-l border-outline-variant/30">
                    {subItems!.map((child) => {
                      const isChildItemActive = activePath === child.path || activePath.startsWith(child.path + "?");
                      return (
                        <button
                          key={child.path}
                          onClick={() => navigateTo(child.path)}
                          className={`w-full flex items-center gap-2 pl-6 pr-4 py-2.5 transition-all border-l-2 -ml-px text-left ${
                            isChildItemActive
                              ? "text-primary border-primary bg-primary/5"
                              : "text-on-surface-variant hover:text-primary hover:bg-surface-container-high border-transparent"
                          }`}
                        >
                          <span className="text-xs font-medium font-body whitespace-nowrap">{child.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="p-4 border-t border-outline-variant/20">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className={`flex items-center gap-3 text-on-surface-variant hover:text-on-surface transition-colors w-full ${!sidebarOpen ? "justify-center" : ""}`}
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <Menu size={18} />
            {sidebarOpen && <span className="text-xs font-body text-on-surface-variant">Collapse</span>}
          </button>
        </div>
      </aside>

      <div className={`flex flex-col flex-1 transition-all duration-300 ${sidebarOpen ? "ml-64" : "ml-16"}`}>
        <header className="sticky top-0 z-30 bg-surface/80 backdrop-blur-xl border-b border-outline-variant/20 px-8 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="font-headline text-xl font-bold bg-gradient-to-r from-primary to-primary-dim bg-clip-text text-transparent">
              {pageTitle || "Admin"}
            </h1>
            <div className="flex items-center gap-4">
              {headerActions && <div className="flex items-center gap-4">{headerActions}</div>}
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="p-8 flex-1">{children}</main>
      </div>
    </div>
  );
}