/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TMDB_API_KEY?: string;
  readonly VITE_TMDB_ACCESS_TOKEN?: string;
  readonly VITE_TMDB_API_BASE?: string;
  readonly VITE_TMDB_IMAGE_BASE?: string;
  readonly VITE_TMDB_LANGUAGE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
