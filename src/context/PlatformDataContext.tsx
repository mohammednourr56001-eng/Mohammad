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
  AdminEntry,
  AdminInvitation,
  Announcement,
  BackupSnapshot,
  DEFAULT_STORAGE_THRESHOLDS,
  LectureFile,
  NotificationItem,
  PermissionProfile,
  PlatformSettings,
  Semester,
  Specialization,
  StorageAlertThresholds,
  Subject,
  SUPPORTED_FILE_EXTENSIONS,
  UserProfile,
} from '../types/academic.ts';
import { StorageAlertLevel } from '../utils/academicLogic.ts';
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

export interface ServerStorageStats {
  lecturesBytes: number;
  backupsBytes: number;
  lecturesFileCount: number;
  quotaMB: number;
  quotaBytes: number;
  remainingBytes: number;
  usedPct: number;
  alertLevel: StorageAlertLevel;
  canUpload: boolean;
  maxFileSizeMB: number;
  allowZipUploads: boolean;
  allowedExtensions: string[];
  alertThresholds: StorageAlertThresholds;
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
  admins: AdminEntry[];
  adminInvitations: AdminInvitation[];
  permissionProfiles: PermissionProfile[];
  activityLogs: ActivityLog[];
  backups: BackupSnapshot[];
  storageStats: ServerStorageStats | null;
  settings: PlatformSettings;
  loading: boolean;
  error: string | null;
  refreshAdminCatalog: () => Promise<void>;
  refreshDirectory: () => Promise<void>;
  refreshAuditLogs: () => Promise<void>;
  refreshStorageStats: () => Promise<void>;
  refreshBackups: () => Promise<void>;
}

const DEFAULT_SETTINGS: PlatformSettings = {
  maxFileSizeMB: 25,
  allowZipUploads: true,
  platformTitle: 'منصة UST للمحاضرات',
  storageQuotaMB: 1024,
  allowedExtensions: [...SUPPORTED_FILE_EXTENSIONS],
  alertThresholds: DEFAULT_STORAGE_THRESHOLDS,
  backupRetentionDays: 30,
  autoBackupSchedule: 'weekly',
  updatedBy: 'system',
};

const PlatformDataContext = createContext<PlatformDataContextValue | null>(null);

export function PlatformDataProvider({ children }: { children: React.ReactNode }) {
  const { isStaff, isSuperAdmin, hasPerm, authReady, firebaseUser, adminEntry, getIdToken } =
    useAuth();

  const [seedCatalog, setSeedCatalog] = useState<SeedCatalogPayload | null>(null);
  const [fsSpecs, setFsSpecs] = useState<Specialization[]>([]);
  const [fsYears, setFsYears] = useState<AcademicYear[]>([]);
  const [fsSemesters, setFsSemesters] = useState<Semester[]>([]);
  const [fsSubjects, setFsSubjects] = useState<Subject[]>([]);
  const [fsFiles, setFsFiles] = useState<LectureFile[]>([]);
  const [ownDraftFiles, setOwnDraftFiles] = useState<LectureFile[]>([]);
  const [fsAnnouncements, setFsAnnouncements] = useState<Announcement[]>([]);
  const [fsNotifications, setFsNotifications] = useState<NotificationItem[]>([]);

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [adminInvitations, setAdminInvitations] = useState<AdminInvitation[]>([]);
  const [permissionProfiles, setPermissionProfiles] = useState<PermissionProfile[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [backups, setBackups] = useState<BackupSnapshot[]>([]);
  const [storageStats, setStorageStats] = useState<ServerStorageStats | null>(null);
  const [settings, setSettings] = useState<PlatformSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const seedingFirestoreRef = useRef(false);

  const isBootstrappedEmail =
    Boolean(firebaseUser?.emailVerified) &&
    firebaseUser?.email?.toLowerCase() === 'mohammednourr56000@gmail.com';

  // Fetch deterministic seed catalog
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

  // Auto-seed Firestore once on verified Super Admin session if empty
  const persistSeedToFirestoreIfEmpty = useCallback(
    async (catalog: SeedCatalogPayload) => {
      const canSeedAsOwner =
        Boolean(firebaseUser?.emailVerified) &&
        (isBootstrappedEmail ||
          (adminEntry?.role === 'super_admin' && adminEntry?.status === 'active'));
      if (!firebaseUser || !isSuperAdmin || !canSeedAsOwner || seedingFirestoreRef.current) {
        return;
      }
      seedingFirestoreRef.current = true;
      try {
        const specsQuery = isBootstrappedEmail
          ? collection(db, 'specializations')
          : query(collection(db, 'specializations'), where('status', '==', 'published'));
        const existingSpecs = await getDocs(specsQuery);
        if (!existingSpecs.empty) return;

        const now = serverTimestamp();

        // Stage 1: Platform settings & Specializations (root academic entities)
        const stage1 = writeBatch(db);
        stage1.set(doc(db, 'settings', 'platform'), {
          maxFileSizeMB: 25,
          allowZipUploads: true,
          platformTitle: 'منصة UST للمحاضرات',
          storageQuotaMB: 1024,
          allowedExtensions: [...SUPPORTED_FILE_EXTENSIONS],
          alertThresholds: DEFAULT_STORAGE_THRESHOLDS,
          backupRetentionDays: 30,
          autoBackupSchedule: 'weekly',
          updatedBy: firebaseUser.uid,
          updatedAt: now,
        });
        for (const s of catalog.specializations) {
          stage1.set(doc(db, 'specializations', s.id), {
            ...s,
            createdBy: firebaseUser.uid,
            createdAt: now,
            updatedAt: now,
          });
        }
        await stage1.commit();

        // Stage 2: Academic Years
        const stage2 = writeBatch(db);
        for (const y of catalog.academicYears) {
          stage2.set(doc(db, 'academicYears', y.id), {
            ...y,
            createdAt: now,
            updatedAt: now,
          });
        }
        await stage2.commit();

        // Stage 3: Semesters
        const stage3 = writeBatch(db);
        for (const sem of catalog.semesters) {
          stage3.set(doc(db, 'semesters', sem.id), {
            ...sem,
            createdAt: now,
            updatedAt: now,
          });
        }
        await stage3.commit();

        // Stage 4: Subjects
        const stage4 = writeBatch(db);
        for (const sub of catalog.subjects) {
          stage4.set(doc(db, 'subjects', sub.id), {
            ...sub,
            createdAt: now,
            updatedAt: now,
          });
        }
        await stage4.commit();

        // Stage 5: Lecture Files, Announcements & Notifications
        const stage5 = writeBatch(db);
        for (const lf of catalog.lectureFiles) {
          stage5.set(doc(db, 'lectureFiles', lf.id), {
            ...lf,
            uploadedBy: firebaseUser.uid,
            createdAt: now,
            updatedAt: now,
          });
        }
        for (const ann of catalog.announcements) {
          stage5.set(doc(db, 'announcements', ann.id), {
            ...ann,
            createdBy: firebaseUser.uid,
            createdAt: now,
            updatedAt: now,
          });
        }
        for (const n of catalog.notifications) {
          stage5.set(doc(db, 'notifications', n.id), {
            ...n,
            createdAt: now,
          });
        }
        await stage5.commit();
      } catch (err) {
        console.error('Auto-seed Firestore warning:', err);
      } finally {
        seedingFirestoreRef.current = false;
      }
    },
    [firebaseUser, isSuperAdmin, isBootstrappedEmail, adminEntry]
  );

  useEffect(() => {
    if (isSuperAdmin && firebaseUser && seedCatalog && fsSpecs.length === 0 && !loading) {
      persistSeedToFirestoreIfEmpty(seedCatalog);
    }
  }, [isSuperAdmin, firebaseUser, seedCatalog, fsSpecs.length, loading, persistSeedToFirestoreIfEmpty]);

  const refreshDirectory = useCallback(async () => {
    if (!isStaff || (!isSuperAdmin && !hasPerm('users.view') && !hasPerm('roles.assign'))) return;
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/directory', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.users)) setUsers(data.users);
      if (Array.isArray(data.admins)) setAdmins(data.admins);
      if (Array.isArray(data.invitations)) setAdminInvitations(data.invitations);
    } catch {
      // ignore directory errors
    }
  }, [isStaff, isSuperAdmin, hasPerm, getIdToken]);

  const refreshAuditLogs = useCallback(async () => {
    if (!isStaff || (!isSuperAdmin && !hasPerm('audit_logs.view'))) return;
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/audit-logs', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.logs)) {
        setActivityLogs(data.logs);
      }
    } catch {
      // ignore audit fetch errors
    }
  }, [isStaff, isSuperAdmin, hasPerm, getIdToken]);

  const refreshStorageStats = useCallback(async () => {
    if (!isStaff || (!isSuperAdmin && !hasPerm('storage.view') && !hasPerm('lectures.upload'))) return;
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/storage/stats', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as ServerStorageStats;
      setStorageStats(data);
    } catch {
      // ignore storage stats error
    }
  }, [isStaff, isSuperAdmin, hasPerm, getIdToken]);

  const refreshBackups = useCallback(async () => {
    if (!isStaff || (!isSuperAdmin && !hasPerm('settings.manage'))) return;
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/backups', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.backups)) {
        setBackups(data.backups);
      }
    } catch {
      // ignore backup list error
    }
  }, [isStaff, isSuperAdmin, hasPerm, getIdToken]);

  const refreshAdminCatalog = useCallback(async () => {
    if (!isStaff) return;
    try {
      const usePublishedOnly = !isBootstrappedEmail;
      const makeGetQuery = (colName: string) =>
        usePublishedOnly
          ? query(collection(db, colName), where('status', '==', 'published'))
          : collection(db, colName);

      const [specsSnap, yrsSnap, semsSnap, subsSnap, filesSnap, annSnap, notifSnap] =
        await Promise.all([
          getDocs(makeGetQuery('specializations')),
          getDocs(makeGetQuery('academicYears')),
          getDocs(makeGetQuery('semesters')),
          getDocs(makeGetQuery('subjects')),
          getDocs(makeGetQuery('lectureFiles')),
          getDocs(makeGetQuery('announcements')),
          getDocs(makeGetQuery('notifications')),
        ]);
      setFsSpecs(specsSnap.docs.map((d) => d.data() as Specialization));
      setFsYears(yrsSnap.docs.map((d) => d.data() as AcademicYear));
      setFsSemesters(semsSnap.docs.map((d) => d.data() as Semester));
      setFsSubjects(subsSnap.docs.map((d) => d.data() as Subject));
      setFsFiles(filesSnap.docs.map((d) => d.data() as LectureFile));
      setFsAnnouncements(annSnap.docs.map((d) => d.data() as Announcement));
      setFsNotifications(notifSnap.docs.map((d) => d.data() as NotificationItem));

      await Promise.all([
        refreshStorageStats(),
        refreshDirectory(),
        refreshAuditLogs(),
        refreshBackups(),
      ]);
    } catch (err) {
      console.error('Admin catalog refresh warning:', err);
    }
  }, [
    isStaff,
    isBootstrappedEmail,
    refreshStorageStats,
    refreshDirectory,
    refreshAuditLogs,
    refreshBackups,
  ]);

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

    if (usePublishedFilter && isStaff && firebaseUser) {
      unsubscribers.push(
        onSnapshot(
          query(collection(db, 'lectureFiles'), where('uploadedBy', '==', firebaseUser.uid)),
          (snap) => {
            setOwnDraftFiles(snap.docs.map((d) => d.data() as LectureFile));
          },
          () => {}
        )
      );
    } else {
      setOwnDraftFiles([]);
    }

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
            setSettings({ ...DEFAULT_SETTINGS, ...(snap.data() as PlatformSettings) });
          }
        },
        () => {}
      )
    );

    if (isBootstrappedEmail) {
      unsubscribers.push(
        onSnapshot(
          collection(db, 'users'),
          (snap) => setUsers(snap.docs.map((d) => d.data() as UserProfile)),
          () => {}
        )
      );
      unsubscribers.push(
        onSnapshot(
          collection(db, 'admins'),
          (snap) => setAdmins(snap.docs.map((d) => d.data() as AdminEntry)),
          () => {}
        )
      );
      unsubscribers.push(
        onSnapshot(
          collection(db, 'adminInvitations'),
          (snap) => setAdminInvitations(snap.docs.map((d) => d.data() as AdminInvitation)),
          () => {}
        )
      );
      unsubscribers.push(
        onSnapshot(
          collection(db, 'permissionProfiles'),
          (snap) => setPermissionProfiles(snap.docs.map((d) => d.data() as PermissionProfile)),
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
            setActivityLogs(logs.slice(0, 100));
          },
          () => {}
        )
      );
    }

    return () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  }, [authReady, isStaff, isBootstrappedEmail, firebaseUser]);

  // Trigger server-indexed directory/audit/storage/backup refresh whenever staff permissions resolve
  useEffect(() => {
    if (!authReady || !isStaff) {
      if (!isStaff) {
        setUsers([]);
        setAdmins([]);
        setAdminInvitations([]);
        setPermissionProfiles([]);
        setActivityLogs([]);
        setBackups([]);
        setStorageStats(null);
      }
      return;
    }
    refreshStorageStats();
    refreshDirectory();
    refreshAuditLogs();
    refreshBackups();
  }, [authReady, isStaff, refreshStorageStats, refreshDirectory, refreshAuditLogs, refreshBackups]);

  // Merge fsFiles and ownDraftFiles cleanly by ID
  const mergedFsFiles = React.useMemo(() => {
    if (ownDraftFiles.length === 0) return fsFiles;
    const map = new Map(fsFiles.map((f) => [f.id, f]));
    for (const df of ownDraftFiles) {
      map.set(df.id, df);
    }
    return Array.from(map.values());
  }, [fsFiles, ownDraftFiles]);

  const useSeedFallback = fsSpecs.length === 0 && seedCatalog !== null;

  return (
    <PlatformDataContext.Provider
      value={{
        specializations: useSeedFallback ? seedCatalog.specializations : fsSpecs,
        academicYears: useSeedFallback ? seedCatalog.academicYears : fsYears,
        semesters: useSeedFallback ? seedCatalog.semesters : fsSemesters,
        subjects: useSeedFallback ? seedCatalog.subjects : fsSubjects,
        lectureFiles: useSeedFallback ? seedCatalog.lectureFiles : mergedFsFiles,
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
        admins,
        adminInvitations,
        permissionProfiles,
        activityLogs,
        backups,
        storageStats,
        settings,
        loading: loading && !seedCatalog,
        error,
        refreshAdminCatalog,
        refreshDirectory,
        refreshAuditLogs,
        refreshStorageStats,
        refreshBackups,
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
