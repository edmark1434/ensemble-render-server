import { loadFont } from "@remotion/fonts";

const loadedFontKeys = new Map<string, Promise<unknown>>();

export const loadFonts = (
  fonts: { fontFamily: string; url: string }[]
): Promise<unknown[]> => {
  const promises = fonts
    .filter(({ fontFamily, url }) => fontFamily && url)
    .map(({ fontFamily, url }) => {
      const key = `${fontFamily}::${url}`;

      if (!loadedFontKeys.has(key)) {
        loadedFontKeys.set(
          key,
          loadFont({ family: fontFamily, url }).catch((error: unknown) => {
            console.error(
              `Failed to load font "${fontFamily}" from ${url}`,
              error,
            );
          }),
        );
      }

      return loadedFontKeys.get(key)!;
    });

  return Promise.all(promises);
};