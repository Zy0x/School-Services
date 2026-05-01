import { useState } from "react";
import { authService } from "../services/authService.js";

export function LoginForm({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event) {
    event.preventDefault();
    const response = await authService.login({ email, password });
    setMessage(response.message);
    if (response.success) onSuccess?.(response.data);
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label>
        <span>Email</span>
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Example@gmail.com" />
      </label>
      <label>
        <span>Password</span>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      {message ? <p>{message}</p> : null}
      <button className="primary-button" type="submit">Masuk</button>
    </form>
  );
}
