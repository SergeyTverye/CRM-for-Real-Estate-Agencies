import { createRoot } from "react-dom/client";
import { BrowserSessionView } from "@/ui/browser-session/session-view";
createRoot(document.getElementById("root")!).render(<BrowserSessionView id={new URLSearchParams(location.search).get("id")!} />);
