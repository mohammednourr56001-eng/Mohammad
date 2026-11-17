import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
  RotateCcw,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase.ts';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { usePlatformData } from '../context/PlatformDataContext.tsx';
import {
  DEFAULT_STORAGE_THRESHOLDS,
  LectureCategory,
  LectureFile,
  LECTURE_CATEGORY_LABELS,
  PublishStatus,
} from '../types/academic.ts';
import {
  computeNextSortOrder,
  evaluateStorageQuota,
  formatFileSizeArabic,
  generateSafeId,
  getSemestersForYear,
  getSubjectsForSemester,
  getYearsForSpecialization,
  sortByOrder,
  validateUploadFile,
} from '../utils/academicLogic.ts';

interface QueuedFileItem {
  localId: string;
  file: File;
  title: string;
  status: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';
  progress: number;
  error?: string;
}

export function AdminFileUploader({
  editingFile,
  onSuccess,
  onCancelEdit,
}: {
  editingFile?: LectureFile | null;
  onSuccess: () => void;
  onCancelEdit?: () => void;
}) {
  const { firebaseUser, profile, role, hasPerm, getIdToken } = useAuth();
  const {
    specializations,
    academicYears,
    semesters,
    subjects,
    lectureFiles,
    storageStats,
    settings,
    refreshAdminCatalog,
    refreshStorageStats,
  } = usePlatformData();

  const canPublish = hasPerm('lectures.publish');

  const [specializationId, setSpecializationId] = useState(
    editingFile?.specializationId || ''
  );
  const [academicYearId, setAcademicYearId] = useState(
    editingFile?.academicYearId || ''
  );
  const [semesterId, setSemesterId] = useState(editingFile?.semesterId || '');
  const [subjectId, setSubjectId] = useState(editingFile?.subjectId || '');

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

  const [queue, setQueue] = useState<QueuedFileItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeXhrRef = useRef<XMLHttpRequest | null>(null);

  const sortedSpecs = useMemo(() => sortByOrder(specializations), [specializations]);
  const yearsForSpec = useMemo(
    () =>
      specializationId
        ? getYearsForSpecialization(academicYears, specializationId, true)
        : [],
    [academicYears, specializationId]
  );
  const semestersForYear = useMemo(
    () =>
      specializationId && academicYearId
        ? getSemestersForYear(semesters, specializationId, academicYearId, true)
        : [],
    [semesters, specializationId, academicYearId]
  );
  const subjectsForSemester = useMemo(
    () =>
      specializationId && academicYearId && semesterId
        ? getSubjectsForSemester(
            subjects,
            specializationId,
            academicYearId,
            semesterId,
            true
          )
        : [],
    [subjects, specializationId, academicYearId, semesterId]
  );

  const usedBytes =
    storageStats?.lecturesBytes ??
    lectureFiles.reduce((acc, f) => acc + (Number(f.fileSize) || 0), 0);
  const quotaMB = settings.storageQuotaMB || storageStats?.quotaMB || 1024;
  const queuedBytes = queue
    .filter((q) => q.status === 'queued' || q.status === 'uploading')
    .reduce((acc, q) => acc + q.file.size, 0);

  const quotaEvaluation = evaluateStorageQuota({
    usedBytes,
    incomingBytes: queuedBytes,
    quotaMB,
    thresholds: settings.alertThresholds || DEFAULT_STORAGE_THRESHOLDS,
  });

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
      nextItems.push({
        localId: generateSafeId('q'),
        file,
        title: file.name.replace(/\.[^/.]+$/, ''),
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
      }
    }
  };

  const uploadSingleFile = async (
    item: QueuedFileItem,
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
      xhr.setRequestHeader('x-spec-id', specializationId);
      xhr.setRequestHeader('x-year-id', academicYearId);
      xhr.setRequestHeader('x-semester-id', semesterId);
      xhr.setRequestHeader('x-subject-id', subjectId);

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
      formData.append('specializationId', specializationId);
      formData.append('academicYearId', academicYearId);
      formData.append('semesterId', semesterId);
      formData.append('subjectId', subjectId);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!firebaseUser) {
      setErrorMsg('يجب تسجيل الدخول كمسؤول أو مشرف.');
      return;
    }
    if (!specializationId || !academicYearId || !semesterId || !subjectId) {
      setErrorMsg('يرجى تحديد المسار الأكاديمي الكامل: التخصص، السنة، الفصل، والمادة.');
      return;
    }
    if (!editingFile && queue.filter((q) => q.status === 'queued' || q.status === 'error').length === 0) {
      setErrorMsg('يرجى اختيار ملف واحد على الأقل لرفعه.');
      return;
    }
    if (editingFile && title.trim().length < 2) {
      setErrorMsg('يرجى إدخال عنوان واضح للملف لا يقل عن حرفين.');
      return;
    }

    if (queuedBytes > 0 && !quotaEvaluation.canUpload) {
      setErrorMsg(
        quotaEvaluation.message || 'عذراً، مساحة التخزين المتاحة غير كافية. يرجى مراجعة مسؤول المنصة.'
      );
      return;
    }

    setSubmitting(true);
    const effectiveStatus: PublishStatus = canPublish ? status : 'draft';

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
          const uploaded = await uploadSingleFile(replacementItem, token);
          if (editingFile.storageName && editingFile.storageName !== uploaded.storageName) {
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

        const payload: Record<string, unknown> = {
          id: editingFile.id,
          specializationId,
          academicYearId,
          semesterId,
          subjectId,
          title: title.trim(),
          category,
          fileName: fileMeta.fileName,
          originalName: fileMeta.originalName,
          fileExt: fileMeta.fileExt,
          mimeType: fileMeta.mimeType,
          fileSize: fileMeta.fileSize,
          storageName: fileMeta.storageName,
          allowDownload,
          status: canPublish ? status : editingFile.status,
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
            status: canPublish ? status : editingFile.status,
            specializationId,
            academicYearId,
            semesterId,
            subjectId,
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
            action: 'تعديل ملف محاضرة',
            entityType: 'lectureFile',
            entityId: editingFile.id,
            entityName: title.trim(),
            result: 'success',
          }),
        }).catch(() => {});

        setSuccessMsg('تم تحديث بيانات الملف بنجاح.');
      } else {
        // Multi-file sequential queue upload
        const itemsToProcess = queue.filter((q) => q.status === 'queued' || q.status === 'error');
        let nextOrder = Number(sortOrder) || computeNextSortOrder(lectureFiles);
        let uploadedCount = 0;

        for (let idx = 0; idx < itemsToProcess.length; idx += 1) {
          const item = itemsToProcess[idx];
          const effectiveTitle =
            itemsToProcess.length === 1 && title.trim().length >= 2
              ? title.trim()
              : item.title.trim().length >= 2
                ? item.title.trim()
                : item.file.name;

          try {
            setQueue((prev) =>
              prev.map((q) =>
                q.localId === item.localId ? { ...q, status: 'uploading', error: undefined } : q
              )
            );
            const uploaded = await uploadSingleFile(item, token);
            const fileId = generateSafeId('file');

            const payload: Record<string, unknown> = {
              id: fileId,
              specializationId,
              academicYearId,
              semesterId,
              subjectId,
              title: effectiveTitle,
              category,
              fileName: uploaded.fileName,
              originalName: uploaded.originalName,
              fileExt: uploaded.fileExt,
              mimeType: uploaded.mimeType,
              fileSize: uploaded.fileSize,
              storageName: uploaded.storageName,
              allowDownload,
              status: effectiveStatus,
              sortOrder: nextOrder,
              uploadedBy: firebaseUser.uid,
              uploadedByEmail: firebaseUser.email || '',
              uploadedByName: profile?.displayName || firebaseUser.displayName || '',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            if (uploaded.storagePath) payload.storagePath = uploaded.storagePath;
            if (uploaded.sha256) payload.sha256 = uploaded.sha256;
            if (description.trim()) payload.description = description.trim();
            if (lectureNumber.trim()) payload.lectureNumber = lectureNumber.trim();
            if (version.trim()) payload.version = version.trim();

            await setDoc(doc(db, 'lectureFiles', fileId), payload);

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
                specializationId,
                academicYearId,
                semesterId,
                subjectId,
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
              action: 'رفع ملف محاضرة جديد',
              entityType: 'lectureFile',
              entityId: fileId,
              entityName: effectiveTitle,
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
                action: 'رفع ملف محاضرة جديد',
                entityType: 'lectureFile',
                entityId: fileId,
                entityName: effectiveTitle,
                result: 'success',
              }),
            }).catch(() => {});

            if (emitNotification && effectiveStatus === 'published') {
              const subjectName = subjects.find((s) => s.id === subjectId)?.name || 'مقرر دراسي';
              const notifId = generateSafeId('notif');
              await setDoc(doc(db, 'notifications', notifId), {
                id: notifId,
                title: `ملف جديد في ${subjectName}`,
                message: `تم نشر "${effectiveTitle}" في مادة ${subjectName}.`,
                type: 'lecture',
                specializationId,
                subjectId,
                fileId,
                status: 'published',
                createdAt: serverTimestamp(),
              }).catch(() => {});
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
          setSuccessMsg(`تم رفع وحفظ ${uploadedCount} ملف بنجاح.`);
          setTitle('');
          setDescription('');
          setLectureNumber('');
          setQueue((prev) => prev.filter((q) => q.status === 'error'));
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-[#0B2545]">
            {editingFile ? `تعديل ملف: ${editingFile.title}` : 'رفع ملفات المحاضرات (ملف واحد أو متعدد)'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            الحد الأقصى للملف: {settings.maxFileSizeMB} ميجابايت · الصيغ المفعّلة:{' '}
            {(settings.allowedExtensions || ['pdf', 'docx', 'pptx']).map((e) => e.toUpperCase()).join('، ')}
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

      {/* Quota Warning / Block Alert */}
      {!quotaEvaluation.canUpload && (
        <div
          role="alert"
          className="rounded-2xl bg-[#FF8066] text-white px-4 py-3 text-sm font-semibold flex items-center gap-2.5"
        >
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{quotaEvaluation.message}</span>
        </div>
      )}

      {/* Academic Hierarchy Selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-[#EAF4F7]/65 p-4 rounded-2xl">
        <div>
          <label htmlFor="upload-spec" className="block text-xs font-semibold text-[#0B2545] mb-1">
            1. التخصص *
          </label>
          <select
            id="upload-spec"
            required
            value={specializationId}
            onChange={(e) => {
              setSpecializationId(e.target.value);
              setAcademicYearId('');
              setSemesterId('');
              setSubjectId('');
            }}
            className="w-full min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 text-sm text-[#0B2545]"
          >
            <option value="">اختر التخصص</option>
            {sortedSpecs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="upload-year" className="block text-xs font-semibold text-[#0B2545] mb-1">
            2. السنة الدراسية *
          </label>
          <select
            id="upload-year"
            required
            disabled={!specializationId}
            value={academicYearId}
            onChange={(e) => {
              setAcademicYearId(e.target.value);
              setSemesterId('');
              setSubjectId('');
            }}
            className="w-full min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 text-sm text-[#0B2545] disabled:opacity-50"
          >
            <option value="">اختر السنة</option>
            {yearsForSpec.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="upload-sem" className="block text-xs font-semibold text-[#0B2545] mb-1">
            3. الفصل الدراسي *
          </label>
          <select
            id="upload-sem"
            required
            disabled={!academicYearId}
            value={semesterId}
            onChange={(e) => {
              setSemesterId(e.target.value);
              setSubjectId('');
            }}
            className="w-full min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 text-sm text-[#0B2545] disabled:opacity-50"
          >
            <option value="">اختر الفصل</option>
            {semestersForYear.map((sem) => (
              <option key={sem.id} value={sem.id}>
                {sem.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="upload-sub" className="block text-xs font-semibold text-[#0B2545] mb-1">
            4. المادة الدراسية *
          </label>
          <select
            id="upload-sub"
            required
            disabled={!semesterId}
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="w-full min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 text-sm text-[#0B2545] disabled:opacity-50"
          >
            <option value="">اختر المادة</option>
            {subjectsForSemester.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Drag & Drop Zone (Single or Multiple) */}
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
        className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
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
          أو اضغط لاختيار الملفات من جهازك
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0B2545] hover:bg-[#133866] text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
        >
          <FileUp className="w-4 h-4" />
          تصفح الملفات
        </button>

        {/* Queued Files List with Progress & Cancel */}
        {queue.length > 0 && (
          <div className="mt-4 space-y-2 text-right max-w-2xl mx-auto">
            {queue.map((item) => (
              <div
                key={item.localId}
                className="bg-white border border-slate-200 rounded-xl p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0 flex-1">
                    {!editingFile && queue.length > 1 ? (
                      <input
                        type="text"
                        value={item.title}
                        onChange={(e) =>
                          setQueue((prev) =>
                            prev.map((q) =>
                              q.localId === item.localId ? { ...q, title: e.target.value } : q
                            )
                          )
                        }
                        className="w-full min-h-[32px] px-2 rounded-lg border border-slate-200 font-bold text-[#0B2545]"
                      />
                    ) : (
                      <p className="font-bold text-[#0B2545] truncate">{item.file.name}</p>
                    )}
                    <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                      {item.file.name} · {formatFileSizeArabic(item.file.size)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
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
                              q.localId === item.localId ? { ...q, status: 'queued', error: undefined } : q
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
                        onClick={() =>
                          setQueue((prev) => prev.filter((q) => q.localId !== item.localId))
                        }
                        aria-label="إزالة من القائمة"
                        className="p-1 text-slate-400 hover:text-[#FF8066]"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {item.status === 'uploading' && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-[#0B2545]">
                      <span>جاري الرفع...</span>
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
            ))}
          </div>
        )}

        {queue.length === 0 && editingFile && (
          <p className="mt-3 text-xs text-slate-600">
            الملف الحالي: <span className="font-semibold">{editingFile.originalName}</span> (
            {formatFileSizeArabic(editingFile.fileSize)})
          </p>
        )}
      </div>

      {/* Metadata Fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(editingFile || queue.length <= 1) && (
          <div className="sm:col-span-2">
            <label htmlFor="file-title" className="block text-xs font-semibold text-[#0B2545] mb-1">
              عنوان الملف *
            </label>
            <input
              id="file-title"
              type="text"
              required={Boolean(editingFile) || queue.length <= 1}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: المحاضرة الأولى - مبادئ الفيزياء الطبية"
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
        <div role="alert" className="rounded-xl bg-[#FF8066]/10 border border-[#FF8066]/30 px-4 py-3 text-sm text-[#0B2545]">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div role="status" className="rounded-xl bg-[#EAF4F7] border border-[#00A6A6]/40 px-4 py-3 text-sm text-[#0B2545] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#00A6A6]" />
          {successMsg}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting || (queuedBytes > 0 && !quotaEvaluation.canUpload)}
          className="min-h-[46px] px-6 py-2.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-bold inline-flex items-center gap-2 transition-colors disabled:opacity-60"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {editingFile ? 'حفظ التعديلات' : queue.length > 1 ? `رفع ${queue.length} ملفات` : 'رفع وحفظ الملف'}
        </button>
      </div>
    </form>
  );
}
