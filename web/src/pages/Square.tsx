import { useMemo, useRef, useState } from "react";
import type { ccc } from "@ckb-ccc/ccc";
import type { PetView } from "../lib/petcell";
import { isAlive, isDead, isStarving, petName } from "../lib/petcell";
import { buildLoot, buildPoke } from "../lib/ops";
import { PetCard } from "../components/PetCard";
import { fmtCkb } from "../config";

type SquareTab = "strays" | "graveyard" | "shame";

export function Square({
  pets,
  demo,
  signer,
  client,
  onOpen,
  onChanged,
}: {
  pets: PetView[];
  demo: boolean;
  signer?: ccc.Signer;
  client: ccc.Client;
  onOpen: (pet: PetView) => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<SquareTab>("strays");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const squareTabs: Array<{ id: SquareTab; label: string; count: number }> = [
    { id: "strays", label: "待救", count: 0 },
    { id: "graveyard", label: "讣告", count: 0 },
    { id: "shame", label: "未收殓", count: 0 },
  ];

  const strays = pets
    .filter((p) => isAlive(p) && isStarving(p))
    .sort((a, b) => Number(a.virtualSurplus) - Number(b.virtualSurplus));
  const healthy = useMemo(() => pets.filter((p) => isAlive(p) && !isStarving(p)), [pets]);
  const dead = useMemo(() => pets.filter((p) => isDead(p)), [pets]);
  // Hall of shame: last known owners of dead pets (address stands in for identity)
  const shameCounts = new Map<string, number>();
  for (const p of dead) shameCounts.set(p.ownerLockHash, (shameCounts.get(p.ownerLockHash) ?? 0) + 1);
  const shame = [...shameCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  squareTabs[0].count = strays.length;
  squareTabs[1].count = dead.length;
  squareTabs[2].count = shame.length;

  function onTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    let next = index;
    if (e.key === "ArrowLeft") next = (index - 1 + squareTabs.length) % squareTabs.length;
    if (e.key === "ArrowRight") next = (index + 1) % squareTabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = squareTabs.length - 1;
    setTab(squareTabs[next].id);
    tabRefs.current[next]?.focus();
  }

  async function poke(pet: PetView) {
    setBusy(pet.outPoint.txHash);
    setNotice(null);
    try {
      if (demo) {
        await new Promise((r) => setTimeout(r, 500));
        setNotice({ kind: "success", text: `(Demo) 摸了摸 ${petName(pet)}:代谢已在链下演示中结算` });
      } else {
        const { txHash, dies, burn } = await buildPoke(client, pet);
        setNotice({ kind: "success", text: `已摸 ${petName(pet)}:${dies ? "它没能撑过去,已化为尸体" : `代谢燃烧 ${fmtCkb(burn)} CKB`},tx ${txHash.slice(0, 10)}…` });
      }
      onChanged();
    } catch (e) {
      setNotice({ kind: "error", text: `摸失败:${String(e)}` });
    } finally {
      setBusy(null);
    }
  }

  async function loot(pet: PetView) {
    if (!signer) {
      setNotice({ kind: "error", text: "捡尸需要连接钱包(尸体容量要有个去处)" });
      return;
    }
    setBusy(pet.outPoint.txHash);
    setNotice(null);
    try {
      if (demo) {
        await new Promise((r) => setTimeout(r, 500));
        setNotice({ kind: "success", text: `(Demo) 捡走了 ${petName(pet)} 的尸体,身体容量归你` });
      } else {
        const txHash = await buildLoot(signer, client, pet);
        setNotice({ kind: "success", text: `捡尸成功,身体容量已入袋,tx ${txHash.slice(0, 10)}…` });
      }
      onChanged();
    } catch (e) {
      setNotice({ kind: "error", text: `捡尸失败:${String(e)}` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="page">
      <div className="square-hero">
        <h1 className="square-title">公共<br /><i>标本室</i></h1>
        <p className="square-copy">
          广场不是排行榜。这里只有还在等待的、已经离开的,
          以及那些被路过的人记住过的 Cell。
        </p>
      </div>

      <div className="square-toolbar">
        <div className="square-count">
          <strong>{String(strays.length + healthy.length + dead.length).padStart(2, "0")}</strong>
          CELLS IN VIEW
        </div>
        <div className="subtabs" role="tablist" aria-label="广场分类">
          {squareTabs.map((item, index) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`square-panel-${item.id}`}
              id={`square-tab-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              className={tab === item.id ? "tab tab-active" : "tab"}
              onClick={() => setTab(item.id)}
              onKeyDown={(e) => onTabKeyDown(e, index)}
              ref={(node) => { tabRefs.current[index] = node; }}
            >
              {item.label}({item.count})
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div
          className={`square-notice ${notice.kind === "error" ? "square-notice--error" : ""}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          <span>{notice.kind === "error" ? "ERR" : "TX"}</span>
          <p>{notice.text}</p>
          <button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      {tab === "strays" && (
        <div role="tabpanel" id="square-panel-strays" aria-labelledby="square-tab-strays">
          <div className="strays-note">
            <p>
              它们的主人已经不管了。喂它一口,它多活一天;摸它一下,代谢立刻结算。
              救,还是等它死,你说了算。
            </p>
          </div>
          {strays.length === 0 ? (
            <div className="empty"><div className="empty-emoji">🌤️</div><p>现在没有挨饿的宠物,难得。</p></div>
          ) : (
            <div className="grid">
              {strays.map((p) => (
                <div key={p.outPoint.txHash + p.outPoint.index} className="stack">
                  <PetCard pet={p} onClick={() => onOpen(p)} />
                  <div className="row-actions">
                    <button className="btn btn-small btn-primary" disabled={busy === p.outPoint.txHash} onClick={() => void poke(p)}>
                      {busy === p.outPoint.txHash ? "…" : `摸一下(代谢结算)`}
                    </button>
                    <button className="btn btn-small" onClick={() => onOpen(p)}>
                      去喂它 →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {healthy.length > 0 && (
            <>
              <h3 className="section-title">仍然被照顾着({healthy.length})</h3>
              <div className="grid">
                {healthy.map((p) => (
                  <PetCard key={p.outPoint.txHash + p.outPoint.index} pet={p} onClick={() => onOpen(p)} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "graveyard" && (
        <div role="tabpanel" id="square-panel-graveyard" aria-labelledby="square-tab-graveyard">
          <div className="strays-note">
            <p>这里只显示当前仍 live 的尸体;被捡走后会从列表消失,尚未接入历史索引。讣告可以截图发出去——这就是传播。</p>
          </div>
          {dead.length === 0 ? (
            <div className="empty"><div className="empty-emoji">🕊️</div><p>还没有讣告。</p></div>
          ) : (
            <div className="grid">
              {dead.map((p) => (
                <div key={p.outPoint.txHash + p.outPoint.index} className="stack">
                  <PetCard pet={p} onClick={() => onOpen(p)} />
                  <div className="row-actions">
                    <button className="btn btn-small" disabled={busy === p.outPoint.txHash} onClick={() => void loot(p)}>
                      捡尸(拿走身体)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "shame" && (
        <div role="tabpanel" id="square-panel-shame" aria-labelledby="square-tab-shame">
          <div className="strays-note">
            <p>这里按当前未收殓尸体统计最后主人;链上不记录死亡原因,捡尸后计数会减少,不是完整历史榜,也不能据此认定弃养。</p>
          </div>
          {shame.length === 0 ? (
            <div className="empty"><div className="empty-emoji">😇</div><p>当前没有未收殓尸体。</p></div>
          ) : (
            <ol className="shame-list">
              {shame.map(([hash, n]) => (
                <li key={hash}>
                  <code>{hash.slice(0, 14)}…{hash.slice(-8)}</code>
                  <span>留下了 {n} 只未收殓的 Cell</span>
                  <em>{n}</em>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
