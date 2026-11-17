import React from 'react';
import {
  Activity,
  Atom,
  BookOpen,
  Building2,
  Calculator,
  Code2,
  Compass,
  Cpu,
  FlaskConical,
  GraduationCap,
  HardHat,
  HeartPulse,
  Laptop,
  Layers,
  Microscope,
  Stethoscope,
  Zap,
} from 'lucide-react';

export interface IconOption {
  key: string;
  label: string;
}

export const AVAILABLE_ICON_OPTIONS: IconOption[] = [
  { key: 'stethoscope', label: 'الطب والهندسة الحيوية' },
  { key: 'crane', label: 'الهندسة المدنية' },
  { key: 'laptop', label: 'البرمجيات والحاسوب' },
  { key: 'cpu', label: 'علوم الحاسوب' },
  { key: 'zap', label: 'الهندسة الكهربائية' },
  { key: 'compass', label: 'المعمارية والمساحة' },
  { key: 'calculator', label: 'الرياضيات والحسبان' },
  { key: 'atom', label: 'الفيزياء' },
  { key: 'flask', label: 'الكيمياء' },
  { key: 'heart-pulse', label: 'الأجهزة الحيوية' },
  { key: 'activity', label: 'التشريح والوظائف' },
  { key: 'layers', label: 'الميكانيكا والمواد' },
  { key: 'code', label: 'البرمجة والخوارزميات' },
  { key: 'microscope', label: 'المختبرات والأبحاث' },
  { key: 'building', label: 'الإدارة والأعمال' },
  { key: 'book', label: 'مقرر عام' },
];

export function AcademicIcon({
  iconKey,
  className = 'w-6 h-6',
}: {
  iconKey?: string;
  className?: string;
}) {
  switch (iconKey) {
    case 'stethoscope':
      return <Stethoscope className={className} aria-hidden="true" />;
    case 'crane':
      return <HardHat className={className} aria-hidden="true" />;
    case 'laptop':
      return <Laptop className={className} aria-hidden="true" />;
    case 'cpu':
      return <Cpu className={className} aria-hidden="true" />;
    case 'zap':
      return <Zap className={className} aria-hidden="true" />;
    case 'compass':
      return <Compass className={className} aria-hidden="true" />;
    case 'calculator':
      return <Calculator className={className} aria-hidden="true" />;
    case 'atom':
      return <Atom className={className} aria-hidden="true" />;
    case 'flask':
      return <FlaskConical className={className} aria-hidden="true" />;
    case 'heart-pulse':
      return <HeartPulse className={className} aria-hidden="true" />;
    case 'activity':
      return <Activity className={className} aria-hidden="true" />;
    case 'layers':
      return <Layers className={className} aria-hidden="true" />;
    case 'code':
      return <Code2 className={className} aria-hidden="true" />;
    case 'microscope':
      return <Microscope className={className} aria-hidden="true" />;
    case 'building':
      return <Building2 className={className} aria-hidden="true" />;
    case 'book':
      return <BookOpen className={className} aria-hidden="true" />;
    default:
      return <GraduationCap className={className} aria-hidden="true" />;
  }
}

export function IconPicker({
  value,
  onChange,
  label = 'أيقونة القسم / المادة',
}: {
  value: string;
  onChange: (nextKey: string) => void;
  label?: string;
}) {
  return (
    <div>
      <span className="block text-sm font-medium text-[#0B2545] mb-2">{label}</span>
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {AVAILABLE_ICON_OPTIONS.map((opt) => {
          const active = value === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onChange(opt.key)}
              title={opt.label}
              aria-label={opt.label}
              aria-pressed={active}
              className={`min-h-[44px] flex items-center justify-center rounded-xl border transition-all ${
                active
                  ? 'bg-[#EAF4F7] border-[#00A6A6] text-[#00A6A6] ring-2 ring-[#00A6A6]/25'
                  : 'bg-white border-slate-200 text-[#0B2545]/70 hover:border-[#00A6A6]/50 hover:text-[#0B2545]'
              }`}
            >
              <AcademicIcon iconKey={opt.key} className="w-5 h-5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
