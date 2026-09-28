/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Black Ticket API, e.g. http://localhost:3000/api/v1 */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
