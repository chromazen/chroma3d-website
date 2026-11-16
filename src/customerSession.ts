import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { db, takeCustomerEmailAction } from "./backend";

export const recoveryKey = "chroma-customer-recovery";

export function useCustomerSession() {
  const [session, setSession] = useState<Session | null>();
  useEffect(() => {
    if (!db) { setSession(null); return; }
    const { data } = db.auth.onAuthStateChange((event, next) => {
      if (next && location.pathname.replace(/\/$/, "") === "/account") {
        const action = takeCustomerEmailAction();
        if (event === "PASSWORD_RECOVERY" || action === "recovery" || action === "invite")
          sessionStorage.setItem(recoveryKey, next.user.id);
      }
      if (event === "SIGNED_OUT") sessionStorage.removeItem(recoveryKey);
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}
