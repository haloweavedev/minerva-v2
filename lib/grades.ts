// lib/grades.ts — shared grade utilities for filtering and sorting

const GRADE_MAP: Record<string, number> = {
  'A+': 13, 'A': 12, 'A-': 11,
  'B+': 10, 'B': 9, 'B-': 8,
  'C+': 7, 'C': 6, 'C-': 5,
  'D+': 4, 'D': 3, 'D-': 2,
  'F': 1,
};

/** Convert a letter grade to a numeric value for sorting (higher = better). */
export function gradeToNumeric(grade: string | null | undefined): number {
  if (!grade) return 0;
  return GRADE_MAP[grade.toUpperCase()] ?? 0;
}

/** True for grades B+ and above (numeric >= 10). */
export function isHighGrade(grade: string | null | undefined): boolean {
  return gradeToNumeric(grade) >= 10;
}

/**
 * Expand a grade range keyword into an array of individual grades for SQL filtering.
 *
 * Supported inputs:
 * - "highly_rated" → A+, A, A-, B+
 * - "A_range" → A+, A, A-
 * - "B_range" → B+, B, B-
 * - "C_range" → C+, C, C-
 * - "D_range" → D+, D, D-
 * - "poorly_rated" → C-, D+, D, D-, F
 * - A specific grade like "A+" → just ["A+"]
 */
export function expandGradeRange(input: string): string[] {
  const key = input.toLowerCase().replace(/\s+/g, '_');

  switch (key) {
    case 'highly_rated':
      return ['A+', 'A', 'A-', 'B+'];
    case 'a_range':
      return ['A+', 'A', 'A-'];
    case 'b_range':
      return ['B+', 'B', 'B-'];
    case 'c_range':
      return ['C+', 'C', 'C-'];
    case 'd_range':
      return ['D+', 'D', 'D-'];
    case 'poorly_rated':
      return ['C-', 'D+', 'D', 'D-', 'F'];
    default: {
      // Single grade like "A+" or "B"
      const normalized = input.toUpperCase().trim();
      if (GRADE_MAP[normalized]) return [normalized];
      return [];
    }
  }
}
