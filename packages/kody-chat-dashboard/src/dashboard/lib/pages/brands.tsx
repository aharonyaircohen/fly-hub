/**
 * @fileType page
 * @domain kody-chat
 * @pattern shared-page
 * @ai-summary Canonical Brands page — hosts serve it as a one-line
 *   re-export (see pages-coverage specs in each host).
 */
import { BrandsManager } from "../components/BrandsManager";

export default function BrandsPage() {
  return <BrandsManager />;
}
