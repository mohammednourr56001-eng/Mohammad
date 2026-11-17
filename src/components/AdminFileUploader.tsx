import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  FileUp,
  Loader2,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  addDoc,
  collection,
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
  LectureCategory,
  LectureFile,
  LECTURE_CATEGORY_LABELS,
  PublishStatus,
} from '../types/academic.ts';
import {
  computeNextSortOrder,
  formatFileSizeArabic,
  generateSafeId,
  getSemestersForYear,
  getSubjectsForSemester,
  getYearsForSpecialization,
  sortByOrder,
  validateUploadFile,
} from '../utils/academicLogic.ts';

export function AdminFileUploader({
  editingFile,
  onSuccess,
  onCancelEdit,
}: {
  editingFile?: LectureFile | null;
  onSuccess: () => void;
  onCancelEdit?: () => void;
}) {
  const { firebaseUser, getIdToken } = useAuth();
  const {
    specializations,
    academicYears,
    semesters,
    subjects,
    lectureFiles,
    settings,
    refreshAdminCatalog,
  } = usePlatformData();

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
    editingFile?.status || 'published'
  );
  const [allowDownload, setAllowDownload] = useState<boolean>(
    editingFile ? editingFile.allowDownload : true
  );
  const [emitNotification, setEmitNotification] = useState<boolean>(!editingFile);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileChosen = (file: File | null) => {
    setErrorMsg(null);
    if (!file) return;
    const validation = validateUploadFile({
      fileName: file.name,
      fileSizeBytes: file.size,
      maxFileSizeMB: settings.maxFileSizeMB || 25,
      allowZipUploads: settings.allowZipUploads !== false,
    });
    if (!validation.valid) {
      setErrorMsg(validation.error || 'ملف غير صالح.');
      return;
    }
    setSelectedFile(file);
    if (!title.trim()) {
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      setTitle(baseName);
    }
  };

  const uploadMultipartFile = async (
    file: File,
    token: string
  ): Promise<{
    fileName: string;
    originalName: string;
    fileExt: string;
    mimeType: string;
    fileSize: number;
    storageName: string;
  }> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const pct = Math.round((evt.loaded / evt.total) * 100);
          setUploadProgress(pct);
        }
      };

      xhr.onload = () => {
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

      xhr.onerror = () => reject(new Error('تعذر الاتصال بالخادم أثناء رفع الملف.'));

      const formData = new FormData();
      formData.append('file', file);
      xhr.send(formData);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!firebaseUser) {
      setErrorMsg('يجب تسجيل الدخول كمشرف.');
      return;
    }
    if (!specializationId || !academicYearId || !semesterId || !subjectId) {
      setErrorMsg('يرجى تحديد المسار الأكاديمي الكامل: التخصص، السنة، الفصل، والمادة.');
      return;
    }
    if (title.trim().length < 2) {
      setErrorMsg('يرجى إدخال عنوان واضح للملف لا يقل عن حرفين.');
      return;
    }
    if (!editingFile && !selectedFile) {
      setErrorMsg('يرجى اختيار ملف لرفعه.');
      return;
    }

    setSubmitting(true);
    setUploadProgress(0);

    try {
      const token = await getIdToken();
      if (!token) throw new Error('تعذر التحقق من جلسة المشرف.');

      let fileMeta = editingFile
        ? {
            fileName: editingFile.fileName,
            originalName: editingFile.originalName,
            fileExt: editingFile.fileExt,
            mimeType: editingFile.mimeType,
            fileSize: editingFile.fileSize,
            storageName: editingFile.storageName,
          }
        : null;

      if (selectedFile) {
        const uploaded = await uploadMultipartFile(selectedFile, token);
        // If replacing an existing physical file, clean up old file on server
        if (editingFile?.storageName && editingFile.storageName !== uploaded.storageName) {
          fetch(`/api/files/storage/${encodeURIComponent(editingFile.storageName)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
        fileMeta = uploaded;
      }

      if (!fileMeta) throw new Error('بيانات الملف مفقودة.');

      const fileId = editingFile ? editingFile.id : generateSafeId('file');
      const payload: Record<string, unknown> = {
        id: fileId,
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
        status,
        sortOrder: Number(sortOrder) || 1,
        uploadedBy: editingFile ? editingFile.uploadedBy : firebaseUser.uid,
        updatedAt: serverTimestamp(),
      };

      if (description.trim()) payload.description = description.trim();
      if (lectureNumber.trim()) payload.lectureNumber = lectureNumber.trim();
      if (version.trim()) payload.version = version.trim();

      if (editingFile) {
        await updateDoc(doc(db, 'lectureFiles', fileId), payload);
      } else {
        payload.createdAt = serverTimestamp();
        await setDoc(doc(db, 'lectureFiles', fileId), payload);
      }

      // Keep server file registry synchronized for fast preview & download enforcement
      await fetch('/api/files/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: fileId,
          storageName: fileMeta.storageName,
          originalName: fileMeta.originalName,
          fileName: fileMeta.fileName,
          fileExt: fileMeta.fileExt,
          mimeType: fileMeta.mimeType,
          fileSize: fileMeta.fileSize,
          allowDownload,
          status,
        }),
      }).catch(() => {});

      // Log activity
      const logId = generateSafeId('log');
      await setDoc(doc(db, 'activityLogs', logId), {
        id: logId,
        actorUid: firebaseUser.uid,
        actorEmail: firebaseUser.email || '',
        action: editingFile ? 'تعديل ملف محاضرة' : 'رفع ملف محاضرة جديد',
        entityType: 'lectureFile',
        entityId: fileId,
        entityName: title.trim(),
        createdAt: serverTimestamp(),
      });

      // Emit notification if published and requested
      if (emitNotification && status === 'published') {
        const subjectName = subjects.find((s) => s.id === subjectId)?.name || 'مقرر دراسي';
        const notifId = generateSafeId('notif');
        await setDoc(doc(db, 'notifications', notifId), {
          id: notifId,
          title: `ملف جديد في ${subjectName}`,
          message: `تم نشر "${title.trim()}" في مادة ${subjectName}.`,
          type: 'lecture',
          specializationId,
          subjectId,
          fileId,
          status: 'published',
          createdAt: serverTimestamp(),
        });
      }

      await refreshAdminCatalog();
      setSuccessMsg(
        editingFile
          ? 'تم تحديث بيانات الملف بنجاح.'
          : 'تم رفع الملف وحفظه في قاعدة البيانات بنجاح.'
      );
      if (!editingFile) {
        setTitle('');
        setDescription('');
        setLectureNumber('');
        setSelectedFile(null);
        setUploadProgress(0);
      }
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
            {editingFile ? `تعديل ملف: ${editingFile.title}` : 'رفع ملف جديد'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            الحد الأقصى لحجم الملف: {settings.maxFileSizeMB} ميجابايت · الصيغ المدعومة: PDF, DOCX, PPTX, XLSX, JPG, PNG{settings.allowZipUploads ? ', ZIP' : ''}
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

      {/* Drag & Drop File Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const dropped = e.dataTransfer.files?.[0] || null;
          handleFileChosen(dropped);
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
          className="hidden"
          onChange={(e) => handleFileChosen(e.target.files?.[0] || null)}
        />
        <UploadCloud className="w-10 h-10 mx-auto text-[#00A6A6] mb-2" />
        <p className="text-sm font-semibold text-[#0B2545]">
          {editingFile
            ? 'اسحب ملفاً بديلاً هنا لتحديث الملف الحالي (اختياري)'
            : 'اسحب وأفلت ملف المحاضرة هنا'}
        </p>
        <p className="text-xs text-slate-500 mt-1 mb-3">
          أو اضغط لاختيار ملف من جهازك
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0B2545] hover:bg-[#133866] text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
        >
          <FileUp className="w-4 h-4" />
          تصفح الملفات
        </button>

        {selectedFile && (
          <div className="mt-4 inline-flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs">
            <span className="font-semibold text-[#0B2545]">{selectedFile.name}</span>
            <span className="text-slate-500 tabular-nums">
              {formatFileSizeArabic(selectedFile.size)}
            </span>
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              aria-label="إزالة الملف المختار"
              className="text-slate-400 hover:text-[#FF8066]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {!selectedFile && editingFile && (
          <p className="mt-3 text-xs text-slate-600">
            الملف الحالي: <span className="font-semibold">{editingFile.originalName}</span> (
            {formatFileSizeArabic(editingFile.fileSize)})
          </p>
        )}
      </div>

      {/* Metadata Fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="sm:col-span-2">
          <label htmlFor="file-title" className="block text-xs font-semibold text-[#0B2545] mb-1">
            عنوان الملف *
          </label>
          <input
            id="file-title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثال: المحاضرة الأولى - مبادئ الفيزياء الطبية"
            className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 text-sm text-[#0B2545]"
          />
        </div>

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
          <select
            id="file-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as PublishStatus)}
            className="min-h-[40px] px-3 rounded-xl border border-slate-200 text-sm text-[#0B2545]"
          >
            <option value="published">منشور للطلاب</option>
            <option value="draft">مسودة (مخفي)</option>
          </select>
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

        {!editingFile && (
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

      {/* Upload Progress */}
      {submitting && selectedFile && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs font-semibold text-[#0B2545]">
            <span>جاري رفع الملف...</span>
            <span className="tabular-nums">{uploadProgress}%</span>
          </div>
          <div className="w-full h-2.5 bg-[#EAF4F7] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#00A6A6] transition-all duration-150"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

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
          disabled={submitting}
          className="min-h-[46px] px-6 py-2.5 rounded-xl bg-[#00A6A6] hover:bg-[#008e8e] text-white text-sm font-bold inline-flex items-center gap-2 transition-colors disabled:opacity-60"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {editingFile ? 'حفظ التعديلات' : 'رفع ونشر الملف'}
        </button>
      </div>
    </form>
  );
}
