import { useEffect, useState } from "react";
import { authService } from "../services/api/authService.js";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    authService.getUser().then((response) => {
      if (!active) return;
      setUser(response.success ? response.data : null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { user, loading, login: authService.login, logout: authService.logout };
}
