import { createRoot } from "react-dom/client";
import { useUpdates } from "../src/lib/updates.ts";

function Fixture() {
  const updates = useUpdates(true);
  return <><output data-reload={updates.reload ?? "none"}>{updates.reload ?? "Current"}</output><textarea aria-label="Draft" defaultValue="Keep this unsent draft" /></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
