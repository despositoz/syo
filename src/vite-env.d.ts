/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TMDB_API_KEY?: string;
  readonly VITE_TMDB_ACCESS_TOKEN?: string;
  readonly VITE_TMDB_API_BASE?: string;
  readonly VITE_TMDB_IMAGE_BASE?: string;
  readonly VITE_TMDB_LANGUAGE?: string;
  /**
   * URL of SYO's own assistant endpoint. Never a provider URL and never a key:
   * anything secret would end up in the public bundle (spec §29.2).
   */
  readonly VITE_ASSISTANT_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
