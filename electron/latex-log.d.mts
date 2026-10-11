export interface Problem {
  file: string;
  line: number;
  message: string;
  error: boolean;
}
export function directory(file: string): string;
export const errorPattern: RegExp;
export function parseProblems(log: string, mainFile: string): Problem[];
