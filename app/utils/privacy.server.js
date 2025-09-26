import fs from "fs";
import path from "path";

export function loadPrivacyPolicy() {
  const privacyPolicyPath = path.join(process.cwd(), "privacy-policy.md");
  return fs.readFileSync(privacyPolicyPath, "utf-8");
}
