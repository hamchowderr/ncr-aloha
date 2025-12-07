import { useState, useEffect } from "react";
import type { Menu } from "@/types/menu";

export function useMenu() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMenu() {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || "";
        const res = await fetch(`${apiUrl}/api/menu`);
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
