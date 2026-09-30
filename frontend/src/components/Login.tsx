import { useState, type FormEvent } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { ErrorMessage } from "./ui/ErrorMessage";

export function Login({ initialError }: { initialError: string }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/auth/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          email,
          password,
          ...(mode === "register" ? { name } : {}),
        }),
      });
      if (!response.ok) {
        const result = await response
          .json()
          .catch(() => ({ error: "Sign-in failed. Please try again." }));
        throw new Error(result.error);
      }
      window.location.assign("/");
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(mode === "login" ? "register" : "login");
    setError("");
    setPassword("");
  }

  return (
    <main className="login">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-icon">
          <Mail size={25} />
        </div>
        <h1 id="login-title">
          {mode === "login" ? "Login" : "Create an account"}
        </h1>
        <p>
          {mode === "login"
            ? "Welcome back to your email workspace"
            : "Your email workspace starts here"}
        </p>
        <a className="google" href="/auth/google">
          <strong className="google-g">G</strong> Login with Google
        </a>
        <div className="divider">
          <span>or continue with email</span>
        </div>
        <form className="email-login" onSubmit={submit}>
          {mode === "register" && (
            <label htmlFor="login-name">
              Full name
              <input
                id="login-name"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={100}
                disabled={busy}
                placeholder="Your name"
              />
            </label>
          )}
          <label htmlFor="login-email">
            Email address
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              maxLength={254}
              disabled={busy}
              placeholder="you@example.com"
            />
          </label>
          <label htmlFor="login-password">
            Password
            <input
              id="login-password"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={12}
              maxLength={128}
              disabled={busy}
              placeholder="Enter your password"
              aria-describedby={
                mode === "register" ? "password-hint" : undefined
              }
            />
          </label>
          {mode === "register" && (
            <span id="password-hint" className="password-hint">
              Use at least 12 characters.
            </span>
          )}
          <ErrorMessage message={error} />
          <button className="email-submit" type="submit" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Log in with email"
                : "Create account"}
            <ArrowRight size={15} />
          </button>
        </form>
        <p className="account-switch">
          {mode === "login" ? "New here?" : "Already have an account?"}
          <button type="button" disabled={busy} onClick={switchMode}>
            {mode === "login" ? "Create an account" : "Log in"}
          </button>
        </p>
      </section>
      <footer>Email scheduling, made simple.</footer>
    </main>
  );
}
