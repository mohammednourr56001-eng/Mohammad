export interface ClassroomCourseItem {
  id: string;
  name: string;
  section?: string;
  descriptionHeading?: string;
  courseState?: string;
  alternateLink?: string;
  teacherGroupEmail?: string;
}

export interface ClassroomCourseWorkItem {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  state?: string;
  alternateLink?: string;
  maxPoints?: number;
  dueDateLabel?: string;
}

export interface ClassroomMaterialItem {
  id: string;
  title: string;
  description?: string;
  alternateLink?: string;
}

export interface ClassroomAnnouncementItem {
  id: string;
  text: string;
  updateTime?: string;
  alternateLink?: string;
}

const CLASSROOM_API_BASE = 'https://classroom.googleapis.com/v1';

async function parseClassroomError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) return body.error.message;
  } catch {
    // ignore
  }
  if (res.status === 401 || res.status === 403) {
    return 'لا تملك صلاحية Google Classroom لهذا الإجراء أو أن حسابك مقيد بنطاق المؤسسة.';
  }
  return fallback;
}

export async function listClassroomCourses(
  accessToken: string
): Promise<ClassroomCourseItem[]> {
  const res = await fetch(`${CLASSROOM_API_BASE}/courses?pageSize=25&courseStates=ACTIVE`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(await parseClassroomError(res, 'تعذر جلب مقررات Google Classroom.'));
  }
  const data = (await res.json()) as { courses?: ClassroomCourseItem[] };
  return Array.isArray(data.courses) ? data.courses : [];
}

function formatDueDate(
  dueDate?: { year?: number; month?: number; day?: number },
  dueTime?: { hours?: number; minutes?: number }
): string | undefined {
  if (!dueDate?.year || !dueDate?.month || !dueDate?.day) return undefined;
  const d = `${dueDate.year}-${String(dueDate.month).padStart(2, '0')}-${String(dueDate.day).padStart(2, '0')}`;
  if (typeof dueTime?.hours === 'number') {
    return `${d} · ${String(dueTime.hours).padStart(2, '0')}:${String(dueTime.minutes || 0).padStart(2, '0')}`;
  }
  return d;
}

export async function listClassroomCourseWork(
  accessToken: string,
  courseId: string
): Promise<ClassroomCourseWorkItem[]> {
  const safeId = encodeURIComponent(courseId);
  const res = await fetch(`${CLASSROOM_API_BASE}/courses/${safeId}/courseWork?pageSize=25`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(await parseClassroomError(res, 'تعذر جلب التكليفات والمهام لهذا المقرر.'));
  }
  const data = (await res.json()) as {
    courseWork?: Array<{
      id: string;
      courseId: string;
      title?: string;
      description?: string;
      state?: string;
      alternateLink?: string;
      maxPoints?: number;
      dueDate?: { year?: number; month?: number; day?: number };
      dueTime?: { hours?: number; minutes?: number };
    }>;
  };
  return (data.courseWork || []).map((w) => ({
    id: w.id,
    courseId: w.courseId,
    title: w.title || 'مهمة دراسية',
    description: w.description,
    state: w.state,
    alternateLink: w.alternateLink,
    maxPoints: w.maxPoints,
    dueDateLabel: formatDueDate(w.dueDate, w.dueTime),
  }));
}

export async function listClassroomMaterials(
  accessToken: string,
  courseId: string
): Promise<ClassroomMaterialItem[]> {
  const safeId = encodeURIComponent(courseId);
  const res = await fetch(
    `${CLASSROOM_API_BASE}/courses/${safeId}/courseWorkMaterials?pageSize=20`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { courseWorkMaterials?: ClassroomMaterialItem[] };
  return Array.isArray(data.courseWorkMaterials) ? data.courseWorkMaterials : [];
}

export async function listClassroomAnnouncements(
  accessToken: string,
  courseId: string
): Promise<ClassroomAnnouncementItem[]> {
  const safeId = encodeURIComponent(courseId);
  const res = await fetch(`${CLASSROOM_API_BASE}/courses/${safeId}/announcements?pageSize=15`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { announcements?: ClassroomAnnouncementItem[] };
  return Array.isArray(data.announcements) ? data.announcements : [];
}

export async function createClassroomCourseWork(params: {
  accessToken: string;
  courseId: string;
  title: string;
  description?: string;
  maxPoints?: number;
  dueDateIso?: string;
}): Promise<ClassroomCourseWorkItem> {
  const safeId = encodeURIComponent(params.courseId);
  const payload: Record<string, unknown> = {
    title: params.title.trim(),
    description: params.description?.trim() || undefined,
    workType: 'ASSIGNMENT',
    state: 'PUBLISHED',
  };
  if (typeof params.maxPoints === 'number' && params.maxPoints > 0) {
    payload.maxPoints = params.maxPoints;
  }
  if (params.dueDateIso) {
    const dt = new Date(params.dueDateIso);
    if (!Number.isNaN(dt.getTime())) {
      payload.dueDate = {
        year: dt.getUTCFullYear(),
        month: dt.getUTCMonth() + 1,
        day: dt.getUTCDate(),
      };
      payload.dueTime = {
        hours: dt.getUTCHours(),
        minutes: dt.getUTCMinutes(),
      };
    }
  }

  const res = await fetch(`${CLASSROOM_API_BASE}/courses/${safeId}/courseWork`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(
      await parseClassroomError(
        res,
        'تعذر إنشاء التكليف في Google Classroom. قد يتطلب الحساب صلاحية معلم داخل الصف.'
      )
    );
  }
  const w = (await res.json()) as {
    id: string;
    courseId: string;
    title?: string;
    description?: string;
    state?: string;
    alternateLink?: string;
    maxPoints?: number;
  };
  return {
    id: w.id,
    courseId: w.courseId,
    title: w.title || params.title,
    description: w.description,
    state: w.state,
    alternateLink: w.alternateLink,
    maxPoints: w.maxPoints,
  };
}
