import path from 'path';
import { ExamAttempt, ExamRecord } from '../src/types/academic.ts';
import { generateSafeId } from '../src/utils/academicLogic.ts';
import { cacheLayer } from './cacheLayer.ts';
import { SafeJsonStore } from './safeJsonStore.ts';
import { INDEX_DIR } from './storageManager.ts';

const EXAMS_FILE = path.join(INDEX_DIR, 'exams.json');
const ATTEMPTS_FILE = path.join(INDEX_DIR, 'exam_attempts.json');
const examJsonStore = new SafeJsonStore(INDEX_DIR);

export function flushExamWrites(): Promise<void> {
  return examJsonStore.flushAll();
}

const SEEDED_EXAMS: ExamRecord[] = [
  {
    id: 'exam_ds_trees_midterm',
    specializationId: 'spec_software_eng',
    academicYearId: 'yr_se_2',
    semesterId: 'sem_se_2_1',
    subjectId: 'sub_data_structures',
    subjectName: 'هياكل البيانات والخوارزميات',
    title: 'اختبار تقييمي: التعقيد الزمني والأشجار المتوازنة',
    description: 'اختبار محاكاة عالي الكفاءة يغطي Big-O وخصائص AVL وRed-Black Trees.',
    difficulty: 'medium',
    durationMinutes: 15,
    questionCount: 4,
    source: 'curated',
    status: 'published',
    createdBy: 'system',
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    questions: [
      {
        id: 'q_ds_1',
        type: 'mcq',
        prompt: 'ما هو التعقيد الزمني لعملية البحث في شجرة بحث ثنائية متوازنة (AVL Tree) تحتوي على N عقدة؟',
        options: ['O(1)', 'O(log N)', 'O(N)', 'O(N log N)'],
        correctIndex: 1,
        explanation: 'بفضل التوازن الصارم في شجرة AVL لا يتجاوز ارتفاع الشجرة O(log N)، ما يضمن بحثاً لوغاريتمياً.',
      },
      {
        id: 'q_ds_2',
        type: 'mcq',
        prompt: 'أي من معاملات التوازن (Balance Factor) التالية يعتبر صالحاً لعقدة في شجرة AVL؟',
        options: ['من -1 إلى +1 فقط', 'من -2 إلى +2', 'صفر فقط', 'أي قيمة موجبة'],
        correctIndex: 0,
        explanation: 'شجرة AVL تشترط أن يكون الفرق بين ارتفاع الشجرة الفرعية اليسرى واليمنى في النطاق {-1, 0, +1}.',
      },
      {
        id: 'q_ds_3',
        type: 'true_false',
        prompt: 'التنقل داخل الشجرة بترتيب In-Order Traversal لشجرة بحث ثنائية يُنتج العناصر مرتبة تصاعدياً.',
        options: ['صحيح', 'خطأ'],
        correctIndex: 0,
        explanation: 'المسار (يسار ← جذر ← يمين) في BST يزور القيم بترتيب تصاعدي دائماً.',
      },
      {
        id: 'q_ds_4',
        type: 'mcq',
        prompt: 'في أسوأ الحالات، ما هو التعقيد الزمني لخوارزمية QuickSort عند اختيار محور غير مناسب دون عشوائية؟',
        options: ['O(N)', 'O(N log N)', 'O(N^2)', 'O(log N)'],
        correctIndex: 2,
        explanation: 'عند انحياز التقسيم إلى عنصر واحد مقابل N-1 عنصر يتكرر التقسيم N مرة بتكلفة إجمالية O(N^2).',
      },
    ],
  },
  {
    id: 'exam_calc1_derivatives',
    specializationId: 'spec_biomedical',
    academicYearId: 'yr_bio_1',
    semesterId: 'sem_bio_1_1',
    subjectId: 'sub_calculus_1',
    subjectName: 'حسبان 1',
    title: 'اختبار سريع: النهايات والاتصال والمشتقات',
    description: 'أسئلة تدريبية في التفاضل وتطبيقاته الهندسية والطبية.',
    difficulty: 'easy',
    durationMinutes: 10,
    questionCount: 3,
    source: 'curated',
    status: 'published',
    createdBy: 'system',
    createdAt: '2026-01-20T10:00:00.000Z',
    updatedAt: '2026-01-20T10:00:00.000Z',
    questions: [
      {
        id: 'q_calc_1',
        type: 'mcq',
        prompt: 'ما هي مشتقة الدالة f(x) = 3x^2 + 5x - 2؟',
        options: ['6x + 5', '3x + 5', '6x^2 + 5', '6x - 2'],
        correctIndex: 0,
        explanation: 'بتطبيق قاعدة القوة: مشتقة 3x^2 هي 6x ومشتقة 5x هي 5 ومشتقة الثابت صفر.',
      },
      {
        id: 'q_calc_2',
        type: 'true_false',
        prompt: 'إذا كانت الدالة قابلة للاشتقاق عند نقطة x = a فإنها بالضرورة متصلة عند تلك النقطة.',
        options: ['صحيح', 'خطأ'],
        correctIndex: 0,
        explanation: 'القابلية للاشتقاق تستلزم الاتصال عند النقطة، بينما العكس غير صحيح دائماً.',
      },
      {
        id: 'q_calc_3',
        type: 'mcq',
        prompt: 'ما قيمة النهاية lim(x→0) (sin x / x) بالراديان؟',
        options: ['0', '1', '∞', 'غير موجودة'],
        correctIndex: 1,
        explanation: 'من النهايات المثلثية القياسية أن نهاية sin(x)/x عندما تقترب x من الصفر تساوي 1.',
      },
    ],
  },
];

function readJsonMap<T>(filePath: string): Record<string, T> {
  return examJsonStore.readSync<Record<string, T>>(path.basename(filePath), {});
}

function writeJsonMap<T>(filePath: string, data: Record<string, T>): void {
  void examJsonStore.enqueueWrite(path.basename(filePath), data);
}

export function loadAllExams(): ExamRecord[] {
  const stored = readJsonMap<ExamRecord>(EXAMS_FILE);
  const merged = new Map<string, ExamRecord>();
  for (const ex of SEEDED_EXAMS) {
    merged.set(ex.id, ex);
  }
  for (const ex of Object.values(stored)) {
    merged.set(ex.id, ex);
  }
  return Array.from(merged.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

export function saveExamRecord(exam: ExamRecord): ExamRecord {
  const stored = readJsonMap<ExamRecord>(EXAMS_FILE);
  stored[exam.id] = exam;
  writeJsonMap(EXAMS_FILE, stored);
  cacheLayer.invalidatePattern('exams:');
  return exam;
}

export function sanitizeExamForStudent(exam: ExamRecord): ExamRecord {
  return {
    ...exam,
    questions: exam.questions.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: q.options,
    })),
  };
}

export function getExamById(examId: string): ExamRecord | null {
  return loadAllExams().find((e) => e.id === examId) || null;
}

export function listUserAttempts(userId: string): ExamAttempt[] {
  const all = Object.values(readJsonMap<ExamAttempt>(ATTEMPTS_FILE));
  return all
    .filter((a) => a.userId === userId)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

export function submitExamAttempt(params: {
  exam: ExamRecord;
  userId: string;
  userEmail?: string;
  idempotencyKey: string;
  answers: Record<string, number>;
  durationSeconds: number;
}): { attempt: ExamAttempt; deduplicated: boolean } {
  const safeKey = String(params.idempotencyKey || '').trim().slice(0, 128);
  const attemptsMap = readJsonMap<ExamAttempt>(ATTEMPTS_FILE);

  // Idempotent protection against duplicate or retried submissions
  if (safeKey) {
    const existing = Object.values(attemptsMap).find(
      (a) =>
        a.userId === params.userId &&
        a.examId === params.exam.id &&
        a.idempotencyKey === safeKey
    );
    if (existing) {
      return { attempt: existing, deduplicated: true };
    }
  }

  let score = 0;
  const feedback: NonNullable<ExamAttempt['feedback']> = [];
  for (const q of params.exam.questions) {
    const correctIndex = typeof q.correctIndex === 'number' ? q.correctIndex : 0;
    const rawSelected = params.answers?.[q.id];
    const selectedIndex =
      typeof rawSelected === 'number' && Number.isInteger(rawSelected) ? rawSelected : null;
    const isCorrect = selectedIndex === correctIndex;
    if (isCorrect) score += 1;
    feedback.push({
      questionId: q.id,
      selectedIndex,
      correctIndex,
      isCorrect,
      explanation: q.explanation,
    });
  }

  const totalQuestions = Math.max(1, params.exam.questions.length);
  const percentage = Math.round((score / totalQuestions) * 100);
  const attempt: ExamAttempt = {
    id: generateSafeId('att'),
    examId: params.exam.id,
    examTitle: params.exam.title,
    subjectId: params.exam.subjectId,
    userId: params.userId,
    userEmail: params.userEmail,
    idempotencyKey: safeKey || generateSafeId('idem'),
    answers: params.answers || {},
    score,
    totalQuestions,
    percentage,
    durationSeconds: Math.max(0, Math.min(86400, Math.round(params.durationSeconds || 0))),
    submittedAt: new Date().toISOString(),
    feedback,
  };

  attemptsMap[attempt.id] = attempt;
  writeJsonMap(ATTEMPTS_FILE, attemptsMap);

  return { attempt, deduplicated: false };
}

export function deleteUserExamAttempts(userId: string): number {
  const attemptsMap = readJsonMap<ExamAttempt>(ATTEMPTS_FILE);
  let removed = 0;
  for (const [id, attempt] of Object.entries(attemptsMap)) {
    if (attempt.userId === userId) {
      delete attemptsMap[id];
      removed += 1;
    }
  }
  if (removed > 0) {
    writeJsonMap(ATTEMPTS_FILE, attemptsMap);
  }
  return removed;
}

