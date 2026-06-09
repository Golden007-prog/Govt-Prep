import type { ExamTaxonomy } from '../../lib/types/exam';
import { validateExamTaxonomy } from '../../lib/taxonomy/validate';
import cilMtSystems from './cil-mt-systems.json';
import sscCglTier1 from './ssc-cgl.json';

/**
 * The exam registry. "Config-driven" (spec §4): adding an exam = dropping a JSON file
 * here and registering it — no logic changes anywhere. Each entry is validated at load,
 * so a malformed taxonomy fails fast and loudly.
 */
export const EXAMS: ExamTaxonomy[] = [
  validateExamTaxonomy(cilMtSystems),
  validateExamTaxonomy(sscCglTier1),
];
