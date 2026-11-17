import fs from 'fs';
import path from 'path';

function escapePdfText(input: string): string {
  return input
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Generates a valid multi-line PDF document on disk so seeded lecture files
 * open natively in the browser PDF viewer and download cleanly.
 */
export function writeSampleLecturePdf(
  outputPath: string,
  meta: {
    courseTitle: string;
    lectureTitle: string;
    department: string;
    sections: string[];
  }
): number {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const lines: Array<{ text: string; size: number; y: number }> = [
    { text: 'UST LECTURE PLATFORM - ACADEMIC COURSE MATERIAL', size: 15, y: 745 },
    { text: `Department: ${escapePdfText(meta.department)}`, size: 11, y: 718 },
    { text: `Course: ${escapePdfText(meta.courseTitle)}`, size: 12, y: 698 },
    { text: `Lecture: ${escapePdfText(meta.lectureTitle)}`, size: 12, y: 678 },
    { text: '--------------------------------------------------------------------', size: 10, y: 658 },
  ];

  let currentY = 632;
  for (const section of meta.sections) {
    lines.push({ text: escapePdfText(section), size: 11, y: currentY });
    currentY -= 24;
  }

  lines.push({
    text: 'University of Science and Technology (UST) - Digital Academic Archive',
    size: 9,
    y: 72,
  });

  const streamCommands = lines
    .map(
      (line) =>
        `BT /F1 ${line.size} Tf 54 ${line.y} Td (${line.text}) Tj ET`
    )
    .join('\n');

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(streamCommands, 'utf8')} >>\nstream\n${streamCommands}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }

  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const buffer = Buffer.from(pdf, 'utf8');
  fs.writeFileSync(outputPath, buffer);
  return buffer.length;
}
