/** Route re-export — implementation lives in the Brain control plane. */
export * from "@kody-ade/brain/routes/terminal-setup";
// The re-exported Brain route resolves host-owned personal services at runtime.
import "@dashboard/lib/brain/personal-services";
