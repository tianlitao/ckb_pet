import { PetSvg } from "./PetSvg";
import { fmtCkb } from "../config";
import { useId } from "react";
import {
  hoursToStarve,
  isDead,
  isStarving,
  petName,
  type PetView,
} from "../lib/petcell";

function hungerLine(pet: PetView): { text: string; cls: string; pct: number } {
  if (isDead(pet)) return { text: "已死亡", cls: "dead", pct: 0 };
  const h = hoursToStarve(pet) ?? 0;
  const pct = Math.max(0, Math.min(100, (h / 96) * 100));
  if (h <= 0) return { text: "已经撑不过一次摸了", cls: "critical", pct: 2 };
  if (h < 24) return { text: `快饿死了(约 ${h.toFixed(1)} 小时)`, cls: "critical", pct };
  if (h < 72) return { text: `有点饿(约 ${(h / 24).toFixed(1)} 天)`, cls: "hungry", pct };
  return { text: `饱足(约 ${(h / 24).toFixed(1)} 天口粮)`, cls: "ok", pct };
}

export function PetCard({
  pet,
  onClick,
  actionLabel = "查看",
}: {
  pet: PetView;
  onClick?: () => void;
  actionLabel?: string;
}) {
  const hunger = hungerLine(pet);
  const nameId = useId();
  return (
    <article
      className={`pet-card ${onClick ? "pet-card-interactive" : ""} ${isStarving(pet) ? "pet-card-starving" : ""}`}
      aria-labelledby={nameId}
    >
      {onClick && (
        <button
          className="pet-card-hit"
          type="button"
          aria-label={`${actionLabel} ${petName(pet)}`}
          onClick={onClick}
        />
      )}
      <div className="pet-card-face">
        <div className="pet-svg-wrap">
          <PetSvg traits={pet.traits} size={104} dead={isDead(pet)} />
        </div>
        {isStarving(pet) && <span className="badge badge-danger">挨饿</span>}
        {pet.traits.aura && !isDead(pet) && <span className="badge badge-legend">传说</span>}
      </div>
      <div className="pet-card-body">
        <div className="pet-card-name" id={nameId}>
          {petName(pet)}
          <span className="pet-card-rarity">{pet.traits.rarity}</span>
        </div>
        <div className="pet-card-meta">
          {pet.traits.speciesName} · {pet.traits.personalityName}
        </div>
        <div className={`hunger hunger-${hunger.cls}`}>
          <div className="hunger-bar">
            <div className={`hunger-fill hunger-fill-${hunger.cls}`} style={{ width: `${hunger.pct}%` }} />
          </div>
          <span>{hunger.text}</span>
        </div>
        <div className="pet-card-foot">
          <span>口粮 {fmtCkb(pet.virtualSurplus)} CKB</span>
          {onClick && (
            <span className="pet-card-cta" aria-hidden="true">
              {actionLabel}<span className="arrow">↗</span>
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
