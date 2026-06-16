import {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  useEffect,
  useState
} from "react";
import LiquidGlass from "liquid-glass-react";

type GlassLayer = "light" | "action" | "emphasis";
export type GlassTone =
  | "neutral"
  | "stable"
  | "warning"
  | "danger"
  | "pro"
  | "admin";

const layerConfig: Record<
  GlassLayer,
  {
    displacementScale: number;
    blurAmount: number;
    saturation: number;
    aberrationIntensity: number;
    elasticity: number;
    mode: "standard" | "polar" | "prominent" | "shader";
  }
> = {
  light: {
    displacementScale: 28,
    blurAmount: 0.06,
    saturation: 120,
    aberrationIntensity: 0.7,
    elasticity: 0.08,
    mode: "standard"
  },
  action: {
    displacementScale: 42,
    blurAmount: 0.08,
    saturation: 132,
    aberrationIntensity: 1.1,
    elasticity: 0.16,
    mode: "polar"
  },
  emphasis: {
    displacementScale: 52,
    blurAmount: 0.1,
    saturation: 142,
    aberrationIntensity: 1.4,
    elasticity: 0.2,
    mode: "prominent"
  }
};

function useReducedMotion() {
  const [isReduced, setIsReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setIsReduced(query.matches);

    update();
    query.addEventListener("change", update);

    return () => query.removeEventListener("change", update);
  }, []);

  return isReduced;
}

function glassClassName(
  baseClassName: string,
  layer: GlassLayer,
  tone: GlassTone
) {
  return [baseClassName, `glass-layer-${layer}`, `glass-tone-${tone}`]
    .filter(Boolean)
    .join(" ");
}

function glassProps(layer: GlassLayer, isReducedMotion: boolean) {
  const config = layerConfig[layer];

  return {
    ...config,
    displacementScale: isReducedMotion ? 0 : config.displacementScale,
    aberrationIntensity: isReducedMotion ? 0 : config.aberrationIntensity,
    elasticity: isReducedMotion ? 0 : config.elasticity
  };
}

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  layer?: GlassLayer;
  tone?: GlassTone;
}

export function GlassPanel({
  children,
  className,
  layer = "light",
  tone = "neutral",
  ...props
}: GlassPanelProps) {
  const isReducedMotion = useReducedMotion();

  return (
    <div
      className={glassClassName("glass-wrapper glass-panel-wrapper", layer, tone)}
    >
      <LiquidGlass
        {...glassProps(layer, isReducedMotion)}
        className="glass-liquid"
        cornerRadius={24}
        overLight
      >
        <div
          {...props}
          className={["glass-content", className].filter(Boolean).join(" ")}
        >
          {children}
        </div>
      </LiquidGlass>
    </div>
  );
}

interface GlassNavProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  layer?: GlassLayer;
}

export function GlassNav({
  children,
  className,
  layer = "light",
  ...props
}: GlassNavProps) {
  const isReducedMotion = useReducedMotion();

  return (
    <div
      className={glassClassName("glass-wrapper glass-nav-wrapper", layer, "neutral")}
    >
      <LiquidGlass
        {...glassProps(layer, isReducedMotion)}
        className="glass-liquid"
        cornerRadius={16}
        overLight
      >
        <div
          {...props}
          className={["glass-content", className].filter(Boolean).join(" ")}
        >
          {children}
        </div>
      </LiquidGlass>
    </div>
  );
}

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  layer?: GlassLayer;
  tone?: GlassTone;
}

export function GlassButton({
  children,
  className,
  disabled,
  layer = "action",
  tone = "stable",
  type = "button",
  ...props
}: GlassButtonProps) {
  const isReducedMotion = useReducedMotion();

  if (disabled) {
    return (
      <button
        {...props}
        className={["glass-button-native", className].filter(Boolean).join(" ")}
        disabled
        type={type}
      >
        {children}
      </button>
    );
  }

  return (
    <div
      className={glassClassName("glass-wrapper glass-button-wrapper", layer, tone)}
    >
      <LiquidGlass
        {...glassProps(layer, isReducedMotion)}
        className="glass-liquid"
        cornerRadius={999}
        padding="0"
        overLight
      >
        <button
          {...props}
          className={["glass-button-native", className].filter(Boolean).join(" ")}
          disabled={disabled}
          type={type}
        >
          {children}
        </button>
      </LiquidGlass>
    </div>
  );
}

interface GlassMetricCardProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
  tone?: GlassTone;
}

export function GlassMetricCard({
  className,
  label,
  tone = "neutral",
  value,
  ...props
}: GlassMetricCardProps) {
  return (
    <GlassPanel
      {...props}
      className={["glass-metric-card", className].filter(Boolean).join(" ")}
      layer="light"
      tone={tone}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </GlassPanel>
  );
}

interface GlassStatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: GlassTone;
}

export function GlassStatusBadge({
  children,
  className,
  tone = "neutral",
  ...props
}: GlassStatusBadgeProps) {
  return (
    <span
      {...props}
      className={["glass-status-badge", `glass-tone-${tone}`, className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}
