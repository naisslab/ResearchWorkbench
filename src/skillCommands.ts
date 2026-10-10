import type { AISkill } from "./types";

export interface SkillCommand {
  start: number;
  end: number;
  query: string;
}

export function findSkillCommand(
  text: string,
  caret: number,
): SkillCommand | null {
  const match = text.slice(0, caret).match(/(?:^|\s)\/([\p{L}\p{N}_-]*)$/u);
  if (!match) return null;
  const tail = text.slice(caret).match(/^[\p{L}\p{N}_-]*/u)![0];
  const end = caret + tail.length;
  // A slash inside a path or URL is ordinary request text.
  if (text[end] === "/" || text[end] === ".") return null;
  return { start: caret - match[1].length - 1, end, query: match[1] + tail };
}

export function skillSuggestions(skills: AISkill[], query: string): AISkill[] {
  const search = query.toLowerCase();
  const rank = (skill: AISkill) =>
    skill.name.toLowerCase().startsWith(search)
      ? 0
      : skill.displayName.toLowerCase().startsWith(search)
        ? 1
        : 2;
  return skills
    .filter(
      (skill) =>
        skill.enabled &&
        `${skill.name} ${skill.displayName} ${skill.description}`
          .toLowerCase()
          .includes(search),
    )
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        Number(b.name === "scale-writing") -
          Number(a.name === "scale-writing") ||
        a.name.localeCompare(b.name),
    );
}
