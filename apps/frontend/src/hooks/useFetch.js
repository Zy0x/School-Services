import { useEffect, useState } from "react";

export function useFetch(loader, dependencies = []) {
  const [state, setState] = useState({ data: null, loading: true, error: "" });

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: "" }));
    Promise.resolve()
      .then(loader)
      .then((response) => {
        if (!active) return;
        setState({
          data: response?.data ?? response,
          loading: false,
          error: response?.success === false ? response.message : "",
        });
      })
      .catch((error) => {
        if (!active) return;
        setState({ data: null, loading: false, error: error.message || "Request failed" });
      });
    return () => {
      active = false;
    };
  }, dependencies);

  return state;
}
