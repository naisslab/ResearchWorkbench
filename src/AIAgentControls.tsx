import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  Shield,
  ShieldCheck,
  ShieldOff,
  Eye,
  Zap,
  RotateCcw,
} from "lucide-react";
import type { AIAgentSettings, AIModel, AIPermissionMode } from "./types";

const permissions = [
  {
    id: "default",
    label: "Default permissions",
    description: "Work in project folders. Ask you for additional access.",
    icon: Shield,
  },
  {
    id: "auto-review",
    label: "Approve for me",
    description:
      "Work in project folders. Codex reviews requests for additional access.",
    icon: ShieldCheck,
  },
  {
    id: "read-only",
    label: "Read only",
    description:
      "Inspect files. Ask you before making changes or running commands that need more access.",
    icon: Eye,
  },
  {
    id: "full-access",
    label: "Full access",
    description: "Access files and the network without asking for approval.",
    icon: ShieldOff,
  },
] as const;

export function effortLabel(effort?: string) {
  return (
    (
      { xhigh: "Extra High", max: "Maximum", none: "None" } as Record<
        string,
        string
      >
    )[effort || ""] ||
    (effort ? effort.charAt(0).toUpperCase() + effort.slice(1) : "Default")
  );
}

type Preferences = {
  permissionMode?: AIPermissionMode;
  efforts?: Record<string, string>;
  tiers?: Record<string, string>;
};
function readPreferences(key: string): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function useAIAgentSettings(
  profileId: string | null | undefined,
  projectId: string,
  model?: AIModel,
) {
  const key = `research-workbench.ai-settings.${profileId || "disconnected"}.${projectId}`;
  const [saved, setSaved] = useState(() => ({
    key,
    preferences: readPreferences(key),
  }));
  const preferences =
    saved.key === key ? saved.preferences : readPreferences(key);
  const preferredEffort = model && preferences.efforts?.[model.slug];
  const preferredTier = model && preferences.tiers?.[model.slug];
  const settings: AIAgentSettings = {
    permissionMode: permissions.some((p) => p.id === preferences.permissionMode)
      ? preferences.permissionMode!
      : "default",
    reasoningEffort: model?.supportedReasoningEfforts?.some(
      (option) => option.reasoningEffort === preferredEffort,
    )
      ? preferredEffort
      : model?.defaultReasoningEffort,
    serviceTier: model?.serviceTiers?.some((tier) => tier.id === preferredTier)
      ? preferredTier!
      : "default",
  };
  function update(patch: Partial<AIAgentSettings>) {
    const next = { ...preferences };
    if (patch.permissionMode) next.permissionMode = patch.permissionMode;
    if (model && patch.reasoningEffort)
      next.efforts = { ...next.efforts, [model.slug]: patch.reasoningEffort };
    if (model && patch.serviceTier)
      next.tiers = { ...next.tiers, [model.slug]: patch.serviceTier };
    setSaved({ key, preferences: next });
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Keep selections in memory. */
    }
  }
  return { settings, update };
}

export default function AIAgentControls({
  models,
  model,
  selectModel,
  settings,
  update,
  disabled,
}: {
  models: AIModel[];
  model?: AIModel;
  selectModel(slug: string): void;
  settings: AIAgentSettings;
  update(patch: Partial<AIAgentSettings>): void;
  disabled: boolean;
}) {
  const [menu, setMenu] = useState<"permissions" | "model" | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const permissionButton = useRef<HTMLButtonElement>(null);
  const modelButton = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const trigger = menu === "permissions" ? permissionButton : modelButton;
  const permission = permissions.find((p) => p.id === settings.permissionMode)!;
  const PermissionIcon = permission.icon;
  const tier = model?.serviceTiers?.find((t) => t.id === settings.serviceTier);
  const efforts = model?.supportedReasoningEfforts || [];
  const effortIndex = Math.max(
    0,
    efforts.findIndex(
      (option) => option.reasoningEffort === settings.reasoningEffort,
    ),
  );
  const effortPercent =
    efforts.length > 1 ? (effortIndex / (efforts.length - 1)) * 100 : 100;
  const close = () => {
    setMenu(null);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (disabled) setMenu(null);
  }, [disabled]);
  useLayoutEffect(() => {
    if (!menu || !trigger.current || !popup.current) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const box = {
        height: popup.current!.offsetHeight,
        width: popup.current!.offsetWidth,
      };
      setPosition({
        top: Math.max(8, rect.top - box.height - 8),
        left: Math.max(
          8,
          Math.min(
            menu === "model" ? rect.right - box.width : rect.left,
            window.innerWidth - box.width - 8,
          ),
        ),
      });
    };
    place();
    popup.current.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const resize = new ResizeObserver(place);
    resize.observe(popup.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (
        !popup.current?.contains(event.target as Node) &&
        !permissionButton.current?.contains(event.target as Node) &&
        !modelButton.current?.contains(event.target as Node)
      )
        setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  function navigate(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLInputElement) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    ];
    const current = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    event.preventDefault();
    buttons[index]?.focus();
  }
  return (
    <div className="ai-agent-controls">
      <button
        type="button"
        className="ai-setting-trigger"
        ref={permissionButton}
        aria-label="Agent permissions"
        aria-haspopup="menu"
        aria-expanded={menu === "permissions"}
        disabled={disabled}
        title={permission.description}
        onClick={() => setMenu(menu === "permissions" ? null : "permissions")}
      >
        <PermissionIcon size={14} />
        <span>{permission.label}</span>
        <ChevronDown size={11} />
      </button>
      <div className="ai-model-controls">
        {!!model?.serviceTiers?.length && (
          <button
            type="button"
            className="ai-setting-trigger ai-speed-trigger"
            aria-label="Fast mode"
            aria-pressed={!!tier}
            disabled={disabled}
            title={tier ? "Turn off fast mode" : "Turn on fast mode"}
            onClick={() =>
              update({
                serviceTier: tier ? "default" : model.serviceTiers[0].id,
              })
            }
          >
            <Zap size={14} fill={tier ? "currentColor" : "none"} />
          </button>
        )}
        <button
          type="button"
          className="ai-setting-trigger ai-model-trigger"
          ref={modelButton}
          aria-label="AI model"
          aria-haspopup="dialog"
          aria-expanded={menu === "model"}
          disabled={disabled || !models.length}
          onClick={() => setMenu(menu === "model" ? null : "model")}
        >
          <span>{model?.displayName || "Select model"}</span>
          <small>
            {model?.supportedReasoningEfforts?.length
              ? effortLabel(settings.reasoningEffort)
              : ""}
          </small>
          <ChevronDown size={11} />
        </button>
      </div>
      {menu &&
        createPortal(
          <div
            ref={popup}
            className={`ai-settings-menu ai-settings-${menu}`}
            style={position}
            role={menu === "permissions" ? "menu" : "dialog"}
            aria-label={
              menu === "permissions" ? "Agent permissions" : "AI model settings"
            }
            onKeyDown={navigate}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget as Node) &&
                !permissionButton.current?.contains(
                  event.relatedTarget as Node,
                ) &&
                !modelButton.current?.contains(event.relatedTarget as Node)
              )
                setMenu(null);
            }}
          >
            {menu === "permissions" ? (
              <>
                <strong>Agent Permissions</strong>
                {permissions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={settings.permissionMode === p.id}
                    onClick={() => {
                      update({ permissionMode: p.id });
                      close();
                    }}
                  >
                    <p.icon size={16} />
                    <span>
                      <b>{p.label}</b>
                      <small>{p.description}</small>
                    </span>
                    {settings.permissionMode === p.id && <Check size={14} />}
                  </button>
                ))}
              </>
            ) : (
              <>
                <strong>Model</strong>
                <div
                  role="radiogroup"
                  aria-label="Model"
                  className="ai-model-options"
                >
                  {models.map((m) => (
                    <button
                      key={m.slug}
                      type="button"
                      role="radio"
                      aria-checked={m.slug === model?.slug}
                      className="ai-model-option"
                      onClick={() => selectModel(m.slug)}
                    >
                      <span>{m.displayName}</span>
                      {m.slug === model?.slug && <Check size={14} />}
                    </button>
                  ))}
                </div>
                <div className="ai-settings-section">
                  {!!efforts.length && (
                    <div className="ai-effort-card" key={model?.slug}>
                      <div className="ai-effort-heading">
                        <Zap size={17} />
                        <div>
                          <span className="ai-effort-value" aria-live="polite">
                            {effortLabel(settings.reasoningEffort)}
                          </span>
                          <small>Reasoning effort</small>
                        </div>
                        <button
                          type="button"
                          className="ai-effort-reset"
                          aria-label="Reset reasoning effort"
                          title="Reset to model default"
                          disabled={
                            settings.reasoningEffort ===
                            model?.defaultReasoningEffort
                          }
                          onClick={() =>
                            update({
                              reasoningEffort: model?.defaultReasoningEffort,
                            })
                          }
                        >
                          <RotateCcw size={15} />
                        </button>
                      </div>
                      <div
                        className="ai-effort-slider"
                        style={
                          {
                            "--effort-position": `calc(${effortPercent}% + ${14 - effortPercent * 0.28}px)`,
                          } as CSSProperties
                        }
                      >
                        <div className="ai-effort-track" aria-hidden="true">
                          <div className="ai-effort-fill" />
                          {efforts.map((option, index) => (
                            <i
                              key={option.reasoningEffort}
                              className={index <= effortIndex ? "selected" : ""}
                              style={{
                                left: `calc(${efforts.length > 1 ? (index / (efforts.length - 1)) * 100 : 50}% + ${efforts.length > 1 ? 14 - (index / (efforts.length - 1)) * 28 : 0}px)`,
                              }}
                            />
                          ))}
                        </div>
                        <span className="ai-effort-thumb" aria-hidden="true" />
                        <input
                          type="range"
                          aria-label="Reasoning effort"
                          aria-valuetext={effortLabel(settings.reasoningEffort)}
                          min={0}
                          max={Math.max(1, efforts.length - 1)}
                          step={1}
                          value={effortIndex}
                          disabled={efforts.length < 2}
                          onChange={(event) =>
                            update({
                              reasoningEffort:
                                efforts[Number(event.target.value)]
                                  .reasoningEffort,
                            })
                          }
                        />
                      </div>
                      <small className="ai-effort-description">
                        {efforts[effortIndex]?.description}
                      </small>
                    </div>
                  )}
                  {!model?.supportedReasoningEfforts?.length && (
                    <small>Uses the model’s default reasoning.</small>
                  )}
                </div>
                <div className="ai-settings-section">
                  <strong>Speed</strong>
                  <div
                    role="radiogroup"
                    aria-label="Model speed"
                    className="ai-setting-options"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={settings.serviceTier === "default"}
                      onClick={() => update({ serviceTier: "default" })}
                    >
                      Standard
                    </button>
                    {model?.serviceTiers?.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={settings.serviceTier === t.id}
                        title={t.description}
                        onClick={() => update({ serviceTier: t.id })}
                      >
                        <Zap size={12} />
                        {t.name}
                      </button>
                    ))}
                  </div>
                  <small>
                    {tier?.description ||
                      (model?.serviceTiers?.length
                        ? "Standard speed and usage."
                        : "Fast mode is unavailable for this model.")}
                  </small>
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
