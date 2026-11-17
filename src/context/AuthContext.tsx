import React, { createContext, useContext, useEffect, useState } from 'react';
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
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase.ts';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors.ts';
import { UserProfile } from '../types/academic.ts';

const BOOTSTRAPPED_ADMIN_EMAIL = 'mohammednourr56000@gmail.com';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  authReady: boolean;
  authLoading: boolean;
  authError: string | null;
  favoriteIds: Set<string>;
  readNotificationIds: Set<string>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  toggleFavorite: (fileId: string, subjectId: string) => Promise<void>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  updateAcademicPreference: (specializationId: string, academicYearId: string) => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAdminEntry, setIsAdminEntry] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let unsubFavs: (() => void) | null = null;
    let unsubReads: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubProfile) unsubProfile();
      if (unsubFavs) unsubFavs();
      if (unsubReads) unsubReads();

      setFirebaseUser(user);
      setAuthError(null);

      if (!user) {
        setProfile(null);
        setIsAdminEntry(false);
        setFavoriteIds(new Set());
        setReadNotificationIds(new Set());
        setAuthReady(true);
        return;
      }

      const isBootstrapAdmin =
        user.emailVerified && user.email === BOOTSTRAPPED_ADMIN_EMAIL;

      try {
        const userRef = doc(db, 'users', user.uid);
        const existingSnap = await getDoc(userRef);
        const adminSnap = await getDoc(doc(db, 'admins', user.uid));
        const hasAdminRecord = adminSnap.exists() || isBootstrapAdmin;
        setIsAdminEntry(hasAdminRecord);

        if (!existingSnap.exists()) {
          const initialRole = isBootstrapAdmin ? 'admin' : 'student';
          await setDoc(userRef, {
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || 'طالب جامعة UST',
            photoURL: user.photoURL || '',
            role: initialRole,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        unsubProfile = onSnapshot(
          userRef,
          (snap) => {
            if (snap.exists()) {
              setProfile(snap.data() as UserProfile);
            }
          },
          (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}`)
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
      if (unsubFavs) unsubFavs();
      if (unsubReads) unsubReads();
    };
  }, []);

  const signInWithGoogle = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
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

  const getIdToken = async (): Promise<string | null> => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken();
  };

  const isAdmin =
    Boolean(isAdminEntry) ||
    profile?.role === 'admin' ||
    Boolean(
      firebaseUser?.emailVerified &&
        firebaseUser?.email === BOOTSTRAPPED_ADMIN_EMAIL
    );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        isAdmin,
        authReady,
        authLoading,
        authError,
        favoriteIds,
        readNotificationIds,
        signInWithGoogle,
        logout,
        toggleFavorite,
        markNotificationRead,
        updateAcademicPreference,
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
