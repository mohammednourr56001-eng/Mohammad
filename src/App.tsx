import React, { useEffect, useState } from 'react';
import {
  Bell,
  BookOpen,
  CheckCircle2,
  Heart,
  Home,
  LogIn,
  Menu,
  Search,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { PlatformDataProvider, usePlatformData } from './context/PlatformDataContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { StudentHome } from './components/StudentHome.tsx';
import {
  LecturesExplorer,
  LecturesSelectionState,
} from './components/LecturesExplorer.tsx';
import { SearchView } from './components/SearchView.tsx';
import { NotificationsView } from './components/NotificationsView.tsx';
import { ProfileView } from './components/ProfileView.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { FilePreviewModal } from './components/FilePreviewModal.tsx';
import { LoginModal } from './components/LoginModal.tsx';
import { LectureFile, Specialization, Subject } from './types/academic.ts';

type StudentScreen =
  | 'home'
  | 'lectures'
  | 'search'
  | 'notifications'
  | 'profile'
  | 'favorites';

function PlatformShell() {
  const {
    firebaseUser,
    isStaff,
    openLoginModal,
    claimedInviteBanner,
    dismissClaimedBanner,
    readNotificationIds,
  } = useAuth();
  const {
    specializations,
    academicYears,
    semesters,
    notifications,
    error,
  } = usePlatformData();

  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return (
        window.location.pathname.startsWith('/admin') ||
        new URLSearchParams(window.location.search).get('view') === 'admin'
      );
    }
    return false;
  });

  const [screen, setScreen] = useState<StudentScreen>('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchSeedQuery, setSearchSeedQuery] = useState('');
  const [previewFile, setPreviewFile] = useState<LectureFile | null>(null);
  const [lecturesSelection, setLecturesSelection] = useState<LecturesSelectionState>({
    specialization: null,
    year: null,
    semester: null,
    subject: null,
  });

  useEffect(() => {
    const onPopState = () => {
      const adminActive =
        window.location.pathname.startsWith('/admin') ||
        new URLSearchParams(window.location.search).get('view') === 'admin';
      setIsAdminRoute(adminActive);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateToAdmin = () => {
    setIsAdminRoute(true);
    setMobileMenuOpen(false);
    try {
      window.history.pushState({}, '', '/admin');
    } catch {
      // ignore history errors
    }
  };

  const exitAdmin = () => {
    setIsAdminRoute(false);
    setScreen('home');
    try {
      window.history.pushState({}, '', '/');
    } catch {
      // ignore history errors
    }
  };

  const openLecturesRoot = () => {
    setLecturesSelection({
      specialization: null,
      year: null,
      semester: null,
      subject: null,
    });
    setScreen('lectures');
    setMobileMenuOpen(false);
  };

  const openSpecialization = (spec: Specialization) => {
    setLecturesSelection({
      specialization: spec,
      year: null,
      semester: null,
      subject: null,
    });
    setScreen('lectures');
    setMobileMenuOpen(false);
  };

  const openSubjectDirectly = (subject: Subject) => {
    const spec = specializations.find((s) => s.id === subject.specializationId) || null;
    const year = academicYears.find((y) => y.id === subject.academicYearId) || null;
    const sem = semesters.find((s) => s.id === subject.semesterId) || null;
    setLecturesSelection({
      specialization: spec,
      year,
      semester: sem,
      subject,
    });
    setScreen('lectures');
  };

  const unreadCount = notifications.filter(
    (n) => n.status === 'published' && !readNotificationIds.has(n.id)
  ).length;

  if (isAdminRoute) {
    return (
      <>
        <AdminDashboard
          onExitAdmin={exitAdmin}
          onPreviewFile={(file) => setPreviewFile(file)}
        />
        <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
        <LoginModal />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-white text-[#0B2545] flex flex-col">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 h-14 sm:h-16 bg-white/95 backdrop-blur-md border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="فتح القائمة الجانبية"
              className="lg:hidden min-h-[44px] min-w-[44px] -mr-2 rounded-xl text-[#0B2545] hover:bg-[#EAF4F7] flex items-center justify-center transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setScreen('home')}
              className="font-display text-base sm:text-lg font-bold tracking-tight text-[#0B2545] whitespace-nowrap shrink-0"
            >
              منصة UST للمحاضرات
            </button>
          </div>

          <nav
            aria-label="التنقل الرئيسي"
            className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600"
          >
            {[
              { id: 'home', label: 'الرئيسية' },
              { id: 'lectures', label: 'المحاضرات' },
              { id: 'search', label: 'البحث' },
              { id: 'notifications', label: 'الإشعارات' },
              { id: 'profile', label: 'حسابي' },
            ].map((item) => {
              const active = screen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === 'lectures') {
                      openLecturesRoot();
                    } else {
                      setScreen(item.id as StudentScreen);
                    }
                  }}
                  className={`py-1.5 whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                    active
                      ? 'border-[#00A6A6] text-[#0B2545] font-bold'
                      : 'border-transparent hover:text-[#0B2545] hover:border-slate-300'
                  }`}
                >
                  {item.label}
                  {item.id === 'notifications' && unreadCount > 0 && (
                    <span className="mr-1.5 text-xs font-bold text-[#FF8066] tabular-nums">
                      ({unreadCount})
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            {isStaff ? (
              <button
                type="button"
                onClick={navigateToAdmin}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0B2545] hover:bg-[#133866] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <ShieldCheck className="w-4 h-4 text-[#00A6A6]" />
                لوحة الإدارة
              </button>
            ) : !firebaseUser ? (
              <button
                type="button"
                onClick={openLoginModal}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <LogIn className="w-4 h-4" />
                تسجيل الدخول
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setScreen('profile')}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#EAF4F7] hover:bg-[#d8ecf2] text-[#0B2545] text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <User className="w-4 h-4 text-[#00A6A6]" />
                {firebaseUser.displayName?.split(' ')[0] || 'حسابي'}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Slide-Out Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="fixed top-0 right-0 bottom-0 w-72 bg-[#0B2545] text-white p-5 flex flex-col justify-between shadow-2xl">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="font-display text-lg font-bold">
                  منصة UST للمحاضرات
                </span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="إغلاق القائمة"
                  className="min-h-[40px] min-w-[40px] rounded-xl bg-white/10 flex items-center justify-center"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <nav className="space-y-1.5">
                {[
                  { id: 'home', label: 'الرئيسية', icon: <Home className="w-4 h-4" /> },
                  { id: 'lectures', label: 'المحاضرات', icon: <BookOpen className="w-4 h-4" /> },
                  { id: 'search', label: 'البحث والفلترة', icon: <Search className="w-4 h-4" /> },
                  { id: 'notifications', label: 'الإشعارات والإعلانات', icon: <Bell className="w-4 h-4" /> },
                  { id: 'favorites', label: 'المفضلة', icon: <Heart className="w-4 h-4" /> },
                  { id: 'profile', label: 'حسابي', icon: <User className="w-4 h-4" /> },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (item.id === 'lectures') openLecturesRoot();
                      else setScreen(item.id as StudentScreen);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-3 ${
                      screen === item.id
                        ? 'bg-[#00A6A6] text-white font-semibold'
                        : 'text-white/85 hover:bg-white/10'
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}

                {isStaff && (
                  <button
                    type="button"
                    onClick={navigateToAdmin}
                    className="w-full min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold text-[#FF8066] bg-white/5 hover:bg-white/10 flex items-center gap-3 mt-3"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    لوحة الإدارة
                  </button>
                )}
              </nav>
            </div>

            <p className="text-xs text-white/60">
              جامعة العلوم والتقنية · البوابة الأكاديمية
            </p>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-6 pb-20 lg:pb-12">
        {claimedInviteBanner && (
          <div
            role="status"
            className="mb-5 rounded-2xl bg-[#EAF4F7] border border-[#00A6A6]/40 px-4 py-3 text-sm text-[#0B2545] flex items-center justify-between gap-3"
          >
            <span className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="w-4 h-4 text-[#00A6A6]" />
              {claimedInviteBanner}
            </span>
            <button
              type="button"
              onClick={dismissClaimedBanner}
              className="text-xs font-bold text-[#00A6A6] underline"
            >
              إغلاق
            </button>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-6 rounded-2xl bg-[#FF8066]/10 border border-[#FF8066]/30 px-4 py-3 text-sm text-[#0B2545]"
          >
            {error}
          </div>
        )}

        {screen === 'home' && (
          <StudentHome
            onOpenLectures={openLecturesRoot}
            onSelectSpecialization={openSpecialization}
            onOpenSearch={(q) => {
              setSearchSeedQuery(q || '');
              setScreen('search');
            }}
            onOpenNotifications={() => setScreen('notifications')}
            onPreviewFile={(file) => setPreviewFile(file)}
          />
        )}

        {screen === 'lectures' && (
          <LecturesExplorer
            selection={lecturesSelection}
            onChangeSelection={setLecturesSelection}
            onBackHome={() => setScreen('home')}
            onPreviewFile={(file) => setPreviewFile(file)}
            onRequireSignIn={openLoginModal}
          />
        )}

        {screen === 'search' && (
          <SearchView
            initialQuery={searchSeedQuery}
            onNavigateToSpecialization={openSpecialization}
            onNavigateToSubject={openSubjectDirectly}
            onPreviewFile={(file) => setPreviewFile(file)}
          />
        )}

        {screen === 'notifications' && (
          <NotificationsView
            onOpenLecturesBySpec={(specId) => {
              const found = specializations.find((s) => s.id === specId);
              if (found) openSpecialization(found);
              else openLecturesRoot();
            }}
          />
        )}

        {(screen === 'profile' || screen === 'favorites') && (
          <ProfileView
            onOpenAdmin={navigateToAdmin}
            onPreviewFile={(file) => setPreviewFile(file)}
            initialFocusFavorites={screen === 'favorites'}
          />
        )}
      </main>

      {/* Desktop Footer */}
      <footer className="hidden lg:block border-t border-slate-200/80 bg-[#EAF4F7]/40 py-5 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-xs text-slate-500">
          <span>منصة UST للمحاضرات · جامعة العلوم والتقنية</span>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={openLecturesRoot}
              className="hover:text-[#0B2545]"
            >
              تصفح المحاضرات
            </button>
            <button
              type="button"
              onClick={() => setScreen('notifications')}
              className="hover:text-[#0B2545]"
            >
              الإعلانات الأكاديمية
            </button>
            {isStaff && (
              <button
                type="button"
                onClick={navigateToAdmin}
                className="text-[#00A6A6] font-semibold hover:underline"
              >
                لوحة الإدارة
              </button>
            )}
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="شريط التنقل السفلي"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 h-[58px] bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-5 items-center px-1"
      >
        <button
          type="button"
          onClick={openLecturesRoot}
          aria-label="المحاضرات"
          className={`h-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
            screen === 'lectures' ? 'text-[#00A6A6] font-bold' : 'text-slate-500'
          }`}
        >
          <BookOpen className="w-5 h-5" />
          <span>المحاضرات</span>
        </button>

        <button
          type="button"
          onClick={() => setScreen('search')}
          aria-label="البحث"
          className={`h-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
            screen === 'search' ? 'text-[#00A6A6] font-bold' : 'text-slate-500'
          }`}
        >
          <Search className="w-5 h-5" />
          <span>البحث</span>
        </button>

        <button
          type="button"
          onClick={() => setScreen('home')}
          aria-label="الرئيسية"
          className="h-full flex flex-col items-center justify-center"
        >
          <span
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
              screen === 'home'
                ? 'bg-[#00A6A6] text-white shadow-sm'
                : 'bg-[#EAF4F7] text-[#0B2545]'
            }`}
          >
            <Home className="w-5 h-5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => setScreen('favorites')}
          aria-label="المفضلة"
          className={`h-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
            screen === 'favorites' ? 'text-[#FF8066] font-bold' : 'text-slate-500'
          }`}
        >
          <Heart className="w-5 h-5" />
          <span>المفضلة</span>
        </button>

        <button
          type="button"
          onClick={() => setScreen('profile')}
          aria-label="حسابي"
          className={`h-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
            screen === 'profile' ? 'text-[#00A6A6] font-bold' : 'text-slate-500'
          }`}
        >
          <User className="w-5 h-5" />
          <span>حسابي</span>
        </button>
      </nav>

      {/* Modals */}
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      <LoginModal />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <PlatformDataProvider>
          <PlatformShell />
        </PlatformDataProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
