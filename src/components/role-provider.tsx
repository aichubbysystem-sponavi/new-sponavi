"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { type Role, DEFAULT_ROLE, ROLE_LABELS } from "@/lib/roles";

interface RoleContextType {
  role: Role;
  roleLabel: string;
  loading: boolean;
  setRoleOverride: (role: Role) => void; // デモ用: ロール切替
}

const RoleContext = createContext<RoleContextType>({
  role: DEFAULT_ROLE,
  roleLabel: ROLE_LABELS[DEFAULT_ROLE],
  loading: true,
  setRoleOverride: () => {},
});

export function useRole() {
  return useContext(RoleContext);
}

export default function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role>(DEFAULT_ROLE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRole = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const userRole = data?.user?.user_metadata?.role as Role | undefined;
        if (userRole && userRole in ROLE_LABELS) {
          setRole(userRole);
        } else {
          // ロール未設定の場合、デフォルトで社長（初期ユーザー向け）
          setRole("president");
        }
      } catch {
        setRole("president");
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
    <RoleContext.Provider value={{ role, roleLabel: ROLE_LABELS[role], loading, setRoleOverride }}>
      {children}
    </RoleContext.Provider>
  );
}
