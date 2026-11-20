import {
  AcademicYear,
  DuplicateMatchInfo,
  FileDestinationInput,
  FileLifecycleStatus,
  LectureCategory,
  LectureFile,
  LectureFileLink,
  ProgramCourseLink,
  PublishStatus,
  Semester,
  Specialization,
  Subject,
} from '../types/academic.ts';
import {
  CoursePlacement,
  formatFileSizeArabic,
  generateSafeId,
  getCategoryLabel,
  getEffectiveCoursePlacements,
  isGoogleDriveFile,
  sortByOrder,
} from './academicLogic.ts';

export const CENTRAL_UNLINKED_MARKER = 'central_unlinked';

export interface ResolvedDestination {
  linkId?: string;
  isLegacyFallback: boolean;
  specializationId: string;
  academicYearId: string;
  semesterId: string;
  subjectId: string;
  status: PublishStatus;
  sortOrder: number;
}

export type LibraryEffectiveStatus = 'linked' | 'unlinked' | 'needs_review' | 'trashed';

export interface CentralLibraryRowMeta {
  file: LectureFile;
  effectiveStatus: LibraryEffectiveStatus;
  destinations: ResolvedDestination[];
  uniqueSpecializationIds: string[];
  uniqueSubjectIds: string[];
  isDuplicate: boolean;
  duplicateGroupSignature?: string;
}

export interface CentralLibraryFilterState {
  query: string;
  specializationId: string;
  academicYearId: string;
  semesterId: string;
  subjectId: string;
  category: LectureCategory | 'all';
  fileExt: string;
  uploaderUid: string;
  lifecycleFilter: 'all' | 'linked' | 'unlinked' | 'needs_review' | 'trashed' | 'duplicates';
  dateFrom: string;
  dateTo: string;
}

export interface CentralLibraryKpis {
  totalFiles: number;
  activeFiles: number;
  linkedFiles: number;
  unlinkedFiles: number;
  needsReviewFiles: number;
  trashedFiles: number;
  totalLinks: number;
  duplicateGroupsCount: number;
  totalStorageBytes: number;
  recoverableDuplicateBytes: number;
}

export async function computeBrowserFileSha256(file: Blob): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    return '';
  }
  const buffer = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isFileTrashed(file?: Partial<LectureFile> | null): boolean {
  return file?.lifecycleStatus === 'trashed';
}

export function extractTimestampMs(raw: unknown): number {
  if (!raw) return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof raw === 'object' && raw !== null) {
    if ('seconds' in raw) {
      return Number((raw as { seconds: number }).seconds) * 1000;
    }
    if ('toDate' in raw && typeof (raw as { toDate: () => Date }).toDate === 'function') {
      return (raw as { toDate: () => Date }).toDate().getTime();
    }
  }
  return 0;
}

/**
 * Resolves all active academic destinations where a lecture file appears.
 * - If explicit `lectureFileLinks` exist for `file.id`, they are authoritative.
 * - If no explicit links exist and file is not marked `central_unlinked`,
 *   falls back cleanly to canonical/shared `programCourses` placements for backward compatibility.
 */
export function getFileDestinations(params: {
  file: LectureFile;
  links: LectureFileLink[];
  subjects: Subject[];
  programCourses?: ProgramCourseLink[];
  includeDrafts?: boolean;
}): ResolvedDestination[] {
  const { file, links, subjects, programCourses = [], includeDrafts = true } = params;
  const fileLinks = links.filter((l) => l.lectureFileId === file.id);

  if (fileLinks.length > 0) {
    const dedup = new Map<string, ResolvedDestination>();
    for (const link of fileLinks) {
      if (!includeDrafts && link.status !== 'published') continue;
      const key = `${link.specializationId}::${link.academicYearId}::${link.semesterId}::${link.subjectId}`;
      dedup.set(key, {
        linkId: link.id,
        isLegacyFallback: false,
        specializationId: link.specializationId,
        academicYearId: link.academicYearId,
        semesterId: link.semesterId,
        subjectId: link.subjectId,
        status: link.status,
        sortOrder: link.sortOrder,
      });
    }
    return Array.from(dedup.values());
  }

  if (file.specializationId === CENTRAL_UNLINKED_MARKER || !file.subjectId || file.subjectId === CENTRAL_UNLINKED_MARKER) {
    return [];
  }

  const course = subjects.find((s) => s.id === file.subjectId);
  if (!course) {
    if (!includeDrafts && file.status !== 'published') return [];
    return [
      {
        isLegacyFallback: true,
        specializationId: file.specializationId,
        academicYearId: file.academicYearId,
        semesterId: file.semesterId,
        subjectId: file.subjectId,
        status: file.status,
        sortOrder: file.sortOrder,
      },
    ];
  }

  const placements: CoursePlacement[] = getEffectiveCoursePlacements(course, programCourses, includeDrafts);
  if (placements.length === 0) {
    if (!includeDrafts && file.status !== 'published') return [];
    return [
      {
        isLegacyFallback: true,
        specializationId: file.specializationId,
        academicYearId: file.academicYearId,
        semesterId: file.semesterId,
        subjectId: file.subjectId,
        status: file.status,
        sortOrder: file.sortOrder,
      },
    ];
  }

  return placements.map((p) => ({
    isLegacyFallback: true,
    specializationId: p.specializationId,
    academicYearId: p.academicYearId,
    semesterId: p.semesterId,
    subjectId: course.id,
    status: p.status === 'published' && file.status === 'published' ? 'published' : 'draft',
    sortOrder: file.sortOrder,
  }));
}

/**
 * Resolves deduplicated lecture files for a specific student/admin destination:
 * `(specializationId, academicYearId, semesterId, subjectId)`.
 */
export function getFilesForDestination(params: {
  files: LectureFile[];
  links: LectureFileLink[];
  specializationId: string;
  academicYearId: string;
  semesterId: string;
  subjectId: string;
  includeDrafts?: boolean;
}): LectureFile[] {
  const {
    files,
    links,
    specializationId,
    academicYearId,
    semesterId,
    subjectId,
    includeDrafts = false,
  } = params;

  const fileIdsWithExplicitLinks = new Set(links.map((l) => l.lectureFileId));
  const linkSortByFileId = new Map<string, number>();

  for (const link of links) {
    if (
      link.specializationId === specializationId &&
      link.academicYearId === academicYearId &&
      link.semesterId === semesterId &&
      link.subjectId === subjectId &&
      (includeDrafts || link.status === 'published')
    ) {
      const prev = linkSortByFileId.get(link.lectureFileId);
      if (prev === undefined || link.sortOrder < prev) {
        linkSortByFileId.set(link.lectureFileId, link.sortOrder);
      }
    }
  }

  const matched = new Map<string, LectureFile>();

  for (const file of files) {
    if (isFileTrashed(file)) continue;
    if (!includeDrafts && file.status !== 'published') continue;

    if (fileIdsWithExplicitLinks.has(file.id)) {
      if (linkSortByFileId.has(file.id)) {
        matched.set(file.id, {
          ...file,
          sortOrder: linkSortByFileId.get(file.id) ?? file.sortOrder,
        });
      }
    } else if (
      file.specializationId !== CENTRAL_UNLINKED_MARKER &&
      file.subjectId === subjectId
    ) {
      matched.set(file.id, file);
    }
  }

  return sortByOrder(Array.from(matched.values()));
}

/**
 * Counts files visible inside a subject (optionally scoped to exact program placement).
 */
export function countFilesForDestination(params: {
  files: LectureFile[];
  links?: LectureFileLink[];
  specializationId?: string;
  academicYearId?: string;
  semesterId?: string;
  subjectId: string;
  includeDrafts?: boolean;
}): number {
  const {
    files,
    links = [],
    specializationId,
    academicYearId,
    semesterId,
    subjectId,
    includeDrafts = false,
  } = params;

  if (specializationId && academicYearId && semesterId) {
    return getFilesForDestination({
      files,
      links,
      specializationId,
      academicYearId,
      semesterId,
      subjectId,
      includeDrafts,
    }).length;
  }

  const fileIdsWithExplicitLinks = new Set(links.map((l) => l.lectureFileId));
  const matchedIds = new Set<string>();

  for (const link of links) {
    if (link.subjectId === subjectId && (includeDrafts || link.status === 'published')) {
      matchedIds.add(link.lectureFileId);
    }
  }

  return files.filter((file) => {
    if (isFileTrashed(file)) return false;
    if (!includeDrafts && file.status !== 'published') return false;
    if (fileIdsWithExplicitLinks.has(file.id)) {
      return matchedIds.has(file.id);
    }
    return file.specializationId !== CENTRAL_UNLINKED_MARKER && file.subjectId === subjectId;
  }).length;
}

/**
 * Smart duplicate detection by SHA-256 content hash first.
 * Never treats two files with different content as duplicates just because their filenames match.
 * Conversely, detects identical files even if uploaded with different filenames.
 */
export function findDuplicateMatchForFile(params: {
  sha256?: string;
  fileSize: number;
  fileName: string;
  existingFiles: LectureFile[];
  links?: LectureFileLink[];
}): DuplicateMatchInfo | null {
  const { sha256, fileSize, fileName, existingFiles, links = [] } = params;
  const cleanHash = (sha256 || '').trim().toLowerCase();
  const activeFiles = existingFiles.filter((f) => !isFileTrashed(f) && !isGoogleDriveFile(f));

  if (cleanHash) {
    const exactShaMatch = activeFiles.find(
      (f) => (f.sha256 || '').trim().toLowerCase() === cleanHash
    );
    if (exactShaMatch) {
      const count = countDestinationsForFile(exactShaMatch, links);
      return {
        matchType: 'sha256_exact',
        file: exactShaMatch,
        destinationsCount: count,
      };
    }
  }

  // Fallback for legacy files without stored sha256: ONLY if BOTH files lack sha256
  // AND fileSize + originalName match identically (never matches if hashes differ).
  if (!cleanHash && fileSize > 0) {
    const cleanName = fileName.trim().toLowerCase();
    const legacyMatch = activeFiles.find(
      (f) =>
        !f.sha256 &&
        Number(f.fileSize) === Number(fileSize) &&
        f.originalName.trim().toLowerCase() === cleanName
    );
    if (legacyMatch) {
      return {
        matchType: 'legacy_name_size',
        file: legacyMatch,
        destinationsCount: countDestinationsForFile(legacyMatch, links),
      };
    }
  }

  return null;
}

function countDestinationsForFile(file: LectureFile, links: LectureFileLink[]): number {
  const fileLinks = links.filter((l) => l.lectureFileId === file.id);
  if (fileLinks.length > 0) return fileLinks.length;
  if (file.specializationId === CENTRAL_UNLINKED_MARKER) return 0;
  return 1;
}

export interface DuplicateFileGroup {
  signature: string;
  sha256?: string;
  canonicalFile: LectureFile;
  duplicates: LectureFile[];
  allFiles: LectureFile[];
  recoverableBytes: number;
}

/**
 * Groups active non-Drive files that share identical SHA-256 (or identical legacy name+size when sha256 absent).
 * Different content files sharing a filename (e.g. "Lecture 1.pdf" in two courses with different sha256) are NEVER merged.
 */
export function detectLibraryDuplicateGroups(files: LectureFile[]): DuplicateFileGroup[] {
  const buckets = new Map<string, LectureFile[]>();

  for (const file of files) {
    if (isFileTrashed(file) || isGoogleDriveFile(file)) continue;
    const hash = (file.sha256 || '').trim().toLowerCase();
    let key = '';
    if (hash) {
      key = `sha256:${hash}`;
    } else if (Number(file.fileSize) > 0) {
      key = `legacy:${file.originalName.trim().toLowerCase()}:${Number(file.fileSize)}`;
    } else {
      continue;
    }

    const list = buckets.get(key) || [];
    list.push(file);
    buckets.set(key, list);
  }

  const groups: DuplicateFileGroup[] = [];
  for (const [signature, group] of buckets.entries()) {
    if (group.length < 2) continue;
    // Prefer canonical file with earliest creation time or existing central path
    const sorted = [...group].sort((a, b) => {
      const ta = extractTimestampMs(a.createdAt);
      const tb = extractTimestampMs(b.createdAt);
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });
    const canonicalFile = sorted[0];
    const duplicates = sorted.slice(1);
    const recoverableBytes = duplicates.reduce((sum, f) => sum + (Number(f.fileSize) || 0), 0);
    groups.push({
      signature,
      sha256: canonicalFile.sha256,
      canonicalFile,
      duplicates,
      allFiles: sorted,
      recoverableBytes,
    });
  }

  return groups.sort((a, b) => b.recoverableBytes - a.recoverableBytes);
}

/**
 * Builds deduplicated `LectureFileLink` creation payloads for distributing one file across N destinations.
 */
export function buildDistributionLinkPlan(params: {
  lectureFileId: string;
  destinations: FileDestinationInput[];
  existingLinks: LectureFileLink[];
  defaultStatus: PublishStatus;
  createdBy: string;
  startingSortOrder?: number;
}): {
  toCreate: Array<{
    id: string;
    lectureFileId: string;
    specializationId: string;
    academicYearId: string;
    semesterId: string;
    subjectId: string;
    status: PublishStatus;
    sortOrder: number;
    createdBy: string;
  }>;
  skippedDuplicates: number;
} {
  const {
    lectureFileId,
    destinations,
    existingLinks,
    defaultStatus,
    createdBy,
    startingSortOrder = 1,
  } = params;

  const existingKeys = new Set(
    existingLinks
      .filter((l) => l.lectureFileId === lectureFileId)
      .map((l) => `${l.specializationId}::${l.academicYearId}::${l.semesterId}::${l.subjectId}`)
  );

  const toCreate: Array<{
    id: string;
    lectureFileId: string;
    specializationId: string;
    academicYearId: string;
    semesterId: string;
    subjectId: string;
    status: PublishStatus;
    sortOrder: number;
    createdBy: string;
  }> = [];

  let skippedDuplicates = 0;
  let order = startingSortOrder;

  for (const dest of destinations) {
    if (!dest.specializationId || !dest.academicYearId || !dest.semesterId || !dest.subjectId) {
      continue;
    }
    const key = `${dest.specializationId}::${dest.academicYearId}::${dest.semesterId}::${dest.subjectId}`;
    if (existingKeys.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    existingKeys.add(key);
    toCreate.push({
      id: generateSafeId('lfl'),
      lectureFileId,
      specializationId: dest.specializationId,
      academicYearId: dest.academicYearId,
      semesterId: dest.semesterId,
      subjectId: dest.subjectId,
      status: dest.status || defaultStatus,
      sortOrder: order,
      createdBy,
    });
    order += 1;
  }

  return { toCreate, skippedDuplicates };
}

/**
 * Computes safe unlink operations when removing a SINGLE academic destination from a file:
 * - If explicit `linkId` exists, deletes ONLY that link. If it was the last link, marks file as `central_unlinked` (draft).
 * - If the file was a legacy unmigrated record (`isLegacyFallback`), materializes explicit links for all OTHER
 *   existing placements of that course first so ONLY the chosen destination stops showing the file!
 */
export function buildUnlinkDestinationPlan(params: {
  file: LectureFile;
  targetDestination: ResolvedDestination;
  allCurrentDestinations: ResolvedDestination[];
  actorUid: string;
}): {
  deleteLinkIds: string[];
  createLinks: Array<{
    id: string;
    lectureFileId: string;
    specializationId: string;
    academicYearId: string;
    semesterId: string;
    subjectId: string;
    status: PublishStatus;
    sortOrder: number;
    createdBy: string;
  }>;
  markFileUnlinked: boolean;
} {
  const { file, targetDestination, allCurrentDestinations, actorUid } = params;
  const targetKey = `${targetDestination.specializationId}::${targetDestination.academicYearId}::${targetDestination.semesterId}::${targetDestination.subjectId}`;
  const remaining = allCurrentDestinations.filter(
    (d) => `${d.specializationId}::${d.academicYearId}::${d.semesterId}::${d.subjectId}` !== targetKey
  );

  if (targetDestination.linkId) {
    return {
      deleteLinkIds: [targetDestination.linkId],
      createLinks: [],
      markFileUnlinked: remaining.length === 0,
    };
  }

  // Legacy file without explicit links yet: materialize remaining destinations as explicit links
  const createLinks = remaining.map((rem, idx) => ({
    id: generateSafeId('lfl'),
    lectureFileId: file.id,
    specializationId: rem.specializationId,
    academicYearId: rem.academicYearId,
    semesterId: rem.semesterId,
    subjectId: rem.subjectId,
    status: rem.status,
    sortOrder: rem.sortOrder || idx + 1,
    createdBy: actorUid,
  }));

  return {
    deleteLinkIds: [],
    createLinks,
    markFileUnlinked: remaining.length === 0,
  };
}

export function buildCentralLibraryRows(params: {
  files: LectureFile[];
  links: LectureFileLink[];
  subjects: Subject[];
  programCourses?: ProgramCourseLink[];
}): CentralLibraryRowMeta[] {
  const { files, links, subjects, programCourses = [] } = params;
  const dupGroups = detectLibraryDuplicateGroups(files);
  const dupSignatureByFileId = new Map<string, string>();
  for (const grp of dupGroups) {
    for (const f of grp.allFiles) {
      dupSignatureByFileId.set(f.id, grp.signature);
    }
  }

  return files.map((file) => {
    const destinations = getFileDestinations({
      file,
      links,
      subjects,
      programCourses,
      includeDrafts: true,
    });
    const uniqueSpecializationIds = Array.from(new Set(destinations.map((d) => d.specializationId)));
    const uniqueSubjectIds = Array.from(new Set(destinations.map((d) => d.subjectId)));

    let effectiveStatus: LibraryEffectiveStatus;
    if (file.lifecycleStatus === 'trashed') {
      effectiveStatus = 'trashed';
    } else if (file.lifecycleStatus === 'needs_review') {
      effectiveStatus = 'needs_review';
    } else if (destinations.length === 0) {
      effectiveStatus = 'unlinked';
    } else {
      effectiveStatus = 'linked';
    }

    const dupSig = dupSignatureByFileId.get(file.id);
    return {
      file,
      effectiveStatus,
      destinations,
      uniqueSpecializationIds,
      uniqueSubjectIds,
      isDuplicate: Boolean(dupSig),
      duplicateGroupSignature: dupSig,
    };
  });
}

export function filterCentralLibraryRows(
  rows: CentralLibraryRowMeta[],
  filters: CentralLibraryFilterState
): CentralLibraryRowMeta[] {
  const q = filters.query.trim().toLowerCase();
  const extFilter = filters.fileExt.trim().toLowerCase();
  const fromMs = filters.dateFrom ? Date.parse(`${filters.dateFrom}T00:00:00`) : 0;
  const toMs = filters.dateTo ? Date.parse(`${filters.dateTo}T23:59:59.999`) : 0;

  return rows.filter((row) => {
    const { file, destinations, effectiveStatus } = row;

    if (filters.lifecycleFilter === 'all') {
      if (effectiveStatus === 'trashed') return false;
    } else if (filters.lifecycleFilter === 'duplicates') {
      if (!row.isDuplicate || effectiveStatus === 'trashed') return false;
    } else if (effectiveStatus !== filters.lifecycleFilter) {
      return false;
    }

    if (filters.category !== 'all' && file.category !== filters.category) return false;
    if (extFilter && file.fileExt.toLowerCase() !== extFilter) return false;
    if (filters.uploaderUid && file.uploadedBy !== filters.uploaderUid) return false;

    if (filters.specializationId || filters.academicYearId || filters.semesterId || filters.subjectId) {
      const matchesDest = destinations.some((d) => {
        if (filters.specializationId && d.specializationId !== filters.specializationId) return false;
        if (filters.academicYearId && d.academicYearId !== filters.academicYearId) return false;
        if (filters.semesterId && d.semesterId !== filters.semesterId) return false;
        if (filters.subjectId && d.subjectId !== filters.subjectId) return false;
        return true;
      });
      if (!matchesDest) return false;
    }

    if (fromMs || toMs) {
      const ts = extractTimestampMs(file.createdAt);
      if (fromMs && ts > 0 && ts < fromMs) return false;
      if (toMs && ts > 0 && ts > toMs) return false;
    }

    if (q) {
      const haystack = `${file.title} ${file.originalName} ${file.description || ''} ${file.uploadedByEmail || ''} ${file.uploadedByName || ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });
}

export function computeCentralLibraryKpis(rows: CentralLibraryRowMeta[], files: LectureFile[]): CentralLibraryKpis {
  const dupGroups = detectLibraryDuplicateGroups(files);
  const nonTrashed = rows.filter((r) => r.effectiveStatus !== 'trashed');

  // Deduplicate physical storage usage by storagePath / storageName so shared copies don't double-count
  const physicalBytesSeen = new Map<string, number>();
  for (const f of files) {
    if (isFileTrashed(f) || isGoogleDriveFile(f)) continue;
    const blobKey = f.sha256 ? `sha:${f.sha256}` : `path:${f.storagePath || f.storageName}`;
    if (!physicalBytesSeen.has(blobKey)) {
      physicalBytesSeen.set(blobKey, Number(f.fileSize) || 0);
    }
  }

  let totalStorageBytes = 0;
  for (const bytes of physicalBytesSeen.values()) {
    totalStorageBytes += bytes;
  }

  return {
    totalFiles: files.length,
    activeFiles: nonTrashed.length,
    linkedFiles: nonTrashed.filter((r) => r.effectiveStatus === 'linked').length,
    unlinkedFiles: nonTrashed.filter((r) => r.effectiveStatus === 'unlinked').length,
    needsReviewFiles: nonTrashed.filter((r) => r.effectiveStatus === 'needs_review').length,
    trashedFiles: rows.filter((r) => r.effectiveStatus === 'trashed').length,
    totalLinks: nonTrashed.reduce((acc, r) => acc + r.destinations.length, 0),
    duplicateGroupsCount: dupGroups.length,
    totalStorageBytes,
    recoverableDuplicateBytes: dupGroups.reduce((acc, g) => acc + g.recoverableBytes, 0),
  };
}

export function exportLibraryMetadataCsv(
  rows: CentralLibraryRowMeta[],
  specializations: Specialization[],
  subjects: Subject[]
): string {
  const specMap = new Map(specializations.map((s) => [s.id, s.name]));
  const subMap = new Map(subjects.map((s) => [s.id, s.name]));

  const escapeCsv = (val: unknown) => {
    const str = String(val ?? '').replace(/"/g, '""');
    return `"${str}"`;
  };

  const headers = [
    'ID',
    'Title',
    'OriginalName',
    'Category',
    'Extension',
    'SizeFormatted',
    'FileSizeBytes',
    'SHA256',
    'Status',
    'LifecycleStatus',
    'LinkedSpecializationsCount',
    'LinkedSubjectsCount',
    'Specializations',
    'Subjects',
    'UploaderEmail',
    'StoragePath',
  ];

  const lines = [headers.map(escapeCsv).join(',')];

  for (const row of rows) {
    const specNames = row.uniqueSpecializationIds.map((id) => specMap.get(id) || id).join(' | ');
    const subNames = row.uniqueSubjectIds.map((id) => subMap.get(id) || id).join(' | ');
    lines.push(
      [
        row.file.id,
        row.file.title,
        row.file.originalName,
        getCategoryLabel(row.file.category),
        row.file.fileExt,
        formatFileSizeArabic(row.file.fileSize),
        row.file.fileSize,
        row.file.sha256 || '',
        row.file.status,
        row.effectiveStatus,
        row.uniqueSpecializationIds.length,
        row.uniqueSubjectIds.length,
        specNames,
        subNames,
        row.file.uploadedByEmail || row.file.uploadedBy,
        row.file.storagePath || row.file.storageName,
      ]
        .map(escapeCsv)
        .join(',')
    );
  }

  return `\uFEFF${lines.join('\n')}`;
}

export function suggestSubjectForSpecialization(params: {
  sourceSubjectName?: string;
  sourceSubjectCode?: string;
  targetSubjects: Subject[];
}): Subject | undefined {
  const { sourceSubjectName, sourceSubjectCode, targetSubjects } = params;
  if (targetSubjects.length === 0) return undefined;
  if (sourceSubjectCode) {
    const cleanCode = sourceSubjectCode.trim().toLowerCase();
    const byCode = targetSubjects.find((s) => (s.code || '').trim().toLowerCase() === cleanCode);
    if (byCode) return byCode;
  }
  if (sourceSubjectName) {
    const cleanName = sourceSubjectName.trim().toLowerCase().replace(/\s+/g, ' ');
    const exact = targetSubjects.find(
      (s) => s.name.trim().toLowerCase().replace(/\s+/g, ' ') === cleanName
    );
    if (exact) return exact;
    const partial = targetSubjects.find(
      (s) =>
        s.name.trim().toLowerCase().includes(cleanName) ||
        cleanName.includes(s.name.trim().toLowerCase())
    );
    if (partial) return partial;
  }
  return undefined;
}
