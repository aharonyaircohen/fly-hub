"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildAuthHeaders,
  type KodyAuth,
} from "../auth-context";
import {
  MAX_NAVIGATION_FAVORITES,
  normalizeFavoriteHrefs,
  toggleFavoriteHref,
  type NavigationFavoriteItem,
} from "../navigation-favorites";

interface NavigationFavoritesResponse {
  favoriteHrefs?: unknown;
}

export function useNavigationFavorites(
  auth: KodyAuth | null,
  availableItems: readonly NavigationFavoriteItem[],
) {
  const [favoriteHrefs, setFavoriteHrefs] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    if (!auth) {
      setFavoriteHrefs([]);
      return;
    }

    void fetch("/api/kody/navigation-favorites", {
      headers: buildAuthHeaders(auth),
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Favorites request failed (${response.status})`);
        }
        return (await response.json()) as NavigationFavoritesResponse;
      })
      .then((data) => {
        if (!cancelled) {
          setFavoriteHrefs(
            normalizeFavoriteHrefs(data.favoriteHrefs, availableItems),
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessage("Favorites could not be loaded.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [auth, availableItems]);

  const toggleFavorite = useCallback(
    (href: string) => {
      if (!auth) return;
      setFavoriteHrefs((current) => {
        const next = toggleFavoriteHref(current, href);
        if (next === current) {
          setMessage(`You can save up to ${MAX_NAVIGATION_FAVORITES} favorites.`);
          return current;
        }

        const nextHrefs = [...next];
        setMessage(null);
        saveQueueRef.current = saveQueueRef.current
          .catch(() => undefined)
          .then(async () => {
            const response = await fetch("/api/kody/navigation-favorites", {
              method: "PUT",
              headers: {
                ...buildAuthHeaders(auth),
                "content-type": "application/json",
              },
              body: JSON.stringify({ favoriteHrefs: nextHrefs }),
            });
            if (!response.ok) {
              throw new Error(`Favorites request failed (${response.status})`);
            }
          })
          .catch(() => {
            setMessage("Favorites could not be saved.");
          });
        return nextHrefs;
      });
    },
    [auth],
  );

  return { favoriteHrefs, toggleFavorite, message };
}
