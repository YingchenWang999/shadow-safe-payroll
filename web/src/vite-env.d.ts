/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAYROLL_ADDRESS?: `0x${string}`;
  readonly VITE_CHAIN?: "arbitrumSepolia" | "sepolia";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  ethereum?: import("viem").EIP1193Provider;
}
