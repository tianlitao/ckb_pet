import { memo } from "react";
import type { Traits } from "../lib/genes";

/**
 * Procedural SVG pet — every gene byte maps to a visual feature so that a
 * pet's face is a deterministic function of its on-chain genes.
 */

const PALETTES: [string, string][] = [
  ["#f6c66b", "#e8a23d"], ["#a8d8b9", "#6fb98f"], ["#f2a3a3", "#d96a6a"],
  ["#b8c9f2", "#7c95d6"], ["#d9b8f2", "#a678cf"], ["#f2d3b8", "#d6a276"],
  ["#b8e8e0", "#6fc0b2"], ["#f2b8e0", "#d678b0"], ["#d4d4d8", "#9a9aa2"],
  ["#ffe08a", "#f0b429"], ["#c7e9a8", "#8fbf5f"], ["#f5c6a0", "#e09a62"],
];

const EYES = ["●●", "◉◉", "^^", "・・", "✦✦", "@@", "°°", ">.<", "••", "○○", "×X", "˘˘", "¬¬", "⋄⋄", "♦♦", "≈≈"];
const MOUTHS = ["‿", "ᴗ", "ω", "3", "▽", "−", "◡", "ᗜ", "︶", "︵", "ω", "ㅂ", "³", "ϖ", "⌣", "ə"];
const PATTERNS = ["none", "blush", "spots", "patch", "stripe", "crown", "collar", "sparkle"];

const RARITY_STYLE: Record<string, { ring: string; glow: string; label: string }> = {
  "普通": { ring: "#e2e8f0", glow: "none", label: "" },
  "稀有": { ring: "#7dd3fc", glow: "drop-shadow(0 0 6px #7dd3fc)", label: "✦" },
  "史诗": { ring: "#c084fc", glow: "drop-shadow(0 0 8px #c084fc)", label: "✦✦" },
  "传说": { ring: "#fbbf24", glow: "drop-shadow(0 0 12px #fbbf24)", label: "✦✦✦" },
};

const BODY_SHAPES: Record<number, (cx: number, cy: number, c1: string, c2: string) => React.ReactNode> = {
  // 0 喵喵 cat
  0: (cx, cy, c1, c2) => (
    <g>
      <polygon points={`${cx - 38},${cy - 28} ${cx - 26},${cy - 62} ${cx - 8},${cy - 40}`} fill={c2} />
      <polygon points={`${cx + 38},${cy - 28} ${cx + 26},${cy - 62} ${cx + 8},${cy - 40}`} fill={c2} />
      <ellipse cx={cx} cy={cy} rx={48} ry={44} fill={c1} />
    </g>
  ),
  // 1 汪汪 dog
  1: (cx, cy, c1, c2) => (
    <g>
      <ellipse cx={cx - 48} cy={cy - 8} rx={14} ry={26} fill={c2} transform={`rotate(-24 ${cx - 48} ${cy - 8})`} />
      <ellipse cx={cx + 48} cy={cy - 8} rx={14} ry={26} fill={c2} transform={`rotate(24 ${cx + 48} ${cy - 8})`} />
      <ellipse cx={cx} cy={cy} rx={46} ry={42} fill={c1} />
    </g>
  ),
  // 2 兔兔 rabbit
  2: (cx, cy, c1, c2) => (
    <g>
      <ellipse cx={cx - 18} cy={cy - 58} rx={11} ry={30} fill={c1} transform={`rotate(-10 ${cx - 18} ${cy - 58})`} />
      <ellipse cx={cx + 18} cy={cy - 58} rx={11} ry={30} fill={c1} transform={`rotate(10 ${cx + 18} ${cy - 58})`} />
      <ellipse cx={cx - 18} cy={cy - 58} rx={5} ry={20} fill={c2} transform={`rotate(-10 ${cx - 18} ${cy - 58})`} />
      <ellipse cx={cx + 18} cy={cy - 58} rx={5} ry={20} fill={c2} transform={`rotate(10 ${cx + 18} ${cy - 58})`} />
      <ellipse cx={cx} cy={cy} rx={44} ry={42} fill={c1} />
    </g>
  ),
  // 3 蛙蛙 frog
  3: (cx, cy, c1, c2) => (
    <g>
      <circle cx={cx - 26} cy={cy - 40} r={12} fill={c1} />
      <circle cx={cx + 26} cy={cy - 40} r={12} fill={c1} />
      <ellipse cx={cx} cy={cy} rx={50} ry={40} fill={c1} />
      <ellipse cx={cx} cy={cy + 22} rx={34} ry={16} fill={c2} opacity={0.55} />
    </g>
  ),
  // 4 咕咕 chick
  4: (cx, cy, c1, c2) => (
    <g>
      <polygon points={`${cx - 4},${cy - 66} ${cx - 18},${cy - 46} ${cx + 10},${cy - 46}`} fill="#f59e0b" />
      <ellipse cx={cx} cy={cy} rx={44} ry={46} fill={c1} />
      <path d={`M ${cx - 44} ${cy + 4} q 22 -14 44 0 q 22 14 44 0`} stroke={c2} strokeWidth={3} fill="none" opacity={0.5} />
    </g>
  ),
  // 5 章鱼 octopus
  5: (cx, cy, c1, c2) => (
    <g>
      <ellipse cx={cx} cy={cy - 6} rx={46} ry={44} fill={c1} />
      {[-34, -17, 0, 17, 34].map((dx, i) => (
        <path key={i} d={`M ${cx + dx} ${cy + 22} q ${dx > 0 ? 8 : -8} 18 0 30`} stroke={c2} strokeWidth={9} strokeLinecap="round" fill="none" />
      ))}
    </g>
  ),
};

export const PetSvg = memo(function PetSvg({
  traits,
  size = 120,
  dead = false,
}: {
  traits: Traits;
  size?: number;
  dead?: boolean;
}) {
  const [c1, c2] = PALETTES[traits.palette % PALETTES.length];
  const style = RARITY_STYLE[traits.rarity] ?? RARITY_STYLE["普通"];
  const cx = 70;
  const cy = 74;
  const pattern = PATTERNS[traits.pattern % PATTERNS.length];
  const filter = dead ? "grayscale(1) opacity(0.65)" : style.glow !== "none" ? style.glow : undefined;
  return (
    <svg width={size} height={size} viewBox="0 0 140 140" style={{ filter }} aria-label="pet">
      {traits.aura && !dead && (
        <circle cx={cx} cy={cy} r={62} fill="none" stroke="#fbbf24" strokeWidth={2} strokeDasharray="4 6" opacity={0.7} />
      )}
      <circle cx={cx} cy={cy} r={66} fill={dead ? "#f1f5f9" : "#fffbeb"} stroke={style.ring} strokeWidth={2} />
      {BODY_SHAPES[traits.species]?.(cx, cy, dead ? "#cbd5e1" : c1, dead ? "#94a3b8" : c2)}
      {pattern === "blush" && !dead && (
        <g opacity={0.6}>
          <ellipse cx={cx - 26} cy={cy + 10} rx={9} ry={5} fill="#fb7185" />
          <ellipse cx={cx + 26} cy={cy + 10} rx={9} ry={5} fill="#fb7185" />
        </g>
      )}
      {pattern === "spots" && (
        <g fill={dead ? "#94a3b8" : c2} opacity={0.8}>
          <circle cx={cx - 20} cy={cy - 22} r={5} />
          <circle cx={cx + 14} cy={cy - 30} r={4} />
          <circle cx={cx + 26} cy={cy - 8} r={6} />
        </g>
      )}
      {pattern === "patch" && <circle cx={cx - 20} cy={cy - 24} r={14} fill={dead ? "#94a3b8" : c2} opacity={0.7} />}
      {pattern === "stripe" && (
        <g stroke={dead ? "#94a3b8" : c2} strokeWidth={5} opacity={0.7}>
          <line x1={cx - 8} y1={cy - 40} x2={cx - 8} y2={cy - 30} />
          <line x1={cx + 2} y1={cy - 42} x2={cx + 2} y2={cy - 30} />
          <line x1={cx + 12} y1={cy - 40} x2={cx + 12} y2={cy - 30} />
        </g>
      )}
      {pattern === "crown" && (
        <polygon points={`${cx - 20},${cy - 52} ${cx - 10},${cy - 68} ${cx},${cy - 54} ${cx + 10},${cy - 68} ${cx + 20},${cy - 52}`} fill="#fbbf24" />
      )}
      {pattern === "collar" && <rect x={cx - 34} y={cy + 28} width={68} height={9} rx={4} fill="#ef4444" />}
      {pattern === "sparkle" && !dead && (
        <g fill="#fef08a">
          <polygon points={`${cx + 40},${cy - 44} ${cx + 43},${cy - 37} ${cx + 50},${cy - 34} ${cx + 43},${cy - 31} ${cx + 40},${cy - 24} ${cx + 37},${cy - 31} ${cx + 30},${cy - 34} ${cx + 37},${cy - 37}`} />
        </g>
      )}
      <text x={cx - 22} y={cy - 6} fontSize={20} textAnchor="middle" fill="#3f3f46">
        {dead ? "××" : EYES[traits.eyes % EYES.length].charAt(0)}
      </text>
      <text x={cx + 22} y={cy - 6} fontSize={20} textAnchor="middle" fill="#3f3f46">
        {dead ? "××" : EYES[traits.eyes % EYES.length].charAt(0)}
      </text>
      <text x={cx} y={cy + 16} fontSize={16} textAnchor="middle" fill="#3f3f46">
        {dead ? "×" : MOUTHS[traits.mouth % MOUTHS.length]}
      </text>
      {dead && <text x={cx} y={cy - 52} fontSize={12} textAnchor="middle" fill="#71717a">†</text>}
    </svg>
  );
});
