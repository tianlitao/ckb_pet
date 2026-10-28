import { useCallback, useEffect, useMemo, useState } from "react";
import { useCcc, useSigner } from "@ckb-ccc/connector-react";
import type { PetView } from "./lib/petcell";
import { fetchPets } from "./lib/petcell";
import { petTypeScript } from "./lib/ops";
import { makeDemoPets } from "./lib/demo";
import { Home } from "./pages/Home";
import { Square } from "./pages/Square";
import { Adopt } from "./pages/Adopt";
import { PetDetail } from "./pages/PetDetail";
import { IS_DEPLOYED } from "./config";

export type Tab = "home" | "square" | "adopt";

function useDemo(): [boolean, () => void] {
  const [demo, setDemo] = useState(() => new URLSearchParams(location.search).has("demo"));
  const toggle = useCallback(() => {
    const next = !demo;
    setDemo(next);
    const url = new URL(location.href);
    if (next) url.searchParams.set("demo", "1");
    else url.searchParams.delete("demo");
    history.replaceState(null, "", url);
  }, [demo]);
  return [demo, toggle];
}

export function App() {
  const { open, client, wallet, disconnect } = useCcc();
  const signer = useSigner();
  const [demo, toggleDemo] = useDemo();
  const [pets, setPets] = useState<PetView[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    if (demo) {
      setPets(makeDemoPets(BigInt(Date.now())));
      return;
    }
    if (!IS_DEPLOYED()) {
      setPets([]);
      return;
    }
    setLoading(true);
    try {
      setPets(await fetchPets(client, petTypeScript()));
    } catch (e) {
      setError(`读取链上数据失败:${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [client, demo]);

  useEffect(() => {
    void refresh();
    // Re-read the chain tip as well as the cells. A local setTick() would
    // leave PetView.virtualSurplus fixed at the timestamp of the last fetch.
    const id = setInterval(() => {
      void refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const selectedPet = useMemo(
    () => pets.find((p) => p.outPoint.txHash === selected) ?? null,
    [pets, selected],
  );
  const closeDetail = useCallback(() => setSelected(null), []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">🐾</span>
          <div className="brand-copy">
            <div className="brand-name">
              PetCell <span>on-chain / CKB</span>
            </div>
            <div className="brand-sub">永不关服,只会死于你的不管不问</div>
          </div>
        </div>
        <div className="topbar-right">
          {demo && <span className="badge badge-demo">DEMO 模式(本地数据)</span>}
          {!demo && !IS_DEPLOYED() && <span className="badge badge-warn">合约未部署 · 建议 Demo</span>}
          {signer ? (
            <button className="btn btn-ghost" onClick={() => void disconnect()}>
              <span className="wallet-dot" />
              {wallet?.name ?? "已连接"} · 断开
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => open()}>
              连接钱包(JoyID)
            </button>
          )}
        </div>
      </header>

      <nav className="tabs" aria-label="主导航">
        <button aria-current={tab === "home" ? "page" : undefined} className={tab === "home" ? "tab tab-active" : "tab"} onClick={() => setTab("home")}>
          <span className="tab-index">01</span>我家
        </button>
        <button aria-current={tab === "square" ? "page" : undefined} className={tab === "square" ? "tab tab-active" : "tab"} onClick={() => setTab("square")}>
          <span className="tab-index">02</span>广场
        </button>
        <button aria-current={tab === "adopt" ? "page" : undefined} className={tab === "adopt" ? "tab tab-active" : "tab"} onClick={() => setTab("adopt")}>
          <span className="tab-index">03</span>领养
        </button>
      </nav>

      {error && <div className="banner banner-error" role="alert">{error}</div>}

      <main>
        {tab === "home" && (
          <Home
            pets={pets}
            demo={demo}
            signer={signer}
            loading={loading}
            onRefresh={() => void refresh()}
            onOpen={(pet) => setSelected(pet.outPoint.txHash)}
          />
        )}
        {tab === "square" && (
          <Square
            pets={pets}
            demo={demo}
            signer={signer}
            client={client}
            onOpen={(pet) => setSelected(pet.outPoint.txHash)}
            onChanged={() => void refresh()}
          />
        )}
        {tab === "adopt" && (
          <Adopt demo={demo} signer={signer} client={client} onDone={() => void refresh()} />
        )}
      </main>

      {selectedPet && (
        <PetDetail
          pet={selectedPet}
          demo={demo}
          signer={signer}
          client={client}
          onClose={closeDetail}
          onChanged={() => void refresh()}
        />
      )}

      <footer className="footer">
        <button className="btn btn-ghost" onClick={toggleDemo}>
          {demo ? "退出 Demo" : "进 Demo 模式"}
        </button>
        <span className="footer-note">ONE CELL / ONE LIFE · 生命值 = 富余容量 · 代谢由链强制</span>
        <span className="footer-signature footer-note">PetCell / CKB Testnet</span>
      </footer>
    </div>
  );
}
