import { useCallback, useEffect, useRef, useState } from "react";
import type { CartLine } from "./collection";

const guest = "guest";
let connection: Promise<IDBDatabase> | undefined;
function database() {
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("chroma-shopping-bags", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("bags");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => { connection = undefined; throw error; });
  }
  return connection;
}

function addLine(lines: CartLine[], line: CartLine) {
  const existing = lines.find((item) => item.key === line.key);
  if (!existing) return [...lines, line];
  return lines.map((item) => item.key !== line.key ? item : {
    ...line, quantity: line.physical ? Math.min(100000, item.quantity + line.quantity) : 1,
  });
}

type Change = (rows: CartLine[]) => CartLine[];
// IndexedDB keeps File objects intact and serializes changes from different tabs.
async function accessBag(owner: string, change?: Change, claimGuest = false): Promise<CartLine[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("bags", change || claimGuest ? "readwrite" : "readonly");
    const store = tx.objectStore("bags");
    const own = store.get(owner);
    const previous = claimGuest && owner !== guest ? store.get(guest) : undefined;
    let lines: CartLine[];
    (previous ?? own).onsuccess = () => {
      lines = own.result ?? [];
      if (previous?.result?.length) {
        lines = (previous.result as CartLine[]).reduce(addLine, lines);
        store.delete(guest);
        store.put(lines, owner);
      }
      if (change) { lines = change(lines); store.put(lines, owner); }
    };
    tx.oncomplete = () => resolve(lines);
    tx.onabort = () => reject(tx.error ?? Error("Bag storage unavailable"));
  });
}

export function useShoppingBag(userId: string | null | undefined) {
  const owner = userId === undefined ? undefined : (userId ?? guest);
  const [snapshot, setSnapshot] = useState<{ owner: string; lines: CartLine[] }>();
  const [error, setError] = useState("");
  const channel = useRef<BroadcastChannel | null>(null);
  const current = useRef(owner);
  current.current = owner;
  const sync = useCallback(async (scope: string, change?: Change, claim = false) => {
    try {
      const lines = await accessBag(scope, change, claim);
      if (current.current === scope) { setSnapshot({ owner: scope, lines }); setError(""); }
      if (change || claim) channel.current?.postMessage(scope);
      return true;
    } catch {
      if (current.current === scope) setError("Your browser could not access bag storage. Allow site storage and try again.");
      return false;
    }
  }, []);
  useEffect(() => {
    if (!owner) return;
    setError("");
    void sync(owner, undefined, owner !== guest);
    if (typeof BroadcastChannel === "undefined") return;
    const updates = new BroadcastChannel("chroma-bag-changes");
    channel.current = updates;
    updates.onmessage = ({ data }) => { if (data === owner) void sync(owner); };
    return () => { updates.close(); channel.current = null; };
  }, [owner, sync]);
  const edit = (change: Change) => sync(owner ?? guest, change);
  return {
    lines: snapshot && snapshot.owner === owner ? snapshot.lines : [],
    loading: !error && (!snapshot || snapshot.owner !== owner),
    error,
    add: (line: CartLine) => edit((rows) => addLine(rows, line)),
    change: (key: string, quantity: number) => edit((rows) => quantity ?
      rows.map((line) => line.key === key ? { ...line, quantity } : line) : rows.filter((line) => line.key !== key)),
    clear: () => edit(() => []),
  };
}
