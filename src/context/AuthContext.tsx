import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, googleProvider, workspaceGoogleProvider } from '../lib/firebase.ts';
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
import {
  clearOfflineUserSettings,
  readOfflineUserSettings,
  writeOfflineUserSettings,
} from '../utils/offlineCache.ts';

const BOOTSTRAPPED_ADMIN_EMAIL = 'mohammednourr56000@gmail.com';

// Strict in-memory cache for Google Workspace OAuth access token (never localStorage/sessionStorage)
let cachedWorkspaceAccessToken: string | null = null;

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  adminEntry: AdminEntry | null;
  role: UserRole;
  permissions: PermissionKey[];
  accountStatus: AccountStatus;
  assignedSpecializationId: string | null;
  assignmentId: string | null;
  scopeVersion: number;
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
  workspaceAccessToken: string | null;
  workspaceGrantedScopes: string[];
  connectGoogleWorkspace: () => Promise<string | null>;
  disconnectGoogleWorkspace: () => Promise<void>;
  clearWorkspaceToken: () => void;
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
    assignedSpecializationId?: string;
    assignmentId?: string;
    scopeVersion?: number;
  } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [claimedInviteBanner, setClaimedInviteBanner] = useState<string | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(new Set());
  const [workspaceAccessToken, setWorkspaceAccessToken] = useState<string | null>(
    cachedWorkspaceAccessToken
  );
  const [workspaceGrantedScopes, setWorkspaceGrantedScopes] = useState<string[]>([]);

  const ensureFirestoreUserDocs = useCallback(async (user: User) => {
    if (!user.emailVerified || !user.email) return;
    const isOwnerEmail = user.email.trim().toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);

    const googleSub =
      user.providerData.find((p) => p.providerId === 'google.com')?.uid || user.uid;

    if (!snap.exists()) {
      const targetRole: UserRole = isOwnerEmail ? 'super_admin' : 'student';
      const targetPerms: PermissionKey[] = isOwnerEmail ? [...ALL_PERMISSIONS] : [];
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email.toLowerCase(),
        displayName: user.displayName || user.email.split('@')[0] || 'طالب UST',
        photoURL: user.photoURL || '',
        googleSub,
        role: targetRole,
        permissions: targetPerms,
        status: 'active',
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existing = snap.data() as Partial<UserProfile>;
      const patch: Record<string, unknown> = {
        lastLoginAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (!existing.status) patch.status = 'active';
      if (isOwnerEmail && existing.role !== 'super_admin') {
        patch.role = 'super_admin';
        patch.permissions = [...ALL_PERMISSIONS];
        patch.status = 'active';
      }
      await updateDoc(userRef, patch).catch(() => {});
    }

    if (isOwnerEmail) {
      const adminRef = doc(db, 'admins', user.uid);
      const adminSnap = await getDoc(adminRef);
      if (!adminSnap.exists()) {
        await setDoc(adminRef, {
          uid: user.uid,
          email: user.email.toLowerCase(),
          displayName: user.displayName || 'المالك الرئيسي',
          role: 'super_admin',
          permissions: [...ALL_PERMISSIONS],
          status: 'active',
          addedAt: serverTimestamp(),
          addedBy: user.uid,
        }).catch(() => {});
      }
    }
  }, []);

  const syncWithServer = useCallback(
    async (user: User) => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/auth/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });

        if (res.ok) {
          const data = (await res.json()) as UserProfile & {
            isSuperAdmin?: boolean;
            isStaff?: boolean;
            claimedInviteId?: string;
          };
          setSyncedAuthSnapshot({
            role: (data?.role || 'student') as UserRole,
            permissions: Array.isArray(data?.permissions) ? data.permissions : [],
            status: (data?.status === 'suspended' ? 'suspended' : 'active') as AccountStatus,
            assignedSpecializationId: data?.assignedSpecializationId || undefined,
            assignmentId: data?.assignmentId || undefined,
            scopeVersion: typeof data?.scopeVersion === 'number' ? data.scopeVersion : 1,
          });
          setProfile((prev) => ({
            ...prev,
            ...data,
          }));
          if (data?.claimedInviteId) {
            setClaimedInviteBanner('تم تفعيل صلاحياتك الإدارية الجديدة بنجاح.');
          }
          return data;
        }

        // Only fall back to client Firestore doc sync when /api/auth/sync didn't complete
        await ensureFirestoreUserDocs(user).catch(() => {});
        return null;
      } catch {
        await ensureFirestoreUserDocs(user).catch(() => {});
        return null;
      }
    },
    [ensureFirestoreUserDocs]
  );

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let unsubAdmin: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubProfile) unsubProfile();
      if (unsubAdmin) unsubAdmin();

      setFirebaseUser(user);
      setAuthError(null);

      if (!user) {
        cachedWorkspaceAccessToken = null;
        setWorkspaceAccessToken(null);
        setWorkspaceGrantedScopes([]);
        setProfile(null);
        setAdminEntry(null);
        setSyncedAuthSnapshot(null);
        setFavoriteIds(new Set());
        setReadNotificationIds(new Set());
        setAuthReady(true);
        return;
      }

      // Hydrate offline user preferences & favorites immediately
      const cachedUser = readOfflineUserSettings(user.uid);
      if (cachedUser) {
        setFavoriteIds(new Set(cachedUser.favoriteIds));
        setReadNotificationIds(new Set(cachedUser.readNotificationIds));
        setProfile((prev) =>
          prev || {
            uid: user.uid,
            email: user.email || '',
            displayName: cachedUser.displayName || user.displayName || 'طالب UST',
            role: 'student',
            status: 'active',
            specializationId: cachedUser.specializationId,
            academicYearId: cachedUser.academicYearId,
          }
        );
      }

      try {
        const synced = await syncWithServer(user);
        const isOwnerEmail =
          Boolean(user.emailVerified) &&
          user.email?.trim().toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;
        const mightBeStaff =
          isOwnerEmail || Boolean(synced?.role && synced.role !== 'student');

        if (mightBeStaff) {
          // Staff accounts keep live listeners on profile & admin role doc for instant privilege updates
          unsubProfile = onSnapshot(
            doc(db, 'users', user.uid),
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
        } else if (!synced) {
          // One-shot profile fetch only if /api/auth/sync did not already return it
          getDoc(doc(db, 'users', user.uid))
            .then((snap) => {
              if (snap.exists()) {
                setProfile(snap.data() as UserProfile);
              }
            })
            .catch(() => {});
        }

        // One-shot reads for favorites & readNotifications (avoids 1,000+ idle onSnapshot streams!)
        const [favSnap, readsSnap] = await Promise.all([
          getDocs(collection(db, 'users', user.uid, 'favorites')).catch(() => null),
          getDocs(collection(db, 'users', user.uid, 'readNotifications')).catch(() => null),
        ]);

        const nextFavs = favSnap
          ? favSnap.docs.map((d) => d.id)
          : cachedUser?.favoriteIds || [];
        const nextReads = readsSnap
          ? readsSnap.docs.map((d) => d.id)
          : cachedUser?.readNotificationIds || [];

        setFavoriteIds(new Set(nextFavs));
        setReadNotificationIds(new Set(nextReads));

        writeOfflineUserSettings({
          uid: user.uid,
          displayName: synced?.displayName || cachedUser?.displayName || user.displayName || undefined,
          specializationId: synced?.specializationId || cachedUser?.specializationId,
          academicYearId: synced?.academicYearId || cachedUser?.academicYearId,
          favoriteIds: nextFavs,
          readNotificationIds: nextReads,
          pendingProfileSync: cachedUser?.pendingProfileSync,
        });
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
    };
  }, [syncWithServer]);

  const signInWithGoogle = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const oauthCred = GoogleAuthProvider.credentialFromResult(cred);
      if (oauthCred?.accessToken) {
        cachedWorkspaceAccessToken = oauthCred.accessToken;
        setWorkspaceAccessToken(oauthCred.accessToken);
      }
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

  const connectGoogleWorkspace = async (): Promise<string | null> => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, workspaceGoogleProvider);
      const oauthCred = GoogleAuthProvider.credentialFromResult(cred);
      if (!oauthCred?.accessToken) {
        throw new Error('تعذر الحصول على رمز الوصول لخدمات Google Workspace.');
      }
      cachedWorkspaceAccessToken = oauthCred.accessToken;
      setWorkspaceAccessToken(oauthCred.accessToken);
      // Verify granted scopes cleanly via Google tokeninfo (in-memory only)
      fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(
          oauthCred.accessToken
        )}`
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((info: { scope?: string } | null) => {
          if (info?.scope) {
            setWorkspaceGrantedScopes(info.scope.split(/\s+/).filter(Boolean));
          }
        })
        .catch(() => {});

      if (cred.user) {
        await syncWithServer(cred.user);
      }
      return oauthCred.accessToken;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'تعذر ربط خدمات Google.';
      if (msg.includes('popup-closed-by-user')) {
        setAuthError('تم إغلاق نافذة الموافقة قبل إتمام ربط خدمات Google.');
      } else {
        setAuthError('تعذر ربط حساب Google Workspace. يرجى المحاولة مجدداً.');
      }
      return null;
    } finally {
      setAuthLoading(false);
    }
  };

  const clearWorkspaceToken = () => {
    cachedWorkspaceAccessToken = null;
    setWorkspaceAccessToken(null);
    setWorkspaceGrantedScopes([]);
  };

  const disconnectGoogleWorkspace = async () => {
    const tokenToRevoke = cachedWorkspaceAccessToken;
    clearWorkspaceToken();
    if (tokenToRevoke) {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenToRevoke)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      ).catch(() => {});
    }
  };

  const logout = async () => {
    setAuthLoading(true);
    try {
      cachedWorkspaceAccessToken = null;
      setWorkspaceAccessToken(null);
      setWorkspaceGrantedScopes([]);
      clearOfflineUserSettings();
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
    const wasFavorite = favoriteIds.has(fileId);
    const nextSet = new Set(favoriteIds);
    if (wasFavorite) nextSet.delete(fileId);
    else nextSet.add(fileId);
    setFavoriteIds(nextSet);

    const existingOffline = readOfflineUserSettings(firebaseUser.uid);
    writeOfflineUserSettings({
      uid: firebaseUser.uid,
      displayName: profile?.displayName || existingOffline?.displayName,
      specializationId: profile?.specializationId || existingOffline?.specializationId,
      academicYearId: profile?.academicYearId || existingOffline?.academicYearId,
      favoriteIds: Array.from(nextSet),
      readNotificationIds: Array.from(readNotificationIds),
    });

    const favRef = doc(db, 'users', firebaseUser.uid, 'favorites', fileId);
    try {
      if (wasFavorite) {
        await deleteDoc(favRef);
      } else {
        await setDoc(favRef, {
          fileId,
          subjectId,
          createdAt: serverTimestamp(),
        });
      }
    } catch (error) {
      // Revert optimistic update on real Firestore failure
      setFavoriteIds(favoriteIds);
      handleFirestoreError(error, OperationType.WRITE, `users/${firebaseUser.uid}/favorites/${fileId}`);
    }
  };

  const markNotificationRead = async (notificationId: string) => {
    if (!firebaseUser || readNotificationIds.has(notificationId)) return;
    const nextSet = new Set(readNotificationIds);
    nextSet.add(notificationId);
    setReadNotificationIds(nextSet);

    const existingOffline = readOfflineUserSettings(firebaseUser.uid);
    writeOfflineUserSettings({
      uid: firebaseUser.uid,
      displayName: profile?.displayName || existingOffline?.displayName,
      specializationId: profile?.specializationId || existingOffline?.specializationId,
      academicYearId: profile?.academicYearId || existingOffline?.academicYearId,
      favoriteIds: Array.from(favoriteIds),
      readNotificationIds: Array.from(nextSet),
    });

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

  const updateProfileInfo = useCallback(
    async (params: {
      displayName: string;
      specializationId?: string;
      academicYearId?: string;
    }) => {
      if (!firebaseUser) return;
      const cleanName = params.displayName.trim();
      if (cleanName.length < 2) return;

      // Optimistically update local profile + offline user settings cache
      setProfile((prev) => ({
        uid: firebaseUser.uid,
        email: prev?.email || firebaseUser.email || '',
        role: prev?.role || 'student',
        status: prev?.status || 'active',
        ...prev,
        displayName: cleanName,
        ...(params.specializationId !== undefined ? { specializationId: params.specializationId } : {}),
        ...(params.academicYearId !== undefined ? { academicYearId: params.academicYearId } : {}),
      }));

      const isOfflineNow = typeof navigator !== 'undefined' && !navigator.onLine;
      writeOfflineUserSettings({
        uid: firebaseUser.uid,
        displayName: cleanName,
        specializationId: params.specializationId ?? profile?.specializationId,
        academicYearId: params.academicYearId ?? profile?.academicYearId,
        favoriteIds: Array.from(favoriteIds),
        readNotificationIds: Array.from(readNotificationIds),
        pendingProfileSync: isOfflineNow,
      });

      if (isOfflineNow) {
        return;
      }

      const userRef = doc(db, 'users', firebaseUser.uid);
      const isOwnerEmail =
        Boolean(firebaseUser.emailVerified) &&
        firebaseUser.email?.trim().toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;
      const googleSub =
        firebaseUser.providerData.find((p) => p.providerId === 'google.com')?.uid || firebaseUser.uid;

      try {
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          const createPayload: Record<string, unknown> = {
            uid: firebaseUser.uid,
            email: (firebaseUser.email || '').toLowerCase(),
            displayName: cleanName,
            photoURL: firebaseUser.photoURL || '',
            googleSub,
            role: isOwnerEmail ? 'super_admin' : 'student',
            permissions: isOwnerEmail ? [...ALL_PERMISSIONS] : [],
            status: 'active',
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (params.specializationId) createPayload.specializationId = params.specializationId;
          if (params.academicYearId) createPayload.academicYearId = params.academicYearId;
          await setDoc(userRef, createPayload);
          return;
        }

        const existing = snap.data() as Partial<UserProfile>;
        const payload: Record<string, unknown> = {
          displayName: cleanName,
          updatedAt: serverTimestamp(),
        };
        if (!existing.status) {
          payload.status = 'active';
        }
        if (isOwnerEmail && existing.role !== 'super_admin') {
          payload.role = 'super_admin';
          payload.permissions = [...ALL_PERMISSIONS];
          payload.status = 'active';
        }
        if (params.specializationId !== undefined) payload.specializationId = params.specializationId;
        if (params.academicYearId !== undefined) payload.academicYearId = params.academicYearId;

        await updateDoc(userRef, payload);
        writeOfflineUserSettings({
          uid: firebaseUser.uid,
          displayName: cleanName,
          specializationId: params.specializationId ?? profile?.specializationId,
          academicYearId: params.academicYearId ?? profile?.academicYearId,
          favoriteIds: Array.from(favoriteIds),
          readNotificationIds: Array.from(readNotificationIds),
          pendingProfileSync: false,
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${firebaseUser.uid}`);
      }
    },
    [firebaseUser, profile?.specializationId, profile?.academicYearId, favoriteIds, readNotificationIds]
  );

  // Flush any offline-queued academic preference updates when connectivity returns
  useEffect(() => {
    if (!firebaseUser) return;
    const handleOnline = () => {
      const cached = readOfflineUserSettings(firebaseUser.uid);
      if (cached?.pendingProfileSync && cached.displayName) {
        void updateProfileInfo({
          displayName: cached.displayName,
          specializationId: cached.specializationId,
          academicYearId: cached.academicYearId,
        });
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [firebaseUser, updateProfileInfo]);

  const updateAcademicPreference = async (specializationId: string, academicYearId: string) => {
    if (!firebaseUser) return;
    await updateProfileInfo({
      displayName: profile?.displayName || firebaseUser.displayName || 'طالب UST',
      specializationId,
      academicYearId,
    });
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

  const assignedSpecializationId: string | null = isBootstrapOwner
    ? null
    : (adminEntry?.assignedSpecializationId ||
      profile?.assignedSpecializationId ||
      syncedAuthSnapshot?.assignedSpecializationId ||
      null);

  const assignmentId: string | null =
    adminEntry?.assignmentId ||
    profile?.assignmentId ||
    syncedAuthSnapshot?.assignmentId ||
    null;

  const scopeVersion: number =
    adminEntry?.scopeVersion ||
    profile?.scopeVersion ||
    syncedAuthSnapshot?.scopeVersion ||
    1;

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
        ...(assignedSpecializationId ? { assignedSpecializationId } : {}),
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
        assignedSpecializationId,
        assignmentId,
        scopeVersion,
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
        workspaceAccessToken,
        workspaceGrantedScopes,
        connectGoogleWorkspace,
        disconnectGoogleWorkspace,
        clearWorkspaceToken,
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
