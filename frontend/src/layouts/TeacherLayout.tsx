import { useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Archive, BarChart3, ChevronDown, ChevronRight, LayoutDashboard, Menu, Users, LogOut, Shield } from 'lucide-react';
import ThemeToggle from '../components/ThemeToggle';
import { clearTeacherSession, getTeacherSession, isSuperAdmin } from '../lib/session';

type Accent = 'primary' | 'secondary' | 'tertiary';

interface NavChild {
  label: string;
  path: string;
  accent: Accent;
}

interface NavItem {
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  path: string;
  accent: Accent;
  children?: NavChild[];
  superAdminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', Icon: LayoutDashboard, path: '/teacher', accent: 'primary' },
  { label: 'Sessioni', Icon: BarChart3, path: '/teacher/sessions', accent: 'primary' },
  {
    label: 'Archivi',
    Icon: Archive,
    path: '/teacher/snapshots',
    accent: 'primary',
    children: [
      { label: 'Domande', path: '/teacher/snapshots', accent: 'primary' },
      { label: 'Punteggi', path: '/teacher/archives', accent: 'secondary' },
      { label: 'Studenti', path: '/teacher/student-snapshots', accent: 'tertiary' },
    ],
  },
  { label: 'Classi', Icon: Users, path: '/teacher/classes', accent: 'tertiary' },
  { label: 'Super Admin', Icon: Shield, path: '/super-admin', superAdminOnly: true, accent: 'primary' },
];

/** Resolve the accent color for a given pathname (children win over parents). */
function resolveAccent(pathname: string): Accent {
  for (const item of NAV_ITEMS) {
    if (item.children) {
      const child = item.children.find(c => pathname === c.path || pathname.startsWith(c.path + '/'));
      if (child) return child.accent;
    }
    if (pathname === item.path || (item.path !== '/teacher' && pathname.startsWith(item.path + '/'))) {
      return item.accent;
    }
  }
  return 'primary';
}

const ACCENT_GRADIENT: Record<Accent, string> = {
  primary: 'from-primary to-primary/50',
  secondary: 'from-secondary to-secondary/50',
  tertiary: 'from-tertiary to-tertiary/50',
};

const ACCENT_TEXT: Record<Accent, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
};

const ACCENT_BORDER: Record<Accent, string> = {
  primary: 'border-primary',
  secondary: 'border-secondary',
  tertiary: 'border-tertiary',
};

const ACCENT_BG_ACTIVE: Record<Accent, string> = {
  primary: 'bg-primary/5',
  secondary: 'bg-secondary/5',
  tertiary: 'bg-tertiary/5',
};

interface TeacherLayoutProps {
  children: ReactNode;
  pageTitle?: string;
  titleClassName?: string;
  headerActions?: ReactNode;
}

export default function TeacherLayout({ children, pageTitle, titleClassName, headerActions }: TeacherLayoutProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const session = getTeacherSession();
  const superAdmin = isSuperAdmin();
  const accent = resolveAccent(pathname);

  // Defense-in-depth: redirect if no session (router guard should catch this first)
  if (!session) {
    navigate('/teacher/login', { replace: true });
    return null;
  }

  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const item of NAV_ITEMS) {
      if (item.children?.some((c) => pathname === c.path || pathname.startsWith(c.path + '/'))) {
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

  const handleLogout = () => {
    clearTeacherSession();
    navigate('/teacher/login');
  };

  const visibleNavItems = NAV_ITEMS.filter(item => !item.superAdminOnly || superAdmin);

  return (
    <div className="flex min-h-screen bg-surface text-on-surface selection:bg-primary/30">
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-primary/5 blur-[150px] -z-10 rounded-full pointer-events-none" />
      <div className={`fixed top-20 w-[300px] h-[300px] bg-secondary/5 blur-[120px] -z-10 rounded-full pointer-events-none transition-all duration-300 ${sidebarOpen ? 'left-64' : 'left-16'}`} />

      <aside className={`fixed top-0 left-0 h-screen z-40 flex flex-col bg-surface-container-low border-r border-outline-variant/20 transition-all duration-300 ${sidebarOpen ? 'w-64' : 'w-16'}`}>
        <div className={`flex items-center gap-3 px-4 py-5 border-b border-outline-variant/20 ${!sidebarOpen ? 'justify-center' : ''}`}>
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <LayoutDashboard size={16} className="text-primary" />
          </div>
          {sidebarOpen && (
            <span className="font-headline text-sm font-bold bg-gradient-to-r from-primary to-primary-dim bg-clip-text text-transparent whitespace-nowrap overflow-hidden">
              QuizParty
            </span>
          )}
        </div>

        <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden">
          {visibleNavItems.map(({ label, Icon, path, children: subItems }) => {
            const hasChildren = !!subItems?.length;
            const isChildActive = hasChildren && subItems!.some((c) => pathname === c.path || pathname.startsWith(c.path + '/'));
            const isActive = !hasChildren && (pathname === path || (path !== '/teacher' && pathname.startsWith(path + '/')));
            const isOpen = openSections.has(label);
            const active = isActive || isChildActive;

            return (
              <div key={label}>
                <button
                  title={!sidebarOpen ? label : undefined}
                  onClick={() => {
                    if (hasChildren) {
                      if (sidebarOpen) toggleSection(label);
                      else navigate(path);
                    } else {
                      navigate(path);
                    }
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 transition-all border-l-4 ${
                    active
                      ? `bg-surface-bright ${ACCENT_TEXT[accent]} ${ACCENT_BORDER[accent]} translate-x-0.5`
                      : 'text-on-surface-variant hover:text-primary hover:bg-surface-container-high border-transparent'
                  } ${!sidebarOpen ? 'justify-center' : ''}`}
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
                      const isChildItemActive = pathname === child.path || pathname.startsWith(child.path + '/');
                      const childAccent = isChildItemActive ? accent : 'primary';
                      return (
                        <button
                          key={child.path}
                          onClick={() => navigate(child.path)}
                          className={`w-full flex items-center gap-2 pl-6 pr-4 py-2.5 transition-all border-l-2 -ml-px text-left ${
                            isChildItemActive
                              ? `${ACCENT_TEXT[childAccent]} ${ACCENT_BORDER[childAccent]} ${ACCENT_BG_ACTIVE[childAccent]}`
                              : 'text-on-surface-variant hover:text-primary hover:bg-surface-container-high border-transparent'
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

        <div className="p-4 border-t border-outline-variant/20 space-y-2">
          {sidebarOpen && session && (
            <div className="px-1 pb-2">
              <p className="text-xs font-medium text-on-surface truncate">{session.display_name}</p>
              <p className="text-xs text-on-surface-variant truncate">{session.email}</p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleLogout}
              className={`flex items-center gap-2 text-on-surface-variant hover:text-error transition-colors ${!sidebarOpen ? 'justify-center w-full' : ''}`}
              title="Esci"
            >
              <LogOut size={16} />
              {sidebarOpen && <span className="text-xs font-body">Esci</span>}
            </button>
            {sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(false)}
                className="ml-auto flex items-center gap-2 text-on-surface-variant hover:text-on-surface transition-colors"
                title="Comprimi sidebar"
              >
                <Menu size={16} />
              </button>
            )}
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="flex items-center justify-center w-full text-on-surface-variant hover:text-on-surface transition-colors"
                title="Espandi sidebar"
              >
                <Menu size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>

      <div className={`flex flex-col flex-1 transition-all duration-300 ${sidebarOpen ? 'ml-64' : 'ml-16'}`}>
        <header className="sticky top-0 z-30 bg-surface/80 backdrop-blur-xl border-b border-outline-variant/20 px-8 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className={`font-headline text-xl font-bold bg-gradient-to-r ${titleClassName ?? ACCENT_GRADIENT[accent]} bg-clip-text text-transparent`}>
              {pageTitle || 'QuizParty'}
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
