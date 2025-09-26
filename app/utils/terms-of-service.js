import fs from "fs";
import path from "path";

export async function loadTerms() {
  const termsPath = path.join(process.cwd(), "terminos-de-servicio.md");
  return fs.readFileSync(termsPath, "utf-8");
}
