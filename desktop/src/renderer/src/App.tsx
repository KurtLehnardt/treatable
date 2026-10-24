import { APP_NAME, DISCLAIMER } from "../../shared/ipc";

export function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>{APP_NAME}</h1>
      <p>{DISCLAIMER}</p>
    </main>
  );
}
