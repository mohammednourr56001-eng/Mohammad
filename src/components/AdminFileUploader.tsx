import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CopyCheck,
  ExternalLink,
  Eye,
  FileUp,
  Link2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase.ts';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import {
  DEFAULT_STORAGE_THRESHOLDS,
  DuplicateMatchInfo,
  LectureCategory,
  LectureFile,
  LectureSourceType,
  LECTURE_CATEGORY_LABELS,
  PublishStatus,
} from '../types/academic.ts';
import {
  computeNextSortOrder,
  evaluateStorageQuota,
  formatFileSizeArabic,
  generateSafeId,
  isGoogleDriveFile,
  validateAndParseGoogleDriveUrl,
  validateUploadFile,
} from '../utils/academicLogic.ts';
import {
  buildDistributionLinkPlan,
  CENTRAL_UNLINKED_MARKER,
  computeBrowserFileSha256,
  findDuplicateMatchForFile,
  getFileDestinations,
} from '../utils/centralLibraryLogic.ts';
import {
  GoogleDriveFileItem,
  listGoogleDriveFiles,
  mapDriveMimeToMeta,
} from '../utils/googleDocsApi.ts';
import {
  DestinationRowState,
  isDestinationComplete,
  MultiDestinationPicker,
  rowsToDestinationInputs,
} from './MultiDestinationPicker.tsx';

interface QueuedFileItem {
  localId: string;
  file: File;
  title: string;
  selected: boolean;
  sha256?: string;
  hashing?: boolean;
  duplicateMatch?: DuplicateMatchInfo | null;
  forceUploadAnyway?: boolean;
  previewObjectUrl?: string;
  status: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';
  progress: number;
  error?: string;
}

export function AdminFileUploader({
  editingFile,
  initialUploadMode,
  onSuccess,
  onCancelEdit,
  onPreviewFile,
}: {
  editingFile?: LectureFile | null;
  initialUploadMode?: LectureSourceType;
  onSuccess: () => void;
  onCancelEdit?: () => void;
  onPreviewFile?: (file: LectureFile) => void;
}) {
  const {
    firebaseUser,
    profile,
    role,
    isSuperAdmin,
    hasPerm,
    getIdToken,
    workspaceAccessToken,
    connectGoogleWorkspace,
    clearWorkspaceToken,
    authLoading,
  } = useAuth();
  const {
    specializations,
    subjects,
    programCourses,
    lectureFileLinks,
    lectureFiles,
    storageStats,
    settings,
    refreshAdminCatalog,
    refreshStorageStats,
  } = usePlatformData();

  const canPublish = hasPerm('lectures.publish');
  const canEditFiles = isSuperAdmin || hasPerm('lectures.edit');

  const initialDestinations = useMemo<DestinationRowState[]>(() => {
    if (!editingFile) return [];
    const resolved = getFileDestinations({
      file: editingFile,
      links: lectureFileLinks,
      subjects,
      programCourses,
      includeDrafts: true,
    });
    return resolved.map((d) => ({
      rowId: generateSafeId('dst'),
      specializationId: d.specializationId,
      academicYearId: d.academicYearId,
      semesterId: d.semesterId,
      subjectId: d.subjectId,
      status: d.status,
    }));
  }, [editingFile, lectureFileLinks, subjects, programCourses]);

  const [destinationRows, setDestinationRows] = useState<DestinationRowState[]>(
    initialDestinations
  );

  useEffect(() => {
    if (editingFile) {
      setDestinationRows(initialDestinations);
    }
  }, [editingFile, initialDestinations]);

  const [title, setTitle] = useState(editingFile?.title || '');
  const [description, setDescription] = useState(editingFile?.description || '');
  const [category, setCategory] = useState<LectureCategory>(
    editingFile?.category || 'lectures_pdf'
  );
  const [lectureNumber, setLectureNumber] = useState(
    editingFile?.lectureNumber || ''
  );
  const [version, setVersion] = useState(editingFile?.version || 'v1.0');
  const [sortOrder, setSortOrder] = useState<number>(
    editingFile?.sortOrder || computeNextSortOrder(lectureFiles)
  );
  const [status, setStatus] = useState<PublishStatus>(
    editingFile
      ? editingFile.status
      : canPublish
        ? 'published'
        : 'draft'
  );
  const [allowDownload, setAllowDownload] = useState<boolean>(
    editingFile ? editingFile.allowDownload : true
  );
  const [emitNotification, setEmitNotification] = useState<boolean>(
    !editingFile && canPublish
  );

  const resolvedInitialMode: LectureSourceType =
    editingFile && isGoogleDriveFile(editingFile)
      ? 'google_drive'
      : initialUploadMode === 'google_drive'
        ? 'google_drive'
        : 'upload';

  const [uploadMode, setUploadMode] = useState<LectureSourceType>(resolvedInitialMode);
  const [driveUrl, setDriveUrl] = useState<string>(editingFile?.externalUrl || '');
  const [selectedDriveFile, setSelectedDriveFile] = useState<GoogleDriveFileItem | null>(null);
  const [driveFiles, setDriveFiles] = useState<GoogleDriveFileItem[]>([]);
  const [driveSearch, setDriveSearch] = useState('');
  const [loadingDriveList, setLoadingDriveList] = useState(false);
  const [driveListError, setDriveListError] = useState<string | null>(null);

  const [queue, setQueue] = useState<QueuedFileItem[]>([]);
  const [localPreviewItem, setLocalPreviewItem] = useState<QueuedFileItem | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reusingLocalId, setReusingLocalId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeXhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => {
    if (!editingFile && initialUploadMode) {
      setUploadMode(initialUploadMode);
    }
  }, [initialUploadMode, editingFile]);

  // Revoke object URLs on unmount
  useEffect(() => {
    return () => {
      for (const item of queue) {
        if (item.previewObjectUrl) {
          URL.revokeObjectURL(item.previewObjectUrl);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchDriveFiles = async (token: string, queryText = '') => {
    setLoadingDriveList(true);
    setDriveListError(null);
    try {
      const items = await listGoogleDriveFiles(token, queryText);
      setDriveFiles(items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر جلب الملفات من Google Drive.';
      setDriveListError(msg);
      if (msg.includes('انتهت صلاحية')) {
        clearWorkspaceToken();
      }
    } finally {
      setLoadingDriveList(false);
    }
  };

  useEffect(() => {
    if (
      uploadMode === 'google_drive' &&
      workspaceAccessToken &&
      driveFiles.length === 0 &&
      !loadingDriveList
    ) {
      fetchDriveFiles(workspaceAccessToken, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadMode, workspaceAccessToken]);

  const parsedDriveUrl = useMemo(
    () => (driveUrl.trim() ? validateAndParseGoogleDriveUrl(driveUrl) : null),
    [driveUrl]
  );

  const handleSelectDriveFile = (item: GoogleDriveFileItem) => {
    setErrorMsg(null);
    setSelectedDriveFile(item);
    const fallbackUrl =
      item.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(item.id)}/view`;
    setDriveUrl(fallbackUrl);
    const meta = mapDriveMimeToMeta(item.mimeType, item.name);
    if (!title.trim()) {
      setTitle(item.name.replace(/\.[^/.]+$/, '').slice(0, 180));
    }
    setCategory(meta.suggestedCategory);
  };

  const completeDestinations = useMemo(
    () => rowsToDestinationInputs(destinationRows),
    [destinationRows]
  );

  const usedBytes =
    storageStats?.lecturesBytes ??
    lectureFiles.reduce((acc, f) => acc + (Number(f.fileSize) || 0), 0);
  const quotaMB = settings.storageQuotaMB || storageStats?.quotaMB || 1024;
  const selectedQueueItems = queue.filter(
    (q) => q.selected && (q.status === 'queued' || q.status === 'error')
  );
  const queuedBytes = selectedQueueItems
    .filter((q) => !q.duplicateMatch || q.forceUploadAnyway)
    .reduce((acc, q) => acc + q.file.size, 0);

  const quotaEvaluation = evaluateStorageQuota({
    usedBytes,
    incomingBytes: queuedBytes,
    quotaMB,
    thresholds: settings.alertThresholds || DEFAULT_STORAGE_THRESHOLDS,
  });

  const inspectFileDuplicates = async (item: QueuedFileItem) => {
    try {
      const sha256 = await computeBrowserFileSha256(item.file);
      let match = findDuplicateMatchForFile({
        sha256,
        fileSize: item.file.size,
        fileName: item.file.name,
        existingFiles: lectureFiles,
        links: lectureFileLinks,
      });

      if (!match && sha256) {
        const token = await getIdToken();
        if (token) {
          const res = await fetch('/api/files/check-duplicate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              sha256,
              fileSize: item.file.size,
              originalName: item.file.name,
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              duplicate?: boolean;
              duplicateFound?: boolean;
              matchType?: 'sha256_exact' | 'legacy_name_size';
              existingFile?: Partial<LectureFile>;
            };
            const isDuplicate = Boolean(data.duplicate ?? data.duplicateFound);
            if (isDuplicate && data.existingFile?.id) {
              const found =
                lectureFiles.find((f) => f.id === data.existingFile?.id) ||
                (data.existingFile as LectureFile);
              const existingCount = lectureFileLinks.filter(
                (l) => l.lectureFileId === found.id
              ).length;
              match = {
                matchType: data.matchType || 'sha256_exact',
                file: found,
                destinationsCount: existingCount || 1,
              };
            }
          }
        }
      }

      setQueue((prev) =>
        prev.map((q) =>
          q.localId === item.localId
            ? {
                ...q,
                sha256,
                hashing: false,
                duplicateMatch: match,
              }
            : q
        )
      );
    } catch {
      setQueue((prev) =>
        prev.map((q) => (q.localId === item.localId ? { ...q, hashing: false } : q))
      );
    }
  };

  const handleFilesChosen = (fileList: FileList | null) => {
    setErrorMsg(null);
    if (!fileList || fileList.length === 0) return;

    const files = editingFile ? [fileList[0]] : Array.from(fileList);
    const nextItems: QueuedFileItem[] = [];

    for (const file of files) {
      const validation = validateUploadFile({
        fileName: file.name,
        fileSizeBytes: file.size,
        maxFileSizeMB: settings.maxFileSizeMB || 25,
        allowZipUploads: settings.allowZipUploads !== false,
        allowedExtensions: settings.allowedExtensions,
      });
      if (!validation.valid) {
        setErrorMsg(`${file.name}: ${validation.error || 'ملف غير صالح.'}`);
        continue;
      }
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const canLocalPreview = ['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext);
      nextItems.push({
        localId: generateSafeId('q'),
        file,
        title: file.name.replace(/\.[^/.]+$/, ''),
        selected: true,
        hashing: !editingFile,
        previewObjectUrl: canLocalPreview ? URL.createObjectURL(file) : undefined,
        status: 'queued',
        progress: 0,
      });
    }

    if (nextItems.length > 0) {
      if (editingFile) {
        setQueue([nextItems[0]]);
        if (!title.trim()) setTitle(nextItems[0].title);
      } else {
        setQueue((prev) => [...prev, ...nextItems]);
        if (nextItems.length === 1 && !title.trim()) {
          setTitle(nextItems[0].title);
        }
        for (const item of nextItems) {
          void inspectFileDuplicates(item);
        }
      }
    }
  };

  const handleReuseDuplicateItem = async (item: QueuedFileItem) => {
    const match = item.duplicateMatch;
    if (!match || !firebaseUser) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (completeDestinations.length === 0) {
      setErrorMsg('يرجى تحديد وجهة أكاديمية واحدة على الأقل (التخصص، السنة، الفصل، المادة) قبل إعادة استخدام الملف.');
      return;
    }

    setReusingLocalId(item.localId);
    try {
      const existingFile = match.file;
      const effectiveStatus: PublishStatus = canPublish ? status : 'draft';
      const existingLinksForFile = lectureFileLinks.filter(
        (l) => l.lectureFileId === existingFile.id
      );

      const plan = buildDistributionLinkPlan({
        lectureFileId: existingFile.id,
        destinations: completeDestinations,
        existingLinks: existingLinksForFile,
        defaultStatus: effectiveStatus,
        createdBy: firebaseUser.uid,
        startingSortOrder: Number(sortOrder) || 1,
      });

      if (plan.toCreate.length === 0) {
        setSuccessMsg(
          `الملف "${existingFile.title}" مرتبط بالفعل بجميع الوجهات المحددة (${plan.skippedDuplicates} مكررة تم تخطيها).`
        );
        setQueue((prev) => prev.filter((q) => q.localId !== item.localId));
        return;
      }

      const batch = writeBatch(db);
      const now = serverTimestamp();

      // If file was unlinked or trashed and user can edit, re-activate primary metadata safely
      if (
        canEditFiles &&
        (existingFile.specializationId === CENTRAL_UNLINKED_MARKER ||
          existingFile.lifecycleStatus === 'trashed')
      ) {
        const firstDest = plan.toCreate[0];
        batch.update(doc(db, 'lectureFiles', existingFile.id), {
          specializationId: firstDest.specializationId,
          academicYearId: firstDest.academicYearId,
          semesterId: firstDest.semesterId,
          subjectId: firstDest.subjectId,
          lifecycleStatus: 'active',
          status: canPublish ? effectiveStatus : existingFile.status,
          updatedAt: now,
        });
      }

      for (const linkPayload of plan.toCreate) {
        batch.set(doc(db, 'lectureFileLinks', linkPayload.id), {
          ...linkPayload,
          createdAt: now,
          updatedAt: now,
        });
      }

      await batch.commit();

      const logId = generateSafeId('log');
      await setDoc(doc(db, 'activityLogs', logId), {
        id: logId,
        actorUid: firebaseUser.uid,
        actorEmail: firebaseUser.email || '',
        actorName: profile?.displayName || firebaseUser.displayName || '',
        actorRole: role,
        action: 'إعادة استخدام ملف من المكتبة المركزية',
        entityType: 'lectureFile',
        entityId: existingFile.id,
        entityName: `${existingFile.title} (${plan.toCreate.length} وجهات)`,
        result: 'success',
        createdAt: serverTimestamp(),
      }).catch(() => {});

      setQueue((prev) => prev.filter((q) => q.localId !== item.localId));
      setSuccessMsg(
        `تم ربط الملف الموجود "${existingFile.title}" بـ ${plan.toCreate.length} وجهة جديدة بدون إعادة رفع.`
      );
      await Promise.all([refreshStorageStats(), refreshAdminCatalog()]);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'تعذر إعادة استخدام الملف الموجود.'
      );
    } finally {
      setReusingLocalId(null);
    }
  };

  const uploadSingleFile = async (
    item: QueuedFileItem,
    primaryDest: {
      specializationId: string;
      academicYearId: string;
      semesterId: string;
      subjectId: string;
    },
    token: string
  ): Promise<{
    fileName: string;
    originalName: string;
    fileExt: string;
    mimeType: string;
    fileSize: number;
    storageName: string;
    storagePath?: string;
    sha256?: string;
  }> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      activeXhrRef.current = xhr;
      xhr.open('POST', '/api/files/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('x-spec-id', primaryDest.specializationId);
      xhr.setRequestHeader('x-year-id', primaryDest.academicYearId);
      xhr.setRequestHeader('x-semester-id', primaryDest.semesterId);
      xhr.setRequestHeader('x-subject-id', primaryDest.subjectId);

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const pct = Math.round((evt.loaded / evt.total) * 100);
          setQueue((prev) =>
            prev.map((q) =>
              q.localId === item.localId ? { ...q, status: 'uploading', progress: pct } : q
            )
          );
        }
      };

      xhr.onload = () => {
        activeXhrRef.current = null;
        try {
          const body = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(body);
          } else {
            reject(new Error(body.error || 'فشل رفع الملف على الخادم.'));
          }
        } catch {
          reject(new Error('استجابة غير متوقعة من خادم الرفع.'));
        }
      };

      xhr.onabort = () => {
        activeXhrRef.current = null;
        reject(new Error('__CANCELLED__'));
      };

      xhr.onerror = () => {
        activeXhrRef.current = null;
        reject(new Error('تعذر الاتصال بالخادم أثناء رفع الملف.'));
      };

      const formData = new FormData();
      formData.append('specializationId', primaryDest.specializationId);
      formData.append('academicYearId', primaryDest.academicYearId);
      formData.append('semesterId', primaryDest.semesterId);
      formData.append('subjectId', primaryDest.subjectId);
      formData.append('file', item.file);
      xhr.send(formData);
    });
  };

  const handleCancelActiveUpload = (localId: string) => {
    if (activeXhrRef.current) {
      activeXhrRef.current.abort();
    }
    setQueue((prev) =>
      prev.map((q) => (q.localId === localId ? { ...q, status: 'cancelled' } : q))
    );
  };

  const syncLinksForEditedFile = async (
    fileId: string,
    effectiveStatus: PublishStatus
  ) => {
    if (!firebaseUser) return;
    const currentLinks = lectureFileLinks.filter((l) => l.lectureFileId === fileId);
    const targetKeys = new Map(
      completeDestinations.map((d) => [
        `${d.specializationId}::${d.academicYearId}::${d.semesterId}::${d.subjectId}`,
        d,
      ])
    );

    const batch = writeBatch(db);
    const now = serverTimestamp();

    for (const oldLink of currentLinks) {
      const k = `${oldLink.specializationId}::${oldLink.academicYearId}::${oldLink.semesterId}::${oldLink.subjectId}`;
      if (!targetKeys.has(k)) {
        batch.delete(doc(db, 'lectureFileLinks', oldLink.id));
      }
    }

    const plan = buildDistributionLinkPlan({
      lectureFileId: fileId,
      destinations: completeDestinations,
      existingLinks: currentLinks,
      defaultStatus: effectiveStatus,
      createdBy: firebaseUser.uid,
      startingSortOrder: Number(sortOrder) || 1,
    });

    for (const linkPayload of plan.toCreate) {
      batch.set(doc(db, 'lectureFileLinks', linkPayload.id), {
        ...linkPayload,
        createdAt: now,
        updatedAt: now,
      });
    }

    await batch.commit();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!firebaseUser) {
      setErrorMsg('يجب تسجيل الدخول كمسؤول أو مشرف.');
      return;
    }

    const hasIncompleteRows = destinationRows.some((r) => !isDestinationComplete(r));
    if (completeDestinations.length === 0 || hasIncompleteRows) {
      setErrorMsg(
        'يرجى تحديد تخصص واحد على الأقل وإكمال اختيار السنة الدراسية والفصل والمادة لكل تخصص محدد.'
      );
      return;
    }

    const primaryDest = completeDestinations[0];
    const effectiveStatus: PublishStatus = canPublish ? status : 'draft';

    if (uploadMode === 'google_drive') {
      const driveValidation = validateAndParseGoogleDriveUrl(driveUrl);
      if (!driveValidation.valid) {
        setErrorMsg(driveValidation.error || 'يرجى إدخال رابط Google Drive صالح.');
        return;
      }
      if (title.trim().length < 2) {
        setErrorMsg('يرجى إدخال عنوان واضح للملف لا يقل عن حرفين.');
        return;
      }

      setSubmitting(true);
      try {
        const token = await getIdToken();
        const selectedMeta = selectedDriveFile
          ? mapDriveMimeToMeta(selectedDriveFile.mimeType, selectedDriveFile.name)
          : null;
        const resolvedExt =
          selectedMeta?.fileExt ||
          (editingFile && isGoogleDriveFile(editingFile)
            ? editingFile.fileExt
            : driveValidation.inferredExt);
        const resolvedMime =
          selectedMeta?.mimeType ||
          (editingFile && isGoogleDriveFile(editingFile)
            ? editingFile.mimeType
            : driveValidation.inferredMimeType);
        const resolvedOriginalName =
          selectedDriveFile?.name ||
          (editingFile && isGoogleDriveFile(editingFile)
            ? editingFile.originalName
            : `${title.trim().slice(0, 120)}.${resolvedExt}`);
        const resolvedSize = selectedDriveFile?.size
          ? Math.max(0, Number(selectedDriveFile.size) || 0)
          : editingFile && isGoogleDriveFile(editingFile)
            ? editingFile.fileSize
            : 0;
        const fileId = editingFile ? editingFile.id : generateSafeId('file');
        const resolvedDriveId = selectedDriveFile?.id || driveValidation.driveFileId;
        const resolvedStorageName = resolvedDriveId
          ? `gdrive_${resolvedDriveId.slice(0, 180)}`
          : `gdrive_${fileId}`;

        const payload: Record<string, unknown> = {
          id: fileId,
          specializationId: primaryDest.specializationId,
          academicYearId: primaryDest.academicYearId,
          semesterId: primaryDest.semesterId,
          subjectId: primaryDest.subjectId,
          title: title.trim().slice(0, 200),
          category,
          sourceType: 'google_drive',
          externalUrl: driveValidation.normalizedUrl,
          fileName: resolvedOriginalName.slice(0, 260),
          originalName: resolvedOriginalName.slice(0, 260),
          fileExt: resolvedExt.slice(0, 20),
          mimeType: resolvedMime.slice(0, 120),
          fileSize: resolvedSize,
          storageName: resolvedStorageName.slice(0, 260),
          allowDownload,
          status: editingFile ? (canPublish ? status : editingFile.status) : effectiveStatus,
          lifecycleStatus: editingFile?.lifecycleStatus || 'active',
          sortOrder: Number(sortOrder) || 1,
          uploadedBy: editingFile ? editingFile.uploadedBy : firebaseUser.uid,
          updatedAt: serverTimestamp(),
        };

        if (resolvedDriveId) payload.driveFileId = resolvedDriveId;
        if (description.trim()) payload.description = description.trim().slice(0, 800);
        if (lectureNumber.trim()) payload.lectureNumber = lectureNumber.trim().slice(0, 40);
        if (version.trim()) payload.version = version.trim().slice(0, 40);

        if (editingFile) {
          if (
            token &&
            editingFile.storageName &&
            !isGoogleDriveFile(editingFile) &&
            !editingFile.storageName.startsWith('gdrive_')
          ) {
            fetch(
              `/api/files/storage/${encodeURIComponent(editingFile.storageName)}?fileId=${encodeURIComponent(editingFile.id)}`,
              {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              }
            ).catch(() => {});
          }
          await updateDoc(doc(db, 'lectureFiles', editingFile.id), payload);
          await syncLinksForEditedFile(
            editingFile.id,
            canPublish ? status : editingFile.status
          );
          setSuccessMsg('تم تحديث رابط Google Drive وروابط التوزيع بنجاح.');
        } else {
          payload.uploadedByEmail = firebaseUser.email || '';
          payload.uploadedByName = profile?.displayName || firebaseUser.displayName || '';
          payload.createdAt = serverTimestamp();

          const linkPlan = buildDistributionLinkPlan({
            lectureFileId: fileId,
            destinations: completeDestinations,
            existingLinks: [],
            defaultStatus: effectiveStatus,
            createdBy: firebaseUser.uid,
            startingSortOrder: 1,
          });

          const batch = writeBatch(db);
          const now = serverTimestamp();
          batch.set(doc(db, 'lectureFiles', fileId), {
            ...payload,
            createdAt: now,
            updatedAt: now,
          });
          for (const linkPayload of linkPlan.toCreate) {
            batch.set(doc(db, 'lectureFileLinks', linkPayload.id), {
              ...linkPayload,
              createdAt: now,
              updatedAt: now,
            });
          }
          await batch.commit();

          const logId = generateSafeId('log');
          await setDoc(doc(db, 'activityLogs', logId), {
            id: logId,
            actorUid: firebaseUser.uid,
            actorEmail: firebaseUser.email || '',
            actorName: profile?.displayName || firebaseUser.displayName || '',
            actorRole: role,
            action: 'ربط وتوزيع ملف من Google Drive',
            entityType: 'lectureFile',
            entityId: fileId,
            entityName: `${title.trim().slice(0, 160)} (${linkPlan.toCreate.length} وجهات)`,
            result: 'success',
            createdAt: serverTimestamp(),
          }).catch(() => {});

          if (token) {
            await fetch('/api/admin/audit-logs', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                action: 'ربط وتوزيع ملف من Google Drive',
                entityType: 'lectureFile',
                entityId: fileId,
                entityName: title.trim().slice(0, 200),
                result: 'success',
              }),
            }).catch(() => {});
          }

          if (emitNotification && effectiveStatus === 'published') {
            for (const dest of completeDestinations) {
              const subjectName =
                subjects.find((s) => s.id === dest.subjectId)?.name || 'مقرر دراسي';
              const notifId = generateSafeId('notif');
              await setDoc(doc(db, 'notifications', notifId), {
                id: notifId,
                title: `ملف جديد في ${subjectName}`,
                message: `تم نشر "${title.trim()}" عبر Google Drive في مادة ${subjectName}.`,
                type: 'lecture',
                specializationId: dest.specializationId,
                subjectId: dest.subjectId,
                fileId,
                status: 'published',
                createdAt: serverTimestamp(),
              }).catch(() => {});
            }
          }

          setSuccessMsg(
            `تم ربط ملف Google Drive وتوزيعه على ${linkPlan.toCreate.length} مسارات دراسية دون تكرار.`
          );
          setTitle('');
          setDescription('');
          setLectureNumber('');
          setDriveUrl('');
          setSelectedDriveFile(null);
        }

        await Promise.all([refreshStorageStats(), refreshAdminCatalog()]);
        onSuccess();
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('{')) {
          handleFirestoreError(error, OperationType.WRITE, 'lectureFiles');
        }
        setErrorMsg(
          error instanceof Error ? error.message : 'حدث خطأ أثناء حفظ رابط Google Drive.'
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!editingFile && selectedQueueItems.length === 0) {
      setErrorMsg('يرجى اختيار ملف واحد على الأقل وتحديد علامة الاختيار بجانبه لرفعه.');
      return;
    }
    if (editingFile && title.trim().length < 2) {
      setErrorMsg('يرجى إدخال عنوان واضح للملف لا يقل عن حرفين.');
      return;
    }

    const unresolvedDuplicate = !editingFile
      ? selectedQueueItems.find((item) => item.duplicateMatch && !item.forceUploadAnyway)
      : undefined;
    if (unresolvedDuplicate) {
      setErrorMsg(
        `الملف "${unresolvedDuplicate.file.name}" موجود بالفعل في المكتبة المركزية. اختر "إعادة استخدام الملف الموجود" أو فعّل خيار الرفع رغم التنبيه للمتابعة.`
      );
      return;
    }

    if (queuedBytes > 0 && !quotaEvaluation.canUpload) {
      setErrorMsg(
        quotaEvaluation.message || 'عذراً، مساحة التخزين المتاحة غير كافية. يرجى مراجعة مسؤول المنصة.'
      );
      return;
    }

    setSubmitting(true);

    try {
      const token = await getIdToken();
      if (!token) throw new Error('تعذر التحقق من جلسة المستخدم.');

      if (editingFile) {
        let fileMeta: {
          fileName: string;
          originalName: string;
          fileExt: string;
          mimeType: string;
          fileSize: number;
          storageName: string;
          storagePath?: string;
          sha256?: string;
        } = {
          fileName: editingFile.fileName,
          originalName: editingFile.originalName,
          fileExt: editingFile.fileExt,
          mimeType: editingFile.mimeType,
          fileSize: editingFile.fileSize,
          storageName: editingFile.storageName,
          storagePath: editingFile.storagePath,
          sha256: editingFile.sha256,
        };

        const replacementItem = queue[0];
        if (replacementItem) {
          const uploaded = await uploadSingleFile(replacementItem, primaryDest, token);
          if (
            editingFile.storageName &&
            editingFile.storageName !== uploaded.storageName &&
            !editingFile.storageName.startsWith('gdrive_')
          ) {
            fetch(
              `/api/files/storage/${encodeURIComponent(editingFile.storageName)}?fileId=${encodeURIComponent(editingFile.id)}`,
              {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              }
            ).catch(() => {});
          }
          fileMeta = uploaded;
        }

        const nextStatus = canPublish ? status : editingFile.status;
        const payload: Record<string, unknown> = {
          id: editingFile.id,
          specializationId: primaryDest.specializationId,
          academicYearId: primaryDest.academicYearId,
          semesterId: primaryDest.semesterId,
          subjectId: primaryDest.subjectId,
          title: title.trim(),
          category,
          sourceType: 'upload',
          fileName: fileMeta.fileName,
          originalName: fileMeta.originalName,
          fileExt: fileMeta.fileExt,
          mimeType: fileMeta.mimeType,
          fileSize: fileMeta.fileSize,
          storageName: fileMeta.storageName,
          allowDownload,
          status: nextStatus,
          lifecycleStatus: editingFile.lifecycleStatus || 'active',
          sortOrder: Number(sortOrder) || 1,
          uploadedBy: editingFile.uploadedBy,
          updatedAt: serverTimestamp(),
        };
        if (fileMeta.storagePath) payload.storagePath = fileMeta.storagePath;
        if (fileMeta.sha256) payload.sha256 = fileMeta.sha256;
        if (description.trim()) payload.description = description.trim();
        if (lectureNumber.trim()) payload.lectureNumber = lectureNumber.trim();
        if (version.trim()) payload.version = version.trim();

        await updateDoc(doc(db, 'lectureFiles', editingFile.id), payload);
        await syncLinksForEditedFile(editingFile.id, nextStatus);

        await fetch('/api/files/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            id: editingFile.id,
            storageName: fileMeta.storageName,
            storagePath: fileMeta.storagePath,
            sha256: fileMeta.sha256,
            originalName: fileMeta.originalName,
            fileName: fileMeta.fileName,
            fileExt: fileMeta.fileExt,
            mimeType: fileMeta.mimeType,
            fileSize: fileMeta.fileSize,
            allowDownload,
            status: nextStatus,
            specializationId: primaryDest.specializationId,
            academicYearId: primaryDest.academicYearId,
            semesterId: primaryDest.semesterId,
            subjectId: primaryDest.subjectId,
            title: title.trim(),
            uploadedBy: editingFile.uploadedBy,
          }),
        }).catch(() => {});

        await fetch('/api/admin/audit-logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: 'تعديل ملف محاضرة وتحديث التوزيع',
            entityType: 'lectureFile',
            entityId: editingFile.id,
            entityName: title.trim(),
            result: 'success',
          }),
        }).catch(() => {});

        setSuccessMsg('تم تحديث بيانات الملف وتوزيعه على التخصصات بنجاح.');
      } else {
        let nextOrder = Number(sortOrder) || computeNextSortOrder(lectureFiles);
        let uploadedCount = 0;

        for (let idx = 0; idx < selectedQueueItems.length; idx += 1) {
          const item = selectedQueueItems[idx];
          const effectiveTitle =
            selectedQueueItems.length === 1 && title.trim().length >= 2
              ? title.trim()
              : item.title.trim().length >= 2
                ? item.title.trim()
                : item.file.name;

          try {
            setQueue((prev) =>
              prev.map((q) =>
                q.localId === item.localId
                  ? { ...q, status: 'uploading', error: undefined }
                  : q
              )
            );
            const uploaded = await uploadSingleFile(item, primaryDest, token);
            const fileId = generateSafeId('file');

            const linkPlan = buildDistributionLinkPlan({
              lectureFileId: fileId,
              destinations: completeDestinations,
              existingLinks: [],
              defaultStatus: effectiveStatus,
              createdBy: firebaseUser.uid,
              startingSortOrder: 1,
            });

            const batch = writeBatch(db);
            const now = serverTimestamp();

            const payload: Record<string, unknown> = {
              id: fileId,
              specializationId: primaryDest.specializationId,
              academicYearId: primaryDest.academicYearId,
              semesterId: primaryDest.semesterId,
              subjectId: primaryDest.subjectId,
              title: effectiveTitle,
              category,
              sourceType: 'upload',
              fileName: uploaded.fileName,
              originalName: uploaded.originalName,
              fileExt: uploaded.fileExt,
              mimeType: uploaded.mimeType,
              fileSize: uploaded.fileSize,
              storageName: uploaded.storageName,
              allowDownload,
              status: effectiveStatus,
              lifecycleStatus: 'active',
              sortOrder: nextOrder,
              uploadedBy: firebaseUser.uid,
              uploadedByEmail: firebaseUser.email || '',
              uploadedByName: profile?.displayName || firebaseUser.displayName || '',
              createdAt: now,
              updatedAt: now,
            };
            if (uploaded.storagePath) payload.storagePath = uploaded.storagePath;
            if (uploaded.sha256) payload.sha256 = uploaded.sha256;
            if (description.trim()) payload.description = description.trim();
            if (lectureNumber.trim()) payload.lectureNumber = lectureNumber.trim();
            if (version.trim()) payload.version = version.trim();

            batch.set(doc(db, 'lectureFiles', fileId), payload);
            for (const linkPayload of linkPlan.toCreate) {
              batch.set(doc(db, 'lectureFileLinks', linkPayload.id), {
                ...linkPayload,
                createdAt: now,
                updatedAt: now,
              });
            }

            await batch.commit();

            await fetch('/api/files/register', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                id: fileId,
                storageName: uploaded.storageName,
                storagePath: uploaded.storagePath,
                sha256: uploaded.sha256,
                originalName: uploaded.originalName,
                fileName: uploaded.fileName,
                fileExt: uploaded.fileExt,
                mimeType: uploaded.mimeType,
                fileSize: uploaded.fileSize,
                allowDownload,
                status: effectiveStatus,
                specializationId: primaryDest.specializationId,
                academicYearId: primaryDest.academicYearId,
                semesterId: primaryDest.semesterId,
                subjectId: primaryDest.subjectId,
                title: effectiveTitle,
                uploadedBy: firebaseUser.uid,
                uploadedByEmail: firebaseUser.email || '',
              }),
            }).catch(() => {});

            const logId = generateSafeId('log');
            await setDoc(doc(db, 'activityLogs', logId), {
              id: logId,
              actorUid: firebaseUser.uid,
              actorEmail: firebaseUser.email || '',
              actorName: profile?.displayName || firebaseUser.displayName || '',
              actorRole: role,
              action: 'رفع وتوزيع محاضرة على البرامج المحددة',
              entityType: 'lectureFile',
              entityId: fileId,
              entityName: `${effectiveTitle} (${linkPlan.toCreate.length} وجهات)`,
              result: 'success',
              createdAt: serverTimestamp(),
            }).catch(() => {});

            await fetch('/api/admin/audit-logs', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                action: 'رفع وتوزيع محاضرة على البرامج المحددة',
                entityType: 'lectureFile',
                entityId: fileId,
                entityName: effectiveTitle,
                result: 'success',
              }),
            }).catch(() => {});

            if (emitNotification && effectiveStatus === 'published') {
              for (const dest of completeDestinations) {
                const subjectName =
                  subjects.find((s) => s.id === dest.subjectId)?.name || 'مقرر دراسي';
                const notifId = generateSafeId('notif');
                await setDoc(doc(db, 'notifications', notifId), {
                  id: notifId,
                  title: `ملف جديد في ${subjectName}`,
                  message: `تم نشر "${effectiveTitle}" في مادة ${subjectName}.`,
                  type: 'lecture',
                  specializationId: dest.specializationId,
                  subjectId: dest.subjectId,
                  fileId,
                  status: 'published',
                  createdAt: serverTimestamp(),
                }).catch(() => {});
              }
            }

            nextOrder += 1;
            uploadedCount += 1;
            setQueue((prev) =>
              prev.map((q) =>
                q.localId === item.localId ? { ...q, status: 'done', progress: 100 } : q
              )
            );
          } catch (itemErr) {
            const msg = itemErr instanceof Error ? itemErr.message : 'فشل الرفع.';
            if (msg === '__CANCELLED__') {
              setQueue((prev) =>
                prev.map((q) =>
                  q.localId === item.localId
                    ? { ...q, status: 'cancelled', error: 'تم إلغاء الرفع.' }
                    : q
                )
              );
            } else {
              setQueue((prev) =>
                prev.map((q) =>
                  q.localId === item.localId ? { ...q, status: 'error', error: msg } : q
                )
              );
              setErrorMsg(msg);
            }
          }
        }

        if (uploadedCount > 0) {
          setSuccessMsg(
            `تم رفع ${uploadedCount} ملف لمرة واحدة ونشره في ${completeDestinations.length} وجهة أكاديمية بنجاح.`
          );
          setTitle('');
          setDescription('');
          setLectureNumber('');
          setQueue((prev) => prev.filter((q) => q.status === 'error' || !q.selected));
        }
      }

      await Promise.all([refreshStorageStats(), refreshAdminCatalog()]);
      onSuccess();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('{')) {
        handleFirestoreError(error, OperationType.WRITE, 'lectureFiles');
      }
      setErrorMsg(error instanceof Error ? error.message : 'حدث خطأ أثناء حفظ الملف.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-[#0B2545]">
            {editingFile
              ? `تعديل وتوزيع ملف: ${editingFile.title}`
              : uploadMode === 'google_drive'
                ? 'ربط وتوزيع ملف من Google Drive على تخصصات متعددة'
                : 'رفع ونشر المحاضرات على البرامج المحددة (رفع مرة واحدة)'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {uploadMode === 'google_drive'
              ? 'اربط مستند Google Drive مرة واحدة ووزعه على عدة تخصصات وسنوات دراسية بدون تكرار.'
              : `يُحفظ الملف مرة واحدة في المكتبة المركزية مع فحص التطابق (SHA-256) وتوزيعه فوراً على التخصصات المختارة · الحد الأقصى: ${settings.maxFileSizeMB} ميجابايت`}
          </p>
        </div>
        {editingFile && onCancelEdit && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:text-[#0B2545]"
          >
            إلغاء التعديل
          </button>
        )}
      </div>

      {/* Upload Source Mode Switcher */}
      <div
        role="tablist"
        aria-label="طريقة إضافة الملف"
        className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-1.5 rounded-2xl bg-[#EAF4F7] border border-slate-200/80"
      >
        <button
          type="button"
          role="tab"
          aria-selected={uploadMode === 'upload'}
          onClick={() => {
            setUploadMode('upload');
            setErrorMsg(null);
          }}
          className={`min-h-[44px] px-4 py-2 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors ${
            uploadMode === 'upload'
              ? 'bg-[#0B2545] text-white shadow-xs'
              : 'text-[#0B2545] hover:bg-white/70'
          }`}
        >
          <UploadCloud className="w-4 h-4" />
          الرفع إلى المكتبة المركزية
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={uploadMode === 'google_drive'}
          onClick={() => {
            setUploadMode('google_drive');
            setErrorMsg(null);
          }}
          className={`min-h-[44px] px-4 py-2 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors ${
            uploadMode === 'google_drive'
              ? 'bg-[#00A6A6] text-white shadow-xs'
              : 'text-[#0B2545] hover:bg-white/70'
          }`}
        >
          <Cloud className="w-4 h-4" />
          ربط من Google Drive مباشرة
        </button>
      </div>

      {/* Quota Warning / Block Alert */}
      {uploadMode === 'upload' && !quotaEvaluation.canUpload && (
        <div
          role="alert"
          className="rounded-2xl bg-[#FF8066] text-white px-4 py-3 text-sm font-semibold flex items-center gap-2.5"
        >
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{quotaEvaluation.message}</span>
        </div>
      )}

      {/* Multi-Specialization Academic Destination Picker */}
      <MultiDestinationPicker
        rows={destinationRows}
        onChange={setDestinationRows}
        defaultStatus={canPublish ? status : 'draft'}
        hintSubjectName={
          editingFile
            ? subjects.find((s) => s.id === editingFile.subjectId)?.name
            : undefined
        }
        hintSubjectCode={
          editingFile
            ? subjects.find((s) => s.id === editingFile.subjectId)?.code
            : undefined
        }
      />

      {uploadMode === 'google_drive' ? (
        <div className="rounded-2xl border border-[#00A6A6]/35 bg-[#EAF4F7]/45 p-5 space-y-5">
          <div className="space-y-2">
            <label
              htmlFor="gdrive-external-url"
              className="text-xs font-bold text-[#0B2545] flex items-center gap-1.5"
            >
              <Link2 className="w-4 h-4 text-[#00A6A6]" />
              رابط ملف أو مستند Google Drive / Google Docs *
            </label>
            <input
              id="gdrive-external-url"
              type="url"
              dir="ltr"
              required={uploadMode === 'google_drive'}
              value={driveUrl}
              onChange={(e) => {
                setDriveUrl(e.target.value);
                if (selectedDriveFile && e.target.value !== selectedDriveFile.webViewLink) {
                  setSelectedDriveFile(null);
                }
              }}
              placeholder="https://drive.google.com/file/d/.../view  أو  https://docs.google.com/document/d/.../edit"
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm text-[#0B2545] text-left font-mono"
            />
            {parsedDriveUrl && (
              parsedDriveUrl.valid ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-white border border-[#00A6A6]/30 rounded-xl px-3.5 py-2.5">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#00A6A6]">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    رابط Google Drive موثوق وجاهز للتوزيع
                    {parsedDriveUrl.driveFileId && (
                      <span className="font-mono text-[11px] text-slate-500">
                        ({parsedDriveUrl.driveFileId.slice(0, 14)}...)
                      </span>
                    )}
                  </span>
                  <a
                    href={parsedDriveUrl.normalizedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#0B2545] hover:text-[#00A6A6] font-semibold inline-flex items-center gap-1"
                  >
                    اختبار الرابط
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              ) : (
                <p role="alert" className="text-xs font-semibold text-[#FF8066]">
                  {parsedDriveUrl.error}
                </p>
              )
            )}
          </div>

          <div className="pt-3 border-t border-slate-200/80 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-[#0B2545]">
                  أو تصفح واختر ملفاً مباشرة من حسابك في Google Drive
                </p>
                <p className="text-[11px] text-slate-500">
                  يستورد الاسم والرابط الوثيق وحجم الملف ونوعه تلقائياً مع إبقاء الملف في Google Drive.
                </p>
              </div>
              {workspaceAccessToken && (
                <button
                  type="button"
                  onClick={() => fetchDriveFiles(workspaceAccessToken, driveSearch)}
                  disabled={loadingDriveList}
                  className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-[#0B2545] inline-flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingDriveList ? 'animate-spin' : ''}`} />
                  تحديث القائمة
                </button>
              )}
            </div>

            {!workspaceAccessToken ? (
              <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-slate-600">
                  اربط حساب Google Workspace لاستعراض ملفات Google Drive الخاصة بك واختيارها بنقرة واحدة.
                </p>
                <button
                  type="button"
                  onClick={() => connectGoogleWorkspace()}
                  disabled={authLoading}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-[#0B2545] text-xs font-semibold inline-flex items-center justify-center gap-2 shrink-0 shadow-xs disabled:opacity-60"
                >
                  <span>ربط Google Drive · استعراض الملفات</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="search"
                      value={driveSearch}
                      onChange={(e) => setDriveSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          fetchDriveFiles(workspaceAccessToken, driveSearch);
                        }
                      }}
                      placeholder="ابحث داخل ملفات Google Drive بالاسم..."
                      className="w-full min-h-[40px] pr-9 pl-3 rounded-xl bg-white border border-slate-200 text-xs text-[#0B2545]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => fetchDriveFiles(workspaceAccessToken, driveSearch)}
                    className="min-h-[40px] px-4 rounded-xl bg-[#0B2545] text-white text-xs font-semibold"
                  >
                    بحث
                  </button>
                </div>

                {driveListError && (
                  <p role="alert" className="text-xs font-semibold text-[#FF8066]">
                    {driveListError}
                  </p>
                )}

                <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[240px] overflow-y-auto">
                  {loadingDriveList ? (
                    <div className="p-6 text-center text-xs text-slate-500 inline-flex w-full items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-[#00A6A6]" />
                      جاري جلب الملفات من Google Drive...
                    </div>
                  ) : driveFiles.length === 0 ? (
                    <p className="p-5 text-center text-xs text-slate-500">
                      لا توجد ملفات مطابقة في Google Drive. يمكنك أيضاً لصق الرابط مباشرة في الحقل أعلاه.
                    </p>
                  ) : (
                    driveFiles.map((item) => {
                      const meta = mapDriveMimeToMeta(item.mimeType, item.name);
                      const isPicked = selectedDriveFile?.id === item.id;
                      const sizeNum = Number(item.size) || 0;
                      return (
                        <div
                          key={item.id}
                          className={`p-3 flex items-center justify-between gap-3 ${
                            isPicked ? 'bg-[#EAF4F7]' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-[#0B2545] truncate">{item.name}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                              <span>{meta.typeLabelAr}</span>
                              {sizeNum > 0 && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="tabular-nums">{formatFileSizeArabic(sizeNum)}</span>
                                </>
                              )}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSelectDriveFile(item)}
                            className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold shrink-0 transition-colors ${
                              isPicked
                                ? 'bg-[#00A6A6] text-white'
                                : 'bg-[#EAF4F7] hover:bg-[#0B2545] text-[#0B2545] hover:text-white'
                            }`}
                          >
                            {isPicked ? 'مختار' : 'اختيار الملف'}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Drag & Drop Zone + SHA-256 Duplicate Checking + Selection & Local Preview */
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            handleFilesChosen(e.dataTransfer.files);
          }}
          className={`rounded-2xl border-2 border-dashed p-5 sm:p-6 text-center transition-colors ${
            dragActive
              ? 'border-[#00A6A6] bg-[#EAF4F7]'
              : 'border-slate-300 bg-slate-50/70 hover:border-[#00A6A6]'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple={!editingFile}
            className="hidden"
            onChange={(e) => handleFilesChosen(e.target.files)}
          />
          <UploadCloud className="w-10 h-10 mx-auto text-[#00A6A6] mb-2" />
          <p className="text-sm font-semibold text-[#0B2545]">
            {editingFile
              ? 'اسحب ملفاً بديلاً هنا لتحديث الملف الحالي (اختياري)'
              : 'اسحب وأفلت ملفاً أو عدة ملفات هنا'}
          </p>
          <p className="text-xs text-slate-500 mt-1 mb-3">
            يتم فحص بصمة المحتوى (SHA-256) تلقائياً لمنع التكرار وتقليل استهلاك التخزين
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0B2545] hover:bg-[#133866] text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
          >
            <FileUp className="w-4 h-4" />
            تصفح الملفات
          </button>

          {/* Queued Files List with Checkbox Selection, Pre-upload Preview & Duplicate Guard */}
          {queue.length > 0 && (
            <div className="mt-4 space-y-2.5 text-right max-w-3xl mx-auto">
              {queue.map((item) => {
                const dup = item.duplicateMatch;
                const dupSpecNames = dup
                  ? getFileDestinations({
                      file: dup.file,
                      links: lectureFileLinks,
                      subjects,
                      programCourses,
                      includeDrafts: true,
                    })
                      .map((d) => specializations.find((s) => s.id === d.specializationId)?.name)
                      .filter(Boolean)
                  : [];

                return (
                  <div
                    key={item.localId}
                    className={`bg-white border rounded-xl p-3.5 space-y-2.5 ${
                      dup && !item.forceUploadAnyway
                        ? 'border-amber-400 bg-amber-50/35'
                        : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2.5 text-xs">
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        {!editingFile && (
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={(e) =>
                              setQueue((prev) =>
                                prev.map((q) =>
                                  q.localId === item.localId
                                    ? { ...q, selected: e.target.checked }
                                    : q
                                )
                              )
                            }
                            aria-label={`تحديد ${item.file.name}`}
                            className="mt-1 w-4 h-4 accent-[#00A6A6] shrink-0"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          {!editingFile && queue.length > 1 ? (
                            <input
                              type="text"
                              value={item.title}
                              onChange={(e) =>
                                setQueue((prev) =>
                                  prev.map((q) =>
                                    q.localId === item.localId
                                      ? { ...q, title: e.target.value }
                                      : q
                                  )
                                )
                              }
                              className="w-full min-h-[34px] px-2.5 rounded-lg border border-slate-200 font-bold text-[#0B2545]"
                            />
                          ) : (
                            <p className="font-bold text-[#0B2545] truncate">{item.file.name}</p>
                          )}
                          <p className="text-[11px] text-slate-500 mt-1 tabular-nums flex flex-wrap items-center gap-2">
                            <span>
                              {item.file.name} · {formatFileSizeArabic(item.file.size)}
                            </span>
                            {item.hashing && (
                              <span className="text-[#00A6A6] inline-flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                جاري فحص التطابق...
                              </span>
                            )}
                            {item.sha256 && (
                              <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">
                                SHA256: {item.sha256.slice(0, 10)}…
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.previewObjectUrl && (
                          <button
                            type="button"
                            onClick={() => setLocalPreviewItem(item)}
                            className="min-h-[30px] px-2.5 py-1 rounded-lg bg-[#EAF4F7] hover:bg-[#0B2545] text-[#0B2545] hover:text-white text-[11px] font-semibold inline-flex items-center gap-1 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            معاينة قبل النشر
                          </button>
                        )}
                        {item.status === 'uploading' && (
                          <button
                            type="button"
                            onClick={() => handleCancelActiveUpload(item.localId)}
                            className="px-2.5 py-1 rounded-lg bg-[#FF8066]/15 text-[#FF8066] text-[11px] font-semibold"
                          >
                            إلغاء الرفع
                          </button>
                        )}
                        {(item.status === 'error' || item.status === 'cancelled') && (
                          <button
                            type="button"
                            onClick={() =>
                              setQueue((prev) =>
                                prev.map((q) =>
                                  q.localId === item.localId
                                    ? { ...q, status: 'queued', error: undefined }
                                    : q
                                )
                              )
                            }
                            title="إعادة للمحاولة"
                            className="p-1 text-[#00A6A6]"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        {item.status !== 'uploading' && (
                          <button
                            type="button"
                            onClick={() => {
                              if (item.previewObjectUrl) {
                                URL.revokeObjectURL(item.previewObjectUrl);
                              }
                              setQueue((prev) =>
                                prev.filter((q) => q.localId !== item.localId)
                              );
                            }}
                            aria-label="إزالة من القائمة"
                            className="p-1 text-slate-400 hover:text-[#FF8066]"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Smart Duplicate Warning Banner */}
                    {dup && !editingFile && (
                      <div className="rounded-xl bg-amber-50 border border-amber-300 p-3 space-y-2 text-right">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-[#0B2545]">
                              هذا الملف موجود بالفعل في المكتبة المركزية.
                            </p>
                            <p className="text-[11px] text-slate-600 mt-0.5">
                              الملف المطابق: <strong>{dup.file.title}</strong> ({dup.file.originalName}) · مرتبط حالياً بـ{' '}
                              <strong>{dup.destinationsCount}</strong> وجهة
                              {dupSpecNames.length > 0 && ` (${dupSpecNames.slice(0, 3).join('، ')})`}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleReuseDuplicateItem(item)}
                            disabled={reusingLocalId === item.localId || completeDestinations.length === 0}
                            className="min-h-[34px] px-3 py-1.5 rounded-lg bg-[#00A6A6] hover:bg-[#008e8e] text-white text-[11px] font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                          >
                            {reusingLocalId === item.localId ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CopyCheck className="w-3.5 h-3.5" />
                            )}
                            إعادة استخدام الملف الموجود وربطه بالبرامج المحددة
                          </button>

                          {onPreviewFile && (
                            <button
                              type="button"
                              onClick={() => onPreviewFile(dup.file)}
                              className="min-h-[34px] px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-[#0B2545] text-[11px] font-semibold inline-flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5 text-[#00A6A6]" />
                              عرض الملف الموجود
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              setQueue((prev) =>
                                prev.map((q) =>
                                  q.localId === item.localId
                                    ? { ...q, forceUploadAnyway: !q.forceUploadAnyway }
                                    : q
                                )
                              )
                            }
                            className={`min-h-[34px] px-3 py-1.5 rounded-lg border text-[11px] font-semibold ${
                              item.forceUploadAnyway
                                ? 'bg-[#0B2545] text-white border-[#0B2545]'
                                : 'bg-white text-slate-600 border-slate-300 hover:border-[#0B2545]'
                            }`}
                          >
                            {item.forceUploadAnyway
                              ? 'تم السماح بالرفع كملف مستقل'
                              : 'رفع نسخة مستقلة رغم التنبيه'}
                          </button>
                        </div>
                      </div>
                    )}

                    {item.status === 'uploading' && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] text-[#0B2545]">
                          <span>جاري الرفع إلى التخزين المركزي...</span>
                          <span className="tabular-nums">{item.progress}%</span>
                        </div>
                        <div className="h-1.5 bg-[#EAF4F7] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#00A6A6] transition-all"
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {item.error && (
                      <p className="text-[11px] font-semibold text-[#FF8066]">{item.error}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {queue.length === 0 && editingFile && (
            <p className="mt-3 text-xs text-slate-600">
              الملف الحالي: <span className="font-semibold">{editingFile.originalName}</span> (
              {formatFileSizeArabic(editingFile.fileSize)})
            </p>
          )}
        </div>
      )}

      {/* Metadata Fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(editingFile || uploadMode === 'google_drive' || queue.length <= 1) && (
          <div className="sm:col-span-2">
            <label htmlFor="file-title" className="block text-xs font-semibold text-[#0B2545] mb-1">
              عنوان الملف *
            </label>
            <input
              id="file-title"
              type="text"
              required={
                Boolean(editingFile) || uploadMode === 'google_drive' || queue.length <= 1
              }
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: المحاضرة الأولى - التفاضل والتكامل (Calculus)"
              className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm text-[#0B2545]"
            />
          </div>
        )}

        <div>
          <label htmlFor="file-category" className="block text-xs font-semibold text-[#0B2545] mb-1">
            تصنيف الملف *
          </label>
          <select
            id="file-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as LectureCategory)}
            className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 text-sm text-[#0B2545]"
          >
            {(Object.keys(LECTURE_CATEGORY_LABELS) as LectureCategory[]).map((key) => (
              <option key={key} value={key}>
                {LECTURE_CATEGORY_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="file-lecnum" className="block text-xs font-semibold text-[#0B2545] mb-1">
            رقم المحاضرة (اختياري)
          </label>
          <input
            id="file-lecnum"
            type="text"
            value={lectureNumber}
            onChange={(e) => setLectureNumber(e.target.value)}
            placeholder="مثال: المحاضرة 1"
            className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm text-[#0B2545]"
          />
        </div>

        <div>
          <label htmlFor="file-version" className="block text-xs font-semibold text-[#0B2545] mb-1">
            الإصدار (اختياري)
          </label>
          <input
            id="file-version"
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="v1.0"
            className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm text-[#0B2545]"
          />
        </div>

        <div>
          <label htmlFor="file-order" className="block text-xs font-semibold text-[#0B2545] mb-1">
            ترتيب العرض
          </label>
          <input
            id="file-order"
            type="number"
            min={1}
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm text-[#0B2545] tabular-nums"
          />
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <label htmlFor="file-desc" className="block text-xs font-semibold text-[#0B2545] mb-1">
            وصف مختصر (اختياري)
          </label>
          <textarea
            id="file-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="ملخص سريع لمحتوى الملف..."
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-[#0B2545]"
          />
        </div>
      </div>

      {/* Status, Download Permission, Notification */}
      <div className="flex flex-wrap items-center gap-6 pt-1">
        <div>
          <label htmlFor="file-status" className="block text-xs font-semibold text-[#0B2545] mb-1">
            حالة النشر
          </label>
          {canPublish ? (
            <select
              id="file-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as PublishStatus)}
              className="min-h-[40px] px-3 rounded-xl border border-slate-200 text-sm text-[#0B2545]"
            >
              <option value="published">منشور للطلاب</option>
              <option value="draft">مسودة (مخفي)</option>
            </select>
          ) : (
            <p className="text-xs font-semibold text-slate-600 bg-[#EAF4F7] px-3 py-2 rounded-xl">
              مسودة — بانتظار اعتماد النشر
            </p>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-[#0B2545] cursor-pointer min-h-[40px]">
          <input
            type="checkbox"
            checked={allowDownload}
            onChange={(e) => setAllowDownload(e.target.checked)}
            className="w-4 h-4 accent-[#00A6A6]"
          />
          السماح للطلاب بتحميل الملف
        </label>

        {!editingFile && canPublish && (
          <label className="flex items-center gap-2 text-sm text-[#0B2545] cursor-pointer min-h-[40px]">
            <input
              type="checkbox"
              checked={emitNotification}
              onChange={(e) => setEmitNotification(e.target.checked)}
              className="w-4 h-4 accent-[#00A6A6]"
            />
            إرسال إشعار للطلاب عند النشر
          </label>
        )}
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl bg-[#FF8066]/10 border border-[#FF8066]/30 px-4 py-3 text-sm text-[#0B2545]"
        >
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div
          role="status"
          className="rounded-xl bg-[#EAF4F7] border border-[#00A6A6]/40 px-4 py-3 text-sm text-[#0B2545] flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-[#00A6A6]" />
          {successMsg}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-xs text-slate-500">
          {completeDestinations.length > 0
            ? `سيتم التوزيع على ${completeDestinations.length} وجهة أكاديمية مع تخزين ملف فيزيائي واحد فقط.`
            : 'اختر التخصصات والمواد أعلاه لتفعيل النشر.'}
        </p>

        <button
          type="submit"
          disabled={
            submitting ||
            (uploadMode === 'upload' && queuedBytes > 0 && !quotaEvaluation.canUpload)
          }
          className="min-h-[46px] px-6 py-2.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-bold inline-flex items-center gap-2 transition-colors disabled:opacity-60"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {editingFile
            ? 'حفظ التعديلات والروابط'
            : uploadMode === 'google_drive'
              ? `نشر إلى البرامج المحددة (${completeDestinations.length})`
              : selectedQueueItems.length > 1
                ? `نشر ${selectedQueueItems.length} ملفات إلى البرامج المحددة (${completeDestinations.length})`
                : `نشر إلى البرامج المحددة (${completeDestinations.length})`}
        </button>
      </div>

      {/* Pre-upload Local Preview Modal (no window.open / window.alert) */}
      {localPreviewItem && localPreviewItem.previewObjectUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`معاينة محلية: ${localPreviewItem.file.name}`}
          className="fixed inset-0 z-50 bg-[#0B2545]/70 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setLocalPreviewItem(null)}
        >
          <div
            className="w-full max-w-4xl h-[82vh] bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 px-5 py-3.5 bg-[#0B2545] text-white">
              <div className="min-w-0">
                <h3 className="font-display text-sm sm:text-base font-bold truncate">
                  معاينة قبل الرفع: {localPreviewItem.file.name}
                </h3>
                <p className="text-[11px] text-white/75 tabular-nums">
                  {formatFileSizeArabic(localPreviewItem.file.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLocalPreviewItem(null)}
                aria-label="إغلاق المعاينة المحلية"
                className="min-h-[36px] min-w-[36px] rounded-lg bg-white/10 hover:bg-[#FF8066] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </header>
            <div className="flex-1 bg-[#EAF4F7] flex items-center justify-center overflow-auto">
              {localPreviewItem.file.type.startsWith('image/') ? (
                <img
                  src={localPreviewItem.previewObjectUrl}
                  alt={localPreviewItem.file.name}
                  className="max-w-full max-h-full object-contain p-4"
                />
              ) : (
                <iframe
                  src={localPreviewItem.previewObjectUrl}
                  title={localPreviewItem.file.name}
                  className="w-full h-full border-0 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
