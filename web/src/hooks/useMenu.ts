import { useState, useEffect } from "react";
import type { Menu } from "@/types/menu";

export function useMenu() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMenu() {
      try {
        // In production, call the VPS directly. In dev, use proxy.
        const apiUrl = import.meta.env.DEV ? "/api" : "https://ncr-aloha.tylanmiller.tech";
        const res = await fetch(`${apiUrl}/menu`);
        if (!res.ok) throw new Error("Failed to fetch menu");
        const data = await res.json();
        setMenu(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchMenu();
  }, []);

  return { menu, loading, error };
}
