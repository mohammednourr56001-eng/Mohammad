import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase.ts';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors.ts';
import {
  AccountStatus,
  AdminEntry,
  ALL_PERMISSIONS,
  PermissionKey,
  UserProfile,
  UserRole,
} from '../types/academic.ts';
import {
  canAccessAdminDashboard,
  hasPermission,
  resolveEffectivePermissions,
} from '../utils/academicLogic.ts';

const BOOTSTRAPPED_ADMIN_EMAIL = 'mohammednourr56000@gmail.com';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  adminEntry: AdminEntry | null;
  role: UserRole;
  permissions: PermissionKey[];
  accountStatus: AccountStatus;
  isSuperAdmin: boolean;
  isStaff: boolean;
  isAdmin: boolean;
  hasPerm: (perm: PermissionKey) => boolean;
  authReady: boolean;
  authLoading: boolean;
  authError: string | null;
  claimedInviteBanner: string | null;
  dismissClaimedBanner: () => void;
  loginModalOpen: boolean;
  openLoginModal: () => void;
  closeLoginModal: () => void;
  favoriteIds: Set<string>;
  readNotificationIds: Set<string>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  toggleFavorite: (fileId: string, subjectId: string) => Promise<void>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  updateAcademicPreference: (specializationId: string, academicYearId: string) => Promise<void>;
  updateProfileInfo: (params: {
    displayName: string;
    specializationId?: string;
    academicYearId?: string;
  }) => Promise<void>;
  refreshAuthProfile: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [adminEntry, setAdminEntry] = useState<AdminEntry | null>(null);
  const [syncedAuthSnapshot, setSyncedAuthSnapshot] = useState<{
    role: UserRole;
    permissions: PermissionKey[];
    status: AccountStatus;
  } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [claimedInviteBanner, setClaimedInviteBanner] = useState<string | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(new Set());

  const syncWithServer = useCallback(async (user: User) => {
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/auth/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) return null;
      const data = await res.json();
      setSyncedAuthSnapshot({
        role: (data.role || 'student') as UserRole,
        permissions: Array.isArray(data.permissions) ? data.permissions : [],
        status: (data.status === 'suspended' ? 'suspended' : 'active') as AccountStatus,
      });
      if (data.claimedInviteId) {
        setClaimedInviteBanner('تم تفعيل صلاحياتك الإدارية الجديدة بنجاح.');
      }
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let unsubAdmin: (() => void) | null = null;
    let unsubFavs: (() => void) | null = null;
    let unsubReads: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubProfile) unsubProfile();
      if (unsubAdmin) unsubAdmin();
      if (unsubFavs) unsubFavs();
      if (unsubReads) unsubReads();

      setFirebaseUser(user);
      setAuthError(null);

      if (!user) {
        setProfile(null);
        setAdminEntry(null);
        setSyncedAuthSnapshot(null);
        setFavoriteIds(new Set());
        setReadNotificationIds(new Set());
        setAuthReady(true);
        return;
      }

      try {
        await syncWithServer(user);

        const userRef = doc(db, 'users', user.uid);
        unsubProfile = onSnapshot(
          userRef,
          (snap) => {
            if (snap.exists()) {
              setProfile(snap.data() as UserProfile);
            }
          },
          () => {}
        );

        unsubAdmin = onSnapshot(
          doc(db, 'admins', user.uid),
          (snap) => {
            if (snap.exists()) {
              setAdminEntry(snap.data() as AdminEntry);
            } else {
              setAdminEntry(null);
            }
          },
          () => {
            setAdminEntry(null);
          }
        );

        unsubFavs = onSnapshot(
          collection(db, 'users', user.uid, 'favorites'),
          (snap) => {
            setFavoriteIds(new Set(snap.docs.map((d) => d.id)));
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/favorites`)
        );

        unsubReads = onSnapshot(
          collection(db, 'users', user.uid, 'readNotifications'),
          (snap) => {
            setReadNotificationIds(new Set(snap.docs.map((d) => d.id)));
          },
          (err) =>
            handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/readNotifications`)
        );
      } catch (error) {
        console.error('Auth sync error:', error);
      } finally {
        setAuthReady(true);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
      if (unsubAdmin) unsubAdmin();
      if (unsubFavs) unsubFavs();
      if (unsubReads) unsubReads();
    };
  }, [syncWithServer]);

  const signInWithGoogle = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (cred.user) {
        await syncWithServer(cred.user);
      }
      setLoginModalOpen(false);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'تعذر تسجيل الدخول.';
      if (msg.includes('popup-closed-by-user')) {
        setAuthError('تم إغلاق نافذة تسجيل الدخول قبل إتمام العملية.');
      } else {
        setAuthError('تعذر تسجيل الدخول بحساب Google. يرجى المحاولة مجدداً.');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    setAuthLoading(true);
    try {
      await signOut(auth);
      setClaimedInviteBanner(null);
    } finally {
      setAuthLoading(false);
    }
  };

  const toggleFavorite = async (fileId: string, subjectId: string) => {
    if (!firebaseUser) {
      throw new Error('يجب تسجيل الدخول لحفظ المحاضرات في المفضلة.');
    }
    const favRef = doc(db, 'users', firebaseUser.uid, 'favorites', fileId);
    try {
      if (favoriteIds.has(fileId)) {
        await deleteDoc(favRef);
      } else {
        await setDoc(favRef, {
          fileId,
          subjectId,
          createdAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${firebaseUser.uid}/favorites/${fileId}`);
    }
  };

  const markNotificationRead = async (notificationId: string) => {
    if (!firebaseUser || readNotificationIds.has(notificationId)) return;
    const readRef = doc(db, 'users', firebaseUser.uid, 'readNotifications', notificationId);
    try {
      await setDoc(readRef, {
        notificationId,
        readAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.WRITE,
        `users/${firebaseUser.uid}/readNotifications/${notificationId}`
      );
    }
  };

  const updateAcademicPreference = async (specializationId: string, academicYearId: string) => {
    if (!firebaseUser) return;
    const userRef = doc(db, 'users', firebaseUser.uid);
    try {
      await updateDoc(userRef, {
        specializationId,
        academicYearId,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${firebaseUser.uid}`);
    }
  };

  const updateProfileInfo = async (params: {
    displayName: string;
    specializationId?: string;
    academicYearId?: string;
  }) => {
    if (!firebaseUser) return;
    const cleanName = params.displayName.trim();
    if (cleanName.length < 2) return;
    const userRef = doc(db, 'users', firebaseUser.uid);
    try {
      const payload: Record<string, unknown> = {
        displayName: cleanName,
        updatedAt: serverTimestamp(),
      };
      if (params.specializationId !== undefined) payload.specializationId = params.specializationId;
      if (params.academicYearId !== undefined) payload.academicYearId = params.academicYearId;
      await updateDoc(userRef, payload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${firebaseUser.uid}`);
    }
  };

  const refreshAuthProfile = async () => {
    if (!auth.currentUser) return;
    await syncWithServer(auth.currentUser);
  };

  const getIdToken = async (): Promise<string | null> => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken();
  };

  const isBootstrapOwner = Boolean(
    firebaseUser?.emailVerified &&
      firebaseUser?.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL
  );

  const accountStatus: AccountStatus = isBootstrapOwner
    ? 'active'
    : (adminEntry?.status || profile?.status || syncedAuthSnapshot?.status || 'active');

  const role: UserRole = isBootstrapOwner
    ? 'super_admin'
    : (adminEntry?.role || profile?.role || syncedAuthSnapshot?.role || 'student');

  const effectiveUserForRbac: UserProfile | null = firebaseUser
    ? {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName: profile?.displayName || firebaseUser.displayName || '',
        role,
        permissions:
          adminEntry?.permissions ||
          profile?.permissions ||
          syncedAuthSnapshot?.permissions,
        status: accountStatus,
      }
    : null;

  const permissions: PermissionKey[] = isBootstrapOwner
    ? [...ALL_PERMISSIONS]
    : resolveEffectivePermissions(effectiveUserForRbac);

  const isSuperAdmin = accountStatus === 'active' && role === 'super_admin';
  const isStaff = canAccessAdminDashboard(
    effectiveUserForRbac,
    Boolean(adminEntry && adminEntry.status === 'active') || isBootstrapOwner
  );

  const hasPerm = useCallback(
    (perm: PermissionKey): boolean => {
      if (isSuperAdmin) return true;
      return hasPermission(effectiveUserForRbac, perm);
    },
    [isSuperAdmin, effectiveUserForRbac]
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        adminEntry,
        role,
        permissions,
        accountStatus,
        isSuperAdmin,
        isStaff,
        isAdmin: isStaff,
        hasPerm,
        authReady,
        authLoading,
        authError,
        claimedInviteBanner,
        dismissClaimedBanner: () => setClaimedInviteBanner(null),
        loginModalOpen,
        openLoginModal: () => setLoginModalOpen(true),
        closeLoginModal: () => setLoginModalOpen(false),
        favoriteIds,
        readNotificationIds,
        signInWithGoogle,
        logout,
        toggleFavorite,
        markNotificationRead,
        updateAcademicPreference,
        updateProfileInfo,
        refreshAuthProfile,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
