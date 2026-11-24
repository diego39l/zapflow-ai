export const PRAZO_RECUPERACAO_MS = 15_000;

export function transporteRecuperacao(prazo: AbortSignal) {
  let enviou = false;
  let falha: "invalid_response" | "transport_error" | null = null;

  const adaptarFetch = (fetchServidor: typeof fetch): typeof fetch => async (input, init) => {
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = requestSignal ? AbortSignal.any([prazo, requestSignal]) : prazo;
    signal.throwIfAborted();
    if (enviou) throw new Error("A recuperação permite uma única chamada HTTP");
    enviou = true;

    let response: Response;
    try {
      response = await fetchServidor(input, { ...init, signal, redirect: "error" });
    } catch (error) {
      if (!signal.aborted) falha = "transport_error";
      throw error;
    }
    if (response.ok) {
      try {
        const body: unknown = await response.clone().json();
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          throw new Error("Formato de recuperação inesperado");
        }
      } catch (error) {
        if (!signal.aborted) falha = "invalid_response";
        void response.body?.cancel().catch(() => {});
        throw error;
      }
    }
    return response;
  };

  return { adaptarFetch, falha: () => falha };
}
