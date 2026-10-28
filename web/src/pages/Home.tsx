import { useEffect, useState } from "react";
import type { ccc } from "@ckb-ccc/ccc";
import type { PetView } from "../lib/petcell";
import { ownerLockHashOf } from "../lib/petcell";
import { signerLockHash } from "../lib/ops";
import { PetCard } from "../components/PetCard";
import { fmtCkb, PARAMS } from "../config";

export function Home({
  pets,
  demo,
  signer,
  loading,
  onRefresh,
  onOpen,
}: {
  pets: PetView[];
  demo: boolean;
  signer?: ccc.Signer;
  loading: boolean;
  onRefresh: () => void;
  onOpen: (pet: PetView) => void;
}) {
  const [myHash, setMyHash] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (demo || !signer) {
        setMyHash(null);
        return;
      }
      const h = await signerLockHash(signer);
      if (alive) setMyHash(h);
    })();
    return () => {
      alive = false;
    };
  }, [demo, signer]);

  if (!demo && !signer) {
    return (
      <section className="page page-home">
        <div className="home-hero">
          <div className="hero-orbit" aria-hidden="true">
            <div className="hero-orbit__ring hero-orbit__ring--outer" />
            <div className="hero-orbit__ring hero-orbit__ring--inner" />
            <div className="hero-orbit__core">
              <span>01</span>
              <small>CELL</small>
            </div>
            <span className="hero-orbit__label hero-orbit__label--top">CKB / TESTNET</span>
            <span className="hero-orbit__label hero-orbit__label--bottom">LIVE STATE</span>
          </div>
          <div className="home-hero-copy">
            <p className="eyebrow">A living cell / 不会关服</p>
            <h1 className="hero-title">
              <span className="title-line">养一只</span>
              <span className="title-line"><em>链上</em>活物</span>
            </h1>
            <p className="hero-deck">
              它不存放在服务器里。身体是一条 CKB Cell,生命值就是里面的富余容量。
              每一次代谢都在链上真实燃烧,烧完之前,你还有机会。
            </p>
          </div>
          <div className="hero-metrics" aria-label="PetCell 简介">
            <div className="metric">
              <div className="metric-label">资产形态</div>
              <div className="metric-value">01<span className="metric-unit">CELL</span></div>
            </div>
            <div className="metric">
              <div className="metric-label">代谢速度</div>
              <div className="metric-value">{fmtCkb(PARAMS.burnPerDay, 0)}<span className="metric-unit">CKB / DAY</span></div>
            </div>
            <div className="metric metric--wide">
              <div>
                <div className="metric-label">运行时间</div>
                <div className="metric-value">FOREVER</div>
              </div>
              <div className="metric-unit">NO SERVER</div>
            </div>
          </div>
        </div>
        <div className="home-section-head">
          <h2 className="home-section-title">你的标本<span>CONNECT TO BEGIN</span></h2>
        </div>
        <div className="empty">
          <div className="empty-emoji">🏠</div>
          <h2>你家还空着</h2>
          <p>连接 JoyID 钱包,或先去广场围观别人的宠物怎么死的。</p>
          <p className="hint">页脚有「进 Demo 模式」,可以先玩为敬。</p>
        </div>
      </section>
    );
  }

  const mine = demo ? pets : myHash ? pets.filter((p) => ownerLockHashOf(p) === myHash) : [];
  const alive = mine.filter((p) => p.data.state === 0);
  const dead = mine.filter((p) => p.data.state === 1);
  const starving = alive.filter((p) => p.virtualSurplus < 1_000_000_000n);
  const nearest = alive.reduce<PetView | null>((closest, pet) => {
    if (!closest || pet.virtualSurplus < closest.virtualSurplus) return pet;
    return closest;
  }, null);

  return (
    <section className="page page-home" aria-busy={!demo && loading}>
      <div className="home-hero">
        <div className="hero-orbit" aria-hidden="true">
          <div className="hero-orbit__ring hero-orbit__ring--outer" />
          <div className="hero-orbit__ring hero-orbit__ring--inner" />
          <div className="hero-orbit__core">
            <span>{String(alive.length).padStart(2, "0")}</span>
            <small>ALIVE</small>
          </div>
          <span className="hero-orbit__label hero-orbit__label--top">CKB / TESTNET</span>
          <span className="hero-orbit__label hero-orbit__label--bottom">LIVE STATE</span>
        </div>
        <div className="home-hero-copy">
          <p className="eyebrow">A living cell / 不会关服</p>
          <h1 className="hero-title">
            <span className="title-line">养一只</span>
            <span className="title-line"><em>链上</em>活物</span>
          </h1>
          <p className="hero-deck">
            它不存放在服务器里。身体是一条 CKB Cell,生命值就是里面的富余容量。
            每一次代谢都在链上真实燃烧,烧完之前,你还有机会。
          </p>
        </div>
        <div className="hero-metrics" aria-label="我的宠物概览">
          <div className="metric">
            <div className="metric-label">领养总数</div>
            <div className="metric-value">{String(mine.length).padStart(2, "0")}<span className="metric-unit">CELLS</span></div>
          </div>
          <div className="metric">
            <div className="metric-label">正在呼吸</div>
            <div className="metric-value">{String(alive.length).padStart(2, "0")}<span className="metric-unit">ALIVE</span></div>
          </div>
          <div className="metric metric--wide">
            <div>
              <div className="metric-label">
                {starving.length > 0 ? "最需要你的一只" : "今天状态"}
              </div>
              <div className="metric-value">
                {starving.length > 0 && nearest ? nearest.data.name.length > 0
                  ? new TextDecoder().decode(nearest.data.name)
                  : "无名"
                  : "一切安好"}
              </div>
            </div>
            <div className="metric-unit">{starving.length > 0 ? `${starving.length} 只挨饿` : "NO ALERTS"}</div>
          </div>
        </div>
      </div>

      <div className="home-section-head">
        <h2 className="home-section-title">我的标本<span>{String(mine.length).padStart(2, "0")} LIVE ONES</span></h2>
        <div className="home-section-tools">
          <span className={demo ? "live-mark live-mark--demo" : "live-mark"} />
          {demo ? "本地演示数据" : loading ? "同步链上…" : "实时读取链上"}
          <button className="btn btn-small btn-ghost" onClick={onRefresh} disabled={loading}>
            {loading ? "读取中" : "刷新"}
          </button>
        </div>
      </div>

      {mine.length === 0 ? (
        <div className="empty">
          <div className="empty-emoji">🥚</div>
          <p>还没有宠物。去「领养」抱一只回家——它从出生那一刻就开始倒计时了。</p>
        </div>
      ) : (
        <div className="grid">
          {alive.map((p) => (
            <PetCard key={p.outPoint.txHash + p.outPoint.index} pet={p} onClick={() => onOpen(p)} />
          ))}
          {dead.map((p) => (
            <PetCard key={p.outPoint.txHash + p.outPoint.index} pet={p} onClick={() => onOpen(p)} />
          ))}
        </div>
      )}
    </section>
  );
}
