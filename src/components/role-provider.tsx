"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";
import { type Role, DEFAULT_ROLE, ROLE_LABELS } from "@/lib/roles";

interface RoleContextType {
  role: Role;
  roleLabel: string;
  userName: string;
  loading: boolean;
  setRoleOverride: (role: Role) => void; // デモ用: ロール切替
}

const RoleContext = createContext<RoleContextType>({
  role: DEFAULT_ROLE,
  roleLabel: ROLE_LABELS[DEFAULT_ROLE],
  userName: "",
  loading: true,
  setRoleOverride: () => {},
});

export function useRole() {
  return useContext(RoleContext);
}

export default function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role>(DEFAULT_ROLE);
  const [userName, setUserName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRole = async () => {
      // 1) DBの user_profiles.role を正とする（サーバー側の認可と判定源を一致させる）。
      //    user_metadata.role は古いアカウントでズレることがあるため、まずDBを見る。
      try {
        const res = await api.get("/api/report/my-role");
        const dbRole = res.data?.role as Role | undefined;
        if (res.data?.name) setUserName(res.data.name);
        if (dbRole && dbRole in ROLE_LABELS) {
          setRole(dbRole);
          setLoading(false);
          return;
        }
      } catch {
        // API失敗時は下の user_metadata フォールバックへ
      }
      // 2) フォールバック: JWTの user_metadata.role / name
      try {
        const { data } = await supabase.auth.getUser();
        const userRole = data?.user?.user_metadata?.role as Role | undefined;
        const metaName = data?.user?.user_metadata?.name as string | undefined;
        if (metaName) setUserName((prev) => prev || metaName);
        setRole(userRole && userRole in ROLE_LABELS ? userRole : DEFAULT_ROLE);
      } catch {
        setRole(DEFAULT_ROLE);
      }
      setLoading(false);
    };

    fetchRole();

    const { data: listener } = supabase.auth.onAuthStateChange(async () => {
      await fetchRole();
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const setRoleOverride = (newRole: Role) => {
    setRole(newRole);
  };

  return (
    <RoleContext.Provider value={{ role, roleLabel: ROLE_LABELS[role], userName, loading, setRoleOverride }}>
      {children}
    </RoleContext.Provider>
  );
}
