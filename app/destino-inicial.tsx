"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function DestinoInicial({ autenticado }: { autenticado: boolean }) {
  const router = useRouter();

  useEffect(() => {
    // O fragmento de erro do Supabase só existe no navegador.
    const retorno = new URLSearchParams(window.location.hash.slice(1));
    if (retorno.get("error") === "access_denied" && retorno.get("error_code") === "otp_expired") {
      router.replace("/login?error=link_invalido");
    } else if (autenticado) {
      router.replace("/app");
    }
  }, [autenticado, router]);

  return null;
}
