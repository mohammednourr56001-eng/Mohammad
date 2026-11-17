import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase.ts';
import {
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from '../lib/firestoreErrors.ts';
import {
  AcademicYear,
  ActivityLog,
  Announcement,
  LectureFile,
  NotificationItem,
  PlatformSettings,
  Semester,
  Specialization,
  Subject,
  UserProfile,
} from '../types/academic.ts';
import { useAuth } from './AuthContext.tsx';

interface SeedCatalogPayload {
  specializations: Specialization[];
  academicYears: AcademicYear[];
  semesters: Semester[];
  subjects: Subject[];
  lectureFiles: LectureFile[];
  announcements: Announcement[];
  notifications: NotificationItem[];
}

interface PlatformDataContextValue {
  specializations: Specialization[];
  academicYears: AcademicYear[];
  semesters: Semester[];
  subjects: Subject[];
  lectureFiles: LectureFile[];
  announcements: Announcement[];
  notifications: NotificationItem[];
  users: UserProfile[];
  activityLogs: ActivityLog[];
  settings: PlatformSettings;
  loading: boolean;
  error: string | null;
  refreshAdminCatalog: () => Promise<void>;
}

const DEFAULT_SETTINGS: PlatformSettings = {
  maxFileSizeMB: 25,
  allowZipUploads: true,
  platformTitle: 'منصة UST للمحاضرات',
  updatedBy: 'system',
};

const PlatformDataContext = createContext<PlatformDataContextValue | null>(null);

export function PlatformDataProvider({ children }: { children: React.ReactNode }) {
  const { isAdmin, authReady, firebaseUser } = useAuth();

  const [seedCatalog, setSeedCatalog] = useState<SeedCatalogPayload | null>(null);
  const [fsSpecs, setFsSpecs] = useState<Specialization[]>([]);
  const [fsYears, setFsYears] = useState<AcademicYear[]>([]);
  const [fsSemesters, setFsSemesters] = useState<Semester[]>([]);
  const [fsSubjects, setFsSubjects] = useState<Subject[]>([]);
  const [fsFiles, setFsFiles] = useState<LectureFile[]>([]);
  const [fsAnnouncements, setFsAnnouncements] = useState<Announcement[]>([]);
  const [fsNotifications, setFsNotifications] = useState<NotificationItem[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [settings, setSettings] = useState<PlatformSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const seedingFirestoreRef = useRef(false);

  const isBootstrappedEmail =
    Boolean(firebaseUser?.emailVerified) &&
    firebaseUser?.email === 'mohammednourr56000@gmail.com';

  // Fetch initial deterministic catalog from server
  useEffect(() => {
    let active = true;
    fetch('/api/catalog/seed')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) {
          setSeedCatalog(data as SeedCatalogPayload);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Persist initial seed into Firestore automatically on first Admin session if Firestore is empty
  const persistSeedToFirestoreIfEmpty = useCallback(
    async (catalog: SeedCatalogPayload) => {
      if (!firebaseUser || !isAdmin || seedingFirestoreRef.current) return;
      seedingFirestoreRef.current = true;
      try {
        const existingSpecs = await getDocs(collection(db, 'specializations'));
        if (!existingSpecs.empty) return;

        const batch = writeBatch(db);
        const now = serverTimestamp();

        batch.set(doc(db, 'settings', 'platform'), {
          maxFileSizeMB: 25,
          allowZipUploads: true,
          platformTitle: 'منصة UST للمحاضرات',
          updatedBy: firebaseUser.uid,
          updatedAt: now,
        });

        for (const s of catalog.specializations) {
          batch.set(doc(db, 'specializations', s.id), {
            ...s,
            createdBy: firebaseUser.uid,
            createdAt: now,
            updatedAt: now,
          });
        }
        for (const y of catalog.academicYears) {
          batch.set(doc(db, 'academicYears', y.id), {
            ...y,
            createdAt: now,
            updatedAt: now,
          });
        }
        for (const sem of catalog.semesters) {
          batch.set(doc(db, 'semesters', sem.id), {
            ...sem,
            createdAt: now,
            updatedAt: now,
          });
        }
        for (const sub of catalog.subjects) {
          batch.set(doc(db, 'subjects', sub.id), {
            ...sub,
            createdAt: now,
            updatedAt: now,
          });
        }
        for (const lf of catalog.lectureFiles) {
          batch.set(doc(db, 'lectureFiles', lf.id), {
            ...lf,
            uploadedBy: firebaseUser.uid,
            createdAt: now,
            updatedAt: now,
          });
        }
        for (const ann of catalog.announcements) {
          batch.set(doc(db, 'announcements', ann.id), {
            ...ann,
            createdBy: firebaseUser.uid,
            createdAt: now,
            updatedAt: now,
          });
        }
        for (const n of catalog.notifications) {
          batch.set(doc(db, 'notifications', n.id), {
            ...n,
            createdAt: now,
          });
        }

        await batch.commit();
      } catch (err) {
        console.error('Auto-seed Firestore warning:', err);
      } finally {
        seedingFirestoreRef.current = false;
      }
    },
    [firebaseUser, isAdmin]
  );

  useEffect(() => {
    if (isAdmin && firebaseUser && seedCatalog && fsSpecs.length === 0 && !loading) {
      persistSeedToFirestoreIfEmpty(seedCatalog);
    }
  }, [isAdmin, firebaseUser, seedCatalog, fsSpecs.length, loading, persistSeedToFirestoreIfEmpty]);

  const refreshAdminCatalog = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [specsSnap, yrsSnap, semsSnap, subsSnap, filesSnap, annSnap, notifSnap] =
        await Promise.all([
          getDocs(collection(db, 'specializations')),
          getDocs(collection(db, 'academicYears')),
          getDocs(collection(db, 'semesters')),
          getDocs(collection(db, 'subjects')),
          getDocs(collection(db, 'lectureFiles')),
          getDocs(collection(db, 'announcements')),
          getDocs(collection(db, 'notifications')),
        ]);
      setFsSpecs(specsSnap.docs.map((d) => d.data() as Specialization));
      setFsYears(yrsSnap.docs.map((d) => d.data() as AcademicYear));
      setFsSemesters(semsSnap.docs.map((d) => d.data() as Semester));
      setFsSubjects(subsSnap.docs.map((d) => d.data() as Subject));
      setFsFiles(filesSnap.docs.map((d) => d.data() as LectureFile));
      setFsAnnouncements(annSnap.docs.map((d) => d.data() as Announcement));
      setFsNotifications(notifSnap.docs.map((d) => d.data() as NotificationItem));
    } catch (err) {
      console.error('Admin catalog refresh warning:', err);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!authReady) return;
    setLoading(true);
    setError(null);

    testFirestoreConnection().catch(() => {});

    const unsubscribers: Array<() => void> = [];
    const usePublishedFilter = !isBootstrappedEmail;

    const makeQuery = (colName: string) =>
      usePublishedFilter
        ? query(collection(db, colName), where('status', '==', 'published'))
        : collection(db, colName);

    let settledCount = 0;
    const markSettled = () => {
      settledCount += 1;
      if (settledCount >= 5) {
        setLoading(false);
      }
    };

    unsubscribers.push(
      onSnapshot(
        makeQuery('specializations'),
        (snap) => {
          setFsSpecs(snap.docs.map((d) => d.data() as Specialization));
          markSettled();
        },
        (err) => {
          setLoading(false);
          setError('تعذر تحميل التخصصات من قاعدة البيانات.');
          handleFirestoreError(err, OperationType.LIST, 'specializations');
        }
      )
    );

    unsubscribers.push(
      onSnapshot(
        makeQuery('academicYears'),
        (snap) => {
          setFsYears(snap.docs.map((d) => d.data() as AcademicYear));
          markSettled();
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'academicYears')
      )
    );

    unsubscribers.push(
      onSnapshot(
        makeQuery('semesters'),
        (snap) => {
          setFsSemesters(snap.docs.map((d) => d.data() as Semester));
          markSettled();
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'semesters')
      )
    );

    unsubscribers.push(
      onSnapshot(
        makeQuery('subjects'),
        (snap) => {
          setFsSubjects(snap.docs.map((d) => d.data() as Subject));
          markSettled();
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'subjects')
      )
    );

    unsubscribers.push(
      onSnapshot(
        makeQuery('lectureFiles'),
        (snap) => {
          setFsFiles(snap.docs.map((d) => d.data() as LectureFile));
          markSettled();
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'lectureFiles')
      )
    );

    unsubscribers.push(
      onSnapshot(
        makeQuery('announcements'),
        (snap) => {
          setFsAnnouncements(snap.docs.map((d) => d.data() as Announcement));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'announcements')
      )
    );

    unsubscribers.push(
      onSnapshot(
        makeQuery('notifications'),
        (snap) => {
          setFsNotifications(snap.docs.map((d) => d.data() as NotificationItem));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
      )
    );

    unsubscribers.push(
      onSnapshot(
        doc(db, 'settings', 'platform'),
        (snap) => {
          if (snap.exists()) {
            setSettings(snap.data() as PlatformSettings);
          }
        },
        () => {}
      )
    );

    if (isAdmin) {
      unsubscribers.push(
        onSnapshot(
          collection(db, 'users'),
          (snap) => {
            setUsers(snap.docs.map((d) => d.data() as UserProfile));
          },
          () => {}
        )
      );
      unsubscribers.push(
        onSnapshot(
          collection(db, 'activityLogs'),
          (snap) => {
            const logs = snap.docs.map((d) => d.data() as ActivityLog);
            logs.sort((a, b) => {
              const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
              const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
              return tb - ta;
            });
            setActivityLogs(logs.slice(0, 30));
          },
          () => {}
        )
      );
    } else {
      setUsers([]);
      setActivityLogs([]);
    }

    return () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  }, [authReady, isAdmin, isBootstrappedEmail]);

  const useSeedFallback = fsSpecs.length === 0 && seedCatalog !== null;

  return (
    <PlatformDataContext.Provider
      value={{
        specializations: useSeedFallback ? seedCatalog.specializations : fsSpecs,
        academicYears: useSeedFallback ? seedCatalog.academicYears : fsYears,
        semesters: useSeedFallback ? seedCatalog.semesters : fsSemesters,
        subjects: useSeedFallback ? seedCatalog.subjects : fsSubjects,
        lectureFiles: useSeedFallback ? seedCatalog.lectureFiles : fsFiles,
        announcements:
          fsAnnouncements.length > 0
            ? fsAnnouncements
            : useSeedFallback
              ? seedCatalog.announcements
              : [],
        notifications:
          fsNotifications.length > 0
            ? fsNotifications
            : useSeedFallback
              ? seedCatalog.notifications
              : [],
        users,
        activityLogs,
        settings,
        loading: loading && !seedCatalog,
        error,
        refreshAdminCatalog,
      }}
    >
      {children}
    </PlatformDataContext.Provider>
  );
}

export function usePlatformData(): PlatformDataContextValue {
  const ctx = useContext(PlatformDataContext);
  if (!ctx) {
    throw new Error('usePlatformData must be used inside PlatformDataProvider');
  }
  return ctx;
}
