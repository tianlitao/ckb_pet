import { useState } from "react";
import type { ccc } from "@ckb-ccc/ccc";
import { buildAdopt } from "../lib/ops";
import { fmtCkb, PARAMS } from "../config";

export function Adopt({
  demo,
  signer,
  client,
  onDone,
}: {
  demo: boolean;
  signer?: ccc.Signer;
  client: ccc.Client;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [food, setFood] = useState("20");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const foodCkb = Math.max(0, Number(food) || 0);
  const foodShannons = BigInt(Math.round(foodCkb * 100)) * 1_000_000n;
  const minFood = Number(PARAMS.adoptMinSurplus / 100_000_000n);
  const foodValid = foodCkb >= minFood;
  const lifespanDays = Math.floor(foodCkb / (Number(PARAMS.burnPerDay) / 100_000_000) * 10) / 10;

  async function adopt() {
    setErr(null);
    setMsg(null);
    if (!foodValid) {
      setErr(`初始口粮至少需要 ${fmtCkb(PARAMS.adoptMinSurplus)} CKB`);
      return;
    }
    if (!demo && !signer) {
      setErr("先连接钱包(JoyID 指纹即可)");
      return;
    }
    setBusy(true);
    try {
      if (demo) {
        await new Promise((r) => setTimeout(r, 600));
        setMsg(`(Demo)「${name || "无名"}」已经住进你家了,记得每天来看它。`);
      } else {
        const { txHash } = await buildAdopt(signer!, client, name || "无名", foodShannons);
        setMsg(`领养成功!tx ${txHash.slice(0, 12)}… 它已经在你家了。`);
      }
      setName("");
      onDone();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page page-narrow page-adopt">
      <div className="adopt-layout">
        <div className="adopt-hero">
          <div className="adopt-egg">🥚</div>
          <div className="adopt-egg-id">GENOME PENDING</div>
          <h2>领养<br /><em>一只活物</em></h2>
          <p className="hint">
            它是一条真实的 CKB Cell:身体(占用容量)永远锁在里面,是你的地板价;
            <b>生命值 = 富余容量</b>,每天烧掉 {fmtCkb(PARAMS.burnPerDay)} CKB,烧完就公开饿死。
            永不关服——唯一能弄死它的,是你不再喂它。
          </p>
          <ol className="adopt-steps">
            <li>取个名字<br />也可以之后再取</li>
            <li>选口粮<br />≥ {fmtCkb(PARAMS.adoptMinSurplus)} CKB</li>
            <li>JoyID 签名<br />写进 CKB 链</li>
          </ol>
        </div>

        <div className="adopt-card">
          <div className="adopt-form">
            <label>
              <span className="field-label">Name / 宠物名字</span>
              <input
                className="input"
                placeholder="给它一个名字"
                value={name}
                maxLength={16}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div>
              <span className="field-label">Food / 初始口粮 (CKB)</span>
              <div className="adopt-food">
                {[20, 50, 100].map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={food === String(v) ? "chip chip-active" : "chip"}
                    aria-pressed={food === String(v)}
                    onClick={() => setFood(String(v))}
                  >
                    {v}
                  </button>
                ))}
                <input
                  className="input input-number"
                  type="number"
                  min={minFood}
                  value={food}
                  onChange={(e) => setFood(e.target.value)}
                  aria-label="自定义口粮"
                  aria-invalid={!foodValid}
                />
                <span>每天消耗 {fmtCkb(PARAMS.burnPerDay)} CKB · 最低 {fmtCkb(PARAMS.adoptMinSurplus)} CKB</span>
              </div>
            </div>
            <div className={foodValid ? "adopt-projection" : "adopt-projection adopt-projection--invalid"} aria-live="polite">
              <span>LIFE PROJECTION / 预计生命</span>
              <strong>{foodValid ? `${lifespanDays.toFixed(1)} DAYS` : "口粮未达最低值"}</strong>
              <small>{foodValid ? "从写入链上那一刻开始倒计时" : `至少再补 ${(minFood - foodCkb).toFixed(2)} CKB`}</small>
            </div>
            <button className="btn btn-primary btn-big" disabled={busy || !foodValid} onClick={() => void adopt()}>
              {busy ? "正在写进链上…" : "用我的 CKB 领养"}<span className="arrow">→</span>
            </button>
          </div>
          {msg && <div className="banner banner-info" role="status">{msg}</div>}
          {err && <div className="banner banner-error" role="alert">{err}</div>}
          <p className="hint hint-small">
            签名会花一点点链上手续费;口粮没有独立提现入口,要退出只能转让宠物或安乐死。
            代谢烧掉的是真正的消耗,安乐死还会再烧掉税后 20%。
            稀有度由领养交易决定(基因研磨有真实手续费成本),运气也是玩法的一部分。
          </p>
        </div>
      </div>
    </section>
  );
}
