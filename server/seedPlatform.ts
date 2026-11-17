import fs from 'fs';
import path from 'path';
import { writeSampleLecturePdf } from './pdfGenerator.ts';

export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'lectures');
export const REGISTRY_PATH = path.resolve(process.cwd(), 'uploads', 'file-registry.json');

export interface FileRegistryEntry {
  id: string;
  storageName: string;
  storagePath?: string;
  sha256?: string;
  originalName: string;
  fileName: string;
  fileExt: string;
  mimeType: string;
  fileSize: number;
  allowDownload: boolean;
  status: 'published' | 'draft';
  specializationId?: string;
  academicYearId?: string;
  semesterId?: string;
  subjectId?: string;
  title?: string;
  uploadedBy?: string;
  uploadedByEmail?: string;
}

interface SeedPdfBlueprint {
  storageName: string;
  courseTitle: string;
  lectureTitle: string;
  department: string;
  sections: string[];
}

const SEED_PDFS: SeedPdfBlueprint[] = [
  {
    storageName: 'seed-bme-physics-ch1.pdf',
    courseTitle: 'Medical Physics I (ALFIZYA)',
    lectureTitle: 'Lecture 01: Biomechanics, Forces & Equilibrium in Human Tissue',
    department: 'Biomedical Engineering - Year 1 / Semester 1',
    sections: [
      '1. Introduction to Statics and Dynamic Equilibrium in Musculoskeletal Systems',
      '2. Lever Classes in the Human Body: Elbow Flexion and Achilles Tendon Mechanics',
      '3. Stress, Strain, Youngs Modulus and Bone Fracture Thresholds',
      '4. Fluid Pressure, Poiseuille Law and Arterial Blood Flow Modeling',
      '5. Practice Problems and UST Midterm Reference Equations',
    ],
  },
  {
    storageName: 'seed-bme-physics-summary.pdf',
    courseTitle: 'Medical Physics I',
    lectureTitle: 'Formula Sheet & Midterm Summary: Waves, Optics & Ultrasound',
    department: 'Biomedical Engineering - Year 1 / Semester 1',
    sections: [
      '1. Acoustic Impedance Z = rho * c and Reflection Coefficient Calculations',
      '2. Doppler Shift Principles in Diagnostic Echocardiography',
      '3. X-Ray Attenuation Law: I = I0 * exp(-mu * x)',
      '4. Worked Exam Questions from Previous UST Semesters',
    ],
  },
  {
    storageName: 'seed-bme-calculus-ch1.pdf',
    courseTitle: 'Engineering Calculus I (Al-Hisban)',
    lectureTitle: 'Lecture 01: Limits, Continuity & Derivatives for Physiological Models',
    department: 'Biomedical Engineering - Year 1 / Semester 1',
    sections: [
      '1. Formal Epsilon-Delta Definition of Limits and Continuity',
      '2. Differentiation Rules: Chain Rule, Implicit & Logarithmic Differentiation',
      '3. Rates of Change in Pharmacokinetics and Drug Decay Curves',
      '4. Problem Set 01 with Step-by-Step Solutions',
    ],
  },
  {
    storageName: 'seed-bme-intro-ch1.pdf',
    courseTitle: 'Introduction to Biomedical Engineering',
    lectureTitle: 'Lecture 01: Overview of Medical Devices & Biosensors',
    department: 'Biomedical Engineering - Year 1 / Semester 1',
    sections: [
      '1. Role of the Biomedical Engineer in Clinical Environments',
      '2. Biopotential Electrodes: ECG, EEG, and EMG Signal Acquisition',
      '3. ISO 13485 Medical Device Safety and Regulatory Standards',
    ],
  },
  {
    storageName: 'seed-civil-mechanics-ch1.pdf',
    courseTitle: 'Engineering Mechanics & Materials',
    lectureTitle: 'Lecture 01: Axial Load, Shear Stress & Truss Equilibrium',
    department: 'Civil Engineering - Year 2 / Semester 1',
    sections: [
      '1. Free Body Diagrams and Method of Joints for Planar Trusses',
      '2. Normal Stress, Shear Stress and Factor of Safety Design',
      '3. Bending Moment and Shear Force Diagrams in Simply Supported Beams',
    ],
  },
  {
    storageName: 'seed-se-structures-ch1.pdf',
    courseTitle: 'Data Structures & Algorithms',
    lectureTitle: 'Lecture 01: Asymptotic Complexity, Trees & Graph Traversal',
    department: 'Software Engineering - Year 2 / Semester 1',
    sections: [
      '1. Big-O, Omega and Theta Notation Analysis',
      '2. Balanced Binary Search Trees (AVL & Red-Black Invariants)',
      '3. Breadth-First Search (BFS) and Dijkstra Shortest Path Applications',
    ],
  },
];

export function ensureSeedPdfFilesOnDisk(): Record<string, number> {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const sizes: Record<string, number> = {};
  for (const item of SEED_PDFS) {
    const fullPath = path.join(UPLOAD_DIR, item.storageName);
    if (!fs.existsSync(fullPath)) {
      sizes[item.storageName] = writeSampleLecturePdf(fullPath, item);
    } else {
      sizes[item.storageName] = fs.statSync(fullPath).size;
    }
  }
  return sizes;
}

export function getInitialCatalog() {
  const sizes = ensureSeedPdfFilesOnDisk();

  const specializations = [
    {
      id: 'spec_bme',
      name: 'الهندسة الطبية الحيوية',
      description: 'قسم المحاضرات والمقررات الطبية والهندسية لتخصص الهندسة الطبية الحيوية.',
      iconKey: 'stethoscope',
      status: 'published',
      sortOrder: 1,
    },
    {
      id: 'spec_civil',
      name: 'الهندسة المدنية',
      description: 'مقررات الإنشاءات، المساحة، ميكانيكا التربة والمواد الهندسية.',
      iconKey: 'crane',
      status: 'published',
      sortOrder: 2,
    },
    {
      id: 'spec_se',
      name: 'هندسة البرمجيات',
      description: 'مقررات الخوارزميات، هندسة النظم، قواعد البيانات وتطوير التطبيقات.',
      iconKey: 'laptop',
      status: 'published',
      sortOrder: 3,
    },
    {
      id: 'spec_cs',
      name: 'علوم الحاسوب',
      description: 'الذكاء الاصطناعي، أنظمة التشغيل، الشبكات والأمن السيبراني.',
      iconKey: 'cpu',
      status: 'published',
      sortOrder: 4,
    },
    {
      id: 'spec_ee',
      name: 'الهندسة الكهربائية',
      description: 'الدوائر الكهربائية، الإلكترونيات، التحكم الآلي وأنظمة القوى.',
      iconKey: 'zap',
      status: 'published',
      sortOrder: 5,
    },
    {
      id: 'spec_arch',
      name: 'الهندسة المعمارية',
      description: 'التصميم المعماري، التخطيط الحضري ونظريات العمارة الحديثة.',
      iconKey: 'compass',
      status: 'published',
      sortOrder: 6,
    },
  ];

  const academicYears = [
    { id: 'yr_bme_1', specializationId: 'spec_bme', name: 'السنة الأولى', status: 'published', sortOrder: 1 },
    { id: 'yr_bme_2', specializationId: 'spec_bme', name: 'السنة الثانية', status: 'published', sortOrder: 2 },
    { id: 'yr_bme_3', specializationId: 'spec_bme', name: 'السنة الثالثة', status: 'published', sortOrder: 3 },
    { id: 'yr_bme_4', specializationId: 'spec_bme', name: 'السنة الرابعة', status: 'published', sortOrder: 4 },
    { id: 'yr_bme_5', specializationId: 'spec_bme', name: 'السنة الخامسة', status: 'published', sortOrder: 5 },

    { id: 'yr_civil_1', specializationId: 'spec_civil', name: 'السنة الأولى', status: 'published', sortOrder: 1 },
    { id: 'yr_civil_2', specializationId: 'spec_civil', name: 'السنة الثانية', status: 'published', sortOrder: 2 },
    { id: 'yr_civil_3', specializationId: 'spec_civil', name: 'السنة الثالثة', status: 'published', sortOrder: 3 },
    { id: 'yr_civil_4', specializationId: 'spec_civil', name: 'السنة الرابعة', status: 'published', sortOrder: 4 },

    { id: 'yr_se_1', specializationId: 'spec_se', name: 'السنة الأولى', status: 'published', sortOrder: 1 },
    { id: 'yr_se_2', specializationId: 'spec_se', name: 'السنة الثانية', status: 'published', sortOrder: 2 },
    { id: 'yr_se_3', specializationId: 'spec_se', name: 'السنة الثالثة', status: 'published', sortOrder: 3 },
    { id: 'yr_se_4', specializationId: 'spec_se', name: 'السنة الرابعة', status: 'published', sortOrder: 4 },
  ];

  const semesters = [
    { id: 'sem_bme_1_1', specializationId: 'spec_bme', academicYearId: 'yr_bme_1', name: 'الفصل الدراسي الأول', status: 'published', sortOrder: 1 },
    { id: 'sem_bme_1_2', specializationId: 'spec_bme', academicYearId: 'yr_bme_1', name: 'الفصل الدراسي الثاني', status: 'published', sortOrder: 2 },
    { id: 'sem_bme_2_1', specializationId: 'spec_bme', academicYearId: 'yr_bme_2', name: 'الفصل الدراسي الأول', status: 'published', sortOrder: 1 },
    { id: 'sem_bme_2_2', specializationId: 'spec_bme', academicYearId: 'yr_bme_2', name: 'الفصل الدراسي الثاني', status: 'published', sortOrder: 2 },
    { id: 'sem_bme_2_3', specializationId: 'spec_bme', academicYearId: 'yr_bme_2', name: 'الفصل الصيفي', status: 'published', sortOrder: 3 },

    { id: 'sem_civil_2_1', specializationId: 'spec_civil', academicYearId: 'yr_civil_2', name: 'الفصل الدراسي الأول', status: 'published', sortOrder: 1 },
    { id: 'sem_civil_2_2', specializationId: 'spec_civil', academicYearId: 'yr_civil_2', name: 'الفصل الدراسي الثاني', status: 'published', sortOrder: 2 },

    { id: 'sem_se_2_1', specializationId: 'spec_se', academicYearId: 'yr_se_2', name: 'الفصل الدراسي الأول', status: 'published', sortOrder: 1 },
    { id: 'sem_se_2_2', specializationId: 'spec_se', academicYearId: 'yr_se_2', name: 'الفصل الدراسي الثاني', status: 'published', sortOrder: 2 },
  ];

  const subjects = [
    {
      id: 'sub_bme_calc',
      specializationId: 'spec_bme',
      academicYearId: 'yr_bme_1',
      semesterId: 'sem_bme_1_1',
      name: 'الحسبان',
      description: 'مبادئ التفاضل والتكامل وتطبيقاتها في النمذجة الهندسية والحيوية.',
      iconKey: 'calculator',
      status: 'published',
      sortOrder: 1,
    },
    {
      id: 'sub_bme_phys',
      specializationId: 'spec_bme',
      academicYearId: 'yr_bme_1',
      semesterId: 'sem_bme_1_1',
      name: 'الفيزياء',
      description: 'الفيزياء الطبية، الميكانيكا الحيوية، الموجات فوق الصوتية والبصريات.',
      iconKey: 'atom',
      status: 'published',
      sortOrder: 2,
    },
    {
      id: 'sub_bme_intro',
      specializationId: 'spec_bme',
      academicYearId: 'yr_bme_1',
      semesterId: 'sem_bme_1_1',
      name: 'مقدمة الهندسة الطبية الحيوية',
      description: 'مدخل شامل للأجهزة الطبية، المستشعرات الحيوية ومعايير السلامة.',
      iconKey: 'heart-pulse',
      status: 'published',
      sortOrder: 3,
    },
    {
      id: 'sub_bme_chem',
      specializationId: 'spec_bme',
      academicYearId: 'yr_bme_1',
      semesterId: 'sem_bme_1_1',
      name: 'الكيمياء الحيوية',
      description: 'التفاعلات الكيميائية الحيوية، البروتينات والإنزيمات الخلوية.',
      iconKey: 'flask',
      status: 'published',
      sortOrder: 4,
    },
    {
      id: 'sub_bme_anatomy',
      specializationId: 'spec_bme',
      academicYearId: 'yr_bme_1',
      semesterId: 'sem_bme_1_2',
      name: 'التشريح ووظائف الأعضاء',
      description: 'دراسة أجهزة جسم الإنسان والربط مع القياسات الحيوية.',
      iconKey: 'activity',
      status: 'published',
      sortOrder: 1,
    },
    {
      id: 'sub_civil_mech',
      specializationId: 'spec_civil',
      academicYearId: 'yr_civil_2',
      semesterId: 'sem_civil_2_1',
      name: 'ميكانيكا المواد',
      description: 'تحليل الإجهادات والانفعالات في العناصر الإنشائية.',
      iconKey: 'layers',
      status: 'published',
      sortOrder: 1,
    },
    {
      id: 'sub_civil_surv',
      specializationId: 'spec_civil',
      academicYearId: 'yr_civil_2',
      semesterId: 'sem_civil_2_1',
      name: 'المساحة الهندسية',
      description: 'القياسات المساحية، التسوية الهندسية وأجهزة التوتال ستيشن.',
      iconKey: 'compass',
      status: 'published',
      sortOrder: 2,
    },
    {
      id: 'sub_se_ds',
      specializationId: 'spec_se',
      academicYearId: 'yr_se_2',
      semesterId: 'sem_se_2_1',
      name: 'هياكل البيانات والخوارزميات',
      description: 'تصميم وتحليل الخوارزميات، الأشجار المتوازنة والرسوم البيانية.',
      iconKey: 'code',
      status: 'published',
      sortOrder: 1,
    },
  ];

  const lectureFiles = [
    {
      id: 'file_bme_phys_01',
      specializationId: 'spec_bme',
      academicYearId: 'yr_bme_1',
      semesterId: 'sem_bme_1_1',
      subjectId: 'sub_bme_phys',
      title: 'المحاضرة الأولى: الميكانيكا الحيوية وتوازن القوى',
      description: 'شرح شامل لمبادئ الاتزان والروافع في الجهاز العضلي الهيكلي وتطبيقات الضغط في الأوعية الدموية.',
      category: 'lectures_pdf',
      lectureNumber: 'المحاضرة 1',
      version: 'v1.0',
      fileName: 'bme-physics-lecture-01.pdf',
      originalName: 'bme-physics-lecture-01.pdf',
      fileExt: 'pdf',
      mimeType: 'application/pdf',
      fileSize: sizes['seed-bme-physics-ch1.pdf'] || 2400,
      storageName: 'seed-bme-physics-ch1.pdf',
      allowDownload: true,
      status: 'published',
      sortOrder: 1,
      uploadedBy: 'system_bootstrap',
    },
    {
      id: 'file_bme_phys_02',
      specializationId: 'spec_bme',
      academicYearId: 'yr_bme_1',
      semesterId: 'sem_bme_1_1',
      subjectId: 'sub_bme_phys',
      title: 'ملخص القوانين والاختبارات السابقة: الموجات والأشعة',
      description: 'مذكرة مركزة لقوانين الأمواج فوق الصوتية وتوهين الأشعة السينية مع نماذج امتحانية محلولة.',
      category: 'summaries',
      lectureNumber: 'ملخص شامل',
      version: 'v2.1',
      fileName: 'bme-physics-midterm-summary.pdf',
      originalName: 'bme-physics-midterm-summary.pdf',
      fileExt: 'pdf',
      mimeType: 'application/pdf',
      fileSize: sizes['seed-bme-physics-summary.pdf'] || 2200,
      storageName: 'seed-bme-physics-summary.pdf',
      allowDownload: true,
      status: 'published',
      sortOrder: 2,
      uploadedBy: 'system_bootstrap',
    },
    {
      id: 'file_bme_calc_01',
      specializationId: 'spec_bme',
      academicYearId: 'yr_bme_1',
      semesterId: 'sem_bme_1_1',
      subjectId: 'sub_bme_calc',
      title: 'المحاضرة الأولى: النهايات والاتصال والمشتقات',
      description: 'تأسيس رياضي للتفاضل وتطبيقاته في منحنيات امتصاص الدواء والنماذج الفسيولوجية.',
      category: 'lectures_pdf',
      lectureNumber: 'المحاضرة 1',
      version: 'v1.0',
      fileName: 'bme-calculus-lecture-01.pdf',
      originalName: 'bme-calculus-lecture-01.pdf',
      fileExt: 'pdf',
      mimeType: 'application/pdf',
      fileSize: sizes['seed-bme-calculus-ch1.pdf'] || 2300,
      storageName: 'seed-bme-calculus-ch1.pdf',
      allowDownload: true,
      status: 'published',
      sortOrder: 1,
      uploadedBy: 'system_bootstrap',
    },
    {
      id: 'file_bme_intro_01',
      specializationId: 'spec_bme',
      academicYearId: 'yr_bme_1',
      semesterId: 'sem_bme_1_1',
      subjectId: 'sub_bme_intro',
      title: 'مدخل إلى الأجهزة الطبية والمستشعرات الحيوية',
      description: 'تعريف بمهام مهندس المعدات الطبية وتخطيط الإشارات القلبية والعصبية.',
      category: 'notes',
      lectureNumber: 'مذكرة 1',
      version: 'v1.0',
      fileName: 'bme-intro-biosensors.pdf',
      originalName: 'bme-intro-biosensors.pdf',
      fileExt: 'pdf',
      mimeType: 'application/pdf',
      fileSize: sizes['seed-bme-intro-ch1.pdf'] || 2100,
      storageName: 'seed-bme-intro-ch1.pdf',
      allowDownload: true,
      status: 'published',
      sortOrder: 1,
      uploadedBy: 'system_bootstrap',
    },
    {
      id: 'file_civil_mech_01',
      specializationId: 'spec_civil',
      academicYearId: 'yr_civil_2',
      semesterId: 'sem_civil_2_1',
      subjectId: 'sub_civil_mech',
      title: 'تحليل الجملونات وإجهادات القص والانحناء',
      description: 'أمثلة تصميمية محلولة في ميكانيكا المواد وتحليل العوارض الإنشائية.',
      category: 'lectures_pdf',
      lectureNumber: 'المحاضرة 1',
      version: 'v1.0',
      fileName: 'civil-mechanics-lecture-01.pdf',
      originalName: 'civil-mechanics-lecture-01.pdf',
      fileExt: 'pdf',
      mimeType: 'application/pdf',
      fileSize: sizes['seed-civil-mechanics-ch1.pdf'] || 2100,
      storageName: 'seed-civil-mechanics-ch1.pdf',
      allowDownload: true,
      status: 'published',
      sortOrder: 1,
      uploadedBy: 'system_bootstrap',
    },
    {
      id: 'file_se_ds_01',
      specializationId: 'spec_se',
      academicYearId: 'yr_se_2',
      semesterId: 'sem_se_2_1',
      subjectId: 'sub_se_ds',
      title: 'تحليل التعقيد الزمني والأشجار المتوازنة',
      description: 'دراسة Big-O وخوارزميات البحث والترتيب ومسار ديكسترا.',
      category: 'lectures_pdf',
      lectureNumber: 'المحاضرة 1',
      version: 'v1.0',
      fileName: 'se-datastructures-lecture-01.pdf',
      originalName: 'se-datastructures-lecture-01.pdf',
      fileExt: 'pdf',
      mimeType: 'application/pdf',
      fileSize: sizes['seed-se-structures-ch1.pdf'] || 2100,
      storageName: 'seed-se-structures-ch1.pdf',
      allowDownload: true,
      status: 'published',
      sortOrder: 1,
      uploadedBy: 'system_bootstrap',
    },
  ];

  const announcements = [
    {
      id: 'ann_01',
      title: 'إطلاق النسخة المحدثة من منصة UST للمحاضرات',
      body: 'تم تنظيم كافة التخصصات والسنوات الدراسية والفصول والمقررات لتسهيل الوصول إلى المحاضرات والملخصات والاختبارات السابقة مع إمكانية المعاينة المباشرة لملفات PDF.',
      category: 'academic',
      priority: 'important',
      status: 'published',
      createdBy: 'system_bootstrap',
    },
    {
      id: 'ann_02',
      title: 'جدول اختبارات منتصف الفصل — كلية الهندسة',
      body: 'يرجى من طلبة الهندسة الطبية الحيوية والمدنية وهندسة البرمجيات مراجعة قسم الاختبارات السابقة والملخصات المعتمدة قبل موعد الامتحانات.',
      category: 'exams',
      priority: 'important',
      specializationId: 'spec_bme',
      status: 'published',
      createdBy: 'system_bootstrap',
    },
  ];

  const notifications = [
    {
      id: 'notif_01',
      title: 'محاضرة جديدة في الفيزياء',
      message: 'تم رفع ونشر محاضرة الميكانيكا الحيوية وتوازن القوى (PDF) لتخصص الهندسة الطبية الحيوية - السنة الأولى.',
      type: 'lecture',
      specializationId: 'spec_bme',
      subjectId: 'sub_bme_phys',
      fileId: 'file_bme_phys_01',
      status: 'published',
    },
    {
      id: 'notif_02',
      title: 'ملخص شامل للاختبار النصفي',
      message: 'تم إضافة ملخص القوانين والاختبارات السابقة لمادة الفيزياء الطبية مع إتاحة التحميل المباشر.',
      type: 'lecture',
      specializationId: 'spec_bme',
      subjectId: 'sub_bme_phys',
      fileId: 'file_bme_phys_02',
      status: 'published',
    },
  ];

  return {
    specializations,
    academicYears,
    semesters,
    subjects,
    lectureFiles,
    announcements,
    notifications,
  };
}

export function loadFileRegistry(): Record<string, FileRegistryEntry> {
  const catalog = getInitialCatalog();
  const base: Record<string, FileRegistryEntry> = {};
  for (const f of catalog.lectureFiles) {
    base[f.id] = {
      id: f.id,
      storageName: f.storageName,
      originalName: f.originalName,
      fileName: f.fileName,
      fileExt: f.fileExt,
      mimeType: f.mimeType,
      fileSize: f.fileSize,
      allowDownload: f.allowDownload,
      status: f.status as 'published' | 'draft',
    };
  }
  try {
    if (fs.existsSync(REGISTRY_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')) as Record<
        string,
        FileRegistryEntry
      >;
      return { ...base, ...parsed };
    }
  } catch {
    // ignore corrupt registry
  }
  return base;
}

export function upsertFileRegistryEntry(entry: FileRegistryEntry): void {
  const current = loadFileRegistry();
  current[entry.id] = entry;
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(current, null, 2), 'utf8');
}

export function removeFileRegistryEntry(fileId: string): void {
  const current = loadFileRegistry();
  delete current[fileId];
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(current, null, 2), 'utf8');
}
