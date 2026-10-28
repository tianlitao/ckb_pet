import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ccc } from "@ckb-ccc/ccc";
import type { PetView } from "../lib/petcell";
import { hoursToStarve, isDead, petName } from "../lib/petcell";
import { buildEuthanize, buildFeed, buildLoot, buildPoke, buildTransfer } from "../lib/ops";
import { fmtCkb, PARAMS } from "../config";
import { PetSvg } from "../components/PetSvg";

export function PetDetail({
  pet,
  demo,
  signer,
  client,
  onClose,
  onChanged,
}: {
  pet: PetView;
  demo: boolean;
  signer?: ccc.Signer;
  client: ccc.Client;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [confirmingEuth, setConfirmingEuth] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const euthTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmingRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  }

  const dead = isDead(pet);
  const h = hoursToStarve(pet);
  const needsSigner = !demo && !signer;
  const estimatedPenalty = (pet.virtualSurplus * 2000n) / 10000n;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (confirmingRef.current) {
          closeConfirmation(true);
        } else {
          onClose();
        }
        return;
      }
      if (e.key !== "Tab") return;

      const layer = confirmingRef.current ? confirmRef.current : dialogRef.current;
      if (!layer) return;
      const focusable = Array.from(
        layer.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.getClientRects().length > 0);

      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [onClose]);

  useEffect(() => {
    if (confirmingEuth) {
      requestAnimationFrame(() => cancelRef.current?.focus());
    }
  }, [confirmingEuth]);

  useEffect(() => {
    if (confirmingEuth) {
      const dialog = dialogRef.current;
      dialog?.setAttribute("aria-hidden", "true");
      dialog?.setAttribute("inert", "");
      return () => {
        dialog?.removeAttribute("aria-hidden");
        dialog?.removeAttribute("inert");
      };
    }
  }, [confirmingEuth]);

  function openConfirmation() {
    if (!guard()) return;
    confirmingRef.current = true;
    setConfirmingEuth(true);
  }

  function closeConfirmation(restoreFocus = false) {
    confirmingRef.current = false;
    setConfirmingEuth(false);
    if (restoreFocus) {
      requestAnimationFrame(() => euthTriggerRef.current?.focus());
    }
  }

  function guard(): boolean {
    if (needsSigner) {
      setErr("先连接钱包");
      return false;
    }
    return true;
  }

  return (
    <>
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
      >
        <div className="detail-head">
          <div className="detail-portrait">
            <div className="pet-svg-wrap">
              <PetSvg traits={pet.traits} size={170} dead={dead} />
            </div>
          </div>
          <div>
            <p className="detail-kicker" id={descriptionId}>
              Specimen file / Cell #{pet.outPoint.index.toString()}
            </p>
            <h2 className="detail-name" id={titleId}>
              {petName(pet)} <span className="pet-card-rarity">{pet.traits.rarity}</span>
            </h2>
            <div className="detail-meta">
              {pet.traits.speciesName} · {pet.traits.personalityName} · 第 {pet.data.generation} 代
            </div>
            {dead ? (
              <div className="banner banner-dead">
                † 已在链上死亡(可能饿死或安乐死)。尸体(身体容量 {fmtCkb(pet.capacity)} CKB)等一个捡尸人。
              </div>
            ) : h !== null && h < 24 ? (
              <div className="banner banner-error">它撑不过今晚了(约 {h.toFixed(1)} 小时)。喂它,或者准备好讣告。</div>
            ) : (
              <div className="banner banner-info">
                剩余口粮约 {h !== null ? (h / 24).toFixed(1) : "?"} 天(按每天 {fmtCkb(PARAMS.burnPerDay)} CKB 代谢)
              </div>
            )}
          </div>
        </div>

        <div className="detail-content">
          {msg && <div className="banner banner-info" role="status">{msg}</div>}
          {err && <div className="banner banner-error" role="alert">{err}</div>}

          {!dead && (
            <div className="actions">
              <button
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() => guard() && void run("feed", async () => {
                  if (demo) {
                    await new Promise((r) => setTimeout(r, 400));
                    setMsg(`(Demo) 投喂 10 CKB,${petName(pet)} 又能多吃两天`);
                  } else {
                    const txHash = await buildFeed(signer!, client, pet, 1_000_000_000n);
                    setMsg(`投喂成功(10 CKB 入仓),tx ${txHash.slice(0, 10)}…`);
                  }
                })}
              >
                {busy === "feed" ? "…" : "投喂 10 CKB"}<span className="arrow">→</span>
              </button>
              <button
                className="btn"
                disabled={busy !== null}
                onClick={() => void run("poke", async () => {
                  if (demo) {
                    await new Promise((r) => setTimeout(r, 400));
                    setMsg(`(Demo) 摸了一下,代谢已结算`);
                  } else {
                    const { txHash, dies, burn } = await buildPoke(client, pet);
                    setMsg(`代谢结算 ${fmtCkb(burn)} CKB${dies ? " —— 它饿死了" : ""},tx ${txHash.slice(0, 10)}…`);
                  }
                })}
              >
                {busy === "poke" ? "…" : "摸一下(结算代谢)"}
              </button>
            </div>
          )}

          {dead && (
            <div className="actions">
              <button
                className="btn btn-primary"
                disabled={busy !== null || (!demo && !signer)}
                onClick={() => guard() && void run("loot", async () => {
                  if (demo) {
                    await new Promise((r) => setTimeout(r, 400));
                    setMsg(`(Demo) 尸体已捡,身体容量入袋`);
                  } else {
                    const txHash = await buildLoot(signer!, client, pet);
                    setMsg(`捡尸成功,tx ${txHash.slice(0, 10)}…`);
                  }
                })}
              >
                {busy === "loot" ? "…" : "捡尸(拿走身体容量)"}<span className="arrow">→</span>
              </button>
            </div>
          )}

          {!dead && (
            <>
              <h3 className="section-title">转让 / 把责任和口粮一起送出去</h3>
              <div className="transfer-row">
                <input
                  className="input"
                  placeholder="对方 CKB 地址(ckt1...)"
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                />
                <button
                  className="btn"
                  disabled={busy !== null || transferTo.length < 20}
                  onClick={() => guard() && void run("transfer", async () => {
                    if (demo) {
                      await new Promise((r) => setTimeout(r, 400));
                      setMsg(`(Demo) 已转让给 ${transferTo.slice(0, 8)}…`);
                    } else {
                      const txHash = await buildTransfer(signer!, client, pet, transferTo);
                      setMsg(`转让完成,tx ${txHash.slice(0, 10)}…`);
                    }
                    setTransferTo("");
                  })}
                >
                  转让
                </button>
              </div>

              <div className="danger-zone">
                <h3 className="section-title">安乐死 / 体面退场,20% 口粮燃烧</h3>
                <p className="hint hint-small">
                  与其让它慢慢饿死,不如安乐死:扣除已欠代谢后,取回 {100 - 20}% 口粮,
                  罚金 {20}% 直接燃烧,不给任何人。
                  当前链上数据不记录死亡原因,UI 不会伪造“饿死”或“耻辱榜”结论。
                  这个决定不可撤销。
                </p>
                <button
                  className="btn btn-danger"
                  disabled={busy !== null}
                  onClick={openConfirmation}
                  ref={euthTriggerRef}
                >
                  {busy === "euth" ? "…" : "安乐死"}
                </button>
              </div>
            </>
          )}

          <h3 className="section-title">Chain record / 链上档案</h3>
          <table className="kv">
            <tbody>
              <tr><td>细胞</td><td><code>{pet.outPoint.txHash.slice(0, 18)}…#{pet.outPoint.index}</code></td></tr>
              <tr><td>容量</td><td>{fmtCkb(pet.capacity)} CKB(身体 {fmtCkb(pet.occupied)} + 口粮 {fmtCkb(pet.surplus)})</td></tr>
              <tr><td>基因</td><td><code>{Array.from(pet.data.genes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24)}…</code></td></tr>
              <tr><td>出生</td><td>{new Date(Number(pet.data.birthTime)).toLocaleString()}</td></tr>
              <tr><td>上次互动</td><td>{new Date(Number(pet.data.lastTouched)).toLocaleString()}</td></tr>
              <tr><td>主人</td><td><code>{pet.ownerLockHash.slice(0, 14)}…</code></td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <button className="modal-close" onClick={onClose} aria-label="关闭档案" ref={closeRef}>
        ✕
      </button>

    </div>

      {confirmingEuth && createPortal(
        <div
          className="confirm-backdrop"
          role="presentation"
          onClick={(e) => {
            e.stopPropagation();
            closeConfirmation(true);
          }}
        >
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="euth-confirm-title"
            aria-describedby="euth-confirm-copy"
            ref={confirmRef}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="confirm-kicker">Terminal action / 不可撤销</p>
            <h2 id="euth-confirm-title">确定让「{petName(pet)}」离开？</h2>
            <p id="euth-confirm-copy" className="confirm-copy">
              链上状态会立即写成死亡。约 <strong>{fmtCkb(estimatedPenalty)} CKB</strong>
              的口粮作为罚金永久燃烧，其余口粮退回。没有撤回，也没有复活。
            </p>
            <div className="confirm-actions">
              <button
                className="btn btn-keep"
                type="button"
                onClick={() => closeConfirmation(true)}
                ref={cancelRef}
              >
                保留它
              </button>
              <button
                className="btn btn-confirm-danger"
                type="button"
                onClick={() => {
                  closeConfirmation();
                  void run("euth", async () => {
                    if (demo) {
                      await new Promise((r) => setTimeout(r, 400));
                      setMsg(`(Demo) 安乐死完成，它走了，但走得很体面`);
                    } else {
                      const { txHash, penalty } = await buildEuthanize(signer!, client, pet);
                      setMsg(`安乐死完成，罚金 ${fmtCkb(penalty)} CKB 已燃烧，tx ${txHash.slice(0, 10)}…`);
                    }
                  });
                }}
              >
                确认安乐死
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
