import {
  Activity,
  Binary,
  Bot,
  CircuitBoard,
  Cpu,
  Database,
  Fingerprint,
  Layers3,
  Network,
  Radar,
  Radio,
  Route,
  ShieldCheck,
  Table2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Area, Project } from "./types";
import researchIcon from "./assets/research-icon.svg";

const glyphs: Record<string, LucideIcon> = {
  activity: Activity,
  binary: Binary,
  bot: Bot,
  circuit: CircuitBoard,
  cpu: Cpu,
  database: Database,
  fingerprint: Fingerprint,
  layers: Layers3,
  network: Network,
  radar: Radar,
  radio: Radio,
  route: Route,
  shield: ShieldCheck,
  table: Table2,
  workflow: Workflow,
};
// The built-in areas keep their glyphs whatever their icon field says.
const builtInAreas: Record<string, LucideIcon> = {
  ml: CircuitBoard,
  security: ShieldCheck,
  cps: Radio,
};

export function ResearchMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src={researchIcon}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className="research-mark"
    />
  );
}

export function AreaIcon({ area, size = 16 }: { area?: Area; size?: number }) {
  const Glyph =
    builtInAreas[area?.id ?? ""] ?? glyphs[area?.icon ?? ""] ?? Layers3;
  return <Glyph size={size} strokeWidth={1.7} />;
}

export function ProjectIcon({
  project,
  size = 22,
}: {
  project: Project;
  size?: number;
}) {
  const Glyph = glyphs[project.icon ?? ""] ?? Network;
  return <Glyph size={size} strokeWidth={1.65} />;
}
