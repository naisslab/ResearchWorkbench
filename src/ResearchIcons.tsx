import {
  Activity,
  Bot,
  CircuitBoard,
  Cpu,
  Database,
  Fingerprint,
  Network,
  Radar,
  Radio,
  Route,
  ShieldCheck,
  Table2,
  Workflow,
  Binary,
} from "lucide-react";
import type { Area, Project } from "./types";
import researchIcon from "./assets/research-icon.svg";

export function ResearchMark({ size = 28 }: { size?: number }) {
  return <img src={researchIcon} width={size} height={size} alt="" aria-hidden="true" className="research-mark" />;
}

export function AreaIcon({ area, size = 16 }: { area?: Area; size?: number }) {
  const icon = area?.icon;
  const Glyph =
    icon === "shield" || area?.id === "security"
      ? ShieldCheck
      : icon === "radio" || area?.id === "cps"
        ? Radio
        : CircuitBoard;
  return <Glyph size={size} strokeWidth={1.7} />;
}

export function ProjectIcon({
  project,
  size = 22,
}: {
  project: Project;
  size?: number;
}) {
  const icons = {
    activity: Activity,
    bot: Bot,
    circuit: CircuitBoard,
    cpu: Cpu,
    database: Database,
    fingerprint: Fingerprint,
    network: Network,
    radar: Radar,
    radio: Radio,
    route: Route,
    shield: ShieldCheck,
    table: Table2,
    workflow: Workflow,
    binary: Binary,
  };
  const Glyph = icons[project.icon as keyof typeof icons] || Network;
  return <Glyph size={size} strokeWidth={1.65} />;
}
